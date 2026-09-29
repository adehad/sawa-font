import { IntlMessageFormat } from "intl-messageformat";
import { LayerCanvas, type FontLayer, type GuideName } from "./overlay/canvas";
import { fetchLayer } from "./overlay/svg";
import { selectedTest } from "./test-list";
import { upstreamLayer, type ReportFamily } from "../../report/types";
import type { ViewerData, ViewerTest } from "../../report/viewer-data";
import { commitReport, readReportState, subscribeReport } from "../../state/store";
import {
  REPORT_LAYERS,
  REPORT_MODES,
  REPORT_ZOOMS,
  toggleReportLayer,
  type ReportLayer,
  type ReportState,
} from "../../state/url";

type Paths = Record<FontLayer, readonly string[]>;

function readData(root: HTMLElement): ViewerData | undefined {
  const text = root.querySelector("script[data-viewer-data]")?.textContent;
  if (!text) return undefined;
  // Written by LayerViewer.astro from the validated bundle.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(text) as ViewerData;
}

function isOneOf<T extends string>(options: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (options as readonly string[]).includes(value);
}

function isFamily(value: string | undefined): value is ReportFamily {
  return value === "sawa-serif" || value === "sawa-sans" || value === "sawa-mono";
}

function update(change: (state: ReportState) => ReportState): void {
  commitReport(change(readReportState()));
}

function press(buttons: readonly HTMLButtonElement[], key: string, value: string): void {
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset[key] === value));
  }
}

/** Wires the viewer's controls and canvas to the report state in the URL. */
export function mountViewer(root: HTMLElement): void {
  const embedded = readData(root);
  if (!embedded) {
    const status = root.querySelector<HTMLElement>("[data-viewer-status]");
    if (status) status.textContent = root.dataset.noData ?? "";
    return;
  }
  const data = embedded;
  const locale = document.documentElement.lang;
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const formatters = new Map<string, IntlMessageFormat>();
  const format = (key: string, values?: Record<string, string | number>): string => {
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new IntlMessageFormat(data.messages[key] ?? key, locale);
      formatters.set(key, formatter);
    }
    return String(formatter.format(values));
  };
  const guideLabel = (name: GuideName) => format(`compare.guide.${name}`);
  const overlay = root.querySelector<HTMLElement>("[data-overlay]");
  if (!overlay) return;
  const canvas = new LayerCanvas(
    overlay,
    {
      swipe: format("report.swipe"),
      percent: (value) => percent.format(value / 100),
      guides: {
        lineBox: guideLabel("lineBox"),
        ascender: guideLabel("ascender"),
        capHeight: guideLabel("capHeight"),
        xHeight: guideLabel("xHeight"),
        baseline: guideLabel("baseline"),
        descender: guideLabel("descender"),
      },
    },
    (swipe) => commitReport({ ...readReportState(), swipe }),
  );

  const all = <T extends HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const familyButtons = all<HTMLButtonElement>("[data-viewer-family]");
  const modeButtons = all<HTMLButtonElement>("[data-viewer-mode]");
  const zoomButtons = all<HTMLButtonElement>("[data-viewer-zoom]");
  const layerInputs = all<HTMLInputElement>("[data-viewer-layer]");
  const opacityControl = root.querySelector<HTMLElement>("[data-opacity-control]");
  const opacityInput = root.querySelector<HTMLInputElement>("[data-viewer-opacity]");
  const opacityOutput = root.querySelector<HTMLOutputElement>("[data-viewer-opacity-output]");
  const status = root.querySelector<HTMLElement>("[data-viewer-status]");
  const diffNote = root.querySelector<HTMLElement>("[data-diff-note]");
  const ids = data.tests.map((test) => test.id);
  const loaded = new Map<string, Paths>();
  const failed = new Set<string>();
  const pending = new Set<string>();

  for (const button of familyButtons) {
    button.addEventListener("click", () => {
      const family = button.dataset.viewerFamily;
      if (isFamily(family)) update((state) => ({ ...state, family }));
    });
  }
  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.viewerMode;
      if (isOneOf(REPORT_MODES, mode)) update((state) => ({ ...state, mode }));
    });
  }
  for (const button of zoomButtons) {
    button.addEventListener("click", () => {
      const zoom = button.dataset.viewerZoom;
      if (isOneOf(REPORT_ZOOMS, zoom)) update((state) => ({ ...state, zoom }));
    });
  }
  for (const input of layerInputs) {
    input.addEventListener("change", () => {
      const layer = input.dataset.viewerLayer;
      if (isOneOf<ReportLayer>(REPORT_LAYERS, layer)) {
        update((state) =>
          state.layers.includes(layer) === input.checked ? state : toggleReportLayer(state, layer),
        );
      }
    });
  }
  opacityInput?.addEventListener("input", () => {
    update((state) => ({ ...state, opacity: Number(opacityInput.value) }));
  });

  function syncControls(state: ReportState): void {
    press(familyButtons, "viewerFamily", state.family);
    press(modeButtons, "viewerMode", state.mode);
    press(zoomButtons, "viewerZoom", state.zoom);
    for (const input of layerInputs) {
      input.checked = (state.layers as readonly string[]).includes(input.dataset.viewerLayer ?? "");
    }
    if (opacityControl) opacityControl.hidden = state.mode !== "onion";
    if (opacityInput) opacityInput.value = String(state.opacity);
    if (opacityOutput) opacityOutput.textContent = percent.format(state.opacity / 100);
  }

  function syncNotes(test: ViewerTest, layerIds: Record<FontLayer, string>, family: string): void {
    for (const font of ["sawa", "upstream"] as const) {
      const name = root.querySelector<HTMLElement>(`[data-legend-name="${font}"]`);
      if (name) name.textContent = test.layers[layerIds[font]]?.name ?? "";
    }
    if (diffNote) {
      const regions = test.diffRegions[family]?.length ?? 0;
      const lines = [format("report.diffCount", { count: regions })];
      if (test.diffAgainst[family] === "previous") {
        lines.push(
          format("report.diffPrevious", {
            version: `⁦${root.dataset.previousVersion ?? ""}⁩`,
          }),
        );
      }
      diffNote.textContent = lines.join(" ");
    }
  }

  function render(state: ReportState): void {
    const test = data.tests.find((entry) => entry.id === selectedTest(state, ids));
    if (!test) return;
    syncControls(state);
    const layerIds = { sawa: state.family, upstream: upstreamLayer(state.family) };
    syncNotes(test, layerIds, state.family);
    const urls = {
      sawa: `${data.bundleBase}tests/${test.id}/${test.layers[layerIds.sawa]?.file ?? ""}`,
      upstream: `${data.bundleBase}tests/${test.id}/${test.layers[layerIds.upstream]?.file ?? ""}`,
    };
    const key = `${urls.sawa}|${urls.upstream}`;
    const paths = loaded.get(key);
    canvas.render({ ...state, test, layerIds, paths });
    if (status) {
      status.textContent = paths
        ? ""
        : format(failed.has(key) ? "report.loadError" : "report.loading");
    }
    if (paths || failed.has(key) || pending.has(key)) return;
    pending.add(key);
    Promise.all([fetchLayer(urls.sawa), fetchLayer(urls.upstream)])
      .then(([sawa, upstream]) => loaded.set(key, { sawa, upstream }))
      .catch(() => {
        failed.add(key);
      })
      .finally(() => {
        pending.delete(key);
        render(readReportState());
      });
  }

  subscribeReport(render);
}
