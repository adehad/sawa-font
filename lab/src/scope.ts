import { type GlyphMoves, type Layout, type Placement, placements } from "./cells";
import { SCOPE_LABELS, type Scope, type Target, movesOf } from "./edits";
import type { Attachment } from "./positioning";

/** What a handle in the inspector stands for. */
export type Handle =
  | { kind: "body"; glyph: string }
  /** A dot group: drawn inside the body glyph, or a glyph of its own attached to it. */
  | {
      kind: "dots";
      glyph: string;
      part: string;
      inline: boolean;
      attach: { parent: string; cls: string } | null;
      context: string | null;
    }
  /** A mark of the cell, with what it hangs on and the base a pair rule would see. */
  | {
      kind: "mark";
      mark: string;
      attach: { parent: string; cls: string; kind: Attachment["kind"] } | null;
      context: string | null;
    }
  /** A base glyph's anchor for one class, with the cell's marks that hang on it. */
  | { kind: "anchor"; glyph: string; cls: string; group: string[] }
  /** A mark's mark-to-mark anchor for the class that stacks on it. */
  | { kind: "mkmk"; glyph: string; cls: string };

export interface ScopeOption {
  scope: Scope;
  label: string;
  /** What the edit moves; the first is the one whose offset the fields show. */
  targets: Target[];
}

/**
 * The scopes an edit of `handle` can take, smallest first, so the first is
 * the default. `allForms` gives the same part in every form of the letter.
 */
function option(scope: Scope, targets: Target[]): ScopeOption {
  return { scope, label: SCOPE_LABELS[scope], targets };
}

export function scopeOptions(
  handle: Handle,
  allForms: (target: Target) => Target[] = (t) => [t],
): ScopeOption[] {
  const outline = (glyph: string, part: string): ScopeOption[] => {
    const target: Target = { mechanism: "outline", glyph, part };
    const linked = allForms(target);
    return [
      option("outline", [target]),
      ...(linked.length > 1 ? [option("all-forms", linked)] : []),
    ];
  };
  switch (handle.kind) {
    case "body":
      return outline(handle.glyph, "body");
    case "dots": {
      if (handle.inline) return outline(handle.glyph, handle.part);
      const out: ScopeOption[] = [];
      if (handle.context)
        out.push(option("pair", [{ mechanism: "pair", base: handle.context, mark: handle.part }]));
      if (handle.attach) {
        const { parent, cls } = handle.attach;
        out.push(
          option("mark-group", [
            { mechanism: "split-class", glyph: parent, cls, marks: [handle.part] },
          ]),
          option("mark-class", [{ mechanism: "anchor", glyph: parent, cls }]),
        );
      }
      return [...out, ...outline(handle.glyph, handle.part)];
    }
    case "mark": {
      const out: ScopeOption[] = [];
      if (handle.context)
        out.push(option("pair", [{ mechanism: "pair", base: handle.context, mark: handle.mark }]));
      const link = handle.attach;
      if (link && link.kind === "mark")
        out.push(
          option("mark-class", [{ mechanism: "mkmk-anchor", glyph: link.parent, cls: link.cls }]),
        );
      else if (link)
        out.push(
          option("mark-group", [
            { mechanism: "split-class", glyph: link.parent, cls: link.cls, marks: [handle.mark] },
          ]),
          option("mark-class", [{ mechanism: "anchor", glyph: link.parent, cls: link.cls }]),
        );
      return out;
    }
    case "anchor":
      return [
        ...(handle.group.length
          ? [
              option("mark-group", [
                {
                  mechanism: "split-class",
                  glyph: handle.glyph,
                  cls: handle.cls,
                  marks: handle.group.toSorted(),
                },
              ]),
            ]
          : []),
        option("mark-class", [{ mechanism: "anchor", glyph: handle.glyph, cls: handle.cls }]),
      ];
    default:
      return [
        option("mark-class", [{ mechanism: "mkmk-anchor", glyph: handle.glyph, cls: handle.cls }]),
      ];
  }
}

/** One cell as the blast radius sees it. */
export interface Shaped {
  id: string;
  layout: Layout;
  attach: readonly (Attachment | null)[];
}

function moved(placed: Placement[]): boolean {
  return placed.some(
    (p) =>
      p.dx !== 0 || p.dy !== 0 || Object.values(p.parts).some(([dx, dy]) => dx !== 0 || dy !== 0),
  );
}

/** Moves every target by one unit each way, to see what they reach. */
export function probe(targets: readonly Target[]): GlyphMoves {
  return movesOf(
    targets.map((target) => ({
      target,
      scope: "pair",
      dx: 1,
      dy: 1,
      build: "",
      wght: 400,
      usedBy: [],
      updated: "",
    })),
  );
}

/** The ids of the cells an edit of `targets` changes. */
export function blastRadius(targets: readonly Target[], cells: Iterable<Shaped>): string[] {
  const moves = probe(targets);
  const out: string[] = [];
  for (const cell of cells)
    if (moved(placements(cell.layout, cell.attach, moves))) out.push(cell.id);
  return out;
}
