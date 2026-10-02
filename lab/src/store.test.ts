import { describe, expect, it } from "vitest";
import { type Edit, type Edits, NO_EDITS } from "./edits";
import { DEFAULT_STATE, parseState, serializeState } from "./state";
import {
  type Note,
  SchemaError,
  annotationsFile,
  mergeNotes,
  mergeOverrides,
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

const STAMP = { build: "sans-400-1.15-abc", wght: 400, updated: "2026-10-02T09:00:00.000Z" };

const EDITS: Edits = {
  edits: [
    {
      target: { mechanism: "outline", glyph: "uni066E.init", part: "body" },
      scope: "outline",
      dx: 0,
      dy: 40,
      usedBy: ["beh initial", "noon initial"],
      ...STAMP,
    },
    {
      target: { mechanism: "anchor", glyph: "uni066E.init", cls: "27.0" },
      scope: "mark-class",
      dx: 0,
      dy: 30,
      usedBy: ["beh initial", "noon initial"],
      ...STAMP,
    },
    {
      target: { mechanism: "split-class", glyph: "uni066E.medi", cls: "27.0", marks: ["uni064E"] },
      scope: "mark-group",
      dx: 5,
      dy: 0,
      usedBy: [],
      ...STAMP,
    },
    {
      target: { mechanism: "pair", base: "uni066E.medi", mark: "uni064E" },
      scope: "pair",
      dx: 12,
      dy: -40,
      usedBy: [],
      ...STAMP,
    },
    {
      target: { mechanism: "mkmk-anchor", glyph: "uni0651", cls: "35.0" },
      scope: "mark-class",
      dx: 0,
      dy: -20,
      usedBy: [],
      ...STAMP,
    },
  ],
  requests: [
    {
      key: { letter: "U+062B", form: "initial", marks: ["U+0651", "U+064D"] },
      glyphs: ["uni064D", "uni0651", "threedotsupabovear", "uni066E.init"],
      reason: "Shadda and kasratan pile up over the dots",
      change: "A combined shadda-kasra glyph",
      build: STAMP.build,
      created: STAMP.updated,
    },
  ],
};

const V2 = {
  schema: "sawa-lab/overrides",
  version: 2,
  glyphs: [
    {
      glyph: "uni066E.init",
      usedBy: ["beh initial"],
      build: "old",
      wght: 400,
      body: { dx: 0, dy: 40 },
      dots: [{ part: "dotbelowar", dx: 0, dy: -20 }],
      updated: STAMP.updated,
    },
  ],
  marks: [
    {
      key: { letter: "U+0628", form: "medial", marks: ["U+0651", "U+064E"] },
      build: "old",
      wght: 400,
      marks: [
        { index: 0, glyph: "uni0651", dx: 0, dy: -40 },
        { index: 1, glyph: "uni064E", dx: 0, dy: 0 },
      ],
      updated: STAMP.updated,
    },
  ],
};

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("annotations and overrides", () => {
  it("round-trips through JSON", () => {
    expect(parseAnnotations(roundTrip(annotationsFile([NOTE])))).toEqual([NOTE]);
    expect(parseOverrides(roundTrip(overridesFile(EDITS)))).toEqual({
      edits: EDITS.edits.toSorted((a, b) => overridesId(a).localeCompare(overridesId(b))),
      requests: EDITS.requests,
    });
  });

  it("writes each edit's mechanism, scope, target, lookup and per-master values", () => {
    const file = overridesFile(EDITS);
    expect(file.version).toBe(3);
    const pair = file.edits.find((e) => e.mechanism === "pair");
    expect(pair).toMatchObject({
      id: "pair:uni066E.medi:uni064E",
      scope: "pair",
      target: { base: "uni066E.medi", mark: "uni064E" },
      lookup: "new",
      values: { "400": { dx: 12, dy: -40 }, "700": null },
    });
    expect(file.edits.find((e) => e.mechanism === "anchor")?.lookup).toBe(27);
    expect(file.edits.find((e) => e.mechanism === "outline")?.lookup).toBeNull();
    expect(file.requests[0]).toMatchObject({ mechanism: "substitution", scope: "cell" });
  });

  it("migrates version 2 glyph moves to outline edits and mark offsets to pair rules", () => {
    const edits = parseOverrides(roundTrip(V2), () => "uni066E.medi");
    expect(edits.edits.map((e) => [e.target, e.scope, e.dx, e.dy])).toEqual([
      [{ mechanism: "outline", glyph: "uni066E.init", part: "body" }, "outline", 0, 40],
      [{ mechanism: "outline", glyph: "uni066E.init", part: "dotbelowar" }, "outline", 0, -20],
      [{ mechanism: "pair", base: "uni066E.medi", mark: "uni0651" }, "pair", 0, -40],
    ]);
    expect(parseOverrides(roundTrip(V2)).edits).toHaveLength(2);
  });

  it("migrates a version 1 file's mark offsets to pair rules", () => {
    const v1 = {
      schema: "sawa-lab/overrides",
      version: 1,
      overrides: [{ ...V2.marks[0], glyph: "b" }],
    };
    expect(parseOverrides(roundTrip(v1)).edits.map((e) => e.target)).toEqual([
      { mechanism: "pair", base: "b", mark: "uni0651" },
    ]);
    expect(() => parseOverrides({ ...v1, version: 4 })).toThrow(/version 4/);
  });

  it("keeps the part a note is about", () => {
    const note: Note = { ...NOTE, part: { kind: "dots", glyph: "uni066E.init", id: "dotbelowar" } };
    expect(parseAnnotations(roundTrip(annotationsFile([note])))).toEqual([note]);
  });

  it("merges imported edits by target and requests by cell", () => {
    const [first, second] = EDITS.edits as [Edit, Edit];
    const moved = { ...first, dy: 99 };
    const merged = mergeOverrides(
      { edits: [first, second], requests: [] },
      { ...EDITS, edits: [moved] },
    );
    expect(merged.edits).toEqual([moved, second]);
    expect(merged.requests).toEqual(EDITS.requests);
  });

  it("rejects a file of the wrong kind or a malformed entry", () => {
    expect(() => parseAnnotations(overridesFile(NO_EDITS))).toThrow(SchemaError);
    const bad = { ...annotationsFile([NOTE]), notes: [{ ...NOTE, severity: 5 }] };
    expect(() => parseAnnotations(roundTrip(bad))).toThrow(/severity/);
    const file = roundTrip(overridesFile(EDITS)) as { edits: { target: unknown }[] };
    (file.edits[0] as { target: unknown }).target = { glyph: "x", class: "top" };
    expect(() => parseOverrides(file)).toThrow(/class/);
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

  it("summarises notes, edits and requests as plain text", () => {
    const text = summary([NOTE], EDITS, "sans-400-1.15-abc", {
      letter: (cp) => ({ "U+0623": "alef hamza above", "U+062B": "theh" })[cp] ?? cp,
      marks: (cps) => cps.join(" + "),
    });
    expect(text).toContain("1 note, 5 proposed edits, 1 request for a form of its own");
    expect(text).toContain("[open] too high, severity 2 (calib): Hamza and damma");
    expect(text).toContain("pair:uni066E.medi:uni064E: dx 12 dy -40, this pair only");
    expect(text).toContain("needs its own form: theh initial + U+0651 + U+064D");
  });
});

function overridesId(edit: Edit): string {
  return overridesFile({ edits: [edit], requests: [] }).edits[0]?.id ?? "";
}

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
      drag: "anchor" as const,
      baked: true,
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
