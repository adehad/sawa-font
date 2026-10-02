import { describe, expect, it } from "vitest";
import { arrowStep, leftToRight } from "./forms";
import { FORMS } from "./types";

describe("right-to-left forms", () => {
  it("draws isolated at the right and final at the left", () => {
    expect(leftToRight(FORMS)).toEqual(["final", "medial", "initial", "isolated"]);
    expect(leftToRight(["isolated", "final"])).toEqual(["final", "isolated"]);
    expect(FORMS[0]).toBe("isolated");
  });

  it("moves the way the arrow points in a right-to-left grid", () => {
    expect(arrowStep("ArrowLeft", true)).toEqual([0, 1]);
    expect(arrowStep("ArrowRight", true)).toEqual([0, -1]);
    expect(arrowStep("ArrowLeft", false)).toEqual([0, -1]);
    expect(arrowStep("ArrowDown", true)).toEqual([1, 0]);
    expect(arrowStep("Enter", true)).toBeNull();
  });
});
