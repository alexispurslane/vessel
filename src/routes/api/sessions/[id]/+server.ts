import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb, upsertTags } from "$lib/server/db/index.js";
import { destroyConversation, resolveModelProvider } from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions/[id]
 * Get conversation metadata.
 */
export const GET: RequestHandler = async ({ params }) => {
    const db = getDb();
    const row = db
        .prepare(
            "SELECT id, title, tags, model_provider, model_id, created_at, updated_at FROM conversations WHERE id = ?"
        )
        .get(params.id) as
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
        return json({ error: "Conversation not found" }, { status: 404 });
    }

    return json({
        ...row,
        tags: JSON.parse(row.tags) as string[],
    });
};

/**
 * PATCH /api/sessions/[id]
 * Update conversation metadata (title, tags, model).
 * When model_id is provided, the provider is resolved automatically.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
    const db = getDb();
    const body = await request.json();
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

    if (updates.length === 0) {
        return json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(params.id);

    db.prepare(`UPDATE conversations SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return json({ success: true });
};

/**
 * DELETE /api/sessions/[id]
 * Delete a conversation — removes in-memory session, pi session file,
 * workspace directory, and DB row. Only triggered when the user
 * explicitly hits the trash icon on a conversation.
 */
export const DELETE: RequestHandler = async ({ params }) => {
    // Check the conversation exists before destroying
    const db = getDb();
    const row = db.prepare("SELECT id FROM conversations WHERE id = ?").get(params.id);

    if (!row) {
        return json({ error: "Conversation not found" }, { status: 404 });
    }

    await destroyConversation(params.id);

    return json({ success: true });
};
