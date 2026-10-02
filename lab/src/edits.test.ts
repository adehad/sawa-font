import { describe, expect, it } from "vitest";
import { type ShapedGlyph, layout, placements } from "./cells";
import { History, type PartRef, type Stamp, moveBy, offsetOf, resetPart, setOffset } from "./edits";
import { glyphMoves } from "./model";
import { NO_OVERRIDES, type Overrides } from "./store";

const STAMP: Stamp = {
  build: "sans-400-1.15-abc",
  wght: 400,
  now: "2026-10-02T10:00:00.000Z",
  usedBy: (name) => (name === "beh.init" ? ["beh initial", "noon initial"] : []),
};

const BODY: PartRef = { kind: "body", glyph: "beh.init" };
const DOT: PartRef = { kind: "dots", glyph: "beh.init", part: "dotbelow" };
const MARK: PartRef = {
  kind: "mark",
  key: { letter: "U+0628", form: "initial", marks: ["U+064E"] },
  index: 0,
  glyph: "fatha",
  base: "beh.init",
};

describe("drag state", () => {
  it("stores body, dot and mark offsets in their own entries", () => {
    let o: Overrides = NO_OVERRIDES;
    o = setOffset(o, BODY, [0, 40.4], STAMP);
    o = setOffset(o, DOT, [3, -20], STAMP);
    o = setOffset(o, MARK, [12, 0], STAMP);
    expect(offsetOf(o, BODY)).toEqual([0, 40]);
    expect(offsetOf(o, DOT)).toEqual([3, -20]);
    expect(offsetOf(o, MARK)).toEqual([12, 0]);
    expect(o.glyphs).toEqual([
      {
        glyph: "beh.init",
        usedBy: ["beh initial", "noon initial"],
        build: STAMP.build,
        wght: 400,
        body: { dx: 0, dy: 40 },
        dots: [{ part: "dotbelow", dx: 3, dy: -20 }],
        updated: STAMP.now,
      },
    ]);
    expect(o.marks[0]?.glyph).toBe("beh.init");
  });

  it("drops an entry once every part is back home", () => {
    let o = setOffset(NO_OVERRIDES, BODY, [5, 5], STAMP);
    o = setOffset(o, DOT, [1, 1], STAMP);
    o = resetPart(o, BODY, STAMP);
    expect(o.glyphs).toHaveLength(1);
    o = resetPart(o, DOT, STAMP);
    expect(o.glyphs).toEqual([]);
    expect(resetPart(setOffset(NO_OVERRIDES, MARK, [1, 2], STAMP), MARK, STAMP).marks).toEqual([]);
  });

  it("moves linked parts by the same delta from where each was", () => {
    const other: PartRef = { kind: "body", glyph: "beh.medi" };
    const start = setOffset(NO_OVERRIDES, other, [0, 10], STAMP);
    const moved = moveBy(start, [BODY, other, BODY], [0, 25], STAMP);
    expect(offsetOf(moved, BODY)).toEqual([0, 25]);
    expect(offsetOf(moved, other)).toEqual([0, 35]);
  });
});

describe("undo and redo", () => {
  it("walks back and forward through edits and forgets redo on a new edit", () => {
    const history = new History();
    const a = NO_OVERRIDES;
    const b = setOffset(a, BODY, [0, 10], STAMP);
    const c = setOffset(b, BODY, [0, 20], STAMP);
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

describe("placements", () => {
  // Visual order of beh initial + fatha: fatha (3), the split-off dot (2), the body (1).
  const names: Record<number, string> = { 1: "beh.init", 2: "dotbelow", 3: "fatha" };
  const facts = {
    isBase: (gid: number) => gid === 1,
    isMark: (gid: number) => gid !== 1,
    name: (gid: number) => names[gid] ?? "",
  };
  const cell = layout(
    [glyph(3, 1, 0, 100, 500), glyph(2, 0, 0, 120, -100), glyph(1, 0, 300)],
    [glyph(2, 0, 0, 120, -100), glyph(1, 0, 300)],
    facts,
  );

  it("ties the dot and the mark to the body", () => {
    expect(cell.pieces.map((p) => [p.name, p.kind, p.owner, p.adjacent])).toEqual([
      ["fatha", "mark", 2, false],
      ["dotbelow", "base", 2, true],
      ["beh.init", "base", 2, false],
    ]);
  });

  it("moves everything with the body and only the dot with the dot", () => {
    let o = setOffset(NO_OVERRIDES, BODY, [0, 40], STAMP);
    o = setOffset(o, DOT, [10, -5], STAMP);
    o = setOffset(o, MARK, [0, 7], STAMP);
    const placed = placements(cell, glyphMoves(o), { 0: [0, 7] });
    expect(placed.map((p) => [p.dx, p.dy])).toEqual([
      [0, 47],
      [10, 35],
      [0, 40],
    ]);
  });
});
