import {
  REPORT_FAMILIES,
  type Box,
  type Coverage,
  type CoverageCount,
  type CoverageSet,
  type DiffKind,
  type FontbakeryFamily,
  type FontbakerySummary,
  type Guides,
  type Manifest,
  type ManifestFont,
  type Metrics,
  type ReportFamily,
  type Shaping,
  type ShapingCounts,
  type ShapingResult,
  type ShapingStatus,
  type TestInfo,
} from "./types";

/** A bundle file that doesn't have the shape the site reads. */
export class ReportBundleError extends Error {
  override name = "ReportBundleError";
}

type Json = unknown;

/** Test ids and layer files become URL and path segments. */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_SVG = /^[a-z0-9][a-z0-9-]*\.svg$/;
const SHAPING_STATUSES: readonly ShapingStatus[] = ["pass", "fail", "missing"];
const DIFF_KINDS: readonly DiffKind[] = ["upstream", "previous"];

function fail(path: string, message: string): never {
  throw new ReportBundleError(`${path}: ${message}`);
}

function object(value: Json, path: string): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  // Checked just above; TypeScript can't narrow unknown to an index signature.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, Json>;
}

function array(value: Json, path: string): Json[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }
  return value;
}

function string(value: Json, path: string): string {
  if (typeof value !== "string") {
    fail(path, "expected a string");
  }
  return value;
}

function nullableString(value: Json, path: string): string | null {
  return value === null || value === undefined ? null : string(value, path);
}

function number(value: Json, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
  return value;
}

function count(value: Json, path: string): number {
  const result = number(value, path);
  if (!Number.isInteger(result) || result < 0) {
    fail(path, "expected a non-negative integer");
  }
  return result;
}

function oneOf<T extends string>(value: Json, options: readonly T[], path: string): T {
  const text = string(value, path);
  const match = options.find((option) => option === text);
  if (match === undefined) {
    fail(path, `expected one of ${options.join(", ")}, got "${text}"`);
  }
  return match;
}

function safeId(value: Json, path: string): string {
  const text = string(value, path);
  if (!SAFE_ID.test(text)) {
    fail(path, `"${text}" is not a lowercase id`);
  }
  return text;
}

function record<T>(
  value: Json,
  path: string,
  item: (entry: Json, entryPath: string) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(object(value, path)).map(([key, entry]) => [key, item(entry, `${path}.${key}`)]),
  );
}

/** The entries of `value` keyed by a Sawa family; other keys are ignored. */
function familyRecord<T>(
  value: Json,
  path: string,
  item: (entry: Json, entryPath: string) => T,
): Partial<Record<ReportFamily, T>> {
  const source = object(value, path);
  const result: Partial<Record<ReportFamily, T>> = {};
  for (const family of REPORT_FAMILIES) {
    if (family in source) {
      result[family] = item(source[family], `${path}.${family}`);
    }
  }
  return result;
}

function shapingCounts(value: Json, path: string): ShapingCounts {
  const source = object(value, path);
  return {
    pass: count(source.pass, `${path}.pass`),
    fail: count(source.fail, `${path}.fail`),
    missing: count(source.missing, `${path}.missing`),
  };
}

function manifestFont(value: Json, path: string): ManifestFont {
  const source = object(value, path);
  const upstream = object(source.upstream, `${path}.upstream`);
  return {
    family: oneOf(source.family, REPORT_FAMILIES, `${path}.family`),
    name: string(source.name, `${path}.name`),
    file: string(source.file, `${path}.file`),
    sha256: string(source.sha256, `${path}.sha256`),
    upstream: {
      id: safeId(upstream.id, `${path}.upstream.id`),
      fonts: array(upstream.fonts, `${path}.upstream.fonts`).map((font, index) => {
        const fontPath = `${path}.upstream.fonts[${index}]`;
        const entry = object(font, fontPath);
        return {
          name: string(entry.name, `${fontPath}.name`),
          file: string(entry.file, `${fontPath}.file`),
        };
      }),
    },
  };
}

