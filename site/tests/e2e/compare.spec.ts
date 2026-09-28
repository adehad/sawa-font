import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import fontsData from "../../public/fonts/fonts.json" with { type: "json" };
import stressData from "../../../tests/strings/stress.json" with { type: "json" };
import type { FontsData } from "../../src/fonts/types";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const COMPARE = localizedPath(BASE_PATH, "en", "compare");
const COMPARE_AR = localizedPath(BASE_PATH, "ar", "compare");
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const data: FontsData = fontsData;

function search(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
}

/** Every control's visible value and every pane's rendered font state. */
function uiSnapshot(page: Page) {
  // The callback is serialised into the page, so its helpers can't live in module scope.
  /* oxlint-disable unicorn/consistent-function-scoping */
  return page.evaluate(() => {
    const value = (selector: string) =>
      document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)
        ?.value;
    const checked = (selector: string) =>
      document.querySelector<HTMLInputElement>(selector)?.checked;
    const pressed = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent?.trim());
    return {
      preset: value("[data-preset]"),
      text: value("[data-sample-input]"),
      size: value("[data-size]"),
      waterfall: checked("[data-waterfall]"),
      lhDefault: checked("[data-lh-default]"),
      lh: value("[data-lh]"),
      weight: value("[data-weight]"),
      metrics: checked("[data-metrics]"),
      bg: pressed("[data-bg-button]"),
      view: pressed("[data-view-button]"),
      chips: pressed("[data-font-toggle]"),
      order: [...document.querySelectorAll<HTMLElement>("[data-order-font]")].map(
        (item) => item.dataset.orderFont,
      ),
      features: [...document.querySelectorAll<HTMLInputElement>("[data-feature]")]
        .filter((input) => input.checked)
        .map((input) => input.dataset.feature),
      stageBg: document.querySelector<HTMLElement>("[data-stage]")?.dataset.bg,
      panes: [...document.querySelectorAll<HTMLElement>("[data-pane]")].map((pane) => {
        const body = pane.querySelector<HTMLElement>("[data-pane-body]");
        const style = body ? getComputedStyle(body) : undefined;
        return {
          font: pane.dataset.paneFont,
          fontSelect: pane.querySelector<HTMLSelectElement>('[data-pane-control="font"]')?.value,
          palSelect: pane.querySelector<HTMLSelectElement>('[data-pane-control="pal"]')?.value,
          pal: body?.dataset.pal,
          family: style?.fontFamily,
          weight: style?.fontWeight,
          lineHeight: style?.lineHeight,
          fontSize: getComputedStyle(pane.querySelector("[data-sample-text]") ?? pane).fontSize,
          features: style?.fontFeatureSettings,
          samples: pane.querySelectorAll("[data-sample-text]").length,
        };
      }),
    };
  });
  /* oxlint-enable unicorn/consistent-function-scoping */
}

test("every control round-trips through the URL", async ({ page }) => {
  await open(page, COMPARE);

  await page.locator("[data-sample-input]").fill("Salam سلام 123");
  await page.locator("[data-size]").fill("48");
  await page.locator("[data-waterfall]").check();
  await page.locator("[data-lh-default]").uncheck();
  await page.locator("[data-lh]").fill("1.75");
  await page.locator("[data-weight]").fill("612");
  await page.locator('[data-bg-button="dark"]').click();
  await page.locator("[data-metrics]").check();
  await page.locator('[data-font-toggle="amiri"]').click();
  await page.locator('[data-move-font="amiri"][data-move="up"]').click();
  await page.locator("[data-feature-panel] > summary").click();
  await page.locator('[data-feature="ss01"]').check();
  await page.locator('[data-feature="liga"]').uncheck();
  await page.locator('[data-view-button="side"]').click();
  await page.locator('[data-pane="2"] [data-pane-control="font"]').selectOption("sch");

  const expected = new URLSearchParams({
    text: "Salam سلام 123",
    preset: "custom",
    wght: "612",
    size: "48",
    wf: "1",
    lh: "1.75",
    bg: "dark",
    feat: "ss01,liga",
    metrics: "1",
    view: "side",
    fonts: "sawa-serif,sawa-sans,amiri,status",
    ov: "2:font=sch",
  });
  expect([...search(page)]).toEqual([...expected]);
  const before = await uiSnapshot(page);
  expect(before.panes.map((pane) => pane.font)).toEqual(["sawa-serif", "sch", "amiri", "status"]);
  expect(before.panes[0]?.weight).toBe("612");
  expect(before.panes[2]?.weight).toBe("700");
  expect(before.stageBg).toBe("dark");

  const url = page.url();
  await page.reload();
  await page.evaluate(() => document.fonts.ready);

  expect(page.url()).toBe(url);
  expect(await uiSnapshot(page)).toEqual(before);
});

