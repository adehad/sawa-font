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

/**
 * The Harakat builds: a Sawa family's twin with its marks coloured from
 * COLR/CPAL palettes. They are not roster fonts of their own; the gray and
 * groups palettes show a pane's family in its twin.
 */
export const HARAKAT_TWINS = {
  "sawa-serif": "sawa-serif-harakat",
  "sawa-sans": "sawa-sans-harakat",
} as const satisfies Partial<Record<FontId, string>>;

export type HarakatId = (typeof HARAKAT_TWINS)[keyof typeof HARAKAT_TWINS];

function hasTwin(id: string): id is keyof typeof HARAKAT_TWINS {
  return Object.hasOwn(HARAKAT_TWINS, id);
}

/** The id of `id`'s Harakat twin, if it has one. */
export function harakatTwin(id: string): HarakatId | undefined {
  return hasTwin(id) ? HARAKAT_TWINS[id] : undefined;
}
