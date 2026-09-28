import { localFont } from "./local-font";
import {
  COMPARE_WEIGHT,
  compareFont,
  renderedWeight,
  type GuideMetrics,
  type RenderedWeight,
} from "../../fonts/compare";
import { loadFontsData } from "../../fonts/load";
import { FONT_ROSTER, type FontId } from "../../fonts/roster";
import type { FontOrLocal } from "../../state/url";

/** Why a pane has no metrics to draw. */
export type MetricsGap = "woff2" | "unreadable" | "none";

/** Everything a pane needs about its font, whether from fonts.json or the visitor's file. */
export interface PaneFont {
  /** Empty for the local pane before a file is loaded. */
  readonly stack: string;
  /** null when the file's features can't be read. */
  readonly features: readonly string[] | null;
  readonly hasPalettes: boolean;
  readonly metrics: GuideMetrics | MetricsGap;
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
            features: font.features,
            hasPalettes: font.hasPalettes,
            metrics: font.metrics,
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
  if (!local) {
    return {
      stack: "",
      features: null,
      hasPalettes: false,
      metrics: "none",
      weight: (target) => ({ weight: target ?? COMPARE_WEIGHT.default, nearest: false }),
    };
  }
  const stack = `"${local.family}", sans-serif`;
  if (local.sfnt.kind !== "ok") {
    return {
      stack,
      features: null,
      hasPalettes: false,
      metrics: local.sfnt.kind,
      weight: (target) => ({ weight: target ?? COMPARE_WEIGHT.default, nearest: false }),
    };
  }
  const { info } = local.sfnt;
  const staticWeights = info.weightClass ? [info.weightClass] : [];
  return {
    stack,
    features: info.features,
    hasPalettes: info.hasPalettes,
    metrics: info.metrics,
    weight: (target) => renderedWeight(target, { axis: info.axis, staticWeights }),
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