test("the shared and per-pane palettes round-trip through the URL", async ({ page }) => {
  await open(page, `${COMPARE}?pal=mono&view=side&ov=2:pal=gray`);

  const pal = page.locator("[data-pane-body]");
  await expect(pal.nth(0)).toHaveAttribute("data-pal", "mono");
  await expect(pal.nth(1)).toHaveAttribute("data-pal", "gray");
  await expect(page.locator('[data-pane="2"] [data-pane-control="pal"]')).toHaveValue("gray");
  const before = await uiSnapshot(page);

  await page.reload();
  expect(search(page).toString()).toBe("pal=mono&view=side&ov=2%3Apal%3Dgray");
  expect(await uiSnapshot(page)).toEqual(before);
});

test("with no CPAL on screen the palette switch is hidden and pane palettes are disabled", async ({
  page,
}) => {
  await open(page, `${COMPARE}?view=side`);

  await expect(page.locator("[data-palette-switch]")).toBeHidden();
  await expect(page.locator("[data-palette-none]")).toBeVisible();
  await expect(page.locator('[data-pane="1"] [data-pane-control="pal"]')).toBeDisabled();
});

test("stacked view applies palette overrides and notes that font overrides are side-only", async ({
  page,
}) => {
  await open(page, `${COMPARE}?ov=2:font=amiri;pal=gray`);

  await expect(page.locator('[data-pane="2"]')).toHaveAttribute("data-pane-font", "sawa-sans");
  await expect(page.locator('[data-pane="2"] [data-pane-body]')).toHaveAttribute(
    "data-pal",
    "gray",
  );
  await expect(page.locator("[data-font-overrides-note]")).toBeVisible();

  await page.locator('[data-view-button="side"]').click();
  await expect(page.locator('[data-pane="2"]')).toHaveAttribute("data-pane-font", "amiri");
  await expect(page.locator("[data-font-overrides-note]")).toBeHidden();
});

test("a narrow pane keys its guides with a legend instead of line labels", async ({ page }) => {
  await open(page, `${COMPARE}?view=side&metrics=1&fonts=sawa-serif,sawa-sans,amiri,noto`);
  await expect(page.locator("[data-panes]")).toHaveAttribute("data-overlay", "drawn");
  const pane = page.locator('[data-pane="1"]');

  await expect(pane.locator("[data-guide-legend]")).toBeVisible();
  await expect(pane.locator(".guide-label").first()).toBeHidden();

  await open(page, `${COMPARE}?metrics=1&fonts=sawa-serif`);
  await expect(page.locator("[data-panes]")).toHaveAttribute("data-overlay", "drawn");
  await expect(page.locator("[data-guide-legend]")).toBeHidden();
  const label = page.locator(".guide-label").first();
  await expect(label).toBeVisible();
  const [labelBox, textBox] = await Promise.all([
    label.boundingBox(),
    page.locator("[data-sample-text]").first().boundingBox(),
  ]);
  expect((labelBox?.x ?? 0) + 1).toBeGreaterThanOrEqual((textBox?.x ?? 0) + (textBox?.width ?? 0));
});

test("an override follows its font when the fonts are reordered", async ({ page }) => {
  await open(page, `${COMPARE}?view=side&ov=1:font=amiri`);

  await page.locator('[data-move-font="sawa-serif"][data-move="down"]').click();

  expect(search(page).get("fonts")).toBe("sawa-sans,sawa-serif,status");
  expect(search(page).get("ov")).toBe("2:font=amiri");
  await expect(page.locator('[data-pane="2"]')).toHaveAttribute("data-pane-font", "amiri");
});

test("the move buttons work from the keyboard and keep focus on the moved font", async ({
  page,
}) => {
  await open(page, COMPARE);
  const down = page.locator('[data-move-font="sawa-serif"][data-move="down"]');

  await down.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  expect(search(page).get("fonts")).toBe("sawa-sans,status,sawa-serif");
  await expect(down).toBeFocused();
  await expect(down).toHaveAttribute("aria-disabled", "true");
});

test("in the Arabic UI the side-by-side columns run right to left", async ({ page }) => {
  await open(page, `${COMPARE_AR}?view=side&fonts=sawa-serif,amiri,status`);

  const lefts = await page
    .locator("[data-pane]")
    .evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().left));
  expect(lefts).toHaveLength(3);
  expect(lefts[0]).toBeGreaterThan(lefts[1] ?? Infinity);
  expect(lefts[1]).toBeGreaterThan(lefts[2] ?? Infinity);

  const texts = page.locator("[data-sample-text]");
  expect(await texts.count()).toBeGreaterThan(0);
  for (const text of await texts.all()) {
    await expect(text).toHaveAttribute("dir", "auto");
  }
});

