import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import markGroupsData from "../../../data/mark-groups.json" with { type: "json" };
import fontsData from "../../public/fonts/fonts.json" with { type: "json" };
import { familyInfo, lineBoxEm } from "../../src/fonts/specimen";
import type { FontsData } from "../../src/fonts/types";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const SPECIMEN = localizedPath(BASE_PATH, "en", "specimen");
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function search(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

async function computed(page: Page, selector: string, property: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

test("the family switch changes the hero's font and the URL", async ({ page }) => {
  await page.goto(SPECIMEN);
  const sans = page.locator('[data-family-button="sawa-sans"]');

  await sans.click();

  await expect(sans).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-family-button="sawa-serif"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(search(page).get("fam")).toBe("sawa-sans");
  expect(await computed(page, "[data-specimen]", "font-family")).toMatch(/^"?sawa-sans"?,/);
});

test("the weight slider sets font-weight and wght, and a reload restores it", async ({ page }) => {
  await page.goto(SPECIMEN);

  await page.locator("[data-weight]").fill("612");

  await expect.poll(() => search(page).get("wght")).toBe("612");
  expect(await computed(page, "[data-specimen]", "font-weight")).toBe("612");
  await expect(page.locator("[data-weight]")).toHaveAttribute("aria-valuetext", "612");

  await page.reload();
  await expect(page.locator("[data-weight]")).toHaveValue("612");
  expect(await computed(page, "[data-specimen]", "font-weight")).toBe("612");
});

test("the weight slider follows the selected family's own axis from fonts.json", async ({
  page,
}) => {
  await page.goto(`${SPECIMEN}?fam=sawa-sans`);
  const slider = page.locator("[data-weight]");
  await expect(slider).toHaveAttribute("min", "400");
  await expect(slider).toHaveAttribute("max", "700");

  await page.locator('[data-for-family="sawa-sans"] [data-instance-wght="600"]').click();
  expect(search(page).get("wght")).toBe("600");

  await page.locator('[data-family-button="sawa-mono"]').click();
  await expect(slider).toHaveAttribute("max", "700");
  expect(search(page).get("wght")).toBe("600");
});

test("a weight outside the axis is clamped, and the default weight is omitted", async ({
  page,
}) => {
  await page.goto(`${SPECIMEN}?wght=950`);
  await expect.poll(() => search(page).get("wght")).toBe("700");

  await page.locator('[data-for-family="sawa-serif"] [data-instance-wght="400"]').click();
  expect(search(page).has("wght")).toBe(false);
});

test("editing the sample updates the hero, the waterfall and the URL", async ({ page }) => {
  await page.goto(SPECIMEN);
  const text = "Salam سلام 123";

  await page.locator("[data-sample-input]").fill(text);

  await expect(page.locator("[data-specimen]")).toHaveText(text);
  const rows = page.locator("[data-waterfall-text]");
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) {
    await expect(row).toHaveText(text);
  }
  expect(search(page).get("preset")).toBe("custom");
  expect(search(page).get("text")).toBe(text);

  await page.reload();
  await expect(page.locator("[data-sample-input]")).toHaveValue(text);
  await expect(page.locator("[data-specimen]")).toHaveText(text);
});

test("the size slider and line grid toggle round-trip through the URL", async ({ page }) => {
  await page.goto(SPECIMEN);

  await page.locator("[data-size]").fill("80");
  await page.locator("[data-grid-toggle]").check();

  expect(search(page).get("size")).toBe("80");
  expect(search(page).get("metrics")).toBe("1");
  expect(await computed(page, "[data-specimen]", "font-size")).toBe("80px");

  await page.reload();
  await expect(page.locator("[data-size]")).toHaveValue("80");
  await expect(page.locator("[data-grid-toggle]")).toBeChecked();
  await expect(page.locator("[data-line-demo]")).toHaveAttribute("data-grid", "on");
});

test("the Arabic page is right to left while specimen text keeps dir=auto", async ({ page }) => {
  await page.goto(localizedPath(BASE_PATH, "ar", "specimen"));

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-specimen]")).toHaveAttribute("dir", "auto");
  await expect(page.locator("[data-sample-input]")).toHaveAttribute("dir", "auto");
  for (const row of await page.locator("[data-waterfall-text]").all()) {
    await expect(row).toHaveAttribute("dir", "auto");
  }
});

test("the Fatiha verses equal the Tanzil excerpt lines exactly and credit tanzil.net", async ({
  page,
}) => {
  const raw = await readFile(path.join(REPO_ROOT, "data/tanzil/uthmani-fatiha.txt"), "utf-8");
  const expected = raw.split("\n").slice(0, 7);
  expect(expected.every((line) => line.length > 0 && !line.startsWith("#"))).toBe(true);

  await page.goto(SPECIMEN);

  expect(await page.locator("[data-verse]").allTextContents()).toEqual(expected);
  await expect(page.locator("[data-tanzil-link]")).toHaveAttribute("href", "https://tanzil.net");
});

test("the mark legend has one chip per group in mark-groups.json", async ({ page }) => {
  const groups = markGroupsData.groups.map((group) => group.id);

  await page.goto(SPECIMEN);

  const chips = page.locator("[data-mark-legend] > li");
  await expect(chips).toHaveCount(groups.length);
  expect(await chips.evaluateAll((items) => items.map((item) => item.dataset.group))).toEqual(
    groups,
  );
});

test("a family without a Harakat twin hides the palette switch and says so", async ({ page }) => {
  await page.goto(`${SPECIMEN}?fam=sawa-mono`);

  await expect(page.locator("[data-palette-switch]")).toBeHidden();
  await expect(page.locator('.palette-note[data-for-family="sawa-mono"]')).toBeVisible();
  await expect(page.locator("[data-fatiha]")).toHaveAttribute("data-pal", "");
});

for (const locale of ["en", "ar"] as const) {
  test(`the ${locale} Specimen page has no horizontal scroll at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(localizedPath(BASE_PATH, locale, "specimen"));
    await page.evaluate(() => document.fonts.ready);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
}

test("an instance weight names itself in the slider's aria-valuetext", async ({ page }) => {
  await page.goto(SPECIMEN);
  const slider = page.locator("[data-weight]");
  await expect(slider).toHaveAttribute("aria-valuetext", "Regular");

  await page.locator('[data-for-family="sawa-serif"] [data-instance-wght="700"]').click();
  await expect(slider).toHaveAttribute("aria-valuetext", "Bold");
});

for (const id of ["sawa-serif", "sawa-sans"] as const) {
  test(`a ${id} line in the line-height demo is the font's own line box tall`, async ({ page }) => {
    const data: FontsData = fontsData;
    const lineBox = lineBoxEm(familyInfo(data, id).metrics);
    await page.goto(`${SPECIMEN}?fam=${id}`);

    const measured = await page.locator(".grid-text.in-family").evaluate(async (element) => {
      const line = document.createElement("p");
      // Copying every attribute carries Astro's scoped-style marker along with the classes.
      for (const attribute of element.attributes) {
        line.setAttribute(attribute.name, attribute.value);
      }
      line.textContent = "Sawa سوا";
      element.after(line);
      const style = getComputedStyle(line);
      await document.fonts.load(`${style.fontSize} ${style.fontFamily}`, "Sawa سوا");
      return { height: line.getBoundingClientRect().height, fontSize: parseFloat(style.fontSize) };
    });

    expect(Math.abs(measured.height - lineBox * measured.fontSize)).toBeLessThanOrEqual(1);
  });
}
