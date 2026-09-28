import { expect, test } from "@playwright/test";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

test("the Specimen page's body is set in the Sawa Sans stack and the font loads", async ({
  page,
}) => {
  await page.goto(localizedPath(BASE_PATH, "en", "specimen"));

  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fontFamily.replace(/^"/, "").toLowerCase().startsWith("sawa-sans")).toBe(true);

  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => document.fonts.check('16px "sawa-sans"'));
  expect(loaded).toBe(true);
});

test("every face URL in the injected @font-face CSS is served", async ({ page, request }) => {
  await page.goto(localizedPath(BASE_PATH, "en", "specimen"));

  const css = await page.evaluate(() =>
    [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n"),
  );
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
  expect(urls.length).toBeGreaterThan(0);

  for (const url of urls) {
    const response = await request.get(new URL(url, page.url()).toString());
    expect(response.status(), url).toBe(200);
  }
});
