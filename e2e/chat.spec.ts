// BDD helpers (when, then) are destructured from interfaces, not class methods
// oxlint-disable typescript/unbound-method
// BDD deeply nests given/when/then callbacks — disabling nesting rule for this file
// oxlint-disable max-nested-callbacks
// BDD test.describe blocks are inherently long — disabling line count rule for this file
// oxlint-disable max-lines-per-function

import { test, given, expect } from "./bdd";
import { givenLoggedInUser, seedSql, sendChatMessage, workspaceHasFile } from "./givens";
import { mockTurnPlan } from "./mock-llm-server.js";
import type { ConsoleMessage } from "@playwright/test";

// The in-memory SQLite DB is shared across all workers.
// afterEach in the BDD framework resets it, which would wipe data
// that other workers' tests still need. Serial mode prevents this.
test.describe("chat", () => {
  test.describe.configure({ mode: "serial" });

/**
 * Wait for the assistant's response to finish streaming.
 *
 * Polls until the "Stop" button disappears (replaced by the
 * idle send button), indicating the model has finished generating.
 *
 * @param page - The Playwright Page fixture
 * @param timeoutMs - Maximum time to wait (default 30s)
 */
async function waitForResponse(page: import("@playwright/test").Page, timeoutMs = 30_000): Promise<void> {
  // Stop button visible during generation; hidden when done
  await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: timeoutMs });
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
async function sendChatAndWait(page: import("@playwright/test").Page, message: string, timeoutMs = 30_000): Promise<void> {
  const isHomePage = page.url().endsWith("/") || page.url().endsWith("");
  await sendChatMessage(page, message);
  if (isHomePage) {
    // Wait for navigation from home page to /chat/[id]
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
  }
  await waitForResponse(page, timeoutMs);
}

/**
 * Assert that no browser console errors were emitted during the test so far.
 *
 * Collects all `console.error` messages logged on the page and asserts the
 * list is empty.  This is the baseline "no errors" check for happy-path
 * tests — it validates the *UI* didn't produce errors, not just the mock.
 *
 * @param _page - The Playwright Page fixture (unused, kept for API symmetry)
 * @param consoleErrors - The accumulated error list (captured via listener)
 */
async function assertNoConsoleErrors(
  _page: import("@playwright/test").Page,
  consoleErrors: string[],
): Promise<void> {
  // Ignore known benign noise from dev tools / HMR
  const filtered = consoleErrors.filter(
    (msg) =>
      !msg.includes("[HMR]") &&
      !msg.includes("Download the React DevTools"),
  );
  expect(filtered, `Unexpected console errors: ${filtered.join("; ")}`).toEqual([]);
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
function collectConsoleErrors(page: import("@playwright/test").Page): string[] {
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
async function expectMessageSequence(
  page: import("@playwright/test").Page,
  expected: Array<{ role: "user" | "assistant"; text: string | RegExp }>,
): Promise<void> {
  // Track how many of each role we've matched so far for .nth() selection
  const roleIndex: Record<string, number> = { user: 0, assistant: 0 };

  for (let matchIdx = 0; matchIdx < expected.length; matchIdx++) {
    const expectedMsg = expected[matchIdx];
    const roleName = expectedMsg.role === "user" ? "You" : "Assistant";
    const ariaLabel = `${roleName} message`;
    const nth = roleIndex[expectedMsg.role]!;

    // Use getByRole for ARIA-aware matching (handles <div role="article">)
    const articles = page.getByRole("article", { name: ariaLabel });
    // Wait for at least nth+1 articles to exist
    await expect(async () => {
      const count = await articles.count();
      expect(
        count,
        `Expected at least ${nth + 1} "${ariaLabel}" article(s) for message ${matchIdx} but found ${count}`,
      ).toBeGreaterThanOrEqual(nth + 1);
    }).toPass({ timeout: 10_000 });

    const article = articles.nth(nth);

    // Scope text check to the [id^='msg-'] div to avoid thinking-section text
    const contentDiv = article.locator("[id^='msg-']");
    if (typeof expectedMsg.text === "string") {
      await expect(contentDiv).toContainText(expectedMsg.text);
    } else {
      await expect(contentDiv).toContainText(expectedMsg.text);
    }
    roleIndex[expectedMsg.role]!++;
  }
}

given("I am on the home page", async ({ page }) => {
    await givenLoggedInUser(page);
}, ({ when }) => {
  when("I send a message asking the mock LLM to write a file", async ({ page }) => {
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "write", arguments: { path: "greeting.txt", content: "Hello from mock LLM!" } }] },
        { text: true },
      ],
    }));
  }, async ({ then }) => {
    await then("I am taken to a chat page", async ({ page }) => {
      await expect(page).toHaveURL(/\/chat\//);
    });

    await then("the mock LLM tool call created the file in the workspace", async ({ page }) => {
      await expect.poll(() => workspaceHasFile(page, "greeting.txt")).toBe(true);
    });

    await then("the file appears as a sandbox file chip in the input area", async ({ page }) => {
      await expect(page.getByRole("button", { name: /download.*greeting\.txt/i })).toBeVisible({ timeout: 5_000 });
    });
  });
});

