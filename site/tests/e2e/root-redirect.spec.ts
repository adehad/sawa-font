import { expect, test } from "@playwright/test";
import { LOCALE_STORAGE_KEY } from "../../src/i18n/locales";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

async function redirectedUrl(
  browser: import("@playwright/test").Browser,
  options: { locale?: string; storedLocale?: string; path?: string },
) {
  const context = await browser.newContext({ locale: options.locale });
  try {
    if (options.storedLocale) {
      await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: LOCALE_STORAGE_KEY,
        value: options.storedLocale,
      });
    }
    const page = await context.newPage();
    await page.goto(options.path ?? BASE_PATH);
    await page.waitForURL((url) => url.pathname !== BASE_PATH);
    const url = new URL(page.url());
    return url.pathname + url.search + url.hash;
  } finally {
    await context.close();
  }
}

test("an Arabic browser locale redirects to /ar/", async ({ browser }) => {
  const result = await redirectedUrl(browser, { locale: "ar-EG" });
  expect(result).toBe(localizedPath(BASE_PATH, "ar", "specimen"));
});

test("an English browser locale redirects to /en/", async ({ browser }) => {
  const result = await redirectedUrl(browser, { locale: "en-GB" });
  expect(result).toBe(localizedPath(BASE_PATH, "en", "specimen"));
});

test("an unsupported browser locale falls back to /en/", async ({ browser }) => {
  const result = await redirectedUrl(browser, { locale: "fr-FR" });
  expect(result).toBe(localizedPath(BASE_PATH, "en", "specimen"));
});

test("a stored locale wins over an English browser locale", async ({ browser }) => {
  const result = await redirectedUrl(browser, { locale: "en-GB", storedLocale: "ar" });
  expect(result).toBe(localizedPath(BASE_PATH, "ar", "specimen"));
});

test("query and hash survive the redirect", async ({ browser }) => {
  const result = await redirectedUrl(browser, {
    locale: "ar-EG",
    path: `${BASE_PATH}?size=40#top`,
  });
  expect(result).toBe(`${localizedPath(BASE_PATH, "ar", "specimen")}?size=40#top`);
});
