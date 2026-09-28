import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import stylelint from "stylelint";
import { decodeHtmlEntities } from "../../src/lib/html-entities";
import { DIST_DIR, findHtmlFiles } from "./dist";

const CONFIG_FILE = path.resolve(import.meta.dirname, "../../.stylelintrc.json");
const CONFIG_DIR = path.dirname(CONFIG_FILE);

function extractStyleAttrValues(html: string): string[] {
  return [...html.matchAll(/\sstyle="([^"]*)"/g)].map((match) => decodeHtmlEntities(match[1]));
}

// Mapped under src/pages so the config's own report/overlay override applies here too.
function toCodeFilename(relativeDistFile: string): string {
  return path.join(CONFIG_DIR, "src/pages", relativeDistFile);
}

async function lintDeclarationBlock(value: string, codeFilename: string) {
  const result = await stylelint.lint({
    code: `a{${value}}`,
    codeFilename,
    configFile: CONFIG_FILE,
  });
  return result.results[0].warnings;
}

// postcss-html lints <style> blocks, not style attributes.
test("every inline style attribute in built pages follows the logical-properties rule", async () => {
  const files = await findHtmlFiles(DIST_DIR);
  expect(files.length).toBeGreaterThan(0);

  // Zero style="" attributes in the current build is legitimate, so an empty
  // scan below must not be read as a pass by default: prove the same
  // extraction and lint call flags a violation outside report/overlay and
  // allows it inside.
  const [canaryValue] = extractStyleAttrValues('<p style="margin-left:0">');
  expect(canaryValue).toBe("margin-left:0");

  const canaryWarnings = await lintDeclarationBlock(
    canaryValue,
    toCodeFilename("en/about/index.html"),
  );
  expect(canaryWarnings.some((warning) => warning.rule === "csstools/use-logical")).toBe(true);

  const overlayWarnings = await lintDeclarationBlock(
    canaryValue,
    toCodeFilename("en/report/overlay/index.html"),
  );
  expect(overlayWarnings).toHaveLength(0);

  const offenders: string[] = [];
  for (const file of files) {
    const html = await readFile(file, "utf-8");
    const relativeFile = path.relative(DIST_DIR, file);
    const codeFilename = toCodeFilename(relativeFile);

    for (const value of extractStyleAttrValues(html)) {
      const warnings = await lintDeclarationBlock(value, codeFilename);
      for (const warning of warnings) {
        offenders.push(`${relativeFile}: ${warning.text}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
