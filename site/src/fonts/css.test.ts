import { describe, expect, test } from "vitest";
import { fontFaceCss, fontStack } from "./css";
import type { FamilyInfo, FontsData } from "./types";

const FAMILY_INFO: FamilyInfo = {
  unitsPerEm: 1000,
  hhea: { ascender: 800, descender: -200, lineGap: 0 },
  typo: { ascender: 800, descender: -200, lineGap: 0, useTypoMetrics: false },
  win: { ascent: 800, descent: 200 },
  xHeight: 500,
  capHeight: 700,
  features: [],
  scripts: [],
  colr: null,
  cpal: null,
};

const FIXTURE: FontsData = {
  fonts: {
    sawa: {
      name: "Sawa",
      stack: ["sawa"],
      generic: "serif",
      faces: [
        { family: "sawa", weight: 400, style: "normal", file: "sawa/Sawa-Regular.woff2" },
        { family: "sawa", weight: 700, style: "normal", file: "sawa/Sawa-Bold.woff2" },
      ],
      families: { sawa: FAMILY_INFO },
    },
    status: {
      name: "Source Sans 3",
      stack: ["source-sans"],
      generic: "sans-serif",
      faces: [
        {
          family: "source-sans",
          weight: 400,
          style: "normal",
          file: "status/SourceSans3-Regular.woff2",
        },
      ],
      families: { "source-sans": FAMILY_INFO },
    },
    noto: {
      name: "Noto Naskh Arabic + Noto Serif",
      stack: ["noto-serif", "noto-naskh"],
      generic: "serif",
      faces: [
        {
          family: "noto-serif",
          weight: 400,
          style: "normal",
          file: "noto/NotoSerif-Regular.woff2",
        },
      ],
      families: { "noto-serif": FAMILY_INFO },
    },
  },
};

describe("fontFaceCss", () => {
  test("emits one @font-face rule per face across every font", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css.match(/@font-face/g)).toHaveLength(4);
  });

  test("quotes the family name and includes font-display: swap", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain('font-family: "sawa";');
    for (const rule of css.split("\n\n")) {
      expect(rule).toContain("font-display: swap;");
    }
  });

  test("joins a base URL with a trailing slash", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain('url("/sawa-font/fonts/sawa/Sawa-Regular.woff2")');
  });

  test("joins a base URL without a trailing slash", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font");
    expect(css).toContain('url("/sawa-font/fonts/sawa/Sawa-Regular.woff2")');
  });

  test("carries weight and style through to the rule", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain("font-weight: 700;");
    expect(css).toContain("font-style: normal;");
  });
});

describe("fontStack", () => {
  test("ends a single-family stack with the serif fallback", () => {
    expect(fontStack(FIXTURE, "sawa")).toBe('"sawa", serif');
  });

  test("ends status quo's stack with the sans-serif fallback", () => {
    expect(fontStack(FIXTURE, "status")).toBe('"source-sans", sans-serif');
  });

  test("keeps a multi-family stack in its declared order", () => {
    expect(fontStack(FIXTURE, "noto")).toBe('"noto-serif", "noto-naskh", serif');
  });

  test("throws for an unknown font id", () => {
    expect(() => fontStack(FIXTURE, "nope")).toThrow(/unknown font id/);
  });
});
