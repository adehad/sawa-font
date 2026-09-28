import { describe, expect, it } from "vitest";
import {
  absentFeatures,
  featureGroup,
  featureSettings,
  groupFeatures,
  isFeatureOn,
} from "./features";

describe("featureGroup", () => {
  it("sorts tags into the panel's groups", () => {
    expect(featureGroup("ss01")).toBe("ss");
    expect(featureGroup("cv44")).toBe("cv");
    expect(featureGroup("dlig")).toBe("liga");
    expect(featureGroup("rlig")).toBe("liga");
    expect(featureGroup("onum")).toBe("num");
    expect(featureGroup("smcp")).toBe("other");
    expect(featureGroup("init")).toBe("required");
  });
});

describe("groupFeatures", () => {
  it("de-duplicates and sorts, keeping rlig with the ligatures", () => {
    const { groups, required } = groupFeatures(["ss02", "liga", "ss01", "rlig", "mark", "ss01"]);
    expect(groups.ss).toEqual(["ss01", "ss02"]);
    expect(groups.liga).toEqual(["liga", "rlig"]);
    expect(required).toEqual(["mark"]);
  });
});

describe("isFeatureOn", () => {
  it("turns an off-by-default feature on when listed", () => {
    expect(isFeatureOn("ss01", [])).toBe(false);
    expect(isFeatureOn("ss01", ["ss01"])).toBe(true);
  });

  it("turns a default-on feature off when listed", () => {
    expect(isFeatureOn("liga", [])).toBe(true);
    expect(isFeatureOn("liga", ["liga"])).toBe(false);
  });

  it("keeps required features on", () => {
    expect(isFeatureOn("rlig", ["rlig"])).toBe(true);
  });
});

describe("featureSettings", () => {
  it("is normal with nothing toggled", () => {
    expect(featureSettings([])).toBe("normal");
  });

  it("writes each toggled feature's state", () => {
    expect(featureSettings(["ss01", "liga", "rlig"])).toBe('"ss01" 1, "liga" 0');
  });
});

describe("absentFeatures", () => {
  it("lists toggled features the font lacks", () => {
    expect(absentFeatures(["ss01", "onum", "rlig"], ["onum"])).toEqual(["ss01"]);
  });
});
