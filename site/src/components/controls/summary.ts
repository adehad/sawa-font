export const SUMMARY_SEPARATOR = " · ";

/** The summary's parts, trimmed, with empty ones dropped. */
export function summaryParts(parts: readonly (string | undefined)[]): string[] {
  return parts.map((part) => part?.trim() ?? "").filter((part) => part.length > 0);
}

/** One line naming the current settings, e.g. "Sawa Sans · 400 · 32 px · Groups". */
export function formatSummary(parts: readonly (string | undefined)[]): string {
  return summaryParts(parts).join(SUMMARY_SEPARATOR);
}

/** Fills each `{name}` in a message with its value; unknown names stay as written. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
