import mixedData from "../../../tests/strings/mixed.json";
import stressData from "../../../tests/strings/stress.json";
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

export interface Presets {
  readonly mixed: string;
  readonly quran: readonly string[];
  readonly stress: readonly StressTest[];
}

export const presets: Presets = {
  mixed: (mixedData as MixedData).sentences.map((sentence) => sentence.text).join("\n"),
  quran: parseVerses(uthmaniFatihaRaw),
  stress: (stressData as StressData).tests,
};
