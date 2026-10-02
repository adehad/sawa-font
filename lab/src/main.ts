import "./style.css";
import { type Layout, type Placement, analyse, layoutBox } from "./cells";
import { h, s } from "./dom";
import {
  History,
  type Offset,
  type PartRef,
  type Stamp,
  moveBy,
  offsetOf,
  refId,
  resetPart,
} from "./edits";
import { em, lineBox } from "./envelope";
import { bounds } from "./geometry";
import { HbFont, harfbuzzVersion } from "./hb";
import { type Cell, Model, cellKey } from "./model";
import { DRAG_MODES, type DragMode, type View, parseState, serializeState } from "./state";
import {
  type Note,
  type NotePart,
  type Overrides,
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
/** Inspector scale: 0.3 px per font unit puts the em at 300 px. */
const INSPECTOR_SCALE = 0.3;
const CONTEXT_SCALE = 0.11;
/** Edge-case lines at reading size (24 px per em) and large (64 px per em). */
const READING_SCALE = 0.024;
const LARGE_SCALE = 0.064;

const DRAG_LABELS: Record<DragMode, string> = {
  mark: "Marks",
  letter: "Whole letter",
  dot: "Dots",
};

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`${BASE}fonts/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.arrayBuffer();
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
  return new Model(
    data,
    {
      calib: new HbFont(calib),
      notoArabic: new HbFont(notoArabic),
      notoSans: new HbFont(notoSans),
    },
    parseState(location.search),
    loadNotes(),
    loadOverrides(),
  );
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

/** One movable part of a cell, with where it is drawn. */
interface CellPart {
  ref: PartRef;
  label: string;
  kind: "body" | "dots" | "mark";
  /** The layout piece the part is, or lives in. */
  piece: number;
  /** A dot group drawn inside the piece's glyph. */
  inline?: string;
}

interface CellParts {
  body?: CellPart;
  dots: CellPart[];
  marks: CellPart[];
}

/** One cell drawn on the inspector canvas. */
interface Drawn {
  cell: Cell;
  x: number;
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
  private commit(before: Overrides, next: Overrides): void {
    if (JSON.stringify(before) === JSON.stringify(next)) {
      this.model.overrides = next;
      this.render();
      return;
    }
    this.history.push(before);
    this.model.overrides = next;
    saveOverrides(next);
    this.render();
  }

  private undo(): void {
    const previous = this.history.undo(this.model.overrides);
    if (!previous) return;
    this.model.overrides = previous;
    saveOverrides(previous);
    this.announce("Undone");
    this.render();
  }

  private redo(): void {
    const next = this.history.redo(this.model.overrides);
    if (!next) return;
    this.model.overrides = next;
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
      download("overrides.json", overridesFile(this.model.overrides)),
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
          const before = this.model.overrides;
          const next = mergeOverrides(before, parseOverrides(value));
          this.history.push(before);
          this.model.overrides = next;
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
    const text = summary(this.model.notes, this.model.overrides, this.model.data.build, {
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
    const edited = model.editing(choice) && model.overrides.glyphs.length > 0;
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
    return h("section", { class: "matrix-wrap", "aria-label": "Matrix" }, table);
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
    const button = h(
      "button",
      {
        type: "button",
        class: `cell${analysis.clash ? " clash" : ""}${impossible ? " implausible" : ""}`,
        tabindex: focus ? 0 : -1,
        "data-cell": id,
        "data-focus-id": `cell-${id}`,
        "aria-label": `${model.cellName(cell)}${impossible ? " (impossible in ordinary spelling)" : ""}: ${status}, top ${em(analysis.top, upm)} em, bottom ${em(analysis.bottom, upm)} em${hasOffset ? ", offset proposed" : ""}${notes ? `, ${notes} notes` : ""}`,
      },
      this.cellSvg(choice, cell, range, "mini"),
      h("span", { class: `badge ${analysis.clash ? "bad" : "ok"}` }, status),
      h("span", { class: "extent" }, `↑${em(analysis.top, upm)} ↓${em(analysis.bottom, upm)}`),
      impossible ? h("span", { class: "flag impossible" }, "impossible combination") : null,
      hasOffset ? h("span", { class: "flag" }, "offset") : null,
      notes ? h("span", { class: "flag" }, `${notes} note${notes > 1 ? "s" : ""}`) : null,
    );
    button.addEventListener("click", () => this.select(cell));
    return button;
  }

  /** Whether any part of the cell has been moved, by a glyph or a mark override. */
  private cellMoved(cell: Cell): boolean {
    if (this.model.override(cell)) return true;
    const form = this.model.letterForm(cell.letter, cell.form);
    return this.model.overrides.glyphs.some((o) => form?.glyphs.includes(o.glyph));
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
            class: `tiny${analysis.clash ? " clash" : ""}${model.plausible(cell.letter, mark) ? "" : " implausible"}`,
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
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
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

  /** The cell's movable parts: its body, its dot groups and its marks. */
  private cellParts(choice: FontChoice, cell: Cell): CellParts {
    const model = this.model;
    const cellLayout = model.layout(choice, cell);
    const font = model.arabicFont(choice);
    const form = model.letterForm(cell.letter, cell.form);
    const inked = (i: number) => font.outline(cellLayout.pieces[i]?.gid ?? 0).length > 0;
    const bodyIndex = cellLayout.pieces.findIndex(
      (p, i) => p.kind === "base" && p.owner === i && inked(i) && p.name === form?.body,
    );
    const result: CellParts = { dots: [], marks: [] };
    const bodyPiece = cellLayout.pieces[bodyIndex];
    if (bodyPiece) {
      result.body = {
        ref: { kind: "body", glyph: bodyPiece.name },
        label: bodyPiece.name,
        kind: "body",
        piece: bodyIndex,
      };
      for (const part of model.glyphInfo(bodyPiece.name)?.parts ?? []) {
        if (part.kind === "body") continue;
        result.dots.push({
          ref: { kind: "dots", glyph: bodyPiece.name, part: part.id },
          label: part.label,
          kind: "dots",
          piece: bodyIndex,
          inline: part.id,
        });
      }
    }
    cellLayout.pieces.forEach((piece, i) => {
      if (piece.kind === "mark" && inked(i)) {
        result.marks.push({
          ref: {
            kind: "mark",
            key: cellKey(cell),
            index: piece.mark,
            glyph: piece.name,
            ...(bodyPiece ? { base: bodyPiece.name } : {}),
          },
          label: piece.name,
          kind: "mark",
          piece: i,
        });
      } else if (bodyPiece && piece.owner === bodyIndex && i !== bodyIndex && piece.adjacent) {
        const part = form?.parts.find((p) => p.id === piece.name);
        result.dots.push({
          ref: { kind: "dots", glyph: bodyPiece.name, part: piece.name },
          label: part?.label ?? piece.name,
          kind: "dots",
          piece: i,
        });
      }
    });
    result.marks.sort((a, b) =>
      a.ref.kind === "mark" && b.ref.kind === "mark" ? a.ref.index - b.ref.index : 0,
    );
    return result;
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
        this.canvas([cell], choice, readout),
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

  /** The handles the drag mode offers on one drawn cell, each with where it sits. */
  private handlesFor(drawn: Drawn): CellPart[] {
    const mode = this.state.drag;
    if (mode === "letter") return drawn.parts.body ? [drawn.parts.body] : [];
    if (mode === "dot") return drawn.parts.dots;
    return drawn.parts.marks;
  }

  /** Where a part's ink is centred, in the drawn cell's font units. */
  private partCenter(drawn: Drawn, part: CellPart, choice: FontChoice): [number, number] | null {
    const model = this.model;
    const piece = drawn.layout.pieces[part.piece];
    const at = model.placements(choice, drawn.cell)[part.piece];
    if (!piece || !at) return null;
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
    const top = range.top + 120;
    const bottom = range.bottom - 60;
    const labels = 520;
    const editable = model.editing(choice);
    const drawn: Drawn[] = [];
    let x = labels + 120;
    for (const cell of cells) {
      const cellLayout = model.layout(choice, cell);
      const box = model.box(choice, cell, false);
      const cellX = x - Math.min(0, box?.x0 ?? 0);
      drawn.push({
        cell,
        x: cellX,
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
    const height = top - bottom;
    const selected = model.selected();
    const svg = s("svg", {
      viewBox: `0 ${-top} ${width} ${height}`,
      width: Math.round(width * INSPECTOR_SCALE),
      height: Math.round(height * INSPECTOR_SCALE),
      class: "big",
      role: "img",
      "aria-label": `${cells.map((c) => model.cellName(c)).join(", ")} at 300 px per em on the Latin grid. Click to pin a note.`,
    });
    const glyphs = s("g", { transform: "scale(1 -1)" }, latin.group);
    for (const d of drawn) glyphs.append(d.glyphs);
    svg.append(this.gridLines(width, 0, choice));
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
        d.glyphs.replaceChildren(this.drawCell(choice, d.cell, d.x), this.anchorMarks(choice, d));
        d.ink.replaceChildren(...this.inkLines(choice, d));
      }
      for (const { el, drawn: d, part } of handles) {
        const at = this.partCenter(d, part, choice);
        if (!at) continue;
        el.setAttribute("cx", String(d.x + at[0]));
        el.setAttribute("cy", String(-at[1]));
      }
      if (selected) readout.textContent = this.readoutText(choice, selected);
    };

    for (const d of drawn) {
      for (const part of this.handlesFor(d)) {
        const id = refId(part.ref);
        const handle = s("circle", {
          r: 34,
          class: `handle handle-${part.kind}${editable ? "" : " disabled"}`,
          tabindex: editable ? 0 : -1,
          role: "button",
          "data-focus-id": `handle-${id}`,
          "data-handle": part.ref.kind === "mark" ? part.ref.index : null,
          "data-part": id,
          "aria-label": `${part.kind === "body" ? "Letter" : part.kind === "dots" ? "Dots" : "Mark"} ${part.label} of ${model.cellName(d.cell)}: drag or use arrow keys to move it; offset ${offsetOf(model.overrides, part.ref).join(", ")}`,
        });
        handles.push({ el: handle, drawn: d, part });
        if (editable) this.wireHandle(handle, part.ref, toFont, redraw);
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
          s("circle", { r: 30 }),
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
            r: 30,
            class: "pin pending",
          }),
        );
      }
      svg.addEventListener("click", (event) => {
        if ((event.target as Element).closest(".handle, .pin")) return;
        const [fx, fy] = toFont(event);
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
    const ref = part.ref;
    if (ref.kind === "body") return { kind: "body", glyph: ref.glyph };
    if (ref.kind === "dots") return { kind: "dots", glyph: ref.glyph, id: ref.part };
    return { kind: "mark", glyph: ref.glyph, index: ref.index };
  }

  /** The refs an edit to `ref` moves together. */
  protected linked(ref: PartRef): PartRef[] {
    return [ref];
  }

  private wireHandle(
    handle: SVGCircleElement,
    ref: PartRef,
    toFont: (event: PointerEvent) => [number, number],
    redraw: () => void,
  ): void {
    handle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const [sx, sy] = toFont(event);
      const before = this.model.overrides;
      const refs = this.linked(ref);
      const stamp = this.stamp();
      const onMove = (e: PointerEvent) => {
        const [x, y] = toFont(e);
        this.model.overrides = moveBy(before, refs, [x - sx, y - sy], stamp);
        redraw();
        this.queueEnvelope();
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this.commit(before, this.model.overrides);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 25 : 5;
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const before = this.model.overrides;
      this.commit(before, moveBy(before, this.linked(ref), delta, this.stamp()));
    });
  }

  /** Dashed lines at the cell's ink top and bottom, labelled in em. */
  private inkLines(choice: FontChoice, drawn: Drawn): SVGElement[] {
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
          y: -(y as number) + (label === "ink top" ? -12 : 40),
          class: "ink-label",
          "font-size": 30,
        },
        `${label} ${em(y as number, upm)}`,
      ),
    ]);
  }

  /** The body glyph's attachment anchors, which move with it. */
  private anchorMarks(choice: FontChoice, drawn: Drawn): SVGGElement {
    const group = s("g", { class: "anchors" });
    const body = drawn.parts.body;
    if (!body || this.state.drag !== "letter") return group;
    const piece = drawn.layout.pieces[body.piece];
    const at = this.model.placements(choice, drawn.cell)[body.piece];
    if (!piece || !at) return group;
    for (const anchor of this.model.glyphInfo(piece.name)?.anchors ?? []) {
      if (anchor.kind !== "base" && anchor.kind !== "ligature") continue;
      const ax = drawn.x + piece.x + at.dx + anchor.x;
      const ay = piece.y + at.dy + anchor.y;
      group.append(
        s(
          "path",
          { d: `M${ax - 18} ${ay}H${ax + 18}M${ax} ${ay - 18}V${ay + 18}`, class: "anchor" },
          s("title", {}, `anchor ${anchor.x}, ${anchor.y} (${anchor.lookups.join(", ")})`),
        ),
      );
    }
    return group;
  }

  private sidePanel(cell: Cell, choice: FontChoice): HTMLElement {
    const model = this.model;
    const editable = model.editing(choice);
    const parts = this.cellParts(choice, cell);
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
    const field = (part: CellPart, axis: "x" | "y", id: string) => {
      const [dx, dy] = offsetOf(model.overrides, part.ref);
      const input = h("input", {
        type: "number",
        step: 1,
        value: axis === "x" ? dx : dy,
        id: `${id}-${axis}`,
        disabled: !editable,
        "data-focus-id": `${id}-${axis}`,
      });
      input.addEventListener("change", () => {
        const before = model.overrides;
        const [x, y] = offsetOf(before, part.ref);
        const entered = Math.round(Number(input.value) || 0);
        const target: Offset = axis === "x" ? [entered, y] : [x, entered];
        const delta: Offset = [target[0] - x, target[1] - y];
        this.commit(before, moveBy(before, this.linked(part.ref), delta, this.stamp()));
      });
      return h("label", { for: `${id}-${axis}` }, `${axis} `, input);
    };
    const reset = (part: CellPart, id: string) => {
      const [dx, dy] = offsetOf(model.overrides, part.ref);
      const button = h(
        "button",
        {
          type: "button",
          class: "small-button",
          disabled: !editable || (dx === 0 && dy === 0),
          "data-focus-id": `${id}-reset`,
          "aria-label": `Reset ${part.label}`,
        },
        "Reset",
      );
      button.addEventListener("click", () => {
        const before = model.overrides;
        let next = before;
        for (const ref of this.linked(part.ref)) next = resetPart(next, ref, this.stamp());
        this.commit(before, next);
      });
      return button;
    };
    const rowFor = (part: CellPart, id: string, label: string) =>
      h(
        "div",
        { class: "offset-row" },
        h("span", { class: "glyph-name", title: part.label }, label),
        field(part, "x", id),
        field(part, "y", id),
        reset(part, id),
      );
    const body = parts.body;
    const shared = body ? model.usedBy(body.ref.kind === "body" ? body.ref.glyph : "") : [];
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
      ? "Drag a handle, or focus it and use the arrow keys (Shift for 25 units). Moving the letter moves its glyph with its dots and marks, as the font's anchors would; moving dots moves only them. Offsets are in font units at wght 400. Ctrl+Z undoes, Ctrl+Shift+Z redoes."
      : choice === "source"
        ? "Offsets apply to the calibrated font."
        : "Turn on proposed offsets to edit them.";
    return h(
      "aside",
      { class: "side" },
      h(
        "section",
        { "aria-labelledby": "offsets-title" },
        h("h3", { id: "offsets-title" }, "Move parts"),
        modes,
        h("h4", {}, "Letter"),
        body
          ? rowFor(body, "body", body.label)
          : h("p", { class: "muted small" }, "No body glyph."),
        shared.length > 1
          ? h(
              "p",
              { class: "muted small shared" },
              `This glyph is also ${shared.filter((u) => u !== `${cell.letter.name} ${cell.form}`).join(", ")}: moving it moves those too.`,
            )
          : null,
        h("h4", {}, "Dots"),
        parts.dots.length
          ? h("div", {}, ...parts.dots.map((part, i) => rowFor(part, `dot-${i}`, part.label)))
          : h("p", { class: "muted small" }, "No dots."),
        h("h4", {}, "Marks"),
        parts.marks.length
          ? h(
              "div",
              {},
              ...parts.marks.map((part) =>
                rowFor(part, `offset-${part.ref.kind === "mark" ? part.ref.index : 0}`, part.label),
              ),
            )
          : h("p", { class: "muted" }, "This cell has no mark."),
        h("div", { class: "row" }, undo, redo),
        h("p", { class: "muted small" }, hint),
      ),
      this.noteForm(cell, choice, parts),
      this.cellNotes(cell),
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
    const overrides = this.model.overrides;
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
      overrides.glyphs.length || overrides.marks.length
        ? h(
            "section",
            {},
            h("h3", {}, "Proposed offsets"),
            h(
              "ul",
              {},
              ...overrides.glyphs.map((o) =>
                h(
                  "li",
                  {},
                  `${o.glyph} (${o.usedBy.join(", ") || "no listed form"}): `,
                  [
                    ...(o.body.dx || o.body.dy ? [`body ${o.body.dx}, ${o.body.dy}`] : []),
                    ...o.dots.map((d) => `dots ${d.part} ${d.dx}, ${d.dy}`),
                  ].join("; "),
                ),
              ),
              ...overrides.marks.map((o) => {
                const cell = this.model.cellFromKey(o.key);
                return h(
                  "li",
                  {},
                  cell ? this.model.cellName(cell) : keyId(o.key),
                  ": ",
                  o.marks.map((m) => `${m.glyph} ${m.dx}, ${m.dy}`).join("; "),
                );
              }),
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
    const placed = model.linePlacements(choice, lineLayout);
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
