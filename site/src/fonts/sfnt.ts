import type { GuideMetrics } from "./compare";
import type { WeightAxis } from "./specimen";

/** What the Compare page reads from a visitor's own font file. */
export interface SfntInfo {
  readonly metrics: GuideMetrics;
  readonly features: readonly string[];
  readonly axis: WeightAxis | null;
  readonly weightClass: number | null;
  readonly hasPalettes: boolean;
}

export type SfntResult =
  | { readonly kind: "ok"; readonly info: SfntInfo }
  | { readonly kind: "woff2" }
  | { readonly kind: "unreadable" };

const USE_TYPO_METRICS = 1 << 7;

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<DataView> {
  // WOFF 1.0 tables are zlib streams, which is what the "deflate" format means here.
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new DataView(await new Response(stream).arrayBuffer());
}

/** The tables this reader needs, from a bare sfnt or a WOFF 1.0 file. */
async function readTables(buffer: ArrayBuffer): Promise<Map<string, DataView> | "woff2" | null> {
  const view = new DataView(buffer);
  if (view.byteLength < 12) {
    return null;
  }
  const signature = tagAt(view, 0);
  const wanted = new Set(["head", "hhea", "OS/2", "GSUB", "GPOS", "fvar", "CPAL"]);
  const tables = new Map<string, DataView>();
  if (signature === "wOF2") {
    return "woff2";
  }
  if (signature === "wOFF") {
    const count = view.getUint16(12);
    const pending: Promise<[string, DataView]>[] = [];
    for (let index = 0; index < count; index += 1) {
      const record = 44 + index * 20;
      const tag = tagAt(view, record);
      if (!wanted.has(tag)) {
        continue;
      }
      const offset = view.getUint32(record + 4);
      const compLength = view.getUint32(record + 8);
      const origLength = view.getUint32(record + 12);
      const bytes = new Uint8Array(buffer, offset, compLength);
      pending.push(
        compLength < origLength
          ? inflate(bytes).then((inflated) => [tag, inflated])
          : Promise.resolve([tag, new DataView(buffer, offset, compLength)]),
      );
    }
    for (const [tag, table] of await Promise.all(pending)) {
      tables.set(tag, table);
    }
    return tables;
  }
  if (signature !== "\0\x01\0\0" && signature !== "OTTO" && signature !== "true") {
    return null;
  }
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = tagAt(view, record);
    if (wanted.has(tag)) {
      tables.set(
        tag,
        new DataView(buffer, view.getUint32(record + 8), view.getUint32(record + 12)),
      );
    }
  }
  return tables;
}

function featureTags(table: DataView | undefined): string[] {
  if (!table) {
    return [];
  }
  const list = table.getUint16(6);
  const count = table.getUint16(list);
  const tags: string[] = [];
  for (let index = 0; index < count; index += 1) {
    tags.push(tagAt(table, list + 2 + index * 6));
  }
  return tags;
}

function fixed(table: DataView, offset: number): number {
  return table.getInt32(offset) / 65536;
}

function wghtAxis(fvar: DataView | undefined): WeightAxis | null {
  if (!fvar) {
    return null;
  }
  const axesOffset = fvar.getUint16(4);
  const count = fvar.getUint16(8);
  const size = fvar.getUint16(10);
  for (let index = 0; index < count; index += 1) {
    const record = axesOffset + index * size;
    if (tagAt(fvar, record) === "wght") {
      return {
        min: fixed(fvar, record + 4),
        default: fixed(fvar, record + 8),
        max: fixed(fvar, record + 12),
      };
    }
  }
  return null;
}

/**
 * Reads head, hhea, OS/2, GSUB/GPOS feature tags, the fvar wght axis and
 * CPAL from a TTF, OTF or WOFF 1.0 file. WOFF2 needs Brotli and a glyf
 * transform reversal, which this reader doesn't do.
 */
export async function readSfnt(buffer: ArrayBuffer): Promise<SfntResult> {
  try {
    const tables = await readTables(buffer);
    if (tables === "woff2") {
      return { kind: "woff2" };
    }
    const head = tables?.get("head");
    const hhea = tables?.get("hhea");
    if (!tables || !head || !hhea) {
      return { kind: "unreadable" };
    }
    const os2 = tables.get("OS/2");
    const version = os2?.getUint16(0) ?? 0;
    const useTypo = os2 ? (os2.getUint16(62) & USE_TYPO_METRICS) !== 0 : false;
    const hheaMetrics = {
      ascender: hhea.getInt16(4),
      descender: hhea.getInt16(6),
      lineGap: hhea.getInt16(8),
    };
    const source =
      os2 && useTypo
        ? { ascender: os2.getInt16(68), descender: os2.getInt16(70), lineGap: os2.getInt16(72) }
        : hheaMetrics;
    const xHeight = os2 && version >= 2 ? os2.getInt16(86) : 0;
    const capHeight = os2 && version >= 2 ? os2.getInt16(88) : 0;
    const cpal = tables.get("CPAL");
    return {
      kind: "ok",
      info: {
        metrics: {
          unitsPerEm: head.getUint16(18),
          ...source,
          xHeight: xHeight || null,
          capHeight: capHeight || null,
        },
        features: [
          ...new Set([...featureTags(tables.get("GSUB")), ...featureTags(tables.get("GPOS"))]),
        ].toSorted(),
        axis: wghtAxis(tables.get("fvar")),
        weightClass: os2 ? os2.getUint16(4) : null,
        hasPalettes: cpal !== undefined && cpal.getUint16(4) > 0,
      },
    };
  } catch {
    return { kind: "unreadable" };
  }
}
