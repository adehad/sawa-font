import { describe, expect, it } from "vitest";
import type { Positioning } from "./positioning";
import { ruleFor } from "./rules";

const POSITIONING: Positioning = {
  lookups: [
    {
      index: 27,
      type: "base",
      feature: "mark",
      flag: 0,
      classes: [{ id: "27.0", name: "top_27", position: "top", label: "", marks: ["uni064E"] }],
    },
    {
      index: 35,
      type: "mark",
      feature: "mkmk",
      flag: 16,
      markFilteringSet: 13,
      classes: [
        { id: "35.0", name: "mkmk_top_35", position: "top", label: "", marks: ["uni064E"] },
      ],
    },
  ],
  anchors: {
    "uni066E.init": { base: [{ lookup: 27, class: "27.0", x: 146, y: 465 }] },
    uni064E: { mark: [{ lookup: 27, class: "27.0", x: 120, y: 520 }] },
    uni0651: { mark2: [{ lookup: 35, class: "35.0", x: 177, y: 757 }] },
  },
  alternates: {},
  cells: {},
};

describe("rule preview", () => {
  it("writes an anchor move as the base anchor it becomes", () => {
    const rule = ruleFor(
      { mechanism: "anchor", glyph: "uni066E.init", cls: "27.0" },
      0,
      -40,
      POSITIONING,
    );
    expect(rule.fea).toBe("pos base uni066E.init <anchor 146 425> mark @top_27;");
    expect(rule.text).toContain("from (146, 465) to (146, 425)");
    expect(rule.lookup).toBe("GPOS lookup 27 (mark)");
  });

  it("writes a pair rule as a contextual lookup with the mark alone in its filtering set", () => {
    const rule = ruleFor(
      { mechanism: "pair", base: "uni066E.init", mark: "uni064E" },
      12,
      -40,
      POSITIONING,
    );
    expect(rule.fea).toBe(
      "lookup lab_pair_uni064E {\n  lookupflag UseMarkFilteringSet [uni064E];\n  pos uni066E.init uni064E' <12 -40 0 0>;\n} lab_pair_uni064E;",
    );
    expect(rule.text).toBe(
      "Adjust uni064E by (12, -40) wherever it follows uni066E.init, other marks between them skipped. Marks stacked on it take the x of the shift, not the y.",
    );
    expect(rule.lookup).toContain("after lookup 35");
  });

  it("writes a split class as its own mark class and the glyph's anchor for it", () => {
    const rule = ruleFor(
      { mechanism: "split-class", glyph: "uni066E.init", cls: "27.0", marks: ["uni064E"] },
      5,
      10,
      POSITIONING,
    );
    expect(rule.fea).toBe(
      "markClass uni064E <anchor 120 520> @top_27_uni064E;\npos base uni066E.init <anchor 151 475> mark @top_27_uni064E;",
    );
  });

  it("writes a mark-to-mark anchor, an outline and a dot copy", () => {
    expect(
      ruleFor({ mechanism: "mkmk-anchor", glyph: "uni0651", cls: "35.0" }, 0, 20, POSITIONING).fea,
    ).toBe("pos mark uni0651 <anchor 177 777> mark @mkmk_top_35;");
    const body = ruleFor(
      { mechanism: "outline", glyph: "uni066E.init", part: "body" },
      0,
      60,
      POSITIONING,
    );
    expect(body.fea).toBe(
      "# glyf: uni066E.init translated by (0, 60)\npos base uni066E.init <anchor 146 525> mark @top_27;",
    );
    const dot = ruleFor(
      { mechanism: "outline", glyph: "uni066E.init", part: "dotbelowar" },
      30,
      -40,
      POSITIONING,
    );
    expect(dot.fea).toContain("sub uni066E.init dotbelowar' by dotbelowar.lab.uni066E.init;");
    expect(dot.lookup).toContain("calt");
  });
});