function fontbakeryFamily(value: Json, path: string): FontbakeryFamily {
  const source = object(value, path);
  return {
    counts: record(source.counts, `${path}.counts`, count),
    report: string(source.report, `${path}.report`),
  };
}

function fontbakery(value: Json, path: string): FontbakerySummary {
  const source = object(value, path);
  if (source.ran === false) {
    return { ran: false };
  }
  if (source.ran !== true) {
    fail(`${path}.ran`, "expected a boolean");
  }
  return {
    ran: true,
    profile: string(source.profile, `${path}.profile`),
    excluded: array(source.excluded, `${path}.excluded`).map((entry, index) =>
      string(entry, `${path}.excluded[${index}]`),
    ),
    version: nullableString(source.version, `${path}.version`),
    report: string(source.report, `${path}.report`),
    families: familyRecord(source.families, `${path}.families`, fontbakeryFamily),
  };
}

export function parseManifest(value: Json, path = "manifest.json"): Manifest {
  const source = object(value, path);
  const baseline = object(source.diffBaseline, `${path}.diffBaseline`);
  const date = string(source.date, `${path}.date`);
  if (Number.isNaN(Date.parse(date))) {
    fail(`${path}.date`, `"${date}" is not a date`);
  }
  const tests = array(source.tests, `${path}.tests`).map((id, index) =>
    safeId(id, `${path}.tests[${index}]`),
  );
  if (new Set(tests).size !== tests.length) {
    fail(`${path}.tests`, "lists a test id twice");
  }
  return {
    version: string(source.version, `${path}.version`),
    gitSha: nullableString(source.gitSha, `${path}.gitSha`),
    date,
    fonts: array(source.fonts, `${path}.fonts`).map((font, index) =>
      manifestFont(font, `${path}.fonts[${index}]`),
    ),
    tests,
    diffBaseline: {
      kind: oneOf(baseline.kind, DIFF_KINDS, `${path}.diffBaseline.kind`),
      version: nullableString(baseline.version, `${path}.diffBaseline.version`),
    },
    shaping: shapingCounts(source.shaping, `${path}.shaping`),
    fontbakery: fontbakery(source.fontbakery, `${path}.fontbakery`),
  };
}

export function parseMetrics(value: Json, path = "metrics.json"): Metrics {
  const source = object(value, path);
  return {
    families: familyRecord(source.families, `${path}.families`, (entry, entryPath) => {
      const family = object(entry, entryPath);
      const lineBox = object(family.lineBox, `${entryPath}.lineBox`);
      const at = (key: string) => number(lineBox[key], `${entryPath}.lineBox.${key}`);
      return {
        unitsPerEm: count(family.unitsPerEm, `${entryPath}.unitsPerEm`),
        lineBox: {
          source: string(lineBox.source, `${entryPath}.lineBox.source`),
          ascender: at("ascender"),
          descender: at("descender"),
          lineGap: at("lineGap"),
          height: at("height"),
          winHeight: at("winHeight"),
        },
      };
    }),
  };
}

function coverageCount(value: Json, path: string): CoverageCount {
  const source = object(value, path);
  const supported = count(source.supported, `${path}.supported`);
  const total = count(source.total, `${path}.total`);
  if (supported > total) {
    fail(path, "supports more codepoints than it has");
  }
  return { supported, total };
}

function coverageSet(value: Json, path: string): CoverageSet {
  const source = object(value, path);
  return {
    blocks: record(source.blocks, `${path}.blocks`, coverageCount),
    markGroups: record(source.markGroups, `${path}.markGroups`, coverageCount),
    glyphSets: record(source.glyphSets, `${path}.glyphSets`, coverageCount),
  };
}

export function parseCoverage(value: Json, path = "coverage.json"): Coverage {
  const source = object(value, path);
  return {
    unicodeVersion: string(source.unicodeVersion, `${path}.unicodeVersion`),
    families: familyRecord(source.families, `${path}.families`, (entry, entryPath) => ({
      ...coverageSet(entry, entryPath),
      upstream: coverageSet(object(entry, entryPath).upstream, `${entryPath}.upstream`),
    })),
  };
}

