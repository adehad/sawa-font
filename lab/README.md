# Sawa Lab

A glyph workbench for checking Sawa letter by letter and leaving feedback pinned to the exact spot. It shapes each letter live with HarfBuzz (harfbuzzjs) in the browser and draws the outlines itself, so what it shows is what the font build does.

What it shows is one calibration build: Sawa Sans 400, with Noto Sans Arabic scaled by 1.15 and merged with Noto Sans, keeping Noto's own mark placement. The unscaled Noto sources come along for before and after.

## Run it

```sh
uv run --group build sawa lab fonts      # writes lab/public/fonts/
uv run --group build sawa lab preview --overrides overrides.json   # optional: bakes your moves
cd lab
bun install
bun run dev                              # http://localhost:4410/
```

`sawa lab fonts --arabic-scale 1.2` writes the fonts at another scale, and `--line-box 2.4` draws an approved line box of another height. The build id in the footer, and in every note and offset, changes with the scale.

`lab.json` also splits each letter form into the parts the lab can move. `letterForms["U+0628|initial"]` names the form's body glyph and its parts: the body, and each dot group with its position (above, below or inside) and number of dots. In Noto Sans Arabic a dot group is a glyph of its own, which `ccmp` splits off the letter; a dot drawn inside the body glyph, as a component named like a dot or a small outer contour, is a part too. `glyphs` holds every such glyph's advance, GDEF class, parts with their SVG paths in font units, and GPOS anchors.

`lines` holds each letter's edge-case lines, short strings labelled with what they test:

- **font**: each alternate glyph the font's Arabic GSUB lookups can turn the letter into (`ccmp`, `isol`, `init`, `medi`, `fina`, `rlig`, `calt`, `liga`, `clig`, contextual lookups followed into the lookups they call), with the shortest string of the letter and at most one neighbour each side that triggers it, checked by shaping. An alternate no such string reaches, and no real word either, is listed under `unreached` with its lookup and context.
- **situational**: the letter after the non-joining letters ا د ذ ر ز و, between tall letters and between descenders, after letters with tails, with lam and lam-alef, beside shadda with a vowel, and with kashida (U+0640).
- **word**: a real word with the letter in each of its forms and with each alternate a word reaches, from the project's own sentences (`tests/strings/mixed.json` and the Arabic purposes in `stress.json`) first, then the Tanzil Quran text. A Quran word is a whole token of its verse, never changed, and the lab credits Tanzil wherever one is shown.

`sawa lab fonts --quran ''` leaves the Quran words out.

Checks: `bun run lint`, `bun run fmt:check`, `bun run test` (unit tests, the HarfBuzz parity test and the baked-preview test), `bun run build`, `bun run test:e2e` (Playwright smoke test against the built lab).

## What is on screen

- **Matrix**: letters by form, right to left as Arabic reads (isolated at the right, then initial, medial and final; each forced with ZWJ), with one mark or mark sequence. Each cell has a clash badge and its ink top and bottom in em. A clash is mark ink closer than 0.03 em to the letter, its dots or another mark, measured on the drawn outlines. Arrow keys move between cells the way they point.
- **All everyday marks**: every everyday mark on every letter and form at once, with clashing ones outlined.
- **Vertical envelope** (always visible): the Latin ink range (top of É and Å, bottom of g, y, j and p) against the range of every everyday cell, the line box both need, and the approved line box. It is worked out from the glyphs as you have moved them, live while you drag, next to the envelope as built and the change in the line box. The five tallest and deepest cells are links.
- **Inspector**: the letter's forms side by side, right to left, on the Latin grid with the current mark, then "Hxgy", the letter's edge-case lines, the cell in context and at 16 and 24 px. The selected form is outlined; click another to switch. Each form is its own glyph, so a move changes only the form you drag, and the others stay for comparison. The cell's ink top and bottom are drawn as dashed lines that follow your edits. Click anywhere else on the large glyph to pin a note, and pick which part it is about.
- **Notes**: every note with filters for status, tag and severity, and the proposed edits.

