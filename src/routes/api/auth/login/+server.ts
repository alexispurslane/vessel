import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
    verifyUser,
    createSessionToken,
    sessionCookie,
    userExists,
} from "$lib/server/auth/index.js";
import { apiError, apiHandler, unauthorized } from "$lib/server/api-errors.js";

const PostBody = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Verify credentials and set session cookie.
 */
export const POST = apiHandler(PostBody, async ({ body }) => {
    if (!userExists()) {
        return apiError("No user exists yet. Run setup first.", 403);
    }

    if (!verifyUser(body.username, body.password)) {
        return unauthorized("Invalid credentials");
    }

    const token = await createSessionToken(body.username);

    return json(
        { success: true },
        {
            headers: {
                "Set-Cookie": sessionCookie(token),
            },
        }
    );
});
