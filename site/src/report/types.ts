/** The three Sawa families a report bundle covers, in display order. */
export const REPORT_FAMILIES = ["sawa-serif", "sawa-sans", "sawa-mono"] as const;

export type ReportFamily = (typeof REPORT_FAMILIES)[number];

export type ShapingStatus = "pass" | "fail" | "missing";

export type DiffKind = "upstream" | "previous";

export interface ShapingCounts {
  readonly pass: number;
  readonly fail: number;
  readonly missing: number;
}

export interface ManifestFont {
  readonly family: ReportFamily;
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
  readonly upstream: {
    readonly id: string;
    readonly fonts: readonly { readonly name: string; readonly file: string }[];
  };
}

export interface FontbakeryFamily {
  readonly counts: Readonly<Record<string, number>>;
  readonly report: string;
}

export type FontbakerySummary =
  | { readonly ran: false }
  | {
      readonly ran: true;
      readonly profile: string;
      readonly excluded: readonly string[];
      readonly version: string | null;
      readonly report: string;
      readonly families: Readonly<Partial<Record<ReportFamily, FontbakeryFamily>>>;
    };

/** manifest.json */
export interface Manifest {
  readonly version: string;
  readonly gitSha: string | null;
  /** UTC, ISO 8601. */
  readonly date: string;
  readonly fonts: readonly ManifestFont[];
  readonly tests: readonly string[];
  readonly diffBaseline: { readonly kind: DiffKind; readonly version: string | null };
  readonly shaping: ShapingCounts;
  readonly fontbakery: FontbakerySummary;
}

export interface LineBox {
  readonly source: string;
  /** In em. */
  readonly ascender: number;
  /** In em, negative below the baseline. */
  readonly descender: number;
  readonly lineGap: number;
  readonly height: number;
  readonly winHeight: number;
}

export interface FamilyMetrics {
  readonly unitsPerEm: number;
  readonly lineBox: LineBox;
}

/** metrics.json */
export interface Metrics {
  readonly families: Readonly<Partial<Record<ReportFamily, FamilyMetrics>>>;
}

export interface CoverageCount {
  readonly supported: number;
  readonly total: number;
}

export interface CoverageSet {
  readonly blocks: Readonly<Record<string, CoverageCount>>;
  readonly markGroups: Readonly<Record<string, CoverageCount>>;
  readonly glyphSets: Readonly<Record<string, CoverageCount>>;
}

/** coverage.json */
export interface Coverage {
  readonly unicodeVersion: string;
  readonly families: Readonly<
    Partial<Record<ReportFamily, CoverageSet & { readonly upstream: CoverageSet }>>
  >;
}

export interface ShapingResult {
  readonly status: ShapingStatus;
}

/** shaping.json: family, then test id, then a weight key such as "wght=400". */
export interface Shaping {
  readonly summary: ShapingCounts;
  readonly families: Readonly<
    Partial<Record<ReportFamily, Readonly<Record<string, Readonly<Record<string, ShapingResult>>>>>>
  >;
}

/** One font line's y position in SVG units; negative is above the baseline. */
export interface Guides {
  readonly ascender: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly baseline: number;
  readonly descender: number;
  readonly lineBoxTop: number;
  readonly lineBoxBottom: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TestLayer {
  readonly id: string;
  readonly file: string;
  readonly name: string;
}

/** tests/<id>/test.json */
export interface TestInfo {
  readonly id: string;
  readonly purpose: { readonly en: string; readonly ar: string };
  readonly text: string;
  readonly codepoints: readonly string[];
  readonly features: readonly string[];
  /** min-x, min-y, width, height, shared by every layer of the test. */
  readonly viewBox: readonly [number, number, number, number];
  readonly layers: readonly TestLayer[];
  readonly guides: Readonly<Record<string, Guides>>;
  readonly diffAgainst: Readonly<Partial<Record<ReportFamily, DiffKind>>>;
  readonly diffRegions: Readonly<Partial<Record<ReportFamily, readonly Box[]>>>;
}

export interface ReportBundle {
  readonly manifest: Manifest;
  readonly metrics: Metrics;
  readonly coverage: Coverage;
  readonly shaping: Shaping;
  /** In manifest order. */
  readonly tests: readonly TestInfo[];
  /** Whether fontbakery/index.html is in the bundle, so the page may link it. */
  readonly fontbakeryHtml: boolean;
}

/** The upstream layer each Sawa family is compared with in a test. */
export function upstreamLayer(family: ReportFamily): string {
  return family.replace(/^sawa-/, "upstream-");
}
