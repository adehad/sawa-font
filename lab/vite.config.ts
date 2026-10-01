import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2023" },
  server: { port: 4410, strictPort: true },
  preview: { port: 4411, strictPort: true },
});
