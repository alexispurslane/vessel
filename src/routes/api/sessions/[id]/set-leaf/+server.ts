import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { setSessionLeaf } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/set-leaf
 *
 * Set the session's current leaf position to a specific entry.
 * Used by the DAG viewer to navigate to a different point in the tree.
 *
 * Request body:
 *   { targetEntryId: string }
 *
 * Response:
 *   { success: boolean }
 */
export const POST: RequestHandler = async ({ params, request }) => {
    const conversationId = params.id;
    const body = await request.json();
    const { targetEntryId } = body;

    if (!targetEntryId || typeof targetEntryId !== "string") {
        return json({ error: "targetEntryId is required and must be a string" }, { status: 400 });
    }

    try {
        await setSessionLeaf(conversationId, targetEntryId);
        return json({ success: true });
    } catch (e) {
        console.error(`Failed to set leaf for session ${conversationId}:`, e);
        const message = e instanceof Error ? e.message : "Failed to set session leaf";
        return json({ error: message }, { status: 500 });
    }
};
