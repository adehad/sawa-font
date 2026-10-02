# Sawa Lab

A glyph workbench for checking Sawa letter by letter and leaving feedback pinned to the exact spot. It shapes each letter live with HarfBuzz (harfbuzzjs) in the browser and draws the outlines itself, so what it shows is what the font build does.

What it shows is one calibration build: Sawa Sans 400, with Noto Sans Arabic scaled by 1.15 and merged with Noto Sans, keeping Noto's own mark placement. The unscaled Noto sources come along for before and after.

## Run it

```sh
uv run --group build sawa lab fonts      # writes lab/public/fonts/
cd lab
bun install
bun run dev                              # http://localhost:4410/
```

`sawa lab fonts --arabic-scale 1.2` writes the fonts at another scale, and `--line-box 2.4` draws another approved line box. The build id in the footer, and in every note and offset, changes with the scale.

`lab.json` also splits each letter form into the parts the lab can move. `letterForms["U+0628|initial"]` names the form's body glyph and its parts: the body, and each dot group with its position (above, below or inside) and number of dots. In Noto Sans Arabic a dot group is a glyph of its own, which `ccmp` splits off the letter; a dot drawn inside the body glyph, as a component named like a dot or a small outer contour, is a part too. `glyphs` holds every such glyph's advance, GDEF class, parts with their SVG paths in font units, and GPOS anchors.

`lines` holds each letter's edge-case lines, short strings labelled with what they test:

- **font**: each alternate glyph the font's Arabic GSUB lookups can turn the letter into (`ccmp`, `isol`, `init`, `medi`, `fina`, `rlig`, `calt`, `liga`, `clig`, contextual lookups followed into the lookups they call), with the shortest string of the letter and at most one neighbour each side that triggers it, checked by shaping. An alternate no such string reaches, and no real word either, is listed under `unreached` with its lookup and context.
- **situational**: the letter after the non-joining letters ا د ذ ر ز و, between tall letters and between descenders, after letters with tails, with lam and lam-alef, beside shadda with a vowel, and with kashida (U+0640).
- **word**: a real word with the letter in each of its forms and with each alternate a word reaches, from the project's own sentences (`tests/strings/mixed.json` and the Arabic purposes in `stress.json`) first, then the Tanzil Quran text. A Quran word is a whole token of its verse, never changed, and the lab credits Tanzil wherever one is shown.

`sawa lab fonts --quran ''` leaves the Quran words out.

Checks: `bun run lint`, `bun run fmt:check`, `bun run test` (unit tests and the HarfBuzz parity test), `bun run build`, `bun run test:e2e` (Playwright smoke test against the built lab).

## What is on screen

- **Matrix**: letters by form (isolated, initial, medial, final, forced with ZWJ) with one mark or mark sequence. Each cell has a clash badge and its ink top and bottom in em. A clash is mark ink closer than 0.03 em to the letter, its dots or another mark, measured on the drawn outlines. Arrow keys move between cells.
- **All everyday marks**: every everyday mark on every letter and form at once, with clashing ones outlined.
- **Vertical envelope** (always visible): the Latin ink range (top of É and Å, bottom of g, y, j and p) against the range of every everyday cell, the line box both need, and the approved line box. It is worked out from the glyphs as you have moved them, live while you drag, next to the envelope as built and the change in the line box. The five tallest and deepest cells are links.
- **Inspector**: the cell at 300 px per em on the Latin grid, then "Hxgy", its edge-case lines, in context and at 16 and 24 px. The cell's ink top and bottom are drawn as dashed lines that follow your edits. Click anywhere else on the large glyph to pin a note, and pick which part it is about.
- **Notes**: every note with filters for status, tag and severity, and the proposed offsets.

The Font switch swaps between the calibrated font and the unscaled Noto sources. Proposed offsets apply to the calibrated font only, and only in this preview. Text at reading size is set by the browser from the font files, so it never shows them; the edge-case lines are drawn by the lab and do.

## Moving parts

"Drag" in the inspector picks what a handle moves:

- **Marks**: one mark in this cell only.
- **Whole letter**: the form's body glyph, with its dots and every mark on it, as moving the outline and its anchors does in the font. This is how you try a letter off the baseline, such as a meem that starts higher so its tail reaches less far down. The glyph's anchors are drawn as small crosses. A body glyph can serve several letters (Noto draws beh, noon and yeh hamza initial with one dotless body); the inspector says which, since moving it moves them all.
- **Dots**: one dot group on its own. Marks stacked on the dots stay where they are, as the dot glyph's own anchors don't move.

Each part also has x and y fields in font units and a Reset button. Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, as do the Undo and Redo buttons.

The edge-case lines under the canvas, at 24 and 64 px per em, are drawn with every move applied, so a change shows in context straight away. When one comes from the Quran text, Tanzil is credited under the list.

By default the matrix and envelope hold only combinations ordinary spelling uses, the same rules as the search behind the approved line spacing: maddah and hamza below only on bare alef, hamza above only on alef, waw, yeh and alef maksura, and no shadda on an alef, hamza, alef maksura or teh marbuta. `sawa lab fonts` decides this and lists each letter's `implausible` mark sequences in `lab.json`. "Include impossible combinations" brings the rest back, hatched and labelled.

