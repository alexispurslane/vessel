import { json } from "@sveltejs/kit";
import { clearSessionCookie } from "$lib/server/auth/index.js";
import { tryApi } from "$lib/server/api-errors.js";

/**
 * POST /api/auth/logout
 * Clear session cookie.
 */
export const POST = tryApi(() => {
    return json(
        { success: true },
        {
            headers: {
                "Set-Cookie": clearSessionCookie(),
            },
        }
    );
});
