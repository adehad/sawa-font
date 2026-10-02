import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cellCodepoints } from "./cells";
import { bounds } from "./geometry";
import { HbFont } from "./hb";
import { type Baked, Model } from "./model";
import { DEFAULT_STATE } from "./state";
import { NO_OVERRIDES } from "./store";
import type { LabData } from "./types";

const FONTS = fileURLToPath(new URL("../public/fonts/", import.meta.url));
const present = existsSync(`${FONTS}calib-preview.ttf`) && existsSync(`${FONTS}calib-preview.json`);
if (!present && process.env.CI) {
  throw new Error(
    "calib-preview.ttf is missing: run `uv run --group build sawa lab preview --overrides lab/tests/fixtures/overrides-sample.json`",
  );
}

const MARKS = ["none", "fatha", "kasra", "sukun", "shadda-fatha", "kasratan"];

describe.skipIf(!present)("the live overlay matches the baked preview", () => {
  it("places every glyph where HarfBuzz puts it in the baked font", () => {
    const data = JSON.parse(readFileSync(`${FONTS}lab.json`, "utf8")) as LabData;
    const baked = JSON.parse(readFileSync(`${FONTS}calib-preview.json`, "utf8")) as Baked;
    const font = (file: string) => new HbFont(readFileSync(`${FONTS}${file}`));
    const lab = new Model(
      data,
      {
        calib: font(data.fonts.calib),
        notoArabic: font(data.fonts.notoArabic),
        notoSans: font(data.fonts.notoSans),
        preview: font("calib-preview.ttf"),
      },
      DEFAULT_STATE,
      [],
      {
        ...NO_OVERRIDES,
        glyphs: baked.glyphs.map((g) => ({ ...g, usedBy: [], build: "", wght: 400, updated: "" })),
      },
      baked,
    );
    const edited = new Set(baked.glyphs.map((g) => g.glyph));
    expect(edited.size).toBeGreaterThan(0);
    const texts = new Set<string>();
    for (const letter of data.matrix.letters) {
      const forms = letter.forms.filter((form) =>
        lab.letterForm(letter, form)?.glyphs.some((g) => edited.has(g)),
      );
      for (const form of forms)
        for (const id of MARKS) {
          const mark = lab.marks.get(id);
          if (!mark || !lab.plausible(letter, mark)) continue;
          texts.add(String.fromCodePoint(...cellCodepoints(letter.char, form, mark.codepoints)));
        }
      if (forms.length)
        for (const line of data.lines[letter.codepoint]?.lines ?? []) texts.add(line.text);
    }
    expect(texts.size).toBeGreaterThan(10);
    const boxes = (bakedView: boolean, text: string) => {
      lab.state = { ...DEFAULT_STATE, baked: bakedView };
      const layout = lab.lineLayout("calib", text);
      const placed = lab.linePlacements("calib", layout);
      const ink = lab.ink("calib");
      return layout.pieces.map((piece, i) => {
        const box = bounds(ink(piece, placed[i] ?? { dx: 0, dy: 0, parts: {} }));
        return box ? [box.x0, box.y0, box.x1, box.y1].map(Math.round) : null;
      });
    };
    for (const text of texts) {
      expect(boxes(false, text), `"${text}": overlay against baked`).toEqual(boxes(true, text));
    }
  });
});
