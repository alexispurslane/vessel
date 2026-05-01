import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { userExists, getUsername } from "$lib/server/auth/index.js";

/**
 * GET /api/auth/status
 * Check if auth is set up and if the user is logged in.
 * Returns username even for unauthenticated users so the login page can auto-fill it.
 */
export const GET: RequestHandler = ({ locals }) => {
    const setup = userExists();
    return json({
        setup,
        authenticated: locals.authenticated,
        username: setup ? (locals.username ?? getUsername()) : undefined,
    });
};
