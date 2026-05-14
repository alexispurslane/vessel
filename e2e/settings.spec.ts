// BDD helpers (when, then) are destructured from interfaces, not class methods
// oxlint-disable typescript/unbound-method

import { given, expect } from "./bdd";
import { givenLoggedInUser } from "./givens";

given("I am on the home page", async ({ page }) => {
    await givenLoggedInUser(page);
}, ({ when }) => {
  when("I navigate to settings", async ({ page }) => {
    await page.getByRole("link", { name: /settings/i }).click();
  }, async ({ then }) => {
    await then("I see the settings tabs", async ({ page }) => {
      await expect(page.getByRole("tab", { name: /models/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /user/i })).toBeVisible();
    });

    await then("the models tab is active by default", async ({ page }) => {
      await expect(page.getByRole("tab", { name: /models/i })).toHaveAttribute("aria-selected", "true");
    });
  });

  when("I switch to the user tab", async ({ page }) => {
    await page.getByRole("link", { name: /settings/i }).click();
    await page.getByRole("tab", { name: /user/i }).click();
  }, async ({ then }) => {
    await then("the user tab is now active", async ({ page }) => {
      await expect(page.getByRole("tab", { name: /user/i })).toHaveAttribute("aria-selected", "true");
    });

    await then("the models tab is no longer active", async ({ page }) => {
      await expect(page.getByRole("tab", { name: /models/i })).toHaveAttribute("aria-selected", "false");
    });
  });
});