test("the status quo pane uses Source Sans with the system's own Arabic", async ({ page }) => {
  await open(page, COMPARE);
  const pane = page.locator('[data-pane-font="status"]');

  await expect(pane.locator(".pane-name")).toHaveText("Your system's Arabic fallback");
  const family = await pane
    .locator("[data-pane-body]")
    .evaluate((body) => getComputedStyle(body).fontFamily);
  expect(family).toMatch(/^"?source-sans"?, sans-serif$/);

  // If Source Sans drew alef itself, the fallback after it would make no
  // difference to the width; Latin "a" is the control that it does draw.
  const widths = await page.evaluate(async () => {
    await Promise.all(
      ['16px "source-sans"', '16px "sawa-serif"', '16px "amiri"'].map((font) =>
        document.fonts.load(font, "aا"),
      ),
    );
    const context = document.createElement("canvas").getContext("2d");
    if (!context) {
      throw new Error("no 2d context");
    }
    const width = (fallback: string, text: string) => {
      context.font = `64px "source-sans", "${fallback}"`;
      return context.measureText(text).width;
    };
    return {
      alef: [width("sawa-serif", "ا"), width("amiri", "ا")],
      latin: [width("sawa-serif", "a"), width("amiri", "a")],
    };
  });
  expect(widths.latin[0]).toBe(widths.latin[1]);
  expect(widths.alef[0]).not.toBe(widths.alef[1]);
});

test("scrolling one side-by-side column scrolls the others proportionally", async ({ page }) => {
  await open(page, `${COMPARE}?view=side&size=72&fonts=sawa-serif,amiri`);
  const columns = page.locator("[data-pane-body]");

  const ratio = (index: number) =>
    columns.nth(index).evaluate((column) => {
      const range = column.scrollHeight - column.clientHeight;
      return range > 0 ? column.scrollTop / range : -1;
    });
  expect(await ratio(0)).toBe(0);

  await columns.nth(0).evaluate((column) => {
    column.scrollTop = (column.scrollHeight - column.clientHeight) / 2;
  });
  await expect.poll(() => ratio(1)).toBeCloseTo(0.5, 1);

  await columns.nth(1).evaluate((column) => {
    column.scrollTop = column.scrollHeight;
  });
  await expect.poll(() => ratio(0)).toBeCloseTo(1, 1);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(await ratio(1)).toBeCloseTo(1, 1);
});

test("a local font file loads into its own pane without leaving the browser", async ({ page }) => {
  await open(page, `${COMPARE}?fonts=sawa-serif,local`);
  await expect(page.locator('[data-pane-font="local"] .pane-placeholder')).toBeVisible();
  const buffer = await readFile(path.join(REPO_ROOT, "fonts/SawaMono[wght].ttf"));
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page
    .locator("[data-local-file]")
    .setInputFiles({ name: "SawaMono.ttf", mimeType: "font/ttf", buffer });

  const pane = page.locator('[data-pane-font="local"]');
  await expect(pane.locator(".pane-name")).toHaveText("SawaMono.ttf");
  await expect(pane.locator(".pane-placeholder")).toHaveCount(0);
  const family = await pane
    .locator("[data-pane-body]")
    .evaluate((body) => getComputedStyle(body).fontFamily);
  expect(family).toMatch(/^"?sawa-local-\d+"?, sans-serif$/);
  const loaded = await page.evaluate(
    (name) => document.fonts.check(`16px ${name.split(",")[0]}`, "a"),
    family,
  );
  expect(loaded).toBe(true);
  expect(requests.filter((url) => !url.startsWith("blob:"))).toEqual([]);
});

test("a WOFF2 local font says its metrics are not available", async ({ page }) => {
  await open(page, `${COMPARE}?fonts=local&metrics=1`);
  const file = data.fonts["sawa-mono"]?.faces[0]?.file ?? "";
  const buffer = await readFile(path.resolve(import.meta.dirname, "../../public/fonts", file));

  await page
    .locator("[data-local-file]")
    .setInputFiles({ name: "SawaMono.woff2", mimeType: "font/woff2", buffer });

  await expect(page.locator('[data-pane-font="local"] [data-pane-metrics]')).toHaveText(
    "Metrics not available for WOFF2 files.",
  );
  await expect(page.locator(".metrics-overlay")).toHaveCount(0);
});

test("a feature toggle changes font-feature-settings and names panes that lack it", async ({
  page,
}) => {
  await open(page, `${COMPARE}?fonts=amiri,sawa-serif`);

  await page.locator("[data-feature-panel] > summary").click();
  await expect(page.locator('[data-feature="rlig"]')).toBeDisabled();
  await page.locator('[data-feature="ss01"]').check();

  expect(search(page).get("feat")).toBe("ss01");
  const settings = await page
    .locator('[data-pane-font="amiri"] [data-pane-body]')
    .evaluate((body) => getComputedStyle(body).fontFeatureSettings);
  expect(settings).toBe('"ss01"');
  await expect(page.locator('[data-pane-font="sawa-serif"] [data-pane-features]')).toHaveText(
    /ss01/,
  );
  await expect(page.locator('[data-pane-font="amiri"] [data-pane-features]')).toBeHidden();
});