given("I have a conversation with messages in the sidebar", async ({ page }) => {
    await givenLoggedInUser(page);
    await sendChatAndWait(page, mockTurnPlan({
      turns: [{ text: true }],
    }));
}, ({ when }) => {
  when("I view the conversation messages", async ({ page: _page }) => {
    // No action needed — we're still on the chat page from the given
  }, async ({ then }) => {
    await then("the user and assistant messages are visible with correct text", async ({ page }) => {
      await expectMessageSequence(page, [
        { role: "user", text: /"turns"/ },
        { role: "assistant", text: /[a-z]{4,}/i },
      ]);
    });
  });
});

given("I am on the home page with the sidebar open", async ({ page }) => {
    await givenLoggedInUser(page);
}, ({ when }) => {
  when("I view the sidebar", async ({ page: _page }) => {
    // No action needed — sidebar starts expanded by default
  }, async ({ then }) => {
    await then("the sidebar is visible and expanded", async ({ page }) => {
      const sidebar = page.locator('[data-slot="sidebar"]');
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
    });

    await then("the toggle button is accessible", async ({ page }) => {
      const trigger = page.locator('[data-slot="sidebar-trigger"]');
      await expect(trigger).toBeVisible();
    });
  });
});

given("I am on a chat page with sandbox on", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message asking the mock LLM to run bash commands via sandbox", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "ls" } }] },
        { tools: [{ name: "bash", arguments: { command: "whoami" } }] },
        { tools: [{ name: "bash", arguments: { command: "pwd" } }] },
        { text: true },
      ],
    }));
    // Store for later assertion
    (page as unknown as Record<string, string[]>).__consoleErrors = consoleErrors;
  }, async ({ then }) => {
    await then("I am on a chat page", async ({ page }) => {
      await expect(page).toHaveURL(/\/chat\//);
    });

    await then("the bash tool calls appear in the chat", async ({ page }) => {
      // Each bash command should appear as a tool call inside the thinking group
      const chatMessages = page.getByRole("log", { name: /chat messages/i });
      await expect(chatMessages).toBeVisible();

      // Tool calls live inside the thinking group — scope locators there
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const bashToolCalls = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashToolCalls).toHaveCount(3);
    });

    await then("each bash tool call shows its command argument", async ({ page }) => {
      // Expand the thinking group by clicking its summary
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const groupSummary = thinkingGroup.locator("summary").first();
      await groupSummary.click();

      // Verify each bash tool call within the thinking group contains its command
      const bashCalls = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashCalls.filter({ hasText: /ls/ }).first()).toBeVisible();
      await expect(bashCalls.filter({ hasText: /whoami/ }).first()).toBeVisible();
      await expect(bashCalls.filter({ hasText: /pwd/ }).first()).toBeVisible();
    });

    await then("no bash tool calls show error status or error output", async ({ page }) => {
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const bashCalls = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      const count = await bashCalls.count();
      for (let i = 0; i < count; i++) {
        // Verify status via data-status attribute, not aria-label format
        const summary = bashCalls.nth(i).locator("summary").first();
        await expect(summary).toHaveAttribute("data-status", "completed");
        // Expand and check output region for error text
        await bashCalls.nth(i).evaluate((el: HTMLDetailsElement) => { el.open = true; });
        const output = bashCalls.nth(i).getByRole("region", { name: /tool call output/i });
        await expect(output).not.toContainText(
          /error|fail|not found|permission denied|denied|fatal|exception|panic/i,
        );
      }
    });

    await then("the assistant's final text response is visible", async ({ page }) => {
      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = (page as unknown as Record<string, string[]>).__consoleErrors;
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

given("I am on a chat page with a multi-turn thinking/toolcall plan", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message that triggers thinking-toolcall-thinking-toolcall sequences", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        // Turn 1: thinking + tool call (no text)
        { tools: [{ name: "bash", arguments: { command: "echo step1" } }] },
        // Turn 2: thinking + tool call (no text)
        { tools: [{ name: "bash", arguments: { command: "echo step2" } }] },
        // Turn 3: thinking + text (final)
        { text: true },
      ],
    }));
    (page as unknown as Record<string, string[]>).__consoleErrors = consoleErrors;
  }, async ({ then }) => {
    await then("consecutive thinking/toolcall turns are grouped into a single block", async ({ page }) => {
      // The thinking group renders with a summary containing "tool calls"
      const thinkingGroup = page.getByTestId("thinking-group").first();
      await expect(thinkingGroup).toBeVisible();
      await expect(thinkingGroup).toContainText(/tool calls/);
    });

    await then("the grouped block contains interleaved thinking and tool calls", async ({ page }) => {
      // Expand the group by clicking its summary
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const groupSummary = thinkingGroup.locator("summary").first();
      await groupSummary.click();

      // Both bash tool calls should be visible inside the group
      const bashCalls = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashCalls).toHaveCount(2);
    });

    await then("the final text response appears separately after the group", async ({ page }) => {
      // Collapse the thinking group so its content is hidden —
      // this proves the final message is outside the group.
      const thinkingGroup = page.getByTestId("thinking-group").first();
      await thinkingGroup.evaluate((el: HTMLElement) => {
        const details = el.querySelector("details");
        if (details) details.open = false;
      });

      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = (page as unknown as Record<string, string[]>).__consoleErrors;
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

given("I am on a chat page and the model responds with no tool calls", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a plain text message", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    // A plain text message (not a mockTurnPlan JSON) causes the mock
    // LLM to respond with text-only (no tool calls)
    await sendChatAndWait(page, "Hello, just having a conversation!");
    (page as unknown as Record<string, string[]>).__consoleErrors = consoleErrors;
  }, async ({ then }) => {
    await then("I see the model's text response", async ({ page }) => {
      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });

    await then("the response includes a thinking block", async ({ page }) => {
      // Mock LLM always emits thinking before text.
      // For text-only turns it appears as a details/summary on the assistant message.
      const thinkingSummary = page.locator("summary").filter({ hasText: /thought/i });
      await expect(thinkingSummary).toBeVisible();
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = (page as unknown as Record<string, string[]>).__consoleErrors;
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

given("I am on a chat page and send a message requiring tool calls", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message that triggers tool calls and a final response", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "echo hello" } }], text: true },
        { text: true },
      ],
    }));
    (page as unknown as Record<string, string[]>).__consoleErrors = consoleErrors;
  }, async ({ then }) => {
    await then("the tool calls are visible in the chat", async ({ page }) => {
      // When a turn has both tools AND text, the tool calls appear on the
      // message itself rather than inside a thinking group.
      const bashToolCall = page.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashToolCall).toBeVisible();
    });

    await then("the assistant's final text response is visible", async ({ page }) => {
      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });

    await then("the response includes a thinking block", async ({ page }) => {
      // When the first turn has both text and tool calls,
      // the thinking block is on the assistant message itself.
      const thinkingSummary = page.locator("summary").filter({ hasText: /thought/i });
      await expect(thinkingSummary.first()).toBeVisible();
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = (page as unknown as Record<string, string[]>).__consoleErrors;
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

given("I am on an existing chat page", async ({ page }) => {
    await givenLoggedInUser(page);
    await seedSql([
      `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
       VALUES ('test-conv-home', 'Home Nav Test', '/tmp/test-home.jsonl')`,
    ]);
    // Navigate via sidebar click instead of direct URL to avoid
    // ERR_ABORTED from missing session files
    const convButton = page.getByRole("button", { name: /home nav test/i }).first();
    await convButton.click();
    await expect(page).toHaveURL(/\/chat\//);
}, ({ when }) => {
  when("I click the home/new-chat button in the sidebar", async ({ page }) => {
    // The "Vessel" button in the sidebar header navigates to home / new chat.
    // Its accessible name includes both the img alt and visible text.
    const homeButton = page.getByRole("button", { name: /vessel/i }).first();
    await homeButton.click();
  }, async ({ then }) => {
    await then("I am taken to the home page", async ({ page }) => {
      await expect(page).toHaveURL("/", { timeout: 10_000 });
    });

    await then("I can start a new conversation from the home page", async ({ page }) => {
      await sendChatAndWait(page, "A new conversation!");
      await expect(page).toHaveURL(/\/chat\//);
      await expect(page.getByRole("article", { name: /assistant message/i }).last()).toBeVisible();
    });
  });
});

given("I have multiple conversations in the sidebar", async ({ page }) => {
    await givenLoggedInUser(page);
    await seedSql([
        `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
         VALUES ('test-conv-a', 'Conversation Alpha', '/tmp/test-a.jsonl')`,
        `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
         VALUES ('test-conv-b', 'Conversation Beta', '/tmp/test-b.jsonl')`,
    ]);
}, ({ when }) => {
  when("I click on one conversation in the sidebar", async ({ page }) => {
    const convAlpha = page.getByRole("button", { name: /conversation alpha/i }).first();
    await convAlpha.click();
  }, async ({ then }) => {
    await then("the first conversation loads", async ({ page }) => {
      await expect(page).toHaveURL(/\/chat\/test-conv-a/);
      await expect(page.getByRole("region", { name: /chat/i })).toBeVisible();
    });

    await then("I can switch to the other conversation", async ({ page }) => {
      const convBeta = page.getByRole("button", { name: /conversation beta/i }).first();
      await convBeta.click();
      await expect(page).toHaveURL(/\/chat\/test-conv-b/);
      await expect(page.getByRole("region", { name: /chat/i })).toBeVisible();
    });

    await then("I can switch back to the first conversation", async ({ page }) => {
      const convAlpha = page.getByRole("button", { name: /conversation alpha/i }).first();
      await convAlpha.click();
      await expect(page).toHaveURL(/\/chat\/test-conv-a/);
    });
  });
});

// Test: Stop / Abort during generation (ESC key + Stop button)
given("I am on a chat page and the model starts generating", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I press Escape while the model is streaming", async ({ page }) => {
    // Start a multi-turn plan that takes time (bash + text)
    await sendChatMessage(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "sleep 5" } }] },
        { text: true },
      ],
    }));
    // Wait for navigation and generation to start
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 10_000 });
    // Press Escape to abort
    await page.keyboard.press("Escape");
  }, async ({ then }) => {
    await then("the Stop button disappears", async ({ page }) => {
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 5_000 });
    });

    await then("the send button becomes visible again", async ({ page }) => {
      await expect(page.getByRole("button", { name: /send message/i })).toBeVisible();
    });
  });

  when("I click the Stop button while the model is streaming", async ({ page }) => {
    await sendChatMessage(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "sleep 5" } }] },
        { text: true },
      ],
    }));
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /stop/i }).click();
  }, async ({ then }) => {
    await then("generation stops and the send button returns", async ({ page }) => {
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 5_000 });
      await expect(page.getByRole("button", { name: /send message/i })).toBeVisible();
    });
  });
});
// Test: Stream recovery — reload mid-stream restores the in-flight message
//
// Every scenario follows the same invariant:
//   The in-flight streaming message survives a page reload.
//   Its partial content (text, thinking, or tool call) is restored
//   and new content continues arriving until completion.
//
// We always confirm we ARE mid-stream (Stop button visible)
// before capturing partial content and reloading.

