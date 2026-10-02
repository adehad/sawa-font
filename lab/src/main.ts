import "./style.css";
import { type Layout, type Placement, analyse, contextBase, layoutBox } from "./cells";
import { h, s } from "./dom";
import {
  type Edits,
  History,
  NO_EDITS,
  type Offset,
  SCOPE_LABELS,
  type Scope,
  type Stamp,
  type Target,
  moveBy,
  offsetOf,
  reset,
  targetId,
} from "./edits";
import { em, lineBox } from "./envelope";
import { arrowStep, leftToRight } from "./forms";
import { bounds } from "./geometry";
import { HbFont, harfbuzzVersion } from "./hb";
import { type Baked, type Cell, Model, cellId, cellKey } from "./model";
import { NO_POSITIONING, type Positioning, markClass } from "./positioning";
import { type Handle, type ScopeOption, blastRadius, scopeOptions } from "./scope";
import { DRAG_MODES, type DragMode, type View, parseState, serializeState } from "./state";
import {
  type Note,
  type NotePart,
  STATUSES,
  type Severity,
  type Status,
  TAGS,
  TAG_LABELS,
  type Tag,
  annotationsFile,
  keyId,
  loadNotes,
  loadOverrides,
  mergeNotes,
  mergeOverrides,
  overridesFile,
  parseAnnotations,
  parseOverrides,
  saveNotes,
  saveOverrides,
} from "./store";
import { summary } from "./summary";
import { type EdgeLine, type FontChoice, type Form, type LabData, NO_MARK } from "./types";

const BASE = import.meta.env.BASE_URL;
/** Inspector scale: 0.3 px per font unit puts the em at 300 px, shrunk to fit every form. */
const INSPECTOR_SCALE = 0.3;
const MIN_INSPECTOR_SCALE = 0.16;
const CANVAS_WIDTH = 1080;
const CONTEXT_SCALE = 0.11;
/** Edge-case lines at reading size (24 px per em) and large (64 px per em). */
const READING_SCALE = 0.024;
const LARGE_SCALE = 0.064;

