import path from "node:path";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const configFile = fileURLToPath(new URL("../../.stylelintrc.json", import.meta.url));
const configDir = path.dirname(configFile);

async function lint(code: string, codeFilename: string) {
  const result = await stylelint.lint({
    code,
    // Resolved against the config file's own directory: override globs like
    // "src/**/report/overlay/**" are matched relative to there, not to cwd.
    codeFilename: path.join(configDir, codeFilename),
    configFile,
  });
  return result.results[0].warnings;
}

describe("csstools/use-logical", () => {
  it("flags a physical property in a normal path", async () => {
    const warnings = await lint("p { margin-left: 4px; }", "src/components/Card.css");
    expect(warnings.some((warning) => warning.rule === "csstools/use-logical")).toBe(true);
  });

  it("allows a physical property under the report overlay allow-list", async () => {
    const warnings = await lint(
      "p { margin-left: 4px; }",
      "src/pages/report/overlay/canvas.css",
    );
    expect(warnings).toHaveLength(0);
  });

  it("flags a physical property inside an .astro <style> block", async () => {
    const astroSource = [
      "---",
      "const x = 1;",
      "---",
      "<p>Hi</p>",
      "<style>",
      "  p { margin-left: 4px; }",
      "</style>",
      "",
    ].join("\n");
    const warnings = await lint(astroSource, "src/components/Card.astro");
    expect(warnings.some((warning) => warning.rule === "csstools/use-logical")).toBe(true);
  });
});
