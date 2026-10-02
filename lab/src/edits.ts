import { type CellKey, type GlyphOverride, type Override, type Overrides, keyId } from "./store";

/** What a drag or a numeric field moves. */
export type PartRef =
  | { kind: "body"; glyph: string }
  | { kind: "dots"; glyph: string; part: string }
  | { kind: "mark"; key: CellKey; index: number; glyph: string; base?: string };

export type Offset = readonly [number, number];

/** Who and what an edit is stamped with. */
export interface Stamp {
  build: string;
  wght: number;
  now: string;
  /** The letter forms that use a glyph, as "beh initial". */
  usedBy: (glyph: string) => string[];
}

export function refId(ref: PartRef): string {
  if (ref.kind === "body") return `body:${ref.glyph}`;
  if (ref.kind === "dots") return `dots:${ref.glyph}:${ref.part}`;
  return `mark:${keyId(ref.key)}:${ref.index}`;
}

export function offsetOf(overrides: Overrides, ref: PartRef): Offset {
  if (ref.kind === "mark") {
    const entry = overrides.marks.find((o) => keyId(o.key) === keyId(ref.key));
    const mark = entry?.marks.find((m) => m.index === ref.index);
    return mark ? [mark.dx, mark.dy] : [0, 0];
  }
  const entry = overrides.glyphs.find((o) => o.glyph === ref.glyph);
  if (!entry) return [0, 0];
  if (ref.kind === "body") return [entry.body.dx, entry.body.dy];
  const dot = entry.dots.find((d) => d.part === ref.part);
  return dot ? [dot.dx, dot.dy] : [0, 0];
}

function isMoved(entry: GlyphOverride): boolean {
  return entry.body.dx !== 0 || entry.body.dy !== 0 || entry.dots.length > 0;
}

/** `overrides` with the part at `offset`; an entry left with nothing moved is dropped. */
export function setOffset(
  overrides: Overrides,
  ref: PartRef,
  offset: Offset,
  stamp: Stamp,
): Overrides {
  const [dx, dy] = [Math.round(offset[0]), Math.round(offset[1])];
  if (ref.kind === "mark") {
    const id = keyId(ref.key);
    const current = overrides.marks.find((o) => keyId(o.key) === id);
    const others = (current?.marks ?? []).filter((m) => m.index !== ref.index);
    const marks =
      dx === 0 && dy === 0 ? others : [...others, { index: ref.index, glyph: ref.glyph, dx, dy }];
    const rest = overrides.marks.filter((o) => keyId(o.key) !== id);
    if (marks.length === 0) return { ...overrides, marks: rest };
    const entry: Override = {
      key: ref.key,
      ...(ref.base ? { glyph: ref.base } : {}),
      build: stamp.build,
      wght: stamp.wght,
      marks: marks.toSorted((a, b) => a.index - b.index),
      updated: stamp.now,
    };
    return { ...overrides, marks: [...rest, entry] };
  }
  const current = overrides.glyphs.find((o) => o.glyph === ref.glyph);
  const entry: GlyphOverride = {
    glyph: ref.glyph,
    usedBy: stamp.usedBy(ref.glyph),
    build: stamp.build,
    wght: stamp.wght,
    body: current?.body ?? { dx: 0, dy: 0 },
    dots: current?.dots ?? [],
    updated: stamp.now,
  };
  if (ref.kind === "body") entry.body = { dx, dy };
  else {
    const others = entry.dots.filter((d) => d.part !== ref.part);
    entry.dots = dx === 0 && dy === 0 ? others : [...others, { part: ref.part, dx, dy }];
  }
  const rest = overrides.glyphs.filter((o) => o.glyph !== ref.glyph);
  return { ...overrides, glyphs: isMoved(entry) ? [...rest, entry] : rest };
}

/** Moves every ref by the same delta from where `base` has it. */
export function moveBy(base: Overrides, refs: PartRef[], delta: Offset, stamp: Stamp): Overrides {
  let next = base;
  const seen = new Set<string>();
  for (const ref of refs) {
    const id = refId(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    const [x, y] = offsetOf(base, ref);
    next = setOffset(next, ref, [x + delta[0], y + delta[1]], stamp);
  }
  return next;
}

export function resetPart(overrides: Overrides, ref: PartRef, stamp: Stamp): Overrides {
  return setOffset(overrides, ref, [0, 0], stamp);
}

/** Undo and redo over whole override snapshots, which are small. */
export class History {
  private past: Overrides[] = [];
  private future: Overrides[] = [];

  constructor(private readonly limit = 200) {}

  /** Records the state before an edit; a new edit clears what could be redone. */
  push(before: Overrides): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Overrides): Overrides | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: Overrides): Overrides | null {
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
