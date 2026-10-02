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
- **Vertical envelope** (always visible): the Latin ink range (top of É and Å, bottom of g, y, j and p) against the range of every everyday cell, the line box both need, and the approved line box. The five tallest and deepest cells are links.
- **Inspector**: the cell at 300 px per em on the Latin grid, then "Hxgy", in context and at 16 and 24 px. Drag a mark's handle (or focus it and use the arrow keys) to show where it should go. Click anywhere else on the large glyph to pin a note.
- **Notes**: every note with filters for status, tag and severity, and the proposed offsets.

The Font switch swaps between the calibrated font and the unscaled Noto sources. Proposed offsets apply to the calibrated font only, and only in this preview. Text at reading size is set by the browser from the font files, so it never shows them.

By default the matrix and envelope hold only combinations ordinary spelling uses, the same rules as the search behind the approved line spacing: maddah and hamza below only on bare alef, hamza above only on alef, waw, yeh and alef maksura, and no shadda on an alef, hamza, alef maksura or teh marbuta. `sawa lab fonts` decides this and lists each letter's `implausible` mark sequences in `lab.json`. "Include impossible combinations" brings the rest back, hatched and labelled.

For the calibrated font the plausible everyday envelope is 1.503 em to -0.799 em, from theh initial with shadda and kasratan down to yeh isolated with kasratan; `src/envelope.fonts.test.ts` holds it there. The owner's approved line box, 2.36 em (that envelope plus 0.05 em), is drawn centred on it in the envelope panel and on the inspector grid.

The URL holds the view, mark, cell, font and toggles, so a link reproduces what you see. Notes and offsets stay in this browser's local storage until you export them.

## The feedback loop

1. Pin notes on the cells that look wrong, and drag marks to show what you mean.
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

### overrides.json

```json
{
  "schema": "sawa-lab/overrides",
  "version": 1,
  "overrides": [
    {
      "key": { "letter": "U+0628", "form": "medial", "marks": ["U+0651", "U+064E"] },
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

- `marks`: one entry per mark glyph in the cell, `index` in typed order, `glyph` its name in the font.
- `dx`, `dy`: the move in font units at `wght`, on top of the placement the font gives.

Importing either file merges it in: a note with a known `id`, or an offset for a known cell, replaces the one stored.

## HarfBuzz parity

The lab and the font build must shape alike, or what you approve here won't match the fonts. `harfbuzzjs` is pinned to the release that bundles the same HarfBuzz as the `uharfbuzz` locked in `uv.lock` (1.6.2 and 0.56.2, both HarfBuzz 14.5.0). The footer shows both versions and warns when they differ.

`sawa lab fonts` also writes `expected-shaping.json`: uharfbuzz's glyph ids, clusters, advances and offsets for every cell, everyday and niche, in the calibrated font and Noto Sans Arabic. `src/parity.test.ts` shapes the same cells with harfbuzzjs and fails on the first cell that differs, naming it and both HarfBuzz versions. When you bump `uharfbuzz`, bump `harfbuzzjs` to the release with the same HarfBuzz.
