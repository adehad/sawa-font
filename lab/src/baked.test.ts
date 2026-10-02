import { describe, expect, it } from "vitest";
import { cellCodepoints } from "./cells";
import { editedGlyph } from "./edits";
import { labModel, present, readJson } from "./fixture";
import { bounds } from "./geometry";
import { type Baked, bakedEdits } from "./model";
import { DEFAULT_STATE } from "./state";

const ready = present("lab.json", "positioning.json", "calib-preview.ttf", "calib-preview.json");
if (!ready && process.env.CI) {
  throw new Error(
    "calib-preview.ttf is missing: run `uv run --group build sawa lab preview --overrides lab/tests/fixtures/overrides-sample.json`",
  );
}

const MARKS = ["none", "fatha", "kasra", "sukun", "shadda-fatha", "kasratan"];

describe.skipIf(!ready)("the live overlay matches the baked preview", () => {
  it("places every glyph where HarfBuzz puts it in the baked font", () => {
    const baked = readJson("calib-preview.json") as Baked;
    const edits = bakedEdits(baked);
    const lab = labModel({ edits, requests: [] }, baked);
    const touched = new Set<string>();
    for (const { target } of edits) {
      touched.add(editedGlyph(target));
      if (target.mechanism === "pair") touched.add(target.mark);
      if (target.mechanism === "split-class") for (const m of target.marks) touched.add(m);
    }
    expect(touched.size).toBeGreaterThan(0);
    const texts = new Set<string>();
    for (const letter of lab.data.matrix.letters) {
      const forms = letter.forms.filter((form) =>
        lab.letterForm(letter, form)?.glyphs.some((g) => touched.has(g)),
      );
      for (const form of letter.forms)
        for (const id of MARKS) {
          const mark = lab.marks.get(id);
          if (!mark || !lab.plausible(letter, mark)) continue;
          const cell = { letter, form, mark };
          if (
            forms.includes(form) ||
            lab.layout("calib", cell).pieces.some((p) => touched.has(p.name))
          )
            texts.add(String.fromCodePoint(...cellCodepoints(letter.char, form, mark.codepoints)));
        }
      if (forms.length)
        for (const line of lab.data.lines[letter.codepoint]?.lines ?? []) texts.add(line.text);
    }
    expect(texts.size).toBeGreaterThan(10);
    const boxes = (bakedView: boolean, text: string) => {
      lab.state = { ...DEFAULT_STATE, baked: bakedView };
      const layout = lab.lineLayout("calib", text);
      const placed = lab.linePlacements("calib", layout, text);
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
