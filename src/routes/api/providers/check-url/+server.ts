import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiHandler, badRequest } from "$lib/server/api-errors.js";

const Body = z.object({
    url: z.string().min(1),
});

/**
 * POST /api/providers/check-url
 * Checks whether a base URL is reachable by making a lightweight request to it.
 * Returns { accessible: true } on success, or an error response on failure.
 */
export const POST = apiHandler(Body, async ({ body }) => {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(body.url);
    } catch {
        return badRequest("Invalid URL format");
    }

    // Only allow http/https
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return badRequest("Only http: and https: URLs are supported");
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(function () {
            controller.abort();
        }, 10_000);

        const response = await fetch(parsedUrl.origin, {
            method: "HEAD",
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Any response (even 4xx/5xx) means the server is reachable
        return json({ accessible: true, status: response.status });
    } catch (e) {
        const message =
            e instanceof Error
                ? e.message === "The operation was aborted"
                    ? "Connection timed out after 10 seconds"
                    : e.message
                : "Failed to connect";

        return json(
            { accessible: false, error: `Could not reach ${parsedUrl.origin}: ${message}` },
            { status: 400 }
        );
    }
});
