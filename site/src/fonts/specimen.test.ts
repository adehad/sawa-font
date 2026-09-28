import { describe, expect, test } from "vitest";
import {
  clampWeight,
  effectiveWeight,
  familyInfo,
  lineBoxEm,
  lineMetrics,
  normalizeSelection,
  paletteCss,
  specimenCss,
  specimenFamilies,
  storedWeight,
} from "./specimen";
import type { FamilyInfo, FontsData } from "./types";
import { defaultState } from "../state/url";

function family(overrides: Partial<FamilyInfo> = {}): FamilyInfo {
  return {
    unitsPerEm: 1000,
    hhea: { ascender: 900, descender: -300, lineGap: 0 },
    typo: { ascender: 1137, descender: -675, lineGap: 0, useTypoMetrics: true },
    win: { ascent: 1498, descent: 675 },
    xHeight: 500,
    capHeight: 700,
    features: [],
    scripts: [],
    colr: null,
    cpal: null,
    axes: [{ tag: "wght", min: 400, default: 400, max: 700 }],
    instances: [
      { name: "Regular", coords: { wght: 400 } },
      { name: "Bold", coords: { wght: 700 } },
    ],
    ...overrides,
  };
}

function entry(id: string, info: FamilyInfo) {
  return {
    name: id,
    stack: [id],
    generic: "serif" as const,
    faces: [{ family: id, weight: [400, 700] as const, style: "normal" as const, file: "x.woff2" }],
    families: { [id]: info },
  };
}

function fixture(serif: FamilyInfo = family()): FontsData {
  return {
    fonts: {
      "sawa-serif": entry("sawa-serif", serif),
      "sawa-sans": entry(
        "sawa-sans",
        family({ axes: [{ tag: "wght", min: 100, default: 400, max: 900 }] }),
      ),
      "sawa-mono": entry(
        "sawa-mono",
        family({ unitsPerEm: 2048, axes: [{ tag: "wght", min: 200, default: 400, max: 700 }] }),
      ),
    },
  };
}

const AXIS = { min: 400, default: 400, max: 700 };

describe("lineMetrics and lineBoxEm", () => {
  test("use typo metrics when USE_TYPO_METRICS is set", () => {
    const metrics = lineMetrics(family());
    expect(metrics.ascender).toBe(1137);
    expect(lineBoxEm(metrics)).toBeCloseTo(1.812);
  });

  test("fall back to hhea when USE_TYPO_METRICS is off", () => {
    const info = family({
      typo: { ascender: 1, descender: -1, lineGap: 0, useTypoMetrics: false },
    });
    expect(lineBoxEm(lineMetrics(info))).toBeCloseTo(1.2);
  });

  test("include the line gap and divide by the font's own UPM", () => {
    expect(
      lineBoxEm({ unitsPerEm: 2048, ascender: 1900, descender: -480, lineGap: 100 }),
    ).toBeCloseTo(2480 / 2048);
  });
});

describe("weight clamping", () => {
  test("clamps to the axis and rounds to whole weights", () => {
    expect(clampWeight(900, AXIS)).toBe(700);
    expect(clampWeight(100, AXIS)).toBe(400);
    expect(clampWeight(512.6, AXIS)).toBe(513);
  });

  test("an absent weight renders at the axis default", () => {
    expect(effectiveWeight(undefined, AXIS)).toBe(400);
  });

  test("the stored weight drops the default", () => {
    expect(storedWeight(400, AXIS)).toBeUndefined();
    expect(storedWeight(100, AXIS)).toBeUndefined();
    expect(storedWeight(900, AXIS)).toBe(700);
  });

  test("normalizeSelection clamps to the selected family's own axis", () => {
    const families = specimenFamilies(fixture());
    expect(normalizeSelection({ ...defaultState(), weight: 900 }, families).weight).toBe(700);
    expect(
      normalizeSelection({ ...defaultState(), family: "sawa-sans", weight: 900 }, families).weight,
    ).toBe(900);
  });

  test("normalizeSelection returns the same state when nothing changes", () => {
    const state = { ...defaultState(), weight: 500 };
    expect(normalizeSelection(state, specimenFamilies(fixture()))).toBe(state);
  });
});

describe("familyInfo", () => {
  test("reads the wght axis and named instances", () => {
    const info = familyInfo(fixture(), "sawa-serif");
    expect(info.axis).toEqual(AXIS);
    expect(info.instances).toEqual([
      { name: "Regular", wght: 400 },
      { name: "Bold", wght: 700 },
    ]);
    expect(info.hasPalettes).toBe(false);
  });

  test("throws when the family has no wght axis", () => {
    expect(() => familyInfo(fixture(family({ axes: [] })), "sawa-serif")).toThrow(/wght/);
  });
});

describe("specimenCss", () => {
  test("writes each family's stack, default weight and metrics", () => {
    const css = specimenCss(specimenFamilies(fixture()), {
      stack: '"source-sans", sans-serif',
      metrics: { unitsPerEm: 1000, ascender: 1000, descender: -326, lineGap: 0 },
    });
    expect(css).toContain('.landing[data-family="sawa-sans"] {');
    expect(css).toContain("--wght-default: 400;");
    expect(css).toContain("--line-ascent: 1.137;");
    expect(css).toContain("--line-descent: 0.675;");
    expect(css).toContain('[data-font="sawa-mono"] {');
    expect(css).toContain('font-family: "source-sans", sans-serif;');
  });
});

describe("paletteCss", () => {
  test("is empty when no family has CPAL", () => {
    expect(paletteCss(fixture())).toBe("");
  });

  test("names one rule per palette the font has", () => {
    const css = paletteCss(fixture(family({ cpal: { palettes: 2, types: [null, null] } })));
    expect(css).toContain("@font-palette-values --sawa-mono {");
    expect(css).toContain("@font-palette-values --sawa-gray {");
    expect(css).not.toContain("--sawa-groups");
    expect(css).toContain("base-palette: 1;");
  });
});
