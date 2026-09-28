# Sawa — specimen site: build plan

Brief for a coding agent. Every decision here was agreed with the project owner; where something is marked **OPEN**, do not decide it yourself — leave a TODO and ask.

Design reference: the "Sawa — specimen site" canvas (interactive mockup with EN/AR switch, Specimen / Compare / Build report / About). The mockup fakes some behaviour; section 10 lists where the real build must differ.

---

## 1. What we are building

**Sawa (سوا)** is a bilingual Arabic/English font family built on **Amiri** (SIL OFL 1.1, aliftype/amiri). Arabic is scaled to match the Latin's visual size, both scripts share one set of vertical metrics (so mixed lines don't change height), and tashkeel can be shown in black, gray, or coloured by mark group.

Family members (names fixed):

| Build | Purpose |
|---|---|
| Sawa | Proportional; default palette = monochrome |
| Sawa Gray | Same font, default palette = marks in gray |
| Sawa Harakat | Same font, default palette = mark-group colours |
| Sawa Mono | Later: monospace sibling, Nerd Font patched |

This repo's first deliverable is the **specimen website plus the report pipeline**. Until the real Sawa build exists, CI uses Amiri Regular as a stand-in "Sawa" so the whole pipeline can be built and tested end to end.

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
12. **Look:** neutral tool with a light manuscript touch — warm off-white, ink text, one deep-green accent, real dark mode. UI text set in Sawa (stand-in until it exists).
13. **Build report:** Chromatic-style layered viewer; CI produces SVG layers + JSON; Fontbakery HTML hosted as a static page.
14. **Report history:** latest on GitHub Pages; versioned history on **Read the Docs** using `build.commands` to run Astro in *report-only* mode against each release's bundle, downloaded from GitHub Releases.
15. **Automation language:** Python, managed with **uv**, linted and formatted with **ruff**, type-checked with **ty**. No shell scripts: all automation lives in one package, `src/sawa_tools/`, behind a single `sawa` console entry point with argparse subcommands (`uv run sawa report shaping`, `uv run sawa check i18n`, `uv run sawa rtd base-path`). The same commands run on Windows, macOS and Linux. Tests use pytest. The font toolchain (fontmake etc.) sits in a uv dependency group `build`, so site-only checks don't install it. Node is used only inside `site/`.
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
│  └─ shaping/               # HarfBuzz expectations
├─ data/
│  ├─ upstream.json          # pinned roster font sources; consumed by `sawa build fonts`
│  ├─ tanzil/                # verbatim Tanzil text + its licence header, unmodified
│  └─ mark-groups.json       # mark group → codepoints; single source for site legend + coverage.json
├─ src/sawa_tools/           # Python package; `sawa` CLI (see §2.15)
│  ├─ cli.py                 # argparse entry point
│  ├─ build/                 # `sawa build fonts`: fontmake/fontTools, CPAL palettes from mark-groups.json
│  ├─ report/                # shaping, render, diff, manifest/metrics/coverage writers
│  ├─ checks/                # i18n.py (i18n parity), marks.py (`sawa check marks`: mark-group coverage)
│  └─ rtd.py                 # fetch-bundle, base-path, copy-tree
├─ tests/python/             # pytest suite for sawa_tools
├─ .cache/                   # downloaded font archives, git-ignored
├─ report/                   # generated by CI, git-ignored; see §7
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
| `size` | 12–144 (px) | `32` |
| `wf` | `1` = waterfall on | off |
| `lh` | `default` or a number | `default` |
| `pal` | `mono` · `gray` · `groups` | `groups` |
| `bg` | `light` · `dark` | follows `prefers-color-scheme` |
| `feat` | comma list of OpenType features, e.g. `ss01` | none |
| `metrics` | `1` = overlay on | off |
| `view` | `stacked` · `side` | `stacked` |
| `fonts` | comma list of font ids, in order | `sawa,status` |
| `ov` | per-pane overrides, e.g. `2:font=amiri;pal=gray` | none |

Language switch links carry the current query string. Use `history.replaceState` while controls change; don't push a history entry for every slider tick.

**`ov` syntax:** entries joined by `,`; each entry is `<pane>:<key>=<value>[;<key>=<value>]`, where `<pane>` is the 1-based position of a font in `fonts`. The only allowed keys are `font` (a roster id or `local`) and `pal`. Example: `ov=2:font=amiri;pal=gray,3:pal=mono`.

**Normalisation rules:**
- `text` present with `preset` absent implies `preset=custom`. When `preset` is anything else, `text` is ignored and never serialised.
- `size`: integer only; out of range clamps to 12–144; anything non-numeric falls back to the default.
- `lh`: `default` or a number clamped to 0.8–3, serialised with at most 2 decimals and no trailing zeros.
- `feat`: only tags matching `[A-Za-z0-9]{4}` are kept, de-duplicated, in first-seen order.
- `fonts`: unknown ids and duplicates (keeping the first) are dropped; an empty result falls back to the default. The side view shows 2–4 columns but the state module doesn't enforce a maximum; `sideColumns()` caps a state's fonts list at 4 for that view.
- `ov` entries for a pane beyond the `fonts` list, or a pane repeated more than once (first wins), or a key equal to that pane's own resolved value, are dropped.
- `ov` panes are positional, not tied to a font: reordering or removing entries in `fonts` directly would silently reassign an override to a different font. The UI calls `setFonts()` to change the fonts list, which remaps each override to its font's new position and drops it if that font left.
- Any invalid enum value falls back to its default. Unknown query params are ignored on parse and never re-emitted.
- Serialisation is canonical: fixed param order as in the table above, every default omitted, so the default state serialises to an empty string.

