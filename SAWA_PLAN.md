# Sawa — specimen site: build plan

Brief for a coding agent. Every decision here was agreed with the project owner; where something is marked **OPEN**, do not decide it yourself — leave a TODO and ask.

Design reference: the "Sawa — specimen site" canvas (interactive mockup with EN/AR switch, Specimen / Compare / Build report / About). The mockup fakes some behaviour; section 10 lists where the real build must differ.

---

## 1. What we are building

**Sawa (سوا)** is a bilingual Arabic/English font family built from existing SIL OFL 1.1 fonts. Arabic is scaled to match the Latin's visual size, both scripts share one set of vertical metrics (so mixed lines don't change height), and tashkeel can be shown in black, gray, or coloured by mark group.

Family members, built by `sawa build fonts` from `data/sawa.json` (first review version):

| Family | Sources (pinned in `data/upstream.json`) | Axes |
|---|---|---|
| Sawa Serif | Noto Naskh Arabic 2.021 + Noto Serif 2.015 (upright), Arabic scaled 1.064 (alef height to Latin cap height) | wght 400 to 700 |
| Sawa Sans | Noto Sans Arabic 2.013 + Noto Sans 2.015, Arabic scale 1.000 | wght 400 to 700 |
| Sawa Mono | Cascadia Mono 2407.24 (OFL, Reserved Font Name "Cascadia Code"), renamed, plus 30 marks and letters from Noto Sans Arabic 2.013 and Noto Sans 2.015 (below) | wght 400 to 700 |
| Sawa Mono NF | Cascadia Mono NF 2407.24, renamed, with the same additions; TTF only, not on the site | wght 400 to 700 |
| Sawa Serif Harakat | Sawa Serif with its tashkeel coloured by mark group (COLR/CPAL, below) | wght 400 to 700 |
| Sawa Sans Harakat | Sawa Sans, coloured the same way | wght 400 to 700 |

Every family has the same weight axis, wght 400 to 700 with default 400, and the named instances Regular (400, elidable in STAT), Medium, SemiBold and Bold. The merged families instance their sources inside that range only; Sawa Mono cuts Cascadia's axis to it before anything else (fontTools' instancer, which keeps avar and the `rvrn` feature variations consistent) and then writes its fvar instances and STAT the way the merged families do.

Every family attaches every combining Arabic mark to its letter (`build/anchors.py`, run on each static master before varLib): a mark no fatha or kasra subtable positions joins that side's classes with an anchor derived from its ink; a letter glyph those subtables lack gets anchors from its ink; and every mark-to-mark anchor is set from its mark's ink. Then `build/compact.py` moves the marks as close to their letters as the ink allows, keeping the family's `markClearance` (0.03 em) from every other glyph: harakat get mark classes of their own, and every letter and mark-to-mark anchor moves until the marks on it sit one gap (0.038 em, 8 units per 1000 more than the clearance, so that rounding and interpolation between masters stay clear) from the ink below or above them (sideways too, within limits; Sawa Sans keeps 0.040 em, since at 0.038 em its fit leaves kasra within the clearance of reh and noon at the heavier weights). Dots and signs that letters decompose into are marks the harakat stack on, so a haraka keeps the same gap from a dot as from a bare letter. Anchors that now crowd a neighbouring cluster give back what they took, and each contact the everyday view (only everyday tashkeel, §8.1) of the Tanzil text, the stress strings, the mixed sentences and the mark samples `sawa check fonts` shapes still shows gets a contextual adjustment, fitted on each master and on the font halfway between each two neighbouring masters, each master with its own offsets, that moves the mark, or its whole stack, clear. The Quranic pause marks U+06D6 to U+06DC become spacing glyphs (`build/pause.py`): GDEF bases with their ink width plus 0.04 em each side as advance (the cell width, centred, in Sawa Mono), their ink starting where fatha's starts over dotless beh, and out of every mark lookup; HarfBuzz keeps their advance, so they set after the word. The parameters are `compaction` in `data/sawa.json`. Fitting takes up to an hour per family, so `sawa build fonts --refit [FAMILY ...]` fits it locally and writes what it found to `data/compaction/<family>.json` (`build/fitted.py`), which is committed: per master, the anchors steps 3 to 5 moved and the contextual rules' offsets, with each rule's layer, one anchor or rule per line, sorted, and the key of the inputs it was fitted against (the source fonts, the anchoring stage's config and code, the compaction parameters, the corpus and the compaction code). Every other build applies the committed fit, and stops, asking for a refit, when that key no longer matches; a refit also checks that applying what it wrote gives the masters it fitted. Anchored masters are cached in `.cache/masters/` (`build/masters.py`), keyed on the inputs, the config and the code. Mark outlines are never scaled.

Line boxes (typo and hhea, no line gap) are sized so that no two lines of everyday text can collide, whichever two end up adjacent: the box height is the largest highest-top-less-lowest-bottom of the everyday corpus over the weights `sawa check leading` samples (every master, the midpoints between neighbouring masters, and the wght minimum, default and maximum), and its ascender is the highest top. Sawa Serif 1.831 em (1.307/-0.524), Sawa Sans 2.056 em (1.366/-0.690), Sawa Mono and Mono NF 1.260 em (0.859/-0.401), from the mixed sentences only. Win metrics hold every glyph and every corpus line, the Quran included, at every sampled weight: Serif 1.498/0.836 em, Sans 1.488/0.957 em, Mono 1.397/0.831 em (Mono NF too).

Sawa Mono borrows U+0657, U+0659, U+065C to U+065E, U+06D6 to U+06DC, U+06DF to U+06E1, U+06E3 to U+06E7, U+06E9 to U+06ED and U+08F0 to U+08F2 from Noto Sans Arabic, and U+02BE, U+02BF from Noto Sans (both OFL 1.1, Copyright 2022 The Noto Project Authors), instanced at each Cascadia master (wght 400 and 700), scaled to Cascadia's own glyphs (2.070, i.e. 2048/1000 times 1.011, from fatha and damma heights; 3.061 for U+02BE, U+02BF, from U+02BC) and rebuilt with varLib; spacing ones (U+02BE, U+02BF, U+06E5, U+06E6, U+06E9) take the cell width, centred. Name IDs 0 and 5 and the family's OFL.txt credit Noto.

Every family adds U+A7DC LATIN CAPITAL LETTER LAMBDA WITH STROKE, the capital of U+019B, which no source has (`build/lambda_stroke.py`, per master): Λ's outline plus one straight stroke across its long right leg, centred at 0.55 of Λ's height, at the angle of ƛ's stroke and overshooting the leg as ƛ's does (both measured on the default master), as thick as Ł's stroke and no thinner than L's stem, at Λ's advance (the cell width in Sawa Mono), a GDEF base.

Before varLib, `build/polish.py` flattens nested composites on every master (Cascadia has 593) and makes U+0674 ARABIC HIGH HAMZA a spacing base where the source classes it as a mark (Cascadia); on the variable font it classes Noto Serif's five zero-width ties and overlines (U+203F, U+2040, U+2054, U+2E12, U+AB5B) as GDEF marks, switches on smart dropout control in prep (a new prep and gasp, as gftools fix-nonhinting writes them, in the unhinted Serif and Sans; appended to Cascadia's own prep in Sawa Mono) and drops the Macintosh name records.

