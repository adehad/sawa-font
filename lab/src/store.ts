import {
  type AlternateRequest,
  type Edit,
  type Edits,
  NO_EDITS,
  SCOPES,
  type Scope,
  type Target,
  requestId,
  targetId,
} from "./edits";
import { lookupOf } from "./positioning";
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

export const ANNOTATIONS_SCHEMA = "sawa-lab/annotations";
export const OVERRIDES_SCHEMA = "sawa-lab/overrides";
export const ANNOTATIONS_VERSION = 1;
export const OVERRIDES_VERSION = 3;
/** The master the lab edits at; the others are listed, empty, for the build to fill. */
export const MASTERS = ["400", "700"] as const;

export interface AnnotationsFile {
  schema: typeof ANNOTATIONS_SCHEMA;
  version: number;
  notes: Note[];
}

/** One edit as overrides.json holds it. */
export interface EditEntry {
  id: string;
  mechanism: Target["mechanism"];
  scope: Scope;
  target: Record<string, unknown>;
  /** The GPOS lookup the rule lands in: an existing one, "new" for one appended after the mark lookups, or null for glyf. */
  lookup: number | "new" | null;
  /** Font units per master; only the lab's master is filled. */
  values: Record<string, { dx: number; dy: number } | null>;
  rule?: { text: string; fea: string };
  usedBy: string[];
  build: string;
  updated: string;
}

export interface RequestEntry {
  id: string;
  mechanism: "substitution";
  scope: "cell";
  target: { key: CellKey; glyphs: string[] };
  reason: string;
  change: string;
  build: string;
  created: string;
}

