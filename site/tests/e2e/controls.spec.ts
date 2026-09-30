import { expect, test, type Page } from "@playwright/test";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const SPECIMEN = localizedPath(BASE_PATH, "en", "specimen");
const SPECIMEN_AR = localizedPath(BASE_PATH, "ar", "specimen");

async function top(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the control column is named by its heading and stays put while the page scrolls", async ({
    page,
  }) => {
    await page.goto(SPECIMEN);
    const dock = page.getByRole("complementary", {
      name: "These settings change every sample on this page",
    });
    await expect(dock).toBeVisible();
    await expect(page.locator("[data-dock-toggle]")).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => top(page, "[data-dock]")).toBeLessThan(40);
    const pinned = await top(page, "[data-dock]");
    await page.evaluate(() => window.scrollTo(0, 3000));
    await expect.poll(() => top(page, "[data-dock]")).toBe(pinned);
    await expect(page.locator("[data-weight]")).toBeInViewport();
  });

  test("scrolling a section into view marks the controls that change it", async ({ page }) => {
    await page.goto(SPECIMEN);
    const palette = page.locator('[data-dock] [data-control-group="palette"]');
    const grid = page.locator('[data-dock] [data-control-group="grid"]');

    await page.locator("[data-tashkeel]").evaluate((element) => element.scrollIntoView());
    await expect(palette).toHaveAttribute("aria-current", "true");
    await expect(palette).toBeInViewport();
    await expect(grid).not.toHaveAttribute("aria-current");

    await page.locator("[data-line-demo]").evaluate((element) => element.scrollIntoView());
    await expect(grid).toHaveAttribute("aria-current", "true");
    await expect(palette).not.toHaveAttribute("aria-current");
  });

  test("a section's Controlled by chip focuses that control's current choice", async ({ page }) => {
    await page.goto(SPECIMEN);
    const chips = page.getByRole("group", { name: "Controlled by" });
    await expect(chips.first()).toBeVisible();

    await page.locator('[data-tashkeel] [data-reveal-control="palette"]').click();
    await expect(
      page.locator('[data-control-group="palette"] [data-palette="groups"]'),
    ).toBeFocused();

    await page.locator('[data-waterfall] [data-reveal-control="sample"]').click();
    await expect(page.locator("[data-sample-input]")).toBeFocused();
  });

  test("the palette chip is hidden with the palette control for a family without colours", async ({
    page,
  }) => {
    await page.goto(`${SPECIMEN}?fam=sawa-mono`);
    await expect(page.locator('[data-tashkeel] [data-reveal-control="palette"]')).toBeHidden();
    await expect(page.locator('[data-tashkeel] [data-reveal-control="family"]')).toBeVisible();
  });

  test("the control column sits on the inline-start side in both directions", async ({ page }) => {
    for (const [url, side] of [
      [SPECIMEN, "left"],
      [SPECIMEN_AR, "right"],
    ] as const) {
      await page.goto(url);
      const dock = await page.locator("[data-dock]").boundingBox();
      const content = await page.locator(".landing").boundingBox();
      expect(dock).not.toBeNull();
      expect(content).not.toBeNull();
      if (dock && content) {
        if (side === "left") {
          expect(dock.x + dock.width).toBeLessThan(content.x);
        } else {
          expect(dock.x).toBeGreaterThan(content.x + content.width);
        }
      }
    }
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test("the top bar collapses to a summary and expands on tap", async ({ page }) => {
    await page.goto(SPECIMEN);
    const toggle = page.locator("[data-dock-toggle]");
    const panel = page.locator("[data-dock-panel]");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(toggle).toContainText("Sawa Serif · 400 · 32 px · Groups");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();

    await page.locator('[data-family-button="sawa-mono"]').click();
    await expect(toggle).toContainText("Sawa Mono · 400 · 32 px");
    await expect(toggle).not.toContainText("Groups");
    expect(new URL(page.url()).searchParams.get("fam")).toBe("sawa-mono");

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("a Controlled by chip opens the top bar at its control", async ({ page }) => {
    await page.goto(SPECIMEN);
    await page.locator('[data-line-demo] [data-reveal-control="grid"]').click();
    await expect(page.locator("[data-dock-toggle]")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-grid-toggle]")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-line-demo]")).toHaveAttribute("data-grid", "on");
    expect(new URL(page.url()).searchParams.get("metrics")).toBe("1");
  });

  test("the top bar stays at the top of the viewport while the page scrolls", async ({ page }) => {
    await page.goto(SPECIMEN);
    await page.evaluate(() => window.scrollTo(0, 2500));
    await expect.poll(() => top(page, "[data-dock]")).toBe(0);
  });
});