given("I am on a chat page and the model is streaming a long text response", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I reload the page while text is still streaming", async ({ page }) => {
    await sendChatMessage(page, mockTurnPlan({
      turns: [{ text: true, textParagraphs: 40 }],
      chunkDelayMs: 50,
    }));
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    // Confirm we ARE mid-stream
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 10_000 });
    // Capture partial text from the in-flight assistant message
    const assistantMsg = page.getByRole("article", { name: /assistant message/i }).first();
    const contentDiv = assistantMsg.locator("[id^='msg-']");
    await expect(contentDiv).not.toBeEmpty({ timeout: 10_000 });
    const partial = await contentDiv.innerText();
    expect(partial.length, "Expected text before reload").toBeGreaterThan(10);
    (page as unknown as Record<string, string>).__partial = partial;

    await page.reload();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
  }, async ({ then }) => {
    await then("the pre-reload partial text is restored after recovery", async ({ page }) => {
      const partial = (page as unknown as Record<string, string>).__partial;
      const assistantMsg = page.getByRole("article", { name: /assistant message/i }).first();
      await expect(assistantMsg).toBeVisible({ timeout: 15_000 });
      const contentDiv = assistantMsg.locator("[id^='msg-']");
      await expect.poll(async () => {
        const current = await contentDiv.innerText();
        return current.includes(partial);
      }, { timeout: 15_000 }).toBe(true);
    });

    await then("streaming resumes and more text is appended", async ({ page }) => {
      // Stop button reappearing confirms stream_recovery reconnected
      await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 60_000 });
      const assistantMsg = page.getByRole("article", { name: /assistant message/i }).first();
      const contentDiv = assistantMsg.locator("[id^='msg-']");
      const final = await contentDiv.innerText();
      const partial = (page as unknown as Record<string, string>).__partial;
      expect(final.length,
        "Expected more text after recovery than before reload",
      ).toBeGreaterThan(partial.length);
    });
  });

  when("I reload the page while the thinking block is still streaming", async ({ page }) => {
    await sendChatMessage(page, mockTurnPlan({
      turns: [{ text: true, thinkingParagraphs: 30 }],
      chunkDelayMs: 50,
    }));
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    // Confirm we ARE mid-stream
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 10_000 });
    // While thinking is streaming (no text yet), the thinking section
    // appears inside a thinking-group, not in the assistant article.
    const thinkingGroup = page.getByTestId("thinking-group").first();
    await expect(thinkingGroup).toBeAttached({ timeout: 10_000 });
    // Expand the thinking group to access the thinking content
    await thinkingGroup.locator("summary").first().click();
    // Find the thinking step inside the group — it has a summary
    // labeled "Thinking in progress" or "Thinking..."
    const thinkingDetails = thinkingGroup.locator("details").filter({ has: page.locator("summary").filter({ hasText: /thinking/i }) }).first();
    await expect(thinkingDetails).toBeAttached({ timeout: 10_000 });
    // Expand the thinking details
    await thinkingDetails.evaluate((el: HTMLDetailsElement) => { el.open = true; });
    // Read partial thinking content
    const thinkingContent = thinkingDetails.locator(".markdown-thinking");
    await expect(thinkingContent.first()).not.toBeEmpty({ timeout: 10_000 });
    const partial = await thinkingContent.first().innerText();
    expect(partial.length, "Expected thinking text before reload").toBeGreaterThan(5);
    (page as unknown as Record<string, string>).__partial = partial;

    await page.reload();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
  }, async ({ then }) => {
    await then("the pre-reload partial thinking text is restored", async ({ page }) => {
      const partial = (page as unknown as Record<string, string>).__partial;
      const thinkingGroup = page.getByTestId("thinking-group").first();
      await expect(thinkingGroup).toBeAttached({ timeout: 15_000 });
      // Expand the thinking group
      await thinkingGroup.locator("summary").first().click();
      // Find and expand the thinking details inside
      const thinkingDetails = thinkingGroup.locator("details").filter({ has: page.locator("summary").filter({ hasText: /thinking/i }) }).first();
      await expect(thinkingDetails).toBeAttached({ timeout: 15_000 });
      await thinkingDetails.evaluate((el: HTMLDetailsElement) => { el.open = true; });
      const thinkingContent = thinkingDetails.locator(".markdown-thinking");
      await expect.poll(async () => {
        const current = await thinkingContent.first().innerText();
        return current.includes(partial);
      }, { timeout: 15_000 }).toBe(true);
    });

    await then("generation completes", async ({ page }) => {
      // Stop button reappearing confirms stream_recovery reconnected
      await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 60_000 });
    });
  });
});
// Test: Stream recovery — reload mid-tool-call
//
// Tool calls execute server-side (e.g. bash sleep 10), giving us a
// long window where the tool is "running". Reloading during that
// window must restore the running tool call via stream_recovery.

