import { test, expect } from "@playwright/test";
import type { Page, BrowserContext } from "@playwright/test";
import { resetTestDb } from "./givens";

/** Playwright's standard test fixtures (page, context, browser, etc.). */
export type Fixtures = {
  page: Page;
  context: BrowserContext;
  browserName: string;
};

/** Helpers available inside a `when` block for defining assertions. */
export interface ThenHelpers {
  /**
   * Assert a property of the state after the `when` action.
   *
   * Each `then` becomes a labeled step in the Playwright HTML report.
   * Thens run sequentially — if one fails, the test stops at that point.
   *
   * @param description - What should be true, e.g. "my message appears"
   * @param fn - Assertion function receiving Playwright fixtures
   */
  then(description: string, fn: ({ page, context }: Fixtures) => Promise<void>): Promise<void>;
}

/** Helpers available inside a `given` block for defining scenarios. */
export interface GivenHelpers {
  /**
   * Define a test that mutates the given state in a specific way.
   *
   * Each `when` becomes a separate Playwright test, getting a fresh
   * browser context with the `given` setup already applied.
   *
   * @param description - What the user does, e.g. "I send a message"
   * @param action - Function that performs the mutation on the page
   * @param assertions - Callback where `then` blocks are defined
   */
  when(
    description: string,
    action: ({ page, context }: Fixtures) => Promise<void>,
    assertions: (helpers: ThenHelpers) => Promise<void>,
  ): void;
}

/**
 * Define a BDD "given" context: shared setup that runs before each when test.
 *
 * Creates a `test.describe` block with `test.beforeEach` for the setup.
 * Each `when` inside gets a fresh browser context with the setup applied,
 * so tests are fully isolated from each other.
 *
 * @param description - The starting state, e.g. "I am logged in"
 * @param setup - Setup function run via beforeEach (navigates, fills forms, etc.)
 * @param tests - Callback where `when` scenarios are defined
 *
 * @example
 * ```ts
 * given("I am on the login page", async ({ page }) => {
 *   await page.goto("/login");
 * }, ({ when }) => {
 *   when("I submit a valid password", async ({ page }) => {
 *     await page.getByLabel("Password").fill("test-password");
 *     await page.getByRole("button", { name: "Log in" }).click();
 *   }, async ({ then }) => {
 *     await then("I am redirected to the home page", async ({ page }) => {
 *       await expect(page).toHaveURL("/");
 *     });
 *   });
 * });
 * ```
 */
export function given(
  description: string,
  setup: ({ page, context }: Fixtures) => Promise<void>,
  tests: (helpers: GivenHelpers) => void,
): void {
  test.describe(`given ${description}`, () => {
    test.beforeEach(setup);

    // Reset the in-memory test DB after each test so seeded data
    // doesn't leak into the next scenario.
    test.afterEach(async () => {
      await resetTestDb();
    });

    tests({
      when(whenDescription, action, thens) {
        test(`when ${whenDescription}`, async ({ page, context, browserName }) => {
          const fixtures: Fixtures = { page, context, browserName };
          await action(fixtures);
          await thens({
            // BDD assertion method, not a Promise-like thenable
            // oxlint-disable-next-line unicorn/no-thenable
            async then(thenDescription, fn) {
              await test.step(`then ${thenDescription}`, () => fn(fixtures));
            },
          });
        });
      },
    });
  });
}

export { test, expect };
