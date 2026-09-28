import { describe, expect, test } from "vitest";
import markGroupsData from "../../../data/mark-groups.json";
import { MARK_GROUPS, expandCodepoints, sampleMarks } from "./groups";

describe("expandCodepoints", () => {
  test("expands an inclusive range", () => {
    expect(expandCodepoints(["U+064E..U+0650"])).toEqual([0x064e, 0x064f, 0x0650]);
  });

  test("keeps single codepoints and token order", () => {
    expect(expandCodepoints(["U+0652", "U+064B..U+064C"])).toEqual([0x0652, 0x064b, 0x064c]);
  });

  test("rejects a malformed token", () => {
    expect(() => expandCodepoints(["0652"])).toThrow(/malformed/);
  });
});

describe("sampleMarks", () => {
  test("puts each mark on a dotted circle", () => {
    const marks = MARK_GROUPS.slice(0, 1).flatMap((group) => sampleMarks(group, 2));
    expect(marks).toEqual(["◌َ", "◌ُ"]);
  });

  test("returns fewer marks than asked for a small group", () => {
    const shadda = MARK_GROUPS.find((group) => group.id === "shadda");
    expect(shadda && sampleMarks(shadda, 3)).toEqual(["◌ّ"]);
  });
});

test("MARK_GROUPS mirrors every group in mark-groups.json, in order", () => {
  expect(MARK_GROUPS.map((group) => group.id)).toEqual(
    markGroupsData.groups.map((group) => group.id),
  );
});
