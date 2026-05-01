import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
    verifyUser,
    verifyPassword,
    getUsername,
    createSessionToken,
    sessionCookie,
    userExists,
} from "$lib/server/auth/index.js";
import { apiError, apiHandler, unauthorized } from "$lib/server/api-errors.js";

const PostBody = z.object({
    username: z.string().min(1).optional(),
    password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Verify credentials and set session cookie.
 * Username is optional — if omitted, the single-user account is used.
 */
export const POST = apiHandler(PostBody, async ({ body }) => {
    if (!userExists()) {
        return apiError("No user exists yet. Run setup first.", 403);
    }

    const username = body.username ?? getUsername();
    if (!username) {
        return apiError("No user exists yet. Run setup first.", 403);
    }

    // If username was provided, verify against it. Otherwise just check password.
    const valid = body.username
        ? verifyUser(body.username, body.password)
        : verifyPassword(body.password);

    if (!valid) {
        return unauthorized("Invalid credentials");
    }

    const token = await createSessionToken(username);

    return json(
        { success: true },
        {
            headers: {
                "Set-Cookie": sessionCookie(token),
            },
        }
    );
});
