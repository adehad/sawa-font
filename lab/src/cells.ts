import { type Box, type Contour, bounds, inkGap, moveBox, translate, unionBox } from "./geometry";
import type { Form } from "./types";

export const ZWJ = 0x200d;

export interface ShapedGlyph {
  gid: number;
  cluster: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface Piece {
  gid: number;
  kind: "base" | "mark";
  /** Position among the cell's mark glyphs in logical order; -1 for the letter's own. */
  mark: number;
  x: number;
  y: number;
}

export interface Layout {
  pieces: Piece[];
  advance: number;
}

/** Offsets per mark glyph index, in font units. */
export type Offsets = Record<number, readonly [number, number]>;

export function parseCodepoint(spec: string): number {
  return Number.parseInt(spec.replace(/^U\+/i, ""), 16);
}

export function formatCodepoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The cell's codepoints: the letter, its marks, and ZWJ on the joining sides that force the form. */
export function cellCodepoints(letter: string, form: Form, marks: string[]): number[] {
  const before = form === "medial" || form === "final" ? [ZWJ] : [];
  const after = form === "initial" || form === "medial" ? [ZWJ] : [];
  return [...before, letter.codePointAt(0) ?? 0, ...marks.map(parseCodepoint), ...after];
}

/**
 * Places shaped glyphs (HarfBuzz's visual order) from x = 0 and splits them
 * into the letter's own glyphs and the marks. `bare` is the same letter in
 * the same form shaped without marks: each of its glyphs claims the matching
 * glyph nearest its own offset, dots and a hamza carrier's hamza included.
 * Clusters cannot make this split, since HarfBuzz merges them when it
 * reorders marks, as with damma after U+0623. A glyph `bare` lacks is a mark
 * unless `isBase` says the font classes it as a base or ligature.
 */
export function layout(
  glyphs: ShapedGlyph[],
  bare: ShapedGlyph[],
  isBase: (gid: number) => boolean = () => false,
): Layout {
  const claimed = new Set<number>();
  for (const own of bare) {
    let best = -1;
    let bestDistance = Infinity;
    glyphs.forEach((glyph, i) => {
      if (claimed.has(i) || glyph.gid !== own.gid) return;
      const distance =
        Math.abs(glyph.xOffset - own.xOffset) + Math.abs(glyph.yOffset - own.yOffset);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best >= 0) claimed.add(best);
  }
  let pen = 0;
  const placed: (Piece & { cluster: number; order: number })[] = [];
  glyphs.forEach((glyph, order) => {
    const isMark = !claimed.has(order) && !isBase(glyph.gid);
    placed.push({
      gid: glyph.gid,
      kind: isMark ? "mark" : "base",
      mark: -1,
      x: pen + glyph.xOffset,
      y: glyph.yOffset,
      cluster: glyph.cluster,
      order,
    });
    pen += glyph.xAdvance;
  });
  const marks = placed
    .filter((p) => p.kind === "mark")
    .toSorted((a, b) => a.cluster - b.cluster || b.order - a.order);
  marks.forEach((piece, index) => {
    piece.mark = index;
  });
  return {
    pieces: placed.map(({ gid, kind, mark, x, y }) => ({ gid, kind, mark, x, y })),
    advance: pen,
  };
}

export function pieceOffset(piece: Piece, offsets: Offsets): readonly [number, number] {
  return piece.kind === "mark" ? (offsets[piece.mark] ?? [0, 0]) : [0, 0];
}

export interface Analysis {
  /** Ink top and bottom in font units. */
  top: number;
  bottom: number;
  box: Box | null;
  /** Smallest clear distance from a mark's ink to any other ink; Infinity if none is near. */
  gap: number;
  clash: boolean;
  hasMarks: boolean;
}

export type Outline = (gid: number) => Contour[];

/** How far apart a pair can be and still count as near, in font units. */
export const GAP_LIMIT = 200;

export function analyse(
  cell: Layout,
  outline: Outline,
  offsets: Offsets,
  clearance: number,
): Analysis {
  const inked = cell.pieces
    .map((piece) => {
      const [dx, dy] = pieceOffset(piece, offsets);
      return { piece, contours: translate(outline(piece.gid), piece.x + dx, piece.y + dy) };
    })
    .filter(({ contours }) => contours.length > 0);
  let box: Box | null = null;
  for (const { contours } of inked) box = unionBox(box, bounds(contours));
  let gap = Infinity;
  inked.forEach((a, i) => {
    if (a.piece.kind !== "mark") return;
    inked.forEach((b, j) => {
      if (j === i || (b.piece.kind === "mark" && j < i)) return;
      gap = Math.min(gap, inkGap(a.contours, b.contours, GAP_LIMIT));
    });
  });
  const hasMarks = inked.some(({ piece }) => piece.kind === "mark");
  return {
    top: box?.y1 ?? 0,
    bottom: box?.y0 ?? 0,
    box,
    gap,
    clash: hasMarks && gap < clearance,
    hasMarks,
  };
}

/** The ink box of one piece with its offset applied. */
export function pieceBox(piece: Piece, outline: Outline, offsets: Offsets): Box | null {
  const box = bounds(outline(piece.gid));
  if (box === null) return null;
  const [dx, dy] = pieceOffset(piece, offsets);
  return moveBox(box, piece.x + dx, piece.y + dy);
}
