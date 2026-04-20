import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { navigateMessage } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/navigate
 *
 * Navigate the session tree to a target entry. Used for delete/edit operations:
 * - Moves the conversation's "current position" back to before the target message
 * - Effectively abandons the target message and everything after it
 * - For user messages, returns the message text (for editing and re-sending)
 *
 * Request body:
 *   { targetEntryId: string }
 *
 * Response:
 *   { editorText?: string, cancelled: boolean }
 */
export const POST: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;
    const body = await request.json();
    const { targetEntryId } = body;

    if (!targetEntryId || typeof targetEntryId !== "string") {
        return json({ error: "targetEntryId is required and must be a string" }, { status: 400 });
    }

    try {
        const result = await navigateMessage(conversationId, targetEntryId);
        return json(result);
    } catch (e) {
        console.error(`Failed to navigate session ${conversationId} to ${targetEntryId}:`, e);
        const message = e instanceof Error ? e.message : "Failed to navigate session";
        return json({ error: message }, { status: 500 });
    }
};