The gray and mark-group palettes live in separate Harakat builds (`build/harakat.py`, `"harakat": true` in `data/sawa.json`), made from the finished variable font after polish: the plain family stays free of colour tables, and the mono palette is the plain family itself. Every glyph that only a group of `data/mark-groups.json` reaches is a COLRv0 base glyph whose one layer is itself, so it keeps following gvar; a ligature of marks from two groups (four shadda ligatures in Serif, two in Sans) is split into one layer glyph per group, each with its slice of the gvar deltas. COLRv0 because a single-colour layer is all the marks need, and v0 renders wherever COLR does. A mark glyph a letter decomposes into (the hamza of U+0623 to U+0626, the madda of U+0622, the small v and superscript alef of letters such as U+06CE and U+06C8, seven glyphs) gets a copy for the letter that GSUB, GPOS and GDEF treat exactly as the mark, so letters keep the text colour and shaping gives the plain family's glyphs and positions. CPAL v1 holds four palettes in `data/palettes.json` order: Groups (light), Groups (dark), Gray (light), Gray (dark), typed light and dark and labelled in the name table, with eight entries in mark-group order. `data/palettes.json` is also where the site's `--mark-*` tokens come from; each colour keeps 3:1 against the site's light and dark backgrounds. The names are the family's with " Harakat" (name IDs 1, 3, 4, 6, 16, 17, 25, the instance PostScript names), with the same licence metadata. The twin adds about 7 KB of TTF and 2 KB of woff2 (Serif 636,764 to 638,684 bytes, Sans 576,080 to 577,700). Sawa Mono has no Harakat build: its borrowed Quranic marks are a placeholder for a Mono mark redesign (§13).

This repo's first deliverable is the **specimen website plus the report pipeline**.

## 2. Decisions (do not re-open)

1. **Site purpose:** specimen + playground (like a Google Fonts family page) with an About page and a Build report page.
2. **Stack:** Astro, static output, deployed to **GitHub Pages** from the same repo as the font sources. Served as a project page at `adehad.github.io/sawa-font/`: `astro.config.mjs` reads `BASE_PATH` (default `/sawa-font/`, the same variable the Read the Docs build sets) and every internal link goes through `import.meta.env.BASE_URL`, so a hard-coded `/en/` is a bug. No custom domain will be bought; the project page URL is permanent.
3. **Translation platform:** none at launch. Messages live in the repo as flat JSON. **Hosted Weblate** is connected later; keep files in a format Weblate imports directly.
4. **i18n library:** Astro built-in i18n routing + a small typed `t()` helper. Strings with numbers use **ICU MessageFormat** via `intl-messageformat` (Arabic needs all six CLDR plural categories).
5. **RTL:** `dir="rtl"` mirrors the whole layout. Specimen text is independent of UI language and uses `dir="auto"`. Side-by-side panes mirror in the Arabic UI (first font on the right).
6. **State:** all playground state in URL query params; switching `/en/` ↔ `/ar/` preserves it.
7. **Font roster:** Sawa · Status quo · Amiri (upstream) · Amiri Quran (reference) · Scheherazade New · Noto Naskh Arabic · Kawkab Mono (mono placeholder) · local font file.
8. **Layouts:** *Stacked* (one row per font) and *Side by side* (2–4 columns, synced scroll). Shared controls; each pane may override only **font** and **palette**.
9. **Controls:** sample presets + free text; size + waterfall; line height (font default or number); palette (mono / gray / groups) with legend; background light/dark; ss01 toggle + OpenType feature panel; metrics overlay.
10. **Sample text:** Tanzil Uthmani (verbatim), CC0 project-written mixed sentences, hand-built stress set shared with CI.
11. **Name:** Sawa (سوا).
12. **Look:** neutral tool with a light manuscript touch — warm off-white, ink text, one deep-green accent, real dark mode. UI text set in Sawa Sans, headings in Sawa Serif.
13. **Build report:** Chromatic-style layered viewer; CI produces SVG layers + JSON; Fontbakery HTML hosted as a static page.
14. **Report history:** latest on GitHub Pages; versioned history on **Read the Docs** using `build.commands` to run Astro in *report-only* mode against each release's bundle, downloaded from GitHub Releases.
15. **Automation language:** Python, managed with **uv**, linted and formatted with **ruff**, type-checked with **ty**. No shell scripts: all automation lives in one package, `src/sawa_tools/`, behind a single `sawa` console entry point with argparse subcommands (`uv run sawa report shaping`, `uv run sawa check i18n`, `uv run sawa rtd base-path`). The same commands run on Windows, macOS and Linux. Tests use pytest. The font toolchain (fontmake etc.) sits in a uv dependency group `build`, so site-only checks don't install it. Bun is used only inside `site/`.
16. **Latin:** start from Amiri's own Latin (four styles, same design origin as the Arabic); revisit only if it loses to other faces in the Compare view. Coverage target, checked by Fontbakery's `glyphsets` checks and reported per set in `coverage.json`:
    - required at launch: GF Latin Core + Arabic romanisation (ALA-LC / DIN 31635: ḥ ṣ ḍ ṭ ẓ ʿ ʾ ā ī ū ḏ ṯ ẖ ġ š ž č ǧ). A release fails CI if either regresses. Amiri 1.003 has the romanisation set; whether it passes GF Latin Core is unverified until the first Fontbakery run.
    - next: GF Latin Plus.
    - out of scope unless asked: Vietnamese (Amiri lacks 46 of 47 letters) and IPA.

## 3. Repository layout

