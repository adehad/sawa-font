export interface Extent {
  key: string;
  top: number;
  bottom: number;
}

export interface Envelope {
  top: number;
  bottom: number;
  tallest: Extent[];
  deepest: Extent[];
}

/**
 * The highest and lowest ink over `extents`, with the `count` cells that reach
 * furthest each way; ties keep the order of `extents`.
 */
export function envelope(extents: Extent[], count = 5): Envelope {
  const tallest = extents.toSorted((a, b) => b.top - a.top).slice(0, count);
  const deepest = extents.toSorted((a, b) => a.bottom - b.bottom).slice(0, count);
  return {
    top: tallest[0]?.top ?? 0,
    bottom: deepest[0]?.bottom ?? 0,
    tallest,
    deepest,
  };
}

export interface LineBox {
  top: number;
  bottom: number;
  height: number;
}

/** The line box that holds every given envelope's ink without clipping. */
export function lineBox(...envelopes: { top: number; bottom: number }[]): LineBox {
  const top = Math.max(...envelopes.map((e) => e.top));
  const bottom = Math.min(...envelopes.map((e) => e.bottom));
  return { top, bottom, height: top - bottom };
}

export function em(units: number, upm: number, digits = 2): string {
  return (units / upm).toFixed(digits);
}
