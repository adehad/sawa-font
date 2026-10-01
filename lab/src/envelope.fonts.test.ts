import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HbFont } from "./hb";
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
    [],
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
});
