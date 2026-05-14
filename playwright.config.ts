/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

/**
 * Playwright configuration for Vessel E2E tests.
 *
 * Starts the Vessel dev server automatically with an in-memory SQLite
 * database and a temporary data directory. Runs a globalSetup script
 * that seeds the test database via the /api/test/seed endpoint before
 * any tests execute.
 *
 * Tests use the BDD helpers in e2e/bdd.ts.
 */

// Ephemeral data directory for session JSONL files and agent workspace.
// Lives in the OS temp dir and is unique per test run.
const testDataDir = mkdtempSync(join(tmpdir(), "vessel-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Seed the in-memory test database before any tests run.
  globalSetup: "./e2e/global-setup",

  webServer: {
    command: `VESSEL_IN_MEMORY_DB=1 VESSEL_DATA_DIR="${testDataDir}" bun run dev -- --port 5174`,
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
