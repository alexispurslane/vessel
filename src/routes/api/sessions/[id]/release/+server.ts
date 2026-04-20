import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { disposeSession } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/release
 *
 * Release the in-memory copy of a conversation's session.
 * Does NOT delete any data on disk (pi session file, workspace, DB row).
 * The conversation can be rehydrated from disk when next accessed.
 *
 * Called when:
 * - The user closes the browser tab / ends the browser session
 * - The frontend wants to eagerly release memory for an inactive conversation
 */
export const POST: RequestHandler = async ({ params }) => {
    disposeSession(params.id);
    return json({ released: true });
};
