import { TEST_PASSWORD, baselineSeedSql } from "./global-setup";
import type { Page } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** Base URL for the test dev server (matches playwright.config.ts). */
const BASE_URL = "http://localhost:5174";

/**
 * Log in as the test user and wait for the home page to load.
 *
 * Call this inside a `given` setup function to ensure the user
 * is authenticated before setting up the rest of the scenario.
 *
 * @param page - The Playwright Page fixture
 *
 * @example
 * ```ts
 * given("I am on the chat page", async ({ page }) => {
 *   await givenLoggedInUser(page);
 *   await page.getByRole("link", { name: /chat/i }).click();
 * }, ({ when }) => { ... });
 * ```
 */
export async function givenLoggedInUser(page: Page): Promise<void> {
    // Bypass the login UI — POST directly to the auth endpoint.
    // Faster than filling the form and avoids hydration timing issues.
    const res = await page.request.post("/api/auth/login", {
        data: { password: TEST_PASSWORD },
    });
    if (!res.ok()) {
        throw new Error(`Login failed (HTTP ${res.status()}): ${await res.text()}`);
    }
    // The session cookie is now stored in the browser context.
    // Navigate to the home page to verify auth and load the app.
    await page.goto("/");
}

/**
 * Type text into a CodeMirror editor.
 *
 * CodeMirror renders as a `<div role="textbox">` not a native input,
 * so Playwright's `fill()` won't work. Instead, click the editor to
 * focus it, then type via `pressSequentially` which simulates real
 * keypresses that CodeMirror's key handlers pick up.
 *
 * @param editor - The Playwright Locator for the CodeMirror textbox
 * @param text - The text to type into the editor
 */
export async function typeInCodeMirror(editor: Locator, text: string): Promise<void> {
    await editor.click();
    await editor.pressSequentially(text);
}

/**
 * Type a message into the chat input and click send.
 *
 * Handles the CodeMirror-based input that `fill()` can't target
 * directly, then clicks the send button.
 *
 * @param page - The Playwright Page fixture
 * @param text - The message text to send
 */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
    const input = page.getByRole("textbox", { name: /message/i });
    await typeInCodeMirror(input, text);
    await page.getByRole("button", { name: /send/i }).click();
}

/**
 * Check whether a file exists in the conversation's workspace.
 *
 * Uses the page's authenticated request context to call the workspace API.
 * Raw `fetch` won't work because the API requires authentication.
 *
 * @param page - The Playwright Page fixture (must be on a /chat/[id] page)
 * @param fileName - The relative file path to check for
 * @returns True if the file exists in the workspace
 */
export async function workspaceHasFile(page: Page, fileName: string): Promise<boolean> {
    const url = page.url();
    const conversationId = url.split("/chat/")[1]?.split("/")[0];
    if (!conversationId) return false;
    const res = await page.request.get(`http://localhost:5174/api/sessions/${conversationId}/workspace`);
    if (!res.ok) return false;
    const body = (await res.json()) as { files?: string[] };
    if (!body.files) return false;
    return body.files.includes(fileName);
}

/**
 * Execute SQL statements against the in-memory test database.
 *
 * Uses the `/api/test/exec-sql` endpoint (only available when
 * `VESSEL_IN_MEMORY_DB=1`). Each statement runs sequentially.
 *
 * **Use `INSERT OR REPLACE`** (not plain `INSERT`) so that parallel
 * test workers don't collide on duplicate primary keys. The DB is
 * shared across all workers, and `afterEach` cleanup only serializes
 * tests on the same worker — concurrent workers may both run the
 * same `beforeEach` setup simultaneously.
 *
 * @param statements - Array of SQL statements to execute
 *
 * @example
 * ```ts
 * given("I have a conversation", async ({ page }) => {
 *   await givenLoggedInUser(page);
 *   await seedSql([
 *     `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
 *      VALUES ('test-1', 'Test Chat', '/tmp/test.jsonl')`,
 *   ]);
 * }, ({ when }) => { ... });
 * ```
 */
export async function seedSql(statements: string[]): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/test/exec-sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`seedSql failed (HTTP ${res.status}): ${text}`);
    }
}

/**
 * Reset the in-memory test database to the baseline state.
 *
 * Deletes all rows from every table, then re-seeds with the baseline
 * data (auth user, mock LLM provider, mock model) from
 * `baselineSeedSql`. This is the single source of truth for what
 * a clean DB looks like.
 *
 * Called automatically by `given` in `afterEach` so each test
 * starts with a clean DB — no stale data leaks between scenarios.
 */
export async function resetTestDb(): Promise<void> {
    await seedSql([
        "DELETE FROM conversation_settings",
        "DELETE FROM tags",
        "DELETE FROM conversations",
        "DELETE FROM custom_models",
        "DELETE FROM providers",
        "DELETE FROM settings",
        "DELETE FROM auth",
        ...baselineSeedSql(),
    ]);
}
