import type { FontEntry, FontWeight, FontsData } from "./types";

/** The three Sawa families, the only fonts the report-only build serves. */
export const SAWA_FONT_IDS = ["sawa-serif", "sawa-sans", "sawa-mono"] as const;

function joinUrl(baseUrl: string, relative: string): string {
  return baseUrl.endsWith("/") ? `${baseUrl}${relative}` : `${baseUrl}/${relative}`;
}

function weightDescriptor(weight: FontWeight): string {
  return typeof weight === "number" ? `${weight}` : `${weight[0]} ${weight[1]}`;
}

/**
 * Builds one @font-face rule per face, across the whole roster, or just
 * `only`'s font ids when given (the report-only build has no use for the
 * comparison roster).
 */
export function fontFaceCss(data: FontsData, baseUrl: string, only?: readonly string[]): string {
  const entries: FontEntry[] = only
    ? only.map((id) => data.fonts[id]).filter((entry): entry is FontEntry => Boolean(entry))
    : Object.values(data.fonts);
  const rules: string[] = [];
  for (const entry of entries) {
    for (const face of entry.faces) {
      const url = joinUrl(baseUrl, `fonts/${face.file}`);
      rules.push(
        [
          "@font-face {",
          `  font-family: "${face.family}";`,
          `  src: url("${url}") format("woff2");`,
          `  font-weight: ${weightDescriptor(face.weight)};`,
          `  font-style: ${face.style};`,
          "  font-display: swap;",
          "}",
        ].join("\n"),
      );
    }
  }
  return rules.join("\n\n");
}

/**
 * A font's CSS font-family value, in its fallback order, ending with the
 * font's own generic family from fonts.json. Status quo has no Arabic on
 * purpose, so its generic is sans-serif: it falls back to the system's own
 * Arabic font rather than a serif.
 */
export function fontStack(data: FontsData, id: string): string {
  const entry = data.fonts[id];
  if (!entry) {
    throw new Error(`fontStack: unknown font id "${id}"`);
  }
  return [...entry.stack.map((family) => `"${family}"`), entry.generic].join(", ");
}
