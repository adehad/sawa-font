import { readdir } from "node:fs/promises";
import path from "node:path";

export const DIST_DIR = path.resolve(import.meta.dirname, "../../dist");

// Astro's own output always double-quotes attributes, so extraction regexes
// over dist/ HTML only need to match the double-quoted form.

export async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}
