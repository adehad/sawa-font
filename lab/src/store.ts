import { FORMS, type Form } from "./types";

export const TAGS = [
  "too-small",
  "too-high",
  "too-low",
  "collides",
  "dot-spacing",
  "feels-heavy",
  "other",
] as const;
export type Tag = (typeof TAGS)[number];
export const TAG_LABELS: Record<Tag, string> = {
  "too-small": "too small",
  "too-high": "too high",
  "too-low": "too low",
  collides: "collides",
  "dot-spacing": "dot spacing",
  "feels-heavy": "feels heavy",
  other: "other",
};

export const STATUSES = ["open", "proposed", "accepted", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

export type Severity = 1 | 2 | 3;

/** One matrix cell: a letter in one form with a mark sequence (empty for the bare letter). */
export interface CellKey {
  letter: string;
  form: Form;
  marks: string[];
}

export const PART_KINDS = ["body", "dots", "mark"] as const;

/** The part of the cell a note is about, when it is about one. */
export interface NotePart {
  kind: (typeof PART_KINDS)[number];
  /** The glyph the part belongs to: the letter's body glyph, or the mark glyph. */
  glyph: string;
  /** A dot group's part id. */
  id?: string;
  /** A mark's position among the cell's marks. */
  index?: number;
}

export interface Note {
  id: string;
  key: CellKey;
  build: string;
  font: "calib" | "source";
  /** The pinned point in font units, relative to the cell's origin. */
  x: number;
  y: number;
  tag: Tag;
  severity: Severity;
  text: string;
  status: Status;
  created: string;
  part?: NotePart;
}

export interface MarkOffset {
  /** The mark glyph's position among the cell's marks, in logical order. */
  index: number;
  glyph: string;
  dx: number;
  dy: number;
}

/** Marks moved in one cell only: each mark in its context. */
export interface Override {
  key: CellKey;
  /** The cell's body glyph, for reading the file. */
  glyph?: string;
  build: string;
  wght: number;
  marks: MarkOffset[];
  updated: string;
}

export interface DotOffset {
  /** The dot group's part id from lab.json. */
  part: string;
  dx: number;
  dy: number;
}

/** A glyph moved wherever the font uses it: its body, and its dot groups on their own. */
export interface GlyphOverride {
  glyph: string;
  /** The letter forms that use the glyph, as "beh initial", for reading the file. */
  usedBy: string[];
  build: string;
  wght: number;
  body: { dx: number; dy: number };
  dots: DotOffset[];
  updated: string;
}

export interface Overrides {
  glyphs: GlyphOverride[];
  marks: Override[];
}

export const NO_OVERRIDES: Overrides = { glyphs: [], marks: [] };

export const ANNOTATIONS_SCHEMA = "sawa-lab/annotations";
export const OVERRIDES_SCHEMA = "sawa-lab/overrides";
export const ANNOTATIONS_VERSION = 1;
export const OVERRIDES_VERSION = 2;

export interface AnnotationsFile {
  schema: typeof ANNOTATIONS_SCHEMA;
  version: number;
  notes: Note[];
}

export interface OverridesFile {
  schema: typeof OVERRIDES_SCHEMA;
  version: typeof OVERRIDES_VERSION;
  glyphs: GlyphOverride[];
  marks: Override[];
}

export class SchemaError extends Error {}

export function keyId(key: CellKey): string {
  return `${key.letter}|${key.form}|${key.marks.join("+")}`;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SchemaError(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(`${where}: expected a list`);
  return value;
}

function str(raw: Record<string, unknown>, field: string, where: string): string {
  const value = raw[field];
  if (typeof value !== "string") throw new SchemaError(`${where}.${field}: expected a string`);
  return value;
}

function num(raw: Record<string, unknown>, field: string, where: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SchemaError(`${where}.${field}: expected a number`);
  }
  return value;
}

function oneOf<T extends string>(
  raw: Record<string, unknown>,
  field: string,
  options: readonly T[],
  where: string,
): T {
  const value = str(raw, field, where);
  if (!options.includes(value as T)) {
    throw new SchemaError(`${where}.${field}: expected one of ${options.join(", ")}`);
  }
  return value as T;
}

function parseKey(value: unknown, where: string): CellKey {
  const raw = record(value, where);
  const marks = raw.marks;
  if (
    !Array.isArray(marks) ||
    !marks.every((m) => typeof m === "string" && /^U\+[0-9A-F]{4,6}$/.test(m))
  ) {
    throw new SchemaError(`${where}.marks: expected a list of U+XXXX codepoints`);
  }
  const letter = str(raw, "letter", where);
  if (!/^U\+[0-9A-F]{4,6}$/.test(letter)) throw new SchemaError(`${where}.letter: expected U+XXXX`);
  return { letter, form: oneOf(raw, "form", FORMS, where), marks: marks as string[] };
}

function parsePart(value: unknown, where: string): NotePart {
  const raw = record(value, where);
  return {
    kind: oneOf(raw, "kind", PART_KINDS, where),
    glyph: str(raw, "glyph", where),
    ...(raw.id === undefined ? {} : { id: str(raw, "id", where) }),
    ...(raw.index === undefined ? {} : { index: num(raw, "index", where) }),
  };
}

function parseNote(value: unknown, where: string): Note {
  const raw = record(value, where);
  const severity = num(raw, "severity", where);
  if (severity !== 1 && severity !== 2 && severity !== 3) {
    throw new SchemaError(`${where}.severity: expected 1, 2 or 3`);
  }
  return {
    id: str(raw, "id", where),
    key: parseKey(raw.key, `${where}.key`),
    build: str(raw, "build", where),
    font: oneOf(raw, "font", ["calib", "source"] as const, where),
    x: num(raw, "x", where),
    y: num(raw, "y", where),
    tag: oneOf(raw, "tag", TAGS, where),
    severity,
    text: str(raw, "text", where),
    status: oneOf(raw, "status", STATUSES, where),
    created: str(raw, "created", where),
    ...(raw.part === undefined ? {} : { part: parsePart(raw.part, `${where}.part`) }),
  };
}

function parseOverride(value: unknown, where: string): Override {
  const raw = record(value, where);
  return {
    key: parseKey(raw.key, `${where}.key`),
    ...(raw.glyph === undefined ? {} : { glyph: str(raw, "glyph", where) }),
    build: str(raw, "build", where),
    wght: num(raw, "wght", where),
    marks: list(raw.marks, `${where}.marks`).map((m, i) => {
      const at = `${where}.marks[${i}]`;
      const mark = record(m, at);
      return {
        index: num(mark, "index", at),
        glyph: str(mark, "glyph", at),
        dx: num(mark, "dx", at),
        dy: num(mark, "dy", at),
      };
    }),
    updated: str(raw, "updated", where),
  };
}

function parseGlyphOverride(value: unknown, where: string): GlyphOverride {
  const raw = record(value, where);
  const body = record(raw.body, `${where}.body`);
  const usedBy = list(raw.usedBy ?? [], `${where}.usedBy`);
  if (!usedBy.every((u) => typeof u === "string"))
    throw new SchemaError(`${where}.usedBy: expected a list of strings`);
  return {
    glyph: str(raw, "glyph", where),
    usedBy,
    build: str(raw, "build", where),
    wght: num(raw, "wght", where),
    body: { dx: num(body, "dx", `${where}.body`), dy: num(body, "dy", `${where}.body`) },
    dots: list(raw.dots, `${where}.dots`).map((d, i) => {
      const at = `${where}.dots[${i}]`;
      const dot = record(d, at);
      return { part: str(dot, "part", at), dx: num(dot, "dx", at), dy: num(dot, "dy", at) };
    }),
    updated: str(raw, "updated", where),
  };
}

function header(value: unknown, schema: string, versions: number[]): Record<string, unknown> {
  const raw = record(value, "file");
  if (raw.schema !== schema) throw new SchemaError(`file: schema is not ${schema}`);
  if (typeof raw.version !== "number" || !versions.includes(raw.version))
    throw new SchemaError(`file: unsupported version ${String(raw.version)}`);
  return raw;
}

export function annotationsFile(notes: Note[]): AnnotationsFile {
  return { schema: ANNOTATIONS_SCHEMA, version: ANNOTATIONS_VERSION, notes };
}

export function overridesFile(overrides: Overrides): OverridesFile {
  return {
    schema: OVERRIDES_SCHEMA,
    version: OVERRIDES_VERSION,
    glyphs: overrides.glyphs.toSorted((a, b) => a.glyph.localeCompare(b.glyph)),
    marks: overrides.marks,
  };
}

export function parseAnnotations(value: unknown): Note[] {
  const raw = header(value, ANNOTATIONS_SCHEMA, [ANNOTATIONS_VERSION]);
  return list(raw.notes, "file.notes").map((note, i) => parseNote(note, `notes[${i}]`));
}

/** Reads version 2, and version 1, whose cell-keyed mark offsets become `marks`. */
export function parseOverrides(value: unknown): Overrides {
  const raw = header(value, OVERRIDES_SCHEMA, [1, OVERRIDES_VERSION]);
  if (raw.version === 1) {
    return {
      glyphs: [],
      marks: list(raw.overrides, "file.overrides").map((entry, i) =>
        parseOverride(entry, `overrides[${i}]`),
      ),
    };
  }
  return {
    glyphs: list(raw.glyphs, "file.glyphs").map((entry, i) =>
      parseGlyphOverride(entry, `glyphs[${i}]`),
    ),
    marks: list(raw.marks, "file.marks").map((entry, i) => parseOverride(entry, `marks[${i}]`)),
  };
}

/** `incoming` laid over `current`: a note with a known id replaces it, the rest are added. */
export function mergeNotes(current: Note[], incoming: Note[]): Note[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const note of incoming) byId.set(note.id, note);
  return [...byId.values()];
}

