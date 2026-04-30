import { json } from "@sveltejs/kit";
import { z } from "zod";
import { getDb } from "$lib/server/db/index.js";
import { apiHandler, tryApi } from "$lib/server/api-errors.js";

const PutBody = z.record(z.string(), z.string());

/**
 * GET /api/settings
 * Get all settings as key-value pairs.
 */
export const GET = tryApi(async () => {
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
});

/**
 * PUT /api/settings
 * Update one or more settings.
 * Body: { key1: "value1", key2: "value2", ... }
 */
export const PUT = apiHandler(PutBody, async ({ body }) => {
    const db = getDb();
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
});
