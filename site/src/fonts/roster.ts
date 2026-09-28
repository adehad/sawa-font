/** The font ids shown on the Specimen and Compare pages, in display order. */
export const FONT_ROSTER = [
  "sawa-serif",
  "sawa-sans",
  "sawa-mono",
  "status",
  "amiri",
  "amiriq",
  "sch",
  "noto",
  "noto-sans",
] as const;

export type FontId = (typeof FONT_ROSTER)[number];
