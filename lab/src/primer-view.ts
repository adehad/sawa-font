import { type GlyphMoves, NO_MOVES, type Placement } from "./cells";
import { h, s } from "./dom";
import { type Target, movesOf } from "./edits";
import { em } from "./envelope";
import { type Box, bounds, translate, unionBox } from "./geometry";
import type { HbFont } from "./hb";
import type { Cell, Model } from "./model";
import { type Block, type Primer, inline } from "./primer";
import { NO_MARK } from "./types";

/** Pixels per font unit: rows of cells, and the large anchor demo. */
const ROW_SCALE = 0.16;
const LARGE_SCALE = 0.22;
/** The vertical range every cell in a row is drawn over, so their baselines line up. */
const ROW = { top: 1550, bottom: -850 };
/** Label size in font units on metric lines. */
const LABEL = 80;

interface Drawn {
  group: SVGGElement;
  box: Box | null;
}

function moves(target: Target, dx: number, dy: number): GlyphMoves {
  return movesOf([
    { target, scope: "pair", dx, dy, build: "", wght: 400, usedBy: [], updated: "" },
  ]);
}

function codepoints(value: string): number[] {
  const out: number[] = [];
  for (const char of value) out.push(char.codePointAt(0) ?? 0);
  return out;
}

function text(value: string): (Node | string)[] {
  return inline(value).map((run) => (run.code ? h("code", {}, run.text) : run.text));
}

/** A y-up figure in font units, sized to what is drawn in it plus `margin`. */
function figure(
  parts: Drawn[],
  scale: number,
  label: string,
  extra: {
    top?: number;
    bottom?: number;
    overlay?: SVGElement[];
    margin?: number;
    left?: number;
    right?: number;
  } = {},
): SVGSVGElement {
  const margin = extra.margin ?? 80;
  let box: Box | null = null;
  for (const part of parts) box = unionBox(box, part.box);
  const x0 = Math.min((box?.x0 ?? 0) - margin, extra.left ?? Infinity);
  const x1 = Math.max((box?.x1 ?? 0) + margin, extra.right ?? -Infinity);
  const top = Math.max(box?.y1 ?? 0, extra.top ?? -Infinity) + margin;
  const bottom = Math.min(box?.y0 ?? 0, extra.bottom ?? Infinity) - margin;
  return s(
    "svg",
    {
      viewBox: `${x0} ${-top} ${x1 - x0} ${top - bottom}`,
      width: Math.round((x1 - x0) * scale),
      height: Math.round((top - bottom) * scale),
      role: "img",
      "aria-label": label,
      class: "primer-svg",
    },
    s("g", { transform: "scale(1 -1)" }, ...parts.map((p) => p.group), ...(extra.overlay ?? [])),
  );
}

export class PrimerView {
  constructor(
    private readonly model: Model,
    private readonly primer: Primer,
  ) {}

  private get font(): HbFont {
    return this.model.fonts.calib;
  }

  render(): HTMLElement {
    const primer = this.primer;
    return h(
      "article",
      { class: "primer", lang: primer.lang, "aria-labelledby": "primer-title" },
      h("h2", { id: "primer-title" }, primer.title),
      ...primer.intro.map((b) => this.block(b)),
      h(
        "nav",
        { class: "primer-toc", "aria-label": "Sections" },
        h(
          "ol",
          {},
          ...primer.sections.map((section) =>
            h("li", {}, h("a", { href: `#${section.id}` }, section.heading)),
          ),
        ),
      ),
      ...primer.sections.map((section) =>
        h(
          "section",
          { id: section.id, class: "primer-section", "aria-labelledby": `${section.id}-title` },
          h("h3", { id: `${section.id}-title` }, section.heading),
          ...section.blocks.map((b) => this.block(b)),
        ),
      ),
    );
  }

  private block(block: Block): HTMLElement {
    switch (block.kind) {
      case "p":
        return h("p", {}, ...text(block.text));
      case "list":
        return h("ul", {}, ...block.items.map((item) => h("li", {}, ...text(item))));
      case "code":
        return h("pre", { class: "fea" }, h("code", {}, block.text));
      default:
        return this.demo(block.name, block.params);
    }
  }