The Font switch swaps between the calibrated font and the unscaled Noto sources. Proposed offsets apply to the calibrated font only, and only in this preview. Text at reading size is set by the browser from the font files, so it never shows them; the edge-case lines are drawn by the lab and do.

## Moving parts

Every edit in the lab is a rule a font can hold, and the inspector says which before you make it.

"Drag" picks what the handles stand for:

- **Marks**: the cell's tashkeel.
- **Whole letter**: the form's body glyph, its outline moved with its anchors, so its dots and marks follow. This is how you try a letter off the baseline, such as a meem that starts higher so its tail reaches less far down. A body glyph can serve several letters (Noto draws beh, noon and yeh hamza initial with one dotless body); the inspector says which, since moving it moves them all.
- **Dots**: a dot group, drawn inside the body glyph or a glyph of its own that `ccmp` splits off.
- **Anchors**: the body glyph's anchors, one per mark class, drawn as crosses labelled with the class (`top_27`), and each mark's mark-to-mark anchor, drawn as a square. A dashed ring marks where a mark's own anchor meets what it hangs on. The anchors the cell's tashkeel uses come first.

The part list beside the canvas picks a handle, as clicking or focusing one does, and says what it hangs on: "Attached to uni066E.medi through top_27, stacked on that mark". Then "Scope" picks the mechanism the move becomes, smallest first, and the smallest is picked until you choose another:

| Scope                                 | Mechanism                                                                          | What it moves                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| This pair only                        | contextual positioning (GPOS chained context, a new lookup after the mark lookups) | this mark wherever it follows this base glyph; marks stacked on it keep their place, as HarfBuzz applies the adjustment after attachment |
| This mark group on this glyph         | split mark class (a new class in the mark-to-base lookup)                          | these marks on this glyph, with what stacks on them                                                                                      |
| All marks of this class on this glyph | anchor move (GPOS MarkBasePos, MarkLigPos or MarkMarkPos)                          | every mark of the class on this glyph, dots included, since Noto keeps dots and tashkeel above in one class                              |
| This glyph's outline                  | outline edit (glyf)                                                                | the glyph everywhere the font uses it; a dot glyph of its own gets a copy swapped in after this base                                     |
| All forms                             | outline edit on every form's glyph                                                 | the same part in each form of the letter                                                                                                 |

Each scope shows how many everyday cells it changes. The blast radius panel lists them, the first 24 drawn and updated live while you drag, and the matrix outlines the ones with the current mark. "Edits on this cell" lists every edit that changes the cell, with how far each reaches and a Reset.

The x and y fields show the active handle's offset in font units at its scope. Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, as do the Undo and Redo buttons.

The edge-case lines under the canvas, at 24 and 64 px per em, are drawn with every move applied, so a change shows in context straight away. When one comes from the Quran text, Tanzil is credited under the list.

By default the matrix and envelope hold only combinations ordinary spelling uses, the same rules as the search behind the approved line spacing: maddah and hamza below only on bare alef, hamza above only on alef, waw, yeh and alef maksura, and no shadda on an alef, hamza, alef maksura or teh marbuta. `sawa lab fonts` decides this and lists each letter's `implausible` mark sequences in `lab.json`. "Include impossible combinations" brings the rest back, hatched and labelled.

For the calibrated font the plausible everyday envelope is 1.503 em to -0.799 em, from theh initial with shadda and kasratan down to yeh isolated with kasratan; `src/envelope.fonts.test.ts` holds it there.

The owner approved a 2.06 em line box, which the tallest and deepest stacks pass on purpose. `sawa lab fonts` places it from the corpus: the coverage box is the top and bottom that hold the everyday ink of 99.5% of word tokens in the project's sentences and the Tanzil text (niche marks taken out, a quarter of a percent left out at each end), and the approved box is split above and below the baseline in the same proportion. With the Tanzil text that gives a coverage box of 1.471 to -0.631 em over 78043 words, and an approved box of 1.442 to -0.618 em that holds 99.4% of them. `lab.json` records both under `approvedLineBox`, and both are drawn in the envelope panel; the approved one is also on the inspector grid.

