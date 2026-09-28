import markGroupsData from "../../../data/mark-groups.json";

export type MarkGroupId =
  | "short"
  | "tanween"
  | "sukun"
  | "shadda"
  | "madd"
  | "hamza"
  | "waqf"
  | "other";

export interface MarkGroup {
  readonly id: MarkGroupId;
  /** Single codepoints ("U+0651") and inclusive ranges ("U+064E..U+0650"). */
  readonly codepoints: readonly string[];
}

const GROUP_IDS: readonly string[] = [
  "short",
  "tanween",
  "sukun",
  "shadda",
  "madd",
  "hamza",
  "waqf",
  "other",
] satisfies readonly MarkGroupId[];

function isMarkGroupId(value: string): value is MarkGroupId {
  return GROUP_IDS.includes(value);
}

function parseCodepoint(token: string): number {
  const match = /^U\+([0-9A-F]{4,6})$/.exec(token);
  if (!match?.[1]) {
    throw new Error(`mark-groups.json: malformed codepoint "${token}"`);
  }
  return Number.parseInt(match[1], 16);
}

/** Expands mark-groups.json codepoint tokens into every codepoint they cover, in order. */
export function expandCodepoints(tokens: readonly string[]): number[] {
  return tokens.flatMap((token) => {
    const [first, last] = token.split("..");
    const start = parseCodepoint(first ?? "");
    const end = last === undefined ? start : parseCodepoint(last);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
}

/** The group's first `count` marks, each on U+25CC DOTTED CIRCLE. */
export function sampleMarks(group: MarkGroup, count: number): string[] {
  return expandCodepoints(group.codepoints)
    .slice(0, count)
    .map((codepoint) => `◌${String.fromCodePoint(codepoint)}`);
}

export const MARK_GROUPS: readonly MarkGroup[] = markGroupsData.groups.map((group) => {
  if (!isMarkGroupId(group.id)) {
    throw new Error(`mark-groups.json: unknown group "${group.id}"; add it to MarkGroupId`);
  }
  return { id: group.id, codepoints: group.codepoints };
});