const DRAG_LABELS: Record<DragMode, string> = {
  mark: "Marks",
  letter: "Whole letter",
  dot: "Dots",
  anchor: "Anchors",
};
/** How many affected cells the blast radius draws; the rest are counted. */
const BLAST_SHOWN = 24;

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`${BASE}fonts/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.arrayBuffer();
}

/** calib-preview.ttf and what was baked into it, when `sawa lab preview` has run. */
async function loadPreview(): Promise<{ font: ArrayBuffer; baked: Baked } | null> {
  try {
    const [font, baked] = await Promise.all([
      fetch(`${BASE}fonts/calib-preview.ttf`),
      fetch(`${BASE}fonts/calib-preview.json`),
    ]);
    if (!font.ok || !baked.ok) return null;
    return { font: await font.arrayBuffer(), baked: (await baked.json()) as Baked };
  } catch {
    return null;
  }
}

async function load(): Promise<Model> {
  const response = await fetch(`${BASE}fonts/lab.json`);
  if (!response.ok)
    throw new Error("lab.json is missing: run `uv run --group build sawa lab fonts`");
  const data = (await response.json()) as LabData;
  const [calib, notoArabic, notoSans] = await Promise.all([
    fetchBytes(data.fonts.calib),
    fetchBytes(data.fonts.notoArabic),
    fetchBytes(data.fonts.notoSans),
  ]);
  const faces = await Promise.all(
    (
      [
        ["Sawa Lab Calibrated", calib],
        ["Sawa Lab Noto Arabic", notoArabic],
        ["Sawa Lab Noto Sans", notoSans],
      ] as const
    ).map(([family, bytes]) => new FontFace(family, bytes.slice(0)).load()),
  );
  for (const face of faces) document.fonts.add(face);
  const preview = await loadPreview();
  const positioning = data.fonts.positioning
    ? ((await (await fetch(`${BASE}fonts/${data.fonts.positioning}`)).json()) as Positioning)
    : NO_POSITIONING;
  const model = new Model(
    data,
    {
      calib: new HbFont(calib),
      notoArabic: new HbFont(notoArabic),
      notoSans: new HbFont(notoSans),
      ...(preview ? { preview: new HbFont(preview.font) } : {}),
    },
    parseState(location.search),
    loadNotes(),
    NO_EDITS,
    preview?.baked ?? null,
    positioning,
  );
  model.edits = loadOverrides((key) => model.bodyOf(key));
  return model;
}

function cssFamily(choice: FontChoice): string {
  return choice === "calib"
    ? '"Sawa Lab Calibrated"'
    : '"Sawa Lab Noto Arabic", "Sawa Lab Noto Sans"';
}

/** An Arabic word that puts the cell's letter, with its marks, in the cell's form. */
function contextWord(cell: Cell): string {
  const cluster =
    cell.letter.char +
    cell.mark.codepoints
      .map((cp) => String.fromCodePoint(Number.parseInt(cp.slice(2), 16)))
      .join("");
  const words: Record<Form, string> = {
    isolated: `ا${cluster}`,
    initial: `${cluster}لم`,
    medial: `ب${cluster}ل`,
    final: `ب${cluster}`,
  };
  return words[cell.form];
}

function codepointsOf(text: string): number[] {
  const out: number[] = [];
  for (const char of text) out.push(char.codePointAt(0) ?? 0);
  return out;
}

function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }),
  );
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function center(box: { x0: number; y0: number; x1: number; y1: number }): [number, number] {
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

/** One movable part or anchor of a cell, with the handle it is edited by. */
interface CellPart {
  /** Unique within the cell: "body", "dots:<part>", "mark:<index>", "anchor:<class>", "mkmk:<piece>:<class>". */
  key: string;
  handle: Handle;
  label: string;
  kind: "body" | "dots" | "mark" | "anchor" | "mkmk";
  /** The layout piece the part is, lives in or is an anchor of. */
  piece: number;
  /** A dot group drawn inside the piece's glyph. */
  inline?: string;
  /** A mark's position among the cell's marks. */
  order?: number;
  /** An anchor's point in its glyph's own coordinates. */
  point?: [number, number];
}

interface CellParts {
  body?: CellPart;
  dots: CellPart[];
  marks: CellPart[];
  anchors: CellPart[];
}

/** One cell drawn on the inspector canvas. */
interface Drawn {
  cell: Cell;
  x: number;
  /** The cell's extent on the canvas, in font units. */
  x0: number;
  x1: number;
  layout: Layout;
  parts: CellParts;
  glyphs: SVGGElement;
  ink: SVGGElement;
}

class App {
  private readonly defs = s("defs");
  private readonly defined = new Set<string>();
  private readonly root = document.querySelector("#app") as HTMLElement;
  private readonly live = h("p", { class: "visually-hidden", "aria-live": "polite" });
  private readonly history = new History();
  private pending: { x: number; y: number; part?: NotePart } | null = null;
  private focusCell: string | null = null;
  private envelopeQueued = false;
  private liveQueued = false;
  /** The handle the side panel edits, as "<form>|<part key>". */
  private active: string | null = null;
  /** The scope picked per handle, by the same key; the smallest one otherwise. */
  private readonly scopes = new Map<string, Scope>();
  /** The cells the active edit changes, by cell id. */
  private affected = new Map<string, Cell>();

  constructor(private readonly model: Model) {}

  start(): void {
    document.body.append(
      s("svg", { class: "glyph-defs", "aria-hidden": "true", width: 0, height: 0 }, this.defs),
      this.live,
    );
    addEventListener("popstate", () => {
      this.model.state = parseState(location.search);
      this.render();
    });
    document.addEventListener("keydown", (event) => this.historyKeys(event));
    this.render();
  }

  private get state() {
    return this.model.state;
  }

  private setState(patch: Partial<typeof this.model.state>, push = false): void {
    this.model.state = { ...this.model.state, ...patch };
    const url = `${location.pathname}${serializeState(this.model.state)}`;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    this.render();
  }

  private stamp(): Stamp {
    return {
      build: this.model.data.build,
      wght: this.model.data.wght,
      now: new Date().toISOString(),
      usedBy: (glyph) => this.model.usedBy(glyph),
    };
  }

  /** Makes `next` the overrides, recording `before` for undo. */
  private commit(before: Edits, next: Edits): void {
    if (JSON.stringify(before) === JSON.stringify(next)) {
      this.model.edits = next;
      this.render();
      return;
    }
    this.history.push(before);
    this.model.edits = next;
    saveOverrides(next);
    this.render();
  }

  private undo(): void {
    const previous = this.history.undo(this.model.edits);
    if (!previous) return;
    this.model.edits = previous;
    saveOverrides(previous);
    this.announce("Undone");
    this.render();
  }

  private redo(): void {
    const next = this.history.redo(this.model.edits);
    if (!next) return;
    this.model.edits = next;
    saveOverrides(next);
    this.announce("Redone");
    this.render();
  }

  private historyKeys(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("textarea, input[type='text'], input:not([type])")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      this.redo();
    }
  }

  private glyphRef(fontKey: string, font: HbFont, gid: number): string {
    const id = `g-${fontKey}-${gid}`;
    if (!this.defined.has(id)) {
      this.defs.append(s("path", { id, d: font.path(gid) }));
      this.defined.add(id);
    }
    return `#${id}`;
  }

  private partRef(glyph: string, part: string, d: string): string {
    const id = `p-${glyph}-${part}`.replace(/[^\w-]/g, "_");
    if (!this.defined.has(id)) {
      this.defs.append(s("path", { id, d }));
      this.defined.add(id);
    }
    return `#${id}`;
  }

  /**
   * Pieces as <use> elements in a y-up group, marks tagged for styling. A
   * glyph with a moved dot group inside it is drawn part by part.
   */
  private drawPieces(
    choice: FontChoice,
    cellLayout: Layout,
    placed: Placement[],
    x = 0,
  ): SVGGElement {
    const font = this.model.arabicFont(choice);
    const key = this.model.fontKey(choice, "arabic");
    const group = s("g", { transform: `translate(${x} 0)` });
    cellLayout.pieces.forEach((piece, i) => {
      const at = placed[i] ?? { dx: 0, dy: 0, parts: {} };
      const cls = piece.kind === "mark" ? "ink-mark" : "ink-base";
      const mark = piece.kind === "mark" ? piece.mark : null;
      const transform = `translate(${piece.x + at.dx} ${piece.y + at.dy})`;
      const split = Object.values(at.parts).some(([dx, dy]) => dx !== 0 || dy !== 0);
      const info = split ? this.model.glyphInfo(piece.name) : undefined;
      if (!info) {
        group.append(
          s("use", {
            href: this.glyphRef(key, font, piece.gid),
            transform,
            class: cls,
            "data-mark": mark,
            "data-piece": i,
          }),
        );
        return;
      }
      const parts = s("g", { transform, class: cls, "data-piece": i });
      for (const part of info.parts) {
        const [px, py] = at.parts[part.id] ?? [0, 0];
        parts.append(
          s("use", {
            href: this.partRef(piece.name, part.id, part.d ?? ""),
            transform: `translate(${px} ${py})`,
          }),
        );
      }
      group.append(parts);
    });
    return group;
  }

  /** The cell's glyphs as <use> elements in a y-up group. */
  private drawCell(choice: FontChoice, cell: Cell, x = 0): SVGGElement {
    return this.drawPieces(
      choice,
      this.model.layout(choice, cell),
      this.model.placements(choice, cell),
      x,
    );
  }

  private drawText(
    font: HbFont,
    fontKey: string,
    text: string,
    x: number,
  ): { group: SVGGElement; advance: number } {
    const group = s("g", { transform: `translate(${x} 0)` });
    let pen = 0;
    for (const glyph of font.shape(codepointsOf(text))) {
      group.append(
        s("use", {
          href: this.glyphRef(fontKey, font, glyph.gid),
          transform: `translate(${pen + glyph.xOffset} ${glyph.yOffset})`,
          class: "ink-base",
        }),
      );
      pen += glyph.xAdvance;
    }
    return { group, advance: pen };
  }

  private render(): void {
    const model = this.model;
    this.affected = this.activeBlast();
    const active = document.activeElement as HTMLElement | null;
    const activeId = active?.dataset.focusId;
    this.root.replaceChildren(
      this.header(),
      this.envelopePanel(),
      h("main", { id: "main" }, this.state.view === "notes" ? null : this.inspector(), this.body()),
      h(
        "footer",
        {},
        `${model.data.family} ${model.data.wght} at Arabic scale ${model.data.arabicScale}, build ${model.data.build}. `,
        `Shaping: harfbuzzjs HarfBuzz ${harfbuzzVersion}; font build uharfbuzz ${model.data.harfbuzz.uharfbuzz} HarfBuzz ${model.data.harfbuzz.harfbuzz}`,
        harfbuzzVersion === model.data.harfbuzz.harfbuzz
          ? "."
          : h("strong", { class: "warn" }, " (versions differ: the lab may not match the fonts)"),
      ),
    );
    const target = activeId
      ? this.root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(activeId)}"]`)
      : null;
    target?.focus({ preventScroll: true });
  }

  /** Redraws the blast radius previews and the affected matrix cells on the next frame. */
  private queueLive(): void {
    if (this.liveQueued) return;
    this.liveQueued = true;
    requestAnimationFrame(() => {
      this.liveQueued = false;
      const choice = this.state.font;
      const range = this.verticalRange(choice);
      for (const el of this.root.querySelectorAll<HTMLElement>("[data-blast]")) {
        const cell = this.affected.get(el.dataset.blast ?? "");
        if (cell)
          el.querySelector("svg")?.replaceWith(this.cellSvg(choice, cell, range, "blast-svg"));
      }
      const mark = this.state.mark;
      for (const el of this.root.querySelectorAll<HTMLElement>("button.cell.affected[data-cell]")) {
        const cell = this.affected.get(`${el.dataset.cell}|${mark}`);
        if (cell)
          el.querySelector("svg.mini")?.replaceWith(this.cellSvg(choice, cell, range, "mini"));
      }
    });
  }

  /** Redraws the envelope panel on the next frame, for live edits. */
  private queueEnvelope(): void {
    if (this.envelopeQueued) return;
    this.envelopeQueued = true;
    requestAnimationFrame(() => {
      this.envelopeQueued = false;
      this.root.querySelector("section.envelope")?.replaceWith(this.envelopePanel());
    });
  }

  private header(): HTMLElement {
    const state = this.state;
    const views: [View, string][] = [
      ["matrix", "Matrix"],
      ["overview", "All everyday marks"],
      ["notes", `Notes (${this.model.notes.length})`],
    ];
    const markSelect = h(
      "select",
      { id: "mark", "data-focus-id": "mark" },
      h("option", { value: NO_MARK.id, selected: state.mark === NO_MARK.id }, "No mark"),
      h(
        "optgroup",
        { label: "Everyday" },
        ...this.model.data.matrix.everyday.map((m) =>
          h(
            "option",
            { value: m.id, selected: state.mark === m.id },
            `${m.label} (${m.codepoints.join(" ")})`,
          ),
        ),
      ),
      state.niche || this.model.data.matrix.niche.some((m) => m.id === state.mark)
        ? h(
            "optgroup",
            { label: "Niche (Quranic)" },
            ...this.model.data.matrix.niche.map((m) =>
              h(
                "option",
                { value: m.id, selected: state.mark === m.id },
                `${m.label} (${m.codepoints.join(" ")})`,
              ),
            ),
          )
        : null,
    );
    markSelect.addEventListener("change", () => this.setState({ mark: markSelect.value }));
    const niche = h("input", {
      type: "checkbox",
      id: "niche",
      checked: state.niche,
      "data-focus-id": "niche",
    });
    niche.addEventListener("change", () => this.setState({ niche: niche.checked }));
    const impossible = h("input", {
      type: "checkbox",
      id: "impossible",
      checked: state.impossible,
      "data-focus-id": "impossible",
    });
    impossible.addEventListener("change", () => this.setState({ impossible: impossible.checked }));
    const fontRadios = (["calib", "source"] as const).map((choice) => {
      const input = h("input", {
        type: "radio",
        name: "font",
        value: choice,
        checked: state.font === choice,
        "data-focus-id": `font-${choice}`,
      });
      input.addEventListener("change", () => this.setState({ font: choice }));
      return h(
        "label",
        {},
        input,
        choice === "calib"
          ? ` Calibrated (${this.model.data.arabicScale})`
          : " Source (Noto, unscaled)",
      );
    });
    const offsets = h("input", {
      type: "checkbox",
      checked: state.offsets,
      "data-focus-id": "offsets",
    });
    offsets.addEventListener("change", () => {
      this.model.invalidate();
      this.setState({ offsets: offsets.checked });
    });
    const preview = this.model.fonts.preview !== undefined;
    const baked = h("input", {
      type: "checkbox",
      id: "baked",
      checked: state.baked && preview,
      disabled: !preview,
      "data-focus-id": "baked",
    });
    baked.addEventListener("change", () => this.setState({ baked: baked.checked }));
    const bakedNote = !preview
      ? "run `sawa lab preview --overrides overrides.json` to bake one"
      : this.model.bakedMatches()
        ? `baked from ${this.model.baked?.source}`
        : `baked from ${this.model.baked?.source}, which differs from your current moves`;
    const tabs = h(
      "nav",
      { class: "tabs", "aria-label": "Views" },
      ...views.map(([view, label]) => {
        const button = h(
          "button",
          {
            type: "button",
            "aria-pressed": String(state.view === view),
            "data-focus-id": `view-${view}`,
          },
          label,
        );
        button.addEventListener("click", () => this.setState({ view }, true));
        return button;
      }),
    );
    return h(
      "header",
      {},
      h(
        "div",
        { class: "title" },
        h("h1", {}, "Sawa Lab"),
        h("span", { class: "muted" }, `${this.model.data.family} ${this.model.data.wght}`),
      ),
      tabs,
      h(
        "div",
        { class: "controls" },
        state.view === "overview" ? null : h("label", { for: "mark" }, "Mark ", markSelect),
        h("label", {}, niche, " Niche marks"),
        h(
          "label",
          { title: "Marks ordinary spelling never puts on the letter, such as shadda on alef" },
          impossible,
          " Include impossible combinations",
        ),
        h(
          "fieldset",
          { class: "inline" },
          h("legend", { class: "visually-hidden" }, "Font"),
          ...fontRadios,
        ),
        h(
          "label",
          { title: "Draw the letters, dots and marks you moved" },
          offsets,
          " Proposed offsets",
        ),
        h(
          "label",
          {
            title:
              "Draw the calibrated font from calib-preview.ttf, the overrides baked in and shaped by HarfBuzz",
            class: preview && !this.model.bakedMatches() ? "warn" : null,
          },
          baked,
          " Show baked preview ",
          h("span", { class: "muted small" }, `(${bakedNote})`),
        ),
      ),
      this.fileActions(),
    );
  }

  private fileActions(): HTMLElement {
    const exportNotes = h(
      "button",
      { type: "button", "data-focus-id": "export-notes" },
      "Export annotations.json",
    );
    exportNotes.addEventListener("click", () =>
      download("annotations.json", annotationsFile(this.model.notes)),
    );
    const exportOverrides = h(
      "button",
      { type: "button", "data-focus-id": "export-overrides" },
      "Export overrides.json",
    );
    exportOverrides.addEventListener("click", () =>
      download("overrides.json", overridesFile(this.model.edits)),
    );
    const file = h("input", {
      type: "file",
      accept: ".json,application/json",
      id: "import",
      class: "visually-hidden",
      multiple: true,
    });
    file.addEventListener("change", () => void this.importFiles(file.files));
    const copy = h("button", { type: "button", "data-focus-id": "copy-summary" }, "Copy summary");
    copy.addEventListener("click", () => void this.copySummary());
    const theme = h(
      "button",
      { type: "button", "data-focus-id": "theme", "aria-label": "Switch light and dark" },
      "Theme",
    );
    theme.addEventListener("click", () => toggleTheme());
    return h(
      "div",
      { class: "actions" },
      exportNotes,
      exportOverrides,
      h("label", { for: "import", class: "button" }, "Import JSON"),
      file,
      copy,
      theme,
    );
  }

  private async importFiles(files: FileList | null): Promise<void> {
    const list = [...(files ?? [])];
    const texts = await Promise.all(list.map((file) => file.text()));
    for (const [i, file] of list.entries()) {
      try {
        const value: unknown = JSON.parse(texts[i] ?? "");
        const schema = (value as { schema?: unknown }).schema;
        if (schema === "sawa-lab/overrides") {
          const before = this.model.edits;
          const next = mergeOverrides(
            before,
            parseOverrides(value, (key) => this.model.bodyOf(key)),
          );
          this.history.push(before);
          this.model.edits = next;
          saveOverrides(next);
        } else {
          this.model.notes = mergeNotes(this.model.notes, parseAnnotations(value));
          saveNotes(this.model.notes);
        }
        this.announce(`Imported ${file.name}`);
      } catch (error) {
        this.announce(`${file.name}: ${(error as Error).message}`);
        alert(`${file.name}: ${(error as Error).message}`);
      }
    }
    this.render();
  }

  private async copySummary(): Promise<void> {
    const text = summary(this.model.notes, this.model.edits, this.model.data.build, {
      letter: (cp) => this.model.letters.get(cp)?.name ?? cp,
      marks: (cps) => this.model.markLabel(cps),
    });
    try {
      await navigator.clipboard.writeText(text);
      this.announce("Summary copied");
    } catch {
      const area = h(
        "textarea",
        { rows: 12, cols: 80, readonly: true, "aria-label": "Summary" },
        text,
      );
      const dialog = h(
        "dialog",
        {},
        h("p", {}, "Copy this summary:"),
        area,
        h("form", { method: "dialog" }, h("button", {}, "Close")),
      );
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove());
      dialog.showModal();
      area.select();
    }
  }

  private announce(message: string): void {
    this.live.textContent = message;
  }

  private envelopePanel(): HTMLElement {
    const model = this.model;
    const upm = model.upm;
    const choice = this.state.font;
    const latin = model.latinEnvelope(choice);
    const arabic = model.arabicEnvelope(choice);
    const box = lineBox(latin, arabic);
    const latinBox = lineBox(latin);
    const approved = model.approvedLineBox();
    const edited = model.editing(choice) && model.edits.edits.length > 0;
    const asBuilt = model.fontEnvelope(choice);
    const builtBox = lineBox(latin, asBuilt);
    const chip = (id: string, value: number) => {
      const cell = arabic.cells.get(id);
      if (!cell) return null;
      const button = h(
        "button",
        { type: "button", class: "chip", "data-focus-id": `env-${id}` },
        h("span", { class: "arabic", lang: "ar" }, contextWord(cell)),
        ` ${model.cellName(cell)} `,
        h("b", {}, em(value, upm)),
      );
      button.addEventListener("click", () =>
        this.setState(
          {
            view: this.state.view === "notes" ? "matrix" : this.state.view,
            letter: cell.letter.codepoint,
            form: cell.form,
            mark: cell.mark.id,
          },
          true,
        ),
      );
      return h("li", {}, button);
    };
    const row = (label: string, top: number, bottom: number, cls?: string, unit = "") =>
      h(
        "tr",
        cls ? { class: cls } : {},
        h("th", { scope: "row" }, label),
        h("td", {}, em(top, upm)),
        h("td", {}, em(bottom, upm)),
        h("td", {}, `${em(top - bottom, upm)}${unit}`),
      );
    return h(
      "section",
      { class: "envelope", "aria-labelledby": "envelope-title" },
      h(
        "div",
        {},
        h(
          "h2",
          { id: "envelope-title" },
          "Vertical envelope ",
          h(
            "span",
            { class: "muted" },
            choice === "calib" ? "calibrated" : "source",
            this.state.impossible ? ", impossible combinations included" : "",
            model.showsBaked(choice) ? ", baked preview" : "",
            edited ? ", with your edits" : "",
          ),
        ),
        h(
          "table",
          {},
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", {}, ""),
              h("th", { scope: "col" }, "Top"),
              h("th", { scope: "col" }, "Bottom"),
              h("th", { scope: "col" }, "Height"),
            ),
          ),
          h(
            "tbody",
            {},
            h(
              "tr",
              {},
              h("th", { scope: "row" }, `Latin (${latin.topGlyph} / ${latin.bottomGlyph})`),
              h("td", {}, em(latin.top, upm)),
              h("td", {}, em(latin.bottom, upm)),
              h("td", {}, em(latinBox.height, upm)),
            ),
            row(edited ? "Arabic everyday, edited" : "Arabic everyday", arabic.top, arabic.bottom),
            row("Arabic everyday, as built", asBuilt.top, asBuilt.bottom, "as-built"),
            row("Line box both need", box.top, box.bottom, "total", " em"),
            h(
              "tr",
              { class: `as-built${edited ? " changed" : ""}`, "data-testid": "line-box-change" },
              h("th", { scope: "row" }, "Change from as built"),
              h("td", {}, em(box.top - builtBox.top, upm)),
              h("td", {}, em(box.bottom - builtBox.bottom, upm)),
              h("td", {}, `${em(box.height - builtBox.height, upm)} em`),
            ),
            h(
              "tr",
              { class: "approved", title: model.data.approvedLineBox.basis },
              h("th", { scope: "row" }, "Approved line box"),
              h("td", {}, em(approved.top, upm)),
              h("td", {}, em(approved.bottom, upm)),
              h("td", {}, `${em(approved.height, upm)} em`),
            ),
            row(
              `Corpus coverage box (${(model.data.approvedLineBox.coverage.share * 100).toFixed(1)}% of ${model.data.approvedLineBox.coverage.words} words)`,
              model.data.approvedLineBox.coverage.top,
              model.data.approvedLineBox.coverage.bottom,
              "as-built",
              " em",
            ),
          ),
        ),
      ),
      this.envelopeBars(latin, arabic, lineBox(box, approved), approved),
      h(
        "div",
        { class: "extremes" },
        h("h3", {}, "Tallest"),
        h("ol", {}, ...arabic.tallest.map((e) => chip(e.key, e.top))),
      ),
      h(
        "div",
        { class: "extremes" },
        h("h3", {}, "Deepest"),
        h("ol", {}, ...arabic.deepest.map((e) => chip(e.key, e.bottom))),
      ),
    );
  }

  private envelopeBars(
    latin: { top: number; bottom: number },
    arabic: { top: number; bottom: number },
    box: { top: number; bottom: number },
    approved: { top: number; bottom: number },
  ): SVGSVGElement {
    const label = 260;
    const top = box.top + label + 40;
    const height = top - box.bottom + 40;
    const bar = (x: number, e: { top: number; bottom: number }, cls: string, name: string) =>
      s(
        "g",
        {},
        s("rect", { x, y: top - e.top, width: 600, height: e.top - e.bottom, class: cls }),
        s(
          "text",
          { x: x + 300, y: top - e.top - 50, "text-anchor": "middle", class: "bar-label" },
          name,
        ),
      );
    return s(
      "svg",
      {
        viewBox: `0 0 1500 ${height}`,
        class: "bars",
        role: "img",
        "aria-label": `Ink from ${em(latin.bottom, this.model.upm)} to ${em(latin.top, this.model.upm)} em for Latin and ${em(arabic.bottom, this.model.upm)} to ${em(arabic.top, this.model.upm)} em for Arabic`,
      },
      bar(100, latin, "bar-latin", "Latin"),
      bar(800, arabic, "bar-arabic", "Arabic"),
      s("line", { x1: 0, x2: 1500, y1: top, y2: top, class: "bar-baseline" }),
      s("rect", {
        x: 20,
        y: top - approved.top,
        width: 1460,
        height: approved.top - approved.bottom,
        class: "bar-approved",
      }),
    );
  }

  private body(): HTMLElement {
    if (this.state.view === "notes") return this.notesView();
    return this.matrix(this.state.view === "overview");
  }

  private cellAvailable(letter: string, form: Form, overview: boolean): boolean {
    const l = this.model.letters.get(letter);
    if (!l?.forms.includes(form)) return false;
    return overview || this.model.shown(l, this.model.marks.get(this.state.mark) ?? NO_MARK);
  }

  private matrix(overview: boolean): HTMLElement {
    const model = this.model;
    const choice = this.state.font;
    const mark = model.marks.get(this.state.mark) ?? NO_MARK;
    const forms = model.data.matrix.forms;
    const selected = model.selected();
    const focusKey =
      this.focusCell ??
      (selected
        ? `${selected.letter.codepoint}|${selected.form}`
        : `${model.data.matrix.letters[0]?.codepoint}|isolated`);
    const range = this.verticalRange(choice);
    const rows = model.data.matrix.letters.map((letter) =>
      h(
        "tr",
        {},
        h(
          "th",
          { scope: "row" },
          h(
            "span",
            { class: "arabic letter", lang: "ar", style: `font-family: ${cssFamily(choice)}` },
            letter.char,
          ),
          h("span", { class: "name" }, letter.name),
          h("span", { class: "muted cp" }, letter.codepoint),
        ),
        ...forms.map((form) => {
          if (!letter.forms.includes(form))
            return h(
              "td",
              { class: "na" },
              h("span", { class: "visually-hidden" }, "no such form"),
            );
          if (!overview && !model.shown(letter, mark))
            return h(
              "td",
              { class: "na" },
              h("span", { class: "na-note" }, "not in ordinary spelling"),
            );
          const id = `${letter.codepoint}|${form}`;
          const isSelected =
            selected?.letter.codepoint === letter.codepoint && selected.form === form;
          if (overview)
            return h(
              "td",
              { "aria-selected": String(isSelected) },
              this.overviewCell({ letter, form, mark }, id === focusKey, range),
            );
          return h(
            "td",
            { "aria-selected": String(isSelected) },
            this.matrixCell({ letter, form, mark }, choice, id === focusKey, range),
          );
        }),
      ),
    );
    const table = h(
      "table",
      {
        class: overview ? "matrix overview" : "matrix",
        role: "grid",
        dir: "rtl",
        "aria-label": overview
          ? "Letters by form with every everyday mark"
          : `Letters by form with ${mark.label}`,
      },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Letter"),
          ...forms.map((f) => h("th", { scope: "col" }, f)),
        ),
      ),
      h("tbody", {}, ...rows),
    );
    table.addEventListener("keydown", (event) => this.matrixKeys(event));
    return h("section", { class: "matrix-wrap", "aria-label": "Matrix", dir: "rtl" }, table);
  }

  private verticalRange(choice: FontChoice): { top: number; bottom: number } {
    const arabic = this.model.arabicEnvelope(choice);
    const latin = this.model.latinEnvelope(choice);
    const box = lineBox(arabic, latin, this.model.fontEnvelope(choice));
    return { top: box.top + 60, bottom: box.bottom - 60 };
  }

  private cellSvg(
    choice: FontChoice,
    cell: Cell,
    range: { top: number; bottom: number },
    cls: string,
  ): SVGSVGElement {
    const box = this.model.box(choice, cell);
    const advance = this.model.layout(choice, cell).advance;
    const x0 = Math.min(0, box?.x0 ?? 0) - 60;
    const x1 = Math.max(advance, box?.x1 ?? 0) + 60;
    const group = s(
      "g",
      { transform: "scale(1 -1)" },
      s("line", { x1: x0, x2: x1, y1: 0, y2: 0, class: "baseline" }),
      this.drawCell(choice, cell),
    );
    return s(
      "svg",
      {
        viewBox: `${x0} ${-range.top} ${x1 - x0} ${range.top - range.bottom}`,
        class: cls,
        "aria-hidden": "true",
      },
      group,
    );
  }

  private matrixCell(
    cell: Cell,
    choice: FontChoice,
    focus: boolean,
    range: { top: number; bottom: number },
  ): HTMLElement {
    const model = this.model;
    const analysis = model.analysis(choice, cell);
    const upm = model.upm;
    const status = !analysis.hasMarks
      ? "no mark"
      : analysis.clash
        ? `clash ${analysis.gap === 0 ? "touching" : em(analysis.gap, upm, 3)}`
        : `clear ${Number.isFinite(analysis.gap) ? em(analysis.gap, upm, 3) : "far"}`;
    const hasOffset = choice === "calib" && this.cellMoved(cell);
    const notes = model.notes.filter((n) => keyId(n.key) === keyId(cellKey(cell))).length;
    const id = `${cell.letter.codepoint}|${cell.form}`;
    const impossible = !model.plausible(cell.letter, cell.mark);
    const affected = this.affected.has(cellId(cell));
    const button = h(
      "button",
      {
        type: "button",
        class: `cell${analysis.clash ? " clash" : ""}${impossible ? " implausible" : ""}${affected ? " affected" : ""}`,
        tabindex: focus ? 0 : -1,
        "data-cell": id,
        "data-focus-id": `cell-${id}`,
        "aria-label": `${model.cellName(cell)}${impossible ? " (impossible in ordinary spelling)" : ""}: ${status}, top ${em(analysis.top, upm)} em, bottom ${em(analysis.bottom, upm)} em${hasOffset ? ", offset proposed" : ""}${affected ? ", changed by the selected edit" : ""}${notes ? `, ${notes} notes` : ""}`,
      },
      this.cellSvg(choice, cell, range, "mini"),
      h("span", { class: `badge ${analysis.clash ? "bad" : "ok"}` }, status),
      h("span", { class: "extent" }, `↑${em(analysis.top, upm)} ↓${em(analysis.bottom, upm)}`),
      impossible ? h("span", { class: "flag impossible" }, "impossible combination") : null,
      hasOffset ? h("span", { class: "flag" }, "offset") : null,
      affected ? h("span", { class: "flag affected-flag" }, "changes") : null,
      notes ? h("span", { class: "flag" }, `${notes} note${notes > 1 ? "s" : ""}`) : null,
    );
    button.addEventListener("click", () => this.select(cell));
    return button;
  }

  /** Whether any edit moves part of the cell. */
  private cellMoved(cell: Cell): boolean {
    return this.model
      .placements("calib", cell)
      .some((p) => p.dx || p.dy || Object.values(p.parts).some(([x, y]) => x || y));
  }

  private overviewCell(
    cell: Cell,
    focus: boolean,
    range: { top: number; bottom: number },
  ): HTMLElement {
    const model = this.model;
    const choice = this.state.font;
    const marks = model.data.matrix.everyday;
    const results = marks
      .filter((mark) => model.shown(cell.letter, mark))
      .map((mark) => ({
        mark,
        analysis: model.analysis(choice, { ...cell, mark }),
      }));
    const clashes = results.filter((r) => r.analysis.clash);
    const id = `${cell.letter.codepoint}|${cell.form}`;
    const open = h(
      "button",
      {
        type: "button",
        class: `cell summary${clashes.length ? " clash" : ""}`,
        tabindex: focus ? 0 : -1,
        "data-cell": id,
        "data-focus-id": `cell-${id}`,
        "aria-label": `${cell.letter.name} ${cell.form}: ${clashes.length ? `${clashes.length} clashing marks: ${clashes.map((c) => c.mark.label).join(", ")}` : "every everyday mark clear"}`,
      },
      clashes.length ? `${clashes.length} clash${clashes.length > 1 ? "es" : ""}` : "all clear",
    );
    open.addEventListener("click", () =>
      this.select({
        ...cell,
        mark: clashes[0]?.mark ?? model.marks.get(this.state.mark) ?? NO_MARK,
      }),
    );
    const grid = h(
      "div",
      { class: "mini-grid" },
      ...results.map(({ mark, analysis }) => {
        const tiny = h(
          "button",
          {
            type: "button",
            tabindex: -1,
            class: `tiny${analysis.clash ? " clash" : ""}${model.plausible(cell.letter, mark) ? "" : " implausible"}${this.affected.has(cellId({ ...cell, mark })) ? " affected" : ""}`,
            title: `${mark.label}${model.plausible(cell.letter, mark) ? "" : " (impossible combination)"}${analysis.clash ? " (clash)" : ""}`,
          },
          this.cellSvg(choice, { ...cell, mark }, range, "tiny-svg"),
        );
        tiny.addEventListener("click", () => this.select({ ...cell, mark }, "matrix"));
        return tiny;
      }),
    );
    return h("div", { class: "overview-cell" }, open, grid);
  }

  private matrixKeys(event: KeyboardEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!target) return;
    const move = arrowStep(event.key, true);
    if (!move) return;
    event.preventDefault();
    const [letterCp, form] = (target.dataset.cell ?? "").split("|") as [string, Form];
    const letters = this.model.data.matrix.letters.map((l) => l.codepoint);
    const forms = this.model.data.matrix.forms;
    let row = letters.indexOf(letterCp);
    let col = forms.indexOf(form);
    for (;;) {
      row += move[0];
      col += move[1];
      if (row < 0 || row >= letters.length || col < 0 || col >= forms.length) return;
      const nextLetter = letters[row] as string;
      const nextForm = forms[col] as Form;
      if (this.cellAvailable(nextLetter, nextForm, this.state.view === "overview")) {
        const next = this.root.querySelector<HTMLElement>(
          `[data-cell="${nextLetter}|${nextForm}"]`,
        );
        if (!next) return;
        target.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
        this.focusCell = `${nextLetter}|${nextForm}`;
        return;
      }
    }
  }

  private select(cell: Cell, view?: View): void {
    this.pending = null;
    this.focusCell = `${cell.letter.codepoint}|${cell.form}`;
    this.setState(
      {
        letter: cell.letter.codepoint,
        form: cell.form,
        mark: cell.mark.id,
        ...(view ? { view } : {}),
      },
      true,
    );
    document.querySelector("#inspector")?.scrollIntoView({ block: "start" });
  }

  /** The cell's movable parts and anchors, each with the handle that edits it. */
  private cellParts(choice: FontChoice, cell: Cell): CellParts {
    const model = this.model;
    const cellLayout = model.layout(choice, cell);
    const pieces = cellLayout.pieces;
    const attach = model.cellAttachments(choice, cell);
    const anchors = model.positioning.anchors;
    const font = model.arabicFont(choice);
    const form = model.letterForm(cell.letter, cell.form);
    const inked = (i: number) => font.outline(pieces[i]?.gid ?? 0).length > 0;
    const bodyIndex = pieces.findIndex(
      (p, i) => p.kind === "base" && p.owner === i && inked(i) && p.name === form?.body,
    );
    const context = (i: number) => {
      const j = contextBase(pieces, i);
      return j === undefined ? null : (pieces[j]?.name ?? null);
    };
    const link = (i: number) => {
      const a = attach[i];
      const parent = a ? pieces[a.parent] : undefined;
      return a && parent ? { parent: parent.name, cls: a.cls, kind: a.kind } : null;
    };
    const result: CellParts = { dots: [], marks: [], anchors: [] };
    const bodyPiece = pieces[bodyIndex];
    if (bodyPiece) {
      const glyph = bodyPiece.name;
      result.body = {
        key: "body",
        handle: { kind: "body", glyph },
        label: glyph,
        kind: "body",
        piece: bodyIndex,
      };
      for (const part of model.glyphInfo(glyph)?.parts ?? []) {
        if (part.kind === "body") continue;
        result.dots.push({
          key: `dots:${part.id}`,
          handle: { kind: "dots", glyph, part: part.id, inline: true, attach: null, context: null },
          label: part.label,
          kind: "dots",
          piece: bodyIndex,
          inline: part.id,
        });
      }
      const set = anchors[glyph];
      for (const anchor of [...(set?.base ?? []), ...(set?.ligature ?? [])]) {
        if (result.anchors.some((a) => a.key === `anchor:${anchor.class}`)) continue;
        const group = pieces
          .filter((_p, i) => attach[i]?.parent === bodyIndex && attach[i]?.cls === anchor.class)
          .map((p) => p.name);
        result.anchors.push({
          key: `anchor:${anchor.class}`,
          handle: { kind: "anchor", glyph, cls: anchor.class, group },
          label: `${this.className(anchor.class)} anchor of ${glyph}`,
          kind: "anchor",
          piece: bodyIndex,
          point: [anchor.x, anchor.y],
        });
      }
    }
    pieces.forEach((piece, i) => {
      if (piece.kind === "mark" && inked(i)) {
        result.marks.push({
          key: `mark:${piece.mark}`,
          handle: { kind: "mark", mark: piece.name, attach: link(i), context: context(i) },
          label: this.glyphLabel(piece.name),
          kind: "mark",
          piece: i,
          order: piece.mark,
        });
      } else if (bodyPiece && piece.owner === bodyIndex && i !== bodyIndex && piece.adjacent) {
        const part = form?.parts.find((p) => p.id === piece.name);
        const l = link(i);
        result.dots.push({
          key: `dots:${piece.name}`,
          handle: {
            kind: "dots",
            glyph: bodyPiece.name,
            part: piece.name,
            inline: false,
            attach: l ? { parent: l.parent, cls: l.cls } : null,
            context: context(i),
          },
          label: part?.label ?? piece.name,
          kind: "dots",
          piece: i,
        });
      }
      if (piece.gdefMark && inked(i))
        for (const anchor of anchors[piece.name]?.mark2 ?? [])
          result.anchors.push({
            key: `mkmk:${i}:${anchor.class}`,
            handle: { kind: "mkmk", glyph: piece.name, cls: anchor.class },
            label: `${this.className(anchor.class)} anchor of ${this.glyphLabel(piece.name)}`,
            kind: "mkmk",
            piece: i,
            point: [anchor.x, anchor.y],
          });
    });
    result.marks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    // Anchors the cell's tashkeel hangs on come first, then those its dots hang on.
    const rank = (part: CellPart) => {
      const cls =
        part.handle.kind === "anchor" || part.handle.kind === "mkmk" ? part.handle.cls : "";
      const on = pieces.filter(
        (_p, i) => attach[i]?.parent === part.piece && attach[i]?.cls === cls,
      );
      return on.some((p) => p.kind === "mark") ? 2 : on.length ? 1 : 0;
    };
    result.anchors.sort((a, b) => rank(b) - rank(a));
    return result;
  }

  /** A glyph's name with the mark it draws, "uni064E (fatha)", when the matrix names it. */
  private glyphLabel(name: string): string {
    const cp = /^uni([0-9A-F]{4})$/.exec(name)?.[1];
    const mark = cp
      ? this.model.data.matrix.everyday.find((m) => m.codepoints.join() === `U+${cp}`)
      : undefined;
    return mark ? `${name} (${mark.label})` : name;
  }

  /** A mark class's name for feature syntax, "top_27". */
  private className(id: string): string {
    return markClass(this.model.positioning, id)?.cls.name ?? id;
  }

  /** The handles the drag mode offers among a cell's parts. */
  private handlesOf(parts: CellParts): CellPart[] {
    const mode = this.state.drag;
    if (mode === "letter") return parts.body ? [parts.body] : [];
    if (mode === "dot") return parts.dots;
    if (mode === "anchor") return parts.anchors;
    return parts.marks;
  }

  /** The same outline part in every form of the letter. */
  private allForms(cell: Cell, part: CellPart): Target[] {
    const choice = this.state.font;
    const here = this.cellParts(choice, cell);
    const index = here.dots.findIndex((d) => d.key === part.key);
    return this.formCells(cell).flatMap((c): Target[] => {
      const parts = this.cellParts(choice, c);
      const pick = part.kind === "body" ? parts.body : parts.dots[index];
      const handle = pick?.handle;
      if (handle?.kind === "body")
        return [{ mechanism: "outline", glyph: handle.glyph, part: "body" }];
      if (handle?.kind === "dots")
        return [{ mechanism: "outline", glyph: handle.glyph, part: handle.part }];
      return [];
    });
  }

  private options(cell: Cell, part: CellPart): ScopeOption[] {
    return scopeOptions(part.handle, () => this.allForms(cell, part));
  }

  /** The scope picked for a handle, or its smallest. */
  private option(cell: Cell, part: CellPart): ScopeOption | undefined {
    const options = this.options(cell, part);
    const picked = this.scopes.get(`${cell.form}|${part.key}`);
    return options.find((o) => o.scope === picked) ?? options[0];
  }

  /** The handle the side panel edits in the selected cell: the one last used, or the first. */
  private activePart(
    cell: Cell,
    parts = this.cellParts(this.state.font, cell),
  ): CellPart | undefined {
    const handles = this.handlesOf(parts);
    return handles.find((p) => `${cell.form}|${p.key}` === this.active) ?? handles[0];
  }

  /** The cells the active handle's edit, at its scope, changes. */
  private activeBlast(): Map<string, Cell> {
    const cell = this.model.selected();
    if (!cell || this.state.view === "notes") return new Map();
    const part = this.activePart(cell);
    const option = part ? this.option(cell, part) : undefined;
    if (!option) return new Map();
    return new Map(this.model.blastRadius(option.targets).map((c) => [cellId(c), c]));
  }

  /** Makes a handle the active one, and redraws what depends on it, but not the canvas being dragged. */
  private activate(cell: Cell, part: CellPart): void {
    const key = `${cell.form}|${part.key}`;
    if (this.active === key) return;
    this.active = key;
    if (cell.form !== this.state.form) return;
    this.affected = this.activeBlast();
    this.root.querySelector("aside.side")?.replaceWith(this.sidePanel(cell, this.state.font));
    this.root.querySelector("section.matrix-wrap")?.replaceWith(this.body());
    for (const el of this.root.querySelectorAll(".handle.active")) el.classList.remove("active");
    this.root
      .querySelector(`.handle[data-form="${cell.form}"][data-part="${CSS.escape(part.key)}"]`)
      ?.classList.add("active");
  }

  private inspector(): HTMLElement | null {
    const model = this.model;
    const cell = model.selected();
    if (!cell)
      return h(
        "section",
        { id: "inspector", class: "inspector empty" },
        h("p", {}, "Pick a cell in the matrix to inspect it. Arrow keys move between cells."),
      );
    const choice = this.state.font;
    const analysis = model.analysis(choice, cell);
    const close = h(
      "button",
      { type: "button", class: "close", "data-focus-id": "close" },
      "Close",
    );
    close.addEventListener("click", () => this.setState({ letter: null, form: null }, true));
    const readout = h(
      "p",
      { class: "readout", "aria-live": "polite" },
      this.readoutText(choice, cell),
    );
    if (analysis.clash)
      readout.replaceChildren(h("strong", { class: "bad" }, this.readoutText(choice, cell)));
    return h(
      "section",
      { id: "inspector", class: "inspector", "aria-labelledby": "inspector-title" },
      h(
        "div",
        { class: "inspector-head" },
        h(
          "h2",
          { id: "inspector-title" },
          h(
            "span",
            { class: "arabic", lang: "ar", style: `font-family: ${cssFamily(choice)}` },
            contextWord(cell),
          ),
          ` ${model.cellName(cell)} `,
          h(
            "span",
            { class: "muted cp" },
            [cell.letter.codepoint, ...cell.mark.codepoints].join(" "),
          ),
        ),
        close,
      ),
      readout,
      h(
        "div",
        { class: "inspector-body" },
        this.canvas(
          leftToRight(cell.letter.forms).map((form) => ({
            letter: cell.letter,
            mark: cell.mark,
            form,
          })),
          choice,
          readout,
        ),
        this.sidePanel(cell, choice),
      ),
      this.edgeLines(cell, choice),
      this.contextRow(cell),
      this.readingSizes(cell),
    );
  }

  private readoutText(choice: FontChoice, cell: Cell): string {
    const model = this.model;
    const upm = model.upm;
    const live = analyse(
      model.layout(choice, cell),
      model.ink(choice),
      model.placements(choice, cell),
      model.clearanceUnits,
    );
    const ink = ` · ink top ${em(live.top, upm)} em, bottom ${em(live.bottom, upm)} em`;
    if (!live.hasMarks) return `No mark${ink}`;
    const gap = Number.isFinite(live.gap) ? em(live.gap, upm, 3) : "> 0.2";
    return live.clash
      ? `Clash: gap ${gap} em under ${model.data.clearance} em${ink}`
      : `Clear: gap ${gap} em${ink}`;
  }

  private gridLines(width: number, x0: number, choice: FontChoice, labelSize = 34): SVGGElement {
    const m = this.model.data.metrics;
    const box = lineBox(this.model.latinEnvelope(choice), this.model.arabicEnvelope(choice));
    const approved = this.model.approvedLineBox();
    const lines: [string, number, string][] = [
      ["approved line box top", approved.top, "approved"],
      ["line box top", box.top, "box"],
      ["ascender (d)", m.ascender, "metric"],
      ["cap height", m.capHeight, "metric"],
      ["x-height", m.xHeight, "metric"],
      ["baseline", 0, "base"],
      ["descender (p)", m.descender, "metric"],
      ["line box bottom", box.bottom, "box"],
      ["approved line box bottom", approved.bottom, "approved"],
    ];
    return s(
      "g",
      { class: "grid" },
      ...lines.map(([label, y, cls]) =>
        s(
          "g",
          {},
          s("line", { x1: x0, x2: x0 + width, y1: -y, y2: -y, class: `grid-${cls}` }),
          s(
            "text",
            {
              x: x0 + 10 + (cls === "approved" ? labelSize * 12 : 0),
              y: -y - labelSize / 3,
              class: "grid-label",
              "font-size": labelSize,
            },
            `${label} ${em(y, this.model.upm)}`,
          ),
        ),
      ),
    );
  }

  /** Where a part's handle sits, in the drawn cell's font units: its ink's centre, or the anchor. */
  private partCenter(drawn: Drawn, part: CellPart, choice: FontChoice): [number, number] | null {
    const model = this.model;
    const piece = drawn.layout.pieces[part.piece];
    const at = model.placements(choice, drawn.cell)[part.piece];
    if (!piece || !at) return null;
    if (part.point) {
      const target = this.option(drawn.cell, part)?.targets[0];
      const [ox, oy] = target ? offsetOf(model.edits, target) : [0, 0];
      return [piece.x + at.dx + part.point[0] + ox, piece.y + at.dy + part.point[1] + oy];
    }
    let contours;
    if (part.inline) {
      const [px, py] = at.parts[part.inline] ?? [0, 0];
      contours = model.partInk(piece.name, part.inline, piece.x + at.dx + px, piece.y + at.dy + py);
    } else contours = model.ink(choice)(piece, at);
    const box = bounds(contours);
    return box ? center(box) : null;
  }

  private canvas(cells: Cell[], choice: FontChoice, readout: HTMLElement): HTMLElement {
    const model = this.model;
    const latinFont = model.latinFont(choice);
    const range = this.verticalRange(choice);
    const bottom = range.bottom - 60;
    const editable = model.editing(choice) && !model.showsBaked(choice);
    const latinAdvance = latinFont
      .shape(codepointsOf("Hxgy"))
      .reduce((sum, g) => sum + g.xAdvance, 0);
    const content = cells.reduce((sum, cell) => {
      const box = model.box(choice, cell, false);
      const advance = model.layout(choice, cell).advance;
      return sum + Math.max(advance, box?.x1 ?? 0) - Math.min(0, box?.x0 ?? 0) + 260;
    }, latinAdvance + 180);
    const fit = (gutter: number) =>
      Math.max(MIN_INSPECTOR_SCALE, Math.min(INSPECTOR_SCALE, CANVAS_WIDTH / (content + gutter)));
    // The label gutter grows with the labels, which grow as the canvas shrinks.
    const labels = 520 * (INSPECTOR_SCALE / fit(520));
    const drawn: Drawn[] = [];
    let x = labels + 120;
    for (const cell of cells) {
      const cellLayout = model.layout(choice, cell);
      const box = model.box(choice, cell, false);
      const cellX = x - Math.min(0, box?.x0 ?? 0);
      drawn.push({
        cell,
        x: cellX,
        x0: x - 130,
        x1: cellX + Math.max(cellLayout.advance, box?.x1 ?? 0) + 130,
        layout: cellLayout,
        parts: this.cellParts(choice, cell),
        glyphs: s("g", {}),
        ink: s("g", { class: "ink-lines" }),
      });
      x = cellX + Math.max(cellLayout.advance, box?.x1 ?? 0) + 260;
    }
    const latinX = x - 60;
    const latin = this.drawText(latinFont, model.fontKey(choice, "latin"), "Hxgy", latinX);
    const width = latinX + latin.advance + 120;
    const selected = model.selected();
    const scale = fit(labels);
    /** Grows labels and handles as the canvas shrinks, so they keep their size on screen. */
    const k = INSPECTOR_SCALE / scale;
    const top = range.top + (cells.length > 1 ? 150 * k : 120);
    const height = top - bottom;
    const svg = s("svg", {
      viewBox: `0 ${-top} ${width} ${height}`,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      class: "big",
      role: "img",
      "aria-label": `${cells.map((c) => model.cellName(c)).join(", ")} at 300 px per em on the Latin grid. Click to pin a note.`,
    });
    const glyphs = s("g", { transform: "scale(1 -1)" }, latin.group);
    for (const d of drawn) glyphs.append(d.glyphs);
    const isSelected = (d: Drawn) =>
      selected !== null && keyId(cellKey(d.cell)) === keyId(cellKey(selected));
    for (const d of drawn) {
      if (cells.length > 1 && isSelected(d))
        svg.append(
          s("rect", {
            x: d.x0,
            y: -top,
            width: d.x1 - d.x0,
            height,
            class: "form-selected",
          }),
        );
    }
    svg.append(this.gridLines(width, 0, choice, 34 * k));
    if (cells.length > 1)
      for (const d of drawn)
        svg.append(
          s(
            "text",
            {
              x: (d.x0 + d.x1) / 2,
              y: -top + 70 * k,
              "text-anchor": "middle",
              class: `form-label${isSelected(d) ? " strong" : ""}`,
              "font-size": 44 * k,
            },
            d.cell.form,
          ),
        );
    for (const d of drawn) svg.append(d.ink);
    svg.append(glyphs);
    const handleLayer = s("g", { class: "handles" });

    const toFont = (event: PointerEvent | MouseEvent): [number, number] => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return [point.x, -point.y];
    };

    const handles: { el: SVGCircleElement; drawn: Drawn; part: CellPart }[] = [];
    const redraw = () => {
      for (const d of drawn) {
        d.glyphs.replaceChildren(
          this.drawCell(choice, d.cell, d.x),
          this.anchorMarks(choice, d, k),
        );
        d.ink.replaceChildren(...this.inkLines(choice, d, k));
      }
      for (const { el, drawn: d, part } of handles) {
        const at = this.partCenter(d, part, choice);
        if (!at) continue;
        el.setAttribute("cx", String(d.x + at[0]));
        el.setAttribute("cy", String(-at[1]));
      }
      if (selected) readout.textContent = this.readoutText(choice, selected);
    };

    const kinds: Record<CellPart["kind"], string> = {
      body: "Letter",
      dots: "Dots",
      mark: "Mark",
      anchor: "Anchor",
      mkmk: "Mark-to-mark anchor",
    };
    for (const d of drawn) {
      const current = selected ? this.activePart(d.cell, d.parts) : undefined;
      for (const part of this.handlesOf(d.parts)) {
        const option = this.option(d.cell, part);
        const offset = option?.targets[0] ? offsetOf(model.edits, option.targets[0]) : [0, 0];
        const anchor = part.kind === "anchor" || part.kind === "mkmk";
        const isActive = isSelected(d) && part.key === current?.key;
        const handle = s("circle", {
          r: (anchor ? 24 : 34) * k,
          class: `handle handle-${part.kind}${editable ? "" : " disabled"}${isActive ? " active" : ""}`,
          tabindex: editable ? 0 : -1,
          role: "button",
          "data-focus-id": `handle-${d.cell.form}-${part.key}`,
          "data-handle": part.order ?? null,
          "data-part": part.key,
          "data-form": d.cell.form,
          "aria-label": `${kinds[part.kind]} ${part.label} of ${model.cellName(d.cell)}: drag or use arrow keys to move it (${option?.label.toLowerCase() ?? "fixed"}); offset ${offset.join(", ")}`,
        });
        handles.push({ el: handle, drawn: d, part });
        if (editable) this.wireHandle(handle, d.cell, part, toFont, redraw);
        handleLayer.append(handle);
      }
    }

    if (selected) {
      const home = drawn.find((d) => keyId(cellKey(d.cell)) === keyId(cellKey(selected)));
      const cellNotes = home
        ? model.notes.filter((n) => keyId(n.key) === keyId(cellKey(selected)))
        : [];
      cellNotes.forEach((note, i) => {
        const pin = s(
          "g",
          {
            class: `pin sev-${note.severity}`,
            transform: `translate(${(home?.x ?? 0) + note.x} ${-note.y})`,
          },
          s("circle", { r: 30 * k }),
          s("text", { "text-anchor": "middle", y: 12 }, String(i + 1)),
        );
        pin.addEventListener("click", (event) => {
          event.stopPropagation();
          this.root.querySelector<HTMLElement>(`[data-note="${note.id}"]`)?.focus();
        });
        svg.append(pin);
      });
      if (this.pending && home) {
        svg.append(
          s("circle", {
            cx: home.x + this.pending.x,
            cy: -this.pending.y,
            r: 30 * k,
            class: "pin pending",
          }),
        );
      }
      svg.addEventListener("click", (event) => {
        if ((event.target as Element).closest(".handle, .pin")) return;
        const [fx, fy] = toFont(event);
        const hit = drawn.find((d) => d.x0 <= fx && fx <= d.x1);
        if (hit && !isSelected(hit)) {
          this.pending = null;
          this.setState({ form: hit.cell.form });
          return;
        }
        if (!home) return;
        const nx = Math.round(fx - home.x);
        const ny = Math.round(fy);
        this.pending = { x: nx, y: ny, ...this.nearestPart(choice, home, nx, ny) };
        this.render();
        this.root.querySelector<HTMLElement>("#note-tag")?.focus();
      });
    }
    svg.append(handleLayer);
    redraw();
    return h("div", { class: "canvas-wrap" }, svg);
  }

  /** The part whose ink is nearest a clicked point, for a new note. */
  private nearestPart(choice: FontChoice, drawn: Drawn, x: number, y: number): { part?: NotePart } {
    let best: { part: NotePart; distance: number } | null = null;
    for (const part of [
      ...(drawn.parts.body ? [drawn.parts.body] : []),
      ...drawn.parts.dots,
      ...drawn.parts.marks,
    ]) {
      const at = this.partCenter(drawn, part, choice);
      if (!at) continue;
      const distance = Math.hypot(at[0] - x, at[1] - y);
      if (best && best.distance <= distance) continue;
      best = { part: this.notePart(part), distance };
    }
    return best ? { part: best.part } : {};
  }

  private notePart(part: CellPart): NotePart {
    const handle = part.handle;
    if (handle.kind === "dots") return { kind: "dots", glyph: handle.glyph, id: handle.part };
    if (handle.kind === "mark") return { kind: "mark", glyph: handle.mark, index: part.order ?? 0 };
    return { kind: "body", glyph: part.label };
  }

  /** The cells of the selected letter in every form it has, with the current mark. */
  private formCells(cell: Cell): Cell[] {
    return cell.letter.forms.map((form) => ({ letter: cell.letter, mark: cell.mark, form }));
  }

  private wireHandle(
    handle: SVGCircleElement,
    cell: Cell,
    part: CellPart,
    toFont: (event: PointerEvent) => [number, number],
    redraw: () => void,
  ): void {
    const live = () => {
      redraw();
      this.queueEnvelope();
      this.queueLive();
    };
    handle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      this.activate(cell, part);
      const option = this.option(cell, part);
      if (!option) return;
      const [sx, sy] = toFont(event);
      const before = this.model.edits;
      const stamp = this.stamp();
      const onMove = (e: PointerEvent) => {
        const [x, y] = toFont(e);
        this.model.edits = moveBy(before, option.targets, option.scope, [x - sx, y - sy], stamp);
        live();
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this.commit(before, this.model.edits);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("focus", () => this.activate(cell, part));
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 25 : 5;
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = deltas[event.key];
      const option = this.option(cell, part);
      if (!delta || !option) return;
      event.preventDefault();
      const before = this.model.edits;
      this.commit(before, moveBy(before, option.targets, option.scope, delta, this.stamp()));
    });
  }

  /** Dashed lines at the cell's ink top and bottom, labelled in em. */
  private inkLines(choice: FontChoice, drawn: Drawn, k = 1): SVGElement[] {
    const box = this.model.box(choice, drawn.cell);
    if (!box) return [];
    const x0 = drawn.x + Math.min(0, box.x0) - 40;
    const x1 = drawn.x + Math.max(drawn.layout.advance, box.x1) + 40;
    const upm = this.model.upm;
    return [
      ["ink top", box.y1],
      ["ink bottom", box.y0],
    ].flatMap(([label, y]) => [
      s("line", {
        x1: x0,
        x2: x1,
        y1: -(y as number),
        y2: -(y as number),
        class: "ink-line",
      }),
      s(
        "text",
        {
          x: x0,
          y: -(y as number) + (label === "ink top" ? -12 : 40) * k,
          class: "ink-label",
          "font-size": 30 * k,
        },
        `${label} ${em(y as number, upm)}`,
      ),
    ]);
  }

  /**
   * Anchors, drawn apart from the ink: each base anchor of the body glyph
   * as a cross labelled with its class, each mark's own anchor as a ring
   * where it meets what it hangs on, and each mark-to-mark anchor as a
   * square. Shown when dragging anchors or the whole letter.
   */
  private anchorMarks(choice: FontChoice, drawn: Drawn, k = 1): SVGGElement {
    const group = s("g", { class: "anchors" });
    const mode = this.state.drag;
    if (mode !== "anchor" && mode !== "letter") return group;
    const model = this.model;
    const placed = model.placements(choice, drawn.cell);
    const attach = model.cellAttachments(choice, drawn.cell);
    const size = 18 * k;
    for (const part of drawn.parts.anchors) {
      const at = this.partCenter(drawn, part, choice);
      if (!at) continue;
      const [ax, ay] = [drawn.x + at[0], at[1]];
      const shape =
        part.kind === "anchor"
          ? `M${ax - size} ${ay}H${ax + size}M${ax} ${ay - size}V${ay + size}`
          : `M${ax - size * 0.7} ${ay - size * 0.7}h${size * 1.4}v${size * 1.4}h${-size * 1.4}Z`;
      group.append(
        s("path", { d: shape, class: `anchor anchor-${part.kind}` }, s("title", {}, part.label)),
      );
      if (mode === "anchor" && part.kind === "anchor" && drawn.cell.form === this.state.form)
        group.append(
          s(
            "text",
            {
              x: ax + size * 1.4,
              y: -ay - size * 0.6,
              class: "anchor-label",
              "font-size": 26 * k,
              transform: "scale(1 -1)",
            },
            this.className(part.handle.kind === "anchor" ? part.handle.cls : ""),
          ),
        );
    }
    drawn.layout.pieces.forEach((piece, i) => {
      const link = attach[i];
      const own = model.positioning.anchors[piece.name]?.mark?.find((a) => a.class === link?.cls);
      const at = placed[i];
      if (!link || !own || !at) return;
      group.append(
        s(
          "circle",
          {
            cx: drawn.x + piece.x + at.dx + own.x,
            cy: piece.y + at.dy + own.y,
            r: size * 0.8,
            class: "anchor anchor-mark",
          },
          s("title", {}, `${piece.name} attaches here through ${this.className(link.cls)}`),
        ),
      );
    });
    return group;
  }

  private sidePanel(cell: Cell, choice: FontChoice): HTMLElement {
    const model = this.model;
    const editable = model.editing(choice) && !model.showsBaked(choice);
    const parts = this.cellParts(choice, cell);
    const part = this.activePart(cell, parts);
    const options = part ? this.options(cell, part) : [];
    const option = part ? this.option(cell, part) : undefined;
    const modes = h(
      "fieldset",
      { class: "inline drag-modes" },
      h("legend", {}, "Drag"),
      ...DRAG_MODES.map((mode) => {
        const input = h("input", {
          type: "radio",
          name: "drag",
          value: mode,
          checked: this.state.drag === mode,
          "data-focus-id": `drag-${mode}`,
        });
        input.addEventListener("change", () => this.setState({ drag: mode }));
        return h("label", {}, input, ` ${DRAG_LABELS[mode]}`);
      }),
    );
    const handles = this.handlesOf(parts);
    const list = h(
      "div",
      { class: "part-list", role: "group", "aria-label": "Parts" },
      ...handles.map((p) => {
        const button = h(
          "button",
          {
            type: "button",
            class: "chip",
            "aria-pressed": String(p.key === part?.key),
            "data-focus-id": `part-${p.key}`,
          },
          p.label,
        );
        button.addEventListener("click", () => {
          this.active = `${cell.form}|${p.key}`;
          this.render();
        });
        return button;
      }),
    );
    const scopes = option
      ? h(
          "fieldset",
          { class: "scopes" },
          h("legend", {}, "Scope"),
          ...options.map((o) => {
            const input = h("input", {
              type: "radio",
              name: "scope",
              value: o.scope,
              checked: o.scope === option.scope,
              "data-focus-id": `scope-${o.scope}`,
            });
            input.addEventListener("change", () => {
              if (part) this.scopes.set(`${cell.form}|${part.key}`, o.scope);
              this.render();
            });
            const count = model.blastRadius(o.targets).length;
            return h(
              "label",
              { class: "scope" },
              input,
              ` ${o.label} `,
              h("span", { class: "muted small" }, `${count} cell${count === 1 ? "" : "s"}`),
            );
          }),
        )
      : null;
    const target = option?.targets[0];
    const field = (axis: "x" | "y") => {
      const [dx, dy] = target ? offsetOf(model.edits, target) : [0, 0];
      const input = h("input", {
        type: "number",
        step: 1,
        value: axis === "x" ? dx : dy,
        id: `edit-${axis}`,
        disabled: !editable || !option,
        "data-focus-id": `edit-${axis}`,
      });
      input.addEventListener("change", () => {
        if (!option || !target) return;
        const before = model.edits;
        const [x, y] = offsetOf(before, target);
        const entered = Math.round(Number(input.value) || 0);
        const delta: Offset = axis === "x" ? [entered - x, 0] : [0, entered - y];
        this.commit(before, moveBy(before, option.targets, option.scope, delta, this.stamp()));
      });
      return h("label", { for: `edit-${axis}` }, `${axis} `, input);
    };
    const resetButton = h(
      "button",
      {
        type: "button",
        class: "small-button",
        disabled:
          !editable ||
          !option ||
          option.targets.every((t) => offsetOf(model.edits, t).every((v) => v === 0)),
        "data-focus-id": "edit-reset",
      },
      "Reset",
    );
    resetButton.addEventListener("click", () => {
      if (!option) return;
      const before = model.edits;
      this.commit(before, reset(before, option.targets, this.stamp()));
    });
    const undo = h(
      "button",
      { type: "button", disabled: !this.history.canUndo, "data-focus-id": "undo" },
      "Undo",
    );
    undo.addEventListener("click", () => this.undo());
    const redo = h(
      "button",
      { type: "button", disabled: !this.history.canRedo, "data-focus-id": "redo" },
      "Redo",
    );
    redo.addEventListener("click", () => this.redo());
    const hint = editable
      ? "Drag a handle, or focus it and use the arrow keys (Shift for 25 units). The scope says which font rule the move becomes and how far it reaches; the smallest that does the job is picked first. Offsets are in font units at wght 400. Ctrl+Z undoes, Ctrl+Shift+Z redoes."
      : choice === "source"
        ? "Edits apply to the calibrated font."
        : model.showsBaked(choice)
          ? "Showing the baked preview: the font itself, shaped by HarfBuzz, with no overlay. Turn it off to edit."
          : "Turn on proposed offsets to edit them.";
    return h(
      "aside",
      { class: "side" },
      h(
        "section",
        { "aria-labelledby": "offsets-title" },
        h("h3", { id: "offsets-title" }, "Move parts"),
        modes,
        ...(model.showsBaked(choice)
          ? []
          : [
              handles.length
                ? list
                : h(
                    "p",
                    { class: "muted small" },
                    `Nothing to drag here in ${DRAG_LABELS[this.state.drag].toLowerCase()} mode.`,
                  ),
              part ? h("h4", { class: "part-title" }, part.label) : null,
              part ? h("p", { class: "muted small" }, this.attachText(cell, part)) : null,
              scopes,
              option
                ? h("div", { class: "offset-row" }, field("x"), field("y"), resetButton)
                : null,
              h("div", { class: "row" }, undo, redo),
            ]),
        h("p", { class: "muted small" }, hint),
      ),
      this.blastPanel(option),
      this.cellEdits(cell),
      this.noteForm(cell, choice, parts),
      this.cellNotes(cell),
    );
  }

  /** What the part is, in the font's terms: what it hangs on and through which class. */
  private attachText(cell: Cell, part: CellPart): string {
    const handle = part.handle;
    const used = (glyph: string) => {
      const others = this.model
        .usedBy(glyph)
        .filter((u) => u !== `${cell.letter.name} ${cell.form}`);
      return others.length ? ` It is also ${others.join(", ")}.` : "";
    };
    switch (handle.kind) {
      case "body":
        return `The letter's glyph. Its outline carries its anchors, so its dots and marks follow it.${used(handle.glyph)}`;
      case "dots":
        return handle.inline
          ? `Dots drawn inside ${handle.glyph}.`
          : `A dot glyph of its own, attached to ${handle.attach?.parent ?? handle.glyph}${handle.attach ? ` through ${this.className(handle.attach.cls)}` : ""}.`;
      case "mark":
        return handle.attach
          ? `Attached to ${handle.attach.parent} through ${this.className(handle.attach.cls)}${handle.attach.kind === "mark" ? ", stacked on that mark" : ""}.`
          : "No anchor places this mark; only a pair rule can move it.";
      case "anchor":
        return `Where ${this.className(handle.cls)} marks attach to ${handle.glyph}${handle.group.length ? `: here ${handle.group.join(", ")}` : ""}.${used(handle.glyph)}`;
      default:
        return `Where marks of ${this.className(handle.cls)} stack on ${handle.glyph}.`;
    }
  }

  /** The cells the active edit changes: how many, and the first few drawn live. */
  private blastPanel(option: ScopeOption | undefined): HTMLElement {
    const model = this.model;
    const choice = this.state.font;
    const range = this.verticalRange(choice);
    const cells = [...this.affected.values()];
    const shown = cells.slice(0, BLAST_SHOWN);
    return h(
      "section",
      { class: "blast", "aria-labelledby": "blast-title", "data-testid": "blast" },
      h("h3", { id: "blast-title" }, "Blast radius"),
      option
        ? h(
            "p",
            {},
            h("strong", { id: "blast-count" }, `${cells.length}`),
            ` everyday cell${cells.length === 1 ? "" : "s"} change: ${option.label.toLowerCase()}. They are outlined in the matrix.`,
          )
        : h("p", { class: "muted small" }, "Pick a handle to see what moving it reaches."),
      shown.length
        ? h(
            "ul",
            { class: "blast-cells" },
            ...shown.map((c) => {
              const button = h(
                "button",
                {
                  type: "button",
                  class: "chip blast-cell",
                  "data-blast": cellId(c),
                  title: model.cellName(c),
                },
                this.cellSvg(choice, c, range, "blast-svg"),
                h("span", {}, model.cellName(c)),
              );
              button.addEventListener("click", () => this.select(c));
              return h("li", {}, button);
            }),
          )
        : null,
      cells.length > shown.length
        ? h("p", { class: "muted small" }, `and ${cells.length - shown.length} more`)
        : null,
    );
  }

  /** The edits that change this cell, each with how far it reaches. */
  private cellEdits(cell: Cell): HTMLElement {
    const model = this.model;
    const choice = "calib";
    const here = [
      {
        id: cellId(cell),
        layout: model.layout(choice, cell),
        attach: model.cellAttachments(choice, cell),
      },
    ];
    const edits = model.edits.edits.filter((e) => blastRadius([e.target], here).length > 0);
    return h(
      "section",
      { class: "cell-edits", "aria-labelledby": "cell-edits-title" },
      h("h3", { id: "cell-edits-title" }, "Edits on this cell"),
      edits.length
        ? h(
            "ul",
            {},
            ...edits.map((edit) => {
              const remove = h(
                "button",
                {
                  type: "button",
                  class: "link",
                  "data-focus-id": `remove-${targetId(edit.target)}`,
                },
                "Reset",
              );
              remove.addEventListener("click", () => {
                const before = model.edits;
                this.commit(before, reset(before, [edit.target], this.stamp()));
              });
              const count = model.blastRadius([edit.target]).length;
              return h(
                "li",
                { class: "cell-edit", "data-edit": targetId(edit.target) },
                h("span", { class: "glyph-name" }, targetId(edit.target)),
                ` ${edit.dx}, ${edit.dy} `,
                h(
                  "span",
                  { class: "muted small" },
                  `${SCOPE_LABELS[edit.scope].toLowerCase()}, ${count} cells`,
                ),
                " ",
                remove,
              );
            }),
          )
        : h("p", { class: "muted small" }, "None yet."),
    );
  }

  private noteForm(cell: Cell, choice: FontChoice, parts: CellParts): HTMLElement {
    if (!this.pending)
      return h(
        "section",
        {},
        h("h3", {}, "Notes"),
        h("p", { class: "muted small" }, "Click a point on the large glyph to pin a note there."),
      );
    const pending = this.pending;
    const tag = h(
      "select",
      { id: "note-tag", "data-focus-id": "note-tag" },
      ...TAGS.map((t) => h("option", { value: t }, TAG_LABELS[t])),
    );
    const options = [...(parts.body ? [parts.body] : []), ...parts.dots, ...parts.marks].map(
      (part) => ({ part: this.notePart(part), label: `${part.kind}: ${part.label}` }),
    );
    const pendingId = pending.part ? JSON.stringify(pending.part) : "";
    const partSelect = h(
      "select",
      { id: "note-part", "data-focus-id": "note-part" },
      h("option", { value: "" }, "the whole cell"),
      ...options.map((o) =>
        h(
          "option",
          { value: JSON.stringify(o.part), selected: JSON.stringify(o.part) === pendingId },
          o.label,
        ),
      ),
    );
    const severity = h(
      "fieldset",
      { class: "inline" },
      h("legend", {}, "Severity"),
      ...([1, 2, 3] as const).map((n) =>
        h(
          "label",
          {},
          h("input", { type: "radio", name: "severity", value: n, checked: n === 2 }),
          ` ${n}`,
        ),
      ),
    );
    const text = h("textarea", { id: "note-text", rows: 3, "data-focus-id": "note-text" });
    const status = h(
      "select",
      { id: "note-status" },
      ...STATUSES.map((st) => h("option", { value: st }, st)),
    );
    const save = h("button", { type: "submit", class: "primary" }, "Pin note");
    const cancel = h("button", { type: "button" }, "Cancel");
    cancel.addEventListener("click", () => {
      this.pending = null;
      this.render();
    });
    const form = h(
      "form",
      { class: "note-form", "aria-labelledby": "note-form-title" },
      h("h3", { id: "note-form-title" }, `New note at ${pending.x}, ${pending.y}`),
      h("label", { for: "note-tag" }, "Tag ", tag),
      h("label", { for: "note-part" }, "About ", partSelect),
      severity,
      h("label", { for: "note-text" }, "Note ", text),
      h("label", { for: "note-status" }, "Status ", status),
      h("div", { class: "row" }, save, cancel),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const checked = form.querySelector<HTMLInputElement>('input[name="severity"]:checked');
      const note: Note = {
        id: crypto.randomUUID(),
        key: cellKey(cell),
        build: this.model.data.build,
        font: choice,
        x: pending.x,
        y: pending.y,
        tag: tag.value as Tag,
        severity: Number(checked?.value ?? 2) as Severity,
        text: text.value,
        status: status.value as Status,
        created: new Date().toISOString(),
        ...(partSelect.value ? { part: JSON.parse(partSelect.value) as NotePart } : {}),
      };
      this.model.notes = [...this.model.notes, note];
      saveNotes(this.model.notes);
      this.pending = null;
      this.announce("Note pinned");
      this.render();
    });
    return form;
  }

  private noteItem(note: Note, index: number | null): HTMLElement {
    const model = this.model;
    const cell = model.cellFromKey(note.key);
    const status = h(
      "select",
      { "aria-label": "Status", "data-focus-id": `status-${note.id}` },
      ...STATUSES.map((st) => h("option", { value: st, selected: st === note.status }, st)),
    );
    status.addEventListener("change", () => {
      this.model.notes = this.model.notes.map((n) =>
        n.id === note.id ? { ...n, status: status.value as Status } : n,
      );
      saveNotes(this.model.notes);
      this.render();
    });
    const remove = h(
      "button",
      { type: "button", class: "link", "data-focus-id": `delete-${note.id}` },
      "Delete",
    );
    remove.addEventListener("click", () => {
      this.model.notes = this.model.notes.filter((n) => n.id !== note.id);
      saveNotes(this.model.notes);
      this.render();
    });
    const open = cell
      ? h("button", { type: "button", class: "link" }, model.cellName(cell))
      : h("span", {}, `${note.key.letter} ${note.key.form}`);
    if (cell) open.addEventListener("click", () => this.select(cell, "matrix"));
    return h(
      "li",
      { class: `note sev-${note.severity}`, tabindex: -1, "data-note": note.id },
      h(
        "div",
        { class: "note-head" },
        index !== null ? h("span", { class: "pin-number" }, String(index + 1)) : open,
        h("span", { class: "tag" }, TAG_LABELS[note.tag]),
        h("span", { class: "sev" }, `severity ${note.severity}`),
        note.part
          ? h(
              "span",
              { class: "muted small" },
              `on ${note.part.kind} ${note.part.id ?? note.part.glyph}`,
            )
          : null,
        h("span", { class: "muted small" }, note.font),
      ),
      note.text ? h("p", {}, note.text) : null,
      h("div", { class: "row" }, status, remove),
    );
  }

  private cellNotes(cell: Cell): HTMLElement {
    const notes = this.model.notes.filter((n) => keyId(n.key) === keyId(cellKey(cell)));
    return h(
      "section",
      { "aria-label": "Notes on this cell" },
      notes.length
        ? h("ol", { class: "notes" }, ...notes.map((n, i) => this.noteItem(n, i)))
        : null,
    );
  }

  private notesFilter = { status: "", tag: "", severity: "" };

  private notesView(): HTMLElement {
    const filter = this.notesFilter;
    const select = (
      name: keyof typeof filter,
      label: string,
      options: readonly (string | number)[],
    ) => {
      const el = h(
        "select",
        { id: `filter-${name}`, "data-focus-id": `filter-${name}` },
        h("option", { value: "" }, "any"),
        ...options.map((o) =>
          h(
            "option",
            { value: String(o), selected: filter[name] === String(o) },
            name === "tag" ? TAG_LABELS[o as Tag] : String(o),
          ),
        ),
      );
      el.addEventListener("change", () => {
        filter[name] = el.value;
        this.render();
      });
      return h("label", { for: `filter-${name}` }, `${label} `, el);
    };
    const notes = this.model.notes
      .filter(
        (n) =>
          (!filter.status || n.status === filter.status) &&
          (!filter.tag || n.tag === filter.tag) &&
          (!filter.severity || String(n.severity) === filter.severity),
      )
      .toSorted((a, b) => b.severity - a.severity || a.created.localeCompare(b.created));
    return h(
      "section",
      { class: "notes-view", "aria-labelledby": "notes-title" },
      h("h2", { id: "notes-title" }, "All notes"),
      h(
        "div",
        { class: "row filters" },
        select("status", "Status", STATUSES),
        select("tag", "Tag", TAGS),
        select("severity", "Severity", [1, 2, 3]),
      ),
      notes.length
        ? h("ol", { class: "notes" }, ...notes.map((n) => this.noteItem(n, null)))
        : h("p", { class: "muted" }, "No notes match."),
      this.model.edits.edits.length
        ? h(
            "section",
            {},
            h("h3", {}, "Proposed edits"),
            h(
              "ul",
              {},
              ...this.model.edits.edits.map((e) =>
                h(
                  "li",
                  {},
                  `${targetId(e.target)}: ${e.dx}, ${e.dy} (${SCOPE_LABELS[e.scope].toLowerCase()})`,
                ),
              ),
            ),
          )
        : null,
    );
  }

  /** The letter's edge-case lines at reading size and large, with edits drawn. */
  private edgeLines(cell: Cell, choice: FontChoice): HTMLElement {
    const entry = this.model.data.lines[cell.letter.codepoint];
    const lines = entry?.lines ?? [];
    const quran = lines.some((line) => line.source?.corpus === "tanzil");
    return h(
      "section",
      { class: "edge-lines", "aria-labelledby": "edge-title" },
      h("h3", { id: "edge-title" }, `Edge cases for ${cell.letter.name}`),
      h(
        "p",
        { class: "muted small" },
        "Each line puts the letter where it is most likely to go wrong, at 24 px and at 64 px per em, with your moves drawn.",
      ),
      h("ol", { class: "lines" }, ...lines.map((line, i) => this.edgeLine(line, i, choice))),
      entry?.unreached.length
        ? h(
            "details",
            { class: "muted small" },
            h(
              "summary",
              {},
              `${entry.unreached.length} alternates no short string or word reaches`,
            ),
            h(
              "ul",
              {},
              ...entry.unreached.map((u) =>
                h(
                  "li",
                  {},
                  `${u.glyph} from lookup ${u.lookup} (${u.feature})${u.context ? `, ${u.context}` : ""}`,
                ),
              ),
            ),
          )
        : null,
      quran
        ? h(
            "p",
            { class: "credit small" },
            `${this.model.data.credits.tanzil} `,
            h("a", { href: "https://tanzil.net", rel: "noopener" }, "tanzil.net"),
          )
        : null,
    );
  }

  private edgeLine(line: EdgeLine, index: number, choice: FontChoice): HTMLElement {
    const model = this.model;
    const lineLayout = model.lineLayout(choice, line.text);
    const placed = model.linePlacements(choice, lineLayout, line.text);
    const box = layoutBox(lineLayout, model.ink(choice), placed);
    const range = {
      top: Math.max(box?.y1 ?? 0, model.data.metrics.ascender) + 60,
      bottom: Math.min(box?.y0 ?? 0, model.data.metrics.descender) - 60,
    };
    const x0 = Math.min(0, box?.x0 ?? 0) - 40;
    const x1 = Math.max(lineLayout.advance, box?.x1 ?? 0) + 40;
    const svg = (scale: number, cls: string) =>
      s(
        "svg",
        {
          viewBox: `${x0} ${-range.top} ${x1 - x0} ${range.top - range.bottom}`,
          width: Math.round((x1 - x0) * scale),
          height: Math.round((range.top - range.bottom) * scale),
          class: cls,
          role: "img",
          "aria-label": line.text,
        },
        s(
          "g",
          { transform: "scale(1 -1)" },
          s("line", { x1: x0, x2: x1, y1: 0, y2: 0, class: "baseline" }),
          this.drawPieces(choice, lineLayout, placed),
        ),
      );
    return h(
      "li",
      { class: `line line-${line.kind}`, "data-line": index },
      h("span", { class: "line-label" }, line.label),
      h(
        "div",
        { class: "line-samples" },
        svg(READING_SCALE, "line-reading"),
        svg(LARGE_SCALE, "line-large"),
      ),
    );
  }

  private contextRow(cell: Cell): HTMLElement {
    const model = this.model;
    const range = this.verticalRange("calib");
    const top = range.top + 40;
    const bottom = range.bottom - 20;
    const parts: SVGGElement[] = [];
    let x = 0;
    const labels: [number, string][] = [];
    for (const choice of ["calib", "source"] as const) {
      labels.push([x, choice === "calib" ? "calibrated" : "source"]);
      const latin = this.drawText(
        model.latinFont(choice),
        model.fontKey(choice, "latin"),
        "Hxgy ",
        x,
      );
      parts.push(latin.group);
      x += latin.advance;
      const word = this.drawText(
        model.arabicFont(choice),
        model.fontKey(choice, "arabic"),
        contextWord(cell),
        x,
      );
      parts.push(word.group);
      x += word.advance + 500;
    }
    const svg = s(
      "svg",
      {
        viewBox: `-40 ${-top} ${x + 40} ${top - bottom}`,
        width: Math.round((x + 40) * CONTEXT_SCALE),
        height: Math.round((top - bottom) * CONTEXT_SCALE),
        class: "context",
        role: "img",
        "aria-label": `Hxgy and ${contextWord(cell)}, calibrated then source`,
      },
      this.gridLines(x + 40, -40, "calib", 100),
      s("g", { transform: "scale(1 -1)" }, ...parts),
      ...labels.map(([lx, label]) =>
        s("text", { x: lx, y: -top + 110, class: "grid-label strong", "font-size": 100 }, label),
      ),
    );
    return h(
      "section",
      { class: "context-row", "aria-label": "In context" },
      h("h3", {}, "In context"),
      h("div", { class: "canvas-wrap" }, svg),
    );
  }

  private readingSizes(cell: Cell): HTMLElement {
    const word = contextWord(cell);
    const sentence = (choice: FontChoice, size: number) =>
      h(
        "p",
        { class: "reading", style: `font-family: ${cssFamily(choice)}; font-size: ${size}px` },
        h(
          "span",
          { class: "label muted" },
          `${choice === "calib" ? "calibrated" : "source"} ${size}px `,
        ),
        "Hxgy ",
        h("span", { lang: "ar", dir: "rtl" }, `هذه ${word} في جملةٍ عربيّةٍ`),
        " and English text.",
      );
    return h(
      "section",
      { class: "reading-sizes", "aria-labelledby": "reading-title" },
      h("h3", { id: "reading-title" }, "At reading size"),
      h(
        "p",
        { class: "muted small" },
        "Rendered by the browser from the font files, so proposed offsets are not shown here.",
      ),
      sentence("calib", 16),
      sentence("calib", 24),
      sentence("source", 16),
      sentence("source", 24),
    );
  }
}

const THEME_KEY = "sawa-lab:theme";

function applyTheme(theme: string | null): void {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function toggleTheme(): void {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Theme then lasts for this page only.
  }
}

try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  applyTheme(null);
}

load()
  .then((model) => new App(model).start())
  .catch((error: unknown) => {
    const app = document.querySelector("#app");
    app?.replaceChildren(
      h("p", { class: "error" }, `Sawa Lab could not start: ${(error as Error).message}`),
    );
  });
