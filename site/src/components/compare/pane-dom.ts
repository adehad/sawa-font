import { fontNameKey, type ClientKey, type Format } from "./messages";
import { localFont } from "./local-font";
import { GUIDE_NAMES, type GuideLabels } from "./overlay";
import { paneFont } from "./pane-font";
import { waterfallSizes } from "../../fonts/compare";
import { FONT_ROSTER } from "../../fonts/roster";
import { PALETTE_NAMES } from "../../fonts/specimen";
import { compareBlocks, type SampleBlock } from "../../samples";
import {
  clampSize,
  type FontOrLocal,
  visiblePanes,
  type PlaygroundState,
  type VisiblePane,
} from "../../state/url";

/** What building a pane needs from the page. */
export interface PaneContext {
  readonly format: Format;
  readonly locale: "en" | "ar";
  readonly guideLabels: GuideLabels;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** A font's name on the Compare page; a loaded local font goes by its file name. */
export function fontName(format: Format, id: FontOrLocal): string {
  if (id === "local") {
    return localFont()?.fileName ?? format(fontNameKey(id));
  }
  return format(fontNameKey(id));
}

function fontNote(format: Format, id: FontOrLocal): string {
  return id === "local" ? format("compare.localNote") : format(`font.${id}.note`);
}

function overrideSelect(
  context: PaneContext,
  state: PlaygroundState,
  spec: VisiblePane,
  key: "font" | "pal",
  labelKey: ClientKey,
): HTMLLabelElement {
  const { format } = context;
  const label = element("label", "pane-override");
  label.append(element("span", "pane-override-label", format(labelKey)));
  const select = element("select");
  select.dataset.paneControl = key;
  select.dataset.paneIndex = String(spec.pane);
  const options: [string, string][] =
    key === "font"
      ? [...FONT_ROSTER, "local" as const].map((id) => [id, fontName(format, id)])
      : PALETTE_NAMES.map((palette) => [palette, format(`palette.${palette}`)]);
  for (const [value, text] of options) {
    const option = element("option", undefined, text);
    option.value = value;
    select.append(option);
  }
  select.value = key === "font" ? spec.font : spec.palette;
  if (key === "pal" && !paneFont(spec.font).hasPalettes) {
    select.disabled = true;
    const any = visiblePanes(state).some((pane) => paneFont(pane.font).hasPalettes);
    select.setAttribute(
      "aria-describedby",
      any ? "compare-palette-harakat" : "compare-palette-none",
    );
  }
  label.append(select);
  return label;
}

function sampleText(text: string, size?: number): HTMLElement {
  const wrap = element("div", "sample-wrap");
  wrap.dataset.sampleWrap = "";
  // The overlay's label gutter must sit on the same side in both UIs.
  wrap.dir = "ltr";
  const paragraph = element("p", "sample-text", text);
  paragraph.dir = "auto";
  paragraph.dataset.sampleText = "";
  if (size !== undefined) {
    paragraph.style.setProperty("--row-size", `${size}px`);
  }
  wrap.append(paragraph);
  return wrap;
}

function sampleBlock(context: PaneContext, block: SampleBlock, state: PlaygroundState) {
  const container = element(block.caption ? "figure" : "div", "sample");
  if (state.waterfall) {
    for (const size of waterfallSizes(clampSize(state.size))) {
      const row = element("div", "sample-row");
      const label = element(
        "span",
        "sample-size",
        context.format("compare.waterfallSize", { size }),
      );
      row.append(label, sampleText(block.text, size));
      container.append(row);
    }
  } else {
    container.append(sampleText(block.text));
  }
  if (block.caption) {
    container.append(element("figcaption", "sample-caption", block.caption[context.locale]));
  }
  return container;
}

/** The key to the guide lines, shown instead of line labels when a pane is narrow. */
function guideLegend(labels: GuideLabels): HTMLElement {
  const legend = element("ul", "guide-legend");
  legend.dataset.guideLegend = "";
  for (const name of GUIDE_NAMES) {
    const item = element("li");
    const swatch = element("span", "legend-swatch");
    swatch.dataset.guide = name;
    item.append(swatch, element("span", undefined, labels[name]));
    legend.append(item);
  }
  return legend;
}

export function paneElement(
  context: PaneContext,
  spec: VisiblePane,
  state: PlaygroundState,
  side: boolean,
): HTMLElement {
  const { format } = context;
  const article = element("article", "pane");
  article.dataset.pane = String(spec.pane);
  article.dataset.paneFont = spec.font;
  const nameId = `compare-pane-${spec.pane}-name`;
  article.setAttribute("aria-labelledby", nameId);

  const head = element("header", "pane-head");
  const name = element("h3", "pane-name", fontName(format, spec.font));
  name.id = nameId;
  if (spec.font === "local") {
    name.dir = "auto";
  }
  head.append(name, element("p", "pane-note", fontNote(format, spec.font)));
  for (const meta of ["paneWeight", "paneFeatures", "paneMetrics"]) {
    const line = element("p", "pane-meta");
    line.dataset[meta] = "";
    head.append(line);
  }
  head.append(guideLegend(context.guideLabels));
  if (side) {
    const overrides = element("div", "pane-overrides");
    overrides.append(
      overrideSelect(context, state, spec, "font", "compare.paneFont"),
      overrideSelect(context, state, spec, "pal", "compare.panePalette"),
    );
    head.append(overrides);
  }

  const body = element("div", "pane-body");
  body.dataset.paneBody = "";
  body.dataset.pal = spec.palette;
  if (side) {
    body.tabIndex = 0;
    body.setAttribute("role", "region");
    body.setAttribute("aria-labelledby", nameId);
  }
  if (spec.font === "local" && !localFont()) {
    body.append(element("p", "pane-placeholder", format("compare.localPlaceholder")));
    body.dataset.placeholder = "";
  } else {
    for (const block of compareBlocks(state.preset, state.text)) {
      body.append(sampleBlock(context, block, state));
    }
  }
  article.append(head, body);
  return article;
}
