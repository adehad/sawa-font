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
  /** Keyed "U+0628|initial". */
  letterForms: Record<string, LetterForm>;
  glyphs: Record<string, GlyphInfo>;
  /** Keyed by the letter's codepoint. */
  lines: Record<string, LetterLines>;
  credits: { tanzil: string };
}

export type FontChoice = "calib" | "source";

export const NO_MARK: MarkSequence = { id: "none", label: "no mark", codepoints: [] };

export interface PartInfo {
  /** "body", a dot glyph's name, or "component:N" / "contours:A,B" inside the body glyph. */
  id: string;
  kind: "body" | "dots" | "mark";
  glyph: string;
  label: string;
  position?: "above" | "below" | "inside";
  count?: number;
  contours?: number[];
  component?: number;
  /** SVG path in font units; the glyph table has it, a letter form's list does not. */
  d?: string;
}

export interface Anchor {
  kind: "base" | "ligature" | "mark" | "mark2";
  x: number;
  y: number;
  lookups: string[];
}

export interface GlyphInfo {
  advance: number;
  class: string;
  parts: PartInfo[];
  anchors: Anchor[];
}

export interface LetterForm {
  glyphs: string[];
  body: string | null;
  parts: PartInfo[];
}

export interface EdgeLine {
  kind: "font" | "situational" | "word";
  text: string;
  label: string;
  glyph?: string;
  lookup?: number;
  feature?: string;
  context?: string;
  source?: { corpus: "mixed" | "stress" | "tanzil"; ref: string };
}

export interface LetterLines {
  lines: EdgeLine[];
  unreached: { glyph: string; lookup: number; feature: string; context: string }[];
}
