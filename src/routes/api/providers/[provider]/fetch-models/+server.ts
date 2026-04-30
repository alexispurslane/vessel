import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb } from "$lib/server/db/index.js";

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
export const GET: RequestHandler = async ({ params }) => {
    const db = getDb();
    const row = db
        .prepare(
            "SELECT api_key, base_url, models_endpoint FROM providers WHERE provider = ?"
        )
        .get(params.provider) as
        | {
            api_key: string;
            base_url: string | null;
            models_endpoint: string | null;
        }
        | undefined;

    if (!row) {
        return json({ error: "Provider not found" }, { status: 404 });
    }

    if (!row.models_endpoint) {
        return json({ error: "No models endpoint configured for this provider" }, { status: 400 });
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
            return json(
                { error: `Models endpoint returned ${res.status}: ${text}` },
                { status: 502 }
            );
        }

        const data = await res.json();

        // Normalize the response to a simple list of model IDs
        // OpenAI format: { data: [{ id: "...", ... }, ...] }
        let models: string[];
        if (Array.isArray(data?.data)) {
            models = data.data
                .map((m: Record<string, unknown>) => m.id as string)
                .filter(Boolean)
                .sort();
        } else if (Array.isArray(data)) {
            // Some endpoints return a flat array of model IDs
            models = data
                .map((m: unknown) =>
                    typeof m === "string" ? m : ((m as Record<string, unknown>)?.id as string)
                )
                .filter(Boolean)
                .sort();
        } else {
            models = [];
        }

        return json({ models });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch models";
        return json({ error: message }, { status: 502 });
    }
};
