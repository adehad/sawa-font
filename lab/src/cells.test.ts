import { describe, expect, it } from "vitest";
import {
  type GlyphMoves,
  NO_MOVES,
  type Layout,
  type ShapedGlyph,
  analyse,
  cellCodepoints,
  layout,
  plainInk,
  placements,
} from "./cells";
import { envelope, lineBox } from "./envelope";
import { type Contour, flatten, inkGap, parsePath } from "./geometry";

function rect(x0: number, y0: number, x1: number, y1: number): Contour[] {
  return flatten(parsePath(`M${x0},${y0}L${x0},${y1}L${x1},${y1}L${x1},${y0}Z`));
}

// gid 1: a letter body 0..500 x 0..400; gid 2: its dot 200..300 x 450..550;
// gid 3: a mark 0..300 x 0..80 drawn at the origin; gid 4: an empty ZWJ.
const OUTLINES: Record<number, Contour[]> = {
  1: rect(0, 0, 500, 400),
  2: rect(200, 450, 300, 550),
  3: rect(0, 0, 300, 80),
  4: [],
};
const outline = (gid: number) => OUTLINES[gid] ?? [];
const ink = plainInk(outline);
const check = (cell: Layout, moves: GlyphMoves = NO_MOVES) =>
  analyse(
    cell,
    ink,
    placements(
      cell,
      cell.pieces.map(() => null),
      moves,
    ),
    30,
  );
// gid 3 is a mark, the others are not.
const FACTS = {
  isBase: () => false,
  isMark: (gid: number) => gid === 3,
  name: (gid: number) => `g${gid}`,
};

function glyph(gid: number, cluster: number, xAdvance = 0, xOffset = 0, yOffset = 0): ShapedGlyph {
  return { gid, cluster, xAdvance, xOffset, yOffset };
}

describe("geometry", () => {
  it("measures the clear gap between two boxes", () => {
    expect(inkGap(rect(0, 0, 100, 100), rect(0, 130, 100, 200), 200)).toBeCloseTo(30);
    expect(inkGap(rect(0, 0, 100, 100), rect(130, 140, 200, 200), 200)).toBeCloseTo(50);
  });

  it("calls overlapping or nested ink zero and far ink infinite", () => {
    expect(inkGap(rect(0, 0, 100, 100), rect(50, 50, 150, 150), 200)).toBe(0);
    expect(inkGap(rect(0, 0, 100, 100), rect(20, 20, 80, 80), 200)).toBe(0);
    expect(inkGap(rect(0, 0, 100, 100), rect(0, 500, 100, 600), 200)).toBe(Infinity);
  });

  it("flattens curves through their end points", () => {
    const [contour] = flatten(parsePath("M0,0Q50,100 100,0Z"));
    expect(contour?.at(-1)).toEqual([100, 0]);
    expect(Math.max(...(contour ?? []).map(([, y]) => y))).toBeCloseTo(50);
  });
});

describe("cells", () => {
  it("forces each form with ZWJ", () => {
    expect(cellCodepoints("ب", "medial", ["U+064E"])).toEqual([0x200d, 0x628, 0x64e, 0x200d]);
    expect(cellCodepoints("ب", "isolated", [])).toEqual([0x628]);
  });

  it("splits the letter and its dot from the marks by cluster", () => {
    const shaped = [glyph(4, 2), glyph(3, 1, 0, 100, 470), glyph(2, 0), glyph(1, 0, 500)];
    const cell = layout(shaped, [glyph(4, 1), glyph(2, 0), glyph(1, 0, 500)]);
    expect(cell.pieces.map((p) => p.kind)).toEqual(["base", "mark", "base", "base"]);
    expect(cell.pieces[1]?.mark).toBe(0);
    expect(cell.advance).toBe(500);
  });

  it("finds a clash with the dot and clears it with a pair rule", () => {
    // The mark sits 470..550 over the dot's 450..550: overlapping ink.
    const cell = layout(
      [glyph(3, 1, 0, 100, 470), glyph(2, 0), glyph(1, 0, 500)],
      [glyph(2, 0), glyph(1, 0, 500)],
      FACTS,
    );
    const clashing = check(cell);
    expect(clashing.gap).toBe(0);
    expect(clashing.clash).toBe(true);
    const moved = check(cell, {
      ...NO_MOVES,
      pair: (base, mark) => (base === "g2" && mark === "g3" ? [0, 120] : [0, 0]),
    });
    expect(moved.gap).toBeCloseTo(40);
    expect(moved.clash).toBe(false);
    expect(moved.top).toBe(670);
    expect(moved.bottom).toBe(0);
  });

  it("keeps the letter's own copy of a glyph its mark repeats", () => {
    // Like U+0623 with hamza above: the carrier's hamza and the added one share a glyph.
    const shaped = [glyph(3, 0, 0, 0, 700), glyph(3, 0, 0, 0, 450), glyph(1, 0, 500)];
    const cell = layout(shaped, [glyph(3, 0, 0, 0, 450), glyph(1, 0, 500)]);
    expect(cell.pieces.map((p) => [p.kind, p.y])).toEqual([
      ["mark", 700],
      ["base", 450],
      ["base", 0],
    ]);
  });

  it("reports no clash for a bare letter", () => {
    const letter = [glyph(2, 0), glyph(1, 0, 500)];
    const bare = check(layout(letter, letter));
    expect(bare.hasMarks).toBe(false);
    expect(bare.clash).toBe(false);
    expect(bare.top).toBe(550);
  });
});

describe("envelope", () => {
  const extents = [
    { key: "a", top: 900, bottom: -100 },
    { key: "b", top: 1200, bottom: -50 },
    { key: "c", top: 700, bottom: -400 },
  ];

  it("ranks the tallest and deepest cells", () => {
    const result = envelope(extents, 2);
    expect(result.top).toBe(1200);
    expect(result.bottom).toBe(-400);
    expect(result.tallest.map((e) => e.key)).toEqual(["b", "a"]);
    expect(result.deepest.map((e) => e.key)).toEqual(["c", "a"]);
  });

  it("sizes the line box to hold both scripts", () => {
    expect(lineBox({ top: 760, bottom: -240 }, envelope(extents))).toEqual({
      top: 1200,
      bottom: -400,
      height: 1600,
    });
  });
});
