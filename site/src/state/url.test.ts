import { describe, expect, it } from "vitest";
import {
  clampSize,
  moveFont,
  defaultState,
  paneValue,
  parseState,
  setFonts,
  setOverride,
  sideColumns,
  toSearch,
  toggleFeature,
  toggleFont,
  visiblePanes,
  type PlaygroundState,
} from "./url";

describe("defaultState", () => {
  it("matches the schema's documented defaults", () => {
    expect(defaultState()).toEqual({
      text: "",
      preset: "mixed",
      family: "sawa-serif",
      weight: undefined,
      size: 32,
      waterfall: false,
      lineHeight: "default",
      palette: "groups",
      background: undefined,
      features: [],
      metrics: false,
      view: "stacked",
      fonts: ["sawa-serif", "sawa-sans", "status"],
      overrides: [],
    });
  });

  it("serialises to an empty string", () => {
    expect(toSearch(defaultState())).toBe("");
  });

  it("parses from an empty string", () => {
    expect(parseState("")).toEqual(defaultState());
  });
});

describe("preset and text", () => {
  it("defaults preset to mixed with no params", () => {
    expect(parseState("").preset).toBe("mixed");
  });

  it("infers preset custom when text is present and preset is absent", () => {
    const state = parseState("text=hello");
    expect(state.preset).toBe("custom");
    expect(state.text).toBe("hello");
  });

  it("infers preset custom for an empty text param", () => {
    expect(parseState("text=").preset).toBe("custom");
  });

  it("ignores text when preset is not custom", () => {
    const state = parseState("preset=mixed&text=hello");
    expect(state.preset).toBe("mixed");
    expect(state.text).toBe("");
  });

  it("keeps text when preset is custom", () => {
    const state = parseState("preset=custom&text=hello");
    expect(state.text).toBe("hello");
  });

  it("falls back to mixed for an invalid preset", () => {
    expect(parseState("preset=bogus").preset).toBe("mixed");
  });

  it("accepts every documented preset value", () => {
    expect(parseState("preset=quran").preset).toBe("quran");
    expect(parseState("preset=stress").preset).toBe("stress");
    expect(parseState("preset=custom").preset).toBe("custom");
  });

  it("does not serialise text unless preset is custom", () => {
    const state: PlaygroundState = { ...defaultState(), text: "hello" };
    expect(toSearch(state)).toBe("");
  });

  it("omits text when custom but empty", () => {
    const state: PlaygroundState = { ...defaultState(), preset: "custom" };
    expect(toSearch(state)).toBe("?preset=custom");
  });
});

describe("size", () => {
  it("defaults to 32", () => {
    expect(parseState("").size).toBe(32);
  });

  it("parses a valid integer", () => {
    expect(parseState("size=48").size).toBe(48);
  });

  it("clamps below the minimum", () => {
    expect(parseState("size=1").size).toBe(12);
  });

  it("clamps above the maximum", () => {
    expect(parseState("size=999").size).toBe(144);
  });

  it("falls back to the default for a non-numeric value", () => {
    expect(parseState("size=abc").size).toBe(32);
    expect(parseState("size=12px").size).toBe(32);
  });

  it("omits size when it is the default", () => {
    expect(toSearch({ ...defaultState(), size: 32 })).toBe("");
  });

  it("serialises a non-default size", () => {
    expect(toSearch({ ...defaultState(), size: 64 })).toBe("?size=64");
  });
});

describe("waterfall", () => {
  it("is off by default", () => {
    expect(parseState("").waterfall).toBe(false);
  });

  it("turns on only for the value 1", () => {
    expect(parseState("wf=1").waterfall).toBe(true);
    expect(parseState("wf=true").waterfall).toBe(false);
    expect(parseState("wf=0").waterfall).toBe(false);
  });

  it("serialises only when on", () => {
    expect(toSearch({ ...defaultState(), waterfall: true })).toBe("?wf=1");
    expect(toSearch({ ...defaultState(), waterfall: false })).toBe("");
  });
});

