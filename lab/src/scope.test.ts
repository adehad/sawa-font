import { describe, expect, it } from "vitest";
import { type ShapedGlyph, layout } from "./cells";
import type { Target } from "./edits";
import { type Attachment, attachments } from "./positioning";
import { type Shaped, blastRadius, scopeOptions } from "./scope";

const scopes = (options: { scope: string }[]) => options.map((o) => o.scope);

describe("scope options", () => {
  it("offers a mark the pair rule first, then its class's anchor", () => {
    const options = scopeOptions({
      kind: "mark",
      mark: "fatha",
      attach: { parent: "beh.init", cls: "27.0", kind: "base" },
      context: "beh.init",
    });
    expect(scopes(options)).toEqual(["pair", "mark-group", "mark-class"]);
    expect(options[0]?.targets).toEqual([{ mechanism: "pair", base: "beh.init", mark: "fatha" }]);
    expect(options[1]?.targets).toEqual([
      { mechanism: "split-class", glyph: "beh.init", cls: "27.0", marks: ["fatha"] },
    ]);
    expect(options[2]?.label).toBe("All marks of this class on this glyph");
  });

  it("offers a stacked mark the pair rule, then the mark-to-mark anchor it hangs on", () => {
    const options = scopeOptions({
      kind: "mark",
      mark: "fatha",
      attach: { parent: "shadda", cls: "35.0", kind: "mark" },
      context: "beh.init",
    });
    expect(scopes(options)).toEqual(["pair", "mark-class"]);
    expect(options[1]?.targets).toEqual([
      { mechanism: "mkmk-anchor", glyph: "shadda", cls: "35.0" },
    ]);
  });

  it("offers an outline part this glyph's outline first, then all forms when there are others", () => {
    const forms: Target[] = [
      { mechanism: "outline", glyph: "beh.init", part: "body" },
      { mechanism: "outline", glyph: "beh.medi", part: "body" },
    ];
    expect(scopes(scopeOptions({ kind: "body", glyph: "beh.init" }, () => forms))).toEqual([
      "outline",
      "all-forms",
    ]);
    expect(scopes(scopeOptions({ kind: "body", glyph: "beh.init" }))).toEqual(["outline"]);
  });

  it("offers a dot glyph of its own every scope from the pair rule to all forms", () => {
    const options = scopeOptions(
      {
        kind: "dots",
        glyph: "beh.init",
        part: "dotbelow",
        inline: false,
        attach: { parent: "beh.init", cls: "19.0" },
        context: "beh.init",
      },
      (t) => [t, { ...t, glyph: "beh.medi" } as Target],
    );
    expect(scopes(options)).toEqual(["pair", "mark-group", "mark-class", "outline", "all-forms"]);
  });

  it("offers an anchor the marks on it here before the whole class", () => {
    const anchor = { kind: "anchor" as const, glyph: "beh.init", cls: "27.0" };
    expect(scopes(scopeOptions({ ...anchor, group: ["fatha", "dotabove"] }))).toEqual([
      "mark-group",
      "mark-class",
    ]);
    expect(scopeOptions({ ...anchor, group: ["fatha", "dotabove"] })[0]?.targets).toEqual([
      { mechanism: "split-class", glyph: "beh.init", cls: "27.0", marks: ["dotabove", "fatha"] },
    ]);
    expect(scopes(scopeOptions({ ...anchor, group: [] }))).toEqual(["mark-class"]);
  });
});

function glyph(gid: number, xOffset = 0, yOffset = 0, xAdvance = 0): ShapedGlyph {
  return { gid, cluster: 0, xAdvance, xOffset, yOffset };
}

describe("blast radius", () => {
  // gid 1 beh.init, 2 beh.medi, 3 fatha, 4 kasra; each cell is a body with one mark.
  const names: Record<number, string> = { 1: "beh.init", 2: "beh.medi", 3: "fatha", 4: "kasra" };
  const facts = {
    isBase: (gid: number) => gid < 3,
    isMark: (gid: number) => gid >= 3,
    name: (gid: number) => names[gid] ?? "",
  };
  const cell = (id: string, body: number, mark: number, cls: string): Shaped => {
    const shaped = layout(
      [glyph(mark, 100, 500), glyph(body, 0, 0, 300)],
      [glyph(body, 0, 0, 300)],
      facts,
    );
    const attach: (Attachment | null)[] = [{ parent: 1, cls, kind: "base" }, null];
    return { id, layout: shaped, attach };
  };
  const cells = [
    cell("init-fatha", 1, 3, "27.0"),
    cell("init-kasra", 1, 4, "19.0"),
    cell("medi-fatha", 2, 3, "27.0"),
    cell("medi-kasra", 2, 4, "19.0"),
  ];

  it("reaches every cell an outline is in", () => {
    expect(blastRadius([{ mechanism: "outline", glyph: "beh.init", part: "body" }], cells)).toEqual(
      ["init-fatha", "init-kasra"],
    );
  });

  it("reaches only the class an anchor holds, and only the pair a pair rule names", () => {
    expect(blastRadius([{ mechanism: "anchor", glyph: "beh.medi", cls: "27.0" }], cells)).toEqual([
      "medi-fatha",
    ]);
    expect(blastRadius([{ mechanism: "pair", base: "beh.init", mark: "kasra" }], cells)).toEqual([
      "init-kasra",
    ]);
  });

  it("reaches the union of every target of a scope", () => {
    const forms: Target[] = [
      { mechanism: "outline", glyph: "beh.init", part: "body" },
      { mechanism: "outline", glyph: "beh.medi", part: "body" },
    ];
    expect(blastRadius(forms, cells)).toHaveLength(4);
  });
});

describe("attachments", () => {
  it("finds the glyph and class whose anchors meet where each mark lands", () => {
    const anchors = {
      beh: { base: [{ lookup: 4, class: "4.0", x: 300, y: 200 }] },
      fatha: {
        mark: [
          { lookup: 4, class: "4.0", x: 100, y: 780 },
          { lookup: 5, class: "5.0", x: 100, y: 780 },
        ],
        mark2: [{ lookup: 5, class: "5.0", x: 100, y: 880 }],
      },
    };
    const pieces = [
      { name: "fatha", x: 200, y: -480, gdefMark: true },
      { name: "fatha", x: 200, y: -580, gdefMark: true },
      { name: "beh", x: 0, y: 0, gdefMark: false },
      { name: "pause", x: 0, y: 900, gdefMark: true },
    ];
    expect(attachments(pieces, anchors)).toEqual([
      { parent: 1, cls: "5.0", kind: "mark" },
      { parent: 2, cls: "4.0", kind: "base" },
      null,
      null,
    ]);
  });
});
