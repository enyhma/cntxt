import { defineConfig, devices } from "@playwright/test";

// Chrome-only: Playwright's extension-loading support (persistent context +
// --load-extension) is Chromium-specific, and the e2e suite here exists
// specifically to exercise real browser.tabGroups/tabs event ordering that
// fakeBrowser can't (see e2e/fixtures.ts) — not to cover every build target.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