describe("line height", () => {
  it("defaults to 'default'", () => {
    expect(parseState("").lineHeight).toBe("default");
  });

  it("parses a plain number", () => {
    expect(parseState("lh=1.5").lineHeight).toBe(1.5);
  });

  it("clamps below the minimum", () => {
    expect(parseState("lh=0.1").lineHeight).toBe(0.8);
  });

  it("clamps above the maximum", () => {
    expect(parseState("lh=10").lineHeight).toBe(3);
  });

  it("falls back to 'default' for a non-numeric value", () => {
    expect(parseState("lh=loose").lineHeight).toBe("default");
  });

  it("falls back to 'default' for an empty value", () => {
    expect(parseState("lh=").lineHeight).toBe("default");
  });

  it("falls back to 'default' for a value that is only whitespace", () => {
    expect(parseState("lh=%20").lineHeight).toBe("default");
  });

  it("falls back to 'default' for hex notation", () => {
    expect(parseState("lh=0x2").lineHeight).toBe("default");
  });

  it("falls back to 'default' for scientific notation", () => {
    expect(parseState("lh=1e1").lineHeight).toBe("default");
  });

  it("rounds so lh=1.005 is stable across a reparse", () => {
    const state = parseState("lh=1.005");
    const reparsed = parseState(toSearch(state));
    expect(reparsed.lineHeight).toBe(state.lineHeight);
  });

  it("serialises with at most 2 decimals and no trailing zeros", () => {
    expect(toSearch({ ...defaultState(), lineHeight: 1.2 })).toBe("?lh=1.2");
    expect(toSearch({ ...defaultState(), lineHeight: 2 })).toBe("?lh=2");
    expect(toSearch({ ...defaultState(), lineHeight: 0.85 })).toBe("?lh=0.85");
  });
});

describe("palette", () => {
  it("defaults to groups", () => {
    expect(parseState("").palette).toBe("groups");
  });

  it("accepts every documented value", () => {
    expect(parseState("pal=mono").palette).toBe("mono");
    expect(parseState("pal=gray").palette).toBe("gray");
    expect(parseState("pal=groups").palette).toBe("groups");
  });

  it("falls back to groups for an invalid value", () => {
    expect(parseState("pal=bogus").palette).toBe("groups");
  });

  it("omits pal when it is the default", () => {
    expect(toSearch({ ...defaultState(), palette: "groups" })).toBe("");
  });
});

describe("background", () => {
  it("is absent by default", () => {
    expect(parseState("").background).toBeUndefined();
  });

  it("accepts light and dark", () => {
    expect(parseState("bg=light").background).toBe("light");
    expect(parseState("bg=dark").background).toBe("dark");
  });

  it("falls back to absent for an invalid value", () => {
    expect(parseState("bg=bogus").background).toBeUndefined();
  });

  it("serialises only when set", () => {
    expect(toSearch({ ...defaultState(), background: "dark" })).toBe("?bg=dark");
  });
});

describe("features", () => {
  it("is empty by default", () => {
    expect(parseState("").features).toEqual([]);
  });

  it("parses a comma list of 4-character tags", () => {
    expect(parseState("feat=ss01,liga").features).toEqual(["ss01", "liga"]);
  });

  it("rejects tags that are not exactly 4 alphanumeric characters", () => {
    expect(parseState("feat=ss1,ss012,ss-1,ss01").features).toEqual(["ss01"]);
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(parseState("feat=liga,ss01,liga").features).toEqual(["liga", "ss01"]);
  });

  it("serialises in order, joined by commas", () => {
    expect(toSearch({ ...defaultState(), features: ["liga", "ss01"] })).toBe("?feat=liga,ss01");
  });
});

describe("metrics", () => {
  it("is off by default and toggles only on 1", () => {
    expect(parseState("").metrics).toBe(false);
    expect(parseState("metrics=1").metrics).toBe(true);
    expect(parseState("metrics=yes").metrics).toBe(false);
  });
});

describe("view", () => {
  it("defaults to stacked", () => {
    expect(parseState("").view).toBe("stacked");
  });

  it("accepts side", () => {
    expect(parseState("view=side").view).toBe("side");
  });

  it("falls back to stacked for an invalid value", () => {
    expect(parseState("view=bogus").view).toBe("stacked");
  });
});

