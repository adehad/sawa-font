import { describe, expect, it } from "vitest";
import { CONTROL_IDS, SECTION_CONTROLS, activeSection, controlsFor } from "./sections";

describe("controlsFor", () => {
  it("puts the palette first for the Tashkeel section", () => {
    expect(controlsFor("tashkeel")[0]).toBe("palette");
  });

  it("puts the line grid first for the line-height section", () => {
    expect(controlsFor("lineHeight")[0]).toBe("grid");
  });

  it("gives the hero every control that changes its specimen", () => {
    expect(controlsFor("hero")).toEqual(["family", "weight", "size", "sample"]);
  });

  it("has no controls for an unknown or missing section", () => {
    expect(controlsFor("downloads")).toEqual([]);
    expect(controlsFor(undefined)).toEqual([]);
    expect(controlsFor("toString")).toEqual([]);
  });

  it("only names controls that exist", () => {
    for (const controls of Object.values(SECTION_CONTROLS)) {
      for (const control of controls) {
        expect(CONTROL_IDS).toContain(control);
      }
    }
  });
});

describe("activeSection", () => {
  const order = ["hero", "lineHeight", "tashkeel", "waterfall"];

  it("picks the first intersecting section in page order", () => {
    expect(activeSection(order, new Set(["waterfall", "tashkeel"]))).toBe("tashkeel");
  });

  it("is undefined when nothing crosses the band", () => {
    expect(activeSection(order, new Set())).toBeUndefined();
  });
});
