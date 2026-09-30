import { fontStack } from "./css";
import { HARAKAT_TWINS, harakatTwin, type HarakatId } from "./roster";
import { COLOUR_PALETTES, CPAL_PALETTES, type Scheme } from "../marks/palettes";
import type { FamilyInfo, FontsData } from "./types";
import { SPECIMEN_FAMILIES, type PlaygroundState, type SpecimenFamily } from "../state/url";

export interface WeightAxis {
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

export interface NamedWeight {
  readonly name: string;
  readonly wght: number;
}

export interface LineMetrics {
  readonly unitsPerEm: number;
  readonly ascender: number;
  /** Negative, as stored in the font. */
  readonly descender: number;
  readonly lineGap: number;
}

/** What the Specimen page needs to know about one Sawa family, read from fonts.json. */
export interface SpecimenFamilyInfo {
  readonly id: SpecimenFamily;
  readonly name: string;
  readonly stack: string;
  readonly axis: WeightAxis;
  readonly instances: readonly NamedWeight[];
  readonly metrics: LineMetrics;
  readonly hasPalettes: boolean;
}

export const PALETTE_NAMES = ["mono", "gray", "groups"] as const;

/**
 * The vertical metrics a browser sizes `line-height: normal` from: typo when
 * USE_TYPO_METRICS is set, otherwise hhea.
 */
export function lineMetrics(info: FamilyInfo): LineMetrics {
  const source = info.typo.useTypoMetrics ? info.typo : info.hhea;
  return {
    unitsPerEm: info.unitsPerEm,
    ascender: source.ascender,
    descender: source.descender,
    lineGap: source.lineGap,
  };
}

/** Line box height in em: (ascender - descender + lineGap) / UPM. */
export function lineBoxEm(metrics: LineMetrics): number {
  return (metrics.ascender - metrics.descender + metrics.lineGap) / metrics.unitsPerEm;
}

/** Rounds to a whole weight (the slider's step) inside the axis range. */
export function clampWeight(weight: number, axis: WeightAxis): number {
  return Math.min(axis.max, Math.max(axis.min, Math.round(weight)));
}

/** The weight actually rendered for a stored URL weight; undefined means the axis default. */
export function effectiveWeight(weight: number | undefined, axis: WeightAxis): number {
  return weight === undefined ? axis.default : clampWeight(weight, axis);
}

/** The canonical value to store: clamped, and undefined when it equals the axis default. */
export function storedWeight(weight: number | undefined, axis: WeightAxis): number | undefined {
  const value = effectiveWeight(weight, axis);
  return value === axis.default ? undefined : value;
}

export function familyInfo(data: FontsData, id: SpecimenFamily): SpecimenFamilyInfo {
  const entry = data.fonts[id];
  const primary = entry?.stack[0];
  const info = primary === undefined ? undefined : entry?.families[primary];
  if (!entry || !info) {
    throw new Error(`fonts.json: no family info for "${id}"`);
  }
  const axis = info.axes.find((candidate) => candidate.tag === "wght");
  if (!axis) {
    throw new Error(`fonts.json: "${id}" has no wght axis`);
  }
  return {
    id,
    name: entry.name,
    stack: fontStack(data, id),
    axis: { min: axis.min, default: axis.default, max: axis.max },
    instances: info.instances.flatMap((instance) => {
      const wght = instance.coords.wght;
      return wght === undefined ? [] : [{ name: instance.name, wght }];
    }),
    metrics: lineMetrics(info),
    hasPalettes: (info.cpal?.palettes ?? 0) > 0 || paletteTwin(data, id) !== undefined,
  };
}

export function specimenFamilies(data: FontsData): Record<SpecimenFamily, SpecimenFamilyInfo> {
  return {
    "sawa-serif": familyInfo(data, "sawa-serif"),
    "sawa-sans": familyInfo(data, "sawa-sans"),
    "sawa-mono": familyInfo(data, "sawa-mono"),
  };
}

/** Clamps the state's weight to its family's axis and drops it when it's the default. */
export function normalizeSelection(
  state: PlaygroundState,
  families: Record<SpecimenFamily, SpecimenFamilyInfo>,
): PlaygroundState {
  const weight = storedWeight(state.weight, families[state.family].axis);
  return weight === state.weight ? state : { ...state, weight };
}

function metricVars(metrics: LineMetrics): string[] {
  return [
    `--line-ascent: ${metrics.ascender / metrics.unitsPerEm};`,
    `--line-descent: ${-metrics.descender / metrics.unitsPerEm};`,
    `--line-gap: ${metrics.lineGap / metrics.unitsPerEm};`,
  ];
}

/**
 * Per-family custom properties for the Specimen page: the selected family's
 * stack, default weight and line metrics on `[data-landing][data-family]`, and each
 * family's stack on `[data-font]` for the family cards.
 */
export function specimenCss(
  families: Record<SpecimenFamily, SpecimenFamilyInfo>,
  status: { stack: string; metrics: LineMetrics },
): string {
  const rules: string[] = [];
  for (const id of SPECIMEN_FAMILIES) {
    const family = families[id];
    rules.push(
      [
        `[data-landing][data-family="${id}"] {`,
        `  --specimen-font: ${family.stack};`,
        `  --wght-default: ${family.axis.default};`,
        ...metricVars(family.metrics).map((line) => `  ${line}`),
        "}",
      ].join("\n"),
      `[data-font="${id}"] {\n  font-family: ${family.stack};\n}`,
    );
  }
  rules.push(
    [
      ".status-stack {",
      `  font-family: ${status.stack};`,
      ...metricVars(status.metrics).map((line) => `  ${line}`),
      "}",
    ].join("\n"),
  );
  return rules.join("\n\n");
}

function paletteCount(data: FontsData, id: string): number {
  const entry = data.fonts[id];
  const primary = entry?.stack[0];
  const info = primary === undefined ? undefined : entry?.families[primary];
  return info?.cpal?.palettes ?? 0;
}

/**
 * The Harakat twin whose palettes the gray and groups palettes show `id`
 * in, or undefined when `id` has none in fonts.json.
 */
export function paletteTwin(data: FontsData, id: string): HarakatId | undefined {
  const twin = harakatTwin(id);
  return twin !== undefined && paletteCount(data, twin) > 0 ? twin : undefined;
}

function block(selector: string, declaration: string): string {
  return `${selector} {\n  ${declaration}\n}`;
}

/** Each colour palette's `font-palette` for `scheme`, under `prefix`. */
function choose(prefix: string, scheme: Scheme): string[] {
  return COLOUR_PALETTES.map((palette) =>
    block(`${prefix}[data-pal="${palette}"]`, `font-palette: --sawa-${palette}-${scheme};`),
  );
}

/**
 * The palette CSS: one @font-palette-values rule per CPAL palette of the
 * Harakat builds, `font-palette` for each [data-pal] under the theme in
 * force, and each [data-harakat] family swapped for its twin under gray
 * and groups. Chrome keeps `font-palette: normal` on palette 0 in dark mode
 * whatever its CPAL type, so a dark theme names the dark palette itself.
 */
export function paletteCss(data: FontsData): string {
  const twins = Object.entries(HARAKAT_TWINS).filter(([id]) => paletteTwin(data, id));
  if (twins.length === 0) {
    return "";
  }
  const rules = CPAL_PALETTES.flatMap(({ palette, scheme, index }) => {
    const families = twins
      .filter(([, twin]) => paletteCount(data, twin) > index)
      .map(([, twin]) => `"${data.fonts[twin]?.stack[0] ?? twin}"`);
    if (families.length === 0) {
      return [];
    }
    return [
      [
        `@font-palette-values --sawa-${palette}-${scheme} {`,
        `  font-family: ${families.join(", ")};`,
        `  base-palette: ${index};`,
        "}",
      ].join("\n"),
    ];
  });
  rules.push(
    ...choose("", "light"),
    `@media (prefers-color-scheme: dark) {\n${choose("", "dark").join("\n")}\n}`,
    ...choose('[data-bg="light"] ', "light"),
    ...choose('[data-bg="dark"] ', "dark"),
  );
  const coloured = COLOUR_PALETTES.map((palette) => `[data-pal="${palette}"]`).join(", ");
  for (const [id, twin] of twins) {
    rules.push(
      block(`[data-harakat="${id}"]:is(${coloured})`, `font-family: ${fontStack(data, twin)};`),
    );
  }
  return rules.join("\n\n");
}
