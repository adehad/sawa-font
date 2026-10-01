import {
  type Analysis,
  type Layout,
  type Offsets,
  analyse,
  cellCodepoints,
  layout,
  pieceBox,
} from "./cells";
import { type Envelope, type Extent, envelope } from "./envelope";
import { type Box, unionBox } from "./geometry";
import { HbFont } from "./hb";
import type { ViewState } from "./state";
import { type CellKey, type Note, type Override, keyId } from "./store";
import {
  type FontChoice,
  type Form,
  type LabData,
  type Letter,
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

/** The lab's data, fonts and the owner's notes and offsets, with shaping cached per cell. */
export class Model {
  readonly letters: Map<string, Letter>;
  readonly marks: Map<string, MarkSequence>;
  private readonly layouts = new Map<string, Layout>();
  private readonly analyses = new Map<string, Analysis>();

  constructor(
    readonly data: LabData,
    readonly fonts: Fonts,
    public state: ViewState,
    public notes: Note[],
    public overrides: Override[],
  ) {
    this.letters = new Map(data.matrix.letters.map((l) => [l.codepoint, l]));
    this.marks = new Map(
      [NO_MARK, ...data.matrix.everyday, ...data.matrix.niche].map((m) => [m.id, m]),
    );
  }

  get upm(): number {
    return this.data.metrics.unitsPerEm;
  }

  get clearanceUnits(): number {
    return this.data.clearance * this.upm;
  }

  arabicFont(choice: FontChoice): HbFont {
    return choice === "calib" ? this.fonts.calib : this.fonts.notoArabic;
  }

  latinFont(choice: FontChoice): HbFont {
    return choice === "calib" ? this.fonts.calib : this.fonts.notoSans;
  }

  fontKey(choice: FontChoice, script: "arabic" | "latin"): string {
    if (choice === "calib") return "calib";
    return script === "arabic" ? "notoArabic" : "notoSans";
  }

  selected(): Cell | null {
    const { letter, form, mark } = this.state;
    const l = letter ? this.letters.get(letter) : undefined;
    const m = this.marks.get(mark) ?? NO_MARK;
    if (!l || !form || !l.forms.includes(form)) return null;
    return { letter: l, form, mark: m };
  }

  layout(choice: FontChoice, cell: Cell): Layout {
    const id = `${choice}|${cellId(cell)}`;
    let result = this.layouts.get(id);
    if (!result) {
      const font = this.arabicFont(choice);
      const shaped = font.shape(cellCodepoints(cell.letter.char, cell.form, cell.mark.codepoints));
      const bare = font.shape(cellCodepoints(cell.letter.char, cell.form, []));
      result = layout(shaped, bare, (gid) => font.isBase(gid));
      this.layouts.set(id, result);
    }
    return result;
  }

  override(cell: Cell): Override | undefined {
    const id = keyId(cellKey(cell));
    return this.overrides.find((o) => keyId(o.key) === id);
  }

  /** The offsets drawn for a cell: its proposal, when shown and on the calibrated font. */
  offsets(choice: FontChoice, cell: Cell): Offsets {
    if (choice !== "calib" || !this.state.offsets) return {};
    const entry = this.override(cell);
    if (!entry) return {};
    return Object.fromEntries(entry.marks.map((m) => [m.index, [m.dx, m.dy] as const]));
  }

  analysis(choice: FontChoice, cell: Cell): Analysis {
    const offsets = this.offsets(choice, cell);
    const id = `${choice}|${cellId(cell)}|${JSON.stringify(offsets)}`;
    let result = this.analyses.get(id);
    if (!result) {
      const font = this.arabicFont(choice);
      result = analyse(
        this.layout(choice, cell),
        (gid) => font.outline(gid),
        offsets,
        this.clearanceUnits,
      );
      this.analyses.set(id, result);
    }
    return result;
  }

  /** The cell's ink box, cheaper than a full analysis. */
  box(choice: FontChoice, cell: Cell, withOffsets = true): Box | null {
    const font = this.arabicFont(choice);
    const offsets = withOffsets ? this.offsets(choice, cell) : {};
    let box: Box | null = null;
    for (const piece of this.layout(choice, cell).pieces) {
      box = unionBox(
        box,
        pieceBox(piece, (gid) => font.outline(gid), offsets),
      );
    }
    return box;
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

  /**
   * The owner's approved line box, centred on the calibrated font's plausible
   * everyday envelope as drawn by the font itself.
   */
  approvedLineBox(): { top: number; bottom: number; height: number } {
    const env = this.arabicEnvelope("calib", false, false);
    const height = this.data.approvedLineBox.height * this.upm;
    const extra = (height - (env.top - env.bottom)) / 2;
    return { top: env.top + extra, bottom: env.bottom - extra, height };
  }

  latinEnvelope(choice: FontChoice): LatinEnvelope {
    const font = this.latinFont(choice);
    const ink = (char: string) => {
      const [glyph] = font.shape([char.codePointAt(0) ?? 0]);
      const gid = glyph?.gid ?? 0;
      return unionBox(
        null,
        pieceBox({ gid, kind: "base", mark: -1, x: 0, y: 0 }, (g) => font.outline(g), {}),
      );
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
