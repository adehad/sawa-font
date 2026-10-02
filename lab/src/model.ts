import {
  type Analysis,
  type GlyphFacts,
  type GlyphMoves,
  type Ink,
  type Layout,
  NO_MOVES,
  type Offset,
  type Offsets,
  type Placement,
  analyse,
  cellCodepoints,
  layout,
  layoutBox,
  lineLayout,
  placements,
} from "./cells";
import { type Envelope, type Extent, envelope } from "./envelope";
import { type Box, type Contour, bounds, flatten, parsePath, translate } from "./geometry";
import { HbFont } from "./hb";
import type { ViewState } from "./state";
import {
  type CellKey,
  type DotOffset,
  type Note,
  type Override,
  type Overrides,
  keyId,
} from "./store";
import {
  type FontChoice,
  type Form,
  type GlyphInfo,
  type LabData,
  type Letter,
  type LetterForm,
  type MarkSequence,
  NO_MARK,
} from "./types";

export interface Cell {
  letter: Letter;
  form: Form;
  mark: MarkSequence;
}

export interface Fonts {
  calib: HbFont;
  notoArabic: HbFont;
  notoSans: HbFont;
  /** calib-preview.ttf from `sawa lab preview`, when it has been written. */
  preview?: HbFont;
}

/** What `sawa lab preview` baked into calib-preview.ttf. */
export interface Baked {
  build: string;
  source: string;
  glyphs: { glyph: string; body: { dx: number; dy: number }; dots: DotOffset[] }[];
}

/** The glyph offsets of a set of overrides, comparable with what was baked. */
export function glyphOffsets(glyphs: Baked["glyphs"]): string {
  return JSON.stringify(
    glyphs
      .map((g) => ({
        glyph: g.glyph,
        body: [g.body.dx, g.body.dy],
        dots: g.dots.map((d) => `${d.part} ${d.dx} ${d.dy}`).toSorted((a, b) => a.localeCompare(b)),
      }))
      .toSorted((a, b) => a.glyph.localeCompare(b.glyph)),
  );
}

export interface LatinEnvelope {
  top: number;
  topGlyph: string;
  bottom: number;
  bottomGlyph: string;
}

const LATIN_TOP = ["É", "Å"];
const LATIN_BOTTOM = ["g", "y", "j", "p"];

export function cellKey(cell: Cell): CellKey {
  return { letter: cell.letter.codepoint, form: cell.form, marks: cell.mark.codepoints };
}

export function cellId(cell: Cell): string {
  return `${cell.letter.codepoint}|${cell.form}|${cell.mark.id}`;
}

export function formId(letter: Letter, form: Form): string {
  return `${letter.codepoint}|${form}`;
}

/** How a set of overrides moves glyph parts, looked up by glyph name. */
export function glyphMoves(overrides: Overrides): GlyphMoves {
  const byGlyph = new Map(overrides.glyphs.map((o) => [o.glyph, o]));
  return {
    body: (glyph) => {
      const entry = byGlyph.get(glyph);
      return entry ? [entry.body.dx, entry.body.dy] : [0, 0];
    },
    dot: (base, dot) => {
      const found = byGlyph.get(base)?.dots.find((d) => d.part === dot);
      return found ? [found.dx, found.dy] : undefined;
    },
    inline: (glyph) => {
      const out: Record<string, Offset> = {};
      for (const d of byGlyph.get(glyph)?.dots ?? [])
        if (d.part.includes(":")) out[d.part] = [d.dx, d.dy];
      return out;
    },
  };
}

/** The lab's data, fonts and the owner's notes and offsets, with shaping cached per cell. */
export class Model {
  readonly letters: Map<string, Letter>;
  readonly marks: Map<string, MarkSequence>;
  private readonly layouts = new Map<string, Layout>();
  private readonly analyses = new Map<string, Analysis>();
  private readonly partOutlines = new Map<string, Contour[]>();
  private readonly fontEnvelopes = new Map<string, Envelope & { cells: Map<string, Cell> }>();
  private moves: GlyphMoves = NO_MOVES;
  private overridesValue: Overrides = { glyphs: [], marks: [] };