```
/
├─ sources/                  # font sources (UFO/Glyphs) — owned by the font work, not this plan
├─ tests/
│  ├─ strings/stress.json    # hand-built stress set (single source for CI + site)
│  ├─ strings/mixed.json     # CC0 mixed EN/AR sentences
│  ├─ data/unicode/          # BidiCharacterTest.txt, the bidi conformance test
│  └─ shaping/<family>.json  # committed HarfBuzz snapshots; `sawa report shaping --update` rewrites them
├─ data/
│  ├─ upstream.json          # pinned sources for the roster and the Sawa families
│  ├─ sawa.json              # Sawa family build config: inputs, Arabic scale, wght, metrics, names
│  ├─ tanzil/                # verbatim Tanzil text + its licence header, unmodified
│  ├─ mark-groups.json       # mark group → codepoints; single source for site legend + coverage.json
│  └─ unicode/               # BidiBrackets.txt for report/bidi.py, with Unicode's copyright header
├─ src/sawa_tools/           # Python package; `sawa` CLI (see §2.15)
│  ├─ cli.py                 # argparse entry point
│  ├─ build/                 # `sawa build fonts`: fonts.py (fetch, woff2, fonts.json), families.py (config, stamps),
│  │                         #   merge.py (Arabic + Latin merge), naming.py (names, STAT, fvar instances)
│  ├─ report/                # `sawa report build` / `shaping`: catalogue.py (test list), bidi.py, shape.py,
│  │                         #   render.py (SVG layers), raster.py + diff.py (diff regions), layers.py,
│  │                         #   shaping.py, metrics.py, coverage.py, fontbakery.py, manifest.py, bundle.py
│  ├─ checks/                # i18n.py (i18n parity), marks.py (mark-group coverage), fonts.py (`sawa check fonts`)
│  └─ rtd.py                 # fetch-bundle, base-path, copy-tree
├─ tests/python/             # pytest suite for sawa_tools
├─ .cache/                   # downloaded font archives, git-ignored
├─ fonts/                    # built Sawa TTFs, woff2 and build stamps, git-ignored
├─ report/                   # generated by `sawa report build`, git-ignored; see §8.1
├─ site/                     # Astro project
│  ├─ src/i18n/en.json, ar.json          # flat message catalogs
│  ├─ src/i18n/t.ts                      # typed t() over intl-messageformat
│  ├─ src/i18n/locales.ts                # locale ids, autonyms, dir, storage key
│  ├─ src/i18n/paths.ts                  # page list + base-aware URL helpers
│  ├─ src/layouts/Base.astro             # lang/dir, header, nav, switcher, footer, @font-face
│  ├─ src/styles/global.css              # colour tokens + dark mode
│  ├─ src/fonts/types.ts, load.ts, css.ts, roster.ts  # fonts.json → @font-face + font-family CSS
│  ├─ src/samples/index.ts               # typed `presets`: mixed, quran, stress sample text
│  ├─ src/pages/index.astro              # `/` locale redirect
│  ├─ src/pages/[lang]/index.astro        # Specimen
│  ├─ src/pages/[lang]/compare.astro
│  ├─ src/pages/[lang]/report.astro
│  ├─ src/pages/[lang]/about.astro
│  ├─ src/components/…                    # interactive islands
│  ├─ src/components/report/overlay/…     # only place physical CSS properties are allowed
│  ├─ tests/e2e/                          # Playwright specs
│  ├─ .stylelintrc.json                   # logical-properties rule + overlay allow-list
│  └─ public/fonts/                       # fonts copied in by CI
├─ .github/workflows/release.yml
├─ .readthedocs.yaml
├─ pyproject.toml            # uv project; ruff + ty config
├─ uv.lock
├─ .python-version
└─ SAWA_PLAN.md
```

## 4. i18n rules

- Routes: `/en/…` and `/ar/…`. GitHub Pages is static and never sees `Accept-Language`, so `/` is a tiny page whose inline script picks a locale from `navigator.languages` (default `en`) and calls `location.replace`. It also carries plain links to both locales for visitors without JavaScript.
- `<html lang>` and `<html dir>` set per locale in the base layout.
- Language switcher: a header dropdown (native `<details>`/`<summary>` disclosure + list of plain `<a>` links, not a `<select>`). The summary shows a stroke globe icon, a visually hidden "Language" label plus the current language name. Each language is named in its own script ("English", "العربية"), never translated. No flags: Arabic has no single country, the Saudi flag carries the shahada, and flag emoji don't render on Windows. Links are built at build time to the same path in the other locale; on a plain click, a small script navigates to that href plus the current query string and hash, read at click time because the playground rewrites the query with `history.replaceState`. The chosen locale is saved to `localStorage`, and the `/` redirect reads it before `navigator.languages`.
- Messages: **flat** keys (`"compare.size": "Size"`), one file per locale. No nesting — keeps Weblate import trivial.
- Plurals and numbers: ICU syntax, e.g. `"report.testsFailed": "{count, plural, zero {No tests failed} one {# test failed} two {# tests failed} few {# tests failed} many {# tests failed} other {# tests failed}}"`. Arabic translations must fill all six categories.
- **Build fails** if any key present in `en.json` is missing from `ar.json` (and vice versa). `t.ts` makes a key missing from `ar.json` a type error; `uv run sawa check i18n` catches both directions, nested values, invalid JSON and Arabic plurals missing any of the six categories, and is what CI runs.
- Numbers: format with `Intl.NumberFormat(locale)`. Leave the digit style at the locale default; do not hard-code Western or Eastern Arabic digits.
- Never put user-facing strings in components; everything goes through `t()`.

## 5. RTL and CSS rules (hard rules)

- **Logical properties only**: `margin-inline-start`, `padding-inline`, `inset-inline-start`, `text-align: start`, `border-inline-end`, etc. Physical `left/right` properties are allowed only inside geometry that must not mirror (the report overlay canvas, which is always `dir="ltr"`).
- Add a lint step (stylelint with a logical-properties plugin) that fails on physical properties outside `src/**/report/overlay/**`. Stylelint only sees `<style>` blocks, so a Playwright audit also lints every `style` attribute in the built pages with the same config.
- Specimen text containers: `dir="auto"`. Controls with Latin-only values (codepoints, file names): `dir="ltr"`.
- Icons that imply direction (arrows, chevrons) flip in RTL; others don't.

## 6. Playground state (URL schema)

