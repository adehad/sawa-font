import { defineConfig, devices } from "@playwright/test";

const PORT = 4412;

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: { baseURL: `http://localhost:${PORT}/` },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: `bun run build && bunx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