  constructor(
    readonly data: LabData,
    readonly fonts: Fonts,
    public state: ViewState,
    public notes: Note[],
    overrides: Overrides,
    readonly baked: Baked | null = null,
  ) {
    this.letters = new Map(data.matrix.letters.map((l) => [l.codepoint, l]));
    this.marks = new Map(
      [NO_MARK, ...data.matrix.everyday, ...data.matrix.niche].map((m) => [m.id, m]),
    );
    this.overrides = overrides;
  }

  get overrides(): Overrides {
    return this.overridesValue;
  }

  /** Setting the overrides drops every cached analysis, since offsets feed them all. */
  set overrides(value: Overrides) {
    this.overridesValue = value;
    this.moves = glyphMoves(value);
    this.analyses.clear();
  }

  get upm(): number {
    return this.data.metrics.unitsPerEm;
  }

  get clearanceUnits(): number {
    return this.data.clearance * this.upm;
  }

  /** Whether the calibrated font is drawn from the baked preview. */
  showsBaked(choice: FontChoice): boolean {
    return choice === "calib" && this.state.baked && this.fonts.preview !== undefined;
  }

  arabicFont(choice: FontChoice): HbFont {
    if (this.showsBaked(choice) && this.fonts.preview) return this.fonts.preview;
    return choice === "calib" ? this.fonts.calib : this.fonts.notoArabic;
  }

  latinFont(choice: FontChoice): HbFont {
    return choice === "calib" ? this.fonts.calib : this.fonts.notoSans;
  }

  fontKey(choice: FontChoice, script: "arabic" | "latin"): string {
    if (choice === "calib")
      return script === "arabic" && this.showsBaked(choice) ? "preview" : "calib";
    return script === "arabic" ? "notoArabic" : "notoSans";
  }

  facts(choice: FontChoice): GlyphFacts {
    const font = this.arabicFont(choice);
    return {
      isBase: (gid) => font.isBase(gid),
      isMark: (gid) => font.isMark(gid),
      name: (gid) => font.name(gid),
    };
  }

  /** Whether offsets are drawn and editable: on the calibrated font, with offsets shown. */
  editing(choice: FontChoice): boolean {
    return choice === "calib" && this.state.offsets;
  }

  /** Glyph moves drawn as an overlay; the baked preview already has them in its outlines. */
  private glyphMovesFor(choice: FontChoice): GlyphMoves {
    return this.editing(choice) && !this.showsBaked(choice) ? this.moves : NO_MOVES;
  }

  /** Whether the baked preview holds the same glyph offsets as the lab. */
  bakedMatches(): boolean {
    return (
      this.baked !== null && glyphOffsets(this.baked.glyphs) === glyphOffsets(this.overrides.glyphs)
    );
  }

  selected(): Cell | null {
    const { letter, form, mark } = this.state;
    const l = letter ? this.letters.get(letter) : undefined;
    const m = this.marks.get(mark) ?? NO_MARK;
    if (!l || !form || !l.forms.includes(form)) return null;
    return { letter: l, form, mark: m };
  }

  letterForm(letter: Letter, form: Form): LetterForm | undefined {
    return this.data.letterForms[formId(letter, form)];
  }

  glyphInfo(name: string): GlyphInfo | undefined {
    return this.data.glyphs[name];
  }

  /** The letter forms whose body is `glyph`, as "beh initial". */
  usedBy(glyph: string): string[] {
    const out: string[] = [];
    for (const letter of this.data.matrix.letters)
      for (const form of letter.forms)
        if (this.letterForm(letter, form)?.body === glyph) out.push(`${letter.name} ${form}`);
    return out;
  }

  layout(choice: FontChoice, cell: Cell): Layout {
    const id = `${this.fontKey(choice, "arabic")}|${cellId(cell)}`;
    let result = this.layouts.get(id);
    if (!result) {
      const font = this.arabicFont(choice);
      const shaped = font.shape(cellCodepoints(cell.letter.char, cell.form, cell.mark.codepoints));
      const bare = font.shape(cellCodepoints(cell.letter.char, cell.form, []));
      result = layout(shaped, bare, this.facts(choice));
      this.layouts.set(id, result);
    }
    return result;
  }

