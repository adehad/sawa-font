import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MARK_GROUPS } from "./groups";
import { CPAL_PALETTES, GRAY_COLOURS, groupColours, markTokens } from "./palettes";

const GLOBAL_CSS = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

/** A light-dark() token from global.css, as its two #rrggbb colours. */
function token(name: string): { light: string; dark: string } {
  const match = new RegExp(`${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\);`).exec(
    GLOBAL_CSS,
  );
  if (!match?.[1] || !match[2]) {
    throw new Error(`global.css has no light-dark() ${name}`);
  }
  return { light: match[1], dark: match[2] };
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const BACKGROUNDS = [token("--color-bg"), token("--color-surface")];
const COLOURS = [
  ...MARK_GROUPS.map((group) => ({ name: group.id, ...groupColours(group.id) })),
  { name: "gray", ...GRAY_COLOURS },
];

describe("mark colours", () => {
  test.each(COLOURS)("$name keeps 3:1 against the light and dark backgrounds", (colour) => {
    for (const background of BACKGROUNDS) {
      expect(contrast(colour.light, background.light)).toBeGreaterThanOrEqual(3);
      expect(contrast(colour.dark, background.dark)).toBeGreaterThanOrEqual(3);
    }
  });

  test("the --mark-* tokens come from palettes.json, not global.css", () => {
    expect(GLOBAL_CSS).not.toMatch(/--mark-[a-z]+:/);
    const { light, dark } = groupColours("short");
    expect(markTokens()).toContain(`--mark-short: light-dark(${light}, ${dark});`);
    expect(markTokens()).toHaveLength(MARK_GROUPS.length);
  });
});

test("the CPAL palettes are groups and gray, each in light then dark", () => {
  expect(CPAL_PALETTES.map(({ palette, scheme }) => `${palette}-${scheme}`)).toEqual([
    "groups-light",
    "groups-dark",
    "gray-light",
    "gray-dark",
  ]);
});
