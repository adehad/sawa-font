export const FORMS = ["isolated", "initial", "medial", "final"] as const;
export type Form = (typeof FORMS)[number];

export interface Letter {
  char: string;
  codepoint: string;
  name: string;
  joining: "dual" | "right" | "none";
  forms: Form[];
  /** Everyday mark sequences ordinary spelling never puts on this letter. */
  implausible: string[];
}

export interface MarkSequence {
  id: string;
  label: string;
  codepoints: string[];
}

export interface Matrix {
  zwj: string;
  forms: Form[];
  letters: Letter[];
  everyday: MarkSequence[];
  everydayCodepoints: string[];
  niche: MarkSequence[];
}

export interface Metrics {
  unitsPerEm: number;
  xHeight: number;
  capHeight: number;
  ascender: number;
  descender: number;
  hheaAscender: number;
  hheaDescender: number;
}

export interface LabData {
  build: string;
  family: string;
  wght: number;
  arabicScale: number;
  fonts: { calib: string; notoArabic: string; notoSans: string };
  harfbuzz: { harfbuzz: string; uharfbuzz: string };
  metrics: Metrics;
  approvedLineBox: { height: number; basis: string };
  clearance: number;
  matrix: Matrix;
}

export type FontChoice = "calib" | "source";

export const NO_MARK: MarkSequence = { id: "none", label: "no mark", codepoints: [] };
