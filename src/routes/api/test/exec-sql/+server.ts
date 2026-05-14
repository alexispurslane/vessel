/**
 * @file POST /api/test/exec-sql — execute arbitrary SQL against the in-memory test database.
 *
 * Only available when `VESSEL_IN_MEMORY_DB=1`. Returns 403 otherwise,
 * preventing accidental use against a production on-disk database.
 *
 * Accepts a JSON body with an array of SQL statements:
 *   { "statements": ["INSERT INTO auth ...", "INSERT INTO conversations ..."] }
 *
 * Each statement is executed sequentially via `db.run()`.
 * On failure, the first error is returned and execution stops.
 */

import { json } from "@sveltejs/kit";
import { z } from "zod";
import { apiError, apiHandler } from "$lib/server/api-errors.js";
import { getDb, isInMemoryDb } from "$lib/server/db/index.js";

const ExecBody = z.object({
    statements: z.array(z.string()).min(1),
});

/**
 * POST /api/test/exec-sql
 * Execute SQL statements against the in-memory test database.
 *
 * The caller (E2E test harness) is responsible for constructing
 * valid SQL, including bcrypt-hashed passwords for the auth table.
 */
export const POST = apiHandler(ExecBody, ({ body }) => {
    if (!isInMemoryDb) {
        return apiError(
            "Test exec-sql endpoint is only available when VESSEL_IN_MEMORY_DB=1",
            403,
        );
    }

    const db = getDb();
    const executed: string[] = [];

    try {
        for (const stmt of body.statements) {
            db.run(stmt);
            executed.push(stmt);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json(
            { error: msg, executed },
            { status: 400 },
        );
    }

    return json({ executed: executed.length });
});
