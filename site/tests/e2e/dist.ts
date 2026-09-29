import { readdir } from "node:fs/promises";
import path from "node:path";

export const DIST_DIR = path.resolve(import.meta.dirname, "../../dist");

// Astro's own output always double-quotes attributes, so extraction regexes
// over dist/ HTML only need to match the double-quoted form.

/** The copied report bundle: Fontbakery's own HTML, not pages this site renders. */
const BUNDLE_DIR = path.join(DIST_DIR, "report-bundle");

/** The site's own pages under `dir`, leaving out the copied report bundle. */
export async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.startsWith(`${BUNDLE_DIR}${path.sep}`));
}
