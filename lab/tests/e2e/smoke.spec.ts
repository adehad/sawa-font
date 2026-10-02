import { readFile } from "node:fs/promises";
import { type Locator, type Page, expect, test } from "@playwright/test";

async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle to drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
  await page.mouse.up();
}

async function exported(page: Page, button: string): Promise<any> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  return JSON.parse(await readFile((await (await download).path()) ?? "", "utf8"));
}

test("inspect a cell, drag its mark, pin a note and export both files", async ({ page }) => {
  await page.goto("./?mark=fatha");
  const cell = page.locator('[data-cell="U+0628|medial"]');
  await expect(cell).toContainText(/clear|clash/);
  await cell.click();
  await expect(page).toHaveURL(/letter=U%2B0628&form=medial/);
  await expect(page.locator("#inspector-title")).toContainText("beh medial + fatha");

  await drag(page, page.locator('.handle[data-form="medial"]').first(), 30, -30);
  await expect(page.locator("#offset-0-x")).not.toHaveValue("0");
  await expect(page.locator("#offset-0-y")).not.toHaveValue("0");

  const column = await page
    .locator("svg.big .form-label")
    .filter({ hasText: /^medial$/ })
    .boundingBox();
  if (!column) throw new Error("no medial column");
  await page.mouse.click(column.x + column.width / 2, column.y + 60);
  await page.locator("#note-tag").selectOption("too-high");
  await page.locator("#note-text").fill("Smoke test note");
  await page.getByRole("button", { name: "Pin note" }).click();
  await expect(page.locator(".notes .note")).toContainText("Smoke test note");

  const notes = await exported(page, "Export annotations.json");
  expect(notes.schema).toBe("sawa-lab/annotations");
  expect(notes.notes).toHaveLength(1);
  expect(notes.notes[0].key).toEqual({ letter: "U+0628", form: "medial", marks: ["U+064E"] });

  const overrides = await exported(page, "Export overrides.json");
  expect(overrides.version).toBe(2);
  expect(overrides.marks).toHaveLength(1);
  expect(overrides.marks[0].wght).toBe(400);
  expect(overrides.marks[0].marks[0].dx).toBeGreaterThan(0);
  expect(overrides.marks[0].marks[0].dy).toBeGreaterThan(0);
});

test("drag a letter and one of its dots, undo, and export the glyph offsets", async ({ page }) => {
  await page.goto("./?letter=U%2B062A&form=initial&mark=fatha&drag=letter");
  await expect(page.locator("#inspector-title")).toContainText("teh initial + fatha");
  const readout = page.locator(".readout");
  const before = await readout.textContent();

  const bodyY = page.locator("#body-y");
  const dotX = page.locator("#dot-0-x");
  await drag(page, page.locator('.handle-body[data-form="initial"]'), 0, -30);
  await expect(bodyY).not.toHaveValue("0");
  const lifted = Number(await bodyY.inputValue());
  expect(lifted).toBeGreaterThan(50);
  await expect(readout).not.toHaveText(before ?? "");
  await expect(page.getByTestId("line-box-change")).toBeVisible();

  await page.getByLabel("Dots", { exact: true }).check();
  await expect(page).toHaveURL(/drag=dot/);
  await drag(page, page.locator('.handle-dots[data-form="initial"]').first(), 15, 0);
  await expect(dotX).not.toHaveValue("0");
  const shifted = await dotX.inputValue();
  await expect(bodyY).toHaveValue(String(lifted));

  await page.keyboard.press("Control+z");
  await expect(dotX).toHaveValue("0");
  await expect(bodyY).toHaveValue(String(lifted));
  await page.keyboard.press("Control+Shift+z");
  await expect(dotX).toHaveValue(shifted);

  const overrides = await exported(page, "Export overrides.json");
  expect(overrides.schema).toBe("sawa-lab/overrides");
  expect(overrides.version).toBe(2);
  expect(overrides.glyphs).toEqual([
    expect.objectContaining({
      glyph: "uni066E.init.wide",
      usedBy: expect.arrayContaining(["teh initial", "theh initial", "yeh initial"]),
      wght: 400,
      body: { dx: 0, dy: lifted },
      dots: [{ part: "twodotshorizontalabovear", dx: Number(shifted), dy: 0 }],
    }),
  ]);
});

test("show every form right to left and compare with the baked preview", async ({ page }) => {
  await page.goto("./?letter=U%2B0628&form=initial&mark=kasra");
  const labels = page.locator("svg.big .form-label");
  await expect(labels).toHaveText(["final", "medial", "initial", "isolated"]);
  const boxes = await Promise.all(
    ["final", "isolated"].map(async (form) =>
      labels.filter({ hasText: new RegExp(`^${form}$`) }).boundingBox(),
    ),
  );
  expect(boxes[0]?.x ?? 0).toBeLessThan(boxes[1]?.x ?? 0);
  await expect(page.locator("table.matrix")).toHaveAttribute("dir", "rtl");

  await labels.filter({ hasText: /^medial$/ }).click();
  await expect(page).toHaveURL(/form=medial/);

  const baked = page.getByLabel(/Show baked preview/);
  await expect(baked).toBeEnabled();
  await baked.check();
  await expect(page).toHaveURL(/baked=on/);
  await expect(page.locator("#envelope-title")).toContainText("baked preview");
  await expect(page.locator(".handle").first()).toHaveClass(/disabled/);
  await baked.uncheck();
  await expect(page.locator(".handle").first()).not.toHaveClass(/disabled/);
});
