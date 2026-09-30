import { clientFormat } from "./messages";
import { localFont, onLocalFont } from "./local-font";
import { buildOverlay, measureOverlay, placeOverlay, type GuideLabels } from "./overlay";
import { paneElement, type PaneContext } from "./pane-dom";
import { paneFont } from "./pane-font";
import { syncScroll } from "./sync-scroll";
import { absentFeatures, featureSettings } from "../../fonts/features";
import { commit, readState, subscribe } from "../../state/store";
import {
  clampSize,
  isFontOrLocal,
  isPalette,
  setOverride,
  visiblePanes,
  type FontOrLocal,
  type PlaygroundState,
} from "../../state/url";

function isolate(text: string): string {
  return `⁦${text}⁩`;
}

function setMeta(article: HTMLElement, name: string, text: string): void {
  const line = article.querySelector<HTMLElement>(`[data-${name}]`);
  if (line) {
    line.textContent = text;
  }
}

/** Renders the Compare panes into `stage` and keeps them in step with the URL state. */
export function mountStage(stage: HTMLElement, panes: HTMLElement): void {
  const format = clientFormat();
  const tagList = new Intl.ListFormat(document.documentElement.lang, { type: "unit" });
  const guideLabels: GuideLabels = {
    lineBox: format("compare.guide.lineBox"),
    ascender: format("compare.guide.ascender"),
    capHeight: format("compare.guide.capHeight"),
    xHeight: format("compare.guide.xHeight"),
    baseline: format("compare.guide.baseline"),
    descender: format("compare.guide.descender"),
  };
  const context: PaneContext = {
    format,
    locale: document.documentElement.lang === "ar" ? "ar" : "en",
    guideLabels,
  };
  const note = (name: string) => stage.querySelector<HTMLElement>(`[data-${name}]`);
  const tanzilCredit = note("tanzil-credit");
  const sideLimit = note("side-limit");
  const sideTooFew = note("side-too-few");
  const fontOverrides = note("font-overrides-note");
  let structureKey = "";
  let unsync: (() => void) | undefined;
  let overlayFrame = 0;

  function metricsNote(id: FontOrLocal): string {
    if (id === "status") {
      return format("compare.metricsStatus");
    }
    const metrics = paneFont(id).metrics;
    if (metrics === "woff2") {
      return format("compare.metricsWoff2");
    }
    return metrics === "unreadable" ? format("compare.metricsUnreadable") : "";
  }

  function featureNote(id: FontOrLocal, feat: readonly string[]): string {
    const font = paneFont(id);
    if (font.features === null) {
      return font.stack !== "" && feat.length > 0 ? format("compare.featuresUnknown") : "";
    }
    const absent = absentFeatures(feat, font.features);
    return absent.length > 0
      ? format("compare.featuresAbsent", { tags: isolate(tagList.format(absent)) })
      : "";
  }

  function applyStyles(state: PlaygroundState): void {
    panes.querySelectorAll<HTMLElement>("[data-pane]").forEach((article) => {
      const id = article.dataset.paneFont ?? "";
      const body = article.querySelector<HTMLElement>("[data-pane-body]");
      if (!body || !isFontOrLocal(id)) {
        return;
      }
      const font = paneFont(id);
      const weight = font.weight(state.weight);
      const palette = body.dataset.pal ?? "";
      body.style.fontFamily = isPalette(palette) ? font.stackFor(palette) : font.stack;
      body.style.fontWeight = String(weight.weight);
      body.style.fontFeatureSettings = featureSettings(state.features);
      body.style.setProperty("--sample-size", `${clampSize(state.size)}px`);
      body.style.lineHeight = state.lineHeight === "default" ? "normal" : String(state.lineHeight);
      article.dataset.guides = String(
        state.metrics && typeof font.metrics === "object" && body.dataset.placeholder === undefined,
      );
      setMeta(
        article,
        "pane-weight",
        format(weight.nearest ? "compare.paneWeightStatic" : "compare.paneWeight", {
          weight: weight.weight,
        }),
      );
      setMeta(article, "pane-features", featureNote(id, state.features));
      setMeta(article, "pane-metrics", state.metrics ? metricsNote(id) : "");
    });
  }

  /** Measures every wrap first, then swaps in every layer, so layout is read once. */
  function drawOverlays(): void {
    const state = readState();
    const plans = [...panes.querySelectorAll<HTMLElement>("[data-pane]")].flatMap((article) => {
      const id = article.dataset.paneFont ?? "";
      const metrics = isFontOrLocal(id) ? paneFont(id).metrics : "none";
      return [...article.querySelectorAll<HTMLElement>("[data-sample-wrap]")].map((wrap) => ({
        wrap,
        plan: state.metrics && typeof metrics === "object" ? measureOverlay(wrap, metrics) : null,
      }));
    });
    for (const { wrap, plan } of plans) {
      placeOverlay(wrap, plan ? buildOverlay(plan, guideLabels) : null);
    }
    panes.dataset.overlay = state.metrics ? "drawn" : "off";
  }

  function scheduleOverlays(): void {
    cancelAnimationFrame(overlayFrame);
    panes.dataset.overlay = "pending";
    overlayFrame = requestAnimationFrame(drawOverlays);
  }

  function render(state: PlaygroundState): void {
    const side = state.view === "side";
    const specs = visiblePanes(state);
    const key = JSON.stringify({
      side,
      specs,
      preset: state.preset,
      text: state.text,
      waterfall: state.waterfall ? clampSize(state.size) : 0,
      local: localFont()?.family,
    });
    if (key !== structureKey) {
      structureKey = key;
      const focused = document.activeElement;
      const refocus =
        focused instanceof HTMLSelectElement && panes.contains(focused)
          ? `[data-pane-control="${focused.dataset.paneControl}"][data-pane-index="${focused.dataset.paneIndex}"]`
          : undefined;
      unsync?.();
      unsync = undefined;
      panes.dataset.view = state.view;
      panes.style.setProperty("--columns", String(specs.length));
      panes.replaceChildren(...specs.map((spec) => paneElement(context, spec, state, side)));
      if (side) {
        unsync = syncScroll([...panes.querySelectorAll<HTMLElement>("[data-pane-body]")]);
      }
      if (refocus) {
        panes.querySelector<HTMLElement>(refocus)?.focus();
      }
    }
    applyStyles(state);
    scheduleOverlays();

    if (state.background) {
      stage.dataset.bg = state.background;
    } else {
      delete stage.dataset.bg;
    }
    stage.dataset.view = state.view;
    panes.dataset.showMetrics = state.metrics ? "on" : "off";
    if (tanzilCredit) {
      tanzilCredit.hidden = state.preset !== "quran";
    }
    if (sideLimit) {
      sideLimit.hidden = !side || state.fonts.length <= 4;
    }
    if (sideTooFew) {
      sideTooFew.hidden = !side || state.fonts.length >= 2;
    }
    if (fontOverrides) {
      fontOverrides.hidden =
        side || !state.overrides.some((override) => override.font !== undefined);
    }
  }

  subscribe(render);
  onLocalFont(() => render(readState()));
  new ResizeObserver(scheduleOverlays).observe(panes);
  document.fonts.addEventListener("loadingdone", scheduleOverlays);

  panes.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const pane = Number(select.dataset.paneIndex);
    const value = select.value;
    const state = readState();
    if (select.dataset.paneControl === "font" && isFontOrLocal(value)) {
      commit(setOverride(state, pane, "font", value));
    } else if (select.dataset.paneControl === "pal" && isPalette(value)) {
      commit(setOverride(state, pane, "pal", value));
    }
  });
}
