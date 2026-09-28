import { localFont } from "./local-font";
import {
  COMPARE_WEIGHT,
  compareFont,
  renderedWeight,
  type RenderedWeight,
} from "../../fonts/compare";
import { loadFontsData } from "../../fonts/load";
import { FONT_ROSTER, type FontId } from "../../fonts/roster";
import type { FontOrLocal } from "../../state/url";

/** Everything a pane needs about its font, whether from fonts.json or the visitor's file. */
export interface PaneFont {
  /** Empty for the local pane before a file is loaded. */
  readonly stack: string;
  weight(target: number | undefined): RenderedWeight;
}

let roster: Map<FontId, PaneFont> | undefined;

function rosterFonts(): Map<FontId, PaneFont> {
  if (!roster) {
    const data = loadFontsData();
    roster = new Map(
      FONT_ROSTER.map((id) => {
        const font = compareFont(data, id);
        return [
          id,
          {
            stack: font.stack,
            weight: (target) => renderedWeight(target, font),
          },
        ];
      }),
    );
  }
  return roster;
}

function localPaneFont(): PaneFont {
  const local = localFont();
  return {
    stack: local ? `"${local.family}", sans-serif` : "",
    weight: (target) => ({ weight: target ?? COMPARE_WEIGHT.default, nearest: false }),
  };
}

export function paneFont(id: FontOrLocal): PaneFont {
  if (id === "local") {
    return localPaneFont();
  }
  const font = rosterFonts().get(id);
  if (!font) {
    throw new Error(`no font "${id}" on the roster`);
  }
  return font;
}