| Param | Values | Default |
|---|---|---|
| `text` | URL-encoded string (omit when a preset is used) | — |
| `preset` | `mixed` · `quran` · `stress` · `custom` | `mixed` |
| `fam` | `sawa-serif` · `sawa-sans` · `sawa-mono` (the Specimen's selected family) | `sawa-serif` |
| `wght` | integer weight for the Specimen | the family's `wght` axis default |
| `size` | 12–144 (px) | `32` |
| `wf` | `1` = waterfall on | off |
| `lh` | `default` or a number | `default` |
| `pal` | `mono` · `gray` · `groups` | `groups` |
| `bg` | `light` · `dark` | follows `prefers-color-scheme` |
| `feat` | comma list of OpenType features, e.g. `ss01` | none |
| `metrics` | `1` = overlay on | off |
| `view` | `stacked` · `side` | `stacked` |
| `fonts` | comma list of font ids, in order | `sawa-serif,sawa-sans,status` |
| `ov` | per-pane overrides, e.g. `2:font=amiri;pal=gray` | none |

**Report page params.** The Build report page keeps its own state in `r`-prefixed params (`parseReportState` / `toReportSearch` in `url.ts`), so it never reads or writes the playground's:

| Param | Values | Default |
|---|---|---|
| `rt` | a test id from the bundle's manifest | the bundle's first test |
| `rf` | `sawa-serif` · `sawa-sans` · `sawa-mono` (which Sawa layer and its upstream layer are compared) | `sawa-serif` |
| `rm` | `onion` · `swipe` · `side` | `onion` |
| `ro` | 0–100, the upstream layer's opacity in onion mode | `50` |
| `rs` | 0–100, the swipe divider's position from the left | `50` |
| `rl` | comma list of the toggles that are on, from `sawa`, `upstream`, `guides`, `diff`; `none` for all off | `sawa,upstream,diff` |
| `rz` | `fit` · `100` · `200` | `fit` |

Same rules as above: fixed order `rt, rf, rm, ro, rs, rl, rz`, defaults omitted, invalid values fall back to their default, `ro`/`rs` are integers clamped to 0–100, `rl` is written in the order listed. `rt` must be a lowercase id; the page drops one the bundle lacks, and writes none for the first test.

Language switch links carry the current query string. Use `history.replaceState` while controls change; don't push a history entry for every slider tick.

**`ov` syntax:** entries joined by `,`; each entry is `<pane>:<key>=<value>[;<key>=<value>]`, where `<pane>` is the 1-based position of a font in `fonts`. The only allowed keys are `font` (a roster id or `local`) and `pal`. Example: `ov=2:font=amiri;pal=gray,3:pal=mono`.

**Normalisation rules:**
- `text` present with `preset` absent implies `preset=custom`. When `preset` is anything else, `text` is ignored and never serialised.
- `size`: integer only; out of range clamps to 12–144; anything non-numeric falls back to the default.
- `wght`: integer only, clamped to 1–1000 by the state module; anything non-numeric falls back to the default. The state module doesn't know axis ranges, so the page clamps it to the selected family's `wght` axis from `fonts.json` and drops it when it equals that axis's default.
- `lh`: `default` or a number clamped to 0.8–3, serialised with at most 2 decimals and no trailing zeros.
- `feat`: only tags matching `[A-Za-z0-9]{4}` are kept, de-duplicated, in first-seen order. It lists the features toggled away from their default: an off-by-default feature (`ss01`, `onum`) listed is on, and a default-on one (`liga`, `clig`, `calt`, `kern`) listed is off. Required shaping features (`rlig`, `ccmp`, `init`, ...) are shown read-only.
- `fonts`: unknown ids and duplicates (keeping the first) are dropped; an empty result falls back to the default. The side view shows 2–4 columns but the state module doesn't enforce a maximum; `sideColumns()` caps a state's fonts list at 4 for that view.
- `ov` entries for a pane beyond the `fonts` list, or a pane repeated more than once (first wins), or a key equal to that pane's own resolved value, are dropped.
- `ov` panes are positional, not tied to a font: reordering or removing entries in `fonts` directly would silently reassign an override to a different font. The UI calls `setFonts()` to change the fonts list, which remaps each override to its font's new position and drops it if that font left.
- Any invalid enum value falls back to its default. Unknown query params are ignored on parse and never re-emitted.
- Serialisation is canonical: fixed param order as in the table above, every default omitted, so the default state serialises to an empty string.

## 7. Font roster and loading

| id | Font | Source | Notes |
|---|---|---|---|
| `sawa-serif` | Sawa Serif | built by `sawa build fonts` from `data/sawa.json`, OFL | Variable wght 400 to 700; headings (`--font-display`) |
| `sawa-sans` | Sawa Sans | built by `sawa build fonts` from `data/sawa.json`, OFL | Variable wght 400 to 700; UI text (`--font-ui`) |
| `sawa-serif-harakat`, `sawa-sans-harakat` | Sawa Serif Harakat, Sawa Sans Harakat | built by `sawa build fonts` with their plain family, OFL | Not roster entries of their own: the gray and groups palettes show a Sawa Serif or Sans pane, and the Specimen's Al-Fatiha and mark legend, in the twin (§1) |
| `sawa-mono` | Sawa Mono | built by `sawa build fonts` from `data/sawa.json`, OFL | Variable wght 400 to 700; code and codepoints (`--font-mono`). Line box 1.260 em, for code, not Quran text (§13). Its Quranic marks missing from Cascadia come from Noto Sans Arabic, U+02BE, U+02BF from Noto Sans (§1); its OFL.txt carries both Noto licences after Cascadia's. The borrowed glyphs carry no TrueType hinting instructions; Cascadia's own glyphs keep theirs |
| `status` | Status quo | `data/upstream.json` via `sawa build fonts`, OFL, **no Arabic** | Must fall back to the system Arabic font; that's the point. Stays live, so each visitor sees their own fallback. Labelled "Your system's Arabic fallback"; the page does not try to detect which font that is. The Specimen page also shows one static image of the same paragraph on Windows, macOS and Android fallbacks, captured once by hand |
| `amiri` | Amiri | `data/upstream.json` via `sawa build fonts`, OFL | upstream base. Pinned: aliftype/amiri release 1.003, `Amiri-1.003.zip`, SHA-256 `81af0aff7d2086d8af24cea7202f7546130997982534691373485cd96744d05e`, recorded in `data/upstream.json`. Not google/fonts: its Amiri is 1.002 with broken Latin kerning |
| `amiriq` | Amiri Quran | `data/upstream.json` via `sawa build fonts` (amiri source), OFL | reference for fully vowelled text; upstream disables some stacking in it |
| `sch` | Scheherazade New | `data/upstream.json` via `sawa build fonts`, OFL | |
| `noto` | Noto Naskh Arabic + Noto Serif | `data/upstream.json` via `sawa build fonts`, OFL | Sawa Serif's sources, unmerged |
| `noto-sans` | Noto Sans Arabic + Noto Sans | `data/upstream.json` via `sawa build fonts`, OFL | Sawa Sans's sources, unmerged (static Regular and Bold) |
| `local` | user file | `FontFace` from a file input | Loaded in the browser only; never uploaded. This is how fonts we may not redistribute (e.g. KFGQPC) get compared, so never add a download for them |

Self-host every font (no third-party font CDN), with `font-display: swap`. Palettes are chosen with `@font-palette-values` + `font-palette`: `--sawa-groups-light`, `--sawa-groups-dark`, `--sawa-gray-light` and `--sawa-gray-dark` name the twins' CPAL palettes by their index in `data/palettes.json`. The dark palette must be named: Chrome keeps `font-palette: normal` on palette 0 in dark mode whatever its CPAL type, so the site sets the dark palette under `prefers-color-scheme: dark` and inside a Compare stage with `bg=dark`, and the light one inside `bg=light`.

`sawa build fonts` also writes `<out>/fonts.json`, read from each TTF before its woff2 conversion: per font id, its CSS family stack and, per family, its faces (family/weight/style/file) and real metrics (`unitsPerEm`, hhea/typo/win, x-height, cap-height), GSUB/GPOS feature and script tags, and COLR/CPAL info. The site loads this at build time (`site/src/fonts/`) to write the `@font-face` rules and the `--font-ui` stack, and will later drive the feature panel, metrics overlay and palette control from it. The site never fakes any of this: a font with no CPAL table reports `cpal: null`, and the palette control must say the font has no colour palettes rather than showing an empty or default one.

## 8. Build report

### 8.1 Bundle format (produced by CI per release)

`sawa report build [--version V] [--out DIR] [--baseline DIR] [--fonts-dir fonts] [--fontbakery]` writes:

```
report/<version>/
├─ manifest.json          # version, git sha, UTC date, tool versions, Sawa + upstream font files with sha256,
│                         #   test ids, diffBaseline {kind: previous|upstream, version}, shaping and Fontbakery summaries
├─ metrics.json           # per family: UPM, hhea/typo/win, useTypoMetrics, x/cap height, line box in em, axes
├─ coverage.json          # Unicode version, then per family and its upstream fonts: per Unicode block, per mark group and per glyph set
│                         #   (GF Latin Core/Plus, GF Arabic Core/Plus, GF TransLatin Arabic, §2.16 romanisation)
├─ shaping.json           # per family, test and weight: pass/fail/missing, first differing glyph, expected vs actual
├─ tests/<test-id>/
│  ├─ test.json           # purpose (en + ar), text, codepoints, features, font size, viewBox, guides per layer
│  │                      # (ascender, cap height, x-height, baseline, descender, line box), diffBaseline,
│  │                      # diffAgainst per Sawa layer, diffRegions per Sawa layer (boxes in SVG units)
│  ├─ sawa-serif.svg, sawa-sans.svg, sawa-mono.svg           # one layer per font, all on the SAME
│  └─ upstream-serif.svg, upstream-sans.svg, upstream-mono.svg  # viewBox, origin (x 0) and baseline (y 0)
└─ fontbakery/             # only with --fontbakery: <family>/index.html per family, index.html linking them
```

- Tests: every entry of `tests/strings/stress.json`, each mixed sentence (`mixed-<id>`) and Al-Fatiha 1:1 (`fatiha-1`). Upstream layers are the exact variable fonts each family is built from (Noto Serif + Noto Naskh Arabic, Noto Sans + Noto Sans Arabic, Cascadia Mono) at the family's default wght and pinned axes, with per-character font fallback.
- Rendering: `hb-view` has no Windows build, so `report/render.py` shapes with uharfbuzz and draws outlines through its draw API into one `fill="currentColor"` path per layer, 64 units per em plus a 16-unit margin. Mixed lines are split into bidi runs by `report/bidi.py`, UAX #9 without explicit embeddings, overrides and isolates (X1 to X8, X10), which it rejects; it covers weak types, bracket pairs (N0, from `data/unicode/BidiBrackets.txt`), neutrals, implicit levels, L1 and L2, and passes every case of Unicode's `BidiCharacterTest.txt` (vendored in `tests/data/unicode/`) that has no explicit formatting characters. Each run is shaped with the whole line as context.
- Diff regions: `report/raster.py` fills the layers' own path data (nonzero winding, sampled at pixel centres, 2 px per unit) with numpy, `report/diff.py` XORs the two masks over the union of both viewBoxes, drops changed specks under 4 px, dilates by 4 px and stores each connected component's box. Identical path data always gives no regions. The site draws boxes; it never computes diffs.
- Baseline for the diff: `--baseline` is a previous bundle; each Sawa layer is compared to that bundle's same file, falling back to its upstream layer for a test the baseline lacks. With no baseline, every layer diffs against its upstream layer (`diffBaseline: "upstream"`). CI passes the previous tag's bundle on a tag and the latest tag's on `main` (§9).
- Shaping: `tests/shaping/<family>.json` holds each glyph's name, cluster, advances and offsets at the family's wght minimum, default and maximum. `sawa report shaping` compares, `--update` rewrites; the bundle records the comparison without failing the build.
- Fontbakery: the universal profile, run once per family, opt-in because it adds a large dependency tree; `ttx_roundtrip` is excluded (about ten minutes on these variable fonts, against about a minute and a half for the rest), and the manifest records the exclusion and each family's status counts.
- Test strings come from `tests/strings/stress.json`, the same file the site's "Mark stress test" preset reads.
- Mark groups come from `data/mark-groups.json`, checked by `uv run sawa check marks`: it fails if two groups share a codepoint, if a codepoint is malformed, or if a combining mark the font's cmap supports (Unicode category `Mn` in the Arabic blocks) is in no group; it runs on the Sawa Serif, Sans and Mono woff2s and on both Harakat woff2s, which must map the same marks as their plain twins and have COLR base glyphs for exactly the plain family's glyphs of the marks in the groups.
- `sawa check fonts` also fails, per family, when a mark from `data/mark-groups.json` that the font maps is not a GDEF mark, is attached to no letter (no MarkBase subtable with alef as a base positions it), or, for everyday tashkeel (U+064B to U+0655, U+0670, U+06E1, U+08F0 to U+08F2; every other Arabic combining mark is niche), shaped by HarfBuzz on beh, alef, lam, kaf, final yeh and final noon at the wght minimum, default and maximum, overlaps the letter's ink (dots and signs included) or sits more than `--max-mark-gap` (0.25 em) from it; and when any pair of everyday marks a mark-to-mark subtable stacks, shaped on the same letters and weights, puts two of the letter's, the first mark's and the second mark's inks over each other. The pause marks U+06D6 to U+06DC are held to the opposite: GDEF bases with an advance, attached to no letter.
- `sawa check leading` shapes every line of the corpus (all 6236 Tanzil Uthmani verses, the stress strings and the mixed sentences; Sawa Mono skips the Quran) at every master location, the midpoint between each two neighbouring masters and the wght minimum, default and maximum (read from the font's variation data), one process per weight, and prints its runtime. Each line is measured in its everyday view, its niche marks (the pause marks included) dropped, and there it fails on any mark within `markClearance` of another glyph's ink (within a cluster or between clusters; hamza and madda count as marks), and when the family's typo line box is lower than the highest ink top less the lowest ink bottom of the corpus, since any two lines can be neighbours (Sawa Mono takes these from the mixed sentences only, `leading.boxParts`); it reports the share of lines inside that box. The lines as they are fail only when their ink passes the win metrics; their collisions and contacts are reported.

### 8.2 Viewer (report page)

- Summary tiles: shaping pass/fail, coverage, vertical metrics, Fontbakery (links to `fontbakery/index.html`).
- Test list → test card with purpose, codepoints, layer toggles (each font, guides, diff), and modes: **onion skin** (opacity), **swipe** (divider), **side by side**.
- The overlay canvas is always `dir="ltr"` (it's geometry, not text flow).
- Release picker: "Latest" on Pages; link to Read the Docs for older versions.

### 8.3 History on Read the Docs

`.readthedocs.yaml` (repo root):

```yaml
version: 2

build:
  os: ubuntu-24.04
  tools:
    nodejs: "22"
    python: "3.13"
  commands:
    - pip install uv
    - npm install -g bun@1.4.0
    - uv run --locked --group build sawa build fonts
    - uv run --locked sawa rtd fetch-bundle --version "$READTHEDOCS_VERSION_NAME" --out report/current
    - cd site && bun install --frozen-lockfile
    - cd site && export BASE_PATH="$(uv run sawa rtd base-path)" && test -n "$BASE_PATH" && REPORT_ONLY=1 REPORT_DIR=../report/current bun run build
    - uv run sawa rtd copy-tree site/dist "$READTHEDOCS_OUTPUT/html"
```

Each `commands` entry runs in a fresh shell from the repo root, so a `cd` only lasts for its own line. Read the Docs builds run on Linux; the `sawa` CLI keeps the same steps runnable locally on Windows.
`npm install -g bun` bootstraps bun from the image's existing Node.js tool, landing on npm's global bin, which is already on `PATH` for every later `commands` line; a curl install would need its own `PATH` export repeated on each line since every line is a fresh shell.
`sawa build fonts` runs the same full command as CI (§9 step 2): the report page needs the Sawa family woff2s and `site/public/fonts/fonts.json`, and there's no lighter "Sawa families only" mode, so this also downloads and builds the whole roster (~2 minutes); the report-only build simply never links to the pages that would use it.

Implemented:
- `sawa rtd fetch-bundle --version <v> --out <dir>` (`src/sawa_tools/rtd.py`): for a tag, downloads `sawa-report-<tag>.zip` from that tag's GitHub release via the public, unauthenticated REST API (`GET /repos/adehad/sawa-font/releases/tags/<tag>`) and its asset's `browser_download_url`; for `latest` or `stable`, Read the Docs' names for the default-branch and stable-branch builds, takes the newest release via `GET /repos/adehad/sawa-font/releases/latest` (skips prereleases and drafts, GitHub's own definition of "latest"). `.readthedocs.yaml` passes `$READTHEDOCS_VERSION_NAME`, not `$READTHEDOCS_VERSION`: the former is the actual tag name Read the Docs checked out, the latter a slug that need not match it. A 403/429 with no rate-limit quota left (checked via the `X-RateLimit-Remaining`/`X-RateLimit-Reset` headers) fails immediately with the reset time in the message rather than burning retries on a request that cannot succeed sooner; other transient failures retry twice with a short, increasing backoff (1s, 2s). A 404 (no matching release, or a release with no bundle asset) writes nothing and returns cleanly, so the site build still succeeds and the report page shows its no-bundle message. Zip extraction rejects absolute paths, `..` members and Windows drive-relative members (`C:foo`); before removing an existing `--out`, it also refuses when that path is the working directory or one of its ancestors.
- `sawa rtd base-path`: prints `READTHEDOCS_CANONICAL_URL`'s path component (leading and trailing slash), or `/` with the variable unset.
- `sawa rtd copy-tree <src> <dst>`: cross-platform recursive copy, replacing `<dst>`; refuses when `<src>` and `<dst>` are the same path or one contains the other.
- `REPORT_ONLY=1` (site side): `getStaticPaths` returns `[]` for the Specimen, Compare and About pages, so only the report page (both locales) and the root `/` redirect build; the redirect targets `<base><locale>/report/` instead of the Specimen page. The base layout's nav and brand link hide the missing pages, its injected `@font-face` CSS is scoped to the three Sawa families (`fonts/css.ts`'s `fontFaceCss(..., SAWA_FONT_IDS)`), and the built `dist/fonts` directory is pruned to just those families' woff2s after the build (the report page never links to the rest of the comparison roster, but Astro's public-dir copy ships it verbatim otherwise). A second Playwright project (`site/playwright.report-only.config.ts`, `bun run test:e2e:report-only`) builds the site this way under a versioned base path and audits it the way `link-audit.spec.ts` audits the full build: only the expected pages exist, `dist/fonts` holds only the Sawa families, no link points outside the base path, the language switch and root redirect work, and no request for a built page 404s.