For the calibrated font the plausible everyday envelope is 1.503 em to -0.799 em, from theh initial with shadda and kasratan down to yeh isolated with kasratan; `src/envelope.fonts.test.ts` holds it there. The owner's approved line box, 2.36 em (that envelope plus 0.05 em), is drawn centred on it in the envelope panel and on the inspector grid.

The URL holds the view, mark, cell, font and toggles, so a link reproduces what you see. Notes and offsets stay in this browser's local storage until you export them.

## The feedback loop

1. Pin notes on the cells that look wrong, and drag letters, dots and marks to show what you mean.
2. Export `annotations.json` and `overrides.json`, or press "Copy summary" for a short text version to paste into chat.
3. The agent proposes a change for each note and sets its status to `proposed`. You set it to `accepted` or `rejected`.
4. Accepted offsets become per-master overrides (400 and 700) in the font build, and the everyday clash check confirms the rule still holds. The build does not read `overrides.json` yet.

## File formats

Both files are JSON. A cell is keyed by its letter, form and mark sequence:

```json
{ "letter": "U+0628", "form": "medial", "marks": ["U+0651", "U+064E"] }
```

`marks` lists the codepoints in typed order; it is empty for the bare letter.

### annotations.json

```json
{
  "schema": "sawa-lab/annotations",
  "version": 1,
  "notes": [
    {
      "id": "6f1c…",
      "key": { "letter": "U+0623", "form": "isolated", "marks": ["U+064F"] },
      "build": "sans-400-1.15-d0817c60d0",
      "font": "calib",
      "x": 120,
      "y": 1310,
      "tag": "too-high",
      "severity": 2,
      "text": "Hamza and damma stack well above the cap height",
      "status": "open",
      "created": "2026-10-01T09:00:00.000Z"
    }
  ]
}
```

- `x`, `y`: the pinned point in font units (1000 per em), from the cell's origin on the baseline.
- `font`: `calib` or `source`, the font the note was made on.
- `tag`: `too-small`, `too-high`, `too-low`, `collides`, `dot-spacing`, `feels-heavy` or `other`.
- `severity`: 1 (minor) to 3 (must fix).
- `status`: `open`, `proposed`, `accepted` or `rejected`.
- `part` (optional): what the note is about, `{ "kind": "body", "glyph": "uni066E.init" }`, `{ "kind": "dots", "glyph": "uni066E.init", "id": "dotbelowar" }` or `{ "kind": "mark", "glyph": "uni064E", "index": 0 }`.

### overrides.json

Version 2. Offsets are in font units at `wght`, on top of where the font puts each part.

```json
{
  "schema": "sawa-lab/overrides",
  "version": 2,
  "glyphs": [
    {
      "glyph": "uni066E.init",
      "usedBy": ["beh initial", "noon initial", "yeh hamza above initial"],
      "build": "sans-400-1.15-d0817c60d0",
      "wght": 400,
      "body": { "dx": 0, "dy": 40 },
      "dots": [{ "part": "dotbelowar", "dx": 0, "dy": -20 }],
      "updated": "2026-10-02T09:00:00.000Z"
    }
  ],
  "marks": [
    {
      "key": { "letter": "U+0628", "form": "medial", "marks": ["U+0651", "U+064E"] },
      "glyph": "uni066E.medi",
      "build": "sans-400-1.15-d0817c60d0",
      "wght": 400,
      "marks": [
        { "index": 0, "glyph": "uni0651", "dx": 0, "dy": -40 },
        { "index": 1, "glyph": "uni064E", "dx": 12, "dy": 0 }
      ],
      "updated": "2026-10-01T09:05:00.000Z"
    }
  ]
}
```

- `glyphs`: one entry per moved glyph, wherever the font uses it. `usedBy` names the letter forms whose body it is, for reading only.
  - `body`: moves the glyph's outline and its mark anchors, so its dots and marks follow.
  - `dots`: moves one dot group alone. `part` is the part id from `lab.json`: the dot glyph's name when `ccmp` splits the dots off the letter, or `component:N` / `contours:A,B` for dots drawn inside the glyph.
- `marks`: marks moved in one cell, keyed by the cell. `glyph` is the cell's body glyph, for reading; each moved mark has its `index` in typed order and its glyph name.

A version 1 file, which had only cell-keyed mark offsets under `overrides`, imports into `marks`. Importing either file merges it in: a note with a known `id`, or an entry for a known glyph or cell, replaces the one stored.

## HarfBuzz parity

The lab and the font build must shape alike, or what you approve here won't match the fonts. `harfbuzzjs` is pinned to the release that bundles the same HarfBuzz as the `uharfbuzz` locked in `uv.lock` (1.6.2 and 0.56.2, both HarfBuzz 14.5.0). The footer shows both versions and warns when they differ.

`sawa lab fonts` also writes `expected-shaping.json`: uharfbuzz's glyph ids, clusters, advances and offsets for every cell, everyday and niche, in the calibrated font and Noto Sans Arabic. `src/parity.test.ts` shapes the same cells with harfbuzzjs and fails on the first cell that differs, naming it and both HarfBuzz versions. When you bump `uharfbuzz`, bump `harfbuzzjs` to the release with the same HarfBuzz.
