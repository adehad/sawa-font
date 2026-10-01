import "./style.css";
import { type Layout, type Offsets, analyse, pieceBox, pieceOffset } from "./cells";
import { h, s } from "./dom";
import { em, lineBox } from "./envelope";
import { HbFont, harfbuzzVersion } from "./hb";
import { type Cell, Model, cellKey } from "./model";
import { type View, parseState, serializeState } from "./state";
import {
  type Note,
  type Override,
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
import { type FontChoice, type Form, type LabData, NO_MARK } from "./types";

const BASE = import.meta.env.BASE_URL;
/** Inspector scale: 0.3 px per font unit puts the em at 300 px. */
const INSPECTOR_SCALE = 0.3;
const CONTEXT_SCALE = 0.11;

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

class App {
  private readonly defs = s("defs");
  private readonly defined = new Set<string>();
  private readonly root = document.querySelector("#app") as HTMLElement;
  private readonly live = h("p", { class: "visually-hidden", "aria-live": "polite" });
  private pending: { x: number; y: number } | null = null;
  private focusCell: string | null = null;

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

  private glyphRef(fontKey: string, font: HbFont, gid: number): string {
    const id = `g-${fontKey}-${gid}`;
    if (!this.defined.has(id)) {
      this.defs.append(s("path", { id, d: font.path(gid) }));
      this.defined.add(id);
    }
    return `#${id}`;
  }

  /** The cell's glyphs as <use> elements in a y-up group, marks tagged for styling. */
  private drawCell(choice: FontChoice, cell: Cell, offsets: Offsets, x = 0): SVGGElement {
    const font = this.model.arabicFont(choice);
    const key = this.model.fontKey(choice, "arabic");
    const group = s("g", { transform: `translate(${x} 0)` });
    for (const piece of this.model.layout(choice, cell).pieces) {
      const [dx, dy] = pieceOffset(piece, offsets);
      group.append(
        s("use", {
          href: this.glyphRef(key, font, piece.gid),
          transform: `translate(${piece.x + dx} ${piece.y + dy})`,
          class: piece.kind === "mark" ? "ink-mark" : "ink-base",
          "data-mark": piece.kind === "mark" ? piece.mark : null,
        }),
      );
    }
    return group;
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
          { title: "Draw the offsets you proposed by dragging marks" },
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
          this.model.overrides = mergeOverrides(this.model.overrides, parseOverrides(value));
          saveOverrides(this.model.overrides);
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
    this.model.invalidate();
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
            h(
              "tr",
              {},
              h("th", { scope: "row" }, "Arabic everyday"),
              h("td", {}, em(arabic.top, upm)),
              h("td", {}, em(arabic.bottom, upm)),
              h("td", {}, em(arabic.top - arabic.bottom, upm)),
            ),
            h(
              "tr",
              { class: "total" },
              h("th", { scope: "row" }, "Line box both need"),
              h("td", {}, em(box.top, upm)),
              h("td", {}, em(box.bottom, upm)),
              h("td", {}, `${em(box.height, upm)} em`),
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
    const box = lineBox(arabic, latin);
    return { top: box.top + 60, bottom: box.bottom - 60 };
  }

  private cellSvg(
    choice: FontChoice,
    cell: Cell,
    range: { top: number; bottom: number },
    cls: string,
  ): SVGSVGElement {
    const offsets = this.model.offsets(choice, cell);
    const box = this.model.box(choice, cell);
    const advance = this.model.layout(choice, cell).advance;
    const x0 = Math.min(0, box?.x0 ?? 0) - 60;
    const x1 = Math.max(advance, box?.x1 ?? 0) + 60;
    const group = s(
      "g",
      { transform: "scale(1 -1)" },
      s("line", { x1: x0, x2: x1, y1: 0, y2: 0, class: "baseline" }),
      this.drawCell(choice, cell, offsets),
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
    const hasOffset = choice === "calib" && model.override(cell) !== undefined;
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
    const offsets = model.offsets(choice, cell);
    const analysis = model.analysis(choice, cell);
    const upm = model.upm;
    const close = h(
      "button",
      { type: "button", class: "close", "data-focus-id": "close" },
      "Close",
    );
    close.addEventListener("click", () => this.setState({ letter: null, form: null }, true));
    const readout = h(
      "p",
      { class: "readout", "aria-live": "polite" },
      !analysis.hasMarks
        ? "No mark"
        : analysis.clash
          ? h(
              "strong",
              { class: "bad" },
              `Clash: gap ${em(analysis.gap, upm, 3)} em under ${model.data.clearance} em`,
            )
          : `Clear: gap ${Number.isFinite(analysis.gap) ? em(analysis.gap, upm, 3) : "> 0.2"} em`,
      ` · ink top ${em(analysis.top, upm)} em, bottom ${em(analysis.bottom, upm)} em`,
    );
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
        this.canvas(cell, choice, offsets, readout),
        this.sidePanel(cell, choice, offsets),
      ),
      this.contextRow(cell),
      this.readingSizes(cell),
    );
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

  private canvas(
    cell: Cell,
    choice: FontChoice,
    offsets: Offsets,
    readout: HTMLElement,
  ): HTMLElement {
    const model = this.model;
    const latinFont = model.latinFont(choice);
    const range = this.verticalRange(choice);
    const top = range.top + 120;
    const bottom = range.bottom - 60;
    const labels = 520;
    const cellLayout: Layout = model.layout(choice, cell);
    const box = model.box(choice, cell);
    const clusterX = labels + 120 - Math.min(0, box?.x0 ?? 0);
    const latinX = clusterX + Math.max(cellLayout.advance, box?.x1 ?? 0) + 200;
    const latin = this.drawText(latinFont, model.fontKey(choice, "latin"), "Hxgy", latinX);
    const width = latinX + latin.advance + 120;
    const height = top - bottom;
    const svg = s("svg", {
      viewBox: `0 ${-top} ${width} ${height}`,
      width: Math.round(width * INSPECTOR_SCALE),
      height: Math.round(height * INSPECTOR_SCALE),
      class: "big",
      role: "img",
      "aria-label": `${model.cellName(cell)} at 300 px per em on the Latin grid. Click to pin a note.`,
    });
    const glyphs = s(
      "g",
      { transform: "scale(1 -1)" },
      latin.group,
      this.drawCell(choice, cell, offsets, clusterX),
    );
    svg.append(this.gridLines(width, 0, choice), glyphs);
    const font = model.arabicFont(choice);
    const outline = (gid: number) => font.outline(gid);
    const editable = choice === "calib" && this.state.offsets;
    const markPieces = cellLayout.pieces.filter(
      (p) => p.kind === "mark" && font.outline(p.gid).length > 0,
    );
    const current: Record<number, [number, number]> = {};
    for (const piece of markPieces) current[piece.mark] = [...pieceOffset(piece, offsets)];

    const toFont = (event: PointerEvent | MouseEvent): [number, number] => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return [point.x, -point.y];
    };

    for (const piece of markPieces) {
      const pbox = pieceBox(piece, outline, current);
      if (!pbox) continue;
      const handle = s("circle", {
        cx: clusterX + (pbox.x0 + pbox.x1) / 2,
        cy: -(pbox.y0 + pbox.y1) / 2,
        r: 34,
        class: `handle${editable ? "" : " disabled"}`,
        tabindex: editable ? 0 : -1,
        role: "button",
        "data-focus-id": `handle-${piece.mark}`,
        "data-handle": piece.mark,
        "aria-label": `Mark ${piece.mark + 1} (${font.name(piece.gid)}): drag or use arrow keys to move it; offset ${current[piece.mark]?.join(", ")}`,
      });
      if (editable) {
        const update = (dx: number, dy: number, commit: boolean) => {
          current[piece.mark] = [Math.round(dx), Math.round(dy)];
          const use = glyphs.querySelector<SVGUseElement>(`use[data-mark="${piece.mark}"]`);
          use?.setAttribute(
            "transform",
            `translate(${piece.x + (current[piece.mark]?.[0] ?? 0)} ${piece.y + (current[piece.mark]?.[1] ?? 0)})`,
          );
          const moved = pieceBox(piece, outline, current);
          if (moved) {
            handle.setAttribute("cx", String(clusterX + (moved.x0 + moved.x1) / 2));
            handle.setAttribute("cy", String(-(moved.y0 + moved.y1) / 2));
          }
          const live = analyseLive(model, choice, cellLayout, current);
          readout.textContent = `${live}  ·  offset ${current[piece.mark]?.join(", ")}`;
          if (commit) this.saveOffsets(cell, current);
        };
        handle.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          handle.setPointerCapture(event.pointerId);
          const [sx, sy] = toFont(event);
          const [ox, oy] = current[piece.mark] ?? [0, 0];
          const onMove = (e: PointerEvent) => {
            const [x, y] = toFont(e);
            update(ox + x - sx, oy + y - sy, false);
          };
          const onUp = () => {
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            this.saveOffsets(cell, current);
          };
          handle.addEventListener("pointermove", onMove);
          handle.addEventListener("pointerup", onUp);
        });
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
          const [ox, oy] = current[piece.mark] ?? [0, 0];
          update(ox + delta[0], oy + delta[1], true);
        });
      }
      svg.append(handle);
    }

    const cellNotes = model.notes.filter((n) => keyId(n.key) === keyId(cellKey(cell)));
    cellNotes.forEach((note, i) => {
      const pin = s(
        "g",
        {
          class: `pin sev-${note.severity}`,
          transform: `translate(${clusterX + note.x} ${-note.y})`,
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
    if (this.pending) {
      svg.append(
        s("circle", {
          cx: clusterX + this.pending.x,
          cy: -this.pending.y,
          r: 30,
          class: "pin pending",
        }),
      );
    }
    svg.addEventListener("click", (event) => {
      if ((event.target as Element).closest(".handle, .pin")) return;
      const [x, y] = toFont(event);
      this.pending = { x: Math.round(x - clusterX), y: Math.round(y) };
      this.render();
      this.root.querySelector<HTMLElement>("#note-tag")?.focus();
    });
    return h("div", { class: "canvas-wrap" }, svg);
  }

  private saveOffsets(cell: Cell, current: Record<number, [number, number]>): void {
    const font = this.model.arabicFont("calib");
    const pieces = this.model.layout("calib", cell).pieces.filter((p) => p.kind === "mark");
    const marks = pieces.map((p) => ({
      index: p.mark,
      glyph: font.name(p.gid),
      dx: current[p.mark]?.[0] ?? 0,
      dy: current[p.mark]?.[1] ?? 0,
    }));
    const id = keyId(cellKey(cell));
    const rest = this.model.overrides.filter((o) => keyId(o.key) !== id);
    const moved = marks.some((m) => m.dx !== 0 || m.dy !== 0);
    const entry: Override = {
      key: cellKey(cell),
      build: this.model.data.build,
      wght: this.model.data.wght,
      marks,
      updated: new Date().toISOString(),
    };
    this.model.overrides = moved ? [...rest, entry] : rest;
    saveOverrides(this.model.overrides);
    this.model.invalidate();
    this.render();
  }

  private sidePanel(cell: Cell, choice: FontChoice, offsets: Offsets): HTMLElement {
    const model = this.model;
    const font = model.arabicFont(choice);
    const markPieces = model.layout(choice, cell).pieces.filter((p) => p.kind === "mark");
    const editable = choice === "calib" && this.state.offsets;
    const offsetFields = markPieces.map((piece) => {
      const [dx, dy] = pieceOffset(piece, offsets);
      const field = (axis: "x" | "y", value: number) => {
        const input = h("input", {
          type: "number",
          step: 1,
          value,
          id: `offset-${piece.mark}-${axis}`,
          disabled: !editable,
          "data-focus-id": `offset-${piece.mark}-${axis}`,
        });
        input.addEventListener("change", () => {
          const current: Record<number, [number, number]> = {};
          for (const p of markPieces) current[p.mark] = [...pieceOffset(p, offsets)];
          const entered = Math.round(Number(input.value) || 0);
          const pair = current[piece.mark] ?? [0, 0];
          current[piece.mark] = axis === "x" ? [entered, pair[1]] : [pair[0], entered];
          this.saveOffsets(cell, current);
        });
        return h("label", { for: `offset-${piece.mark}-${axis}` }, `${axis} `, input);
      };
      return h(
        "div",
        { class: "offset-row" },
        h("span", { class: "glyph-name" }, font.name(piece.gid)),
        field("x", dx),
        field("y", dy),
      );
    });
    const reset = h(
      "button",
      {
        type: "button",
        disabled: !editable || !model.override(cell),
        "data-focus-id": "reset-offsets",
      },
      "Reset offsets",
    );
    reset.addEventListener("click", () => this.saveOffsets(cell, {}));
    const hint = editable
      ? "Drag a mark's handle, or focus it and use the arrow keys (Shift for 25 units). Offsets are in font units at wght 400 and only change this preview."
      : choice === "source"
        ? "Offsets apply to the calibrated font."
        : "Turn on proposed offsets to edit them.";
    return h(
      "aside",
      { class: "side" },
      h(
        "section",
        { "aria-labelledby": "offsets-title" },
        h("h3", { id: "offsets-title" }, "Mark offsets"),
        markPieces.length
          ? h("div", {}, ...offsetFields, reset)
          : h("p", { class: "muted" }, "This cell has no mark."),
        h("p", { class: "muted small" }, hint),
      ),
      this.noteForm(cell, choice),
      this.cellNotes(cell),
    );
  }

  private noteForm(cell: Cell, choice: FontChoice): HTMLElement {
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
      this.model.overrides.length
        ? h(
            "section",
            {},
            h("h3", {}, "Proposed offsets"),
            h(
              "ul",
              {},
              ...this.model.overrides.map((o) => {
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

function analyseLive(
  model: Model,
  choice: FontChoice,
  cellLayout: Layout,
  offsets: Offsets,
): string {
  const font = model.arabicFont(choice);
  const upm = model.upm;
  const live = analyse(cellLayout, (gid) => font.outline(gid), offsets, model.clearanceUnits);
  if (!live.hasMarks) return "No mark";
  const gap = Number.isFinite(live.gap) ? em(live.gap, upm, 3) : "> 0.2";
  return `${live.clash ? "Clash" : "Clear"}: gap ${gap} em · ink top ${em(live.top, upm)} em, bottom ${em(live.bottom, upm)} em`;
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