test("the metrics overlay draws each Sawa Serif guide on every line at its offset", async ({
  page,
}) => {
  const info = data.fonts["sawa-serif"]?.families["sawa-serif"];
  if (!info) {
    throw new Error("fonts.json: no sawa-serif family");
  }
  const size = 32;
  const scale = size / info.unitsPerEm;
  const source = info.typo.useTypoMetrics ? info.typo : info.hhea;
  const ascent = Math.round(source.ascender * scale);
  const lineHeight = ascent + Math.round(-source.descender * scale);
  const expected: Record<string, number> = {
    ascender: -ascent,
    capHeight: -(info.capHeight ?? 0) * scale,
    xHeight: -(info.xHeight ?? 0) * scale,
    baseline: 0,
    descender: Math.round(-source.descender * scale),
  };

  await open(page, `${COMPARE}?fonts=sawa-serif&metrics=1`);
  await expect(page.locator("[data-panes]")).toHaveAttribute("data-overlay", "drawn");

  const measured = await page
    .locator("[data-sample-wrap]")
    .first()
    .evaluate((wrap) => {
      const text = wrap.querySelector("[data-sample-text]");
      const top = text?.getBoundingClientRect().top ?? 0;
      const guides: Record<string, number[]> = {};
      for (const guide of wrap.querySelectorAll<HTMLElement>("[data-guide]")) {
        const name = guide.dataset.guide ?? "";
        (guides[name] ??= []).push(guide.getBoundingClientRect().top - top);
      }
      return { height: text?.getBoundingClientRect().height ?? 0, guides };
    });

  const lines = Math.round(measured.height / lineHeight);
  expect(lines).toBeGreaterThan(3);
  for (const [name, offset] of Object.entries(expected)) {
    const positions = measured.guides[name] ?? [];
    expect(positions, name).toHaveLength(lines);
    positions.forEach((position, line) => {
      expect(Math.abs(position - (line * lineHeight + ascent + offset)), name).toBeLessThanOrEqual(
        1,
      );
    });
  }
  expect(measured.guides.lineBox).toHaveLength(lines);
});

test("the status pane's guides note that the Arabic fallback's metrics are unknown", async ({
  page,
}) => {
  await open(page, `${COMPARE}?metrics=1`);

  await expect(page.locator('[data-pane-font="status"] [data-pane-metrics]')).toContainText(
    "Source Sans 3",
  );
  await expect(page.locator('[data-pane-font="status"] .metrics-overlay').first()).toBeAttached();
});

test("the quran preset shows the Tanzil verses verbatim with the Tanzil credit", async ({
  page,
}) => {
  const raw = await readFile(path.join(REPO_ROOT, "data/tanzil/uthmani-fatiha.txt"), "utf-8");
  const verses = raw.split("\n").slice(0, 7);
  await open(page, COMPARE);
  await expect(page.locator("[data-tanzil-credit]")).toBeHidden();

  await page.locator("[data-preset]").selectOption("quran");

  await expect(page.locator("[data-tanzil-credit]")).toBeVisible();
  await expect(page.locator("[data-tanzil-link]")).toHaveAttribute("href", "https://tanzil.net");
  const text = await page.locator("[data-sample-text]").first().textContent();
  expect(text).toBe(verses.join("\n"));
});

test("the stress preset captions each test string with its purpose", async ({ page }) => {
  await open(page, `${COMPARE_AR}?preset=stress&fonts=sawa-serif`);

  const captions = await page.locator(".sample-caption").allTextContents();
  expect(captions).toEqual(stressData.tests.map((stressTest) => stressTest.purpose.ar));
  const texts = await page.locator("[data-sample-text]").allTextContents();
  expect(texts).toEqual(stressData.tests.map((stressTest) => stressTest.text));
});

test("side by side shows at most four columns and says so", async ({ page }) => {
  await open(page, `${COMPARE}?view=side&fonts=sawa-serif,sawa-sans,status,amiri,sch`);

  await expect(page.locator("[data-pane]")).toHaveCount(4);
  await expect(page.locator("[data-side-limit]")).toBeVisible();
});

for (const locale of ["en", "ar"] as const) {
  test(`the ${locale} Compare page falls back to stacked with no horizontal scroll at 360px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(
      page,
      `${localizedPath(BASE_PATH, locale, "compare")}?view=side&metrics=1&wf=1&size=144`,
    );

    await expect(page.locator("[data-side-narrow]")).toBeVisible();
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
}