  private demo(name: string, params: Record<string, string>): HTMLElement {
    const shell = h("figure", { class: "demo", "data-demo": name });
    const list = (key: string) => (params[key] ?? "").split(",").filter(Boolean);
    const cells = () => list("cells").flatMap((id) => this.cell(id) ?? []);
    try {
      switch (name) {
        case "forms":
          this.formsDemo(shell, params.letter ?? "U+0628");
          break;
        case "anchor":
          this.anchorDemo(shell, this.cell(`${params.letter}|${params.form}|${params.mark}`));
          break;
        case "classes":
          this.sliderDemo(
            shell,
            { mechanism: "anchor", glyph: params.glyph ?? "", cls: params.class ?? "" },
            cells(),
            `Move ${params.glyph}'s anchor for marks above`,
          );
          break;
        case "stack":
          this.sliderDemo(
            shell,
            { mechanism: "mkmk-anchor", glyph: params.glyph ?? "", cls: params.class ?? "" },
            cells(),
            `Move ${params.glyph}'s stacking anchor`,
          );
          break;
        case "pair":
          this.sliderDemo(
            shell,
            { mechanism: "pair", base: params.base ?? "", mark: params.mark ?? "" },
            cells(),
            `Adjust ${params.mark} after ${params.base}`,
            -40,
          );
          break;
        case "substitution":
          this.runsDemo(shell, list("texts"), true);
          break;
        case "dots":
          this.dotsDemo(shell, list("letters"));
          break;
        case "scale":
          this.scaleDemo(shell, params.latin ?? "Hxgy", params.arabic ?? "");
          break;
        case "envelope":
          this.envelopeDemo(shell, list("texts"));
          break;
        default:
          shell.append(h("p", { class: "muted" }, `Unknown demo ${name}.`));
      }
    } catch (error) {
      shell.replaceChildren(h("p", { class: "muted" }, `${name}: ${(error as Error).message}`));
    }
    return shell;
  }

  private cell(id: string): Cell | null {
    const [letter = "", form = "", mark = "none"] = id.split("|");
    const l = this.model.letters.get(letter);
    const m = this.model.marks.get(mark) ?? NO_MARK;
    const f = l?.forms.find((x) => x === form);
    return l && f ? { letter: l, form: f, mark: m } : null;
  }

  /** A cell's glyphs at `x`, placed with `with`, each piece classed as ink, mark or dot. */
  private drawCell(cell: Cell, x: number, with_: GlyphMoves = NO_MOVES, ghost = false): Drawn {
    const layout = this.model.layout("calib", cell);
    const placed = this.model.placements("calib", cell, with_);
    return this.drawPieces(layout.pieces, placed, x, ghost);
  }

  private drawPieces(
    pieces: { gid: number; x: number; y: number; kind: string; gdefMark: boolean }[],
    placed: Placement[],
    x: number,
    ghost = false,
  ): Drawn {
    const group = s("g", { class: ghost ? "ghost" : "" });
    let box: Box | null = null;
    pieces.forEach((piece, i) => {
      const at = placed[i] ?? { dx: 0, dy: 0, parts: {} };
      const px = x + piece.x + at.dx;
      const py = piece.y + at.dy;
      const cls = piece.kind === "mark" ? "ink-mark" : piece.gdefMark ? "ink-dot" : "ink-base";
      group.append(
        s("path", {
          d: this.font.path(piece.gid),
          transform: `translate(${px} ${py})`,
          class: cls,
        }),
      );
      box = unionBox(box, bounds(translate(this.font.outline(piece.gid), px, py)));
    });
    return { group, box };
  }

  /** A run of text in `font` from x, as HarfBuzz sets it. */
  private drawRun(font: HbFont, value: string, x: number): Drawn & { advance: number } {
    const group = s("g", {});
    let box: Box | null = null;
    let pen = x;
    for (const glyph of font.shape(codepoints(value))) {
      const px = pen + glyph.xOffset;
      group.append(
        s("path", {
          d: font.path(glyph.gid),
          transform: `translate(${px} ${glyph.yOffset})`,
          class: font.isMark(glyph.gid) ? "ink-mark" : "ink-base",
        }),
      );
      box = unionBox(box, bounds(translate(font.outline(glyph.gid), px, glyph.yOffset)));
      pen += glyph.xAdvance;
    }
    return { group, box, advance: pen - x };
  }

  private glyphNote(glyph: string): string {
    const alt = this.model.positioning.alternates[glyph];
    return alt ? `${glyph}, from GSUB lookup ${alt.lookup} (${alt.feature})` : glyph;
  }