given("I am on a chat page and the model is executing a slow tool call", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I reload the page while the tool call is still running", async ({ page }) => {
    await sendChatMessage(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "sleep 10" } }] },
        { text: true },
      ],
      chunkDelayMs: 50,
    }));
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    // Confirm we ARE mid-stream
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 15_000 });
    // Wait for the bash tool call to appear and confirm it's running
    const thinkingGroup = page.getByTestId("thinking-group").first();
    await thinkingGroup.locator("summary").first().click();
    const bashCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
    await expect(bashCall.first()).toBeAttached({ timeout: 10_000 });
    const bashSummary = bashCall.first().locator("summary").first();
    await expect(bashSummary).toHaveAttribute("data-status", "running", { timeout: 10_000 });
    // Capture the tool call's partial state
    const partial = await bashSummary.innerText();
    (page as unknown as Record<string, string>).__partial = partial;

    await page.reload();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
  }, async ({ then }) => {
    await then("the pre-reload tool call is restored with its arguments", async ({ page }) => {
      const thinkingGroup = page.getByTestId("thinking-group").first();
      await expect(thinkingGroup).toBeAttached({ timeout: 15_000 });
      await thinkingGroup.locator("summary").first().click();
      const bashCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashCall.first()).toBeAttached({ timeout: 15_000 });
      const bashSummary = bashCall.first().locator("summary").first();
      await expect(bashSummary).toContainText(/sleep\s*10/);
    });

    await then("streaming resumes", async ({ page }) => {
      // Stop button reappearing confirms stream_recovery reconnected
      await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 15_000 });
    });

    await then("generation completes", async ({ page }) => {
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: /send message/i })).toBeVisible();
    });
  });

  when("I reload multiple times while the tool call is still running", async ({ page }) => {
    await sendChatMessage(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "sleep 30" } }] },
        { text: true },
      ],
      chunkDelayMs: 50,
    }));
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeVisible({ timeout: 15_000 });
    // Wait for the tool call to appear and confirm it's running
    const thinkingGroup = page.getByTestId("thinking-group").first();
    await thinkingGroup.locator("summary").first().click();
    const bashCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
    await expect(bashCall.first()).toBeAttached({ timeout: 10_000 });
    const bashSummary = bashCall.first().locator("summary").first();
    await expect(bashSummary).toHaveAttribute("data-status", "running", { timeout: 10_000 });
    const partial = await bashSummary.innerText();
    (page as unknown as Record<string, string>).__partial = partial;

    // First reload
    await page.reload();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    // After recovery, confirm the tool call was restored
    const tg1 = page.getByTestId("thinking-group").first();
    await expect(tg1).toBeAttached({ timeout: 15_000 });
    await tg1.locator("summary").first().click();
    const bc1 = tg1.locator('[data-testid="tool-call"][data-tool-name="bash"]');
    await expect(bc1.first()).toBeAttached({ timeout: 15_000 });
    await expect(bc1.first().locator("summary").first()).toContainText(/sleep\s*30/);
    // Check if we're still mid-stream before second reload
    const stopBtn = page.getByRole("button", { name: /stop/i });
    const stillStreaming = await stopBtn.isVisible().catch(() => false);
    if (stillStreaming) {
      // Second reload while still generating
      await page.reload();
      await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    }
    (page as unknown as Record<string, boolean>).__didSecondReload = stillStreaming;
  }, async ({ then }) => {
    await then("the tool call is still present after multiple reloads", async ({ page }) => {
      const thinkingGroup = page.getByTestId("thinking-group").first();
      await expect(thinkingGroup).toBeAttached({ timeout: 15_000 });
      await thinkingGroup.locator("summary").first().click();
      const bashCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="bash"]');
      await expect(bashCall.first()).toBeAttached({ timeout: 15_000 });
      await expect(bashCall.first().locator("summary").first()).toContainText(/sleep\s*30/);
    });

    await then("generation eventually completes", async ({ page }) => {
      await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 60_000 });
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await page.waitForTimeout(500);
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

