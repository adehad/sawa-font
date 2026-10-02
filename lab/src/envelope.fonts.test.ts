import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HbFont } from "./hb";
import { moveBy } from "./edits";
import { NO_OVERRIDES } from "./store";
import { Model } from "./model";
import { DEFAULT_STATE } from "./state";
import type { LabData } from "./types";

const FONTS = fileURLToPath(new URL("../public/fonts/", import.meta.url));
const present = existsSync(`${FONTS}lab.json`);
if (!present && process.env.CI) {
  throw new Error(`${FONTS}lab.json is missing: run \`uv run --group build sawa lab fonts\` first`);
}

function model(): Model {
  const data = JSON.parse(readFileSync(`${FONTS}lab.json`, "utf8")) as LabData;
  const font = (file: string) => new HbFont(readFileSync(`${FONTS}${file}`));
  return new Model(
    data,
    {
      calib: font(data.fonts.calib),
      notoArabic: font(data.fonts.notoArabic),
      notoSans: font(data.fonts.notoSans),
    },
    DEFAULT_STATE,
    [],
    NO_OVERRIDES,
  );
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

  it("centres the approved 2.36 em line box on it", () => {
    const lab = model();
    const approved = lab.approvedLineBox();
    expect(approved.height).toBe(2360);
    expect(approved.top).toBeGreaterThan(lab.arabicEnvelope("calib").top);
    expect(approved.bottom).toBeLessThan(lab.arabicEnvelope("calib").bottom);
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
    const bodies = (["isolated", "final"] as const).map((form) => ({
      kind: "body" as const,
      glyph: lab.letterForm(yeh, form)?.body ?? "",
    }));
    const boxBefore = lab.box("calib", cell);
    lab.overrides = moveBy(NO_OVERRIDES, bodies, [0, 150], {
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
