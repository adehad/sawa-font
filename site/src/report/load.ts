import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReportBundle } from "./types";
import {
  ReportBundleError,
  parseCoverage,
  parseManifest,
  parseMetrics,
  parseShaping,
  parseTest,
} from "./validate";

export type ReportLoad =
  | { readonly kind: "ok"; readonly bundle: ReportBundle }
  | { readonly kind: "missing"; readonly dir: string };

/** The bundle directory the site reads: REPORT_DIR, resolved against the site root. */
export function resolveReportDir(siteRoot: string, reportDir: string | undefined): string {
  return path.resolve(siteRoot, reportDir || "../report/current");
}

function readJson(dir: string, file: string): unknown {
  const text = readFileSync(path.join(dir, file), "utf-8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReportBundleError(`${file}: ${String(error)}`, { cause: error });
  }
}

/**
 * Reads and validates the bundle in `dir`. A directory with no manifest.json
 * is "missing", so the site still builds without a report; anything malformed
 * inside a bundle throws.
 */
export function loadReport(dir: string): ReportLoad {
  if (!existsSync(path.join(dir, "manifest.json"))) {
    return { kind: "missing", dir };
  }
  const manifest = parseManifest(readJson(dir, "manifest.json"));
  const tests = manifest.tests.map((id) => {
    const file = `tests/${id}/test.json`;
    const test = parseTest(readJson(dir, file), file);
    if (test.id !== id) {
      throw new ReportBundleError(`${file}: id "${test.id}" doesn't match its directory`);
    }
    for (const layer of test.layers) {
      if (!existsSync(path.join(dir, "tests", id, layer.file))) {
        throw new ReportBundleError(`${file}: layer file ${layer.file} is missing`);
      }
    }
    return test;
  });
  return {
    kind: "ok",
    bundle: {
      manifest,
      metrics: parseMetrics(readJson(dir, "metrics.json")),
      coverage: parseCoverage(readJson(dir, "coverage.json")),
      shaping: parseShaping(readJson(dir, "shaping.json")),
      tests,
      fontbakeryHtml: existsSync(path.join(dir, "fontbakery", "index.html")),
    },
  };
}

const cache = new Map<string, ReportLoad>();

/** `loadReport`, read once per directory for the whole build. */
export function cachedReport(dir: string): ReportLoad {
  let result = cache.get(dir);
  if (!result) {
    result = loadReport(dir);
    cache.set(dir, result);
  }
  return result;
}