- `BASE_PATH` is derived from `READTHEDOCS_CANONICAL_URL`, because pages are served under `/<lang>/<version>/`. Read the Docs' `<lang>` is the project language, not the site locale, so a real URL looks like `/en/v1.0/ar/report/`. That double prefix is expected; don't "fix" it. `.readthedocs.yaml` exports `BASE_PATH` from `sawa rtd base-path` and checks it is non-empty before building, so a failure in that step stops the build instead of silently building under the wrong base.
- Read the Docs builds from tags; `latest` and `stable` may point at `main` (or whichever branch each tracks). `fetch-bundle`'s `latest`/`stable` handling is about which *bundle* to show, not which page gets built: the report-only site build itself always builds from whatever branch or tag Read the Docs checked out for that version, `fetch-bundle` just downloads the newest tagged release's bundle into it.
- The free Community plan shows small ethical ads; accepted.

Checked against Read the Docs' own v2 config reference (docs.readthedocs.com): `build.os: ubuntu-24.04`, `tools.nodejs: "22"`, `tools.python: "3.13"` are all listed as supported values; `build.commands` is documented to fully replace the default build steps (no Sphinx/MkDocs assumptions to satisfy); `$READTHEDOCS_OUTPUT/html` is the documented location for the final HTML. Not verified: an actual Read the Docs build, since that needs the project to exist (below); the local simulation in this repo's history stands in for that.