  private formsDemo(shell: HTMLElement, initial: string): void {
    const letters = this.model.data.matrix.letters.filter((l) => l.joining === "dual");
    const select = h(
      "select",
      { "aria-label": "Letter", class: "primer-letter" },
      ...letters.map((l) =>
        h(
          "option",
          { value: l.codepoint, selected: l.codepoint === initial },
          `${l.char} ${l.name}`,
        ),
      ),
    );
    const body = h("div", { class: "demo-body" });
    const draw = () => {
      const letter = this.model.letters.get(select.value);
      if (!letter) return;
      const forms = letter.forms;
      body.replaceChildren(
        h(
          "div",
          { class: "demo-row" },
          ...forms.map((form) => {
            const cell = { letter, form, mark: NO_MARK };
            const drawn = this.drawCell(cell, 0);
            const pieces = this.model
              .layout("calib", cell)
              .pieces.filter((p) => this.font.outline(p.gid).length);
            return h(
              "div",
              { class: "demo-cell" },
              figure([drawn], ROW_SCALE, `${letter.name} ${form}`, { top: 1000, bottom: -500 }),
              h("strong", {}, form),
              h(
                "ul",
                { class: "small glyph-list" },
                ...pieces.toReversed().map((p) => h("li", {}, this.glyphNote(p.name))),
              ),
            );
          }),
        ),
      );
    };
    select.addEventListener("change", draw);
    draw();
    shell.append(h("label", { class: "demo-control" }, "Letter ", select), body);
  }

  private anchorDemo(shell: HTMLElement, cell: Cell | null): void {
    if (!cell) throw new Error("no such cell");
    const model = this.model;
    const layout = model.layout("calib", cell);
    const attach = model.cellAttachments("calib", cell);
    const markIndex = layout.pieces.findIndex((p) => p.kind === "mark");
    const link = attach[markIndex];
    const mark = layout.pieces[markIndex];
    const parent = link ? layout.pieces[link.parent] : undefined;
    if (!link || !mark || !parent) throw new Error("the mark has no anchor here");
    const base = model.positioning.anchors[parent.name]?.base?.find((a) => a.class === link.cls);
    const own = model.positioning.anchors[mark.name]?.mark?.find((a) => a.class === link.cls);
    if (!base || !own) throw new Error("no anchors");
    const target: Target = { mechanism: "anchor", glyph: parent.name, cls: link.cls };
    let offset: [number, number] = [0, 0];
    const ink = s("g", {});
    const marks = s("g", {});
    const handle = s("circle", {
      r: 40,
      class: "handle handle-anchor primer-handle",
      tabindex: 0,
      role: "button",
      "aria-label": `${parent.name}'s anchor for marks above: drag, or use the arrow keys`,
      "data-testid": "primer-anchor",
    });
    const readout = h("p", { class: "readout", "aria-live": "polite" });
    const ghost = this.drawCell(cell, 0, NO_MOVES, true);
    const svg = figure([ghost], LARGE_SCALE, `${model.cellName(cell)} with its anchors`, {
      top: base.y + 500,
      overlay: [ink, marks, handle],
    });
    const draw = () => {
      const placed = model.placements("calib", cell, moves(target, ...offset));
      ink.replaceChildren(this.drawPieces(layout.pieces, placed, 0).group);
      const ax = parent.x + base.x + offset[0];
      const ay = parent.y + base.y + offset[1];
      const at = placed[markIndex] ?? { dx: 0, dy: 0 };
      const mx = mark.x + at.dx + own.x;
      const my = mark.y + at.dy + own.y;
      marks.replaceChildren(
        s("path", {
          d: `M${ax - 50} ${ay}H${ax + 50}M${ax} ${ay - 50}V${ay + 50}`,
          class: "anchor anchor-anchor",
        }),
        s("circle", { cx: mx, cy: my, r: 26, class: "anchor anchor-mark" }),
      );
      handle.setAttribute("cx", String(ax));
      handle.setAttribute("cy", String(ay));
      readout.textContent = `${parent.name}'s anchor for ${this.className(link.cls)}: (${base.x + offset[0]}, ${base.y + offset[1]}). ${mark.name}'s own anchor: (${own.x}, ${own.y}). The mark is drawn at their difference, (${base.x + offset[0] - own.x}, ${base.y + offset[1] - own.y}) from the letter's origin.`;
    };
    const toFont = (event: PointerEvent): [number, number] => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return [point.x, -point.y];
    };
    handle.addEventListener("pointerdown", (event) => {
      handle.setPointerCapture(event.pointerId);
      const [sx, sy] = toFont(event);
      const start = offset;
      const onMove = (e: PointerEvent) => {
        const [x, y] = toFont(e);
        offset = [Math.round(start[0] + x - sx), Math.round(start[1] + y - sy)];
        draw();
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 50 : 10;
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      offset = [offset[0] + delta[0], offset[1] + delta[1]];
      draw();
    });
    const reset = h("button", { type: "button" }, "Reset");
    reset.addEventListener("click", () => {
      offset = [0, 0];
      draw();
    });
    draw();
    shell.append(h("div", { class: "demo-body" }, svg), readout, reset);
  }

