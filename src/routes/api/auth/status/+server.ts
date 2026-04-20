import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { userExists, getUsername } from "$lib/server/auth/index.js";

/**
 * GET /api/auth/status
 * Check if auth is set up and if the user is logged in.
 */
export const GET: RequestHandler = async ({ locals }) => {
    return json({
        setup: userExists(),
        authenticated: !!locals.authenticated,
        username: locals.authenticated ? getUsername() : undefined,
    });
};
