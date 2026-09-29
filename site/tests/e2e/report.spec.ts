import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";
import { DIST_DIR } from "./dist";

const REPORT = localizedPath(BASE_PATH, "en", "report");
const REPORT_AR = localizedPath(BASE_PATH, "ar", "report");
const SITE_DIR = path.resolve(import.meta.dirname, "../..");
const BUNDLE_DIR = path.join(DIST_DIR, "report-bundle");
const ASTRO_CLI = path.join(SITE_DIR, "node_modules/astro/bin/astro.mjs");
const LAYERS = ["sawa", "upstream", "guides", "diff"] as const;

function search(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator("[data-overlay]")).toHaveAttribute("data-state", "ready");
}

function layer(page: Page, name: string) {
  return page.locator(`[data-overlay] svg[data-layer="${name}"]`);
}

test.beforeAll(async () => {
  // The bundle is generated before the site build (CI does it in release.yml).
  await expect(readdir(path.join(BUNDLE_DIR, "tests"))).resolves.not.toHaveLength(0);
});

test("the summary shows shaping, coverage, metrics and Fontbakery from the bundle", async ({
  page,
  request,
}) => {
  await page.goto(REPORT);
  for (const tile of ["shaping", "coverage", "metrics", "fontbakery"]) {
    await expect(page.locator(`[data-tile="${tile}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-tile="coverage"] tbody tr')).toHaveCount(3);
  await expect(page.locator("[data-fact=version]")).not.toBeEmpty();
  await expect(page.locator("[data-older-reports]")).toHaveAttribute("href", /^https:\/\//);

  const links = page.locator("[data-fontbakery-link], [data-fontbakery-index]");
  const hrefs = await links.evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href.startsWith(`${BASE_PATH}report-bundle/fontbakery/`)).toBe(true);
    expect((await request.get(href)).status()).toBe(200);
  }
});

test("picking a test shows its card and keeps it in the URL", async ({ page }) => {
  await open(page, REPORT);
  await expect(page.locator("[data-test-card]:visible")).toHaveCount(1);
  await page.locator('[data-test-link="madda"]').click();
  await expect(page.locator('[data-test-card="madda"]')).toBeVisible();
  await expect(page.locator('[data-test-link="madda"]')).toHaveAttribute("aria-current", "true");
  expect(search(page).get("rt")).toBe("madda");
  await expect(page.locator("[data-overlay] [data-layer-id]").first()).toBeAttached();

  await page.reload();
  await expect(page.locator('[data-test-card="madda"]')).toBeVisible();

  await open(page, `${REPORT}?rt=no-such-test`);
  expect(search(page).has("rt")).toBe(false);
  await expect(page.locator("[data-test-card]:visible")).toHaveCount(1);
});

test("toggling each layer changes its visibility", async ({ page }) => {
  await open(page, `${REPORT}?rl=sawa,upstream,guides,diff`);
  for (const name of LAYERS) {
    await expect(layer(page, name).first()).toBeVisible();
    await page.locator(`[data-viewer-layer="${name}"]`).uncheck();
    for (const element of await layer(page, name).all()) {
      await expect(element).toBeHidden();
    }
    expect(search(page).get("rl")?.split(",") ?? []).not.toContain(name);
    await page.locator(`[data-viewer-layer="${name}"]`).check();
    await expect(layer(page, name).first()).toBeVisible();
  }
});

test("onion skin opacity sets the upstream layer's computed opacity", async ({ page }) => {
  await open(page, REPORT);
  const upstream = layer(page, "upstream");
  await expect(upstream).toHaveCSS("opacity", "0.5");
  await page.locator("[data-viewer-opacity]").fill("20");
  await expect(upstream).toHaveCSS("opacity", "0.2");
  await expect(layer(page, "sawa")).toHaveCSS("opacity", "1");
  expect(search(page).get("ro")).toBe("20");
});

test("the swipe divider clips the Sawa layer by pointer and by keyboard", async ({ page }) => {
  await open(page, `${REPORT}?rm=swipe`);
  const sawa = layer(page, "sawa");
  const divider = page.locator("[data-swipe]");
  await expect(sawa).toHaveCSS("clip-path", "inset(0px 50% 0px 0px)");
  await expect(page.locator("[data-opacity-control]")).toBeHidden();

  const frame = page.locator("[data-frame]");
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  if (!box) throw new Error("no frame");
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await expect(divider).toHaveAttribute("aria-valuenow", "25");
  await expect(sawa).toHaveCSS("clip-path", "inset(0px 75% 0px 0px)");

  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "26");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "16");
  await page.keyboard.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "100");
  await expect(sawa).toHaveCSS("clip-path", "inset(0px 0% 0px 0px)");
  await expect(divider).toBeFocused();
  expect(search(page).get("rs")).toBe("100");
});

test("the Arabic UI keeps the overlay left to right", async ({ page }) => {
  await open(page, `${REPORT_AR}?rm=swipe`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-overlay]")).toHaveAttribute("dir", "ltr");
  await page.locator("[data-swipe]").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-swipe]")).toHaveAttribute("aria-valuenow", "51");
});

test("side by side shows the Sawa and upstream layers in two panes", async ({ page }) => {
  await open(page, REPORT);
  await page.locator('[data-viewer-mode="side"]').click();
  const panes = page.locator("[data-overlay] .overlay-pane");
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).locator('svg[data-layer="sawa"]')).toHaveCount(1);
  await expect(panes.nth(0).locator('svg[data-layer="upstream"]')).toHaveCount(0);
  await expect(panes.nth(1).locator('svg[data-layer="upstream"]')).toHaveCount(1);
  const [first, second] = await Promise.all([
    panes.nth(0).locator("[data-frame]").boundingBox(),
    panes.nth(1).locator("[data-frame]").boundingBox(),
  ]);
  expect(first?.width).toBeCloseTo(second?.width ?? 0);
  expect(search(page).get("rm")).toBe("side");
});

test("the family selector picks which Sawa layer and upstream layer are compared", async ({
  page,
}) => {
  await open(page, REPORT);
  await page.locator('[data-viewer-family="sawa-mono"]').click();
  await expect(layer(page, "sawa")).toHaveAttribute("data-layer-id", "sawa-mono");
  await expect(layer(page, "upstream")).toHaveAttribute("data-layer-id", "upstream-mono");
  await expect(page.locator('[data-legend-name="upstream"]')).toContainText("Cascadia");
  expect(search(page).get("rf")).toBe("sawa-mono");
});

test("zoom draws the viewBox at 100% and 200%", async ({ page }) => {
  await open(page, REPORT);
  const viewBox = (await layer(page, "sawa").getAttribute("viewBox"))?.split(" ").map(Number);
  const width = viewBox?.[2] ?? 0;
  const frame = page.locator("[data-frame]");
  await page.locator('[data-viewer-zoom="100"]').click();
  expect((await frame.boundingBox())?.width).toBeCloseTo(width);
  await page.locator('[data-viewer-zoom="200"]').click();
  expect((await frame.boundingBox())?.width).toBeCloseTo(width * 2);
  expect(search(page).get("rz")).toBe("200");
});

test("every viewer control round-trips through the URL", async ({ page }) => {
  const query = "?rt=pause-marks&rf=sawa-sans&rm=swipe&ro=30&rs=70&rl=upstream,guides&rz=100";
  await open(page, `${REPORT}${query}`);
  expect(new URL(page.url()).search).toBe(query);
  await expect(page.locator('[data-test-card="pause-marks"]')).toBeVisible();
  await expect(page.locator('[data-viewer-family="sawa-sans"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-viewer-mode="swipe"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-viewer-zoom="100"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-viewer-opacity]")).toHaveValue("30");
  await expect(page.locator("[data-swipe]")).toHaveAttribute("aria-valuenow", "70");
  await expect(page.locator('[data-viewer-layer="sawa"]')).not.toBeChecked();
  await expect(page.locator('[data-viewer-layer="guides"]')).toBeChecked();
  await expect(layer(page, "sawa")).toBeHidden();
});

for (const [locale, url] of [
  ["en", REPORT],
  ["ar", REPORT_AR],
] as const) {
  test(`the ${locale} report has no horizontal scroll at 360px, even zoomed to 200%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, `${url}?rt=fatiha-1&rz=200`);
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
}

test("on a phone, fit keeps glyphs legible and scrolls inside the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, `${REPORT}?rt=fatiha-1`);
  const frame = await page.locator("[data-frame]").boundingBox();
  // 6rem, less subpixel rounding of the aspect-ratio height.
  expect(frame?.height).toBeGreaterThan(95.5);
  const scroll = await page.locator(".overlay-scroll").evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(scroll.scroll).toBeGreaterThan(scroll.client);
  expect(new URL(page.url()).search).toBe("?rt=fatiha-1");
});

test("the swipe divider at either end doesn't make the overlay scroll", async ({ page }) => {
  for (const position of [0, 100]) {
    await open(page, `${REPORT}?rm=swipe&rs=${position}`);
    const scroll = await page.locator(".overlay-scroll").evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(scroll.scroll, `rs=${position}`).toBeLessThanOrEqual(scroll.client);
  }
});

test("every test's SVG layers share its viewBox", async () => {
  const tests = await readdir(path.join(BUNDLE_DIR, "tests"));
  expect(tests.length).toBeGreaterThan(0);
  for (const id of tests) {
    const dir = path.join(BUNDLE_DIR, "tests", id);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".svg"));
    expect(files).toHaveLength(6);
    const viewBoxes = new Set<string>();
    for (const file of files) {
      const svg = await readFile(path.join(dir, file), "utf-8");
      viewBoxes.add(svg.match(/<svg\b[^>]*\sviewBox="([^"]*)"/)?.[1] ?? `missing in ${file}`);
    }
    expect([...viewBoxes], id).toHaveLength(1);
  }
});