  private className(id: string): string {
    const lookup = this.model.positioning.lookups.find((l) => l.classes.some((c) => c.id === id));
    return `@${lookup?.classes.find((c) => c.id === id)?.name ?? id}`;
  }

  /** A slider that moves `target`, with each cell drawn over its unmoved ghost. */
  private sliderDemo(
    shell: HTMLElement,
    target: Target,
    cells: Cell[],
    label: string,
    start = 80,
  ): void {
    const slider = h("input", {
      type: "range",
      min: -80,
      max: 160,
      step: 10,
      value: start,
      class: "primer-slider",
      "aria-label": label,
    });
    const value = h("output", {}, "");
    const row = h("div", { class: "demo-row" });
    const draw = () => {
      const dy = Number(slider.value);
      value.textContent = `${dy} units`;
      const moved = moves(target, 0, dy);
      row.replaceChildren(
        ...cells.map((cell) => {
          const placed = this.model.placements("calib", cell, moved);
          const changes = placed.some((p) => p.dx || p.dy);
          return h(
            "div",
            { class: `demo-cell${changes ? " changes" : ""}` },
            figure(
              [this.drawCell(cell, 0, NO_MOVES, true), this.drawCell(cell, 0, moved)],
              ROW_SCALE,
              this.model.cellName(cell),
              ROW,
            ),
            h("span", { class: "small" }, this.model.cellName(cell)),
            h(
              "span",
              { class: `small ${changes ? "flag-changes" : "muted"}` },
              changes ? "moves" : "stays",
            ),
          );
        }),
      );
    };
    slider.addEventListener("input", draw);
    draw();
    shell.append(h("label", { class: "demo-control" }, `${label} `, slider, " ", value), row);
  }

  private runsDemo(shell: HTMLElement, texts: string[], names: boolean): void {
    shell.append(
      h(
        "div",
        { class: "demo-row" },
        ...texts.map((value) => {
          const drawn = this.drawRun(this.font, value, 0);
          const shaped = this.font.shape(codepoints(value));
          return h(
            "div",
            { class: "demo-cell" },
            figure([drawn], ROW_SCALE, value, ROW),
            h("span", { class: "arabic", lang: "ar" }, value),
            names
              ? h(
                  "ul",
                  { class: "small glyph-list" },
                  ...shaped
                    .toReversed()
                    .map((g) => this.font.name(g.gid))
                    .filter((n) => n !== "space")
                    .map((n) => h("li", {}, this.glyphNote(n))),
                )
              : null,
          );
        }),
      ),
    );
  }

  private dotsDemo(shell: HTMLElement, letters: string[]): void {
    const model = this.model;
    shell.append(
      h(
        "div",
        { class: "demo-row" },
        ...letters.flatMap((cp) => {
          const letter = model.letters.get(cp);
          if (!letter) return [];
          const cell: Cell = { letter, form: letter.forms[0] ?? "isolated", mark: NO_MARK };
          const form = model.letterForm(letter, cell.form);
          const body = form?.body ?? "";
          const inside = (model.glyphInfo(body)?.parts ?? []).filter((p) => p.kind === "dots");
          const drawn = this.drawCell(cell, 0);
          const piece = model.layout("calib", cell).pieces.find((p) => p.name === body);
          for (const part of inside)
            drawn.group.append(
              s("path", {
                d: part.d ?? "",
                transform: `translate(${piece?.x ?? 0} ${piece?.y ?? 0})`,
                class: "ink-dot",
              }),
            );
          const split = (form?.parts ?? []).filter((p) => p.kind === "dots" && p.id !== "body");
          return [
            h(
              "div",
              { class: "demo-cell" },
              figure([drawn], ROW_SCALE, letter.name, { top: 1000, bottom: -500 }),
              h("strong", {}, letter.name),
              h(
                "span",
                { class: "small" },
                split.length
                  ? `${body} with ${split.map((p) => p.glyph).join(", ")}, a glyph of its own`
                  : inside.length
                    ? `${body}, dots drawn inside it`
                    : body,
              ),
            ),
          ];
        }),
      ),
    );
  }

