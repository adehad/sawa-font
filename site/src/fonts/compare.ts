import { fontStack } from "./css";
import { lineMetrics, paletteTwin, type LineMetrics, type WeightAxis } from "./specimen";
import type { FamilyInfo, FontsData } from "./types";
import type { FontId } from "./roster";

/** The Compare weight slider's range: the wght axis every Sawa family shares. */
export const COMPARE_WEIGHT: WeightAxis = { min: 400, default: 400, max: 700 };

/** A font's vertical metrics plus the guide heights the metrics overlay draws. */
export interface GuideMetrics extends LineMetrics {
  readonly xHeight: number | null;
  readonly capHeight: number | null;
}

/** What the Compare page needs to know about one roster font, read from fonts.json. */
export interface CompareFont {
  readonly id: FontId;
  readonly stack: string;
  /** The primary family's wght axis, or null for a font shipped as static faces. */
  readonly axis: WeightAxis | null;
  /** Every static face weight across the font's families, ascending. */
  readonly staticWeights: readonly number[];
  /** The primary family's metrics: the one CSS sizes the line box from. */
  readonly metrics: GuideMetrics;
  /** GSUB and GPOS feature tags across all of the font's families, sorted. */
  readonly features: readonly string[];
  readonly hasPalettes: boolean;
  /** The Harakat twin's stack, which the gray and groups palettes show; null without one. */
  readonly twinStack: string | null;
}

export function guideMetrics(info: FamilyInfo): GuideMetrics {
  return {
    ...lineMetrics(info),
    // fonts.json reports 0 for an OS/2 table that doesn't set the field.
    xHeight: info.xHeight || null,
    capHeight: info.capHeight || null,
  };
}

export function compareFont(data: FontsData, id: FontId): CompareFont {
  const entry = data.fonts[id];
  const primaryName = entry?.stack[0];
  const primary = primaryName === undefined ? undefined : entry?.families[primaryName];
  if (!entry || !primary) {
    throw new Error(`fonts.json: no family info for "${id}"`);
  }
  const families = Object.values(entry.families);
  const twin = paletteTwin(data, id);
  const axis = primary.axes.find((candidate) => candidate.tag === "wght");
  const staticWeights = [
    ...new Set(
      entry.faces.flatMap((face) => (typeof face.weight === "number" ? [face.weight] : [])),
    ),
  ].toSorted((a, b) => a - b);
  return {
    id,
    stack: fontStack(data, id),
    axis: axis ? { min: axis.min, default: axis.default, max: axis.max } : null,
    staticWeights,
    metrics: guideMetrics(primary),
    features: [...new Set(families.flatMap((family) => family.features))].toSorted(),
    hasPalettes:
      twin !== undefined ||
      families.some((family) => family.cpal !== null && family.cpal.palettes > 0),
    twinStack: twin === undefined ? null : fontStack(data, twin),
  };
}

/**
 * The static weight CSS font matching picks for `target` (CSS Fonts 4
 * §5.2): from 400 to 500 it tries heavier up to 500, then lighter, then
 * heavier; below 400 lighter first; above 500 heavier first.
 */
export function matchStaticWeight(target: number, weights: readonly number[]): number {
  const sorted = weights.toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return target;
  }
  if (sorted.includes(target)) {
    return target;
  }
  const lighter = sorted.filter((weight) => weight < target).toReversed();
  const heavier = sorted.filter((weight) => weight > target);
  let order: number[];
  if (target >= 400 && target <= 500) {
    const upTo500 = heavier.filter((weight) => weight <= 500);
    const beyond = heavier.filter((weight) => weight > 500);
    order = [...upTo500, ...lighter, ...beyond];
  } else if (target < 400) {
    order = [...lighter, ...heavier];
  } else {
    order = [...heavier, ...lighter];
  }
  return order[0] ?? target;
}

export interface RenderedWeight {
  readonly weight: number;
  /** True when the font has no wght axis and a static face stands in. */
  readonly nearest: boolean;
}

/** The weight a pane renders for the shared slider value; undefined means each font's own default. */
export function renderedWeight(
  target: number | undefined,
  font: Pick<CompareFont, "axis" | "staticWeights">,
): RenderedWeight {
  if (font.axis) {
    const value = target ?? font.axis.default;
    return {
      weight: Math.min(font.axis.max, Math.max(font.axis.min, Math.round(value))),
      nearest: false,
    };
  }
  const value = target ?? COMPARE_WEIGHT.default;
  const weight = matchStaticWeight(value, font.staticWeights);
  return { weight, nearest: weight !== value };
}

/** Waterfall sizes: the common steps below `size`, then `size` itself. */
export function waterfallSizes(size: number): number[] {
  const steps = [12, 16, 20, 24, 32, 48, 72, 96, 120];
  return [...steps.filter((step) => step < size), size];
}

/** Guide positions in px from a line's baseline, positive downwards. */
export interface GuideOffsets {
  readonly lineTop: number;
  readonly lineHeight: number;
  readonly ascender: number;
  readonly capHeight: number | null;
  readonly xHeight: number | null;
  readonly descender: number;
}

/**
 * Where each guide sits relative to the baseline for a font at `fontSize`.
 * Chrome rounds ascent, descent and line gap to whole pixels before building
 * a line box, so the line box edges here do too. A numeric line height
 * splits its leading evenly above and below the content area.
 */
export function guideOffsets(
  metrics: GuideMetrics,
  fontSize: number,
  lineHeight: "normal" | number,
): GuideOffsets {
  const scale = fontSize / metrics.unitsPerEm;
  const ascent = Math.round(metrics.ascender * scale);
  const descent = Math.round(-metrics.descender * scale);
  const gap = Math.round(metrics.lineGap * scale);
  const height = lineHeight === "normal" ? ascent + descent + gap : lineHeight * fontSize;
  const above =
    lineHeight === "normal" ? ascent + gap / 2 : ascent + (height - ascent - descent) / 2;
  return {
    lineTop: -above,
    lineHeight: height,
    ascender: -ascent,
    capHeight: metrics.capHeight === null ? null : -metrics.capHeight * scale,
    xHeight: metrics.xHeight === null ? null : -metrics.xHeight * scale,
    descender: descent,
  };
}
