import { describe, expect, it } from "vitest";
import { compareFont, matchStaticWeight, renderedWeight, waterfallSizes } from "./compare";
import type { FamilyInfo, Face, FontEntry, FontsData } from "./types";

function family(overrides: Partial<FamilyInfo> = {}): FamilyInfo {
  return {
    unitsPerEm: 1000,
    hhea: { ascender: 900, descender: -300, lineGap: 0 },
    typo: { ascender: 1137, descender: -675, lineGap: 0, useTypoMetrics: true },
    win: { ascent: 1498, descent: 675 },
    xHeight: 536,
    capHeight: 714,
    features: ["kern", "liga"],
    scripts: [],
    colr: null,
    cpal: null,
    axes: [],
    instances: [],
    ...overrides,
  };
}

function entry(families: Record<string, FamilyInfo>, faces: Face[]): FontEntry {
  return { name: "x", stack: Object.keys(families), generic: "serif", faces, families };
}

const data: FontsData = {
  fonts: {
    "sawa-sans": entry(
      { "sawa-sans": family({ axes: [{ tag: "wght", min: 100, default: 400, max: 900 }] }) },
      [{ family: "sawa-sans", weight: [100, 900], style: "normal", file: "s.woff2" }],
    ),
    "sawa-serif": entry(
      { "sawa-serif": family({ axes: [{ tag: "wght", min: 400, default: 400, max: 700 }] }) },
      [{ family: "sawa-serif", weight: [400, 700], style: "normal", file: "s.woff2" }],
    ),
    amiri: entry({ amiri: family() }, [
      { family: "amiri", weight: 400, style: "normal", file: "a.woff2" },
      { family: "amiri", weight: 700, style: "normal", file: "b.woff2" },
      { family: "amiri", weight: 400, style: "italic", file: "c.woff2" },
    ]),
    noto: entry(
      {
        "noto-serif": family({ features: ["onum", "kern"] }),
        "noto-naskh": family({ features: ["dlig", "kern"], xHeight: 0, capHeight: 0 }),
      },
      [{ family: "noto-serif", weight: 400, style: "normal", file: "n.woff2" }],
    ),
  },
};

describe("compareFont", () => {
  it("reads Sawa Sans's axis and metrics", () => {
    const font = compareFont(data, "sawa-sans");
    expect(font.axis).toEqual({ min: 100, default: 400, max: 900 });
    expect(font.stack).toMatch(/^"sawa-sans", /);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.metrics.xHeight).toBeGreaterThan(0);
  });

  it("lists a static font's face weights and no axis", () => {
    const font = compareFont(data, "amiri");
    expect(font.axis).toBeNull();
    expect(font.staticWeights).toEqual([400, 700]);
  });

  it("unions the features of every family in the stack", () => {
    const noto = compareFont(data, "noto");
    expect(noto.features).toEqual(["dlig", "kern", "onum"]);
  });

  it("takes metrics from the primary family and reports a zero x-height as unknown", () => {
    expect(compareFont(data, "noto").metrics.xHeight).toBe(536);
    const naskhFirst: FontsData = {
      fonts: { noto: { ...data.fonts.noto, stack: ["noto-naskh", "noto-serif"] } },
    };
    expect(compareFont(naskhFirst, "noto").metrics.xHeight).toBeNull();
  });
});

describe("matchStaticWeight", () => {
  const weights = [400, 700];

  it("returns an exact match", () => {
    expect(matchStaticWeight(700, weights)).toBe(700);
  });

  it("goes lighter first below 400", () => {
    expect(matchStaticWeight(300, [200, 400])).toBe(200);
    expect(matchStaticWeight(100, weights)).toBe(400);
  });

  it("tries up to 500 then lighter between 400 and 500", () => {
    expect(matchStaticWeight(450, weights)).toBe(400);
    expect(matchStaticWeight(450, [300, 500, 700])).toBe(500);
  });

  it("goes heavier first above 500", () => {
    expect(matchStaticWeight(550, weights)).toBe(700);
    expect(matchStaticWeight(800, weights)).toBe(700);
  });
});

describe("renderedWeight", () => {
  it("clamps to a variable font's axis", () => {
    const serif = compareFont(data, "sawa-serif");
    expect(renderedWeight(900, serif)).toEqual({ weight: 700, nearest: false });
    expect(renderedWeight(undefined, serif)).toEqual({ weight: 400, nearest: false });
  });

  it("names the nearest static weight for a static font", () => {
    const amiri = compareFont(data, "amiri");
    expect(renderedWeight(612, amiri)).toEqual({ weight: 700, nearest: true });
    expect(renderedWeight(undefined, amiri)).toEqual({ weight: 400, nearest: false });
  });
});

describe("waterfallSizes", () => {
  it("ends at the chosen size", () => {
    expect(waterfallSizes(32)).toEqual([12, 16, 20, 24, 32]);
    expect(waterfallSizes(12)).toEqual([12]);
    expect(waterfallSizes(144)).toEqual([12, 16, 20, 24, 32, 48, 72, 96, 120, 144]);
  });
});