  /**
   * Horizontal lines from x0 to x1, each labelled above it: at the left end,
   * or at the right end for the approved box, so labels of lines that sit
   * close together do not overlap.
   */
  private metricLines(x0: number, x1: number, lines: [string, number, string][]): SVGElement[] {
    return lines.flatMap(([label, y, cls]) => {
      const right = cls === "approved";
      return [
        s("line", { x1: x0, x2: x1, y1: y, y2: y, class: `primer-line line-${cls}` }),
        s(
          "text",
          {
            x: right ? x1 : x0,
            y: -y - LABEL * 0.3,
            class: "primer-label",
            "font-size": LABEL,
            "text-anchor": right ? "end" : "start",
            transform: "scale(1 -1)",
          },
          `${label} ${em(y, this.model.upm)}`,
        ),
      ];
    });
  }

  /** The same words in the unscaled sources and in Sawa, one above the other at one scale. */
  private scaleDemo(shell: HTMLElement, latin: string, arabic: string): void {
    const model = this.model;
    const m = model.data.metrics;
    const gap = 2100;
    const rows: [HbFont, HbFont, string][] = [
      [model.fonts.notoSans, model.fonts.notoArabic, "Noto Sans Arabic as drawn, beside Noto Sans"],
      [model.fonts.calib, model.fonts.calib, `Sawa Sans: the Arabic at ${model.data.arabicScale}`],
    ];
    const parts: Drawn[] = [];
    const overlay: SVGElement[] = [];
    let width = 0;
    rows.forEach(([sans, arab, caption], i) => {
      const lift = (rows.length - 1 - i) * gap;
      const a = this.drawRun(sans, latin, 0);
      const b = this.drawRun(arab, arabic, a.advance + 250);
      const group = s("g", { transform: `translate(0 ${lift})` }, a.group, b.group);
      const box = unionBox(a.box, b.box);
      parts.push({
        group,
        box: box && { ...box, y0: box.y0 + lift, y1: box.y1 + lift },
      });
      width = Math.max(width, a.advance + 250 + b.advance);
      overlay.push(
        s(
          "g",
          { transform: `translate(0 ${lift})` },
          ...this.metricLines(-900, width + 80, [
            ["cap height", m.capHeight, "metric"],
            ["x-height", m.xHeight, "metric"],
            ["baseline", 0, "base"],
          ]),
          s(
            "text",
            {
              x: 0,
              y: 520,
              class: "primer-caption",
              "font-size": LABEL * 1.3,
              transform: "scale(1 -1)",
            },
            caption,
          ),
        ),
      );
    });
    shell.append(
      h(
        "div",
        { class: "demo-body" },
        figure(parts, ROW_SCALE, "The same words unscaled and in Sawa", {
          bottom: -650,
          left: -950,
          overlay,
        }),
      ),
    );
  }

  private envelopeDemo(shell: HTMLElement, texts: string[]): void {
    const model = this.model;
    const box = model.data.approvedLineBox;
    const state = model.state;
    model.state = { ...state, baked: false, impossible: false };
    const env = model.fontEnvelope("calib", false);
    model.state = state;
    let x = 200;
    const parts: Drawn[] = [];
    const notes: HTMLElement[] = [];
    for (const value of texts) {
      const arabic = /[؀-ۿ]/.test(value);
      const drawn = this.drawRun(arabic ? this.font : model.fonts.calib, value, x);
      parts.push(drawn);
      notes.push(
        h(
          "li",
          {},
          h("span", { class: arabic ? "arabic" : "", lang: arabic ? "ar" : "en" }, value),
          ` ink from ${em(drawn.box?.y0 ?? 0, model.upm)} to ${em(drawn.box?.y1 ?? 0, model.upm)} em`,
        ),
      );
      x += drawn.advance + 300;
    }
    const svg = figure(parts, ROW_SCALE, "The everyday envelope and the approved line box", {
      top: env.top,
      bottom: env.bottom,
      margin: 160,
      left: -1500,
      right: x + 40,
      overlay: this.metricLines(-1450, x, [
        ["everyday envelope top", env.top, "box"],
        ["approved box top", box.top, "approved"],
        ["baseline", 0, "base"],
        ["approved box bottom", box.bottom, "approved"],
        ["everyday envelope bottom", env.bottom, "box"],
      ]),
    });
    shell.append(
      h("div", { class: "demo-body" }, svg),
      h(
        "p",
        { class: "small" },
        `Everyday envelope ${em(env.top - env.bottom, model.upm)} em; approved line box ${box.height} em, holding ${(box.held * 100).toFixed(1)}% of ${box.coverage.words} corpus words.`,
      ),
      h("ul", { class: "small" }, ...notes),
    );
  }
}