describe("fonts", () => {
  it("defaults to sawa-serif,sawa-sans,status", () => {
    expect(parseState("").fonts).toEqual(["sawa-serif", "sawa-sans", "status"]);
  });

  it("parses a comma list in order", () => {
    expect(parseState("fonts=amiri,noto,sch").fonts).toEqual(["amiri", "noto", "sch"]);
  });

  it("accepts local as a font id", () => {
    expect(parseState("fonts=local,sawa-serif").fonts).toEqual(["local", "sawa-serif"]);
  });

  it("drops unknown ids", () => {
    expect(parseState("fonts=sawa-serif,bogus,noto").fonts).toEqual(["sawa-serif", "noto"]);
  });

  it("drops duplicates, first wins", () => {
    expect(parseState("fonts=sawa-serif,noto,sawa-serif").fonts).toEqual(["sawa-serif", "noto"]);
  });

  it("falls back to the default when the result would be empty", () => {
    expect(parseState("fonts=bogus,alsobogus").fonts).toEqual([
      "sawa-serif",
      "sawa-sans",
      "status",
    ]);
  });

  it("drops the retired id sawa and falls back to the default", () => {
    expect(parseState("fonts=sawa").fonts).toEqual(["sawa-serif", "sawa-sans", "status"]);
  });

  it("omits fonts when it equals the default list and order", () => {
    expect(toSearch({ ...defaultState(), fonts: ["sawa-serif", "sawa-sans", "status"] })).toBe("");
    expect(toSearch({ ...defaultState(), fonts: ["status", "sawa-serif"] })).toBe(
      "?fonts=status,sawa-serif",
    );
  });
});

describe("sideColumns", () => {
  it("caps the fonts list at 4", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "status", "amiri", "amiriq", "sch", "noto"],
    };
    expect(sideColumns(state)).toEqual(["sawa-serif", "status", "amiri", "amiriq"]);
  });

  it("returns the whole list when it is 4 or fewer", () => {
    const state: PlaygroundState = { ...defaultState(), fonts: ["sawa-serif", "status"] };
    expect(sideColumns(state)).toEqual(["sawa-serif", "status"]);
  });
});

describe("overrides (ov)", () => {
  const threeFonts: PlaygroundState = {
    ...defaultState(),
    fonts: ["sawa-serif", "status", "amiriq"],
  };

  it("is empty by default", () => {
    expect(parseState("").overrides).toEqual([]);
  });

  it("parses the documented example", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov=2:font=amiri;pal=gray,3:pal=mono");
    expect(state.overrides).toEqual([
      { pane: 2, font: "amiri", pal: "gray" },
      { pane: 3, pal: "mono" },
    ]);
  });

  it("drops overrides for panes beyond the fonts list", () => {
    const state = parseState("fonts=sawa-serif,status&ov=5:font=amiri");
    expect(state.overrides).toEqual([]);
  });

  it("drops an override equal to the pane's own font", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov=1:font=sawa-serif");
    expect(state.overrides).toEqual([]);
  });

  it("drops an override equal to the shared palette", () => {
    const state = parseState("pal=gray&fonts=sawa-serif,status,amiriq&ov=2:pal=gray");
    expect(state.overrides).toEqual([]);
  });

  it("drops unknown keys and invalid values but keeps the rest of the entry", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov=2:font=amiri;bogus=x;pal=notreal");
    expect(state.overrides).toEqual([{ pane: 2, font: "amiri" }]);
  });

  it("ignores entries with an invalid pane", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov=0:font=amiri,abc:font=noto");
    expect(state.overrides).toEqual([]);
  });

  it("de-duplicates by pane, first wins", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov=2:font=amiri,2:font=noto");
    expect(state.overrides).toEqual([{ pane: 2, font: "amiri" }]);
  });

  it("serialises font before pal, sorted by pane", () => {
    const state: PlaygroundState = {
      ...threeFonts,
      overrides: [
        { pane: 3, pal: "mono" },
        { pane: 2, font: "amiri", pal: "gray" },
      ],
    };
    expect(toSearch(state)).toBe(
      "?fonts=sawa-serif,status,amiriq&ov=2:font=amiri;pal=gray,3:pal=mono",
    );
  });
});

