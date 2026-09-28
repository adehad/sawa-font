import { fontStack } from "./css";
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
    hasPalettes: info.cpal !== null && info.cpal.palettes > 0,
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
 * stack, default weight and line metrics on `.landing[data-family]`, and each
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
        `.landing[data-family="${id}"] {`,
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

/**
 * One @font-palette-values rule per palette, named --sawa-<palette> and
 * covering every Sawa family whose CPAL table has it. CPAL order isn't fixed
 * yet; this assumes the palettes are stored in PALETTE_NAMES order.
 */
export function paletteCss(data: FontsData): string {
  const counts: [string, number][] = [];
  for (const id of SPECIMEN_FAMILIES) {
    for (const [family, info] of Object.entries(data.fonts[id]?.families ?? {})) {
      counts.push([family, info.cpal?.palettes ?? 0]);
    }
  }
  return PALETTE_NAMES.flatMap((palette, index) => {
    const families = counts.filter(([, count]) => count > index).map(([family]) => `"${family}"`);
    if (families.length === 0) {
      return [];
    }
    return [
      [
        `@font-palette-values --sawa-${palette} {`,
        `  font-family: ${families.join(", ")};`,
        `  base-palette: ${index};`,
        "}",
      ].join("\n"),
    ];
  }).join("\n\n");
}
