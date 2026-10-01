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
}

export interface MarkOffset {
  /** The mark glyph's position among the cell's marks, in logical order. */
  index: number;
  glyph: string;
  dx: number;
  dy: number;
}

export interface Override {
  key: CellKey;
  build: string;
  wght: number;
  marks: MarkOffset[];
  updated: string;
}

export const ANNOTATIONS_SCHEMA = "sawa-lab/annotations";
export const OVERRIDES_SCHEMA = "sawa-lab/overrides";
export const SCHEMA_VERSION = 1;

export interface AnnotationsFile {
  schema: typeof ANNOTATIONS_SCHEMA;
  version: number;
  notes: Note[];
}

export interface OverridesFile {
  schema: typeof OVERRIDES_SCHEMA;
  version: number;
  overrides: Override[];
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
  };
}

function parseOverride(value: unknown, where: string): Override {
  const raw = record(value, where);
  if (!Array.isArray(raw.marks)) throw new SchemaError(`${where}.marks: expected a list`);
  return {
    key: parseKey(raw.key, `${where}.key`),
    build: str(raw, "build", where),
    wght: num(raw, "wght", where),
    marks: raw.marks.map((m, i) => {
      const mark = record(m, `${where}.marks[${i}]`);
      const at = `${where}.marks[${i}]`;
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

function header(value: unknown, schema: string): Record<string, unknown> {
  const raw = record(value, "file");
  if (raw.schema !== schema) throw new SchemaError(`file: schema is not ${schema}`);
  if (raw.version !== SCHEMA_VERSION)
    throw new SchemaError(`file: unsupported version ${String(raw.version)}`);
  return raw;
}

export function annotationsFile(notes: Note[]): AnnotationsFile {
  return { schema: ANNOTATIONS_SCHEMA, version: SCHEMA_VERSION, notes };
}

export function overridesFile(overrides: Override[]): OverridesFile {
  return { schema: OVERRIDES_SCHEMA, version: SCHEMA_VERSION, overrides };
}

export function parseAnnotations(value: unknown): Note[] {
  const raw = header(value, ANNOTATIONS_SCHEMA);
  if (!Array.isArray(raw.notes)) throw new SchemaError("file.notes: expected a list");
  return raw.notes.map((note, i) => parseNote(note, `notes[${i}]`));
}

export function parseOverrides(value: unknown): Override[] {
  const raw = header(value, OVERRIDES_SCHEMA);
  if (!Array.isArray(raw.overrides)) throw new SchemaError("file.overrides: expected a list");
  return raw.overrides.map((entry, i) => parseOverride(entry, `overrides[${i}]`));
}

/** `incoming` laid over `current`: a note with a known id replaces it, the rest are added. */
export function mergeNotes(current: Note[], incoming: Note[]): Note[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const note of incoming) byId.set(note.id, note);
  return [...byId.values()];
}

export function mergeOverrides(current: Override[], incoming: Override[]): Override[] {
  const byKey = new Map(current.map((o) => [keyId(o.key), o]));
  for (const entry of incoming) byKey.set(keyId(entry.key), entry);
  return [...byKey.values()];
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

export function loadOverrides(): Override[] {
  return load(OVERRIDES_KEY, parseOverrides, []);
}

export function saveOverrides(overrides: Override[]): void {
  save(OVERRIDES_KEY, overridesFile(overrides));
}
