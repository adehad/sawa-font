import { FONT_ROSTER, type FontId } from "../fonts/roster";

export type Preset = "mixed" | "quran" | "stress" | "custom";
export type Palette = "mono" | "gray" | "groups";
export type Background = "light" | "dark";
export type ViewMode = "stacked" | "side";
export type FontOrLocal = FontId | "local";
export type OverrideKey = "font" | "pal";

export interface PaneOverride {
  readonly pane: number;
  readonly font?: FontOrLocal;
  readonly pal?: Palette;
}

export interface PlaygroundState {
  readonly text: string;
  readonly preset: Preset;
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

const MIN_SIZE = 12;
const MAX_SIZE = 144;
const DEFAULT_SIZE = 32;
const MIN_LINE_HEIGHT = 0.8;
const MAX_LINE_HEIGHT = 3;
const DEFAULT_FONTS: readonly FontOrLocal[] = ["sawa-serif", "sawa-sans", "status"];

const VALID_FONT_IDS = new Set<string>([...FONT_ROSTER, "local"]);

function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

function isPalette(value: string): value is Palette {
  return (PALETTES as readonly string[]).includes(value);
}

function isBackground(value: string): value is Background {
  return (BACKGROUNDS as readonly string[]).includes(value);
}

function isFontOrLocal(value: string): value is FontOrLocal {
  return VALID_FONT_IDS.has(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  return clamp(Number(value), MIN_SIZE, MAX_SIZE);
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
  const size = clamp(Math.round(state.size), MIN_SIZE, MAX_SIZE);
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

  return { ...state, text, size, lineHeight, fonts, overrides };
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