## 7. Font roster and loading

| id | Font | Source | Notes |
|---|---|---|---|
| `sawa` | Sawa | `data/upstream.json` via `sawa build fonts` (amiri source), OFL | Stand-in: Amiri (all four styles) until the first real build |
| `status` | Status quo | `data/upstream.json` via `sawa build fonts`, OFL, **no Arabic** | Must fall back to the system Arabic font; that's the point. Stays live, so each visitor sees their own fallback. Labelled "Your system's Arabic fallback"; the page does not try to detect which font that is. The Specimen page also shows one static image of the same paragraph on Windows, macOS and Android fallbacks, captured once by hand |
| `amiri` | Amiri | `data/upstream.json` via `sawa build fonts`, OFL | upstream base. Pinned: aliftype/amiri release 1.003, `Amiri-1.003.zip`, SHA-256 `81af0aff7d2086d8af24cea7202f7546130997982534691373485cd96744d05e`, recorded in `data/upstream.json`. Not google/fonts: its Amiri is 1.002 with broken Latin kerning |
| `amiriq` | Amiri Quran | `data/upstream.json` via `sawa build fonts` (amiri source), OFL | reference for fully vowelled text; upstream disables some stacking in it |
| `sch` | Scheherazade New | `data/upstream.json` via `sawa build fonts`, OFL | |
| `noto` | Noto Naskh Arabic + Noto Serif | `data/upstream.json` via `sawa build fonts`, OFL | |
| `mono` | Kawkab Mono | self-hosted | **OPEN:** verify licence before shipping |
| `local` | user file | `FontFace` from a file input | Loaded in the browser only; never uploaded. This is how fonts we may not redistribute (e.g. KFGQPC) get compared, so never add a download for them |

Self-host every font (no third-party font CDN), with `font-display: swap`. Palettes are chosen with `@font-palette-values` + `font-palette`; ship light and dark palette variants.

`sawa build fonts` also writes `<out>/fonts.json`, read from each TTF before its woff2 conversion: per font id, its CSS family stack and, per family, its faces (family/weight/style/file) and real metrics (`unitsPerEm`, hhea/typo/win, x-height, cap-height), GSUB/GPOS feature and script tags, and COLR/CPAL info. The site loads this at build time (`site/src/fonts/`) to write the `@font-face` rules and the `--font-ui` stack, and will later drive the feature panel, metrics overlay and palette control from it. The site never fakes any of this: a font with no CPAL table reports `cpal: null`, and the palette control must say the font has no colour palettes rather than showing an empty or default one.

## 8. Build report

### 8.1 Bundle format (produced by CI per release)

```
report/<version>/
├─ manifest.json          # version, git sha, date, font files + hashes, test list
├─ metrics.json           # per build: UPM, hhea/typo/win ascender, descender, lineGap
├─ coverage.json          # per Unicode block and per mark group: supported / total, vs upstream
├─ shaping.json           # per test: pass/fail, expected vs actual glyph ids + positions
├─ tests/<test-id>/
│  ├─ test.json           # purpose (en + ar), codepoints, features, font size,
│  │                      # guide positions (ascender, x-height, baseline, descender, line box),
│  │                      # diff regions (bounding boxes) vs previous release
│  ├─ sawa.svg            # one layer per font, all rendered by hb-view
│  ├─ amiri.svg           #   on the SAME origin, baseline and viewBox
│  └─ <ref>.svg
└─ fontbakery/index.html  # Fontbakery HTML report
```

- Render with `hb-view --output-format=svg` at a fixed size and margin so layers line up exactly.
- Diff regions: rasterise the current and previous releases' layers, diff them, and store bounding boxes. The site draws boxes; it never computes diffs.
- Baseline for the diff: on a tag, the previous tag's bundle; on `main`, the latest tag's bundle. With no earlier release, diff against the upstream Amiri layer and mark `diffBaseline: "upstream"` in `test.json`.
- Test strings come from `tests/strings/stress.json` — the same file the site's "Mark stress test" preset reads.
- Mark groups come from `data/mark-groups.json`, checked by `uv run sawa check marks`: it fails if two groups share a codepoint, if a codepoint is malformed, or if a combining mark the font's cmap supports (Unicode category `Mn` in the Arabic blocks) is in no group.

### 8.2 Viewer (report page)

