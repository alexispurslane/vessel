import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { abortSession } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/abort
 * Abort the current generation.
 */
export const POST: RequestHandler = async ({ params }) => {
    await abortSession(params.id);
    return json({ aborted: true });
};
