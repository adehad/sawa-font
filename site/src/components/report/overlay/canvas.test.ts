import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { frameWidth, paneLayers, swipeAfterKey, swipeAtPointer } from "./canvas";
import { loadReport } from "../../../report/load";
import { viewerJson, viewerTests } from "../../../report/viewer-data";

describe("swipeAfterKey", () => {
  it("steps by 1, or 10 with Shift, and clamps to 0-100", () => {
    expect(swipeAfterKey(50, "ArrowRight")).toBe(51);
    expect(swipeAfterKey(50, "ArrowLeft")).toBe(49);
    expect(swipeAfterKey(50, "ArrowUp", true)).toBe(60);
    expect(swipeAfterKey(95, "ArrowRight", true)).toBe(100);
    expect(swipeAfterKey(3, "PageDown")).toBe(0);
  });

  it("jumps to the ends with Home and End and ignores other keys", () => {
    expect(swipeAfterKey(40, "Home")).toBe(0);
    expect(swipeAfterKey(40, "End")).toBe(100);
    expect(swipeAfterKey(40, "Enter")).toBeUndefined();
  });
});

describe("swipeAtPointer", () => {
  it("maps a pointer to a whole percentage of the frame, clamped", () => {
    expect(swipeAtPointer(150, 100, 200)).toBe(25);
    expect(swipeAtPointer(0, 100, 200)).toBe(0);
    expect(swipeAtPointer(999, 100, 200)).toBe(100);
    expect(swipeAtPointer(5, 0, 0)).toBe(50);
  });
});

describe("frameWidth", () => {
  it("draws one SVG unit per CSS pixel at 100%, two at 200%", () => {
    expect(frameWidth([-16, -104, 96, 168], "100")).toBe("96px");
    expect(frameWidth([-16, -104, 96, 168], "200")).toBe("192px");
  });

  it("fits the width between --fit-min-block and --fit-block tall", () => {
    expect(frameWidth([0, 0, 200, 100], "fit")).toBe(
      "max(calc(var(--fit-min-block) * 2), min(100%, calc(var(--fit-block) * 2)))",
    );
  });
});

describe("paneLayers", () => {
  it("stacks Sawa over upstream in one pane, or splits them side by side", () => {
    expect(paneLayers("onion")).toEqual([["upstream", "sawa"]]);
    expect(paneLayers("swipe")).toEqual([["upstream", "sawa"]]);
    expect(paneLayers("side")).toEqual([["sawa"], ["upstream"]]);
  });
});

describe("viewerTests", () => {
  const result = loadReport(
    fileURLToPath(new URL("../../../report/__fixtures__/bundle", import.meta.url)),
  );

  it("keys each test's layers by id with their guides, and every family's regions", () => {
    if (result.kind !== "ok") throw new Error("fixture bundle is missing");
    const [test] = viewerTests(result.bundle);
    expect(test?.layers["upstream-sans"]?.file).toBe("upstream-sans.svg");
    expect(test?.layers["sawa-mono"]?.guides?.baseline).toBe(0);
    expect(Object.keys(test?.diffRegions ?? {})).toEqual(["sawa-serif", "sawa-sans", "sawa-mono"]);
    expect(test?.diffRegions["sawa-sans"]).toEqual([]);
  });

  it("escapes < so the JSON can't close its script element", () => {
    expect(viewerJson({ bundleBase: "/", tests: [], messages: { a: "</script>" } })).not.toContain(
      "</script>",
    );
  });
});
