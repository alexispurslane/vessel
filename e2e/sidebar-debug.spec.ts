import { test, expect } from "@playwright/test";
import { givenLoggedInUser, sendChatMessage } from "./givens";

test("debug: inspect DOM after navigating to conversation", async ({ page }) => {
  await givenLoggedInUser(page);
  await sendChatMessage(page, "Hello, this is a test!");
  await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 30_000 });

  await page.goto("/");
  const firstConv = page.getByTestId("conversation-item").first();
  await firstConv.click();

  // Wait a good while for messages to render
  await expect(page.getByRole("region", { name: /chat/i })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);

  // Let the trace capture this state — snapshot DOM for inspection
  const domDump = await page.evaluate(() => {
    const section = document.querySelector("[aria-label='Chat']");
    return section ? section.innerHTML.slice(0, 5000) : "NO CHAT SECTION FOUND";
  });
  // This will appear in the trace's console log
  console.log("CHAT SECTION HTML:", domDump);
});
