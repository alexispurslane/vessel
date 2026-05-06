/**
 * @file Structured API error responses and type-safe route handler wrappers.
 */

import { json } from "@sveltejs/kit";
import type { ZodType as ZodSchema } from "zod";
import type { RequestHandler } from "@sveltejs/kit";

type MaybePromise<T> = T | Promise<T>;

// --- Structured error responses ---

/**
 * Standard structured API error response.
 * All API routes should use this for consistent error formatting.
 * @param message - The error message
 * @param status - The HTTP status code
 * @returns A SvelteKit JSON response
 */
export function apiError(message: string, status: number = 500) {
    return json({ error: message }, { status });
}

/**
 * Bad request (400) — client sent invalid data.
 * @param message - The error message
 * @returns A 400 JSON response
 */
export function badRequest(message: string) {
    return apiError(message, 400);
}

/**
 * Unauthorized (401) — not authenticated.
 * @param message - The error message
 * @returns A 401 JSON response
 */
export function unauthorized(message: string = "Unauthorized") {
    return apiError(message, 401);
}

/**
 * Not found (404).
 * @param message - The error message
 * @returns A 404 JSON response
 */
export function notFound(message: string = "Not found") {
    return apiError(message, 404);
}

/**
 * Internal server error (500).
 * @param message - The error message
 * @returns A 500 JSON response
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
 * @param schema - Zod schema to validate the request body
 * @param handler - Callback receiving the validated body and request event
 * @returns A SvelteKit RequestHandler
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
 * @param handler - Callback receiving the SvelteKit request event
 * @returns A SvelteKit RequestHandler
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