The URL holds the view, mark, cell, font and toggles, so a link reproduces what you see. Notes and offsets stay in this browser's local storage until you export them.

## Baked preview

The overlay is the lab's own drawing. To see the real thing, export `overrides.json` and run

```sh
uv run --group build sawa lab preview --overrides overrides.json
```

It writes `calib-preview.ttf`, a copy of the calibrated font with the glyph overrides baked in with fontTools, and `calib-preview.json`, what it baked. A body offset moves the glyph's outline and its mark-attachment anchors; composites built from the glyph are compensated so they stay put. A dot group inside a glyph moves its component or contours. A dot glyph `ccmp` splits off gets a copy with the outline moved and its anchors kept, swapped in after that base glyph only by a contextual substitution in `calt`, the last Arabic GSUB stage, so marks stacked on the dots stay where they were. It reads version 2 files; anchor, split class, pair and mark-to-mark edits are not baked yet.

"Show baked preview" then draws the calibrated font from that file, shaped by HarfBuzz, with no overlay, and says when the file was baked from moves other than the ones you have now. The two must match: `src/baked.test.ts` sets every form and edge-case line of each baked glyph both ways and fails on the first glyph whose ink differs. CI bakes `tests/fixtures/overrides-sample.json` for it.

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

Version 3: one entry per edit, named by the mechanism it becomes. Values are in font units at `wght` 400; `values` lists every master, and only 400 is filled until the build reads the file.

```json
{
  "schema": "sawa-lab/overrides",
  "version": 3,
  "edits": [
    {
      "id": "pair:uni066E.medi:uni064E",
      "mechanism": "pair",
      "scope": "pair",
      "target": { "base": "uni066E.medi", "mark": "uni064E" },
      "lookup": "new",
      "values": { "400": { "dx": 0, "dy": -40 }, "700": null },
      "usedBy": [],
      "build": "sans-400-1.15-d0817c60d0",
      "updated": "2026-10-02T09:00:00.000Z"
    }
  ],
  "requests": []
}
```

- `mechanism` and `target`:
  - `outline`: `{ glyph, part }`, the glyph's outline with its anchors (`part` "body"), or one dot group: `component:N` / `contours:A,B` inside the glyph, or a split-off dot glyph's name.
  - `anchor`: `{ glyph, class }`, the glyph's mark-to-base or mark-to-ligature anchor for a class id from `positioning.json`.
  - `split-class`: `{ glyph, class, marks }`, a separate anchor on the glyph for those marks of the class.
  - `pair`: `{ base, mark }`, the mark adjusted wherever it follows the base glyph, other marks between them skipped.
  - `mkmk-anchor`: `{ glyph, class }`, a mark's mark-to-mark anchor for the class that stacks on it.
- `scope`: `pair`, `mark-group`, `mark-class`, `outline` or `all-forms`, the scope it was made at.
- `lookup`: the GPOS lookup the rule lands in, `"new"` for a lookup appended after the mark lookups, null for glyf.
- `usedBy`: the letter forms whose body is the edited glyph, for reading only.

Importing a version 2 file migrates it: glyph entries become `outline` edits, and a cell's mark offsets, in version 2 or 1, become `pair` rules on the cell's body glyph, which reach every cell with that body and mark rather than the one cell. Importing merges: a note with a known `id`, or an edit of a known target, replaces the one stored.

## HarfBuzz parity

The lab and the font build must shape alike, or what you approve here won't match the fonts. `harfbuzzjs` is pinned to the release that bundles the same HarfBuzz as the `uharfbuzz` locked in `uv.lock` (1.6.2 and 0.56.2, both HarfBuzz 14.5.0). The footer shows both versions and warns when they differ.

`sawa lab fonts` also writes `expected-shaping.json`: uharfbuzz's glyph ids, clusters, advances and offsets for every cell, everyday and niche, in the calibrated font and Noto Sans Arabic. `src/parity.test.ts` shapes the same cells with harfbuzzjs and fails on the first cell that differs, naming it and both HarfBuzz versions. When you bump `uharfbuzz`, bump `harfbuzzjs` to the release with the same HarfBuzz.
