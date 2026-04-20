import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { listConversations, createConversation } from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions
 * List all conversations (for sidebar).
 */
export const GET: RequestHandler = async () => {
    return json(listConversations());
};

/**
 * POST /api/sessions
 * Create a new conversation.
 * Only requires model_id — provider is resolved automatically.
 */
export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const { title, model_id } = body as { title?: string; model_id?: string };

    const id = await createConversation(title, model_id);
    return json({ id }, { status: 201 });
};
