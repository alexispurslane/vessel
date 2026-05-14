// BDD helpers (when, then) are destructured from interfaces, not class methods
// oxlint-disable typescript/unbound-method

import { test, given, expect } from "./bdd";
import { givenLoggedInUser, seedSql, sendChatMessage, workspaceHasFile } from "./givens";
import { mockTurnPlan } from "./mock-llm-server.js";

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

given("I am on the home page with a conversation in the sidebar", async ({ page }) => {
    await givenLoggedInUser(page);
    await seedSql([
        `INSERT OR REPLACE INTO conversations (id, title, session_file_path)
         VALUES ('test-conv-1', 'Test Conversation', '/tmp/test.jsonl')`,
    ]);
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
  });

  when("I navigate to an existing conversation via the sidebar", async ({ page }) => {
    const firstConversation = page.getByRole("button", { name: /Test Conversation/ }).first();
    await firstConversation.click();
  }, async ({ then }) => {
    await then("the conversation loads with messages", async ({ page }) => {
      await expect(page.getByRole("region", { name: /chat/i })).toBeVisible();
    });

    await then("the sidebar highlights the active conversation", async ({ page }) => {
      await expect(page.locator('[aria-current="true"], [data-active="true"]').first()).toBeVisible();
    });
  });
});

given("I am on the home page with the sidebar open", async ({ page }) => {
    await givenLoggedInUser(page);
}, ({ when }) => {
  when("I toggle the sidebar closed and open again", async ({ page }) => {
    await page.getByRole("button", { name: /sidebar|menu/i }).first().click();
    await page.getByRole("button", { name: /sidebar|menu/i }).first().click();
  }, async ({ then }) => {
    await then("the sidebar is visible again", async ({ page }) => {
      await expect(page.getByRole("navigation", { name: /sidebar/i })).toBeVisible();
    });
  });
});

given("I am on a chat page with sandbox on", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message asking the mock LLM to run bash commands via sandbox", async ({ page }) => {
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "ls" } }] },
        { tools: [{ name: "bash", arguments: { command: "whoami" } }] },
        { tools: [{ name: "bash", arguments: { command: "pwd" } }] },
        { text: true },
      ],
    }));
  }, async ({ then }) => {
    await then("I am on a chat page", async ({ page }) => {
      await expect(page).toHaveURL(/\/chat\//);
    });

    await then("the bash tool calls appear in the chat", async ({ page }) => {
      // Each bash command should appear as a tool call in the thinking group
      const chatMessages = page.getByRole("log", { name: /chat messages/i });
      await expect(chatMessages).toBeVisible();

      // Mock LLM tool calls are grouped into a thinking-group
      // with interleaved thinking + tool call steps.
      const groupSummary = page.locator("details summary").filter({ hasText: /tool call/ });
      await expect(groupSummary).toBeVisible();

      // Inside the group, each tool call has aria-label like "bash tool call, ..."
      const bashToolCalls = page.locator("summary[aria-label*=bash]");
      await expect(bashToolCalls).toHaveCount(3);
    });

    await then("each bash tool call shows its command argument", async ({ page }) => {
      // Ensure the thinking group is expanded by setting its open attribute.
      // Clicking the summary toggles, which can accidentally collapse it.
      const groupDetails = page.locator("details").filter({
        has: page.locator("summary").filter({ hasText: /tool call/ }),
      }).first();
      await groupDetails.evaluate((el: HTMLDetailsElement) => { el.open = true; });

      // Target tool call summaries by their aria-label pattern ("bash tool call, ...")
      const bashSummaries = page.locator("summary[aria-label*=bash]");
      await expect(bashSummaries.filter({ hasText: /ls/ })).toBeVisible();
      await expect(bashSummaries.filter({ hasText: /whoami/ })).toBeVisible();
      await expect(bashSummaries.filter({ hasText: /pwd/ })).toBeVisible();
    });

    await then("no bash tool calls show error status or error output", async ({ page }) => {
      // Each bash tool call summary has aria-label like
      // "bash tool call, Completed" or "bash tool call, Error".
      const bashSummaries = page.locator("summary[aria-label*=bash]");
      const count = await bashSummaries.count();
      for (let i = 0; i < count; i++) {
        const summary = bashSummaries.nth(i);
        // Verify status is Completed, not Error
        await expect(summary).toHaveAttribute("aria-label", /Completed/);
        // Expand the tool call details via evaluate (avoids flaky clicks)
        const detail = summary.locator("xpath=..");
        await detail.evaluate((el: HTMLDetailsElement) => { el.open = true; });
        const output = detail.locator("[aria-label='Tool call output']");
        await expect(output).not.toContainText(
          /error|fail|not found|permission denied|denied|fatal|exception|panic/i,
        );
      }
    });

    await then("the assistant's final text response is visible", async ({ page }) => {
      // Wrapper and inner component both have role="article";
      // use .last() to target the inner content-bearing one.
      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });
  });
});

given("I am on a chat page with a multi-turn thinking/toolcall plan", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message that triggers thinking-toolcall-thinking-toolcall sequences", async ({ page }) => {
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
  }, async ({ then }) => {
    await then("consecutive thinking/toolcall turns are grouped into a single block", async ({ page }) => {
      // The thinking group renders as a group with text like
      // "Thought · 2 tool calls"
      const group = page.getByRole("group").filter({ hasText: /tool calls/ });
      await expect(group).toBeVisible();
    });

    await then("the grouped block contains interleaved thinking and tool calls", async ({ page }) => {
      // Expand the group by setting open attribute
      const groupDetails = page.locator("details").filter({
        has: page.locator("summary").filter({ hasText: /tool call/ }),
      }).first();
      await groupDetails.evaluate((el: HTMLDetailsElement) => { el.open = true; });

      // Both bash tool calls should be visible inside the group
      const bashCalls = groupDetails.locator("summary[aria-label*=bash]");
      await expect(bashCalls).toHaveCount(2);
    });

    await then("the final text response appears separately after the group", async ({ page }) => {
      // Collapse the thinking group so that any content inside it
      // becomes hidden — this proves the final message is outside.
      const groupDetails = page.locator("details").filter({
        has: page.locator("summary").filter({ hasText: /tool call/ }),
      }).first();
      await groupDetails.evaluate((el: HTMLDetailsElement) => { el.open = false; });

      const assistantMessage = page.getByRole("article", { name: /assistant message/i }).last();
      await expect(assistantMessage).toBeVisible();
    });
  });
});

given("I am on a chat page and the model responds with no tool calls", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a plain text message", async ({ page }) => {
    // A plain text message (not a mockTurnPlan JSON) causes the mock
    // LLM to respond with text-only (no tool calls)
    await sendChatAndWait(page, "Hello, just having a conversation!");
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
  });
});

given("I am on a chat page and send a message requiring tool calls", async ({ page }) => {
    await givenLoggedInUser(page);
    await page.goto("/");
}, ({ when }) => {
  when("I send a message that triggers tool calls and a final response", async ({ page }) => {
    await sendChatAndWait(page, mockTurnPlan({
      turns: [
        { tools: [{ name: "bash", arguments: { command: "echo hello" } }], text: true },
        { text: true },
      ],
    }));
  }, async ({ then }) => {
    await then("the tool calls are visible in the chat", async ({ page }) => {
      const bashToolCall = page.locator("summary[aria-label*=bash]");
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
      // The home page shows the Vessel heading and input
      await expect(page.getByRole("heading", { name: /vessel/i }).last()).toBeVisible();
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
});
