import { describe, expect, it } from "vitest";
import { localizedPath, swapLocale } from "./paths";

describe("localizedPath", () => {
  it("builds the specimen (index) URL under a project base", () => {
    expect(localizedPath("/sawa-font/", "en", "specimen")).toBe("/sawa-font/en/");
    expect(localizedPath("/sawa-font/", "ar", "specimen")).toBe("/sawa-font/ar/");
  });

  it("builds a nested page URL under a project base", () => {
    expect(localizedPath("/sawa-font/", "en", "compare")).toBe("/sawa-font/en/compare/");
  });

  it("builds URLs under a root base", () => {
    expect(localizedPath("/", "en", "specimen")).toBe("/en/");
    expect(localizedPath("/", "ar", "report")).toBe("/ar/report/");
  });
});

describe("swapLocale", () => {
  it("swaps the locale on the index page under a project base", () => {
    expect(swapLocale("/sawa-font/", "/sawa-font/en/", "ar")).toBe("/sawa-font/ar/");
  });

  it("swaps the locale on a nested page under a project base", () => {
    expect(swapLocale("/sawa-font/", "/sawa-font/en/compare/", "ar")).toBe(
      "/sawa-font/ar/compare/",
    );
  });

  it("swaps the locale under a root base", () => {
    expect(swapLocale("/", "/en/compare/", "ar")).toBe("/ar/compare/");
  });

  it("swaps the locale under a nested base, such as a Read the Docs version path", () => {
    expect(swapLocale("/en/latest/", "/en/latest/en/compare/", "ar")).toBe(
      "/en/latest/ar/compare/",
    );
  });

  it("normalizes a base given without a trailing slash", () => {
    expect(swapLocale("/sawa-font", "/sawa-font/en/about/", "ar")).toBe("/sawa-font/ar/about/");
  });

  it("normalizes a pathname given without a trailing slash", () => {
    expect(swapLocale("/sawa-font/", "/sawa-font/en/about", "ar")).toBe("/sawa-font/ar/about/");
  });

  it("throws when the pathname is not under the base", () => {
    expect(() => swapLocale("/sawa-font/", "/other/en/", "ar")).toThrow(/not under base/);
  });
});
