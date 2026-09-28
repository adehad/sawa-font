/** Mirrors the fonts.json written by `sawa build fonts` (src/sawa_tools/build/fonts.py). */

export type FontWeight = 400 | 700;
export type FontStyle = "normal" | "italic";

export interface HheaMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
}

export interface TypoMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
  useTypoMetrics: boolean;
}

export interface WinMetrics {
  ascent: number;
  descent: number;
}

export interface ColrInfo {
  version: number;
}

/**
 * OpenType CPAL v1 palette type flags resolve to "light" or "dark"; a v0
 * table, or a v1 table with neither or both flags set, has no fixed type.
 */
export type PaletteType = "light" | "dark" | null;

export interface CpalInfo {
  palettes: number;
  types: PaletteType[];
}

export interface FamilyInfo {
  unitsPerEm: number;
  hhea: HheaMetrics;
  typo: TypoMetrics;
  win: WinMetrics;
  xHeight: number | null;
  capHeight: number | null;
  features: string[];
  scripts: string[];
  colr: ColrInfo | null;
  cpal: CpalInfo | null;
}

export interface Face {
  family: string;
  weight: FontWeight;
  style: FontStyle;
  file: string;
}

export type GenericFamily = "serif" | "sans-serif";

export interface FontEntry {
  name: string;
  stack: string[];
  generic: GenericFamily;
  faces: Face[];
  families: Record<string, FamilyInfo>;
}

export interface FontsData {
  fonts: Record<string, FontEntry>;
}