/** `incoming` laid over `current`: an entry for a known glyph or cell replaces the stored one. */
export function mergeOverrides(current: Overrides, incoming: Overrides): Overrides {
  const glyphs = new Map(current.glyphs.map((o) => [o.glyph, o]));
  for (const entry of incoming.glyphs) glyphs.set(entry.glyph, entry);
  const marks = new Map(current.marks.map((o) => [keyId(o.key), o]));
  for (const entry of incoming.marks) marks.set(keyId(entry.key), entry);
  return { glyphs: [...glyphs.values()], marks: [...marks.values()] };
}

const NOTES_KEY = "sawa-lab:annotations";
const OVERRIDES_KEY = "sawa-lab:overrides";

/** Storage can be missing or throw in a private window; the lab then starts empty. */
function load<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? parse(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked; export still works.
  }
}

export function loadNotes(): Note[] {
  return load(NOTES_KEY, parseAnnotations, []);
}

export function saveNotes(notes: Note[]): void {
  save(NOTES_KEY, annotationsFile(notes));
}

export function loadOverrides(): Overrides {
  return load(OVERRIDES_KEY, parseOverrides, NO_OVERRIDES);
}

export function saveOverrides(overrides: Overrides): void {
  save(OVERRIDES_KEY, overridesFile(overrides));
}
