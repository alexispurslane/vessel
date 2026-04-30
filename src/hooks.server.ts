import type { Handle } from "@sveltejs/kit";
import { validateSessionToken, SESSION_COOKIE_NAME, sessionCookie } from "$lib/server/auth/index.js";
import { parse } from "cookie";

// Legacy cookie name from before the TalkAI → Vessel rename.
// Kept temporarily so existing sessions survive the rename.
const LEGACY_SESSION_COOKIE_NAME = "talkai_session";

// --- Rate limiting (unauthenticated only) ---
interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic cleanup of stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (now >= entry.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

function checkRateLimit(
    ip: string,
    maxRequests: number,
    windowMs: number
): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let entry = rateLimitStore.get(ip);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        rateLimitStore.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
        return { allowed: false, retryAfterMs: entry.resetAt - now };
    }

    return { allowed: true, retryAfterMs: 0 };
}

// Rate limit config: login/auth endpoints get stricter limits
const LOGIN_RATE_LIMIT = { max: 10, windowMs: 60_000 };   // 10 req/min on login
const GENERAL_RATE_LIMIT = { max: 60, windowMs: 60_000 }; // 60 req/min on other unauthenticated routes

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
    let username: string | undefined;
    if (token) {
        const payload = await validateSessionToken(token);
        if (payload) {
            authenticated = true;
            username = payload.username;
        }
    }
    event.locals.authenticated = authenticated;
    event.locals.username = username;

    // Rate limit unauthenticated users
    if (!authenticated) {
        const ip = event.getClientAddress();
        const isAuthRoute =
            event.url.pathname.startsWith("/api/auth/") ||
            event.url.pathname === "/login";
        const limit = isAuthRoute ? LOGIN_RATE_LIMIT : GENERAL_RATE_LIMIT;
        const result = checkRateLimit(ip, limit.max, limit.windowMs);

        if (!result.allowed) {
            return new Response(JSON.stringify({ error: "Too many requests" }), {
                status: 429,
                headers: {
                    "Content-Type": "application/json",
                    "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
                },
            });
        }
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

    const response = await resolve(event);

    // Migrate legacy cookie to new name: set the new cookie and clear the old one
    if (hasLegacyCookie && token && authenticated) {
        response.headers.append("set-cookie", sessionCookie(token));
        response.headers.append(
            "set-cookie",
            `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`
        );
    }

    return response;
};
