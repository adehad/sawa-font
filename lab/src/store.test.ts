import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, parseState, serializeState } from "./state";
import {
  type GlyphOverride,
  NO_OVERRIDES,
  type Note,
  type Override,
  SchemaError,
  mergeOverrides,
  annotationsFile,
  mergeNotes,
  overridesFile,
  parseAnnotations,
  parseOverrides,
} from "./store";
import { summary } from "./summary";

const NOTE: Note = {
  id: "n1",
  key: { letter: "U+0623", form: "isolated", marks: ["U+064F"] },
  build: "sans-400-1.15-abc",
  font: "calib",
  x: 120,
  y: 1310,
  tag: "too-high",
  severity: 2,
  text: "Hamza and damma stack above the cap height",
  status: "open",
  created: "2026-10-01T09:00:00.000Z",
};

const OVERRIDE: Override = {
  key: { letter: "U+0628", form: "medial", marks: ["U+0651", "U+064E"] },
  build: "sans-400-1.15-abc",
  wght: 400,
  marks: [
    { index: 0, glyph: "uni0651", dx: 0, dy: -40 },
    { index: 1, glyph: "uni064E", dx: 12, dy: 0 },
  ],
  updated: "2026-10-01T09:05:00.000Z",
};

const GLYPH: GlyphOverride = {
  glyph: "uni066E.init",
  usedBy: ["beh initial", "noon initial"],
  build: "sans-400-1.15-abc",
  wght: 400,
  body: { dx: 0, dy: 40 },
  dots: [{ part: "dotbelowar", dx: 0, dy: -20 }],
  updated: "2026-10-02T09:00:00.000Z",
};

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("annotations and overrides", () => {
  it("round-trips through JSON", () => {
    expect(parseAnnotations(roundTrip(annotationsFile([NOTE])))).toEqual([NOTE]);
    const overrides = { glyphs: [GLYPH], marks: [OVERRIDE] };
    expect(parseOverrides(roundTrip(overridesFile(overrides)))).toEqual(overrides);
  });

  it("reads a version 1 overrides file into the mark offsets", () => {
    const v1 = { schema: "sawa-lab/overrides", version: 1, overrides: [OVERRIDE] };
    expect(parseOverrides(roundTrip(v1))).toEqual({ glyphs: [], marks: [OVERRIDE] });
    expect(() => parseOverrides({ ...v1, version: 3 })).toThrow(/version 3/);
  });

  it("keeps the part a note is about", () => {
    const note: Note = { ...NOTE, part: { kind: "dots", glyph: "uni066E.init", id: "dotbelowar" } };
    expect(parseAnnotations(roundTrip(annotationsFile([note])))).toEqual([note]);
  });

  it("merges imported overrides by glyph and by cell", () => {
    const moved = { ...GLYPH, body: { dx: 5, dy: 5 } };
    const other = { ...GLYPH, glyph: "uni066E.medi" };
    const merged = mergeOverrides(
      { glyphs: [GLYPH], marks: [OVERRIDE] },
      { glyphs: [moved, other], marks: [] },
    );
    expect(merged.glyphs).toEqual([moved, other]);
    expect(merged.marks).toEqual([OVERRIDE]);
  });

  it("rejects a file of the wrong kind or a malformed entry", () => {
    expect(() => parseAnnotations(overridesFile(NO_OVERRIDES))).toThrow(SchemaError);
    const bad = { ...annotationsFile([NOTE]), notes: [{ ...NOTE, severity: 5 }] };
    expect(() => parseAnnotations(roundTrip(bad))).toThrow(/severity/);
  });

  it("replaces imported notes by id", () => {
    const merged = mergeNotes(
      [NOTE],
      [
        { ...NOTE, status: "accepted" },
        { ...NOTE, id: "n2" },
      ],
    );
    expect(merged.map((n) => [n.id, n.status])).toEqual([
      ["n1", "accepted"],
      ["n2", "open"],
    ]);
  });

  it("summarises notes and offsets as plain text", () => {
    const text = summary([NOTE], { glyphs: [GLYPH], marks: [OVERRIDE] }, "sans-400-1.15-abc", {
      letter: (cp) => ({ "U+0623": "alef hamza above", "U+0628": "beh" })[cp] ?? cp,
      marks: (cps) => cps.join(" + "),
    });
    expect(text).toContain("alef hamza above isolated + U+064F:");
    expect(text).toContain("[open] too high, severity 2 (calib): Hamza and damma");
    expect(text).toContain(
      "offset beh medial + U+0651 + U+064E: uni0651 dx 0 dy -40; uni064E dx 12 dy 0",
    );
    expect(text).toContain(
      "glyph uni066E.init (beh initial, noon initial): body dx 0 dy 40; dots dotbelowar dx 0 dy -20",
    );
  });
});

describe("URL state", () => {
  it("round-trips a selected cell", () => {
    const state = {
      ...DEFAULT_STATE,
      view: "overview" as const,
      mark: "shadda-fatha",
      letter: "U+0628",
      form: "medial" as const,
      font: "source" as const,
      niche: true,
      impossible: true,
      drag: "dot" as const,
    };
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it("leaves the default state out of the URL", () => {
    expect(serializeState(DEFAULT_STATE)).toBe("");
  });

  it("ignores unknown or malformed values", () => {
    expect(parseState("?view=bogus&letter=0628&form=sideways&mark=%3Cb%3E")).toEqual(DEFAULT_STATE);
  });
});
