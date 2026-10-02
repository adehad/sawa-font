import { describe, expect, it } from "vitest";
import { type ShapedGlyph, layout, placements } from "./cells";
import {
  History,
  NO_EDITS,
  type Stamp,
  type Target,
  moveBy,
  movesOf,
  offsetOf,
  reset,
  setOffset,
} from "./edits";
import type { Attachment } from "./positioning";

const STAMP: Stamp = {
  build: "sans-400-1.15-abc",
  wght: 400,
  now: "2026-10-02T10:00:00.000Z",
  usedBy: (name) => (name === "beh.init" ? ["beh initial", "noon initial"] : []),
};

const BODY: Target = { mechanism: "outline", glyph: "beh.init", part: "body" };
const DOT: Target = { mechanism: "outline", glyph: "beh.init", part: "dotbelow" };
const PAIR: Target = { mechanism: "pair", base: "beh.init", mark: "fatha" };

describe("edit state", () => {
  it("keeps one edit per target, rounded, stamped with where its glyph is used", () => {
    let e = setOffset(NO_EDITS, BODY, "outline", [0, 40.4], STAMP);
    e = setOffset(e, DOT, "outline", [3, -20], STAMP);
    e = setOffset(e, PAIR, "pair", [12, 0], STAMP);
    e = setOffset(e, PAIR, "pair", [12, 5], STAMP);
    expect(offsetOf(e, BODY)).toEqual([0, 40]);
    expect(offsetOf(e, DOT)).toEqual([3, -20]);
    expect(offsetOf(e, PAIR)).toEqual([12, 5]);
    expect(e.edits).toHaveLength(3);
    expect(e.edits[0]).toEqual({
      target: BODY,
      scope: "outline",
      dx: 0,
      dy: 40,
      build: STAMP.build,
      wght: 400,
      usedBy: ["beh initial", "noon initial"],
      updated: STAMP.now,
    });
  });

  it("drops an edit once it is back home", () => {
    let e = setOffset(NO_EDITS, BODY, "outline", [5, 5], STAMP);
    e = setOffset(e, DOT, "outline", [1, 1], STAMP);
    e = reset(e, [BODY], STAMP);
    expect(e.edits.map((x) => x.target)).toEqual([DOT]);
    expect(reset(e, [DOT], STAMP).edits).toEqual([]);
  });

  it("moves every target of a scope by the same delta from where each was", () => {
    const other: Target = { mechanism: "outline", glyph: "beh.medi", part: "body" };
    const start = setOffset(NO_EDITS, other, "outline", [0, 10], STAMP);
    const moved = moveBy(start, [BODY, other, BODY], "all-forms", [0, 25], STAMP);
    expect(offsetOf(moved, BODY)).toEqual([0, 25]);
    expect(offsetOf(moved, other)).toEqual([0, 35]);
    expect(moved.edits.every((x) => x.scope === "all-forms")).toBe(true);
  });
});

describe("undo and redo", () => {
  it("walks back and forward through edits and forgets redo on a new edit", () => {
    const history = new History();
    const a = NO_EDITS;
    const b = setOffset(a, BODY, "outline", [0, 10], STAMP);
    const c = setOffset(b, BODY, "outline", [0, 20], STAMP);
    history.push(a);
    history.push(b);
    expect(history.undo(c)).toBe(b);
    expect(history.undo(b)).toBe(a);
    expect(history.undo(a)).toBeNull();
    expect(history.redo(a)).toBe(b);
    expect(history.canRedo).toBe(true);
    history.push(b);
    expect(history.canRedo).toBe(false);
    expect(history.redo(c)).toBeNull();
  });
});

function glyph(gid: number, cluster: number, xAdvance = 0, xOffset = 0, yOffset = 0): ShapedGlyph {
  return { gid, cluster, xAdvance, xOffset, yOffset };
}

const split = (marks: string[]): Target => ({
  mechanism: "split-class",
  glyph: "beh.init",
  cls: "27.0",
  marks,
});

describe("placements for each mechanism", () => {
  // Beh initial with shadda and fatha, in visual order: fatha (4) stacked on
  // shadda (3), which hangs on the body's top anchor; the split-off dot (2)
  // hangs on its bottom anchor; the body (1).
  const names: Record<number, string> = { 1: "beh.init", 2: "dotbelow", 3: "shadda", 4: "fatha" };
  const facts = {
    isBase: (gid: number) => gid === 1,
    isMark: (gid: number) => gid !== 1,
    name: (gid: number) => names[gid] ?? "",
  };
  const cell = layout(
    [
      glyph(4, 2, 0, 100, 700),
      glyph(3, 1, 0, 100, 500),
      glyph(2, 0, 0, 120, -100),
      glyph(1, 0, 300),
    ],
    [glyph(2, 0, 0, 120, -100), glyph(1, 0, 300)],
    facts,
  );
  const at: (Attachment | null)[] = [
    { parent: 1, cls: "35.0", kind: "mark" },
    { parent: 3, cls: "27.0", kind: "base" },
    { parent: 3, cls: "19.0", kind: "base" },
    null,
  ];
  const placed = (target: Target) =>
    placements(cell, at, movesOf(setOffset(NO_EDITS, target, "pair", [0, 10], STAMP).edits)).map(
      (p) => p.dy,
    );

  it("moves the body's outline with everything that hangs on it", () => {
    expect(placed(BODY)).toEqual([10, 10, 10, 10]);
  });

  it("moves a dot glyph's copy alone, its stacked marks staying put", () => {
    expect(placed(DOT)).toEqual([0, 0, 10, 0]);
  });

  it("moves an anchor's class and what stacks on it, not the other classes", () => {
    expect(placed({ mechanism: "anchor", glyph: "beh.init", cls: "27.0" })).toEqual([10, 10, 0, 0]);
    expect(placed({ mechanism: "anchor", glyph: "beh.init", cls: "19.0" })).toEqual([0, 0, 10, 0]);
  });

  it("moves only the split-off marks of a class", () => {
    expect(placed(split(["shadda"]))).toEqual([10, 10, 0, 0]);
    expect(placed(split(["fatha"]))).toEqual([0, 0, 0, 0]);
  });

  it("moves the marks stacked on a mark-to-mark anchor", () => {
    expect(placed({ mechanism: "mkmk-anchor", glyph: "shadda", cls: "35.0" })).toEqual([
      10, 0, 0, 0,
    ]);
  });

  it("moves one mark after its base with a pair rule, leaving what stacks on it", () => {
    expect(placed({ mechanism: "pair", base: "beh.init", mark: "shadda" })).toEqual([0, 10, 0, 0]);
    expect(placed(PAIR)).toEqual([10, 0, 0, 0]);
    expect(placed({ mechanism: "pair", base: "beh.medi", mark: "fatha" })).toEqual([0, 0, 0, 0]);
  });
});
