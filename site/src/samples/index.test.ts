import { describe, expect, test } from "vitest";
import { langRuns, mixedSentences, presets, specimenSample, specimenStrings } from "./index";
import uthmaniFatihaRaw from "../../../data/tanzil/uthmani-fatiha.txt?raw";

describe("presets", () => {
  test("all three presets load", () => {
    expect(presets.mixed.length).toBeGreaterThan(0);
    expect(presets.quran.length).toBeGreaterThan(0);
    expect(presets.stress.length).toBeGreaterThan(0);
  });

  test("quran has 7 verses", () => {
    expect(presets.quran).toHaveLength(7);
  });

  test("first verse equals the excerpt's first line exactly", () => {
    const expectedFirstLine = uthmaniFatihaRaw.split("\n")[0];
    expect(presets.quran[0]).toBe(expectedFirstLine);
  });

  test("no copyright text leaks into the verses", () => {
    for (const verse of presets.quran) {
      expect(verse).not.toContain("#");
      expect(verse).not.toContain("Tanzil");
      expect(verse).not.toContain("COPYRIGHT");
    }
  });

  test("stress tests carry their id, text and purpose", () => {
    for (const stressTest of presets.stress) {
      expect(stressTest.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(stressTest.text.length).toBeGreaterThan(0);
      expect(stressTest.purpose.en.length).toBeGreaterThan(0);
      expect(stressTest.purpose.ar.length).toBeGreaterThan(0);
    }
  });
});

describe("specimenSample", () => {
  test("uses the first mixed sentence for the mixed preset", () => {
    expect(specimenSample("mixed", "ignored")).toBe(mixedSentences[0]);
  });

  test("returns the custom text as typed", () => {
    expect(specimenSample("custom", "Salam سلام")).toBe("Salam سلام");
  });

  test("puts one Fatiha verse per line for the quran preset", () => {
    expect(specimenSample("quran", "").split("\n")).toEqual(presets.quran);
  });
});

describe("langRuns", () => {
  test("splits a bilingual sentence into an English and an Arabic run", () => {
    expect(langRuns("Hello, world. مرحبا بكم.")).toEqual([
      { lang: "en", text: "Hello, world. " },
      { lang: "ar", text: "مرحبا بكم." },
    ]);
  });

  test("keeps the text intact across runs", () => {
    const text = specimenStrings.familyCard;
    expect(
      langRuns(text)
        .map((run) => run.text)
        .join(""),
    ).toBe(text);
  });

  test("tags Arabic letters with their marks as one run", () => {
    expect(langRuns("صَحْرَاء")).toEqual([{ lang: "ar", text: "صَحْرَاء" }]);
  });
});
