import mixedData from "../../../tests/strings/mixed.json";
import stressData from "../../../tests/strings/stress.json";
import type { Preset } from "../state/url";
import uthmaniFatihaRaw from "../../../data/tanzil/uthmani-fatiha.txt?raw";

/** tests/strings/mixed.json's shape. */
interface MixedSentence {
  readonly id: string;
  readonly text: string;
}

interface MixedData {
  readonly licence: string;
  readonly note: string;
  readonly sentences: readonly MixedSentence[];
}

/** tests/strings/stress.json's shape; also the report pipeline's per-test input. */
export interface StressTest {
  readonly id: string;
  readonly text: string;
  readonly features?: readonly string[];
  readonly purpose: {
    readonly en: string;
    readonly ar: string;
  };
}

interface StressData {
  readonly licence: string;
  readonly tests: readonly StressTest[];
}

const COPYRIGHT_MARKER = "# PLEASE DO NOT REMOVE";

/**
 * Splits a Tanzil excerpt file into its verse lines, dropping the blank
 * separator line and the copyright block that follows it.
 */
function parseVerses(raw: string): readonly string[] {
  const markerIndex = raw.indexOf(COPYRIGHT_MARKER);
  const versesBlock = markerIndex === -1 ? raw : raw.slice(0, markerIndex);
  return versesBlock.split("\n").filter((line) => line.length > 0);
}

/** The mixed sentences one by one, in file order. */
export const mixedSentences: readonly string[] = (mixedData as MixedData).sentences.map(
  (sentence) => sentence.text,
);

export interface Presets {
  readonly mixed: string;
  readonly quran: readonly string[];
  readonly stress: readonly StressTest[];
}

export const presets: Presets = {
  mixed: mixedSentences.join("\n"),
  quran: parseVerses(uthmaniFatihaRaw),
  stress: (stressData as StressData).tests,
};

/**
 * The Specimen page's editable sample for a preset: the first mixed sentence
 * for `mixed`, every Fatiha verse or stress string one per line otherwise.
 */
export function specimenSample(preset: Preset, customText: string): string {
  if (preset === "custom") {
    return customText;
  }
  if (preset === "quran") {
    return presets.quran.join("\n");
  }
  if (preset === "stress") {
    return presets.stress.map((stressTest) => stressTest.text).join("\n");
  }
  return mixedSentences[0] ?? "";
}

function mixedSentence(id: string): string {
  const sentence = (mixedData as MixedData).sentences.find((candidate) => candidate.id === id);
  if (!sentence) {
    throw new Error(`tests/strings/mixed.json: no sentence "${id}"`);
  }
  return sentence.text;
}

export interface LangRun {
  readonly lang: "ar" | "en";
  readonly text: string;
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * Splits mixed text into runs tagged `ar` or `en` by the script of their
 * letters. Spaces, digits and punctuation stay with the run before them.
 */
export function langRuns(text: string): LangRun[] {
  const runs: { lang: "ar" | "en"; text: string }[] = [];
  for (const char of text) {
    let lang: "ar" | "en" | undefined;
    if (ARABIC_LETTER.test(char)) {
      lang = "ar";
    } else if (LATIN_LETTER.test(char)) {
      lang = "en";
    }
    const last = runs.at(-1);
    if (last && (lang === undefined || lang === last.lang)) {
      last.text += char;
    } else {
      runs.push({ lang: lang ?? "en", text: char });
    }
  }
  return runs;
}

/** Specimen page strings, all project-written and CC0 like tests/strings/mixed.json. */
export const specimenStrings = {
  /** Paragraph for the line-height comparison: several lines, both scripts on most of them. */
  lineHeight: mixedSentences.slice(0, 4).join(" "),
  familyCard: mixedSentence("family-card"),
  code: [
    'const greeting = "مرحبا بالعالم";',
    'const labels = { save: "حفظ", cancel: "إلغاء" };',
    "",
    "function welcome(name: string): string {",
    "  return `${greeting}, ${name}!`;",
    "}",
  ].join("\n"),
} as const;

/** One run of specimen text on the Compare page, with a caption for stress tests. */
export interface SampleBlock {
  readonly text: string;
  readonly caption?: StressTest["purpose"];
}

/**
 * The Compare page's specimen text for a preset: every mixed sentence or
 * Fatiha verse on its own line in one block, one block per stress test with
 * its purpose as the caption, or the custom text as it is.
 */
export function compareBlocks(preset: Preset, customText: string): readonly SampleBlock[] {
  if (preset === "custom") {
    return [{ text: customText }];
  }
  if (preset === "quran") {
    return [{ text: presets.quran.join("\n") }];
  }
  if (preset === "stress") {
    return presets.stress.map((stressTest) => ({
      text: stressTest.text,
      caption: stressTest.purpose,
    }));
  }
  return [{ text: presets.mixed }];
}

/** The text the Compare sample box shows for a preset, one block per line. */
export function compareSample(preset: Preset, customText: string): string {
  return compareBlocks(preset, customText)
    .map((block) => block.text)
    .join("\n");
}
