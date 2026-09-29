import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bundleAssets } from "./integration";
import { loadReport, resolveReportDir } from "./load";
import { ReportBundleError, parseManifest, parseTest } from "./validate";

const FIXTURE = fileURLToPath(new URL("__fixtures__/bundle", import.meta.url));
const TEST_ID = "shadda-kasra-default";

const scratch: string[] = [];

/** A writable copy of the fixture bundle, with `edit` applied to one of its JSON files. */
function brokenCopy(file: string, edit: (data: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sawa-report-"));
  scratch.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  const target = path.join(dir, file);
  const data: Record<string, unknown> = JSON.parse(readFileSync(target, "utf-8"));
  edit(data);
  writeFileSync(target, JSON.stringify(data));
  return dir;
}

function fixtureJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURE, file), "utf-8"));
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveReportDir", () => {
  it("resolves REPORT_DIR against the site root, not the working directory", () => {
    const root = path.resolve("/repo/site");
    expect(resolveReportDir(root, "../report/v1")).toBe(path.resolve("/repo/report/v1"));
  });

  it("defaults to ../report/current", () => {
    const root = path.resolve("/repo/site");
    expect(resolveReportDir(root, undefined)).toBe(path.resolve("/repo/report/current"));
    expect(resolveReportDir(root, "")).toBe(path.resolve("/repo/report/current"));
  });

  it("keeps an absolute REPORT_DIR", () => {
    const absolute = path.resolve("/elsewhere/bundle");
    expect(resolveReportDir(path.resolve("/repo/site"), absolute)).toBe(absolute);
  });
});

describe("loadReport", () => {
  it("reads and validates the fixture bundle", () => {
    const result = loadReport(FIXTURE);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const { bundle } = result;
    expect(bundle.manifest.version).toBe("v0.0.0-fixture");
    expect(bundle.manifest.diffBaseline).toEqual({ kind: "previous", version: "v0.0.0-previous" });
    expect(bundle.manifest.shaping).toEqual({ pass: 6, fail: 1, missing: 1 });
    expect(bundle.manifest.fontbakery.ran).toBe(true);
    expect(bundle.fontbakeryHtml).toBe(true);
    expect(bundle.tests.map((test) => test.id)).toEqual([TEST_ID]);
    const [test] = bundle.tests;
    expect(test?.viewBox).toEqual([-16, -104, 96, 168]);
    expect(test?.layers.map((layer) => layer.file)).toContain("upstream-sans.svg");
    expect(test?.diffRegions["sawa-serif"]?.length).toBeGreaterThan(0);
    expect(test?.guides["sawa-serif"]?.baseline).toBe(0);
    expect(bundle.metrics.families["sawa-sans"]?.lineBox.height).toBeCloseTo(2.112);
    expect(bundle.coverage.families["sawa-serif"]?.glyphSets.GF_Latin_Core).toEqual({
      supported: 319,
      total: 319,
    });
    expect(bundle.shaping.families["sawa-sans"]?.[TEST_ID]?.["wght=100"]?.status).toBe("fail");
  });

  it("reports a directory with no manifest as missing instead of throwing", () => {
    const dir = path.join(FIXTURE, "does-not-exist");
    expect(loadReport(dir)).toEqual({ kind: "missing", dir });
  });

  it("throws on a manifest with the wrong shape", () => {
    const dir = brokenCopy("manifest.json", (data) => {
      data.shaping = { pass: "all" };
    });
    expect(() => loadReport(dir)).toThrow(ReportBundleError);
    expect(() => loadReport(dir)).toThrow(/manifest\.json\.shaping\.pass/);
  });

  it("throws on JSON that doesn't parse", () => {
    const dir = brokenCopy("metrics.json", () => undefined);
    writeFileSync(path.join(dir, "metrics.json"), "{ not json");
    expect(() => loadReport(dir)).toThrow(/metrics\.json/);
  });

  it("throws when a listed test has no test.json", () => {
    const dir = brokenCopy("manifest.json", (data) => {
      data.tests = [TEST_ID, "no-such-test"];
    });
    expect(() => loadReport(dir)).toThrow(/no-such-test/);
  });

  it("throws when a layer's SVG file is missing", () => {
    const dir = brokenCopy(`tests/${TEST_ID}/test.json`, () => undefined);
    rmSync(path.join(dir, "tests", TEST_ID, "sawa-mono.svg"));
    expect(() => loadReport(dir)).toThrow(/sawa-mono\.svg is missing/);
  });

  it("throws when a test's id doesn't match its directory", () => {
    const dir = brokenCopy(`tests/${TEST_ID}/test.json`, (data) => {
      data.id = "another-test";
    });
    expect(() => loadReport(dir)).toThrow(/doesn't match/);
  });
});

describe("parseManifest", () => {
  it("accepts a bundle built without Fontbakery", () => {
    const data = fixtureJson("manifest.json");
    data.fontbakery = { ran: false, reason: "not requested (--fontbakery)" };
    expect(parseManifest(data).fontbakery).toEqual({ ran: false });
  });

  it("rejects an unknown diff baseline", () => {
    const data = fixtureJson("manifest.json");
    data.diffBaseline = { kind: "yesterday", version: null };
    expect(() => parseManifest(data)).toThrow(/diffBaseline\.kind/);
  });

  it("rejects a test id that isn't safe as a path segment", () => {
    const data = fixtureJson("manifest.json");
    data.tests = ["../escape"];
    expect(() => parseManifest(data)).toThrow(/tests\[0\]/);
  });
});

describe("parseTest", () => {
  const file = `tests/${TEST_ID}/test.json`;

  it("rejects a viewBox without a positive size", () => {
    const data = fixtureJson(file);
    data.viewBox = [0, 0, 0, 10];
    expect(() => parseTest(data, file)).toThrow(/viewBox/);
  });

  it("rejects a layer file outside the test directory", () => {
    const data = fixtureJson(file);
    data.layers = [{ id: "sawa-serif", file: "../sawa-serif.svg", name: "Sawa Serif" }];
    expect(() => parseTest(data, file)).toThrow(/layers\[0\]\.file/);
  });

  it("rejects guides for a layer the test doesn't have", () => {
    const data = fixtureJson(file);
    data.layers = [{ id: "sawa-serif", file: "sawa-serif.svg", name: "Sawa Serif" }];
    expect(() => parseTest(data, file)).toThrow(/guides\.upstream-serif/);
  });

  it("rejects a diff region with a missing coordinate", () => {
    const data = fixtureJson(file);
    data.diffRegions = { "sawa-serif": [{ x: 1, y: 2, width: 3 }] };
    expect(() => parseTest(data, file)).toThrow(/diffRegions\.sawa-serif\[0\]\.height/);
  });
});

describe("bundleAssets", () => {
  it("lists every SVG layer and the Fontbakery HTML, relative and forward-slashed", () => {
    expect(bundleAssets(FIXTURE)).toEqual([
      "fontbakery/index.html",
      ...[
        "sawa-mono",
        "sawa-sans",
        "sawa-serif",
        "upstream-mono",
        "upstream-sans",
        "upstream-serif",
      ].map((layer) => `tests/${TEST_ID}/${layer}.svg`),
    ]);
  });

  it("is empty when there is no bundle", () => {
    expect(bundleAssets(path.join(FIXTURE, "does-not-exist"))).toEqual([]);
  });
});
