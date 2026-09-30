import { expect, test, type Locator, type Page } from "@playwright/test";
import palettesData from "../../../data/palettes.json" with { type: "json" };
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const COMPARE = localizedPath(BASE_PATH, "en", "compare");
const SPECIMEN = localizedPath(BASE_PATH, "en", "specimen");
const SHORT = palettesData.groups.short;
// A large fatha on beh, and beh alone, in Sawa Serif only.
const FATHA = `${COMPARE}?fonts=sawa-serif&size=144&preset=custom&text=${encodeURIComponent("بَ")}`;
const BEH = `${COMPARE}?fonts=sawa-serif&size=144&preset=custom&text=${encodeURIComponent("ب")}`;

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
}

/** How many pixels of `locator`'s screenshot sit close to each #rrggbb colour. */
async function pixels(page: Page, locator: Locator, colours: string[]): Promise<number[]> {
  const png = await locator.screenshot();
  return page.evaluate(
    async ({ data, targets }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("no 2d context");
      }
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgbs = targets.map((hex) =>
        [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)),
      );
      const counts = rgbs.map(() => 0);
      for (let i = 0; i < rgba.length; i += 4) {
        rgbs.forEach(([r = 0, g = 0, b = 0], k) => {
          const distance =
            Math.abs((rgba[i] ?? 0) - r) +
            Math.abs((rgba[i + 1] ?? 0) - g) +
            Math.abs((rgba[i + 2] ?? 0) - b);
          if (distance < 24) {
            counts[k] = (counts[k] ?? 0) + 1;
          }
        });
      }
      return counts;
    },
    { data: png.toString("base64"), targets: colours },
  );
}

/** A computed rgb() colour as #rrggbb. */
async function inkOf(locator: Locator): Promise<string> {
  const rgb = await locator.evaluate((element) => getComputedStyle(element).color);
  const channels = (rgb.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

test("groups paints a fatha in the short-vowel colour and its letter in the text colour", async ({
  page,
}) => {
  await open(page, FATHA);
  const text = page.locator("[data-sample-text]").first();
  const ink = await inkOf(text);

  const [mark, letter] = await pixels(page, text, [SHORT.light, ink]);
  expect(mark).toBeGreaterThan(100);
  expect(letter).toBeGreaterThan(100);

  await open(page, BEH);
  const [none] = await pixels(page, page.locator("[data-sample-text]").first(), [SHORT.light]);
  expect(none).toBe(0);
});

test("a dark theme picks the dark palette, from the system or the stage background", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, FATHA);
  const text = page.locator("[data-sample-text]").first();
  const [dark, light] = await pixels(page, text, [SHORT.dark, SHORT.light]);
  expect(dark).toBeGreaterThan(100);
  expect(light).toBe(0);

  await page.emulateMedia({ colorScheme: "light" });
  await open(page, `${FATHA}&bg=dark`);
  const [staged] = await pixels(page, page.locator("[data-sample-text]").first(), [SHORT.dark]);
  expect(staged).toBeGreaterThan(100);
});

test("mono sets the plain family, gray and groups its Harakat twin", async ({ page }) => {
  const family = (pane: number) =>
    page
      .locator(`[data-pane="${pane}"] [data-pane-body]`)
      .evaluate((element) => getComputedStyle(element).fontFamily);

  await open(page, `${COMPARE}?pal=mono&fonts=sawa-serif,sawa-sans,amiri`);
  expect(await family(1)).toMatch(/^"?sawa-serif"?,/);
  expect(await family(2)).toMatch(/^"?sawa-sans"?,/);

  await page.locator('[data-palette-control] [data-palette="gray"]').click();
  await expect(page).toHaveURL(/pal=gray/);
  expect(await family(1)).toMatch(/^"?sawa-serif-harakat"?,/);
  expect(await family(2)).toMatch(/^"?sawa-sans-harakat"?,/);
  expect(await family(3)).toMatch(/^"?amiri"?/);
  await expect(page.locator("[data-palette-harakat]")).toBeVisible();

  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-palette-control] [data-palette="gray"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await family(1)).toMatch(/^"?sawa-serif-harakat"?,/);
});

test("side by side, only the Sawa panes take a palette of their own", async ({ page }) => {
  await open(page, `${COMPARE}?view=side&fonts=sawa-serif,amiri&ov=1:pal=mono`);

  await expect(page.locator('[data-pane="1"] [data-pane-control="pal"]')).toBeEnabled();
  await expect(page.locator('[data-pane="1"] [data-pane-control="pal"]')).toHaveValue("mono");
  const amiri = page.locator('[data-pane="2"] [data-pane-control="pal"]');
  await expect(amiri).toBeDisabled();
  await expect(amiri).toHaveAttribute("aria-describedby", "compare-palette-harakat");
  expect(
    await page
      .locator('[data-pane="1"] [data-pane-body]')
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toMatch(/^"?sawa-serif"?,/);
});

test("the landing palette switch recolours Al-Fatiha and the legend", async ({ page }) => {
  await open(page, SPECIMEN);
  const fatiha = page.locator("[data-fatiha]");
  const family = () => fatiha.evaluate((element) => getComputedStyle(element).fontFamily);

  await expect(page.locator("[data-palette-switch]")).toBeVisible();
  await expect(fatiha).toHaveAttribute("data-pal", "groups");
  expect(await family()).toMatch(/^"?sawa-serif-harakat"?,/);
  const short = page.locator('.mark-chip[data-group="short"] .mark-samples');
  const [coloured] = await pixels(page, short, [SHORT.light]);
  expect(coloured).toBeGreaterThan(10);

  await page.locator('[data-palette-switch] [data-palette="mono"]').click();
  await expect(fatiha).toHaveAttribute("data-pal", "mono");
  await expect(short).toHaveAttribute("data-pal", "mono");
  expect(await family()).toMatch(/^"?sawa-serif"?,/);
  const [plain] = await pixels(page, short, [SHORT.light]);
  expect(plain).toBe(0);
  expect(new URL(page.url()).searchParams.get("pal")).toBe("mono");
});
