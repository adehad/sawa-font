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

function scope(page: Page, label: string): Locator {
  return page.getByRole("radio", { name: new RegExp(`^${label}`) });
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
  await expect(page.locator("#edit-x")).not.toHaveValue("0");
  await expect(page.locator("#edit-y")).not.toHaveValue("0");

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
  expect(overrides.version).toBe(3);
  expect(overrides.edits).toHaveLength(1);
  const [edit] = overrides.edits;
  expect(edit).toMatchObject({
    mechanism: "pair",
    scope: "pair",
    target: { base: "uni066E.medi", mark: "uni064E" },
    lookup: "new",
  });
  expect(edit.values["400"].dx).toBeGreaterThan(0);
  expect(edit.values["400"].dy).toBeGreaterThan(0);
  expect(edit.values["700"]).toBeNull();
});

test("drag a letter and one of its dots, undo, and export the outline edits", async ({ page }) => {
  await page.goto("./?letter=U%2B062A&form=initial&mark=fatha&drag=letter");
  await expect(page.locator("#inspector-title")).toContainText("teh initial + fatha");
  const readout = page.locator(".readout");
  const before = await readout.textContent();

  await drag(page, page.locator('.handle-body[data-form="initial"]'), 0, -30);
  const lifted = Number(await page.locator("#edit-y").inputValue());
  expect(lifted).toBeGreaterThan(50);
  await expect(readout).not.toHaveText(before ?? "");
  await expect(page.getByTestId("line-box-change")).toBeVisible();

  await page.getByLabel("Dots", { exact: true }).check();
  await expect(page).toHaveURL(/drag=dot/);
  await scope(page, "This glyph's outline").check();
  await drag(page, page.locator('.handle-dots[data-form="initial"]').first(), 15, 0);
  const dotX = page.locator("#edit-x");
  await expect(dotX).not.toHaveValue("0");
  const shifted = await dotX.inputValue();

  await page.keyboard.press("Control+z");
  await expect(dotX).toHaveValue("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(dotX).toHaveValue(shifted);

  const overrides = await exported(page, "Export overrides.json");
  expect(overrides.schema).toBe("sawa-lab/overrides");
  expect(overrides.edits).toEqual([
    expect.objectContaining({
      mechanism: "outline",
      scope: "outline",
      target: { glyph: "uni066E.init.wide", part: "body" },
      usedBy: expect.arrayContaining(["teh initial", "theh initial", "yeh initial"]),
      values: { "400": { dx: 0, dy: lifted }, "700": null },
    }),
    expect.objectContaining({
      mechanism: "outline",
      target: { glyph: "uni066E.init.wide", part: "twodotshorizontalabovear" },
      values: { "400": { dx: Number(shifted), dy: 0 }, "700": null },
    }),
  ]);
});

test("drag an anchor and see the cells it reaches outlined", async ({ page }) => {
  await page.goto("./?letter=U%2B0628&form=medial&mark=fatha&drag=anchor");
  const blast = page.getByTestId("blast");
  await expect(page.locator(".part-list .chip[aria-pressed=true]")).toContainText("top_27");
  await scope(page, "All marks of this class on this glyph").check();
  const count = Number(await blast.locator("#blast-count").textContent());
  expect(count).toBeGreaterThan(5);
  await expect(page.locator("table.matrix .cell.affected")).not.toHaveCount(0);
  await expect(blast.locator(".blast-cell").first()).toBeVisible();

  const handle = page.locator('.handle-anchor.active[data-form="medial"]');
  await drag(page, handle, 0, -25);
  await expect(page.locator("#edit-y")).not.toHaveValue("0");
  await expect(page.locator(".cell-edit")).toContainText("anchor:uni066E.medi:27.0");

  const overrides = await exported(page, "Export overrides.json");
  expect(overrides.edits[0]).toMatchObject({
    mechanism: "anchor",
    scope: "mark-class",
    target: { glyph: "uni066E.medi", class: "27.0" },
    lookup: 27,
  });
});

test("apply a pair-only edit that reaches one base and mark", async ({ page }) => {
  await page.goto("./?letter=U%2B062C&form=initial&mark=kasra");
  await expect(scope(page, "This pair only")).toBeChecked();
  const pairCount = Number(await page.locator("#blast-count").textContent());
  await scope(page, "All marks of this class on this glyph").check();
  expect(Number(await page.locator("#blast-count").textContent())).toBeGreaterThanOrEqual(
    pairCount,
  );
  await scope(page, "This pair only").check();
  await page.locator("#edit-y").fill("-30");
  await page.locator("#edit-y").press("Enter");
  await expect(page.locator(".cell-edit")).toContainText("pair:");
  const overrides = await exported(page, "Export overrides.json");
  expect(overrides.edits).toEqual([
    expect.objectContaining({
      mechanism: "pair",
      values: { "400": { dx: 0, dy: -30 }, "700": null },
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
