import { readSfnt, type SfntResult } from "../../fonts/sfnt";

/** A font file the visitor picked, loaded into this tab only. */
export interface LocalFont {
  /** A family name unique to this load, so a replaced file never shadows the new one. */
  readonly family: string;
  readonly fileName: string;
  /** The file's own metrics, features and weight axis, when it can be read. */
  readonly sfnt: SfntResult;
}

const EVENT = "sawa:local-font";

let current: LocalFont | undefined;
let currentUrl: string | undefined;
let currentFace: FontFace | undefined;
let loads = 0;

export function localFont(): LocalFont | undefined {
  return current;
}

/** Calls `listener` after every successful load. */
export function onLocalFont(listener: (font: LocalFont) => void): void {
  window.addEventListener(EVENT, () => {
    if (current) {
      listener(current);
    }
  });
}

/** The FontFace weight: the wght axis range, the OS/2 weight class, or the default. */
function weightDescriptor(sfnt: SfntResult): string {
  if (sfnt.kind !== "ok") {
    return "normal";
  }
  const { axis, weightClass } = sfnt.info;
  if (axis) {
    return `${axis.min} ${axis.max}`;
  }
  return weightClass ? String(weightClass) : "normal";
}

/**
 * Loads `file` as a FontFace from an object URL. The file never leaves the
 * browser. The previous face and URL are released once the new one loads.
 * Resolves to undefined when a later call superseded this one mid-load.
 */
export async function loadLocalFont(file: File): Promise<LocalFont | undefined> {
  loads += 1;
  const token = loads;
  const family = `sawa-local-${token}`;
  const sfnt = await readSfnt(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  const face = new FontFace(family, `url("${url}")`, { weight: weightDescriptor(sfnt) });
  try {
    await face.load();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  if (token !== loads) {
    URL.revokeObjectURL(url);
    return undefined;
  }
  document.fonts.add(face);
  if (currentFace) {
    document.fonts.delete(currentFace);
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
  }
  currentFace = face;
  currentUrl = url;
  current = { family, fileName: file.name, sfnt };
  window.dispatchEvent(new Event(EVENT));
  return current;
}