- Summary tiles: shaping pass/fail, coverage, vertical metrics, Fontbakery (links to `fontbakery/index.html`).
- Test list → test card with purpose, codepoints, layer toggles (each font, guides, diff), and modes: **onion skin** (opacity), **swipe** (divider), **side by side**.
- The overlay canvas is always `dir="ltr"` (it's geometry, not text flow).
- Release picker: "Latest" on Pages; link to Read the Docs for older versions.

### 8.3 History on Read the Docs

`.readthedocs.yaml` sketch:

```yaml
version: 2
build:
  os: ubuntu-24.04
  tools:
    nodejs: "22"
    python: "3.13"
  commands:
    - pip install uv
    - uv run sawa rtd fetch-bundle --version "$READTHEDOCS_VERSION" --out report/current
    - cd site && npm ci
    - cd site && REPORT_ONLY=1 REPORT_DIR=../report/current BASE_PATH="$(uv run sawa rtd base-path)" npm run build
    - uv run sawa rtd copy-tree site/dist "$READTHEDOCS_OUTPUT/html"
```

Each `commands` entry runs in a fresh shell from the repo root, so a `cd` only lasts for its own line. Read the Docs builds run on Linux; the `sawa` CLI keeps the same steps runnable locally on Windows.

- `REPORT_ONLY=1` builds just the report page (both locales) plus minimal layout.
- `BASE_PATH` is derived from `READTHEDOCS_CANONICAL_URL`, because pages are served under `/<lang>/<version>/`. Read the Docs' `<lang>` is the project language, not the site locale, so a real URL looks like `/en/v1.0/ar/report/`. That double prefix is expected; don't "fix" it.
- Read the Docs builds from tags; `latest` may point at `main`.
- The free Community plan shows small ethical ads; accepted.

## 9. CI workflow (`release.yml`, outline)

1. On push to `main` and on tags `v*`.
2. `uv run sawa build fonts` (downloads the pinned Amiri zip, checks its SHA-256 and copies Amiri Regular as the stand-in until the real build exists) → `fonts/`, then into `site/public/fonts/`.
3. Run HarfBuzz shaping tests → `report/<version>/shaping.json` (`<version>` is the tag, or `main` for untagged builds).
4. Render SVG layers and compute diffs against the baseline in §8.1.
5. Run Fontbakery → HTML report.
6. Write `manifest.json`, `metrics.json`, `coverage.json`.
7. i18n key-parity check, CSS logical-properties lint, `ruff check`, `ruff format --check`, `ty check`.
8. Build the Astro site with the report bundle and fonts → deploy to GitHub Pages.
9. On tags: zip `report/<version>/` and attach it to the GitHub Release (Read the Docs picks it up from there).

**Implemented so far:** step 7 (all Python checks plus `sawa check i18n`; the site's own `check`/`test`/`lint:css`/`test:e2e`), the site build half of step 8 (without the report bundle or fonts, since steps 2–6 don't exist yet), and the Pages deploy half of step 8. Steps 2–6 and 9 are still outline only. One-time manual step, not done by the workflow: set the repo's Pages source to "GitHub Actions" under Settings → Pages.

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
- Local commands: repo root `uv run pytest`, `uv run sawa check i18n`, `uv run ruff check`, `uv run ty check`; in `site/` `npm run check`, `npm test`, `npm run lint:css`, `npm run test:e2e` (builds first).
- No screenshot diffs of the site; glyph rendering is covered by the report pipeline.

**M1 — Skeleton**
- Astro project, `/en/` and `/ar/` routes, base layout with correct `lang`/`dir`, language switch preserving path + query.
- ✅ Switching language on any page lands on the same page with identical query params.
- ✅ CI fails if a key is missing from either locale.
- ✅ Stylelint fails on a physical `margin-left` outside the allow-list.

**M2 — Specimen + Compare**
- Font loading, roster toggles, both layouts, all controls, URL state, palettes with legend, local font loading.
- ✅ Every control round-trips through the URL (reload restores the exact view).
- ✅ In the Arabic UI, side-by-side panes run right to left; specimen text direction is unchanged.
- ✅ The status quo pairing visibly uses the system Arabic fallback.

**M3 — Report pipeline**
- CI produces the bundle (§8.1) with the Amiri stand-in; report page renders it; Fontbakery page hosted.
- ✅ Toggling layers, onion, swipe and side-by-side works on every test.
- ✅ SVG layers line up pixel-exactly when two identical fonts are stacked.

**M4 — History**
- Release zip attached on tags; Read the Docs report-only build.
- ✅ Two tagged releases show as two versions on Read the Docs with working asset paths.

**Later**
- Connect Hosted Weblate (flat JSON component; confirm libre-plan eligibility first).
- Sawa Mono column (replaces the Kawkab placeholder).

## 13. Open decisions (ask, don't decide)

- Simpler letter joins: Amiri's stacked joins (e.g. لمين, نجا) live in the required `rlig` feature and can't be turned off by feature settings. Decide whether Sawa edits those rules.
- Kawkab Mono licence.
- Whether older Amiri releases declared a Reserved Font Name (1.003 does not).
- Trademark check on "Sawa" (UK IPO, WIPO) before public release.
