import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import {
    verifyUser,
    createSessionToken,
    sessionCookie,
    userExists,
} from "$lib/server/auth/index.js";

/**
 * POST /api/auth/login
 * Verify credentials and set session cookie.
 */
export const POST: RequestHandler = async ({ request }) => {
    if (!userExists()) {
        return json({ error: "No user exists yet. Run setup first." }, { status: 403 });
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
        return json({ error: "Username and password are required" }, { status: 400 });
    }

    if (!verifyUser(username, password)) {
        return json({ error: "Invalid credentials" }, { status: 401 });
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
};
