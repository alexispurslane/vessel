import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    sendMessage,
    switchSessionModel,
    getSessionHistory,
} from "$lib/server/agent/session-store.js";

/**
 * GET /api/sessions/[id]/messages
 *
 * Load message history for a conversation from the pi session file.
 * Returns messages with their model info, and the last-used model.
 */
export const GET: RequestHandler = async ({ params }) => {
    const conversationId = params.id;

    try {
        const history = await getSessionHistory(conversationId);
        return json(history);
    } catch (e) {
        console.error(`Failed to load history for ${conversationId}:`, e);
        return json({ error: "Failed to load message history" }, { status: 500 });
    }
};

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
export const POST: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;
    const body = await request.json();
    const { content, model_id } = body;

    if (!content || typeof content !== "string") {
        return json({ error: "content is required and must be a string" }, { status: 400 });
    }

    // If a model is specified, switch to it before sending
    // Provider is resolved automatically from the model ID
    if (model_id) {
        try {
            await switchSessionModel(conversationId, model_id);
        } catch (err) {
            console.error(`Failed to switch model for session ${conversationId}:`, err);
            // Continue with current model if switch fails
        }
    }

    // Don't await the full prompt — the events flow through the SSE stream
    // We just kick it off and return immediately
    sendMessage(conversationId, content).catch((err) => {
        console.error(`Error in session ${conversationId}:`, err);
    });

    return json({ accepted: true });
};
