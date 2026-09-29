import type { Box, Guides } from "../../../report/types";
import type { ViewerTest } from "../../../report/viewer-data";
import type { ReportLayer, ReportMode, ReportZoom } from "../../../state/url";

const SVG_NS = "http://www.w3.org/2000/svg";

export type FontLayer = "sawa" | "upstream";

export type GuideName = "lineBox" | "ascender" | "capHeight" | "xHeight" | "baseline" | "descender";

const GUIDE_LINES: readonly Exclude<GuideName, "lineBox">[] = [
  "ascender",
  "capHeight",
  "xHeight",
  "baseline",
  "descender",
];

export interface CanvasLabels {
  readonly swipe: string;
  readonly percent: (value: number) => string;
  readonly guides: Readonly<Record<GuideName, string>>;
}

export interface CanvasInput {
  readonly test: ViewerTest;
  /** Layer ids in the test, e.g. sawa-serif and upstream-serif. */
  readonly layerIds: Readonly<Record<FontLayer, string>>;
  readonly mode: ReportMode;
  readonly opacity: number;
  readonly swipe: number;
  readonly layers: readonly ReportLayer[];
  readonly zoom: ReportZoom;
  /** Each font layer's path data; undefined until both files have loaded. */
  readonly paths: Readonly<Record<FontLayer, readonly string[]>> | undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** The swipe position after a key press on the divider, or undefined for keys it ignores. */
export function swipeAfterKey(value: number, key: string, shift = false): number | undefined {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampPercent(value - step);
    case "ArrowRight":
    case "ArrowUp":
      return clampPercent(value + step);
    case "PageDown":
      return clampPercent(value - 10);
    case "PageUp":
      return clampPercent(value + 10);
    case "Home":
      return 0;
    case "End":
      return 100;
    default:
      return undefined;
  }
}

/** The swipe position under a pointer at `clientX` over a frame starting at `left`. */
export function swipeAtPointer(clientX: number, left: number, width: number): number {
  return width <= 0 ? 50 : clampPercent(((clientX - left) / width) * 100);
}

/** The narrowest fit frame: one whose height is --fit-min-block, so glyphs stay legible. */
export function fitMinWidth(viewBox: readonly number[]): string {
  return `calc(var(--fit-min-block) * ${(viewBox[2] ?? 0) / (viewBox[3] ?? 1)})`;
}

/**
 * The CSS width of a frame for a viewBox. 100% draws one SVG unit per CSS
 * pixel; fit fills the width without growing taller than --fit-block or
 * shrinking below fitMinWidth, past which the overlay scrolls instead.
 */
export function frameWidth(viewBox: readonly number[], zoom: ReportZoom): string {
  const width = viewBox[2] ?? 0;
  const height = viewBox[3] ?? 1;
  if (zoom === "fit") {
    return `max(${fitMinWidth(viewBox)}, min(100%, calc(var(--fit-block) * ${width / height})))`;
  }
  return `${(width * Number(zoom)) / 100}px`;
}

