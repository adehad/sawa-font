import type { Target } from "./edits";
import { type AnchorPoint, type Positioning, lookupOf, markClass } from "./positioning";

/** The font rule an edit becomes, in plain words and in feature syntax, and where it lands. */
export interface Rule {
  text: string;
  fea: string;
  lookup: string;
}

function anchorOf(
  positioning: Positioning,
  glyph: string,
  cls: string,
  kinds: ("base" | "ligature" | "mark2" | "mark")[],
): AnchorPoint | undefined {
  const set = positioning.anchors[glyph];
  for (const kind of kinds) {
    const found = set?.[kind]?.find((a) => a.class === cls);
    if (found) return found;
  }
  return undefined;
}

const at = (x: number, y: number) => `<anchor ${x} ${y}>`;
const by = (dx: number, dy: number) => `(${dx}, ${dy})`;

function lookupLabel(positioning: Positioning, cls: string): string {
  const found = markClass(positioning, cls);
  const index = lookupOf(cls);
  return found ? `GPOS lookup ${index} (${found.lookup.feature})` : `GPOS lookup ${index}`;
}

function className(positioning: Positioning, cls: string): string {
  return markClass(positioning, cls)?.cls.name ?? `class_${cls.replace(".", "_")}`;
}

/** The last GPOS lookup the export knows, which a pair lookup is appended after. */
function lastLookup(positioning: Positioning): number {
  return Math.max(0, ...positioning.lookups.map((l) => l.index));
}

/** The base anchors of `glyph` moved by (dx, dy), as feature lines. */
function movedAnchors(positioning: Positioning, glyph: string, dx: number, dy: number): string[] {
  const set = positioning.anchors[glyph];
  const lines = [
    ...(set?.base ?? []).map(
      (a) =>
        `pos base ${glyph} ${at(a.x + dx, a.y + dy)} mark @${className(positioning, a.class)};`,
    ),
    ...(set?.ligature ?? []).map(
      (a) =>
        `pos ligature ${glyph} ${at(a.x + dx, a.y + dy)} mark @${className(positioning, a.class)};`,
    ),
  ];
  return [...new Set(lines)];
}

export function ruleFor(target: Target, dx: number, dy: number, positioning: Positioning): Rule {
  switch (target.mechanism) {
    case "outline": {
      const { glyph, part } = target;
      if (part === "body") {
        const anchors = movedAnchors(positioning, glyph, dx, dy);
        return {
          text: `Move the outline of ${glyph} by ${by(dx, dy)} in glyf, with its anchors, so its dots and marks follow. Every letter drawn with ${glyph} moves.`,
          fea: [`# glyf: ${glyph} translated by ${by(dx, dy)}`, ...anchors].join("\n"),
          lookup: "glyf, and the anchors in every mark lookup that holds the glyph",
        };
      }
      if (part.includes(":"))
        return {
          text: `Move the dots drawn inside ${glyph} (${part}) by ${by(dx, dy)} in glyf. The rest of the glyph and its anchors stay.`,
          fea: `# glyf: ${glyph} ${part} translated by ${by(dx, dy)}`,
          lookup: "glyf",
        };
      const copy = `${part}.lab.${glyph}`;
      return {
        text: `Draw ${copy}, a copy of ${part} moved by ${by(dx, dy)} that keeps its anchors, and swap it in after ${glyph} with a contextual substitution. Marks stacked on the dots keep their place.`,
        fea: `# glyf: ${copy} is ${part} translated by ${by(dx, dy)}\nfeature calt {\n  sub ${glyph} ${part}' by ${copy};\n} calt;`,
        lookup: "a new GSUB lookup in calt, the last Arabic substitution stage",
      };
    }
    case "anchor": {
      const anchor = anchorOf(positioning, target.glyph, target.cls, ["base", "ligature"]);
      const name = className(positioning, target.cls);
      const [x, y] = anchor ? [anchor.x, anchor.y] : [0, 0];
      const kind = positioning.anchors[target.glyph]?.ligature?.some((a) => a.class === target.cls)
        ? "ligature"
        : "base";
      return {
        text: `Move ${target.glyph}'s anchor for @${name} from ${by(x, y)} to ${by(x + dx, y + dy)}. Every mark of that class on ${target.glyph}, dots included, moves by ${by(dx, dy)}, with what stacks on it.`,
        fea: `pos ${kind} ${target.glyph} ${at(x + dx, y + dy)} mark @${name};`,
        lookup: lookupLabel(positioning, target.cls),
      };
    }
    case "split-class": {
      const anchor = anchorOf(positioning, target.glyph, target.cls, ["base", "ligature"]);
      const name = `${className(positioning, target.cls)}_${target.marks.join("_")}`;
      const [x, y] = anchor ? [anchor.x, anchor.y] : [0, 0];
      const marks = target.marks.map((mark) => {
        const own = anchorOf(positioning, mark, target.cls, ["mark"]);
        return `markClass ${mark} ${at(own?.x ?? 0, own?.y ?? 0)} @${name};`;
      });
      return {
        text: `Give ${target.marks.join(", ")} a class of their own, @${name}, with ${target.glyph}'s anchor for it at ${by(x + dx, y + dy)} instead of ${by(x, y)}. Every other glyph keeps the old anchor for them, and the rest of the class stays on ${target.glyph}.`,
        fea: [...marks, `pos base ${target.glyph} ${at(x + dx, y + dy)} mark @${name};`].join("\n"),
        lookup: lookupLabel(positioning, target.cls),
      };
    }
    case "pair": {
      const name = `lab_pair_${target.mark}`;
      return {
        text: `Adjust ${target.mark} by ${by(dx, dy)} wherever it follows ${target.base}, other marks between them skipped. Marks stacked on it take the x of the shift, not the y.`,
        fea: `lookup ${name} {\n  lookupflag UseMarkFilteringSet [${target.mark}];\n  pos ${target.base} ${target.mark}' <${dx} ${dy} 0 0>;\n} ${name};`,
        lookup: `a new chained contextual GPOS lookup after lookup ${lastLookup(positioning)}, in mark`,
      };
    }
    default: {
      const anchor = anchorOf(positioning, target.glyph, target.cls, ["mark2"]);
      const name = className(positioning, target.cls);
      const [x, y] = anchor ? [anchor.x, anchor.y] : [0, 0];
      return {
        text: `Move ${target.glyph}'s mark-to-mark anchor for @${name} from ${by(x, y)} to ${by(x + dx, y + dy)}. Every mark of that class stacked on ${target.glyph} moves by ${by(dx, dy)}, on whatever letter.`,
        fea: `pos mark ${target.glyph} ${at(x + dx, y + dy)} mark @${name};`,
        lookup: lookupLabel(positioning, target.cls),
      };
    }
  }
}