// Test: Draft persistence / restoration banner
given("I am on a chat page and have typed a message without sending", async ({ page }) => {
    await givenLoggedInUser(page);
    // Navigate to an actual /chat/[id] page first
    await sendChatAndWait(page, "Hello!");
    // Now type text but don't send — use pressSequentially for CodeMirror
    const input = page.getByRole("textbox", { name: /message/i });
    await input.click();
    await input.pressSequentially("My draft message");
    // Wait for the draft to be persisted by polling the input text.
    // CodeMirror is a <div>, not a native input, so use innerText().
    await expect.poll(async () => {
      const val = await input.innerText();
      return val.includes("My draft message");
    }, { timeout: 3_000 }).toBe(true);
}, ({ when }) => {
  when("I reload the page", async ({ page }) => {
    await page.reload();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
    // Wait for the draft restoration to complete by polling the input text
    await expect.poll(async () => {
      const input = page.getByRole("textbox", { name: /message/i });
      const val = await input.innerText();
      return val.includes("My draft message");
    }, { timeout: 10_000 }).toBe(true);
  }, async ({ then }) => {
    await then("the draft text is restored in the input", async ({ page }) => {
      const input = page.getByRole("textbox", { name: /message/i });
      await expect(input).toContainText("My draft message");
    });

    await then("the draft is cleared after sending", async ({ page }) => {
      // Send the restored draft to verify it clears properly
      await page.getByRole("button", { name: /send message/i }).click();
      // After sending, the draft text should no longer be in the input
      const input = page.getByRole("textbox", { name: /message/i });
      await expect.poll(async () => {
        const val = await input.innerText();
        return !val.includes("My draft message");
      }, { timeout: 5_000 }).toBe(true);
    });
  });
});

