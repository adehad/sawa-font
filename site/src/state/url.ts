import { FONT_ROSTER, type FontId } from "../fonts/roster";

export type Preset = "mixed" | "quran" | "stress" | "custom";
export type Palette = "mono" | "gray" | "groups";
export type Background = "light" | "dark";
export type ViewMode = "stacked" | "side";
export type FontOrLocal = FontId | "local";
export type OverrideKey = "font" | "pal";
export type SpecimenFamily = "sawa-serif" | "sawa-sans" | "sawa-mono";

export interface PaneOverride {
  readonly pane: number;
  readonly font?: FontOrLocal;
  readonly pal?: Palette;
}

export interface PlaygroundState {
  readonly text: string;
  readonly preset: Preset;
  readonly family: SpecimenFamily;
  /** The Specimen's wght; undefined means the family's own default. The page clamps it to the axis. */
  readonly weight: number | undefined;
  readonly size: number;
  readonly waterfall: boolean;
  readonly lineHeight: "default" | number;
  readonly palette: Palette;
  readonly background: Background | undefined;
  readonly features: readonly string[];
  readonly metrics: boolean;
  readonly view: ViewMode;
  readonly fonts: readonly FontOrLocal[];
  readonly overrides: readonly PaneOverride[];
}

const PRESETS = ["mixed", "quran", "stress", "custom"] as const;
const PALETTES = ["mono", "gray", "groups"] as const;
const BACKGROUNDS = ["light", "dark"] as const;
export const SPECIMEN_FAMILIES = ["sawa-serif", "sawa-sans", "sawa-mono"] as const;

export const MIN_SIZE = 12;
export const MAX_SIZE = 144;
const DEFAULT_SIZE = 32;
const DEFAULT_FAMILY: SpecimenFamily = "sawa-serif";
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 1000;
const MIN_LINE_HEIGHT = 0.8;
const MAX_LINE_HEIGHT = 3;
const DEFAULT_FONTS: readonly FontOrLocal[] = ["sawa-serif", "sawa-sans", "status"];

const VALID_FONT_IDS = new Set<string>([...FONT_ROSTER, "local"]);

export function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

export function isPalette(value: string): value is Palette {
  return (PALETTES as readonly string[]).includes(value);
}

export function isBackground(value: string): value is Background {
  return (BACKGROUNDS as readonly string[]).includes(value);
}

function isSpecimenFamily(value: string): value is SpecimenFamily {
  return (SPECIMEN_FAMILIES as readonly string[]).includes(value);
}

export function isFontOrLocal(value: string): value is FontOrLocal {
  return VALID_FONT_IDS.has(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A font size in px, rounded to a whole pixel inside the schema's 12-144 range. */
export function clampSize(size: number): number {
  return clamp(Math.round(size), MIN_SIZE, MAX_SIZE);
}

function roundTo2(value: number): number {
  return Number(value.toFixed(2));
}

function trimmed(value: string | null): string | null {
  return value === null ? null : value.trim();
}

/** The state a fresh playground load starts from, with no query string at all. */
export function defaultState(): PlaygroundState {
  return {
    text: "",
    preset: "mixed",
    family: DEFAULT_FAMILY,
    weight: undefined,
    size: DEFAULT_SIZE,
    waterfall: false,
    lineHeight: "default",
    palette: "groups",
    background: undefined,
    features: [],
    metrics: false,
    view: "stacked",
    fonts: [...DEFAULT_FONTS],
    overrides: [],
  };
}

function parseSize(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_SIZE;
  }
  const value = raw.trim();
  if (!/^-?\d+$/.test(value)) {
    return DEFAULT_SIZE;
  }
  return clampSize(Number(value));
}

function parseWeight(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^-?\d+$/.test(value)) {
    return undefined;
  }
  return clamp(Number(value), MIN_WEIGHT, MAX_WEIGHT);
}

