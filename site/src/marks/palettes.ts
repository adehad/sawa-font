import palettesData from "../../../data/palettes.json" with { type: "json" };
import { MARK_GROUPS, type MarkGroupId } from "./groups";

/** The colour-carrying palettes; "mono" is the plain family, with no CPAL at all. */
export type ColourPalette = "gray" | "groups";
export type Scheme = "light" | "dark";

export interface SchemeColours {
  readonly light: string;
  readonly dark: string;
}

/** One CPAL palette of the Harakat builds, at its index in the font. */
export interface CpalPalette {
  readonly palette: ColourPalette;
  readonly scheme: Scheme;
  readonly index: number;
}

export const COLOUR_PALETTES: readonly ColourPalette[] = ["gray", "groups"];
const SCHEMES: readonly string[] = ["light", "dark"] satisfies Scheme[];

function isColourPalette(value: string): value is ColourPalette {
  return (COLOUR_PALETTES as readonly string[]).includes(value);
}

function isScheme(value: string): value is Scheme {
  return SCHEMES.includes(value);
}

/** data/palettes.json's `order`: the CPAL palette the font build writes at each index. */
export const CPAL_PALETTES: readonly CpalPalette[] = palettesData.order.map((entry, index) => {
  if (!isColourPalette(entry.palette) || !isScheme(entry.scheme)) {
    throw new Error(`palettes.json: unknown palette "${entry.palette}" / "${entry.scheme}"`);
  }
  return { palette: entry.palette, scheme: entry.scheme, index };
});

const GROUP_COLOURS: Record<string, SchemeColours> = palettesData.groups;

/** Each mark group's light and dark colour: the same values as the fonts' "groups" palettes. */
export function groupColours(id: MarkGroupId): SchemeColours {
  const colours = GROUP_COLOURS[id];
  if (!colours) {
    throw new Error(`palettes.json: no colours for mark group "${id}"`);
  }
  return colours;
}

export const GRAY_COLOURS: SchemeColours = palettesData.gray;

/** The `--mark-<group>` custom properties, each resolving through light-dark(). */
export function markTokens(): string[] {
  return MARK_GROUPS.map((group) => {
    const { light, dark } = groupColours(group.id);
    return `--mark-${group.id}: light-dark(${light}, ${dark});`;
  });
}