// Test: Connection status indicator
given("I am on a connected chat page", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
    // Send a message to establish a stable connected state
    await sendChatAndWait(page, "Hello!");
}, ({ when }) => {
  when("I view the connection status area", async ({ page: _page }) => {
    // No action needed — just check the status after connection
  }, async ({ then }) => {
    await then("the Connecting indicator is not shown when connected", async ({ page }) => {
      const statusContainer = page.getByTestId("connection-status");
      // The container exists but renders no children when connected
      await expect(statusContainer).toBeVisible();
      await expect(statusContainer).toBeEmpty();
    });

    await then("no error message is displayed", async ({ page }) => {
      // The error paragraph uses role="alert" for accessibility
      await expect(page.getByRole("alert")).toBeHidden();
    });
  });
});

// Test: Empty state placeholder
given("I am on a new chat page with no messages", async ({ page }) => {
    await givenLoggedInUser(page);
    // Navigate to /chat/[id] to see the empty state (home page has its own layout).
    // Use sidebar click to avoid ERR_ABORTED from missing session files.
    await seedSql([
      `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
       VALUES ('empty-test', 'Empty Chat', '/tmp/empty-test.jsonl')`,
    ]);
    // Navigate via sidebar click
    const convButton = page.getByRole("button", { name: /empty chat/i }).first();
    await convButton.click();
    // Wait for the chat area to render
    await expect(page.getByRole("log", { name: /chat messages/i })).toBeVisible({ timeout: 10_000 });
}, ({ when }) => {
  when("I view the chat area before sending any messages", async ({ page: _page }) => {
    // No action needed — the empty state should already be visible
  }, async ({ then }) => {
    await then("the empty state placeholder is shown", async ({ page }) => {
      // The empty state has data-testid="empty-chat-state" and role="status"
      const emptyState = page.getByTestId("empty-chat-state");
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toContainText(/start a conversation/i);
    });

    await then("the empty state indicates no messages yet", async ({ page }) => {
      // The empty state container has aria-label="No messages yet"
      const emptyState = page.getByTestId("empty-chat-state").locator("[aria-label='No messages yet']");
      await expect(emptyState).toBeVisible();
    });
  });
});

// Test: Side panel toggling (Security, History, Agent)
/**
 * Helper to show the auto-hiding top bar on desktop.
 * Polls for the top bar's data-testid to appear instead of using
 * waitForTimeout.
 *
 * @param page - The Playwright Page fixture
 */
async function showTopBarHelper(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector("[aria-label='Chat']");
    if (el) {
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    }
  });
  // Wait for the top bar to become visible instead of a fixed timeout
  await expect(page.getByTestId("chat-top-bar")).toBeVisible({ timeout: 2_000 });
}

given("I am on a chat page with messages and the top bar visible", async ({ page }) => {
    await givenLoggedInUser(page);
    await sendChatAndWait(page, "Hello!");
    // Force the top bar visible by triggering the mousemove handler
    await showTopBarHelper(page);
}, ({ when }) => {
  when("I click the Security panel toggle", async ({ page }) => {
    // The top bar auto-hides; move mouse to top area to reveal it first
    await showTopBarHelper(page);
    // Use accessible name to find the Security toggle button
    const securityBtn = page.getByRole("button", { name: /toggle security panel/i });
    await securityBtn.click({ timeout: 5_000 });
  }, async ({ then }) => {
    await then("the Security side panel opens", async ({ page }) => {
      // The panel header text appears inside the resizable pane group
      const paneGroup = page.locator('[data-slot="resizable-pane-group"]');
      await expect(paneGroup.getByText('Security', { exact: true })).toBeVisible();
    });

    await then("clicking the toggle again closes the panel", async ({ page }) => {
      await showTopBarHelper(page);
      const securityBtn = page.getByRole("button", { name: /toggle security panel/i });
      await securityBtn.click({ timeout: 5_000 });
      // The panel header should be gone — the entire pane is removed from the DOM
      const paneGroup = page.locator('[data-slot="resizable-pane-group"]');
      await expect(paneGroup.getByText('Security', { exact: true })).toBeHidden({ timeout: 3_000 });
    });
  });

  when("I click the History panel toggle", async ({ page }) => {
    // Move mouse to top area to show the auto-hiding top bar
    await showTopBarHelper(page);
    const historyBtn = page.getByRole("button", { name: /open history view|close history view/i });
    await historyBtn.click({ timeout: 5_000 });
  }, async ({ then }) => {
    await then("the History/DAG side panel opens", async ({ page }) => {
      const paneGroup = page.locator('[data-slot="resizable-pane-group"]');
      await expect(paneGroup.getByText('History', { exact: true })).toBeVisible();
    });
  });

  when("I click the Agent info panel toggle", async ({ page }) => {
    // Move mouse to top area to show the auto-hiding top bar
    await showTopBarHelper(page);
    const agentBtn = page.getByRole("button", { name: /toggle agent info panel/i });
    await agentBtn.click({ timeout: 5_000 });
  }, async ({ then }) => {
    await then("the Agent info side panel opens", async ({ page }) => {
      const paneGroup = page.locator('[data-slot="resizable-pane-group"]');
      await expect(paneGroup.getByText('Agent Info', { exact: true })).toBeVisible();
    });
  });
});