describe("paneValue", () => {
  const state: PlaygroundState = {
    ...defaultState(),
    fonts: ["sawa-serif", "status", "amiriq"],
    palette: "groups",
    overrides: [{ pane: 2, font: "amiri", pal: "gray" }],
  };

  it("resolves the shared value when there is no override", () => {
    expect(paneValue(state, 1, "font")).toBe("sawa-serif");
    expect(paneValue(state, 1, "pal")).toBe("groups");
    expect(paneValue(state, 3, "font")).toBe("amiriq");
  });

  it("resolves an override when present", () => {
    expect(paneValue(state, 2, "font")).toBe("amiri");
    expect(paneValue(state, 2, "pal")).toBe("gray");
  });

  it("returns undefined for a font pane beyond the fonts list", () => {
    expect(paneValue(state, 99, "font")).toBeUndefined();
  });

  it("falls back to the shared palette for a pal pane beyond the fonts list", () => {
    expect(paneValue(state, 99, "pal")).toBe("groups");
  });

  it("accepts a non-literal OverrideKey through the generic overload", () => {
    const key: "font" | "pal" = "font";
    expect(paneValue(state, 1, key)).toBe("sawa-serif");
  });
});

describe("canonical order", () => {
  it("emits params in the schema's documented order", () => {
    const state: PlaygroundState = {
      text: "hi",
      preset: "custom",
      family: "sawa-mono",
      weight: 300,
      size: 40,
      waterfall: true,
      lineHeight: 1.4,
      palette: "mono",
      background: "dark",
      features: ["liga"],
      metrics: true,
      view: "side",
      fonts: ["amiri", "noto"],
      overrides: [{ pane: 1, pal: "gray" }],
    };
    expect(toSearch(state)).toBe(
      "?text=hi&preset=custom&fam=sawa-mono&wght=300&size=40&wf=1&lh=1.4&pal=mono&bg=dark&feat=liga&metrics=1" +
        "&view=side&fonts=amiri,noto&ov=1:pal=gray",
    );
  });
});

describe("unknown params", () => {
  it("are ignored on parse", () => {
    expect(parseState("bogus=1&size=48")).toEqual({ ...defaultState(), size: 48 });
  });
});

describe("encoded and raw separators", () => {
  it("parse fonts identically whether the comma is raw or encoded", () => {
    expect(parseState("fonts=amiri,noto")).toEqual(parseState("fonts=amiri%2Cnoto"));
  });

  it("parse feat identically whether the comma is raw or encoded", () => {
    expect(parseState("feat=liga,ss01")).toEqual(parseState("feat=liga%2Css01"));
  });

  it("parse ov identically whether the separators are raw or encoded", () => {
    const raw = "fonts=sawa-serif,status,amiriq&ov=2:font=amiri;pal=gray";
    const encoded = "fonts=sawa-serif,status,amiriq&ov=2%3Afont%3Damiri%3Bpal%3Dgray";
    expect(parseState(raw)).toEqual(parseState(encoded));
  });
});

describe("URLSearchParams input", () => {
  it("accepts a URLSearchParams instance directly", () => {
    const params = new URLSearchParams("size=48&wf=1");
    expect(parseState(params)).toEqual({ ...defaultState(), size: 48, waterfall: true });
  });
});

describe("round trip", () => {
  const cases: PlaygroundState[] = [
    defaultState(),
    { ...defaultState(), preset: "custom", text: "hello world" },
    { ...defaultState(), preset: "custom", text: "بِسْمِ اللَّهِ" },
    { ...defaultState(), size: 96 },
    { ...defaultState(), waterfall: true },
    { ...defaultState(), lineHeight: 1.25 },
    { ...defaultState(), palette: "mono" },
    { ...defaultState(), background: "light" },
    { ...defaultState(), features: ["ss01", "liga", "dlig"] },
    { ...defaultState(), metrics: true },
    { ...defaultState(), view: "side" },
    { ...defaultState(), fonts: ["noto", "sch", "amiri", "local"] },
    {
      ...defaultState(),
      text: "مرحبا",
      preset: "custom",
      size: 64,
      waterfall: true,
      lineHeight: 1.6,
      palette: "mono",
      background: "dark",
      features: ["ss01", "liga"],
      metrics: true,
      view: "side",
      fonts: ["amiri", "noto", "sch", "amiriq"],
      overrides: [
        { pane: 1, pal: "gray" },
        { pane: 3, font: "local", pal: "groups" },
      ],
    },
  ];

  it.each(cases.map((state, i) => [i, state] as const))(
    "parseState(toSearch(state)) equals state (%i)",
    (_i, state) => {
      expect(parseState(toSearch(state))).toEqual(state);
    },
  );
});

