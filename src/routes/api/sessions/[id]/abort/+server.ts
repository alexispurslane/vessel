import { json } from "@sveltejs/kit";
import { tryApi } from "$lib/server/api-errors.js";
import { abortSession } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/[id]/abort
 * Abort the current generation.
 */
export const POST = tryApi(async ({ params }) => {
    const id = params.id!;
    await abortSession(id);
    return json({ aborted: true });
});
