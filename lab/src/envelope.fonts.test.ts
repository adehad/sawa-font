import { describe, expect, it } from "vitest";
import { NO_EDITS, type Target, moveBy } from "./edits";
import { labModel, present as written } from "./fixture";
import type { Model } from "./model";

const present = written("lab.json", "positioning.json");
if (!present && process.env.CI) {
  throw new Error("lab.json is missing: run `uv run --group build sawa lab fonts` first");
}

function model(): Model {
  return labModel(NO_EDITS);
}

describe.skipIf(!present)("the calibrated font's everyday envelope", () => {
  it("matches the search behind the approved line box (sheet 02)", () => {
    const lab = model();
    const env = lab.arabicEnvelope("calib");
    expect(env.top / lab.upm).toBeCloseTo(1.503, 2);
    expect(Math.abs(env.top / lab.upm - 1.503)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(env.bottom / lab.upm + 0.799)).toBeLessThanOrEqual(0.002);
    const tallest = env.cells.get(env.tallest[0]?.key ?? "");
    const deepest = env.cells.get(env.deepest[0]?.key ?? "");
    expect([tallest?.letter.char, tallest?.form, tallest?.mark.id]).toEqual([
      "ث",
      "initial",
      "shadda-kasratan",
    ]);
    expect([deepest?.letter.char, deepest?.form, deepest?.mark.id]).toEqual([
      "ي",
      "isolated",
      "kasratan",
    ]);
  });

  it("places the approved 2.06 em line box inside it, in the corpus's proportion", () => {
    const lab = model();
    const approved = lab.approvedLineBox();
    const { coverage } = lab.data.approvedLineBox;
    expect(approved.height).toBe(2060);
    expect(approved.top).toBeLessThan(lab.arabicEnvelope("calib").top);
    expect(approved.bottom).toBeGreaterThan(lab.arabicEnvelope("calib").bottom);
    expect(approved.top / -approved.bottom).toBeCloseTo(coverage.top / -coverage.bottom, 1);
  });

  it("reaches further with impossible combinations included", () => {
    const lab = model();
    expect(lab.arabicEnvelope("calib", true).top).toBeGreaterThan(lab.arabicEnvelope("calib").top);
  });

  it("recomputes from edited glyphs, so lifting yeh's bodies raises the bottom", () => {
    const lab = model();
    const before = lab.arabicEnvelope("calib");
    const yeh = lab.letters.get("U+064A");
    const kasratan = lab.marks.get("kasratan");
    if (!yeh || !kasratan) throw new Error("no yeh or kasratan");
    const cell = { letter: yeh, form: "isolated" as const, mark: kasratan };
    const bodies = (["isolated", "final"] as const).map((form): Target => ({
      mechanism: "outline",
      glyph: lab.letterForm(yeh, form)?.body ?? "",
      part: "body",
    }));
    const boxBefore = lab.box("calib", cell);
    lab.edits = moveBy(NO_EDITS, bodies, "all-forms", [0, 150], {
      build: lab.data.build,
      wght: lab.data.wght,
      now: "2026-10-02T10:00:00.000Z",
      usedBy: (g) => lab.usedBy(g),
    });
    const after = lab.arabicEnvelope("calib");
    expect(lab.box("calib", cell)?.y0).toBeCloseTo((boxBefore?.y0 ?? 0) + 150);
    expect(after.bottom).toBeGreaterThan(before.bottom);
    expect(after.deepest[0]?.key).not.toBe(before.deepest[0]?.key);
    expect(lab.fontEnvelope("calib").bottom).toBe(before.bottom);
  });
});