describe("idempotence", () => {
  const messyInputs = [
    "",
    "size=999&preset=bogus&fonts=bogus,sawa-serif,sawa-serif,status,extra",
    "text=hello&preset=mixed&size=abc&lh=loose&pal=x&bg=x&view=x",
    "fonts=sawa-serif,status,amiriq&ov=2:font=amiri;pal=gray,3:pal=mono,2:font=noto",
    "feat=ss1,ss01,SS01,ss01&metrics=yes&wf=true",
    "?fonts=amiri%2Cnoto&ov=1%3Apal%3Dgray",
  ];

  it.each(messyInputs)("stabilises after one extra round trip: %s", (input) => {
    const once = toSearch(parseState(input));
    const twice = toSearch(parseState(once));
    expect(twice).toBe(once);
  });
});

describe("lone surrogates in text", () => {
  it("does not throw when serialising a lone surrogate", () => {
    const state: PlaygroundState = { ...defaultState(), preset: "custom", text: "abc\uD800def" };
    expect(() => toSearch(state)).not.toThrow();
  });

  it("replaces a lone surrogate read from a URLSearchParams instance", () => {
    const params = new URLSearchParams();
    params.set("preset", "custom");
    params.set("text", "abc\uD800def");
    const state = parseState(params);
    expect(state.text).toBe("abc\uD800def".toWellFormed());
    expect(() => toSearch(state)).not.toThrow();
  });
});

describe("trim policy", () => {
  it("trims enum values before validating them", () => {
    expect(parseState("preset= custom ").preset).toBe("custom");
    expect(parseState("pal= mono ").palette).toBe("mono");
    expect(parseState("bg= dark ").background).toBe("dark");
    expect(parseState("view= side ").view).toBe("side");
  });

  it("trims boolean-flag values before comparing to 1", () => {
    expect(parseState("wf= 1 ").waterfall).toBe(true);
    expect(parseState("metrics= 1 ").metrics).toBe(true);
  });

  it("trims size and lh before parsing", () => {
    expect(parseState("size= 48 ").size).toBe(48);
    expect(parseState("lh= 1.5 ").lineHeight).toBe(1.5);
  });

  it("trims ov panes, keys and values", () => {
    const state = parseState("fonts=sawa-serif,status,amiriq&ov= 2 : font = amiri ; pal = gray ");
    expect(state.overrides).toEqual([{ pane: 2, font: "amiri", pal: "gray" }]);
  });
});

describe("toSearch normalises its input", () => {
  it("clamps an out-of-range size passed directly", () => {
    const state: PlaygroundState = { ...defaultState(), size: 999 };
    expect(toSearch(state)).toBe("?size=144");
  });

  it("drops a redundant override passed directly", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "sawa-sans", "status"],
      overrides: [{ pane: 1, font: "sawa-serif" }],
    };
    expect(toSearch(state)).toBe("");
  });

  it("never emits text when preset is not custom, even if text is set", () => {
    const state: PlaygroundState = { ...defaultState(), preset: "mixed", text: "leftover" };
    expect(toSearch(state)).toBe("");
  });

  it("de-duplicates a fonts list passed directly", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "sawa-serif", "amiri"],
    };
    expect(toSearch(state)).toBe("?fonts=sawa-serif,amiri");
  });
});

describe("special characters stay restricted to fonts/feat/ov", () => {
  it("percent-encodes a comma in text instead of leaving it readable", () => {
    const state: PlaygroundState = { ...defaultState(), preset: "custom", text: "a,b:c;d=e" };
    expect(toSearch(state)).toBe("?text=a%2Cb%3Ac%3Bd%3De&preset=custom");
  });

  it("round-trips a text value containing those characters", () => {
    const state: PlaygroundState = { ...defaultState(), preset: "custom", text: "a,b:c;d=e" };
    expect(parseState(toSearch(state))).toEqual(state);
  });
});

