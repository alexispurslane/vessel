import { test, given, expect } from "./bdd";

// BDD helpers (when, then) are destructured from interfaces, not class methods
// oxlint-disable typescript/unbound-method

test.describe("auth", () => {
    test.describe.configure({ mode: "serial" });

    given("I am on the login page", async ({ page }) => {
      await page.goto("/login");
    }, ({ when }) => {
      when("I submit a valid password", async ({ page }) => {
        await page.getByLabel("Password").fill("test-password");
        await page.getByRole("button", { name: /sign in/i }).click();
      }, async ({ then }) => {
        await then("I am redirected to the home page", async ({ page }) => {
          await expect(page).toHaveURL("/");
        });

        await then("I see the Vessel branding", async ({ page }) => {
          await expect(page.getByRole("img", { name: /vessel/i }).first()).toBeVisible();
        });
      });

      when("I submit an invalid password", async ({ page }) => {
        await page.getByLabel("Password").fill("wrong-password");
        await page.getByRole("button", { name: /sign in/i }).click();
      }, async ({ then }) => {
        await then("I stay on the login page", async ({ page }) => {
          await expect(page).toHaveURL("/login");
        });

        await then("I see an error message", async ({ page }) => {
          await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
        });
      });
    });
});