function shapingResult(value: Json, path: string): ShapingResult {
  const source = object(value, path);
  return { status: oneOf(source.status, SHAPING_STATUSES, `${path}.status`) };
}

export function parseShaping(value: Json, path = "shaping.json"): Shaping {
  const source = object(value, path);
  return {
    summary: shapingCounts(source.summary, `${path}.summary`),
    families: familyRecord(source.families, `${path}.families`, (tests, testsPath) =>
      record(tests, testsPath, (weights, weightsPath) =>
        record(weights, weightsPath, shapingResult),
      ),
    ),
  };
}

function guides(value: Json, path: string): Guides {
  const source = object(value, path);
  const at = (key: string) => number(source[key], `${path}.${key}`);
  return {
    ascender: at("ascender"),
    capHeight: at("capHeight"),
    xHeight: at("xHeight"),
    baseline: at("baseline"),
    descender: at("descender"),
    lineBoxTop: at("lineBoxTop"),
    lineBoxBottom: at("lineBoxBottom"),
  };
}

function box(value: Json, path: string): Box {
  const source = object(value, path);
  return {
    x: number(source.x, `${path}.x`),
    y: number(source.y, `${path}.y`),
    width: number(source.width, `${path}.width`),
    height: number(source.height, `${path}.height`),
  };
}

export function parseTest(value: Json, path: string): TestInfo {
  const source = object(value, path);
  const purpose = object(source.purpose, `${path}.purpose`);
  const viewBox = array(source.viewBox, `${path}.viewBox`).map((entry, index) =>
    number(entry, `${path}.viewBox[${index}]`),
  );
  const [minX, minY, width, height] = viewBox;
  if (
    viewBox.length !== 4 ||
    minX === undefined ||
    minY === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    fail(`${path}.viewBox`, "expected [min-x, min-y, width, height] with a positive size");
  }
  const layers = array(source.layers, `${path}.layers`).map((entry, index) => {
    const layerPath = `${path}.layers[${index}]`;
    const layer = object(entry, layerPath);
    const file = string(layer.file, `${layerPath}.file`);
    if (!SAFE_SVG.test(file)) {
      fail(`${layerPath}.file`, `"${file}" is not a plain .svg file name`);
    }
    return {
      id: safeId(layer.id, `${layerPath}.id`),
      file,
      name: string(layer.name, `${layerPath}.name`),
    };
  });
  const test: TestInfo = {
    id: safeId(source.id, `${path}.id`),
    purpose: {
      en: string(purpose.en, `${path}.purpose.en`),
      ar: string(purpose.ar, `${path}.purpose.ar`),
    },
    text: string(source.text, `${path}.text`),
    codepoints: array(source.codepoints, `${path}.codepoints`).map((entry, index) => {
      const text = string(entry, `${path}.codepoints[${index}]`);
      if (!/^U\+[0-9A-F]{4,6}$/.test(text)) {
        fail(`${path}.codepoints[${index}]`, `"${text}" is not a U+XXXX codepoint`);
      }
      return text;
    }),
    features: array(source.features, `${path}.features`).map((entry, index) =>
      string(entry, `${path}.features[${index}]`),
    ),
    viewBox: [minX, minY, width, height],
    layers,
    guides: record(source.guides, `${path}.guides`, guides),
    diffAgainst: familyRecord(source.diffAgainst, `${path}.diffAgainst`, (entry, entryPath) =>
      oneOf(entry, DIFF_KINDS, entryPath),
    ),
    diffRegions: familyRecord(source.diffRegions, `${path}.diffRegions`, (entry, entryPath) =>
      array(entry, entryPath).map((item, index) => box(item, `${entryPath}[${index}]`)),
    ),
  };
  const layerIds = new Set(layers.map((layer) => layer.id));
  for (const id of Object.keys(test.guides)) {
    if (!layerIds.has(id)) {
      fail(`${path}.guides.${id}`, "has guides for a layer the test doesn't list");
    }
  }
  return test;
}
