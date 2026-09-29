import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localizedPath } from "../../src/i18n/paths";
import { BASE_PATH } from "./config";

const DIST_DIR = path.resolve(import.meta.dirname, "../../dist");
const BUNDLE_DIR = path.join(DIST_DIR, "report-bundle");

/** The site's own pages, leaving out the copied report bundle. */
async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.startsWith(`${BUNDLE_DIR}${path.sep}`));
}

function extractHref(tag: string): string | null {
  const match = tag.match(/\shref="([^"]*)"/);
  return match ? match[1] : null;
}

function isAllowed(href: string): boolean {
  return href.startsWith("https://") || href.startsWith(BASE_PATH);
}

test("only the report page and the root redirect are built", async () => {
  const files = await findHtmlFiles(DIST_DIR);
  const relative = files
    .map((file) => path.relative(DIST_DIR, file).split(path.sep).join("/"))
    .toSorted();
  expect(relative).toEqual(["ar/report/index.html", "en/report/index.html", "index.html"]);
});

test("dist/fonts ships only the Sawa families, not the whole comparison roster", async () => {
  const entries = await readdir(path.join(DIST_DIR, "fonts"), { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  expect(dirs).toEqual(["sawa-mono", "sawa-sans", "sawa-serif"]);
});

test("every <a href> and <link rel=alternate> is external or under the base path", async () => {
  const files = await findHtmlFiles(DIST_DIR);
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

test("the primary nav shows only the report link", async ({ page }) => {
  await page.goto(localizedPath(BASE_PATH, "en", "report"));
  const navLinks = page.locator(".site-header nav a");
  await expect(navLinks).toHaveCount(1);
  await expect(navLinks.first()).toHaveAttribute("href", localizedPath(BASE_PATH, "en", "report"));
});

test("the root redirect lands on the report page", async ({ page }) => {
  await page.goto(BASE_PATH);
  await page.waitForURL((url) => url.pathname !== BASE_PATH);
  expect(new URL(page.url()).pathname).toBe(localizedPath(BASE_PATH, "en", "report"));
});

test("language switch moves between /en/report/ and /ar/report/", async ({ page }) => {
  await page.goto(localizedPath(BASE_PATH, "en", "report"));
  await page.locator("[data-lang-switcher] summary").click();
  await page.locator('[data-lang-switcher] a[data-locale="ar"]').click();
  await expect(page).toHaveURL(localizedPath(BASE_PATH, "ar", "report"));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("no request for the built pages fails, so assets resolve under the base path", async ({
  page,
}) => {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(localizedPath(BASE_PATH, "en", "report"));
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
});