## 9. CI workflow (`release.yml`, outline)

1. On push to `main` and on tags `v*`.
2. `uv run sawa build fonts` (downloads the pinned sources, checks their SHA-256, builds the Sawa families into `fonts/`, applying the committed compaction fits, about 7 minutes from cold, and writes woff2 into `site/public/fonts/`), then `sawa check fonts`, `sawa check leading` and `sawa check marks`.
3. to 6. `uv run sawa report baseline` downloads the baseline bundle (the previous tag's `sawa-report-<tag>.zip` release asset on a tag, the latest tag's elsewhere; none means diff against upstream), then one `sawa report build --out report/current` writes the whole §8.1 bundle (with `--fontbakery` on pushes, tags and manual runs; pull requests skip it): shaping, SVG layers and diff regions, Fontbakery, manifest, metrics and coverage. `--version` is the tag, or the commit sha for untagged builds. `report/current` is uploaded as the `report` workflow artifact on every run.
7. i18n key-parity check, CSS logical-properties lint, `ruff check`, `ruff format --check`, `ty check`.
8. Build the Astro site with the report bundle and fonts → deploy to GitHub Pages.
9. On tags: the `release` job (`contents: write`) zips the `report` artifact as `sawa-report-<tag>.zip` and attaches it to the GitHub Release, creating the release if missing (Read the Docs picks it up from there).