/** The font layers each pane stacks, bottom first. */
export function paneLayers(mode: ReportMode): FontLayer[][] {
  return mode === "side" ? [["sawa"], ["upstream"]] : [["upstream", "sawa"]];
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function layerSvg(viewBox: string, attributes: Record<string, string>): SVGSVGElement {
  return svgElement("svg", { viewBox, "aria-hidden": "true", ...attributes });
}

function guideSvg(viewBox: readonly number[], guides: Guides, labels: CanvasLabels): SVGGElement {
  const [minX = 0, , width = 0] = viewBox;
  const group = svgElement("g", {});
  const band = svgElement("rect", {
    x: minX,
    y: guides.lineBoxTop,
    width,
    height: guides.lineBoxBottom - guides.lineBoxTop,
    "data-guide": "lineBox",
  });
  band.append(Object.assign(svgElement("title", {}), { textContent: labels.guides.lineBox }));
  group.append(band);
  for (const name of GUIDE_LINES) {
    const line = svgElement("line", {
      x1: minX,
      x2: minX + width,
      y1: guides[name],
      y2: guides[name],
      "data-guide": name,
    });
    line.append(Object.assign(svgElement("title", {}), { textContent: labels.guides[name] }));
    group.append(line);
  }
  return group;
}

function diffRect(box: Box): SVGRectElement {
  return svgElement("rect", {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    "data-diff-region": "",
  });
}

/**
 * Draws a test's Sawa layer and its upstream layer on one shared viewBox, with
 * guides and diff regions, in onion, swipe or side-by-side mode. Geometry
 * only: labels and controls live outside, in the page's own direction.
 */
export class LayerCanvas {
  private structure = "";
  private readonly frames: HTMLElement[] = [];
  private divider: HTMLElement | undefined;
  private swipe = 50;

  constructor(
    private readonly root: HTMLElement,
    private readonly labels: CanvasLabels,
    private readonly onSwipe: (value: number) => void,
  ) {}

  render(input: CanvasInput): void {
    const key = [
      input.test.id,
      input.layerIds.sawa,
      input.mode,
      input.paths === undefined ? "loading" : "ready",
    ].join("|");
    if (key !== this.structure) {
      this.structure = key;
      this.build(input);
    }
    this.apply(input);
  }

  private build(input: CanvasInput): void {
    const { test, layerIds, paths } = input;
    const viewBox = test.viewBox.join(" ");
    const scroll = document.createElement("div");
    scroll.className = "overlay-scroll";
    const panes = document.createElement("div");
    panes.className = "overlay-panes";
    scroll.append(panes);
    this.frames.length = 0;
    this.divider = undefined;

    for (const [index, fonts] of paneLayers(input.mode).entries()) {
      const pane = document.createElement("div");
      pane.className = "overlay-pane";
      pane.dataset.pane = String(index + 1);
      const frame = document.createElement("div");
      frame.className = "overlay-frame";
      frame.dataset.frame = "";
      frame.style.aspectRatio = `${test.viewBox[2]} / ${test.viewBox[3]}`;

      for (const font of fonts) {
        const svg = layerSvg(viewBox, { "data-layer": font, "data-font": font });
        svg.dataset.layerId = layerIds[font];
        for (const d of paths?.[font] ?? []) {
          svg.append(svgElement("path", { d, fill: "currentColor" }));
        }
        frame.append(svg);
      }
      for (const font of fonts) {
        const guides = test.layers[layerIds[font]]?.guides;
        if (guides) {
          const svg = layerSvg(viewBox, { "data-layer": "guides", "data-font": font });
          svg.append(guideSvg(test.viewBox, guides, this.labels));
          frame.append(svg);
        }
      }
      const diff = layerSvg(viewBox, { "data-layer": "diff" });
      for (const box of test.diffRegions[layerIds.sawa] ?? []) {
        diff.append(diffRect(box));
      }
      frame.append(diff);

      if (input.mode === "swipe") {
        frame.append(this.buildDivider());
        this.bindPointer(frame);
      }
      pane.append(frame);
      if (input.mode === "side") {
        const caption = document.createElement("p");
        caption.className = "overlay-caption";
        caption.dataset.font = fonts[0];
        caption.textContent = test.layers[layerIds[fonts[0] ?? "sawa"]]?.name ?? "";
        pane.append(caption);
      }
      panes.append(pane);
      this.frames.push(frame);
    }
    this.root.replaceChildren(scroll);
  }

  private buildDivider(): HTMLElement {
    const divider = document.createElement("div");
    divider.className = "swipe-divider";
    divider.tabIndex = 0;
    divider.setAttribute("role", "slider");
    divider.setAttribute("aria-label", this.labels.swipe);
    divider.setAttribute("aria-orientation", "horizontal");
    divider.setAttribute("aria-valuemin", "0");
    divider.setAttribute("aria-valuemax", "100");
    divider.dataset.swipe = "";
    divider.addEventListener("keydown", (event) => {
      const next = swipeAfterKey(this.swipe, event.key, event.shiftKey);
      if (next !== undefined) {
        event.preventDefault();
        this.onSwipe(next);
      }
    });
    this.divider = divider;
    return divider;
  }

  private bindPointer(frame: HTMLElement): void {
    const move = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      this.onSwipe(swipeAtPointer(event.clientX, rect.left, rect.width));
    };
    frame.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      frame.setPointerCapture(event.pointerId);
      this.divider?.focus();
      move(event);
      frame.addEventListener("pointermove", move);
      const stop = () => {
        frame.removeEventListener("pointermove", move);
        frame.removeEventListener("pointerup", stop);
        frame.removeEventListener("pointercancel", stop);
      };
      frame.addEventListener("pointerup", stop);
      frame.addEventListener("pointercancel", stop);
    });
  }

  private apply(input: CanvasInput): void {
    this.swipe = input.swipe;
    this.root.dataset.mode = input.mode;
    this.root.dataset.zoom = input.zoom;
    this.root.dataset.state = input.paths === undefined ? "loading" : "ready";
    const width = frameWidth(input.test.viewBox, input.zoom);
    const swipeClip: Record<FontLayer, string> = {
      sawa: `inset(0 ${100 - input.swipe}% 0 0)`,
      upstream: `inset(0 0 0 ${input.swipe}%)`,
    };
    const paneMin = input.zoom === "fit" ? fitMinWidth(input.test.viewBox) : "";
    for (const frame of this.frames) {
      frame.style.width = width;
      if (frame.parentElement) frame.parentElement.style.minWidth = paneMin;
      for (const element of frame.querySelectorAll<SVGSVGElement>("svg[data-layer]")) {
        const layer = element.dataset.layer ?? "";
        const font = element.dataset.font;
        element.toggleAttribute("hidden", !(input.layers as readonly string[]).includes(layer));
        const isFont = font === "sawa" || font === "upstream";
        element.style.opacity =
          input.mode === "onion" && font === "upstream" ? String(input.opacity / 100) : "";
        element.style.clipPath = input.mode === "swipe" && isFont ? swipeClip[font] : "";
      }
    }
    if (this.divider) {
      this.divider.style.left = `${input.swipe}%`;
      this.divider.setAttribute("aria-valuenow", String(input.swipe));
      this.divider.setAttribute("aria-valuetext", this.labels.percent(input.swipe));
    }
  }
}
