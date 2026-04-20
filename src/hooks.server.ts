import type { Handle } from "@sveltejs/kit";
import { validateSession, SESSION_COOKIE_NAME } from "$lib/server/auth/index.js";
import { parse } from "cookie";

export const handle: Handle = async ({ event, resolve }) => {
    // Check session cookie
    const cookieHeader = event.request.headers.get("cookie");
    const cookies = cookieHeader ? parse(cookieHeader) : {};
    const token = cookies[SESSION_COOKIE_NAME];

    if (token && validateSession(token)) {
        event.locals.authenticated = true;
    } else {
        event.locals.authenticated = false;
    }

    const url = event.url;

    // Allow auth routes through without authentication
    const isAuthRoute =
        url.pathname.startsWith("/api/auth/") ||
        url.pathname === "/login" ||
        url.pathname === "/setup";

    if (isAuthRoute) {
        return resolve(event);
    }

    // Protect API routes
    if (url.pathname.startsWith("/api/") && !event.locals.authenticated) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Protect page routes (redirect to login)
    if (!url.pathname.startsWith("/api/") && !event.locals.authenticated) {
        // Let static assets through
        if (
            url.pathname.startsWith("/_app/") ||
            url.pathname.endsWith(".css") ||
            url.pathname.endsWith(".js") ||
            url.pathname.endsWith(".woff2")
        ) {
            return resolve(event);
        }

        return new Response(null, {
            status: 302,
            headers: { Location: "/login" },
        });
    }

    return resolve(event);
};
