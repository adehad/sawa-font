import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cellCodepoints, formatCodepoint } from "./cells";
import { NO_EDITS } from "./edits";
import { labModel } from "./fixture";
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
  lines: { text: string; glyphs: Record<string, number[][]> }[];
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
    expect(expected.lines.length).toBeGreaterThan(0);
    for (const line of expected.lines) {
      const codepoints: number[] = [];
      for (const char of line.text) codepoints.push(char.codePointAt(0) ?? 0);
      for (const [key, glyphs] of Object.entries(line.glyphs)) {
        const shaped = fonts[key]
          ?.shape(codepoints)
          .map((g) => [g.gid, g.cluster, g.xAdvance, g.xOffset, g.yOffset]);
        expect(shaped, `"${line.text}" in ${key} shapes differently (${versions})`).toEqual(glyphs);
      }
    }
  });

  it("finds what each mark hangs on the way `sawa lab fonts` does", () => {
    const lab = labModel(NO_EDITS);
    const cells = lab.positioning.cells;
    expect(Object.keys(cells).length).toBeGreaterThan(1000);
    for (const letter of lab.data.matrix.letters)
      for (const form of letter.forms)
        for (const mark of lab.marks.values()) {
          const id = `${letter.codepoint}|${form}|${mark.id}`;
          const expected = cells[id];
          if (!expected) throw new Error(`positioning.json has no cell ${id}`);
          const cell = { letter, form, mark };
          const layout = lab.layout("calib", cell);
          expect(
            layout.pieces.map((p) => p.name),
            `${id}: glyphs`,
          ).toEqual(expected.glyphs);
          const found = lab
            .cellAttachments("calib", cell)
            .map((a) => (a ? [a.parent, a.cls, a.kind] : null));
          expect(found, `${id}: attachments`).toEqual(expected.attach);
        }
  });
});