// Test: Export dropdown
given("I am on a chat page with messages for export testing", async ({ page }) => {
    await givenLoggedInUser(page);
    await sendChatAndWait(page, "Hello!");
}, ({ when }) => {
  when("I click the Export button", async ({ page }) => {
    // Move mouse to ensure top bar is visible
    await showTopBarHelper(page);
    await page.getByRole("button", { name: /export conversation/i }).click();
  }, async ({ then }) => {
    await then("the export dropdown is visible with format options", async ({ page }) => {
      await expect(page.getByRole("menuitem", { name: /pdf/i })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /markdown/i })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /json/i })).toBeVisible();
    });

    await then("the export options include thinking and tool call toggles", async ({ page }) => {
      await expect(page.getByRole("menuitemcheckbox", { name: /include thinking/i })).toBeVisible();
      await expect(page.getByRole("menuitemcheckbox", { name: /include tool calls/i })).toBeVisible();
    });
  });
});

// Test: Write + Read tool call roundtrip
given("I am on a chat page and ask the model to write then read a file", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message that triggers a write then read tool call", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "write", arguments: { path: "test-read.txt", content: "Read me!" } }] },
        { tools: [{ name: "read", arguments: { path: "test-read.txt" } }] },
        { text: true },
      ],
    }));
    (page as unknown as Record<string, string[]>).__consoleErrors = consoleErrors;
  }, async ({ then }) => {
    await then("the write and read tool calls are in the thinking group", async ({ page }) => {
      // Expand the thinking group by clicking its summary
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const groupSummary = thinkingGroup.locator("summary").first();
      await groupSummary.click();

      const writeToolCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="write"]');
      await expect(writeToolCall).toBeVisible();
      const readToolCall = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="read"]');
      await expect(readToolCall).toBeVisible();
    });

    await then("both tool calls show Completed status", async ({ page }) => {
      // Use data-status attribute instead of parsing aria-label
      const thinkingGroup = page.getByTestId("thinking-group").first();
      const writeSummary = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="write"]').locator("summary").first();
      await expect(writeSummary).toHaveAttribute("data-status", "completed");
      const readSummary = thinkingGroup.locator('[data-testid="tool-call"][data-tool-name="read"]').locator("summary").first();
      await expect(readSummary).toHaveAttribute("data-status", "completed");
    });

    await then("the file exists in the workspace", async ({ page }) => {
      await expect.poll(() => workspaceHasFile(page, "test-read.txt")).toBe(true);
    });

    await then("no console errors were produced", async ({ page }) => {
      const consoleErrors = (page as unknown as Record<string, string[]>).__consoleErrors;
      await assertNoConsoleErrors(page, consoleErrors);
    });
  });
});

// Test: Fork-here indicator between messages
given("I am on a chat page with multiple messages", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "echo hi" } }] },
        { text: true },
      ],
    }));
}, ({ when }) => {
  when("I hover between two messages", async ({ page }) => {
    const forkZone = page.getByTestId("fork-here-zone").first();
    // Before hover, the zone is collapsed (data-active is falsy)
    await expect(forkZone).toHaveAttribute("data-active", "false");
    await forkZone.hover();
  }, async ({ then }) => {
    await then("the fork-here indicator expands and shows the fork label", async ({ page }) => {
      const forkZone = page.getByTestId("fork-here-zone").first();
      // Hovering sets data-active="true" and reveals the label
      await expect(forkZone).toHaveAttribute("data-active", "true");
      await expect(forkZone).toContainText(/fork conversation here/i);
    });
  });
});

// Test: Context usage ring and token counters
given("I am on a chat page with a completed conversation and the top bar visible", async ({ page }) => {
    await givenLoggedInUser(page);
    await sendChatAndWait(page, "Hello!");
    await showTopBarHelper(page);
}, ({ when }) => {
  when("I view the top bar stats", async ({ page }) => {
    // Ensure the top bar is visible
    await showTopBarHelper(page);
  }, async ({ then }) => {
    await then("the context usage ring is visible", async ({ page }) => {
      // The context usage ring has aria-label="Context usage ring"
      const ring = page.locator("[aria-label='Context usage ring']");
      await expect(ring).toBeVisible();
    });

    await then("input and output token count elements are displayed", async ({ page }) => {
      // Token counters use aria-labels for identification
      const inputTokens = page.locator("[aria-label='Input tokens']");
      await expect(inputTokens).toBeVisible();
      const outputTokens = page.locator("[aria-label='Output tokens']");
      await expect(outputTokens).toBeVisible();
    });
  });
});

