import { describe, expect, it } from "vitest";
import { t } from "./t";

describe("t", () => {
  it("returns the English string for a plain key", () => {
    expect(t("en", "nav.compare")).toBe("Compare");
  });

  it("returns the Arabic string for a plain key", () => {
    expect(t("ar", "nav.compare")).toBe("المقارنة");
  });

  it("formats the English plural for distinct counts", () => {
    expect(t("en", "report.testsFailed", { count: 0 })).toBe("No tests failed");
    expect(t("en", "report.testsFailed", { count: 1 })).toBe("1 test failed");
    expect(t("en", "report.testsFailed", { count: 2 })).toBe("2 tests failed");
  });

  it("formats a distinct Arabic plural form for each CLDR category", () => {
    const forms = [0, 1, 2, 3, 11, 100].map((count) => t("ar", "report.testsFailed", { count }));
    expect(new Set(forms).size).toBe(forms.length);
  });
});