/** The frame with one font layer showing, both layers forced to the same ink. */
async function frameWith(page: Page, font: "sawa" | "upstream"): Promise<Buffer> {
  for (const name of ["sawa", "upstream"] as const) {
    await page.locator(`[data-viewer-layer="${name}"]`).setChecked(name === font);
  }
  await expect(layer(page, font)).toBeVisible();
  await expect(layer(page, font === "sawa" ? "upstream" : "sawa")).toBeHidden();
  return page.locator("[data-frame]").screenshot({ animations: "disabled" });
}

// Relies on the real bundle: Sawa Sans is built from its upstream fonts
// without changes, so the two layers have identical outlines. Once Sawa edits
// Sawa Sans, stack one layer file as both layers instead (e.g. a fixture test
// whose upstream-sans.svg is a copy of sawa-sans.svg).
test("two identical fonts stacked as layers line up pixel-exactly", async ({ page }) => {
  await open(page, `${REPORT}?rt=fatiha-1&rf=sawa-sans&ro=100&rl=sawa,upstream&rz=100`);
  await page.addStyleTag({
    content: "[data-overlay] svg[data-font] { color: #000 !important; opacity: 1 !important; }",
  });
  const paths = (name: string) =>
    layer(page, name).evaluate((svg) =>
      [...svg.querySelectorAll("path")].map((outline) => outline.getAttribute("d")),
    );
  expect(await paths("sawa")).toEqual(await paths("upstream"));
  expect(await layer(page, "sawa").getAttribute("viewBox")).toBe(
    await layer(page, "upstream").getAttribute("viewBox"),
  );
  const [sawaBox, upstreamBox] = await Promise.all([
    layer(page, "sawa").boundingBox(),
    layer(page, "upstream").boundingBox(),
  ]);
  expect(sawaBox).toEqual(upstreamBox);

  const sawa = await frameWith(page, "sawa");
  const upstream = await frameWith(page, "upstream");
  expect(sawa.equals(upstream)).toBe(true);

  // Control: Sawa Serif's scaled Arabic differs from its upstream layer, so
  // the same comparison must tell the two apart.
  await page.locator('[data-viewer-family="sawa-serif"]').click();
  await expect(layer(page, "sawa")).toHaveAttribute("data-layer-id", "sawa-serif");
  await expect(page.locator("[data-overlay]")).toHaveAttribute("data-state", "ready");
  const serif = await frameWith(page, "sawa");
  const serifUpstream = await frameWith(page, "upstream");
  expect(serif.equals(serifUpstream)).toBe(false);
});

test("a build without a report bundle says how to make one", async () => {
  test.setTimeout(180_000);
  // Under the site, not the OS temp dir: Astro moves its assets into outDir
  // with rename, which fails across drives.
  const outDir = await mkdtemp(path.join(SITE_DIR, ".no-report-"));
  try {
    await promisify(execFile)(process.execPath, [ASTRO_CLI, "build", "--outDir", outDir], {
      cwd: SITE_DIR,
      env: { ...process.env, REPORT_DIR: path.join(outDir, "no-bundle-here") },
    });
    const html = await readFile(path.join(outDir, "en", "report", "index.html"), "utf-8");
    expect(html).toContain("data-no-bundle");
    expect(html).toContain("sawa report build --out report/current");
    expect(html).not.toContain("data-overlay");
    await expect(readdir(path.join(outDir, "report-bundle"))).rejects.toThrow();
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