describe("repeated params", () => {
  it("first occurrence wins for size", () => {
    expect(parseState("size=48&size=90").size).toBe(48);
  });

  it("first occurrence wins for preset", () => {
    expect(parseState("preset=custom&preset=quran").preset).toBe("custom");
  });

  it("first occurrence wins for fonts", () => {
    expect(parseState("fonts=amiri,noto&fonts=sawa-serif,status").fonts).toEqual(["amiri", "noto"]);
  });
});

describe("special characters in text round-trip", () => {
  it.each([
    ["plus sign", "a+b"],
    ["percent sign", "100% done"],
    ["ampersand", "fish & chips"],
    ["hash", "issue #4"],
  ])("round-trips a %s", (_label, text) => {
    const state: PlaygroundState = { ...defaultState(), preset: "custom", text };
    expect(parseState(toSearch(state))).toEqual(state);
  });
});

describe("setFonts", () => {
  it("keeps an override attached to its font when the list is reordered", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "status", "amiriq"],
      overrides: [{ pane: 2, pal: "gray" }],
    };
    const next = setFonts(state, ["status", "amiriq", "sawa-serif"]);
    expect(next.fonts).toEqual(["status", "amiriq", "sawa-serif"]);
    expect(next.overrides).toEqual([{ pane: 1, pal: "gray" }]);
  });

  it("drops an override whose font left the list", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "status", "amiriq"],
      overrides: [{ pane: 3, font: "local" }],
    };
    const next = setFonts(state, ["sawa-serif", "status"]);
    expect(next.fonts).toEqual(["sawa-serif", "status"]);
    expect(next.overrides).toEqual([]);
  });

  it("carries a font-substitution override to its base font's new position", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      fonts: ["sawa-serif", "status"],
      overrides: [{ pane: 1, font: "amiri" }],
    };
    const next = setFonts(state, ["status", "sawa-serif"]);
    expect(next.overrides).toEqual([{ pane: 2, font: "amiri" }]);
  });

  it("normalises the new fonts list the same way parseState does", () => {
    const state = defaultState();
    const next = setFonts(state, ["sawa-serif", "sawa-serif", "bogus", "status"]);
    expect(next.fonts).toEqual(["sawa-serif", "status"]);
  });

  it("falls back to the default fonts list when the result would be empty", () => {
    const state = defaultState();
    const next = setFonts(state, ["bogus", "alsobogus"]);
    expect(next.fonts).toEqual(["sawa-serif", "sawa-sans", "status"]);
  });
});

describe("fam and wght", () => {
  it("parses each specimen family", () => {
    expect(parseState("fam=sawa-sans").family).toBe("sawa-sans");
    expect(parseState("fam=sawa-mono").family).toBe("sawa-mono");
  });

  it("falls back to sawa-serif for an unknown or non-Sawa family", () => {
    expect(parseState("fam=bogus").family).toBe("sawa-serif");
    expect(parseState("fam=amiri").family).toBe("sawa-serif");
  });

  it("omits the default family", () => {
    expect(toSearch({ ...defaultState(), family: "sawa-serif" })).toBe("");
  });

  it("parses an integer weight", () => {
    expect(parseState("wght=650").weight).toBe(650);
  });

  it("leaves weight undefined when absent or non-numeric", () => {
    expect(parseState("").weight).toBeUndefined();
    expect(parseState("wght=bold").weight).toBeUndefined();
    expect(parseState("wght=450.5").weight).toBeUndefined();
  });

  it("clamps weight to the CSS font-weight range", () => {
    expect(parseState("wght=0").weight).toBe(1);
    expect(parseState("wght=5000").weight).toBe(1000);
  });

  it("rounds a fractional weight passed directly", () => {
    expect(toSearch({ ...defaultState(), weight: 612.4 })).toBe("?wght=612");
  });

  it("drops a non-finite weight passed directly", () => {
    expect(toSearch({ ...defaultState(), weight: Number.NaN })).toBe("");
  });

  it("serialises fam and wght after preset and before size", () => {
    const state: PlaygroundState = {
      ...defaultState(),
      preset: "custom",
      text: "hi",
      family: "sawa-sans",
      weight: 700,
      size: 48,
    };
    expect(toSearch(state)).toBe("?text=hi&preset=custom&fam=sawa-sans&wght=700&size=48");
  });

  it("round-trips family and weight", () => {
    const state: PlaygroundState = { ...defaultState(), family: "sawa-mono", weight: 300 };
    expect(parseState(toSearch(state))).toEqual(state);
  });
});

