import type {
  CoverageCount,
  CoverageSet,
  ReportBundle,
  ReportFamily,
  Shaping,
  ShapingStatus,
} from "./types";

export const LATIN_CORE = "GF_Latin_Core";

function sum(counts: Iterable<CoverageCount>): CoverageCount {
  let supported = 0;
  let total = 0;
  for (const entry of counts) {
    supported += entry.supported;
    total += entry.total;
  }
  return { supported, total };
}

/** The share of `count` supported, 0-1; an empty set counts as fully covered. */
export function ratio(count: CoverageCount): number {
  return count.total === 0 ? 1 : count.supported / count.total;
}

export interface CoverageSummary {
  readonly latinCore: CoverageCount | undefined;
  /** Every Unicode block whose name starts with "Arabic", summed. */
  readonly arabicBlocks: CoverageCount;
  readonly markGroups: CoverageCount;
}

export function coverageSummary(set: CoverageSet): CoverageSummary {
  return {
    latinCore: set.glyphSets[LATIN_CORE],
    arabicBlocks: sum(
      Object.entries(set.blocks)
        .filter(([name]) => name.startsWith("Arabic"))
        .map(([, count]) => count),
    ),
    markGroups: sum(Object.values(set.markGroups)),
  };
}

export interface WeightStatus {
  readonly weight: string;
  readonly status: ShapingStatus;
}

/** One family's shaping results for one test, by weight, lightest first. */
export function testShaping(
  shaping: Shaping,
  family: ReportFamily,
  testId: string,
): WeightStatus[] {
  const weights = shaping.families[family]?.[testId] ?? {};
  return Object.entries(weights)
    .map(([key, result]) => ({ weight: key.replace(/^wght=/, ""), status: result.status }))
    .toSorted((a, b) => Number(a.weight) - Number(b.weight));
}

const SEVERITY: Record<ShapingStatus, number> = { pass: 0, missing: 1, fail: 2 };

/** A test's worst shaping result over every family and weight. */
export function worstStatus(shaping: Shaping, testId: string): ShapingStatus {
  let worst: ShapingStatus = "pass";
  for (const tests of Object.values(shaping.families)) {
    for (const result of Object.values(tests?.[testId] ?? {})) {
      if (SEVERITY[result.status] > SEVERITY[worst]) {
        worst = result.status;
      }
    }
  }
  return worst;
}

/** How many of the bundle's tests fail shaping in any family or weight. */
export function failedTests(bundle: ReportBundle): number {
  return bundle.tests.filter((test) => worstStatus(bundle.shaping, test.id) === "fail").length;
}

/** The family's display name from the manifest, falling back to its id. */
export function familyName(bundle: ReportBundle, family: ReportFamily): string {
  return bundle.manifest.fonts.find((font) => font.family === family)?.name ?? family;
}

/** The families the bundle has fonts for, in display order. */
export function bundleFamilies(bundle: ReportBundle): ReportFamily[] {
  return bundle.manifest.fonts.map((font) => font.family);
}
