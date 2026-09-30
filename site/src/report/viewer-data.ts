import { LAYERED_FAMILIES, type Box, type Guides, type ReportBundle } from "./types";

export interface ViewerLayer {
  readonly file: string;
  readonly name: string;
  readonly guides: Guides | undefined;
}

/** What the layer viewer needs of one test, embedded in the page as JSON. */
export interface ViewerTest {
  readonly id: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly layers: Readonly<Record<string, ViewerLayer>>;
  readonly diffRegions: Readonly<Record<string, readonly Box[]>>;
  readonly diffAgainst: Readonly<Record<string, string>>;
}

export interface ViewerData {
  /** `<base>/report-bundle/`, where the layer files are served. */
  readonly bundleBase: string;
  readonly tests: readonly ViewerTest[];
  /** Raw ICU messages the viewer formats in the browser. */
  readonly messages: Readonly<Record<string, string>>;
}

export function viewerTests(bundle: ReportBundle): ViewerTest[] {
  return bundle.tests.map((test) => {
    const layers: Record<string, ViewerLayer> = {};
    for (const layer of test.layers) {
      layers[layer.id] = { file: layer.file, name: layer.name, guides: test.guides[layer.id] };
    }
    const diffRegions: Record<string, readonly Box[]> = {};
    const diffAgainst: Record<string, string> = {};
    for (const family of LAYERED_FAMILIES) {
      diffRegions[family] = test.diffRegions[family] ?? [];
      diffAgainst[family] = test.diffAgainst[family] ?? "upstream";
    }
    return { id: test.id, viewBox: test.viewBox, layers, diffRegions, diffAgainst };
  });
}

/** The page's JSON block, escaped so no value can close the script element. */
export function viewerJson(data: ViewerData): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
