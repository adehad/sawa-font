/**
 * Features the shaper applies for correct text; font-feature-settings can't
 * be relied on to turn them off, so the panel shows them read-only.
 */
export const REQUIRED_FEATURES: ReadonlySet<string> = new Set([
  "abvm",
  "blwm",
  "ccmp",
  "curs",
  "dist",
  "fin2",
  "fin3",
  "fina",
  "init",
  "isol",
  "locl",
  "ltra",
  "ltrm",
  "mark",
  "med2",
  "medi",
  "mkmk",
  "rclt",
  "rlig",
  "rtla",
  "rtlm",
  "rvrn",
  "stch",
]);

/** Optional features browsers turn on by default for horizontal text. */
const DEFAULT_ON: ReadonlySet<string> = new Set(["calt", "clig", "kern", "liga"]);

export type FeatureGroupId = "ss" | "cv" | "liga" | "num" | "other";

export const FEATURE_GROUPS: readonly FeatureGroupId[] = ["ss", "cv", "liga", "num", "other"];

const LIGATURES = new Set(["liga", "clig", "dlig", "hlig", "rlig"]);
const NUMERALS = new Set(["lnum", "onum", "tnum", "pnum"]);

export function featureGroup(tag: string): FeatureGroupId | "required" {
  if (/^ss\d\d$/.test(tag)) {
    return "ss";
  }
  if (/^cv\d\d$/.test(tag)) {
    return "cv";
  }
  if (LIGATURES.has(tag)) {
    return "liga";
  }
  if (NUMERALS.has(tag)) {
    return "num";
  }
  return REQUIRED_FEATURES.has(tag) ? "required" : "other";
}

export interface GroupedFeatures {
  readonly groups: Record<FeatureGroupId, string[]>;
  /** Required features outside the ligature group, which lists rlig itself. */
  readonly required: string[];
}

/** Sorts de-duplicated tags into the panel's groups, each sorted. */
export function groupFeatures(tags: Iterable<string>): GroupedFeatures {
  const groups: Record<FeatureGroupId, string[]> = { ss: [], cv: [], liga: [], num: [], other: [] };
  const required: string[] = [];
  for (const tag of [...new Set(tags)].toSorted()) {
    const group = featureGroup(tag);
    if (group === "required") {
      required.push(tag);
    } else {
      groups[group].push(tag);
    }
  }
  return { groups, required };
}

/**
 * Whether a feature is on. `feat` holds the features toggled away from their
 * default, so listing an off-by-default feature turns it on and listing liga,
 * clig, calt or kern turns it off.
 */
export function isFeatureOn(tag: string, feat: readonly string[]): boolean {
  if (REQUIRED_FEATURES.has(tag)) {
    return true;
  }
  return DEFAULT_ON.has(tag) ? !feat.includes(tag) : feat.includes(tag);
}

/** The font-feature-settings value for `feat`, or "normal" when nothing is toggled. */
export function featureSettings(feat: readonly string[]): string {
  const settings = feat
    .filter((tag) => !REQUIRED_FEATURES.has(tag))
    .map((tag) => `"${tag}" ${isFeatureOn(tag, feat) ? 1 : 0}`);
  return settings.length > 0 ? settings.join(", ") : "normal";
}

/** The toggled features a font doesn't have. */
export function absentFeatures(feat: readonly string[], fontFeatures: readonly string[]): string[] {
  const own = new Set(fontFeatures);
  return feat.filter((tag) => !REQUIRED_FEATURES.has(tag) && !own.has(tag));
}
