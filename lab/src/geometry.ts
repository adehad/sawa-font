export type Point = [number, number];
export type Contour = Point[];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PathCommand {
  type: string;
  values: number[];
}

const CURVE_STEPS = 8;

/** Flattens HarfBuzz draw commands into closed polylines in font units. */
export function flatten(commands: PathCommand[], steps = CURVE_STEPS): Contour[] {
  const contours: Contour[] = [];
  let current: Contour = [];
  let pen: Point = [0, 0];
  const finish = () => {
    if (current.length > 1) contours.push(current);
    current = [];
  };
  for (const { type, values: v } of commands) {
    if (type === "M") {
      finish();
      pen = [v[0] ?? 0, v[1] ?? 0];
      current.push(pen);
    } else if (type === "L") {
      pen = [v[0] ?? 0, v[1] ?? 0];
      current.push(pen);
    } else if (type === "Q") {
      const [cx, cy, x, y] = v as [number, number, number, number];
      const [px, py] = pen;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        current.push([
          u * u * px + 2 * u * t * cx + t * t * x,
          u * u * py + 2 * u * t * cy + t * t * y,
        ]);
      }
      pen = [x, y];
    } else if (type === "C") {
      const [c1x, c1y, c2x, c2y, x, y] = v as [number, number, number, number, number, number];
      const [px, py] = pen;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        current.push([
          u * u * u * px + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * py + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        ]);
      }
      pen = [x, y];
    } else if (type === "Z") {
      finish();
    }
  }
  finish();
  return contours;
}

/** Parses an SVG path of absolute M, L, Q, C and Z commands. */
export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  for (const match of d.matchAll(/([MLQCZ])([^MLQCZ]*)/gi)) {
    const values = (match[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    commands.push({ type: (match[1] ?? "").toUpperCase(), values });
  }
  return commands;
}

export function bounds(contours: Contour[]): Box | null {
  let box: Box | null = null;
  for (const contour of contours) {
    for (const [x, y] of contour) {
      if (box === null) box = { x0: x, y0: y, x1: x, y1: y };
      else {
        box.x0 = Math.min(box.x0, x);
        box.y0 = Math.min(box.y0, y);
        box.x1 = Math.max(box.x1, x);
        box.y1 = Math.max(box.y1, y);
      }
    }
  }
  return box;
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function translate(contours: Contour[], dx: number, dy: number): Contour[] {
  if (dx === 0 && dy === 0) return contours;
  return contours.map((contour) => contour.map(([x, y]): Point => [x + dx, y + dy]));
}

/** Clear distance between two boxes along both axes, 0 when they touch. */
function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  return Math.hypot(dx, dy);
}

interface Segment {
  a: Point;
  b: Point;
  box: Box;
}

function segments(contours: Contour[]): Segment[] {
  const out: Segment[] = [];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i] as Point;
      const b = contour[(i + 1) % contour.length] as Point;
      out.push({
        a,
        b,
        box: {
          x0: Math.min(a[0], b[0]),
          y0: Math.min(a[1], b[1]),
          x1: Math.max(a[0], b[0]),
          y1: Math.max(a[1], b[1]),
        },
      });
    }
  }
  return out;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function intersects(p: Segment, q: Segment): boolean {
  const d1 = cross(q.a, q.b, p.a);
  const d2 = cross(q.a, q.b, p.b);
  const d3 = cross(p.a, p.b, q.a);
  const d4 = cross(p.a, p.b, q.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointSegment(p: Point, s: Segment): number {
  const [ax, ay] = s.a;
  const dx = s.b[0] - ax;
  const dy = s.b[1] - ay;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / length));
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
}

function segmentGap(p: Segment, q: Segment): number {
  if (intersects(p, q)) return 0;
  return Math.min(
    pointSegment(p.a, q),
    pointSegment(p.b, q),
    pointSegment(q.a, p),
    pointSegment(q.b, p),
  );
}

/** Nonzero winding, the fill rule TrueType outlines use. */
export function inside(point: Point, contours: Contour[]): boolean {
  let winding = 0;
  const py = point[1];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i] as Point;
      const b = contour[(i + 1) % contour.length] as Point;
      if (a[1] <= py) {
        if (b[1] > py && cross(a, b, point) > 0) winding++;
      } else if (b[1] <= py && cross(a, b, point) < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

/**
 * The clear distance between two filled shapes in font units: 0 when their
 * ink overlaps, Infinity when it is further apart than `limit`.
 */
export function inkGap(a: Contour[], b: Contour[], limit: number): number {
  const boxA = bounds(a);
  const boxB = bounds(b);
  if (boxA === null || boxB === null || boxGap(boxA, boxB) > limit) return Infinity;
  const segA = segments(a).filter((s) => boxGap(s.box, boxB) <= limit);
  const segB = segments(b).filter((s) => boxGap(s.box, boxA) <= limit);
  let best = Infinity;
  for (const p of segA) {
    for (const q of segB) {
      if (boxGap(p.box, q.box) >= best || boxGap(p.box, q.box) > limit) continue;
      best = Math.min(best, segmentGap(p, q));
      if (best === 0) return 0;
    }
  }
  const starts = (shape: Contour[]) => shape.flatMap((contour) => contour.slice(0, 1));
  if (starts(a).some((p) => inside(p, b)) || starts(b).some((p) => inside(p, a))) return 0;
  return best <= limit ? best : Infinity;
}
