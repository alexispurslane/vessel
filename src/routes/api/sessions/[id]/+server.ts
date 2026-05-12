import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, notFound, tryApi } from "$lib/server/api-errors.js";
import { getDb, upsertTags } from "$lib/server/db/index.js";
import { destroyConversation, resolveModelProvider } from "$lib/server/agent/session-store.js";
import { safeJsonParse, stringArraySchema } from "$lib/utils.js";

const PatchBody = z.object({
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
    model_id: z.string().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
}).refine(
    (data) => data.title !== undefined || data.tags !== undefined || data.model_id !== undefined || data.pinned !== undefined || data.archived !== undefined,
    { message: "No fields to update" }
);

/**
 * GET /api/sessions/[id]
 * Get conversation metadata.
 */
export const GET = tryApi(({ params }) => {
    const id = params.id;
    if (!id) return notFound("Conversation not found");
    const db = getDb();
    const row = db
        .query(
            "SELECT id, title, tags, model_provider, model_id, pinned, archived, created_at, updated_at FROM conversations WHERE id = ?"
        )
        .get(id) as
        | {
            id: string;
            title: string;
            tags: string;
            model_provider: string | null;
            model_id: string | null;
            pinned: number;
            archived: number;
            created_at: string;
            updated_at: string;
        }
        | undefined;

    if (!row) {
        return notFound("Conversation not found");
    }

    return json({
        ...row,
        tags: safeJsonParse(row.tags, stringArraySchema) ?? [],
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
    });
});

/**
 * Build SQL SET clause parts and corresponding values from the patch fields.
 * @param fields - The parsed patch body fields
 * @param fields.title - Optional new title
 * @param fields.tags - Optional new tags array
 * @param fields.model_id - Optional new model ID
 * @param fields.pinned - Optional pinned flag
 * @param fields.archived - Optional archived flag
 * @returns Tuple of [updates array, values array]
 */
function buildPatchUpdates(fields: {
    title?: string;
    tags?: string[];
    model_id?: string;
    pinned?: boolean;
    archived?: boolean;
}): [string[], (string | number | null)[]] {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (fields.title !== undefined) {
        updates.push("title = ?");
        values.push(fields.title);
    }
    if (fields.tags !== undefined) {
        updates.push("tags = ?");
        values.push(JSON.stringify(fields.tags));
        upsertTags(fields.tags);
    }
    if (fields.model_id !== undefined) {
        updates.push("model_id = ?");
        values.push(fields.model_id);
        const provider = fields.model_id ? resolveModelProvider(fields.model_id) : null;
        updates.push("model_provider = ?");
        values.push(provider);
    }
    if (fields.pinned !== undefined) {
        updates.push("pinned = ?");
        values.push(fields.pinned ? 1 : 0);
    }
    if (fields.archived !== undefined) {
        updates.push("archived = ?");
        values.push(fields.archived ? 1 : 0);
    }

    return [updates, values];
}

/**
 * PATCH /api/sessions/[id]
 * Update conversation metadata (title, tags, model).
 * When model_id is provided, the provider is resolved automatically.
 */
export const PATCH = apiHandler(PatchBody, ({ body, event }) => {
    const id = event.params.id;
    if (!id) return notFound("Conversation not found");

    const [updates, values] = buildPatchUpdates(body);

    // Safety check — the Zod refine should prevent this, but keep the guard
    if (updates.length === 0) {
        return json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    const db = getDb();
    db.prepare(`UPDATE conversations SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return json({ success: true });
});

/**
 * DELETE /api/sessions/[id]
 * Delete a conversation — removes in-memory session, pi session file,
 * workspace directory, and DB row. Only triggered when the user
 * explicitly hits the trash icon on a conversation.
 */
export const DELETE = tryApi(async ({ params }) => {
    const id = params.id;
    if (!id) return notFound("Conversation not found");
    // Check the conversation exists before destroying
    const db = getDb();
    const row = db.query("SELECT id FROM conversations WHERE id = ?").get(id);

    if (!row) {
        return notFound("Conversation not found");
    }

    await destroyConversation(id);

    return json({ success: true });
});
