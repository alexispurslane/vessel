import { json } from "@sveltejs/kit";
import { getDb } from "$lib/server/db/index.js";
import { badRequest, notFound, apiError, tryApi } from "$lib/server/api-errors.js";

/**
 * GET /api/providers/[provider]/fetch-models
 *
 * Fetch available models from a provider's /v1/models endpoint.
 * Only works for providers that have a models_endpoint configured.
 * Proxies the request server-side so the API key never hits the client.
 *
 * Expects the provider's models endpoint to return the OpenAI-compatible format:
 * { data: [{ id: "model-name", object: "model", ... }, ...] }
 */
export const GET = tryApi(async ({ params }) => {
    const provider = params.provider;
    if (!provider) return notFound("Provider not found");
    const db = getDb();
    const row = db
        .query(
            "SELECT api_key, base_url, models_endpoint FROM providers WHERE provider = ?"
        )
        .get(provider) as
        | {
            api_key: string;
            base_url: string | null;
            models_endpoint: string | null;
        }
        | undefined;

    if (!row) {
        return notFound("Provider not found");
    }

    if (!row.models_endpoint) {
        return badRequest("No models endpoint configured for this provider");
    }

    try {
        const res = await fetch(row.models_endpoint, {
            headers: {
                Authorization: `Bearer ${row.api_key}`,
                "Content-Type": "application/json",
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "Unknown error");
            return apiError(`Models endpoint returned ${res.status}: ${text}`, 502);
        }

        // Type the JSON response to avoid `any`
        // OpenAI format: { data: [{ id: "...", ... }, ...] }
        type ModelsResponse = { data?: Array<Record<string, unknown>> } | Array<unknown> | null;
        const data = (await res.json()) as ModelsResponse;

        // Normalize the response to a simple list of model IDs
        let models: string[];
        if (!Array.isArray(data) && typeof data === "object" && data !== null && Array.isArray(data.data)) {
            models = data.data
                .map((m) => m.id as string)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        } else if (Array.isArray(data)) {
            // Some endpoints return a flat array of model IDs
            models = data
                .map((m) =>
                    typeof m === "string" ? m : ((m as Record<string, unknown>).id as string)
                )
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        } else {
            models = [];
        }

        return json({ models });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch models";
        return apiError(message, 502);
    }
});
