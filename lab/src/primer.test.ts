import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inline, parsePrimer } from "./primer";

const SOURCE = `---
title: Marks
lang: en
---

# Marks in a font

An intro with \`code\`.

## One letter, four glyphs

First line
continues here.

- one
- two

\`\`\`demo
forms letter=U+0628
\`\`\`

\`\`\`fea
pos base a <anchor 1 2> mark @top;
\`\`\`
`;

describe("primer content", () => {
  it("reads sections, paragraphs, lists, code and demos", () => {
    const primer = parsePrimer(SOURCE);
    expect(primer.title).toBe("Marks in a font");
    expect(primer.lang).toBe("en");
    expect(primer.intro).toEqual([{ kind: "p", text: "An intro with `code`." }]);
    expect(primer.sections).toEqual([
      {
        heading: "One letter, four glyphs",
        id: "one-letter-four-glyphs",
        blocks: [
          { kind: "p", text: "First line continues here." },
          { kind: "list", items: ["one", "two"] },
          { kind: "demo", name: "forms", params: { letter: "U+0628" } },
          { kind: "code", lang: "fea", text: "pos base a <anchor 1 2> mark @top;" },
        ],
      },
    ]);
  });

  it("splits inline code from text", () => {
    expect(inline("the `init` feature")).toEqual([
      { code: false, text: "the " },
      { code: true, text: "init" },
      { code: false, text: " feature" },
    ]);
  });

  it("keeps the shipped primer plain: sentence-case headings, no em dashes, a demo per section", () => {
    const source = readFileSync(new URL("../../content/primer/en.md", import.meta.url), "utf8");
    expect(source).not.toMatch(/[—–]/);
    const primer = parsePrimer(source);
    expect(primer.sections.length).toBeGreaterThanOrEqual(8);
    const capitalised = primer.sections.filter((section) =>
      section.heading
        .split(" ")
        .slice(1)
        .some((w) => /^[A-Z][a-z]/.test(w) && w !== "Sawa"),
    );
    expect(capitalised.map((s) => s.heading)).toEqual([]);
    const bare = primer.sections.filter(
      (section) => !section.blocks.some((b) => b.kind === "demo"),
    );
    expect(bare.map((s) => s.heading)).toEqual([]);
  });
});
