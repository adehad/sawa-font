/** How the font places marks, as `sawa lab fonts` writes it to positioning.json. */

export type LookupKind = "base" | "ligature" | "mark";

export interface MarkClass {
  /** The lookup and the class's index in it, "27.0". */
  id: string;
  /** For feature syntax, "top_27" or "mkmk_top_35". */
  name: string;
  position: "top" | "bottom" | "center";
  label: string;
  marks: string[];
}

export interface PosLookup {
  index: number;
  type: LookupKind;
  feature: string;
  flag: number;
  markFilteringSet?: number;
  classes: MarkClass[];
}

export interface AnchorPoint {
  lookup: number;
  class: string;
  x: number;
  y: number;
  component?: number;
}

export interface GlyphAnchorSet {
  base?: AnchorPoint[];
  ligature?: AnchorPoint[];
  mark2?: AnchorPoint[];
  mark?: AnchorPoint[];
}

export interface CellPositioning {
  glyphs: string[];
  /** Per glyph in visual order: [glyph index it hangs on, class id, kind], or null. */
  attach: ([number, string, LookupKind] | null)[];
}

export interface Positioning {
  lookups: PosLookup[];
  anchors: Record<string, GlyphAnchorSet>;
  alternates: Record<string, { lookup: number; feature: string; context?: string }>;
  /** Keyed "U+0628|medial|shadda-fatha". */
  cells: Record<string, CellPositioning>;
}

export const NO_POSITIONING: Positioning = { lookups: [], anchors: {}, alternates: {}, cells: {} };

/** What a mark hangs on: a glyph of the same run, through one class's anchors. */
export interface Attachment {
  parent: number;
  cls: string;
  kind: LookupKind;
}

export interface Placed {
  name: string;
  x: number;
  y: number;
  /** GDEF mark: split-off dots and tashkeel alike. */
  gdefMark: boolean;
}

export function lookupOf(cls: string): number {
  return Number.parseInt(cls.split(".")[0] ?? "", 10);
}

/**
 * For each glyph of a right-to-left run in visual order, what it is
 * attached to. HarfBuzz does not report it, but a mark attached through
 * an anchor pair lands exactly where the two anchors meet, and the last
 * lookup that explains its position is the one that set it. A glyph that
 * is not a mark, or that no anchor pair explains, gets null.
 */
export function attachments(
  pieces: readonly Placed[],
  anchors: Record<string, GlyphAnchorSet>,
): (Attachment | null)[] {
  const out: (Attachment | null)[] = pieces.map(() => null);
  for (let j = pieces.length - 1; j >= 0; j--) {
    const piece = pieces[j] as Placed;
    const own = anchors[piece.name]?.mark;
    if (!piece.gdefMark || !own) continue;
    let best: { lookup: number; distance: number; found: Attachment } | null = null;
    for (const mine of own) {
      for (let i = j + 1; i < pieces.length; i++) {
        const parent = pieces[i] as Placed;
        const set = anchors[parent.name];
        if (!set) continue;
        const pools: [LookupKind, AnchorPoint[] | undefined][] = [
          ["base", set.base],
          ["ligature", set.ligature],
          ["mark", set.mark2],
        ];
        for (const [kind, pool] of pools) {
          for (const anchor of pool ?? []) {
            if (anchor.class !== mine.class) continue;
            if (
              parent.x + anchor.x - mine.x !== piece.x ||
              parent.y + anchor.y - mine.y !== piece.y
            )
              continue;
            const distance = i - j;
            if (
              best === null ||
              mine.lookup > best.lookup ||
              (mine.lookup === best.lookup && distance < best.distance)
            )
              best = { lookup: mine.lookup, distance, found: { parent: i, cls: mine.class, kind } };
          }
        }
      }
    }
    out[j] = best?.found ?? null;
  }
  return out;
}

/** The class with `id`, and its lookup. */
export function markClass(
  positioning: Positioning,
  id: string,
): { lookup: PosLookup; cls: MarkClass } | undefined {
  const lookup = positioning.lookups.find((l) => l.index === lookupOf(id));
  const cls = lookup?.classes.find((c) => c.id === id);
  return lookup && cls ? { lookup, cls } : undefined;
}