  lineLayout(choice: FontChoice, text: string): Layout {
    const id = `${this.fontKey(choice, "arabic")}|line|${text}`;
    let result = this.layouts.get(id);
    if (!result) {
      const font = this.arabicFont(choice);
      const codepoints: number[] = [];
      for (const char of text) codepoints.push(char.codePointAt(0) ?? 0);
      result = lineLayout(font.shape(codepoints), this.facts(choice));
      this.layouts.set(id, result);
    }
    return result;
  }

  override(cell: Cell): Override | undefined {
    const id = keyId(cellKey(cell));
    return this.overrides.marks.find((o) => keyId(o.key) === id);
  }

  /** The cell's per-cell mark offsets, when shown and on the calibrated font. */
  markOffsets(choice: FontChoice, cell: Cell): Offsets {
    if (!this.editing(choice)) return {};
    const entry = this.override(cell);
    if (!entry) return {};
    return Object.fromEntries(entry.marks.map((m) => [m.index, [m.dx, m.dy] as const]));
  }

  placements(choice: FontChoice, cell: Cell): Placement[] {
    return placements(
      this.layout(choice, cell),
      this.glyphMovesFor(choice),
      this.markOffsets(choice, cell),
    );
  }

  linePlacements(choice: FontChoice, line: Layout): Placement[] {
    return placements(line, this.glyphMovesFor(choice));
  }

  /** One part's outline from the glyph table, placed at (x, y). */
  partInk(glyph: string, part: string, x: number, y: number): Contour[] {
    return translate(this.partOutline(glyph, part), x, y);
  }

  /** A part's outline from the glyph table, unplaced. */
  private partOutline(glyph: string, part: string): Contour[] {
    const id = `${glyph}|${part}`;
    let contours = this.partOutlines.get(id);
    if (!contours) {
      const d = this.glyphInfo(glyph)?.parts.find((p) => p.id === part)?.d ?? "";
      contours = flatten(parsePath(d));
      this.partOutlines.set(id, contours);
    }
    return contours;
  }

  /** Placed outlines, splitting a glyph into its parts when a part inside it moves. */
  ink(choice: FontChoice): Ink {
    const font = this.arabicFont(choice);
    return (piece, placement) => {
      const x = piece.x + placement.dx;
      const y = piece.y + placement.dy;
      const moved = Object.entries(placement.parts).filter(([, [dx, dy]]) => dx !== 0 || dy !== 0);
      const info = moved.length ? this.glyphInfo(piece.name) : undefined;
      if (!info) return translate(font.outline(piece.gid), x, y);
      return info.parts.flatMap((part) => {
        const [px, py] = placement.parts[part.id] ?? [0, 0];
        return translate(this.partOutline(piece.name, part.id), x + px, y + py);
      });
    };
  }

  analysis(choice: FontChoice, cell: Cell): Analysis {
    const id = `${this.fontKey(choice, "arabic")}|${cellId(cell)}|${this.state.offsets}`;
    let result = this.analyses.get(id);
    if (!result) {
      result = analyse(
        this.layout(choice, cell),
        this.ink(choice),
        this.placements(choice, cell),
        this.clearanceUnits,
      );
      this.analyses.set(id, result);
    }
    return result;
  }

  /** The cell's ink box, cheaper than a full analysis. */
  box(choice: FontChoice, cell: Cell, withOffsets = true): Box | null {
    const cellLayout = this.layout(choice, cell);
    const placed = withOffsets
      ? this.placements(choice, cell)
      : placements(cellLayout, NO_MOVES, {});
    return layoutBox(cellLayout, this.ink(choice), placed);
  }

  /** Whether ordinary spelling puts the mark sequence on the letter (`sawa lab fonts` decides). */
  plausible(letter: Letter, mark: MarkSequence): boolean {
    return !letter.implausible.includes(mark.id);
  }

