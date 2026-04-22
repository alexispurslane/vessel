import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { editAssistantMessage } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/edit-assistant
 *
 * In-place edit of an assistant message in the session tree.
 * Navigates back to before the target message, appends the edited version,
 * then replays all subsequent entries from the abandoned branch.
 * Does NOT trigger a new AI generation.
 *
 * Request body:
 *   { targetEntryId: string, newContent: string }
 *
 * Response:
 *   { cancelled: boolean }
 */
export const POST: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;
    const body = await request.json();
    const { targetEntryId, newContent } = body;

    if (!targetEntryId || typeof targetEntryId !== "string") {
        return json({ error: "targetEntryId is required and must be a string" }, { status: 400 });
    }

    if (typeof newContent !== "string") {
        return json({ error: "newContent is required and must be a string" }, { status: 400 });
    }

    try {
        const result = await editAssistantMessage(conversationId, targetEntryId, newContent);
        return json(result);
    } catch (e) {
        console.error(`Failed to edit assistant message in session ${conversationId}:`, e);
        const message = e instanceof Error ? e.message : "Failed to edit assistant message";
        return json({ error: message }, { status: 500 });
    }
};
