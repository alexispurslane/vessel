/**
 * @file Playwright globalSetup: starts the mock LLM server, seeds the
 * in-memory test database via SQL, and tears down the mock server on exit.
 *
 * Called once before all tests, after the dev server is ready.
 * Sends a blob of SQL statements to the /api/test/exec-sql endpoint,
 * which executes them against the in-memory SQLite database.
 *
 * The endpoint only works when VESSEL_IN_MEMORY_DB=1.
 *
 * @see src/routes/api/test/exec-sql/+server.ts — the SQL execution endpoint
 * @see e2e/mock-llm-server.ts — the mock OpenAI-compatible LLM server
 */

import type { FullConfig } from "@playwright/test";
import bcrypt from "bcryptjs";
import { startMockLlmServer, MOCK_LLM_BASE_URL, MOCK_PROVIDER_ID, MOCK_MODEL_ID } from "./mock-llm-server.js";
import type { Server } from "node:http";

// Test-only fixture credentials
// oxlint-disable-next-line secure-coding/no-hardcoded-credentials
const TEST_PASSWORD = "test-password";
const TEST_USERNAME = "testuser";
const SALT_ROUNDS = 12;

// The mock LLM server uses a dummy API key; the server ignores it.
// oxlint-disable-next-line secure-coding/no-hardcoded-credentials
const MOCK_API_KEY = "sk-mock-key-for-e2e-tests";

/** Reference to the mock LLM server for cleanup. */
let mockServer: Server | undefined;

/**
 * Build the baseline SQL statements that seed the test database.
 *
 * This is the single source of truth for what a "clean" DB looks like.
 * Used both on initial setup (globalSetup) and after each test
 * (resetTestDb in givens.ts) to wipe and re-seed.
 *
 * @returns Array of SQL INSERT statements
 */
export function baselineSeedSql(): string[] {
    return [
        `INSERT OR REPLACE INTO auth (id, username, password_hash) VALUES (1, '${TEST_USERNAME}', '${TEST_PASSWORD_HASH}')`,
        `INSERT OR REPLACE INTO providers (provider, api_key, base_url, display_name, models_endpoint)
         VALUES ('${MOCK_PROVIDER_ID}', '${MOCK_API_KEY}', '${MOCK_LLM_BASE_URL}', 'Mock LLM', '${MOCK_LLM_BASE_URL}/models')`,
        `INSERT OR REPLACE INTO custom_models (id, provider, name, api, base_url, reasoning, input_types, context_window, max_tokens)
         VALUES ('${MOCK_MODEL_ID}', '${MOCK_PROVIDER_ID}', 'Mock Model', 'openai-completions', '${MOCK_LLM_BASE_URL}', 0, '["text"]', 128000, 16384)`,
    ];
}

/** The bcrypt hash of the test password, computed once at module load. */
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, SALT_ROUNDS);

/**
 * Playwright globalSetup hook. Starts the mock LLM server, seeds the
 * in-memory test database by sending SQL statements to the
 * /api/test/exec-sql endpoint, and registers cleanup.
 *
 * @param config - The resolved Playwright configuration
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
    const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5174";

    mockServer = startMockLlmServer();

    const statements = baselineSeedSql();

    const res = await fetch(`${baseURL}/api/test/exec-sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `Failed to seed test database (HTTP ${res.status}): ${text}\n` +
            "Make sure VESSEL_IN_MEMORY_DB=1 is set in the webServer command.",
        );
    }

    const result = (await res.json()) as { executed: number };
    console.log(
        `[globalSetup] Test database seeded: ${result.executed} statements executed`,
    );

    // Shut down mock server on test run end. Playwright's globalTeardown
    // isn't reliable across all scenarios, so we also handle signals.
    const cleanup = (): void => {
        if (mockServer) {
            mockServer.close();
            mockServer = undefined;
            console.log("[globalSetup] Mock LLM server shut down");
        }
    };

    process.on("exit", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
}

export { TEST_PASSWORD, TEST_USERNAME };
