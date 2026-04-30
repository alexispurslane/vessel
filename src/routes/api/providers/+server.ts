import { json } from "@sveltejs/kit";
import { z } from "zod";
import { getDb } from "$lib/server/db/index.js";
import { refreshModelsJson } from "$lib/server/agent/session-store.js";
import { apiHandler, tryApi } from "$lib/server/api-errors.js";

const PutBody = z.object({
    provider: z.string().min(1),
    key: z.string().min(1),
    base_url: z.string().optional(),
    display_name: z.string().optional(),
    models_endpoint: z.string().optional(),
});

const DeleteBody = z.object({
    provider: z.string().min(1),
});

/**
 * GET /api/providers
 * List all configured providers (keys are masked).
 */
export const GET = tryApi(async () => {
    const db = getDb();
    const rows = db
        .prepare("SELECT provider, base_url, display_name, models_endpoint FROM providers")
        .all() as {
            provider: string;
            base_url: string | null;
            display_name: string | null;
            models_endpoint: string | null;
        }[];

    return json(
        rows.map((row) => ({
            provider: row.provider,
            displayName: row.display_name ?? undefined,
            baseUrl: row.base_url ?? undefined,
            modelsEndpoint: row.models_endpoint ?? undefined,
            hasKey: true,
        }))
    );
});

/**
 * PUT /api/providers
 * Add or update a provider's API key, optional base URL, display name, and models endpoint.
 */
export const PUT = apiHandler(PutBody, async ({ body }) => {
    const db = getDb();
    db.prepare(
        `INSERT INTO providers (provider, api_key, base_url, display_name, models_endpoint)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       api_key = excluded.api_key,
       base_url = excluded.base_url,
       display_name = excluded.display_name,
       models_endpoint = excluded.models_endpoint`
    ).run(body.provider, body.key, body.base_url ?? null, body.display_name ?? null, body.models_endpoint ?? null);

    // Regenerate models.json so pi picks up base_url changes
    refreshModelsJson();

    return json({ success: true });
});

/**
 * DELETE /api/providers
 * Remove a provider's configuration.
 */
export const DELETE = apiHandler(DeleteBody, async ({ body }) => {
    const db = getDb();
    db.prepare("DELETE FROM providers WHERE provider = ?").run(body.provider);
    refreshModelsJson();

    return json({ success: true });
});
