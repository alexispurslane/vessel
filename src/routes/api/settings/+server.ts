import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getDb } from "$lib/server/db/index.js";

/**
 * GET /api/settings
 * Get all settings as key-value pairs.
 */
export const GET: RequestHandler = async () => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as {
        key: string;
        value: string;
    }[];

    const settings: Record<string, string> = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }

    return json(settings);
};

/**
 * PUT /api/settings
 * Update one or more settings.
 * Body: { key1: "value1", key2: "value2", ... }
 */
export const PUT: RequestHandler = async ({ request }) => {
    const db = getDb();
    const body = (await request.json()) as Record<string, string>;

    if (!body || typeof body !== "object") {
        return json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const upsert = db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );

    const transaction = db.transaction(() => {
        for (const [key, value] of Object.entries(body)) {
            upsert.run(key, value);
        }
    });

    transaction();

    return json({ success: true });
};
