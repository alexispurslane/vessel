/**
 * @file POST /api/sessions/bulk — batch archive, unarchive, delete, or tag conversations.
 */
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler } from "$lib/server/api-errors.js";
import { getDb, upsertTags } from "$lib/server/db/index.js";
import { destroyConversation } from "$lib/server/agent/session-store.js";

const BulkBody = z.object({
    ids: z.array(z.string()).min(1).max(100),
    action: z.enum(["archive", "unarchive", "delete", "tag"]),
    tags: z.array(z.string()).optional(),
}).refine(
    (data) => !(data.action === "tag" && (!data.tags || data.tags.length === 0)),
    { message: "tags required for tag action" }
);

type BulkAction = z.infer<typeof BulkBody>["action"];

/** Per-action result counts returned in the response. */
interface BulkResult {
    action: BulkAction;
    succeeded: number;
    failed: number;
    failures?: Array<{ id: string; error: string }>;
}

/**
 * Bulk-archive conversations: set archived = 1 and clear pinned.
 * @param ids - Conversation IDs to archive
 * @param db - Database instance
 * @returns Result with success/failure counts
 */
function bulkArchive(ids: string[], db: ReturnType<typeof getDb>): BulkResult {
    const stmt = db.prepare(
        "UPDATE conversations SET archived = 1, pinned = 0, updated_at = datetime('now') WHERE id = ?"
    );
    let succeeded = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
        const result = stmt.run(id);
        if (result.changes > 0) {
            succeeded++;
        } else {
            failures.push({ id, error: "not found" });
        }
    }
    return { action: "archive", succeeded, failed: failures.length, failures: failures.length > 0 ? failures : undefined };
}

/**
 * Bulk-unarchive conversations: set archived = 0.
 * @param ids - Conversation IDs to unarchive
 * @param db - Database instance
 * @returns Result with success/failure counts
 */
function bulkUnarchive(ids: string[], db: ReturnType<typeof getDb>): BulkResult {
    const stmt = db.prepare(
        "UPDATE conversations SET archived = 0, updated_at = datetime('now') WHERE id = ?"
    );
    let succeeded = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
        const result = stmt.run(id);
        if (result.changes > 0) {
            succeeded++;
        } else {
            failures.push({ id, error: "not found" });
        }
    }
    return { action: "unarchive", succeeded, failed: failures.length, failures: failures.length > 0 ? failures : undefined };
}

/**
 * Bulk-delete conversations: destroy sessions, files, and DB rows.
 * @param ids - Conversation IDs to delete
 * @returns Result with success/failure counts
 */
async function bulkDelete(ids: string[]): Promise<BulkResult> {
    let succeeded = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
        try {
            await destroyConversation(id);
            succeeded++;
        } catch (e) {
            failures.push({ id, error: e instanceof Error ? e.message : "unknown error" });
        }
    }
    return { action: "delete", succeeded, failed: failures.length, failures: failures.length > 0 ? failures : undefined };
}

/**
 * Bulk-tag conversations: merge new tags into each conversation's existing tags.
 * @param ids - Conversation IDs to tag
 * @param tags - Tags to add
 * @param db - Database instance
 * @returns Result with success/failure counts
 */
function bulkTag(ids: string[], tags: string[], db: ReturnType<typeof getDb>): BulkResult {
    const selectStmt = db.prepare("SELECT tags FROM conversations WHERE id = ?");
    const updateStmt = db.prepare(
        "UPDATE conversations SET tags = ?, updated_at = datetime('now') WHERE id = ?"
    );
    let succeeded = 0;
    const failures: Array<{ id: string; error: string }> = [];

    const merge = db.transaction((conversationIds: string[]) => {
        for (const id of conversationIds) {
            const row = selectStmt.get(id) as { tags: string } | undefined;
            if (!row) {
                failures.push({ id, error: "not found" });
                continue;
            }
            const existing = JSON.parse(row.tags) as string[];
            const merged = [...new Set([...existing, ...tags.map((t) => t.trim().toLowerCase())])];
            updateStmt.run(JSON.stringify(merged), id);
            succeeded++;
        }
    });

    merge(ids);
    upsertTags(tags);
    return { action: "tag", succeeded, failed: failures.length, failures: failures.length > 0 ? failures : undefined };
}

/**
 * POST /api/sessions/bulk
 * Perform a batch action on multiple conversations.
 */
export const POST = apiHandler(BulkBody, async ({ body }) => {
    const { ids, action, tags } = body;
    const db = getDb();

    let result: BulkResult;

    switch (action) {
        case "archive":
            result = bulkArchive(ids, db);
            break;
        case "unarchive":
            result = bulkUnarchive(ids, db);
            break;
        case "delete":
            result = await bulkDelete(ids);
            break;
        case "tag":
            result = bulkTag(ids, tags!, db);
            break;
    }

    return json(result);
});