describe("clampSize", () => {
  it("rounds and clamps to 12-144", () => {
    expect(clampSize(8)).toBe(12);
    expect(clampSize(200)).toBe(144);
    expect(clampSize(47.6)).toBe(48);
  });
});

describe("toggleFont", () => {
  it("appends a font that isn't selected", () => {
    expect(toggleFont(defaultState(), "amiri").fonts).toEqual([
      "sawa-serif",
      "sawa-sans",
      "status",
      "amiri",
    ]);
  });

  it("removes a selected font and drops its override", () => {
    const state = parseState("ov=2:pal=gray,3:pal=mono");
    const next = toggleFont(state, "sawa-sans");
    expect(next.fonts).toEqual(["sawa-serif", "status"]);
    expect(next.overrides).toEqual([{ pane: 2, pal: "mono" }]);
  });

  it("never empties the list", () => {
    const state = parseState("fonts=amiri");
    expect(toggleFont(state, "amiri")).toBe(state);
  });
});

describe("moveFont", () => {
  it("moves a font down and its override with it", () => {
    const next = moveFont(parseState("ov=1:pal=gray"), 0, 1);
    expect(next.fonts).toEqual(["sawa-sans", "sawa-serif", "status"]);
    expect(next.overrides).toEqual([{ pane: 2, pal: "gray" }]);
  });

  it("moves a font up", () => {
    expect(moveFont(defaultState(), 2, -1).fonts).toEqual(["sawa-serif", "status", "sawa-sans"]);
  });

  it("ignores a move past either end", () => {
    const state = defaultState();
    expect(moveFont(state, 0, -1)).toBe(state);
    expect(moveFont(state, 2, 1)).toBe(state);
    expect(moveFont(state, 5, -1)).toBe(state);
  });
});

describe("setOverride", () => {
  it("adds a font override for a pane", () => {
    expect(toSearch(setOverride(defaultState(), 2, "font", "amiri"))).toBe("?ov=2:font=amiri");
  });

  it("merges keys into an existing override", () => {
    const state = setOverride(parseState("ov=2:font=amiri"), 2, "pal", "gray");
    expect(state.overrides).toEqual([{ pane: 2, font: "amiri", pal: "gray" }]);
  });

  it("clears a key set back to the pane's own value", () => {
    const state = setOverride(parseState("ov=2:font=amiri;pal=gray"), 2, "font", "sawa-sans");
    expect(state.overrides).toEqual([{ pane: 2, pal: "gray" }]);
    expect(setOverride(state, 2, "pal", "groups").overrides).toEqual([]);
  });

  it("ignores a pane past the fonts list", () => {
    expect(setOverride(defaultState(), 4, "pal", "gray").overrides).toEqual([]);
  });
});

describe("toggleFeature", () => {
  it("adds and removes a tag", () => {
    const on = toggleFeature(defaultState(), "ss01");
    expect(on.features).toEqual(["ss01"]);
    expect(toggleFeature(on, "ss01").features).toEqual([]);
  });

  it("drops a tag that isn't four letters or digits", () => {
    expect(toggleFeature(defaultState(), "ss-1").features).toEqual([]);
  });
});

describe("visiblePanes", () => {
  it("shows every font when stacked, applying palette but not font overrides", () => {
    const state = parseState(
      "pal=gray&fonts=amiri,sch,noto,sawa-mono,status&ov=2:font=local,3:pal=mono",
    );
    const panes = visiblePanes(state);
    expect(panes).toHaveLength(5);
    expect(panes[1]).toEqual({ pane: 2, font: "sch", palette: "gray" });
    expect(panes[2]).toEqual({ pane: 3, font: "noto", palette: "mono" });
  });

  it("caps side by side at four panes and applies overrides", () => {
    const state = parseState(
      "view=side&fonts=amiri,sch,noto,sawa-mono,status&ov=2:font=local;pal=mono",
    );
    const panes = visiblePanes(state);
    expect(panes.map((pane) => pane.font)).toEqual(["amiri", "local", "noto", "sawa-mono"]);
    expect(panes[1]?.palette).toBe("mono");
  });
});
