import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, tryApi } from "$lib/server/api-errors.js";
import {
    sendMessage,
    switchSessionModel,
    getSessionHistory,
} from "$lib/server/agent/session-store.js";

const PostBody = z.object({
    content: z.string().min(1),
    model_id: z.string().optional(),
    status_content: z.string().optional(),
});

/**
 * GET /api/sessions/[id]/messages
 *
 * Load message history for a conversation from the pi session file.
 * Returns messages with their model info, and the last-used model.
 */
export const GET = tryApi(async ({ params }) => {
    const id = params.id!;
    const history = await getSessionHistory(id);
    return json(history);
});

/**
 * POST /api/sessions/[id]/messages
 *
 * Send a message to the session. The agent will process it and
 * broadcast events through the SSE stream.
 *
 * Optionally accepts model_id to switch the model before sending.
 * The provider is resolved automatically from the model ID.
 *
 * This is fire-and-forget from the client's perspective —
 * the response just confirms receipt, the actual content
 * comes through the event stream.
 */
export const POST = apiHandler(PostBody, async ({ body, event }) => {
    const id = event.params.id!;
    const { content, model_id, status_content } = body;

    // If a model is specified, switch to it before sending
    // Provider is resolved automatically from the model ID
    if (model_id) {
        try {
            await switchSessionModel(id, model_id);
        } catch (err) {
            console.error(`Failed to switch model for session ${id}:`, err);
            // Continue with current model if switch fails
        }
    }

    // Don't await the full prompt — the events flow through the SSE stream
    // We just kick it off and return immediately
    sendMessage(id, content, status_content).catch((err) => {
        console.error(`Error in session ${id}:`, err);
    });

    return json({ accepted: true });
});
