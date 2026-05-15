// BDD helpers (when, then) are destructured from interfaces, not class methods
// oxlint-disable typescript/unbound-method
// BDD deeply nests given/when/then callbacks — disabling nesting rule for this file
// oxlint-disable max-nested-callbacks
// BDD test.describe blocks are inherently long — disabling line count rule for this file
// oxlint-disable max-lines-per-function

import { test, given, expect } from "./bdd";
import { givenLoggedInUser } from "./givens";
import { sendChatAndWait, getUserMessage, getAssistantMessage, hoverMessage } from "./whens";
import { mockTurnPlan } from "./mock-llm-server.js";

test.describe("message interactions", () => {
    test.describe.configure({ mode: "serial" });

    // ─── M1: Copy Message ───────────────────────────────────────

    given(
        "I have a conversation with a user and assistant message",
        async ({ page, context }) => {
            // Grant clipboard permissions so navigator.clipboard.writeText works
            await context.grantPermissions(["clipboard-read", "clipboard-write"]);

            await givenLoggedInUser(page);
            await sendChatAndWait(
                page,
                mockTurnPlan({ turns: [{ text: true }] }),
            );
        },
        ({ when }) => {
            when(
                "I click the copy button on the user message",
                async ({ page }) => {
                    const userMsg = getUserMessage(page, 0);
                    await hoverMessage(userMsg);
                    await userMsg
                        .getByRole("button", { name: "Copy message" })
                        .click();
                },
                async ({ then }) => {
                    await then(
                        "the user message text is in the clipboard",
                        async ({ page }) => {
                            // The clipboard should contain the user message content.
                            // The mockTurnPlan JSON is what was sent as the user message.
                            const clipboardText = await page.evaluate(() =>
                                navigator.clipboard.readText(),
                            );
                            // The user message content is the mockTurnPlan JSON string
                            expect(clipboardText).toContain("turns");
                        },
                    );

                    await then(
                        "the copy button briefly shows a checkmark",
                        async ({ page }) => {
                            // After copying, the icon switches from Clipboard to Check
                            // for 2 seconds. The button should contain a Check icon.
                            const userMsg = getUserMessage(page, 0);
                            const copyBtn = userMsg.getByRole("button", {
                                name: "Copy message",
                            });
                            // The check icon is rendered inside the same button
                            await expect(
                                copyBtn.locator("svg.lucide-check"),
                            ).toBeVisible();
                        },
                    );
                },
            );

            when(
                "I click the copy button on the assistant message",
                async ({ page }) => {
                    const assistantMsg = getAssistantMessage(page, 0);
                    await hoverMessage(assistantMsg);
                    await assistantMsg
                        .getByRole("button", { name: "Copy message" })
                        .click();
                },
                async ({ then }) => {
                    await then(
                        "the assistant message text is in the clipboard",
                        async ({ page }) => {
                            const clipboardText = await page.evaluate(() =>
                                navigator.clipboard.readText(),
                            );
                            // The mock LLM generates lorem ipsum paragraphs
                            expect(clipboardText.length).toBeGreaterThan(0);
                        },
                    );
                },
            );
        },
    );

    // ─── M2: Delete Message ─────────────────────────────────────

    given(
        "I have a conversation with multiple messages",
        async ({ page }) => {
            await givenLoggedInUser(page);
            // Send a first message and wait for response
            await sendChatAndWait(
                page,
                mockTurnPlan({ turns: [{ text: true }] }),
            );
            // Send a second message and wait for response
            await sendChatAndWait(
                page,
                mockTurnPlan({ turns: [{ text: true }] }),
            );
        },
        ({ when }) => {
            when(
                "I click delete on the first assistant message once",
                async ({ page }) => {
                    const assistantMsg = getAssistantMessage(page, 0);
                    await hoverMessage(assistantMsg);
                    await assistantMsg
                        .getByRole("button", { name: "Delete message" })
                        .click();
                },
                async ({ then }) => {
                    await then(
                        "the delete button shows a confirmation state",
                        async ({ page }) => {
                            const assistantMsg = getAssistantMessage(page, 0);
                            await expect(
                                assistantMsg.getByRole("button", {
                                    name: "Confirm delete",
                                }),
                            ).toBeVisible();
                        },
                    );

                    await then(
                        "the message is still visible (not yet deleted)",
                        async ({ page }) => {
                            // The message should still be in the DOM — one click
                            // only enters confirmation mode
                            await expect(
                                getAssistantMessage(page, 0),
                            ).toBeVisible();
                        },
                    );
                },
            );

            when(
                "I click delete on the first assistant message twice (confirming deletion)",
                async ({ page }) => {
                    const assistantMsg = getAssistantMessage(page, 0);
                    await hoverMessage(assistantMsg);
                    // First click: enter confirmation mode
                    await assistantMsg
                        .getByRole("button", { name: "Delete message" })
                        .click();
                    // Second click: confirm and delete
                    await assistantMsg
                        .getByRole("button", { name: "Confirm delete" })
                        .click();
                },
                async ({ then }) => {
                    await then(
                        "the assistant message and all subsequent messages are removed",
                        async ({ page }) => {
                            // Delete cascades: assistant1 + user2 + assistant2 removed.
                            // Count chat log direct children (avoids nested articles).
                            const chatLog = page.getByRole("log", {
                                name: /chat messages/i,
                            });
                            // Only user1 render item remains after delete.
                            const renderItems = chatLog.locator("> div");
                            await expect(renderItems).toHaveCount(1);
                        },
                    );
                },
            );

            when(
                "I click delete on the first user message twice (confirming deletion)",
                async ({ page }) => {
                    const userMsg = getUserMessage(page, 0);
                    await hoverMessage(userMsg);
                    // First click: enter confirmation mode
                    await userMsg
                        .getByRole("button", { name: "Delete message" })
                        .click();
                    // Second click: confirm and delete
                    await userMsg
                        .getByRole("button", { name: "Confirm delete" })
                        .click();
                },
                async ({ then }) => {
                    await then(
                        "the user message and all subsequent messages are removed",
                        async ({ page }) => {
                            // Deleting user1 removes user1 and everything after it
                            await expect(
                                page.getByRole("article", {
                                    name: "You message",
                                }),
                            ).toHaveCount(0);
                            await expect(
                                page.getByRole("article", {
                                    name: "Assistant message",
                                }),
                            ).toHaveCount(0);
                        },
                    );
                },
            );
        },
    );

    // ─── M2 variant: Delete confirmation auto-cancels ───────────

    given(
        "I have a conversation with a single exchange",
        async ({ page }) => {
            await givenLoggedInUser(page);
            await sendChatAndWait(
                page,
                mockTurnPlan({ turns: [{ text: true }] }),
            );
        },
        ({ when }) => {
            when(
                "I click delete once then wait for the confirmation to auto-cancel",
                async ({ page }) => {
                    const assistantMsg = getAssistantMessage(page, 0);
                    await hoverMessage(assistantMsg);
                    // First click: enter confirmation mode
                    await assistantMsg
                        .getByRole("button", { name: "Delete message" })
                        .click();
                    // Wait for the 3-second auto-cancel timeout to elapse
                    await page.waitForTimeout(3500);
                },
                async ({ then }) => {
                    await then(
                        "the delete button returns to its default state",
                        async ({ page }) => {
                            const assistantMsg = getAssistantMessage(page, 0);
                            await hoverMessage(assistantMsg);
                            // The button should no longer say "Confirm delete"
                            await expect(
                                assistantMsg.getByRole("button", {
                                    name: "Delete message",
                                }),
                            ).toBeVisible();
                        },
                    );

                    await then(
                        "the message is still visible",
                        async ({ page }) => {
                            await expect(
                                getAssistantMessage(page, 0),
                            ).toBeVisible();
                        },
                    );
                },
            );
        },
    );
});
