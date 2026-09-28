import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BASE_PATH } from "./config";
import { DIST_DIR, findHtmlFiles } from "./dist";

function extractHref(tag: string): string | null {
  const match = tag.match(/\shref="([^"]*)"/);
  return match ? match[1] : null;
}

function isAllowed(href: string): boolean {
  return href.startsWith("https://") || href.startsWith(BASE_PATH);
}

test("every <a href> and <link rel=alternate> is external or under the base path", async () => {
  const files = await findHtmlFiles(DIST_DIR);
  expect(files.length).toBeGreaterThan(0);

  const offenders: string[] = [];
  for (const file of files) {
    const html = await readFile(file, "utf-8");
    const relativeFile = path.relative(DIST_DIR, file);

    for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
      const href = extractHref(tag);
      if (href && !isAllowed(href)) {
        offenders.push(`${relativeFile}: <a href="${href}">`);
      }
    }

    for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
      if (!/\brel="alternate"/.test(tag)) continue;
      const href = extractHref(tag);
      if (href && !isAllowed(href)) {
        offenders.push(`${relativeFile}: <link rel="alternate" href="${href}">`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
