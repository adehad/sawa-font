import type { FontWeight, FontsData } from "./types";

function joinUrl(baseUrl: string, relative: string): string {
  return baseUrl.endsWith("/") ? `${baseUrl}${relative}` : `${baseUrl}/${relative}`;
}

function weightDescriptor(weight: FontWeight): string {
  return typeof weight === "number" ? `${weight}` : `${weight[0]} ${weight[1]}`;
}

/** Builds one @font-face rule per face across the whole roster. */
export function fontFaceCss(data: FontsData, baseUrl: string): string {
  const rules: string[] = [];
  for (const entry of Object.values(data.fonts)) {
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
