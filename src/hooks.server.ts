import type { Handle } from "@sveltejs/kit";
import { validateSession, SESSION_COOKIE_NAME, sessionCookie } from "$lib/server/auth/index.js";
import { parse } from "cookie";

// Legacy cookie name from before the TalkAI → Vessel rename.
// Kept temporarily so existing sessions survive the rename.
const LEGACY_SESSION_COOKIE_NAME = "talkai_session";

export const handle: Handle = async ({ event, resolve }) => {
    // Check session cookie (support both new and legacy names)
    const cookieHeader = event.request.headers.get("cookie");
    const cookies = cookieHeader ? parse(cookieHeader) : {};
    let token = cookies[SESSION_COOKIE_NAME];
    const hasLegacyCookie = !token && !!cookies[LEGACY_SESSION_COOKIE_NAME];

    // Fall back to legacy cookie name if new one isn't present
    if (!token) {
        token = cookies[LEGACY_SESSION_COOKIE_NAME];
    }

    let authenticated = false;
    if (token && validateSession(token)) {
        authenticated = true;
    }
    event.locals.authenticated = authenticated;

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

    const response = await resolve(event);

    // Migrate legacy cookie to new name: set the new cookie and clear the old one
    if (hasLegacyCookie && token && authenticated) {
        response.headers.append("set-cookie", sessionCookie(token));
        response.headers.append(
            "set-cookie",
            `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
        );
    }

    return response;
};
