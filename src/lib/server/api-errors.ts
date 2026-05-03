import { json } from "@sveltejs/kit";
import type { ZodType as ZodSchema } from "zod";
import type { RequestHandler } from "@sveltejs/kit";

type MaybePromise<T> = T | Promise<T>;

// --- Structured error responses ---

/**
 * Standard structured API error response.
 * All API routes should use this for consistent error formatting.
 */
export function apiError(message: string, status: number = 500) {
    return json({ error: message }, { status });
}

/**
 * Bad request (400) — client sent invalid data.
 */
export function badRequest(message: string) {
    return apiError(message, 400);
}

/**
 * Unauthorized (401) — not authenticated.
 */
export function unauthorized(message: string = "Unauthorized") {
    return apiError(message, 401);
}

/**
 * Not found (404).
 */
export function notFound(message: string = "Not found") {
    return apiError(message, 404);
}

/**
 * Internal server error (500).
 */
export function internalError(message: string = "Internal server error") {
    return apiError(message, 500);
}

// --- API handler wrappers ---

/**
 * Create a type-safe API route handler that:
 * 1. Parses the request body as JSON (returns 400 on malformed JSON)
 * 2. Validates the body against a Zod schema (returns 400 with details on failure)
 * 3. Auto-wraps the handler in try/catch (returns 500 on unhandled errors)
 *
 * The callback receives the validated, typed body and the SvelteKit request event.
 *
 * Usage:
 *
 *   const Body = z.object({ name: z.string(), key: z.string() });
 *   export const PUT = apiHandler(Body, async ({ body, event }) => {
 *     // body is typed as { name: string; key: string }
 *     // event.params, event.locals, etc. available
 *   });
 */
export function apiHandler<T>(
    schema: ZodSchema<T>,
    handler: (ctx: { body: T; event: Parameters<RequestHandler>[0] }) => MaybePromise<Response>
): RequestHandler {
    return async (event) => {
        // Parse JSON body
        let raw: unknown;
        try {
            raw = await event.request.json();
        } catch {
            return badRequest("Invalid JSON body");
        }

        // Validate against schema
        const result = schema.safeParse(raw);
        if (!result.success) {
            const firstError = result.error.issues[0];
            const path = firstError.path.join(".") || "body";
            return badRequest(`${path}: ${firstError.message}`);
        }

        try {
            return await handler({ body: result.data, event });
        } catch (e) {
            const message = e instanceof Error ? e.message : "Internal server error";
            return internalError(message);
        }
    };
}

/**
 * Wrap a bodyless API route handler (GET, DELETE with params only, etc.)
 * in a try/catch that returns 500 on unhandled errors.
 *
 * The callback receives the normal SvelteKit request event.
 *
 * Usage:
 *
 *   export const GET = tryApi(async ({ params }) => {
 *     return json(listThings());
 *   });
 */
export function tryApi(
    handler: (event: Parameters<RequestHandler>[0]) => MaybePromise<Response>
): RequestHandler {
    return async (event) => {
        try {
            return await handler(event);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Internal server error";
            return internalError(message);
        }
    };
}
