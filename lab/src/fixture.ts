import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Edits } from "./edits";
import { HbFont } from "./hb";
import { type Baked, Model } from "./model";
import type { Positioning } from "./positioning";
import { DEFAULT_STATE } from "./state";
import type { LabData } from "./types";

/** What `sawa lab fonts` writes, for the tests that read the real fonts. */
export const FONTS = fileURLToPath(new URL("../public/fonts/", import.meta.url));

export function present(...files: string[]): boolean {
  return files.every((file) => existsSync(`${FONTS}${file}`));
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(`${FONTS}${file}`, "utf8"));
}

export function font(file: string): HbFont {
  return new HbFont(readFileSync(`${FONTS}${file}`));
}

/** The lab's model over the written fonts, with the baked preview when asked for. */
export function labModel(edits: Edits, baked?: Baked): Model {
  const data = readJson("lab.json") as LabData;
  return new Model(
    data,
    {
      calib: font(data.fonts.calib),
      notoArabic: font(data.fonts.notoArabic),
      notoSans: font(data.fonts.notoSans),
      ...(baked ? { preview: font("calib-preview.ttf") } : {}),
    },
    DEFAULT_STATE,
    [],
    edits,
    baked ?? null,
    readJson(data.fonts.positioning ?? "positioning.json") as Positioning,
  );
}
