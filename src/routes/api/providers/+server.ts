import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb } from "$lib/server/db/index.js";
import { refreshModelsJson } from "$lib/server/agent/session-store.js";

/**
 * GET /api/providers
 * List all configured providers (keys are masked).
 */
export const GET: RequestHandler = async () => {
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
};

/**
 * PUT /api/providers
 * Add or update a provider's API key, optional base URL, display name, and models endpoint.
 */
export const PUT: RequestHandler = async ({ request }) => {
    const db = getDb();
    const body = await request.json();
    const { provider, key, base_url, display_name, models_endpoint } = body as {
        provider: string;
        key: string;
        base_url?: string;
        display_name?: string;
        models_endpoint?: string;
    };

    if (!provider || !key) {
        return json({ error: "provider and key are required" }, { status: 400 });
    }

    db.prepare(
        `INSERT INTO providers (provider, encrypted_key, base_url, display_name, models_endpoint)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       base_url = excluded.base_url,
       display_name = excluded.display_name,
       models_endpoint = excluded.models_endpoint`
    ).run(provider, key, base_url ?? null, display_name ?? null, models_endpoint ?? null);

    // Regenerate models.json so pi picks up base_url changes
    refreshModelsJson();

    return json({ success: true });
};

/**
 * DELETE /api/providers
 * Remove a provider's configuration.
 */
export const DELETE: RequestHandler = async ({ request }) => {
    const db = getDb();
    const body = await request.json();
    const { provider } = body as { provider: string };

    if (!provider) {
        return json({ error: "provider is required" }, { status: 400 });
    }

    db.prepare("DELETE FROM providers WHERE provider = ?").run(provider);
    refreshModelsJson();

    return json({ success: true });
};