**Implemented so far:** steps 2 to 9. The site build reads the bundle from `REPORT_DIR` (default `../report/current`, resolved against `site/`), validates it, and copies its SVG layers and Fontbakery pages to `<base>/report-bundle/`; with no bundle the report page says how to make one and the build still succeeds. One-time manual step, not done by the workflow: set the repo's Pages source to "GitHub Actions" under Settings → Pages.

## 10. Where the real site differs from the mockup

- The mockup simulates Sawa (Literata + Amiri Quran at 130% inside a fixed line height). The real site loads the real font; no per-script span tricks.
- The mockup cannot recolour marks inside shaped text. The real site uses the font's COLR/CPAL palettes via `font-palette`.
- The mockup's report layers are live text. The real report stacks the CI SVGs.
- The mockup's Quran preset is placeholder text. Use verbatim Tanzil text only.
- The mockup's local-font picker is inert. Implement it with `FontFace` and an object URL.
- The mockup's metrics overlay is a stripe grid. The real overlay draws baseline, x-height, ascender/descender and each line box from the font's metrics.
- Synced scrolling, waterfall, per-pane overrides and the OpenType feature panel aren't in the mockup; build them.

## 11. Licence obligations

- **Tanzil:** text is used verbatim, never altered. Copy the exact licence wording from Tanzil's own terms page into `data/tanzil/` and quote it from there; don't paraphrase it as a Creative Commons licence name in the site or canvas. Credit Tanzil.net with a link to http://tanzil.net wherever the text appears (footer + preset menu). Keep Tanzil's copyright notice in the data files. For "no tashkeel" views, use Tanzil's own variant; never strip marks yourself.
  - `data/tanzil/uthmani-fatiha.txt` and `simple-clean-fatiha.txt` hold a committed excerpt (Al-Fatiha 1:1-7), copied byte-exact from a full download, followed by that download's complete copyright block, also byte-exact. `data/tanzil/README.md` records the source URLs (with their exact query params), fetch date, and the sha256 of each full download. These files must never be edited by hand; a pytest pins each excerpt's verse lines and copyright block by sha256 so an accidental edit fails CI.
  - Tanzil's default Uthmani output never uses U+06E1 (round sukun) or U+08F0-08F2 (open tanween). The "different tanween shapes" option adds U+06ED (small low meem) after tanween marks, for the me_quran font (99 occurrences in the default text, 4807 with the option). We use the default output; `tests/strings/stress.json` supplies U+06E1 and U+08F0-08F2 directly.
- **OFL fonts:** ship each font's `OFL.txt`. Amiri 1.003 declares no Reserved Font Name (its licence header names only the copyright holders). Still keep "Amiri" out of Sawa's family names.
- **Mixed sentences:** written for the project, CC0; say so on the About page.
- No English Quran translations (common ones are under copyright).

## 12. Milestones and acceptance checks

Testing split:
- **Playwright** end-to-end tests in `site/tests/e2e/`, run in CI against the built `dist/` served under `/sawa-font/` (this also catches hard-coded links). Each ✅ below has a named test: the language-switch check in Playwright, key parity in pytest, the stylelint rule in Vitest.
- **Vitest** for `t()` and the URL-state parser/serialiser (`ov` syntax, out-of-range `size`, unknown font ids).
- **pytest** for `sawa_tools`, including `sawa check i18n`.
- Local commands: repo root `uv run pytest`, `uv run sawa check i18n`, `uv run ruff check`, `uv run ty check`; in `site/` `bun run check`, `bun run test`, `bun run lint:css`, `bun run test:e2e` (builds first).
- No screenshot diffs of the site; glyph rendering is covered by the report pipeline.

**M1 — Skeleton**
- Astro project, `/en/` and `/ar/` routes, base layout with correct `lang`/`dir`, language switch preserving path + query.
- ✅ Switching language on any page lands on the same page with identical query params.
- ✅ CI fails if a key is missing from either locale.
- ✅ Stylelint fails on a physical `margin-left` outside the allow-list.