function parseLineHeight(raw: string | null): "default" | number {
  if (raw === null) {
    return "default";
  }
  const value = raw.trim();
  if (value === "default") {
    return "default";
  }
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return "default";
  }
  return roundTo2(clamp(Number(value), MIN_LINE_HEIGHT, MAX_LINE_HEIGHT));
}

function formatLineHeight(value: number): string {
  return roundTo2(value).toString();
}

function parseFeatures(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw.split(",")) {
    const tag = token.trim();
    if (/^[A-Za-z0-9]{4}$/.test(tag) && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function normalizeFontsArray(tokens: readonly string[]): FontOrLocal[] {
  const seen = new Set<string>();
  const result: FontOrLocal[] = [];
  for (const raw of tokens) {
    const id = raw.trim();
    if (isFontOrLocal(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result.length > 0 ? result : [...DEFAULT_FONTS];
}

function parseFonts(raw: string | null): FontOrLocal[] {
  if (raw === null) {
    return [...DEFAULT_FONTS];
  }
  return normalizeFontsArray(raw.split(","));
}

interface RawOverride {
  pane: number;
  font?: FontOrLocal;
  pal?: Palette;
}

function parseOverridesRaw(raw: string | null): RawOverride[] {
  if (raw === null) {
    return [];
  }
  const byPane = new Map<number, RawOverride>();
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    const colonIndex = entry.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const paneStr = entry.slice(0, colonIndex).trim();
    if (!/^[1-9]\d*$/.test(paneStr)) {
      continue;
    }
    const pane = Number(paneStr);
    if (byPane.has(pane)) {
      continue;
    }
    const override: RawOverride = { pane };
    for (const rawPair of entry.slice(colonIndex + 1).split(";")) {
      const pair = rawPair.trim();
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      const key = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (key === "font" && isFontOrLocal(value)) {
        override.font = value;
      } else if (key === "pal" && isPalette(value)) {
        override.pal = value;
      }
    }
    if (override.font !== undefined || override.pal !== undefined) {
      byPane.set(pane, override);
    }
  }
  return [...byPane.values()];
}

function normalizeOverrides(
  raw: readonly RawOverride[],
  fonts: readonly FontOrLocal[],
  palette: Palette,
): PaneOverride[] {
  const result: PaneOverride[] = [];
  for (const item of raw) {
    if (item.pane > fonts.length) {
      continue;
    }
    const override: RawOverride = { pane: item.pane };
    let hasKey = false;
    if (item.font !== undefined && item.font !== fonts[item.pane - 1]) {
      override.font = item.font;
      hasKey = true;
    }
    if (item.pal !== undefined && item.pal !== palette) {
      override.pal = item.pal;
      hasKey = true;
    }
    if (hasKey) {
      result.push(override);
    }
  }
  return result.toSorted((a, b) => a.pane - b.pane);
}

function serializeOverrides(overrides: readonly PaneOverride[]): string {
  return overrides
    .toSorted((a, b) => a.pane - b.pane)
    .map((override) => {
      const parts: string[] = [];
      if (override.font !== undefined) {
        parts.push(`font=${override.font}`);
      }
      if (override.pal !== undefined) {
        parts.push(`pal=${override.pal}`);
      }
      return `${override.pane}:${parts.join(";")}`;
    })
    .join(",");
}

function toParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

/** Reads a playground state from a query string, applying every default and normalisation rule. */
export function parseState(search: string | URLSearchParams): PlaygroundState {
  const params = toParams(search);

  const presetRaw = trimmed(params.get("preset"));
  const hasText = params.has("text");
  let preset: Preset;
  if (presetRaw === null) {
    preset = hasText ? "custom" : "mixed";
  } else {
    preset = isPreset(presetRaw) ? presetRaw : "mixed";
  }
  // A lone surrogate can reach here from a mid-composition keystroke passed in
  // via a URLSearchParams built by the caller rather than parsed from a string.
  const text = preset === "custom" ? (params.get("text") ?? "").toWellFormed() : "";

  const famRaw = trimmed(params.get("fam"));
  const family = famRaw !== null && isSpecimenFamily(famRaw) ? famRaw : DEFAULT_FAMILY;
  const weight = parseWeight(params.get("wght"));
  const size = parseSize(params.get("size"));
  const waterfall = trimmed(params.get("wf")) === "1";
  const lineHeight = parseLineHeight(params.get("lh"));
  const palRaw = trimmed(params.get("pal"));
  const palette = palRaw !== null && isPalette(palRaw) ? palRaw : "groups";
  const bgRaw = trimmed(params.get("bg"));
  const background = bgRaw !== null && isBackground(bgRaw) ? bgRaw : undefined;
  const features = parseFeatures(params.get("feat"));
  const metrics = trimmed(params.get("metrics")) === "1";
  const view = trimmed(params.get("view")) === "side" ? "side" : "stacked";
  const fonts = parseFonts(params.get("fonts"));
  const overrides = normalizeOverrides(parseOverridesRaw(params.get("ov")), fonts, palette);

  return {
    text,
    preset,
    family,
    weight,
    size,
    waterfall,
    lineHeight,
    palette,
    background,
    features,
    metrics,
    view,
    fonts,
    overrides,
  };
}

function isDefaultFonts(fonts: readonly FontOrLocal[]): boolean {
  return fonts.length === DEFAULT_FONTS.length && fonts.every((id, i) => id === DEFAULT_FONTS[i]);
}

/**
 * Re-applies every parse-time constraint to a state built by hand (not read
 * from a query string), so `toSearch` always emits the canonical query for
 * the state it's given.
 */
function normalizeState(state: PlaygroundState): PlaygroundState {
  const size = clampSize(state.size);
  const family = isSpecimenFamily(state.family) ? state.family : DEFAULT_FAMILY;
  const weight =
    state.weight === undefined || !Number.isFinite(state.weight)
      ? undefined
      : clamp(Math.round(state.weight), MIN_WEIGHT, MAX_WEIGHT);
  const lineHeight =
    state.lineHeight === "default"
      ? "default"
      : roundTo2(clamp(state.lineHeight, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT));
  const fonts = normalizeFontsArray(state.fonts);
  const text = state.preset === "custom" ? state.text.toWellFormed() : "";
  const rawOverrides: RawOverride[] = state.overrides.map((override) => ({
    pane: override.pane,
    font: override.font,
    pal: override.pal,
  }));
  const overrides = normalizeOverrides(rawOverrides, fonts, state.palette);

  return { ...state, text, family, weight, size, lineHeight, fonts, overrides };
}

const READABLE_KEYS = new Set(["fonts", "feat", "ov"]);

function encodeValue(value: string): string {
  return encodeURIComponent(value.toWellFormed());
}

/** Keeps `,` `:` `;` `=` readable in `fonts`/`feat`/`ov` values instead of percent-encoded. */
function encodeReadable(value: string): string {
  return encodeValue(value)
    .replace(/%2C/g, ",")
    .replace(/%3A/g, ":")
    .replace(/%3B/g, ";")
    .replace(/%3D/g, "=");
}

/**
 * Serialises a playground state to a query string in the schema's canonical param order,
 * omitting every value that equals its default. Returns "" for the default state, otherwise
 * a string starting with "?".
 */
export function toSearch(rawState: PlaygroundState): string {
  const state = normalizeState(rawState);
  const pairs: [string, string][] = [];

  if (state.text !== "") {
    pairs.push(["text", state.text]);
  }
  if (state.preset !== "mixed") {
    pairs.push(["preset", state.preset]);
  }
  if (state.family !== DEFAULT_FAMILY) {
    pairs.push(["fam", state.family]);
  }
  if (state.weight !== undefined) {
    pairs.push(["wght", String(state.weight)]);
  }
  if (state.size !== DEFAULT_SIZE) {
    pairs.push(["size", String(state.size)]);
  }
  if (state.waterfall) {
    pairs.push(["wf", "1"]);
  }
  if (state.lineHeight !== "default") {
    pairs.push(["lh", formatLineHeight(state.lineHeight)]);
  }
  if (state.palette !== "groups") {
    pairs.push(["pal", state.palette]);
  }
  if (state.background !== undefined) {
    pairs.push(["bg", state.background]);
  }
  if (state.features.length > 0) {
    pairs.push(["feat", state.features.join(",")]);
  }
  if (state.metrics) {
    pairs.push(["metrics", "1"]);
  }
  if (state.view !== "stacked") {
    pairs.push(["view", state.view]);
  }
  if (!isDefaultFonts(state.fonts)) {
    pairs.push(["fonts", state.fonts.join(",")]);
  }
  if (state.overrides.length > 0) {
    pairs.push(["ov", serializeOverrides(state.overrides)]);
  }

  if (pairs.length === 0) {
    return "";
  }
  return `?${pairs
    .map(([key, value]) => {
      const encoded = READABLE_KEYS.has(key) ? encodeReadable(value) : encodeValue(value);
      return `${key}=${encoded}`;
    })
    .join("&")}`;
}

/** The fonts list capped at 4 entries, the maximum the side-by-side view shows. */
export function sideColumns(state: PlaygroundState): readonly FontOrLocal[] {
  return state.fonts.slice(0, 4);
}

/** Resolves `key` for a 1-based `pane`: its override if set, otherwise the shared value. */
export function paneValue(
  state: PlaygroundState,
  pane: number,
  key: "font",
): FontOrLocal | undefined;
export function paneValue(state: PlaygroundState, pane: number, key: "pal"): Palette;
export function paneValue(
  state: PlaygroundState,
  pane: number,
  key: OverrideKey,
): FontOrLocal | Palette | undefined;
export function paneValue(
  state: PlaygroundState,
  pane: number,
  key: OverrideKey,
): FontOrLocal | Palette | undefined {
  const override = state.overrides.find((entry) => entry.pane === pane);
  if (key === "font") {
    return override?.font ?? state.fonts[pane - 1];
  }
  return override?.pal ?? state.palette;
}

/**
 * Replaces the fonts list and remaps `overrides` so each one still targets the
 * font it was set for: to that font's new position if it moved, dropped if it
 * left the list. Panes are positional, not tied to a font, so a reorder alone
 * would otherwise silently reassign an override to a different font.
 */
export function setFonts(state: PlaygroundState, fonts: readonly string[]): PlaygroundState {
  const nextFonts = normalizeFontsArray(fonts);
  const remapped: RawOverride[] = [];
  for (const override of state.overrides) {
    const oldFontId = state.fonts[override.pane - 1];
    if (oldFontId === undefined) {
      continue;
    }
    const newIndex = nextFonts.indexOf(oldFontId);
    if (newIndex === -1) {
      continue;
    }
    remapped.push({ pane: newIndex + 1, font: override.font, pal: override.pal });
  }
  return {
    ...state,
    fonts: nextFonts,
    overrides: normalizeOverrides(remapped, nextFonts, state.palette),
  };
}

/** Adds `id` to the end of the fonts list, or removes it if it's already there. */
export function toggleFont(state: PlaygroundState, id: FontOrLocal): PlaygroundState {
  const next = state.fonts.includes(id)
    ? state.fonts.filter((font) => font !== id)
    : [...state.fonts, id];
  return next.length === 0 ? state : setFonts(state, next);
}

/** Moves the font at 0-based `index` by `delta` places; out-of-range moves are no-ops. */
export function moveFont(state: PlaygroundState, index: number, delta: number): PlaygroundState {
  const target = index + delta;
  if (index < 0 || index >= state.fonts.length || target < 0 || target >= state.fonts.length) {
    return state;
  }
  const next = [...state.fonts];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) {
    return state;
  }
  next.splice(target, 0, moved);
  return setFonts(state, next);
}

/**
 * Sets one key of a 1-based pane's override. A value equal to the pane's
 * shared value clears that key, and an override left with no keys is dropped.
 */
export function setOverride(
  state: PlaygroundState,
  pane: number,
  key: "font",
  value: FontOrLocal,
): PlaygroundState;
export function setOverride(
  state: PlaygroundState,
  pane: number,
  key: "pal",
  value: Palette,
): PlaygroundState;
export function setOverride(
  state: PlaygroundState,
  pane: number,
  key: OverrideKey,
  value: FontOrLocal | Palette,
): PlaygroundState {
  const raw: RawOverride[] = state.overrides.map((override) => ({ ...override }));
  let entry = raw.find((override) => override.pane === pane);
  if (!entry) {
    entry = { pane };
    raw.push(entry);
  }
  if (key === "font" && isFontOrLocal(value)) {
    entry.font = value;
  } else if (key === "pal" && isPalette(value)) {
    entry.pal = value;
  }
  return { ...state, overrides: normalizeOverrides(raw, state.fonts, state.palette) };
}

/** Adds `tag` to the feature list, or removes it if it's already there. */
export function toggleFeature(state: PlaygroundState, tag: string): PlaygroundState {
  const features = state.features.includes(tag)
    ? state.features.filter((feature) => feature !== tag)
    : parseFeatures([...state.features, tag].join(","));
  return { ...state, features };
}

/** One pane on screen: its 1-based position and the font and palette it resolves to. */
export interface VisiblePane {
  readonly pane: number;
  readonly font: FontOrLocal;
  readonly palette: Palette;
}

/**
 * The panes the current view shows, each with its palette override applied.
 * Side by side caps the list with `sideColumns` and applies font overrides
 * too; stacked shows every font as listed.
 */
export function visiblePanes(state: PlaygroundState): VisiblePane[] {
  const fonts = state.view === "side" ? sideColumns(state) : state.fonts;
  return fonts.map((font, index) => ({
    pane: index + 1,
    font: state.view === "side" ? (paneValue(state, index + 1, "font") ?? font) : font,
    palette: paneValue(state, index + 1, "pal"),
  }));
}

export const REPORT_MODES = ["onion", "swipe", "side"] as const;
export type ReportMode = (typeof REPORT_MODES)[number];
/** The viewer's toggles: the Sawa layer, its upstream counterpart, guides and diff regions. */
export const REPORT_LAYERS = ["sawa", "upstream", "guides", "diff"] as const;
export type ReportLayer = (typeof REPORT_LAYERS)[number];
export const REPORT_ZOOMS = ["fit", "100", "200"] as const;
export type ReportZoom = (typeof REPORT_ZOOMS)[number];

/** The report page's state, in its own `r`-prefixed params so it never collides with the playground's. */
export interface ReportState {
  /** A test id; undefined means the bundle's first test. The page drops ids the bundle lacks. */
  readonly test: string | undefined;
  readonly family: SpecimenFamily;
  readonly mode: ReportMode;
  /** The upstream layer's opacity in onion mode, 0-100. */
  readonly opacity: number;
  /** The swipe divider's position from the left edge, 0-100. */
  readonly swipe: number;
  /** The toggles that are on, in REPORT_LAYERS order. */
  readonly layers: readonly ReportLayer[];
  readonly zoom: ReportZoom;
}

const DEFAULT_REPORT_PERCENT = 50;
const DEFAULT_REPORT_LAYERS: readonly ReportLayer[] = ["sawa", "upstream", "diff"];
const NO_LAYERS = "none";
const REPORT_TEST_ID = /^[a-z0-9][a-z0-9-]*$/;

function isOneOf<T extends string>(options: readonly T[], value: string | null): value is T {
  return value !== null && (options as readonly string[]).includes(value);
}

export function defaultReportState(): ReportState {
  return {
    test: undefined,
    family: DEFAULT_FAMILY,
    mode: "onion",
    opacity: DEFAULT_REPORT_PERCENT,
    swipe: DEFAULT_REPORT_PERCENT,
    layers: [...DEFAULT_REPORT_LAYERS],
    zoom: "fit",
  };
}

function parsePercent(raw: string | null): number {
  const value = raw?.trim() ?? "";
  if (!/^-?\d+$/.test(value)) {
    return DEFAULT_REPORT_PERCENT;
  }
  return clamp(Number(value), 0, 100);
}

function orderedLayers(layers: Iterable<string>): ReportLayer[] {
  const wanted = new Set(layers);
  return REPORT_LAYERS.filter((layer) => wanted.has(layer));
}

function parseReportLayers(raw: string | null): ReportLayer[] {
  const value = raw?.trim();
  if (value === undefined) {
    return [...DEFAULT_REPORT_LAYERS];
  }
  if (value === NO_LAYERS) {
    return [];
  }
  const layers = orderedLayers(value.split(",").map((token) => token.trim()));
  return layers.length > 0 ? layers : [...DEFAULT_REPORT_LAYERS];
}

/** Reads the report state from a query string; invalid values fall back to their defaults. */
export function parseReportState(search: string | URLSearchParams): ReportState {
  const params = toParams(search);
  const test = trimmed(params.get("rt"));
  const family = trimmed(params.get("rf"));
  const mode = trimmed(params.get("rm"));
  const zoom = trimmed(params.get("rz"));
  return {
    test: test !== null && REPORT_TEST_ID.test(test) ? test : undefined,
    family: family !== null && isSpecimenFamily(family) ? family : DEFAULT_FAMILY,
    mode: isOneOf(REPORT_MODES, mode) ? mode : "onion",
    opacity: parsePercent(params.get("ro")),
    swipe: parsePercent(params.get("rs")),
    layers: parseReportLayers(params.get("rl")),
    zoom: isOneOf(REPORT_ZOOMS, zoom) ? zoom : "fit",
  };
}

function normalizePercent(value: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : DEFAULT_REPORT_PERCENT;
}

/**
 * Serialises the report state in the fixed order rt, rf, rm, ro, rs, rl, rz,
 * omitting defaults. `rl=none` means every toggle is off, since an empty
 * value would read back as the default.
 */
export function toReportSearch(state: ReportState): string {
  const defaults = defaultReportState();
  const pairs: [string, string][] = [];
  if (state.test !== undefined && REPORT_TEST_ID.test(state.test)) {
    pairs.push(["rt", state.test]);
  }
  if (state.family !== defaults.family && isSpecimenFamily(state.family)) {
    pairs.push(["rf", state.family]);
  }
  if (state.mode !== defaults.mode && isOneOf(REPORT_MODES, state.mode)) {
    pairs.push(["rm", state.mode]);
  }
  const opacity = normalizePercent(state.opacity);
  if (opacity !== defaults.opacity) {
    pairs.push(["ro", String(opacity)]);
  }
  const swipe = normalizePercent(state.swipe);
  if (swipe !== defaults.swipe) {
    pairs.push(["rs", String(swipe)]);
  }
  const layers = orderedLayers(state.layers);
  if (layers.join(",") !== defaults.layers.join(",")) {
    pairs.push(["rl", layers.length > 0 ? layers.join(",") : NO_LAYERS]);
  }
  if (state.zoom !== defaults.zoom && isOneOf(REPORT_ZOOMS, state.zoom)) {
    pairs.push(["rz", state.zoom]);
  }
  if (pairs.length === 0) {
    return "";
  }
  return `?${pairs.map(([key, value]) => `${key}=${encodeReadable(value)}`).join("&")}`;
}

/** Turns one viewer toggle on or off. */
export function toggleReportLayer(state: ReportState, layer: ReportLayer): ReportState {
  const layers = state.layers.includes(layer)
    ? state.layers.filter((entry) => entry !== layer)
    : orderedLayers([...state.layers, layer]);
  return { ...state, layers };
}
