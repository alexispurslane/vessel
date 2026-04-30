import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, tryApi } from "$lib/server/api-errors.js";
import { listConversations, createConversation } from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    title: z.string().optional(),
    model_id: z.string().optional(),
});

/**
 * GET /api/sessions
 * List all conversations (for sidebar).
 */
export const GET = tryApi(async () => {
    return json(listConversations());
});

/**
 * POST /api/sessions
 * Create a new conversation.
 * Only requires model_id — provider is resolved automatically.
 */
export const POST = apiHandler(PostBody, async ({ body }) => {
    const { title, model_id } = body;
    const id = await createConversation(title, model_id);
    return json({ id }, { status: 201 });
});
