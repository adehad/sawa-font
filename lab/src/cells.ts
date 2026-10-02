import { type Box, type Contour, bounds, inkGap, translate, unionBox } from "./geometry";
import type { Attachment } from "./positioning";
import type { Form } from "./types";

export const ZWJ = 0x200d;

export interface ShapedGlyph {
  gid: number;
  cluster: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

/** What the lab needs to know about a glyph id beyond its outline. */
export interface GlyphFacts {
  /** GDEF base or ligature. */
  isBase(gid: number): boolean;
  /** GDEF mark: dots and tashkeel alike. */
  isMark(gid: number): boolean;
  name(gid: number): string;
}

export const PLAIN: GlyphFacts = {
  isBase: () => false,
  isMark: () => false,
  name: (gid) => `gid${gid}`,
};

export interface Piece {
  gid: number;
  name: string;
  /** "base" for the letter's own glyphs, its dots included; "mark" for the cell's marks. */
  kind: "base" | "mark";
  /** Position among the cell's mark glyphs in logical order; -1 for the letter's own. */
  mark: number;
  x: number;
  y: number;
  /** The piece this one attaches to: itself for a base, the base before it for a mark. */
  owner: number;
  /** A mark that comes straight after its base in logical order, as a split-off dot does. */
  adjacent: boolean;
  /** GDEF mark: split-off dots and tashkeel alike. */
  gdefMark: boolean;
}

export interface Layout {
  pieces: Piece[];
  advance: number;
}

export type Offset = readonly [number, number];

/** Offsets per mark glyph index, in font units. */
export type Offsets = Record<number, Offset>;

/** Where a piece is drawn relative to where the font puts it. */
export interface Placement {
  dx: number;
  dy: number;
  /** Offsets of dot groups drawn inside the piece's own glyph, by part id. */
  parts: Record<string, Offset>;
}

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
 * Each glyph's owner in right-to-left text given in visual order: a mark
 * belongs to the nearest glyph before it in logical order that is not a
 * mark, which is the nearest one after it visually.
 */
export function owners(attached: boolean[]): { owner: number; adjacent: boolean }[] {
  return attached.map((isMark, i) => {
    if (!isMark) return { owner: i, adjacent: false };
    let j = i + 1;
    while (j < attached.length && attached[j]) j++;
    const owner = j < attached.length ? j : -1;
    return { owner, adjacent: owner === i + 1 };
  });
}

/**
 * Places shaped glyphs (HarfBuzz's visual order) from x = 0 and splits them
 * into the letter's own glyphs and the marks. `bare` is the same letter in
 * the same form shaped without marks: each of its glyphs claims the matching
 * glyph nearest its own offset, dots and a hamza carrier's hamza included.
 * Clusters cannot make this split, since HarfBuzz merges them when it
 * reorders marks, as with damma after U+0623. A glyph `bare` lacks is a mark
 * unless the font classes it as a base or ligature.
 */
export function layout(glyphs: ShapedGlyph[], bare: ShapedGlyph[], facts = PLAIN): Layout {
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
  const kinds = glyphs.map((glyph, i) =>
    !claimed.has(i) && !facts.isBase(glyph.gid) ? ("mark" as const) : ("base" as const),
  );
  const attach = owners(glyphs.map((g, i) => facts.isMark(g.gid) || kinds[i] === "mark"));
  let pen = 0;
  const placed: (Piece & { cluster: number; order: number })[] = [];
  glyphs.forEach((glyph, order) => {
    placed.push({
      gid: glyph.gid,
      name: facts.name(glyph.gid),
      kind: kinds[order] ?? "base",
      mark: -1,
      x: pen + glyph.xOffset,
      y: glyph.yOffset,
      owner: attach[order]?.owner ?? order,
      adjacent: attach[order]?.adjacent ?? false,
      gdefMark: facts.isMark(glyph.gid),
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
    pieces: placed.map(({ cluster: _c, order: _o, ...piece }) => piece),
    advance: pen,
  };
}

/** A run of text placed as it is shaped, every glyph the text's own. */
export function lineLayout(glyphs: ShapedGlyph[], facts: GlyphFacts): Layout {
  const attach = owners(glyphs.map((g) => facts.isMark(g.gid)));
  let pen = 0;
  const pieces = glyphs.map((glyph, i): Piece => {
    const piece: Piece = {
      gid: glyph.gid,
      name: facts.name(glyph.gid),
      kind: "base",
      mark: -1,
      x: pen + glyph.xOffset,
      y: glyph.yOffset,
      owner: attach[i]?.owner ?? i,
      adjacent: attach[i]?.adjacent ?? false,
      gdefMark: facts.isMark(glyph.gid),
    };
    pen += glyph.xAdvance;
    return piece;
  });
  return { pieces, advance: pen };
}

/** How a set of edits moves glyph parts and marks, by glyph name and mark class id. */
export interface GlyphMoves {
  /** The glyph's outline, with its anchors. */
  body(glyph: string): Offset;
  /** A split-off dot's outline in the copy swapped in after `base`; its anchors stay. */
  dot(base: string, dot: string): Offset | undefined;
  /** Dot groups drawn inside `glyph`, by part id. */
  inline(glyph: string): Record<string, Offset>;
  /** The glyph's mark-to-base or mark-to-ligature anchor for a class. */
  anchor(glyph: string, cls: string): Offset;
  /** The glyph's own anchor for `mark` alone, split from the class. */
  split(glyph: string, cls: string, mark: string): Offset;
  /** The mark's mark-to-mark anchor for the class that stacks on it. */
  mkmk(glyph: string, cls: string): Offset;
  /** A contextual adjustment of `mark` after `base`. */
  pair(base: string, mark: string): Offset;
}

const ZERO: Offset = [0, 0];

export const NO_MOVES: GlyphMoves = {
  body: () => ZERO,
  dot: () => undefined,
  inline: () => ({}),
  anchor: () => ZERO,
  split: () => ZERO,
  mkmk: () => ZERO,
  pair: () => ZERO,
};

/**
 * The glyph a contextual pair rule for the mark at `i` sees before it: the
 * previous glyph in logical order, skipping marks other than this one, as
 * a mark filtering set of that mark alone does. Undefined when that is a
 * mark.
 */
export function contextBase(pieces: readonly Piece[], i: number): number | undefined {
  const name = pieces[i]?.name;
  let j = i + 1;
  while (j < pieces.length && pieces[j]?.gdefMark && pieces[j]?.name !== name) j++;
  return j < pieces.length && !pieces[j]?.gdefMark ? j : undefined;
}

/**
 * Where each piece goes, as HarfBuzz would place it in the edited font. A
 * base glyph moves with its outline. A mark hangs on what it is attached
 * to: it follows that glyph and the anchor it attaches by, which an outline
 * move, an anchor move, a split class or a mark-to-mark anchor shifts; the
 * marks stacked on it follow in turn. A pair rule and a moved split-off dot
 * come after attachment and move that one mark, except that HarfBuzz
 * (14.5) carries the x of a pair adjustment on to the marks stacked on it,
 * though not the y.
 */
export function placements(
  cell: Layout,
  attach: readonly (Attachment | null)[],
  moves: GlyphMoves,
): Placement[] {
  const pieces = cell.pieces;
  const origins: (Offset | undefined)[] = [];
  const pairOf = (i: number): Offset => {
    const base = contextBase(pieces, i);
    const before = base === undefined ? undefined : pieces[base];
    const piece = pieces[i];
    return before && piece?.gdefMark ? moves.pair(before.name, piece.name) : ZERO;
  };
  const origin = (i: number, depth: number): Offset => {
    const known = origins[i];
    if (known) return known;
    const link = attach[i];
    const parent = link ? pieces[link.parent] : undefined;
    let at = ZERO;
    if (link && parent && depth < pieces.length) {
      const [px, py] = origin(link.parent, depth + 1);
      const name = pieces[i]?.name ?? "";
      const carried = link.kind === "mark" ? pairOf(link.parent)[0] : 0;
      const shifts =
        link.kind === "mark"
          ? [moves.mkmk(parent.name, link.cls)]
          : [
              parent.gdefMark ? ZERO : moves.body(parent.name),
              moves.anchor(parent.name, link.cls),
              moves.split(parent.name, link.cls, name),
            ];
      at = shifts.reduce<Offset>((sum, [x, y]) => [sum[0] + x, sum[1] + y], [px + carried, py]);
    }
    origins[i] = at;
    return at;
  };
  return pieces.map((piece, i) => {
    if (!piece.gdefMark && !attach[i]) {
      const [dx, dy] = moves.body(piece.name);
      return { dx, dy, parts: moves.inline(piece.name) };
    }
    let [dx, dy] = origin(i, 0);
    const [px, py] = pairOf(i);
    dx += px;
    dy += py;
    const owner = piece.adjacent ? pieces[piece.owner] : undefined;
    const dot = owner ? moves.dot(owner.name, piece.name) : undefined;
    if (dot) {
      dx += dot[0];
      dy += dot[1];
    }
    return { dx, dy, parts: {} };
  });
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

/** One piece's outline, placed. */
export type Ink = (piece: Piece, placement: Placement) => Contour[];

/** An ink function over plain outlines, ignoring part offsets. */
export function plainInk(outline: (gid: number) => Contour[]): Ink {
  return (piece, placement) =>
    translate(outline(piece.gid), piece.x + placement.dx, piece.y + placement.dy);
}

/** How far apart a pair can be and still count as near, in font units. */
export const GAP_LIMIT = 200;

export function analyse(cell: Layout, ink: Ink, placed: Placement[], clearance: number): Analysis {
  const inked = cell.pieces
    .map((piece, i) => ({
      piece,
      contours: ink(piece, placed[i] ?? { dx: 0, dy: 0, parts: {} }),
    }))
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

/** The ink box of a layout with its placements. */
export function layoutBox(cell: Layout, ink: Ink, placed: Placement[]): Box | null {
  let box: Box | null = null;
  cell.pieces.forEach((piece, i) => {
    box = unionBox(box, bounds(ink(piece, placed[i] ?? { dx: 0, dy: 0, parts: {} })));
  });
  return box;
}
