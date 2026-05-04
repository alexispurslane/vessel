import type { Handle } from "@sveltejs/kit";
import { validateSessionToken, SESSION_COOKIE_NAME, sessionCookie } from "$lib/server/auth/index.js";
import { parse } from "cookie";

// Legacy cookie name kept temporarily so existing sessions survive the TalkAI → Vessel rename.
const LEGACY_SESSION_COOKIE_NAME = "talkai_session";

// --- Helpers ---

const AUTH_PATHS = ["/api/auth/", "/login", "/setup"];
const STATIC_EXTENSIONS = [".css", ".js", ".woff2"];

function isAuthRoute(pathname: string): boolean {
    return AUTH_PATHS.some((p) => pathname.startsWith(p) || pathname === p);
}

function isStaticAsset(pathname: string): boolean {
    return pathname.startsWith("/_app/") || STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function jsonError(error: string, status: number): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function redirect(to: string): Response {
    return new Response(null, { status: 302, headers: { Location: to } });
}

// --- Rate limiting (unauthenticated only) ---

const rateLimits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits) {
        if (now >= entry.resetAt) rateLimits.delete(key);
    }
}, 5 * 60 * 1000);

const RATE_LIMIT_CONFIGS = {
    auth: { max: 10, windowMs: 60_000 },   // 10 req/min on login/auth
    general: { max: 60, windowMs: 60_000 }, // 60 req/min elsewhere
} as const;

function rateLimitResponse(ip: string, max: number, windowMs: number): Response | null {
    const now = Date.now();
    let entry = rateLimits.get(ip);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        rateLimits.set(ip, entry);
    }

    entry.count++;

    if (entry.count > max && !import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
            status: 429,
            headers: {
                "Content-Type": "application/json",
                "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
            },
        });
    }
    return null;
}

// --- Main hook ---

export const handle: Handle = async ({ event, resolve }) => {
    const { url } = event;

    // 1. Resolve session
    const cookies = parse(event.request.headers.get("cookie") ?? "");
    const token = cookies[SESSION_COOKIE_NAME] ?? cookies[LEGACY_SESSION_COOKIE_NAME];
    const hasLegacyCookie = !cookies[SESSION_COOKIE_NAME] && !!cookies[LEGACY_SESSION_COOKIE_NAME];

    if (token) {
        const payload = await validateSessionToken(token);
        if (payload) {
            event.locals.authenticated = true;
            event.locals.username = payload.username;
        }
    }

    if (!event.locals.authenticated) {
        event.locals.authenticated = false;
    }

    // 2. Rate limit unauthenticated users
    if (!event.locals.authenticated) {
        const config = isAuthRoute(url.pathname) ? RATE_LIMIT_CONFIGS.auth : RATE_LIMIT_CONFIGS.general;
        const blocked = rateLimitResponse(event.getClientAddress(), config.max, config.windowMs);
        if (blocked) return blocked;
    }

    // 3. Auth routes always pass through
    if (isAuthRoute(url.pathname)) return resolve(event);

    // 4. Protect routes
    if (!event.locals.authenticated) {
        if (url.pathname.startsWith("/api/")) return jsonError("Unauthorized", 401);
        if (isStaticAsset(url.pathname)) return resolve(event);
        return redirect("/login");
    }

    // 5. Resolve and migrate legacy cookie
    const response = await resolve(event);

    if (hasLegacyCookie && token) {
        response.headers.append("set-cookie", sessionCookie(token));
        response.headers.append(
            "set-cookie",
            `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
        );
    }

    return response;
};
