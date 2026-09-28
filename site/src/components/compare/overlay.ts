import { guideOffsets, type GuideMetrics, type GuideOffsets } from "../../fonts/compare";

export const GUIDE_NAMES = [
  "ascender",
  "capHeight",
  "xHeight",
  "baseline",
  "descender",
  "lineBox",
] as const;

export type GuideName = (typeof GUIDE_NAMES)[number];

export type GuideLabels = Record<GuideName, string>;

const OVERLAY_CLASS = "metrics-overlay";

/**
 * The baseline of every line in `text`, in px from `originTop`. A text
 * fragment's client rect starts at the primary font's rounded ascent above
 * its baseline, whatever fallback fonts the line also uses, so each distinct
 * rect top is one line.
 */
export function lineBaselines(text: HTMLElement, ascent: number, originTop: number): number[] {
  const range = document.createRange();
  range.selectNodeContents(text);
  const tops: number[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height === 0 || rect.width === 0) {
      continue;
    }
    const top = rect.top - originTop;
    if (!tops.some((seen) => Math.abs(seen - top) < 1)) {
      tops.push(top);
    }
  }
  return tops.toSorted((a, b) => a - b).map((top) => top + ascent);
}

const LABEL_HEIGHT = 12;

function guide(name: GuideName, top: number): HTMLElement {
  const line = document.createElement("div");
  line.className = name === "lineBox" ? "guide-box" : "guide";
  line.dataset.guide = name;
  line.style.insetBlockStart = `${top}px`;
  return line;
}

/**
 * Places the first line's labels in the gutter next to their guides, each
 * nudged down just enough not to overlap the one above.
 */
function labelElements(anchors: [GuideName, number][], labels: GuideLabels): HTMLElement[] {
  let floor = 0;
  return anchors
    .toSorted((a, b) => a[1] - b[1])
    .map(([name, y]) => {
      const top = Math.max(floor, y - LABEL_HEIGHT / 2);
      floor = top + LABEL_HEIGHT;
      const label = document.createElement("span");
      label.className = "guide-label";
      label.dataset.guideLabel = name;
      label.textContent = labels[name];
      label.style.insetBlockStart = `${top}px`;
      return label;
    });
}

/** Where one wrap's guides go, measured before anything is drawn. */
export interface OverlayPlan {
  readonly baselines: readonly number[];
  readonly offsets: GuideOffsets;
}

/** Reads the sample text's lines and the font's guide offsets; writes nothing. */
export function measureOverlay(wrap: HTMLElement, metrics: GuideMetrics): OverlayPlan | null {
  const text = wrap.querySelector<HTMLElement>("[data-sample-text]");
  if (!text) {
    return null;
  }
  const style = getComputedStyle(text);
  const fontSize = parseFloat(style.fontSize);
  const lineHeight =
    style.lineHeight === "normal" ? "normal" : parseFloat(style.lineHeight) / fontSize;
  const offsets = guideOffsets(metrics, fontSize, lineHeight);
  const origin = wrap.getBoundingClientRect().top;
  return { baselines: lineBaselines(text, -offsets.ascender, origin), offsets };
}

/**
 * Builds the guide layer for a plan, with the first line's labels for the
 * wrap's end gutter. The layer is dir="ltr" so the gutter is on the same side
 * in both UIs.
 */
export function buildOverlay(plan: OverlayPlan, labels: GuideLabels): HTMLElement {
  const { baselines, offsets } = plan;
  const layer = document.createElement("div");
  layer.className = OVERLAY_CLASS;
  layer.dir = "ltr";
  layer.setAttribute("aria-hidden", "true");
  baselines.forEach((baseline, index) => {
    const box = guide("lineBox", baseline + offsets.lineTop);
    box.style.blockSize = `${offsets.lineHeight}px`;
    box.dataset.parity = index % 2 === 0 ? "even" : "odd";
    const anchors: [GuideName, number][] = [
      ["ascender", baseline + offsets.ascender],
      ["baseline", baseline],
      ["descender", baseline + offsets.descender],
    ];
    if (offsets.capHeight !== null) {
      anchors.push(["capHeight", baseline + offsets.capHeight]);
    }
    if (offsets.xHeight !== null) {
      anchors.push(["xHeight", baseline + offsets.xHeight]);
    }
    layer.append(box, ...anchors.map(([name, y]) => guide(name, y)));
    if (index === 0) {
      const boxBottom = baseline + offsets.lineTop + offsets.lineHeight;
      layer.append(...labelElements([...anchors, ["lineBox", boxBottom]], labels));
    }
  });
  return layer;
}

/** Replaces the wrap's guide layer with `layer`, or removes it. */
export function placeOverlay(wrap: HTMLElement, layer: HTMLElement | null): void {
  const current = wrap.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (layer) {
    if (current) {
      current.replaceWith(layer);
    } else {
      wrap.append(layer);
    }
  } else {
    current?.remove();
  }
}
