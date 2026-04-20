import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { restartAllSessions } from "$lib/server/agent/session-store.js";

/**
 * POST /api/sessions/restart-all
 * Restart all active sessions so they pick up updated settings (e.g. sandbox policy).
 * Sessions are disposed from memory and will be lazily re-created on next access.
 */
export const POST: RequestHandler = async () => {
    const count = restartAllSessions();
    return json({ restarted: count });
};
