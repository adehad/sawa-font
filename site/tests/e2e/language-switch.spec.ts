import { expect, test } from "@playwright/test";
import { localizedPath, PAGE_NAMES } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const QUERY = "?size=40&pal=gray&fonts=sawa,amiri";
const HASH = "#x";

/**
 * Picks `locale` and waits for the page it opens to load. Until the new
 * page's module script runs, a click follows the bare link href and drops
 * the query, so the next pick must not start any earlier.
 */
async function openSwitcherAndPick(page: import("@playwright/test").Page, locale: "en" | "ar") {
  const switcher = page.locator("[data-lang-switcher]");
  await switcher.locator("summary").click();
  await expect(switcher).toHaveAttribute("open", "");
  await switcher.locator(`a[data-locale="${locale}"]`).click();
  await page.waitForURL((url) => url.pathname.startsWith(`${BASE_PATH}${locale}/`));
}

for (const pageName of PAGE_NAMES) {
  test(`switching language on the ${pageName} page keeps the query and hash`, async ({ page }) => {
    await page.goto(localizedPath(BASE_PATH, "en", pageName) + QUERY + HASH);

    await openSwitcherAndPick(page, "ar");
    await expect(page).toHaveURL(localizedPath(BASE_PATH, "ar", pageName) + QUERY + HASH);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await openSwitcherAndPick(page, "en");
    await expect(page).toHaveURL(localizedPath(BASE_PATH, "en", pageName) + QUERY + HASH);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });
}

test("a query added after load via history.replaceState is carried by the switcher", async ({
  page,
}) => {
  await page.goto(localizedPath(BASE_PATH, "en", "compare"));

  await page.evaluate(() => {
    history.replaceState(null, "", `${location.pathname}?size=40#late`);
  });

  await openSwitcherAndPick(page, "ar");

  await expect(page).toHaveURL(localizedPath(BASE_PATH, "ar", "compare") + "?size=40#late");
});
