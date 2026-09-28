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
  axes: [],
  instances: [],
};

const FIXTURE: FontsData = {
  fonts: {
    amiri: {
      name: "Amiri",
      stack: ["amiri"],
      generic: "serif",
      faces: [
        { family: "amiri", weight: 400, style: "normal", file: "amiri/Amiri-Regular.woff2" },
        { family: "amiri", weight: 700, style: "normal", file: "amiri/Amiri-Bold.woff2" },
      ],
      families: { amiri: FAMILY_INFO },
    },
    "sawa-mono": {
      name: "Sawa Mono",
      stack: ["sawa-mono"],
      generic: "monospace",
      faces: [
        {
          family: "sawa-mono",
          weight: [200, 700],
          style: "normal",
          file: "sawa-mono/SawaMono.woff2",
        },
      ],
      families: { "sawa-mono": FAMILY_INFO },
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
    expect(css.match(/@font-face/g)).toHaveLength(5);
  });

  test("quotes the family name and includes font-display: swap", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain('font-family: "amiri";');
    for (const rule of css.split("\n\n")) {
      expect(rule).toContain("font-display: swap;");
    }
  });

  test("joins a base URL with a trailing slash", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain('url("/sawa-font/fonts/amiri/Amiri-Regular.woff2")');
  });

  test("joins a base URL without a trailing slash", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font");
    expect(css).toContain('url("/sawa-font/fonts/amiri/Amiri-Regular.woff2")');
  });

  test("carries weight and style through to the rule", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain("font-weight: 700;");
    expect(css).toContain("font-style: normal;");
  });

  test("writes a variable face's wght range as a two-value font-weight", () => {
    const css = fontFaceCss(FIXTURE, "/sawa-font/");
    expect(css).toContain("font-weight: 200 700;");
  });
});

describe("fontStack", () => {
  test("ends a single-family stack with the serif fallback", () => {
    expect(fontStack(FIXTURE, "amiri")).toBe('"amiri", serif');
  });

  test("ends a monospace font's stack with the monospace fallback", () => {
    expect(fontStack(FIXTURE, "sawa-mono")).toBe('"sawa-mono", monospace');
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