// Test: Page title reflects conversation title
given("I am on a chat page with a titled conversation", async ({ page }) => {
    await givenLoggedInUser(page);
    await seedSql([
      `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
       VALUES ('title-test', 'My Project Chat', '/tmp/test-title.jsonl')`,
    ]);
    const convButton = page.getByRole("button", { name: /my project chat/i }).first();
    await convButton.click();
    // Wait for the page to load by polling the title
    await expect.poll(() => page.title(), { timeout: 10_000 }).toMatch(/vessel/i);
}, ({ when }) => {
  when("I view the browser tab title", async ({ page: _page }) => {
    // No action needed — just check the title
  }, async ({ then }) => {
    await then("the page title includes Vessel and the conversation title", async ({ page }) => {
      await expect(page).toHaveTitle(/vessel.*my project chat/i);
    });
  });
});

// Test: Accessibility — aria-live announcements
given("I am on a chat page", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message and wait for the response", async ({ page }) => {
    await sendChatAndWait(page, "Hello!");
  }, async ({ then }) => {
    await then("an aria-live region announces the assistant response", async ({ page }) => {
      // The AriaLiveRegion component has aria-live="polite" and aria-atomic="true"
      const liveRegion = page.locator("[aria-live='polite'][aria-atomic='true']").first();
      await expect(liveRegion).toContainText(/assistant responded/i);
    });
  });

  when("I send a message that triggers a tool call", async ({ page }) => {
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "echo hello" } }] },
        { text: true },
      ],
    }));
  }, async ({ then }) => {
    await then("the aria-live region announces tool call completion", async ({ page }) => {
      const liveRegion = page.locator("[aria-live='polite'][aria-atomic='true']").first();
      await expect(liveRegion).toContainText(/completed/i);
    });
  });
});

// Test: Sandbox file removal
given("I am on a chat page with a file in the sandbox", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "write", arguments: { path: "deleteme.txt", content: "bye" } }] },
        { text: true },
      ],
    }));
}, ({ when }) => {
  when("I remove the file from the sandbox", async ({ page }) => {
    // The sandbox file chip has a remove button with aria-label
    const removeBtn = page.getByRole("button", { name: /remove.*deleteme/i });
    await expect(removeBtn).toBeVisible({ timeout: 5_000 });
    await removeBtn.click();
  }, async ({ then }) => {
    await then("the file is removed from the sandbox file list", async ({ page }) => {
      await expect.poll(() => workspaceHasFile(page, "deleteme.txt")).toBe(false);
    });

    await then("the file chip disappears from the input area", async ({ page }) => {
      // The download chip for deleteme.txt should be gone
      await expect(page.getByRole("button", { name: /download.*deleteme/i })).toBeHidden({ timeout: 3_000 });
    });
  });
});

// Test: Model selector
given("I am on a chat page with models available", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
    // Wait for models to load by polling for the model selector button
    await expect.poll(async () => {
      const btn = page.getByRole("button", { name: /select model/i });
      return btn.isVisible();
    }, { timeout: 10_000 }).toBe(true);
}, ({ when }) => {
  when("I click the model selector", async ({ page }) => {
    await page.getByRole("button", { name: /select model/i }).click();
  }, async ({ then }) => {
    await then("the model dropdown is visible", async ({ page }) => {
      // The dropdown shows at least the mock model
      await expect(page.getByRole("menuitem", { name: /mock model/i })).toBeVisible();
    });

    await then("the tooltip shows the current model name", async ({ page }) => {
      // Close dropdown first by pressing Escape
      await page.keyboard.press("Escape");
      // Hover over the model button to trigger the tooltip
      const modelBtn = page.getByRole("button", { name: /select model/i });
      await modelBtn.hover();
      // bits-ui tooltip content has data-slot="tooltip-content"
      const tooltipContent = page.locator('[data-slot="tooltip-content"]');
      await expect(tooltipContent).toContainText(/model:/i);
    });
  });
});

// Test: Message ID attributes for hash-based scroll targets
given("I am on a chat page with messages that have ID attributes", async ({ page }) => {
    await givenLoggedInUser(page);
    await sendChatAndWait(page, "Hello!");
}, ({ when }) => {
  when("I inspect the message elements", async ({ page: _page }) => {
    // No action needed — just check the DOM structure
  }, async ({ then }) => {
    await then("messages have id attributes matching the msg- prefix", async ({ page }) => {
      // Each message div has id="msg-{messageId}" for hash-based scrolling
      const msgElements = page.locator("[id^='msg-']");
      const count = await msgElements.count();
      expect(count).toBeGreaterThan(0);
    });

    await then("the message ID format is consistent", async ({ page }) => {
      // Each message div has id="msg-{messageId}". The IDs are generated
      // at runtime so they change on reload, but the format is stable.
      const msgElements = page.locator("[id^='msg-']");
      const count = await msgElements.count();
      expect(count).toBeGreaterThan(0);
      // Verify the format: msg-{alphanumeric-or-numeric-id}
      const firstId = await msgElements.first().getAttribute("id");
      expect(firstId).toMatch(/^msg-.+$/);
    });
  });
});
});
