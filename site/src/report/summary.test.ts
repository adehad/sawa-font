import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadReport } from "./load";
import {
  bundleFamilies,
  coverageSummary,
  failedTests,
  familyName,
  ratio,
  testShaping,
  worstStatus,
} from "./summary";
import type { ReportBundle } from "./types";

const FIXTURE = fileURLToPath(new URL("__fixtures__/bundle", import.meta.url));
const TEST_ID = "shadda-kasra-default";

function fixture(): ReportBundle {
  const result = loadReport(FIXTURE);
  if (result.kind !== "ok") {
    throw new Error("fixture bundle is missing");
  }
  return result.bundle;
}

describe("coverageSummary", () => {
  it("sums the Arabic blocks and mark groups and picks GF Latin Core", () => {
    const set = fixture().coverage.families["sawa-mono"];
    if (!set) throw new Error("no sawa-mono coverage");
    const summary = coverageSummary(set);
    expect(summary.latinCore).toEqual({ supported: 319, total: 319 });
    const arabic = set.blocks.Arabic;
    const supplement = set.blocks["Arabic Supplement"];
    expect(summary.arabicBlocks).toEqual({
      supported: (arabic?.supported ?? 0) + (supplement?.supported ?? 0),
      total: (arabic?.total ?? 0) + (supplement?.total ?? 0),
    });
    expect(summary.markGroups.supported).toBeLessThan(summary.markGroups.total);
  });

  it("leaves Latin Core undefined when the glyph set isn't reported", () => {
    expect(
      coverageSummary({ blocks: {}, markGroups: {}, glyphSets: {} }).latinCore,
    ).toBeUndefined();
  });
});

describe("ratio", () => {
  it("is supported over total, and 1 for an empty set", () => {
    expect(ratio({ supported: 1, total: 4 })).toBe(0.25);
    expect(ratio({ supported: 0, total: 0 })).toBe(1);
  });
});

describe("shaping helpers", () => {
  it("lists one family's weights lightest first", () => {
    expect(testShaping(fixture().shaping, "sawa-sans", TEST_ID)).toEqual([
      { weight: "100", status: "fail" },
      { weight: "400", status: "missing" },
      { weight: "900", status: "pass" },
    ]);
  });

  it("is empty for a test the family has no results for", () => {
    expect(testShaping(fixture().shaping, "sawa-sans", "nope")).toEqual([]);
  });

  it("takes a test's worst result over every family", () => {
    expect(worstStatus(fixture().shaping, TEST_ID)).toBe("fail");
    expect(worstStatus(fixture().shaping, "nope")).toBe("pass");
  });

  it("counts the tests that fail anywhere", () => {
    expect(failedTests(fixture())).toBe(1);
  });
});

describe("family helpers", () => {
  it("names families from the manifest in its order", () => {
    const bundle = fixture();
    expect(bundleFamilies(bundle)).toEqual(["sawa-serif", "sawa-sans", "sawa-mono"]);
    expect(familyName(bundle, "sawa-mono")).toBe("Sawa Mono");
  });
});