export interface OverridesFile {
  schema: typeof OVERRIDES_SCHEMA;
  version: typeof OVERRIDES_VERSION;
  edits: EditEntry[];
  requests: RequestEntry[];
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

function targetJson(target: Target): Record<string, unknown> {
  switch (target.mechanism) {
    case "outline":
      return { glyph: target.glyph, part: target.part };
    case "anchor":
    case "mkmk-anchor":
      return { glyph: target.glyph, class: target.cls };
    case "split-class":
      return { glyph: target.glyph, class: target.cls, marks: target.marks };
    default:
      return { base: target.base, mark: target.mark };
  }
}

function parseTarget(mechanism: string, value: unknown, where: string): Target {
  const raw = record(value, where);
  const glyph = () => str(raw, "glyph", where);
  const cls = () => {
    const id = str(raw, "class", where);
    if (!/^\d+\.\d+$/.test(id))
      throw new SchemaError(`${where}.class: expected a class id like 27.0`);
    return id;
  };
  switch (mechanism) {
    case "outline":
      return { mechanism, glyph: glyph(), part: str(raw, "part", where) };
    case "anchor":
    case "mkmk-anchor":
      return { mechanism, glyph: glyph(), cls: cls() };
    case "split-class": {
      const marks = list(raw.marks, `${where}.marks`);
      if (!marks.length || !marks.every((m) => typeof m === "string"))
        throw new SchemaError(`${where}.marks: expected a list of glyph names`);
      return { mechanism, glyph: glyph(), cls: cls(), marks };
    }
    case "pair":
      return { mechanism, base: str(raw, "base", where), mark: str(raw, "mark", where) };
    default:
      throw new SchemaError(`${where}: unknown mechanism ${mechanism}`);
  }
}

function strings(value: unknown, where: string): string[] {
  const items = list(value ?? [], where);
  if (!items.every((u) => typeof u === "string"))
    throw new SchemaError(`${where}: expected a list of strings`);
  return items;
}

function parseEdit(value: unknown, where: string): Edit {
  const raw = record(value, where);
  const mechanism = str(raw, "mechanism", where);
  const values = record(raw.values, `${where}.values`);
  const at = record(values["400"], `${where}.values.400`);
  return {
    target: parseTarget(mechanism, raw.target, `${where}.target`),
    scope: oneOf(raw, "scope", SCOPES, where),
    dx: num(at, "dx", `${where}.values.400`),
    dy: num(at, "dy", `${where}.values.400`),
    build: str(raw, "build", where),
    wght: 400,
    usedBy: strings(raw.usedBy, `${where}.usedBy`),
    updated: str(raw, "updated", where),
  };
}

function parseRequest(value: unknown, where: string): AlternateRequest {
  const raw = record(value, where);
  const target = record(raw.target, `${where}.target`);
  return {
    key: parseKey(target.key, `${where}.target.key`),
    glyphs: strings(target.glyphs, `${where}.target.glyphs`),
    reason: str(raw, "reason", where),
    change: str(raw, "change", where),
    build: str(raw, "build", where),
    created: str(raw, "created", where),
  };
}

/**
 * Version 2 glyph entries become outline edits. A cell's mark offsets, in
 * versions 1 and 2, become pair rules on the cell's body glyph: the
 * smallest rule a font can hold, which reaches every cell with that body
 * and mark. `bodyOf` names the body glyph when the entry does not.
 */
function migrate(
  raw: Record<string, unknown>,
  bodyOf: (key: CellKey) => string | undefined,
): Edits {
  const edits: Edit[] = [];
  const glyphs = raw.version === 2 ? list(raw.glyphs, "file.glyphs") : [];
  glyphs.forEach((value, i) => {
    const where = `glyphs[${i}]`;
    const entry = record(value, where);
    const glyph = str(entry, "glyph", where);
    const stamp = {
      build: str(entry, "build", where),
      wght: 400,
      usedBy: strings(entry.usedBy, `${where}.usedBy`),
      updated: str(entry, "updated", where),
    };
    const body = record(entry.body, `${where}.body`);
    const moves: [string, number, number][] = [
      ["body", num(body, "dx", `${where}.body`), num(body, "dy", `${where}.body`)],
      ...list(entry.dots, `${where}.dots`).map((d, j): [string, number, number] => {
        const at = `${where}.dots[${j}]`;
        const dot = record(d, at);
        return [str(dot, "part", at), num(dot, "dx", at), num(dot, "dy", at)];
      }),
    ];
    for (const [part, dx, dy] of moves)
      if (dx || dy)
        edits.push({
          target: { mechanism: "outline", glyph, part },
          scope: "outline",
          dx,
          dy,
          ...stamp,
        });
  });
  const cells = list(raw.version === 1 ? raw.overrides : raw.marks, "file.marks");
  cells.forEach((value, i) => {
    const where = `marks[${i}]`;
    const entry = record(value, where);
    const key = parseKey(entry.key, `${where}.key`);
    const body = entry.glyph === undefined ? bodyOf(key) : str(entry, "glyph", where);
    if (!body) return;
    for (const [j, m] of list(entry.marks, `${where}.marks`).entries()) {
      const at = `${where}.marks[${j}]`;
      const mark = record(m, at);
      const dx = num(mark, "dx", at);
      const dy = num(mark, "dy", at);
      if (!dx && !dy) continue;
      edits.push({
        target: { mechanism: "pair", base: body, mark: str(mark, "glyph", at) },
        scope: "pair",
        dx,
        dy,
        build: str(entry, "build", where),
        wght: 400,
        usedBy: [],
        updated: str(entry, "updated", where),
      });
    }
  });
  const byId = new Map(edits.map((e) => [targetId(e.target), e]));
  return { edits: [...byId.values()], requests: [] };
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

/** The GPOS lookup an edit's rule lands in. */
export function lookupFor(target: Target): number | "new" | null {
  if (target.mechanism === "outline") return null;
  if (target.mechanism === "pair") return "new";
  return lookupOf(target.cls);
}

export function overridesFile(
  edits: Edits,
  rule?: (edit: Edit) => { text: string; fea: string },
): OverridesFile {
  return {
    schema: OVERRIDES_SCHEMA,
    version: OVERRIDES_VERSION,
    edits: edits.edits
      .toSorted((a, b) => targetId(a.target).localeCompare(targetId(b.target)))
      .map((edit) => {
        const entry: EditEntry = {
          id: targetId(edit.target),
          mechanism: edit.target.mechanism,
          scope: edit.scope,
          target: targetJson(edit.target),
          lookup: lookupFor(edit.target),
          values: Object.fromEntries(
            MASTERS.map((m) => [m, m === "400" ? { dx: edit.dx, dy: edit.dy } : null]),
          ),
          usedBy: edit.usedBy,
          build: edit.build,
          updated: edit.updated,
        };
        if (rule) entry.rule = rule(edit);
        return entry;
      }),
    requests: edits.requests.map((r) => ({
      id: requestId(r.key),
      mechanism: "substitution",
      scope: "cell",
      target: { key: r.key, glyphs: r.glyphs },
      reason: r.reason,
      change: r.change,
      build: r.build,
      created: r.created,
    })),
  };
}

export function parseAnnotations(value: unknown): Note[] {
  const raw = header(value, ANNOTATIONS_SCHEMA, [ANNOTATIONS_VERSION]);
  return list(raw.notes, "file.notes").map((note, i) => parseNote(note, `notes[${i}]`));
}

/**
 * Reads version 3, and migrates versions 1 and 2. `bodyOf` names a cell's
 * body glyph for old mark offsets that do not.
 */
export function parseOverrides(
  value: unknown,
  bodyOf: (key: CellKey) => string | undefined = () => undefined,
): Edits {
  const raw = header(value, OVERRIDES_SCHEMA, [1, 2, OVERRIDES_VERSION]);
  if (raw.version !== OVERRIDES_VERSION) return migrate(raw, bodyOf);
  return {
    edits: list(raw.edits, "file.edits").map((entry, i) => parseEdit(entry, `edits[${i}]`)),
    requests: list(raw.requests ?? [], "file.requests").map((entry, i) =>
      parseRequest(entry, `requests[${i}]`),
    ),
  };
}

/** `incoming` laid over `current`: a note with a known id replaces it, the rest are added. */
export function mergeNotes(current: Note[], incoming: Note[]): Note[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const note of incoming) byId.set(note.id, note);
  return [...byId.values()];
}

/** `incoming` laid over `current`: an edit of a known target, or a request for a known cell, replaces the stored one. */
export function mergeOverrides(current: Edits, incoming: Edits): Edits {
  const edits = new Map(current.edits.map((e) => [targetId(e.target), e]));
  for (const entry of incoming.edits) edits.set(targetId(entry.target), entry);
  const requests = new Map(current.requests.map((r) => [requestId(r.key), r]));
  for (const entry of incoming.requests) requests.set(requestId(entry.key), entry);
  return { edits: [...edits.values()], requests: [...requests.values()] };
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

export function loadOverrides(bodyOf: (key: CellKey) => string | undefined): Edits {
  return load(OVERRIDES_KEY, (value) => parseOverrides(value, bodyOf), NO_EDITS);
}

export function saveOverrides(edits: Edits): void {
  save(OVERRIDES_KEY, overridesFile(edits));
}
