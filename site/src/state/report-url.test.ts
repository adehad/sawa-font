import { describe, expect, it } from "vitest";
import {
  defaultReportState,
  parseReportState,
  parseState,
  toReportSearch,
  toSearch,
  toggleReportLayer,
  type ReportState,
} from "./url";

describe("defaultReportState", () => {
  it("is onion skin on the first test's Serif pair, with guides off", () => {
    expect(defaultReportState()).toEqual({
      test: undefined,
      family: "sawa-serif",
      mode: "onion",
      opacity: 50,
      swipe: 50,
      layers: ["sawa", "upstream", "diff"],
      zoom: "fit",
    });
  });

  it("serialises to an empty string and reads back from one", () => {
    expect(toReportSearch(defaultReportState())).toBe("");
    expect(parseReportState("")).toEqual(defaultReportState());
  });
});

describe("parseReportState", () => {
  it("reads every param", () => {
    expect(
      parseReportState("?rt=madda&rf=sawa-mono&rm=swipe&ro=20&rs=75&rl=upstream,guides&rz=200"),
    ).toEqual({
      test: "madda",
      family: "sawa-mono",
      mode: "swipe",
      opacity: 20,
      swipe: 75,
      layers: ["upstream", "guides"],
      zoom: "200",
    });
  });

  it("clamps opacity and swipe to 0-100 and ignores non-integers", () => {
    expect(parseReportState("?ro=150&rs=-3")).toMatchObject({ opacity: 100, swipe: 0 });
    expect(parseReportState("?ro=0.5&rs=abc")).toMatchObject({ opacity: 50, swipe: 50 });
  });

  it("falls back to defaults for unknown enum values", () => {
    expect(parseReportState("?rf=amiri&rm=blink&rz=300")).toMatchObject({
      family: "sawa-serif",
      mode: "onion",
      zoom: "fit",
    });
  });

  it("drops a test id that isn't a lowercase id", () => {
    expect(parseReportState("?rt=../etc").test).toBeUndefined();
    expect(parseReportState("?rt=Madda").test).toBeUndefined();
  });

  it("orders layers canonically, drops unknown ones and reads rl=none as all off", () => {
    expect(parseReportState("?rl=diff,sawa,bogus,sawa").layers).toEqual(["sawa", "diff"]);
    expect(parseReportState("?rl=none").layers).toEqual([]);
    expect(parseReportState("?rl=bogus").layers).toEqual(["sawa", "upstream", "diff"]);
  });

  it("ignores the playground's params, and the playground ignores the report's", () => {
    expect(parseReportState("?fam=sawa-mono&size=40")).toEqual(defaultReportState());
    expect(toSearch(parseState("?rf=sawa-mono&rm=side"))).toBe("");
  });
});

describe("toReportSearch", () => {
  it("writes params in canonical order, omitting defaults", () => {
    const state: ReportState = {
      ...defaultReportState(),
      zoom: "100",
      layers: ["sawa", "guides"],
      mode: "side",
      test: "fatiha-1",
      family: "sawa-sans",
    };
    expect(toReportSearch(state)).toBe("?rt=fatiha-1&rf=sawa-sans&rm=side&rl=sawa,guides&rz=100");
  });

  it("writes rl=none when every toggle is off", () => {
    expect(toReportSearch({ ...defaultReportState(), layers: [] })).toBe("?rl=none");
  });

  it("rounds and clamps hand-built percentages", () => {
    expect(toReportSearch({ ...defaultReportState(), opacity: 33.6, swipe: 140 })).toBe(
      "?ro=34&rs=100",
    );
    expect(toReportSearch({ ...defaultReportState(), opacity: Number.NaN })).toBe("");
  });

  it("round-trips through parseReportState", () => {
    const state: ReportState = {
      test: "pause-marks",
      family: "sawa-mono",
      mode: "swipe",
      opacity: 10,
      swipe: 90,
      layers: [],
      zoom: "200",
    };
    expect(parseReportState(toReportSearch(state))).toEqual(state);
  });
});

describe("toggleReportLayer", () => {
  it("turns a layer off and back on in canonical order", () => {
    const off = toggleReportLayer(defaultReportState(), "sawa");
    expect(off.layers).toEqual(["upstream", "diff"]);
    expect(toggleReportLayer(off, "sawa").layers).toEqual(["sawa", "upstream", "diff"]);
    expect(toggleReportLayer(off, "guides").layers).toEqual(["upstream", "guides", "diff"]);
  });
});
