import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cellCodepoints, formatCodepoint } from "./cells";
import { HbFont, harfbuzzVersion } from "./hb";
import type { LabData } from "./types";

const FONTS = fileURLToPath(new URL("../public/fonts/", import.meta.url));
const EXPECTED = `${FONTS}expected-shaping.json`;

interface ExpectedCell {
  letter: string;
  form: LabData["matrix"]["forms"][number];
  mark: string;
  codepoints: string[];
  glyphs: Record<string, number[][]>;
}

interface Expected {
  harfbuzz: { harfbuzz: string; uharfbuzz: string };
  cells: ExpectedCell[];
}

const present = existsSync(EXPECTED);
if (!present && process.env.CI) {
  throw new Error(`${EXPECTED} is missing: run \`uv run --group build sawa lab fonts\` first`);
}

describe.skipIf(!present)("harfbuzzjs matches uharfbuzz", () => {
  it("shapes every matrix cell the way the font build does", () => {
    const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Expected;
    const lab = JSON.parse(readFileSync(`${FONTS}lab.json`, "utf8")) as LabData;
    const fonts: Record<string, HbFont> = {
      calib: new HbFont(readFileSync(`${FONTS}${lab.fonts.calib}`)),
      notoArabic: new HbFont(readFileSync(`${FONTS}${lab.fonts.notoArabic}`)),
    };
    const versions = `harfbuzzjs ships HarfBuzz ${harfbuzzVersion}; uharfbuzz ${expected.harfbuzz.uharfbuzz} ships HarfBuzz ${expected.harfbuzz.harfbuzz}`;
    const letters = new Map(lab.matrix.letters.map((l) => [l.codepoint, l]));
    const marks = new Map(
      [...lab.matrix.everyday, ...lab.matrix.niche].map((m) => [m.id, m.codepoints]),
    );
    for (const cell of expected.cells) {
      const name = `${cell.letter} ${cell.form} ${cell.mark}`;
      const letter = letters.get(cell.letter);
      const ours = cellCodepoints(letter?.char ?? "", cell.form, marks.get(cell.mark) ?? []).map(
        formatCodepoint,
      );
      expect(ours, `${name}: the lab builds a different string than the font build`).toEqual(
        cell.codepoints,
      );
      for (const [key, glyphs] of Object.entries(cell.glyphs)) {
        const font = fonts[key];
        if (!font) throw new Error(`no font ${key} for ${name}`);
        const shaped = font
          .shape(cell.codepoints.map((cp) => Number.parseInt(cp.slice(2), 16)))
          .map((g) => [g.gid, g.cluster, g.xAdvance, g.xOffset, g.yOffset]);
        expect(shaped, `${name} in ${key} shapes differently (${versions})`).toEqual(glyphs);
      }
    }
  });
});
