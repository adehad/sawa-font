import { expect, test } from "@playwright/test";
import { localizedPath, PAGE_NAMES } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const QUERY = "?size=40&pal=gray&fonts=sawa,amiri";
const HASH = "#x";

async function openSwitcherAndPick(page: import("@playwright/test").Page, locale: "en" | "ar") {
  await page.locator("[data-lang-switcher] summary").click();
  await page.locator(`[data-lang-switcher] a[data-locale="${locale}"]`).click();
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
