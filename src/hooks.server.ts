/**
 * @file SvelteKit server hook: auth and route protection.
 */
import type { Handle, RequestEvent } from "@sveltejs/kit";
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

/**
 * Resolve the current user's session from cookies.
 *
 * Checks both the current and legacy session cookie names,
 * validates the token, and populates event.locals with
 * authentication state.
 *
 * @param event - The SvelteKit request event
 * @returns The session token and whether a legacy cookie was used
 */
async function resolveAuth(event: RequestEvent): Promise<{ token: string | undefined; hasLegacyCookie: boolean }> {
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

    return { token, hasLegacyCookie };
}

/**
 * Migrate a legacy session cookie to the current cookie name.
 *
 * If the user authenticated via the legacy `talkai_session` cookie,
 * we set the current `session` cookie and delete the legacy one.
 *
 * @param token - The validated session token
 * @param hasLegacyCookie - Whether the request used the legacy cookie
 * @param response - The response to attach set-cookie headers to
 */
function migrateLegacyCookie(token: string | undefined, hasLegacyCookie: boolean, response: Response): void {
    if (hasLegacyCookie && token) {
        response.headers.append("set-cookie", sessionCookie(token));
        response.headers.append(
            "set-cookie",
            `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
        );
    }
}

// --- Main hook ---

/**
 * SvelteKit server hook: auth and route protection.
 * Resolves session tokens and redirects unauthenticated users to the login page.
 *
 * @param root0 - The hook params
 * @param root0.event - The request event
 * @param root0.resolve - The resolve function
 * @returns The response
 */
export const handle: Handle = async ({ event, resolve }) => {
    const { url } = event;

    // 1. Resolve session
    const { token, hasLegacyCookie } = await resolveAuth(event);

    // 2. Auth routes always pass through
    if (isAuthRoute(url.pathname)) return resolve(event);

    // 3. Protect routes
    if (!event.locals.authenticated) {
        if (url.pathname.startsWith("/api/")) return jsonError("Unauthorized", 401);
        if (isStaticAsset(url.pathname)) return resolve(event);
        return redirect("/login");
    }

    // 4. Resolve and migrate legacy cookie
    const response = await resolve(event);
    migrateLegacyCookie(token, hasLegacyCookie, response);

    return response;
};