  /** Whether the matrix and envelope show the cell: plausible, or impossible ones are asked for. */
  shown(letter: Letter, mark: MarkSequence): boolean {
    return this.state.impossible || this.plausible(letter, mark);
  }

  everydayCells(includeImpossible = this.state.impossible): Cell[] {
    return this.data.matrix.letters.flatMap((letter) =>
      letter.forms.flatMap((form) =>
        this.data.matrix.everyday
          .filter((mark) => includeImpossible || this.plausible(letter, mark))
          .map((mark) => ({ letter, form, mark })),
      ),
    );
  }

  arabicEnvelope(
    choice: FontChoice,
    includeImpossible = this.state.impossible,
    withOffsets = true,
  ): Envelope & { cells: Map<string, Cell> } {
    const cells = new Map<string, Cell>();
    const extents: Extent[] = [];
    for (const cell of this.everydayCells(includeImpossible)) {
      const box = this.box(choice, cell, withOffsets);
      if (!box) continue;
      const id = cellId(cell);
      cells.set(id, cell);
      extents.push({ key: id, top: box.y1, bottom: box.y0 });
    }
    return { ...envelope(extents), cells };
  }

  /** The everyday envelope as the font draws it, without any edits; it never changes. */
  fontEnvelope(
    choice: FontChoice,
    includeImpossible = this.state.impossible,
  ): Envelope & { cells: Map<string, Cell> } {
    const id = `${this.fontKey(choice, "arabic")}|${includeImpossible}`;
    let result = this.fontEnvelopes.get(id);
    if (!result) {
      result = this.arabicEnvelope(choice, includeImpossible, false);
      this.fontEnvelopes.set(id, result);
    }
    return result;
  }

  /**
   * The owner's approved line box, centred on the calibrated font's plausible
   * everyday envelope as drawn by the font itself.
   */
  approvedLineBox(): { top: number; bottom: number; height: number } {
    const state = this.state;
    this.state = { ...state, baked: false };
    const env = this.fontEnvelope("calib", false);
    this.state = state;
    const height = this.data.approvedLineBox.height * this.upm;
    const extra = (height - (env.top - env.bottom)) / 2;
    return { top: env.top + extra, bottom: env.bottom - extra, height };
  }

  latinEnvelope(choice: FontChoice): LatinEnvelope {
    const font = this.latinFont(choice);
    const ink = (char: string) => {
      const [glyph] = font.shape([char.codePointAt(0) ?? 0]);
      return bounds(font.outline(glyph?.gid ?? 0));
    };
    const tops = LATIN_TOP.map((c) => ({ c, y: ink(c)?.y1 ?? 0 })).toSorted((a, b) => b.y - a.y);
    const bottoms = LATIN_BOTTOM.map((c) => ({ c, y: ink(c)?.y0 ?? 0 })).toSorted(
      (a, b) => a.y - b.y,
    );
    return {
      top: tops[0]?.y ?? 0,
      topGlyph: tops[0]?.c ?? "",
      bottom: bottoms[0]?.y ?? 0,
      bottomGlyph: bottoms[0]?.c ?? "",
    };
  }

  cellName(cell: Cell): string {
    const mark = cell.mark.id === NO_MARK.id ? "" : ` + ${cell.mark.label}`;
    return `${cell.letter.name} ${cell.form}${mark}`;
  }

  markLabel(codepoints: string[]): string {
    const joined = codepoints.join(" ");
    for (const mark of this.marks.values())
      if (mark.codepoints.join(" ") === joined) return mark.label;
    return codepoints.join(" + ");
  }

  cellFromKey(key: CellKey): Cell | null {
    const letter = this.letters.get(key.letter);
    if (!letter) return null;
    const joined = key.marks.join(" ");
    const mark = [...this.marks.values()].find((m) => m.codepoints.join(" ") === joined);
    return mark ? { letter, form: key.form, mark } : null;
  }

  invalidate(): void {
    this.analyses.clear();
  }
}
