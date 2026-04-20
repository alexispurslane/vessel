import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { createUser } from "$lib/server/auth/index.js";

/**
 * POST /api/auth/setup
 * Create the single user. Only works if no user exists yet.
 * Guarded at both API level and DB level.
 */
export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
        return json({ error: "Username and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    try {
        createUser(username, password);
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        if (message === "User already exists") {
            return json({ error: "User already exists" }, { status: 409 });
        }
        throw e;
    }

    return json({ success: true });
};
