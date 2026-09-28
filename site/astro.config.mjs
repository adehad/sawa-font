import { defineConfig } from "astro/config";
import { DEFAULT_LOCALE, LOCALES } from "./src/i18n/locales.ts";

export default defineConfig({
  site: "https://adehad.github.io",
  base: process.env.BASE_PATH ?? "/sawa-font/",
  trailingSlash: "always",
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
