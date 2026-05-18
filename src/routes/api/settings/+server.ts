import { json } from "@sveltejs/kit";
import { z } from "zod";
import { getDb } from "$lib/server/db/index.js";
import { apiHandler, tryApi } from "$lib/server/api-errors.js";
import { IS_LINUX } from "$lib/server/agent/sandbox-factory.js";

const PutBody = z.record(z.string(), z.string());

/**
 * GET /api/settings
 * Get all settings as key-value pairs.
 */
export const GET = tryApi(() => {
    const db = getDb();
    const rows = db.query("SELECT key, value FROM settings").all() as {
        key: string;
        value: string;
    }[];

    const settings: Record<string, string> = {};
    for (const row of rows) {
        // row.key from DB settings table under our control, not user input
        // oxlint-disable-next-line secure-coding/detect-object-injection
        settings[row.key] = row.value;
    }

    return json(settings);
});

/**
 * PUT /api/settings
 * Update one or more settings.
 * Body: { key1: "value1", key2: "value2", ... }
 */
export const PUT = apiHandler(PutBody, ({ body }) => {
    // On Linux, force sandbox.enabled to "false" regardless of what the client
    // sent — the Zerobox runtime doesn't work properly on Linux (upstream bug).
    if (IS_LINUX) {
        body["sandbox.enabled"] = "false";
    }

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
