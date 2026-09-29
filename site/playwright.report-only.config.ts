import { defineConfig, devices } from "@playwright/test";
import { BASE_PATH, BASE_URL, PORT } from "./tests/e2e-report-only/config";

/**
 * Verifies the Read the Docs report-only build (SAWA_PLAN.md §8.3): a
 * second site build, with REPORT_ONLY=1 and a versioned BASE_PATH, checked
 * the same way tests/e2e/link-audit.spec.ts checks the full build.
 */
export default defineConfig({
  testDir: "./tests/e2e-report-only",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // env, not an inline "VAR=val" prefix, so this also works on Windows;
    // both build (page generation) and preview (base-path routing) need it.
    command: `bun run build && bun run preview -- --port ${PORT}`,
    env: { REPORT_ONLY: "1", BASE_PATH },
    url: `${BASE_URL}${BASE_PATH}`,
    reuseExistingServer: false,
  },
});
