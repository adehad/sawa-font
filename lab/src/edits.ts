import type { GlyphMoves, Offset } from "./cells";
import type { CellKey } from "./store";

export type { Offset } from "./cells";

/**
 * The font mechanism an edit becomes:
 * - outline: the glyph's outline in glyf, moved with its anchors (part "body"),
 *   or one dot group in it ("component:N", "contours:A,B", or a split-off dot
 *   glyph's name, which gets a derived copy swapped in after this base);
 * - anchor: the glyph's mark-to-base or mark-to-ligature anchor for one class;
 * - split-class: a separate anchor on the glyph for some marks of a class;
 * - pair: a contextual adjustment of one mark after one base glyph;
 * - mkmk-anchor: a mark's mark-to-mark anchor for the marks that stack on it.
 */
export type Target =
  | { mechanism: "outline"; glyph: string; part: string }
  | { mechanism: "anchor"; glyph: string; cls: string }
  | { mechanism: "split-class"; glyph: string; cls: string; marks: string[] }
  | { mechanism: "pair"; base: string; mark: string }
  | { mechanism: "mkmk-anchor"; glyph: string; cls: string };

export type Mechanism = Target["mechanism"] | "substitution";

/** How far an edit reaches, smallest first. */
export const SCOPES = ["pair", "mark-group", "mark-class", "outline", "all-forms"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  pair: "This pair only",
  "mark-group": "This mark group on this glyph",
  "mark-class": "All marks of this class on this glyph",
  outline: "This glyph's outline",
  "all-forms": "All forms",
};

export interface Edit {
  target: Target;
  scope: Scope;
  /** Font units at wght 400. */
  dx: number;
  dy: number;
  build: string;
  wght: number;
  /** The letter forms whose body is the edited glyph, as "beh initial", for reading the file. */
  usedBy: string[];
  updated: string;
}

/** A cell that needs a glyph of its own: a GSUB alternate the agent derives later. */
export interface AlternateRequest {
  key: CellKey;
  /** The cell's glyphs in visual order, as the font shapes it now. */
  glyphs: string[];
  reason: string;
  change: string;
  build: string;
  created: string;
}

export interface Edits {
  edits: Edit[];
  requests: AlternateRequest[];
}

export const NO_EDITS: Edits = { edits: [], requests: [] };

/** Who and what an edit is stamped with. */
export interface Stamp {
  build: string;
  wght: number;
  now: string;
  usedBy: (glyph: string) => string[];
}

export function targetId(target: Target): string {
  switch (target.mechanism) {
    case "outline":
      return `outline:${target.glyph}:${target.part}`;
    case "anchor":
      return `anchor:${target.glyph}:${target.cls}`;
    case "split-class":
      return `split-class:${target.glyph}:${target.cls}:${target.marks.toSorted().join("+")}`;
    case "pair":
      return `pair:${target.base}:${target.mark}`;
    default:
      return `mkmk-anchor:${target.glyph}:${target.cls}`;
  }
}

/** The glyph whose outline or anchors an edit changes. */
export function editedGlyph(target: Target): string {
  return target.mechanism === "pair" ? target.base : target.glyph;
}

export function offsetOf(edits: Edits, target: Target): Offset {
  const id = targetId(target);
  const found = edits.edits.find((e) => targetId(e.target) === id);
  return found ? [found.dx, found.dy] : [0, 0];
}

/** `edits` with `target` at `offset`; an edit back at (0, 0) is dropped. */
export function setOffset(
  edits: Edits,
  target: Target,
  scope: Scope,
  offset: Offset,
  stamp: Stamp,
): Edits {
  const [dx, dy] = [Math.round(offset[0]), Math.round(offset[1])];
  const id = targetId(target);
  const rest = edits.edits.filter((e) => targetId(e.target) !== id);
  if (dx === 0 && dy === 0) return { ...edits, edits: rest };
  const edit: Edit = {
    target,
    scope,
    dx,
    dy,
    build: stamp.build,
    wght: stamp.wght,
    usedBy: stamp.usedBy(editedGlyph(target)),
    updated: stamp.now,
  };
  return { ...edits, edits: [...rest, edit] };
}

/** Moves every target by the same delta from where `base` has it. */
export function moveBy(
  base: Edits,
  targets: readonly Target[],
  scope: Scope,
  delta: Offset,
  stamp: Stamp,
): Edits {
  let next = base;
  const seen = new Set<string>();
  for (const target of targets) {
    const id = targetId(target);
    if (seen.has(id)) continue;
    seen.add(id);
    const [x, y] = offsetOf(base, target);
    next = setOffset(next, target, scope, [x + delta[0], y + delta[1]], stamp);
  }
  return next;
}

export function reset(edits: Edits, targets: readonly Target[], stamp: Stamp): Edits {
  let next = edits;
  for (const target of targets) next = setOffset(next, target, "pair", [0, 0], stamp);
  return next;
}

/** `edits` with one alternate request for the cell, replacing any earlier one. */
export function request(edits: Edits, entry: AlternateRequest): Edits {
  const id = requestId(entry.key);
  return {
    ...edits,
    requests: [...edits.requests.filter((r) => requestId(r.key) !== id), entry],
  };
}

export function withdraw(edits: Edits, key: CellKey): Edits {
  const id = requestId(key);
  return { ...edits, requests: edits.requests.filter((r) => requestId(r.key) !== id) };
}

export function requestId(key: CellKey): string {
  return `${key.letter}|${key.form}|${key.marks.join("+")}`;
}

/** How a set of edits moves glyph parts and marks, looked up by glyph name. */
export function movesOf(edits: readonly Edit[]): GlyphMoves {
  const by = new Map<string, Offset>();
  const inline = new Map<string, Record<string, Offset>>();
  for (const edit of edits) {
    const t = edit.target;
    const at: Offset = [edit.dx, edit.dy];
    if (t.mechanism === "outline" && t.part.includes(":")) {
      inline.set(t.glyph, { ...inline.get(t.glyph), [t.part]: at });
    } else if (t.mechanism === "split-class") {
      for (const mark of t.marks) by.set(`split-class:${t.glyph}:${t.cls}:${mark}`, at);
    } else by.set(targetId(t), at);
  }
  const get = (id: string): Offset => by.get(id) ?? [0, 0];
  return {
    body: (glyph) => get(`outline:${glyph}:body`),
    dot: (base, dot) => by.get(`outline:${base}:${dot}`),
    inline: (glyph) => inline.get(glyph) ?? {},
    anchor: (glyph, cls) => get(`anchor:${glyph}:${cls}`),
    split: (glyph, cls, mark) => get(`split-class:${glyph}:${cls}:${mark}`),
    mkmk: (glyph, cls) => get(`mkmk-anchor:${glyph}:${cls}`),
    pair: (base, mark) => get(`pair:${base}:${mark}`),
  };
}

/** Undo and redo over whole edit snapshots, which are small. */
export class History {
  private past: Edits[] = [];
  private future: Edits[] = [];

  constructor(private readonly limit = 200) {}

  /** Records the state before an edit; a new edit clears what could be redone. */
  push(before: Edits): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Edits): Edits | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: Edits): Edits | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
