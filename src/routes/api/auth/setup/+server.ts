import { json } from "@sveltejs/kit";
import { z } from "zod";
import { createUser, userExists } from "$lib/server/auth/index.js";
import { apiError, apiHandler } from "$lib/server/api-errors.js";

const PostBody = z.object({
    username: z.string().min(1),
    password: z.string().min(8),
});

/**
 * POST /api/auth/setup
 * Create the single user. Only works if no user exists yet.
 * Guarded at both API level and DB level.
 */
export const POST = apiHandler(PostBody, ({ body }) => {
    if (userExists()) {
        return apiError("User already exists", 409);
    }

    createUser(body.username, body.password);

    return json({ success: true });
});
