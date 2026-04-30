import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { clearSessionCookie } from "$lib/server/auth/index.js";

/**
 * POST /api/auth/logout
 * Clear session cookie.
 */
export const POST: RequestHandler = async () => {
    return json(
        { success: true },
        {
            headers: {
                "Set-Cookie": clearSessionCookie(),
            },
        }
    );
};
