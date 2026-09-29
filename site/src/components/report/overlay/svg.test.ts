import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layerPaths } from "./svg";

const FIXTURE = new URL(
  "../../../report/__fixtures__/bundle/tests/shadda-kasra-default/",
  import.meta.url,
);

function fixtureLayer(file: string): string {
  return readFileSync(new URL(file, FIXTURE), "utf-8");
}

describe("layerPaths", () => {
  it("reads the outline of a bundle layer", () => {
    const paths = layerPaths(fixtureLayer("sawa-serif.svg"));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^M[\d.-]/);
  });

  it("gives identical data for Sawa Sans and its upstream layer", () => {
    expect(layerPaths(fixtureLayer("sawa-sans.svg"))).toEqual(
      layerPaths(fixtureLayer("upstream-sans.svg")),
    );
    expect(layerPaths(fixtureLayer("sawa-serif.svg"))).not.toEqual(
      layerPaths(fixtureLayer("upstream-serif.svg")),
    );
  });

  it("keeps only path data, skipping empty paths and other elements", () => {
    const svg =
      '<svg><script>alert(1)</script><path fill="red" d="M0 0L1 1Z"/><path d=""/><path class="x" d="M2 2Z"></path></svg>';
    expect(layerPaths(svg)).toEqual(["M0 0L1 1Z", "M2 2Z"]);
  });
});
