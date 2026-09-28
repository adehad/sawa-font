import { defineConfig, devices } from "@playwright/test";
import { BASE_PATH, BASE_URL, PORT } from "./tests/e2e/config";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Builds fresh so dist/ and its baked-in BASE_PATH can't be stale, then serves it.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    // The preview server has no route at bare "/"; only the base path resolves.
    url: `${BASE_URL}${BASE_PATH}`,
    // Always run the command above; reusing a leftover server would skip the
    // build and let the dist audits read a stale dist/.
    reuseExistingServer: false,
  },
});
