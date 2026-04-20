import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    deleteSession,
    clearSessionCookie,
    validateSession,
    SESSION_COOKIE_NAME,
} from "$lib/server/auth/index.js";
import { parse } from "cookie";

/**
 * POST /api/auth/logout
 * Clear session cookie and delete session from DB.
 */
export const POST: RequestHandler = async ({ request }) => {
    const cookieHeader = request.headers.get("cookie");
    const cookies = cookieHeader ? parse(cookieHeader) : {};
    const token = cookies[SESSION_COOKIE_NAME];

    if (token) {
        deleteSession(token);
    }

    return json(
        { success: true },
        {
            headers: {
                "Set-Cookie": clearSessionCookie(),
            },
        }
    );
};
