import { clientFormat } from "./messages";
import { localFont, onLocalFont } from "./local-font";
import { paneElement, type PaneContext } from "./pane-dom";
import { paneFont } from "./pane-font";
import { syncScroll } from "./sync-scroll";
import { commit, readState, subscribe } from "../../state/store";
import {
  clampSize,
  isFontOrLocal,
  isPalette,
  setOverride,
  visiblePanes,
  type PlaygroundState,
} from "../../state/url";

function setMeta(article: HTMLElement, name: string, text: string): void {
  const line = article.querySelector<HTMLElement>(`[data-${name}]`);
  if (line) {
    line.textContent = text;
  }
}

/** Renders the Compare panes into `stage` and keeps them in step with the URL state. */
export function mountStage(stage: HTMLElement, panes: HTMLElement): void {
  const format = clientFormat();
  const context: PaneContext = {
    format,
    locale: document.documentElement.lang === "ar" ? "ar" : "en",
  };
  const note = (name: string) => stage.querySelector<HTMLElement>(`[data-${name}]`);
  const tanzilCredit = note("tanzil-credit");
  const sideLimit = note("side-limit");
  const sideTooFew = note("side-too-few");
  const fontOverrides = note("font-overrides-note");
  let structureKey = "";
  let unsync: (() => void) | undefined;

  function applyStyles(state: PlaygroundState): void {
    panes.querySelectorAll<HTMLElement>("[data-pane]").forEach((article) => {
      const id = article.dataset.paneFont ?? "";
      const body = article.querySelector<HTMLElement>("[data-pane-body]");
      if (!body || !isFontOrLocal(id)) {
        return;
      }
      const font = paneFont(id);
      const weight = font.weight(state.weight);
      body.style.fontFamily = font.stack;
      body.style.fontWeight = String(weight.weight);
      body.style.setProperty("--sample-size", `${clampSize(state.size)}px`);
      body.style.lineHeight = state.lineHeight === "default" ? "normal" : String(state.lineHeight);
      setMeta(
        article,
        "pane-weight",
        format(weight.nearest ? "compare.paneWeightStatic" : "compare.paneWeight", {
          weight: weight.weight,
        }),
      );
    });
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

    if (state.background) {
      stage.dataset.bg = state.background;
    } else {
      delete stage.dataset.bg;
    }
    stage.dataset.view = state.view;
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
