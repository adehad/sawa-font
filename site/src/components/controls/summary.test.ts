import { describe, expect, it } from "vitest";
import { fillTemplate, formatSummary } from "./summary";

describe("formatSummary", () => {
  it("joins the parts with a middle dot", () => {
    expect(formatSummary(["Sawa Sans", "400", "32 px", "Groups"])).toBe(
      "Sawa Sans · 400 · 32 px · Groups",
    );
  });

  it("drops missing and blank parts", () => {
    expect(formatSummary(["Sawa Mono", undefined, " ", "32 px"])).toBe("Sawa Mono · 32 px");
  });

  it("trims each part", () => {
    expect(formatSummary(["  Sawa Serif\n", "700 "])).toBe("Sawa Serif · 700");
  });

  it("is empty with no parts", () => {
    expect(formatSummary([])).toBe("");
  });
});

describe("fillTemplate", () => {
  it("replaces named placeholders", () => {
    expect(fillTemplate("{size} px", { size: "32" })).toBe("32 px");
  });

  it("keeps placeholders it has no value for", () => {
    expect(fillTemplate("{size} {unit}", { size: "٣٢" })).toBe("٣٢ {unit}");
  });
});
