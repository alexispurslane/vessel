/**
 * @file Shared action helpers for e2e chat tests.
 *
 * Reusable "when"-step primitives like sending a message and waiting
 * for the response, locating specific messages, hovering to reveal
 * action bars, and asserting message sequences.
 *
 * Import from spec files rather than duplicating these helpers.
 */

import { expect } from "./bdd";
import { sendChatMessage } from "./givens";
import type { Page, Locator, ConsoleMessage } from "@playwright/test";

/**
 * Wait for the assistant's response to finish streaming.
 *
 * Polls until the "Stop" button disappears (replaced by the
 * idle send button), indicating the model has finished generating.
 *
 * @param page - The Playwright Page fixture
 * @param timeoutMs - Maximum time to wait (default 30s)
 */
export async function waitForResponse(
    page: Page,
    timeoutMs = 30_000,
): Promise<void> {
    await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({
        timeout: timeoutMs,
    });
}

/**
 * Send a chat message and wait for the full agentic response to finish.
 *
 * If starting from the home page, also waits for navigation to /chat/.
 *
 * @param page - The Playwright Page fixture
 * @param message - The message text to send
 * @param timeoutMs - Maximum time to wait for streaming to finish
 */
export async function sendChatAndWait(
    page: Page,
    message: string,
    timeoutMs = 30_000,
): Promise<void> {
    const isHomePage = page.url().endsWith("/") || page.url().endsWith("");
    await sendChatMessage(page, message);
    if (isHomePage) {
        await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    }
    await waitForResponse(page, timeoutMs);
}

/**
 * Assert that no browser console errors were emitted during the test so far.
 *
 * Collects all `console.error` messages logged on the page and asserts the
 * list is empty. This is the baseline "no errors" check for happy-path
 * tests — it validates the *UI* didn't produce errors, not just the mock.
 *
 * @param _page - The Playwright Page fixture (unused, kept for API symmetry)
 * @param consoleErrors - The accumulated error list (captured via listener)
 */
export async function assertNoConsoleErrors(
    _page: Page,
    consoleErrors: string[],
): Promise<void> {
    const filtered = consoleErrors.filter(
        (msg) =>
            !msg.includes("[HMR]") &&
            !msg.includes("Download the React DevTools"),
    );
    expect(
        filtered,
        `Unexpected console errors: ${filtered.join("; ")}`,
    ).toEqual([]);
}

/**
 * Set up a console-error collector on the page.
 *
 * Returns the mutable array that will accumulate error messages.
 * Callers should pass this array to `assertNoConsoleErrors`.
 *
 * @param page - The Playwright Page fixture
 * @returns The array that will collect console error messages
 */
export function collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() === "error") {
            errors.push(msg.text());
        }
    });
    return errors;
}

/**
 * Verify an ordered sequence of chat message texts, skipping thinking
 * blocks and tool calls.
 *
 * Finds article elements with aria-label "You message" or
 * "Assistant message", scopes text reads to the `[id^='msg-']` content
 * div (to avoid matching thinking-section text), and asserts each
 * message's role and text against the expected sequence.
 *
 * Uses `[role='article'][aria-label]` rather than `article[aria-label]`
 * because chat messages are rendered as `<div role="article">` not
 * `<article>` elements.
 *
 * @param page - The Playwright Page fixture
 * @param expected - Ordered list of { role, text } entries.
 *   `role` is "user" or "assistant". `text` is a string (exact match)
 *   or RegExp (partial match via toContainText).
 */
export async function expectMessageSequence(
    page: Page,
    expected: Array<{ role: "user" | "assistant"; text: string | RegExp }>,
): Promise<void> {
    const roleIndex: Record<string, number> = { user: 0, assistant: 0 };

    for (let matchIdx = 0; matchIdx < expected.length; matchIdx++) {
        const expectedMsg = expected[matchIdx];
        const roleName = expectedMsg.role === "user" ? "You" : "Assistant";
        const ariaLabel = `${roleName} message`;
        const nth = roleIndex[expectedMsg.role]!;

        const articles = page.getByRole("article", { name: ariaLabel });
        await expect(async () => {
            const count = await articles.count();
            expect(
                count,
                `Expected at least ${nth + 1} "${ariaLabel}" article(s) for message ${matchIdx} but found ${count}`,
            ).toBeGreaterThanOrEqual(nth + 1);
        }).toPass({ timeout: 10_000 });

        const article = articles.nth(nth);

        const contentDiv = article.locator("[id^='msg-']");
        if (typeof expectedMsg.text === "string") {
            await expect(contentDiv).toContainText(expectedMsg.text);
        } else {
            await expect(contentDiv).toContainText(expectedMsg.text);
        }
        roleIndex[expectedMsg.role]!++;
    }
}

/**
 * Get a locator for the nth user message article.
 *
 * Uses ARIA role "article" with name "You message" to find
 * user messages in the chat log.
 *
 * @param page - The Playwright Page fixture
 * @param index - Zero-based index of the user message
 * @returns Locator for the user message article
 */
export function getUserMessage(page: Page, index = 0): Locator {
    return page.getByRole("article", { name: "You message" }).nth(index);
}

/**
 * Get a locator for the nth assistant message article.
 *
 * Uses ARIA role "article" with name "Assistant message" to find
 * assistant messages in the chat log.
 *
 * @param page - The Playwright Page fixture
 * @param index - Zero-based index of the assistant message
 * @returns Locator for the assistant message article
 */
export function getAssistantMessage(page: Page, index = 0): Locator {
    return page
        .getByRole("article", { name: "Assistant message" })
        .nth(index);
}

/**
 * Hover over a message to reveal its action bar.
 *
 * Action buttons (copy, edit, delete) are hidden by default and
 * shown on hover via the `group-hover/msg:opacity-100` CSS class.
 *
 * @param messageArticle - The locator for the message article element
 */
export async function hoverMessage(messageArticle: Locator): Promise<void> {
    await messageArticle.hover();
}
