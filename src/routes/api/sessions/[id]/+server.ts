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
}).refine(
    (data) => data.title !== undefined || data.tags !== undefined || data.model_id !== undefined,
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
        .prepare(
            "SELECT id, title, tags, model_provider, model_id, created_at, updated_at FROM conversations WHERE id = ?"
        )
        .get(id) as
        | {
            id: string;
            title: string;
            tags: string;
            model_provider: string | null;
            model_id: string | null;
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
    });
});

/**
 * PATCH /api/sessions/[id]
 * Update conversation metadata (title, tags, model).
 * When model_id is provided, the provider is resolved automatically.
 */
export const PATCH = apiHandler(PatchBody, ({ body, event }) => {
    const id = event.params.id;
    if (!id) return notFound("Conversation not found");
    const { title, tags, model_id } = body;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (title !== undefined) {
        updates.push("title = ?");
        values.push(title);
    }
    if (tags !== undefined) {
        updates.push("tags = ?");
        values.push(JSON.stringify(tags));
        // Ensure these tags exist in the global tags table
        upsertTags(tags);
    }
    if (model_id !== undefined) {
        updates.push("model_id = ?");
        values.push(model_id);
        // Auto-resolve the provider from the model ID
        const provider = model_id ? resolveModelProvider(model_id) : null;
        updates.push("model_provider = ?");
        values.push(provider);
    }

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
export const DELETE = tryApi(({ params }) => {
    const id = params.id;
    if (!id) return notFound("Conversation not found");
    // Check the conversation exists before destroying
    const db = getDb();
    const row = db.prepare("SELECT id FROM conversations WHERE id = ?").get(id);

    if (!row) {
        return notFound("Conversation not found");
    }

    destroyConversation(id);

    return json({ success: true });
});
