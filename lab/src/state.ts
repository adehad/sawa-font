import { FORMS, type FontChoice, type Form } from "./types";

export const VIEWS = ["matrix", "overview", "notes", "primer"] as const;
export type View = (typeof VIEWS)[number];

/** What dragging on the inspector moves: a mark, the whole letter, one dot group, or an anchor. */
export const DRAG_MODES = ["mark", "letter", "dot", "anchor"] as const;
export type DragMode = (typeof DRAG_MODES)[number];

export interface ViewState {
  view: View;
  mark: string;
  letter: string | null;
  form: Form | null;
  font: FontChoice;
  offsets: boolean;
  niche: boolean;
  impossible: boolean;
  drag: DragMode;
  /** Draw the calibrated font from calib-preview.ttf, with the overrides baked in. */
  baked: boolean;
}

export const DEFAULT_STATE: ViewState = {
  view: "matrix",
  mark: "fatha",
  letter: null,
  form: null,
  font: "calib",
  offsets: true,
  niche: false,
  impossible: false,
  drag: "mark",
  baked: false,
};

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** The view a URL query names; anything missing or unknown falls back to the default. */
export function parseState(search: string): ViewState {
  const params = new URLSearchParams(search);
  // A hand-typed "U+0628" arrives with its plus decoded as a space.
  const letter = params.get("letter")?.replace(" ", "+") ?? null;
  const form = params.get("form");
  return {
    view: oneOf(params.get("view"), VIEWS, DEFAULT_STATE.view),
    mark: params.get("mark")?.match(/^[a-z0-9-]+$/)
      ? (params.get("mark") as string)
      : DEFAULT_STATE.mark,
    letter: letter && /^U\+[0-9A-F]{4,6}$/.test(letter) ? letter : null,
    form: form && (FORMS as readonly string[]).includes(form) ? (form as Form) : null,
    font: oneOf(params.get("font"), ["calib", "source"] as const, DEFAULT_STATE.font),
    offsets: params.get("offsets") !== "off",
    niche: params.get("niche") === "on",
    impossible: params.get("impossible") === "on",
    drag: oneOf(params.get("drag"), DRAG_MODES, DEFAULT_STATE.drag),
    baked: params.get("baked") === "on",
  };
}

/** The query string for `state`, leaving out what matches the default. */
export function serializeState(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
  if (state.mark !== DEFAULT_STATE.mark) params.set("mark", state.mark);
  if (state.letter && state.form) {
    params.set("letter", state.letter);
    params.set("form", state.form);
  }
  if (state.font !== DEFAULT_STATE.font) params.set("font", state.font);
  if (!state.offsets) params.set("offsets", "off");
  if (state.niche) params.set("niche", "on");
  if (state.impossible) params.set("impossible", "on");
  if (state.drag !== DEFAULT_STATE.drag) params.set("drag", state.drag);
  if (state.baked) params.set("baked", "on");
  const query = params.toString();
  return query ? `?${query}` : "";
}
