import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("inspect a cell, drag its mark, pin a note and export both files", async ({ page }) => {
  await page.goto("./?mark=fatha");
  const cell = page.locator('[data-cell="U+0628|medial"]');
  await expect(cell).toContainText(/clear|clash/);
  await cell.click();
  await expect(page).toHaveURL(/letter=U%2B0628&form=medial/);
  await expect(page.locator("#inspector-title")).toContainText("beh medial + fatha");

  const handle = page.locator(".handle").first();
  const box = await handle.boundingBox();
  if (!box) throw new Error("the mark has no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#offset-0-x")).not.toHaveValue("0");
  await expect(page.locator("#offset-0-y")).not.toHaveValue("0");

  await page.locator("svg.big").click({ position: { x: 200, y: 120 } });
  await page.locator("#note-tag").selectOption("too-high");
  await page.locator("#note-text").fill("Smoke test note");
  await page.getByRole("button", { name: "Pin note" }).click();
  await expect(page.locator(".notes .note")).toContainText("Smoke test note");

  const notesDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export annotations.json" }).click();
  const notes = JSON.parse(await readFile((await (await notesDownload).path()) ?? "", "utf8"));
  expect(notes.schema).toBe("sawa-lab/annotations");
  expect(notes.notes).toHaveLength(1);
  expect(notes.notes[0].key).toEqual({ letter: "U+0628", form: "medial", marks: ["U+064E"] });

  const overridesDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export overrides.json" }).click();
  const overrides = JSON.parse(
    await readFile((await (await overridesDownload).path()) ?? "", "utf8"),
  );
  expect(overrides.overrides).toHaveLength(1);
  expect(overrides.overrides[0].wght).toBe(400);
  expect(overrides.overrides[0].marks[0].dx).toBeGreaterThan(0);
  expect(overrides.overrides[0].marks[0].dy).toBeGreaterThan(0);
});
