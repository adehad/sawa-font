import { defineConfig } from "astro/config";
import { DEFAULT_LOCALE, LOCALES } from "./src/i18n/locales.ts";
import { reportBundle } from "./src/report/integration.ts";

export default defineConfig({
  site: "https://adehad.github.io",
  base: process.env.BASE_PATH ?? "/sawa-font/",
  trailingSlash: "always",
  integrations: [reportBundle()],
  vite: {
    server: {
      // site/src/samples reads tests/strings and data/tanzil from outside
      // this project's root.
      fs: { allow: [".."] },
    },
  },
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
