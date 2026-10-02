import type { Form } from "./types";

/**
 * Forms in the order they are drawn from left to right on screen, so that
 * they read right to left: final at the left, isolated at the right.
 */
export function leftToRight(forms: readonly Form[]): Form[] {
  return forms.toReversed();
}

/**
 * The (row, column) step an arrow key makes in a grid whose columns run in
 * logical order. In a right-to-left grid the first column is drawn at the
 * right, so ArrowLeft moves to the next column and ArrowRight to the
 * previous one: the arrows follow what you see.
 */
export function arrowStep(key: string, rtl: boolean): [number, number] | null {
  const across = rtl ? -1 : 1;
  const steps: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -across],
    ArrowRight: [0, across],
  };
  return steps[key] ?? null;
}

/** The form a glyph is drawn for, from its name's suffix, as `sawa lab fonts` reads it. */
export function formOf(glyph: string): Form {
  if (glyph.includes(".init")) return "initial";
  if (glyph.includes(".medi")) return "medial";
  if (glyph.includes(".fina")) return "final";
  return "isolated";
}
