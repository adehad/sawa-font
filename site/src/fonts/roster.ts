/** The font ids shown on the Specimen and Compare pages, in display order. */
export const FONT_ROSTER = ["sawa", "status", "amiri", "amiriq", "sch", "noto"] as const;

export type FontId = (typeof FONT_ROSTER)[number];