**M2 — Specimen + Compare**
- Done: font loading, roster toggles, both layouts, all controls, URL state, local font loading (TTF/OTF/WOFF metrics and features read in the browser; WOFF2 loads but reports its metrics as unavailable), OpenType feature panel, metrics overlay.
- ✅ Palettes: gray and groups set Sawa Serif and Sans in their Harakat twins and colour the marks from the fonts' own palettes, light or dark with the theme; other fonts' palette selects are disabled with a note: `harakat.spec.ts`.
- ✅ Every control round-trips through the URL (reload restores the exact view): `compare.spec.ts` "every control round-trips through the URL" and "the shared and per-pane palettes round-trip through the URL"; Specimen controls in `specimen.spec.ts`.
- ✅ In the Arabic UI, side-by-side panes run right to left; specimen text direction is unchanged: `compare.spec.ts` "in the Arabic UI the side-by-side columns run right to left".
- ✅ The status quo pairing visibly uses the system Arabic fallback: `compare.spec.ts` "the status quo pane uses Source Sans with the system's own Arabic" (its stack has no Arabic web font, and alef's width changes with the fallback after Source Sans while Latin's doesn't).

**M3 — Report pipeline**
- CI produces the bundle (§8.1) with the Sawa families; report page renders it; Fontbakery page hosted.
- Done: the bundle (`sawa report build`, §8.1), committed shaping snapshots for the current fonts (all pass), the CI build, the `report` artifact and the release asset. Sawa Serif differs from its upstream layer in every test, from its 1.064 Arabic scale; Sawa Sans and Sawa Mono where their marks now attach, stack or clear their letters differently, Sawa Mono also where it draws the borrowed marks.
- Done: the report page (`site/src/pages/[lang]/report.astro`): summary tiles, test list and cards, and the layer viewer (`site/src/components/report/overlay/`) with onion skin, swipe and side by side, all in the URL (§6); the Fontbakery pages are served from `<base>/report-bundle/fontbakery/`.
- Remaining: `REPORT_ONLY=1` for the Read the Docs build (M4).
- ✅ Toggling layers, onion, swipe and side-by-side works on every test: `report.spec.ts` "toggling each layer changes its visibility", "onion skin opacity sets the upstream layer's computed opacity", "the swipe divider clips the Sawa layer by pointer and by keyboard", "side by side shows the Sawa and upstream layers in two panes"; every test's layers share one viewBox: "every test's SVG layers share its viewBox".
- ✅ SVG layers line up pixel-exactly when two identical fonts are stacked: `report.spec.ts` "two identical fonts stacked as layers line up pixel-exactly" (Sawa Sans over its upstream layer screenshot identically, with Sawa Serif as the control that must differ).

**M4 — History**
- Release zip attached on tags; Read the Docs report-only build.
- Done: `sawa rtd fetch-bundle` / `base-path` / `copy-tree` (§8.3), the `REPORT_ONLY=1` site build, `.readthedocs.yaml`. Simulated locally end to end (fetch-bundle against the real, currently release-less repo; the report-only build served under `/en/latest/` with a static server) since there is no Read the Docs project yet to build against for real.
- ✅ Two tagged releases show as two versions on Read the Docs with working asset paths: blocked on the project existing; only the repo owner can do this, at readthedocs.org:
  1. Sign in with the GitHub account that owns (or administers) `adehad/sawa-font`, then "Import a Project" and pick it; this installs the Read the Docs GitHub App/webhook.
  2. Project Admin → Settings: confirm the config file is picked up as `.readthedocs.yaml` at the repo root (the default).
  3. Project Admin → Versions: activate `latest` (tracks `main`) and activate each `v*` tag as its own version. Only activated versions build and appear in the version switcher.
  4. Trigger a build for `latest` and for at least two tags (push, or "Build Version" in the dashboard), and confirm both appear in the version flyout with the report page loading and its SVG/Fontbakery assets resolving under `/<lang>/<version>/report-bundle/...`.
  5. Once the project exists, replace the `OLDER_REPORTS_URL` placeholder in `site/src/report/links.ts` with its real subdomain (§13).

**Later**
- Connect Hosted Weblate (flat JSON component; confirm libre-plan eligibility first).
- Sawa Mono column (replaces the Kawkab placeholder).

## 13. Open decisions (ask, don't decide)

Resolved: palettes. Gray and groups are CPAL palettes of separate Harakat builds of Sawa Serif and Sans (§1), COLRv0 with each mark its own layer; the site names the dark palette itself in a dark theme (§7). Sawa Mono gets no Harakat build.

Resolved: Kawkab Mono is OFL (Reserved Font Name "Source", by Abdullah Arif) but is not used; Sawa Mono comes from Cascadia.

- Simpler letter joins: Amiri's stacked joins (e.g. لمين, نجا) live in the required `rlig` feature and can't be turned off by feature settings. Decide whether Sawa edits those rules.
Resolved: line boxes. Compaction (§1) repositions the marks, and each family's box holds any two lines of everyday text at every sampled weight (§1, checked in CI by `sawa check leading`). Before it, Serif 1.812 em let 29.9% of adjacent Quran line pairs collide and Mono 1.164 em 97.9%. Sawa Mono sizes its box from the mixed sentences only: the stress strings (dagger alef over lam, kasratan under a stacked join) would need 1.708 em, too tall for code. Lines with niche Quranic marks can still collide (Serif needs 2.082 em for none, Sans 2.307 em); they are reported, not fixed by a larger box.
Resolved: the per-letter clearance lookups of `build/anchors.py` are replaced by ink-derived anchors and a residual contextual pass. GPOS lookups in all, before and after: Serif 620 and 111, Sans 393 and 140, Mono 1209 and 36. Of those after, the residual pass adds 76, 103 and 17 (1021, 918 and 260 contextual rules); it keeps 8 units per 1000 above the clearance and is fitted on the masters and the fonts halfway between them, which takes about 27 min for Serif, 35 to 40 min for Sans and 4 min per Mono on 16 cores, so it is fitted locally and committed (§1) and CI applies it.

- Full Quran support in Sawa Mono needs a compact mark redesign: its Quranic marks are Noto Sans Arabic's scaled to Cascadia, too tall for a code line box, so Mono's collision check leaves out the Quran text.
- Niche Quranic marks (U+0610 to U+061A, U+0656 to U+065F, U+06DF to U+06ED, U+08D3 to U+08FF and the rest) still touch letters and other marks in places; `sawa check leading` counts them. They could borrow Amiri Quran's outlines (OFL, pinned in `data/upstream.json`) scaled to each family's fatha.
- Vendor ID, version and copyright holder in `data/sawa.json` are placeholders.
- Known limit: Tanzil text writes a pause mark after a space, and UAX #14 lets a line break before it (a combining mark after a space breaks like a letter), so a wrapped verse can start a line with a pause mark. The Tanzil text stays verbatim, so it gets no no-break space. The site's own samples would put U+00A0 before a pause mark that follows a space; none does today.
- Fontbakery's universal profile (without `ttx_roundtrip`) fails only `case_mapping`: in Sawa Mono and Mono NF, Cascadia has U+023A, U+023B, U+023E, U+026A, U+026C, U+1E30 and U+1E6E without their other case (U+2C65, U+023C, U+2C66, U+A7AE, U+A7AD, U+1E31, U+1E6F); and, with Unicode 16 case data (Python 3.14), every family has U+0264 without U+A7CB. Decide whether Sawa Mono borrows the missing letters from Noto Sans, as it does its Quranic marks, or leaves them out.
- Fontbakery warnings kept on purpose:
  - `gdef_mark_chars`: the pause marks U+06D6 to U+06DC are spacing glyphs (§1); U+031A, U+1ACC to U+1ACE and Cascadia's U+0315, U+0340 to U+0342 and U+05C7 are spacing or unclassed in the sources.
  - `gdef_non_mark_chars`: the five ties and overlines in Sawa Serif are marks so that their zero advance is a mark's (§1); U+0385, U+FB2C, U+FB2D and U+FB49 are Cascadia's own marks.
  - `gdef_spacing_marks` (Mono): Cascadia's unencoded mark components keep the cell width.
  - `arabic_high_hamza` (Mono): Cascadia draws U+0674 smaller than its U+0621; a design question for the Mono Arabic redesign.
  - `monospace` (Mono): hhea.numberOfHMetrics is Cascadia's glyph count, as varLib writes it.
  - `typoascender_exceeds_Agrave` (Mono): the code line box is sized for the mixed sentences, not accented capitals (§7).
  - `mandatory_avar_table` (Serif, Sans): the Noto sources have no avar either.
  - `file_size`: every family carries both scripts in full.
  - `alt_caron`, `caps_vertically_centered`, `math_signs_width`, `overlapping_path_segments`, `soft_hyphen`, `stylisticset_description`, `unreachable_glyphs`, `valid_glyphnames`: the sources' own outlines, glyph set and names, kept as they ship.
- Whether older Amiri releases declared a Reserved Font Name (1.003 does not).
- Trademark check on "Sawa" (UK IPO, WIPO) before public release.
- TODO: the Read the Docs project doesn't exist yet. The report page's "Older reports on Read the Docs" link points at a placeholder, `OLDER_REPORTS_URL` in `site/src/report/links.ts` (`https://sawa-font.readthedocs.io/`); confirm the real URL once the project is created.
