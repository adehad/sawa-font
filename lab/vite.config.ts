import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2023" },
  // The primer's text lives in content/, outside the lab, for the site to share.
  server: { port: 4410, strictPort: true, fs: { allow: [".", "../content"] } },
  preview: { port: 4411, strictPort: true },
});
