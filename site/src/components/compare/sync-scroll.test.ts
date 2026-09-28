import { describe, expect, it } from "vitest";
import { scrollRatio, scrollTopFor } from "./sync-scroll";

describe("scrollRatio", () => {
  it("is the share of the scroll range travelled", () => {
    expect(scrollRatio(50, 300, 100)).toBe(0.25);
  });

  it("is 0 for an element that can't scroll", () => {
    expect(scrollRatio(0, 100, 100)).toBe(0);
  });

  it("stays inside 0 to 1", () => {
    expect(scrollRatio(500, 300, 100)).toBe(1);
  });
});

describe("scrollTopFor", () => {
  it("maps a ratio onto another element's own range", () => {
    expect(scrollTopFor(0.25, 900, 100)).toBe(200);
  });

  it("is 0 for an element that can't scroll", () => {
    expect(scrollTopFor(0.5, 100, 200)).toBe(0);
  });
});
