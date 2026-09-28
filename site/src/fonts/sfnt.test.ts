import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readSfnt } from "./sfnt";

function table(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) {
    view.setUint8(offset + index, tag.charCodeAt(index));
  }
}

const head = table(54, (view) => view.setUint16(18, 2048));
const hhea = table(36, (view) => {
  view.setInt16(4, 1900);
  view.setInt16(6, -480);
  view.setInt16(8, 10);
});

function os2(useTypo: boolean): Uint8Array {
  return table(96, (view) => {
    view.setUint16(0, 4);
    view.setUint16(4, 350);
    view.setUint16(62, useTypo ? 1 << 7 : 0);
    view.setInt16(68, 1500);
    view.setInt16(70, -500);
    view.setInt16(72, 0);
    view.setInt16(86, 1060);
    view.setInt16(88, 1420);
  });
}

function layout(tags: string[]): Uint8Array {
  return table(10 + 2 + tags.length * 6, (view) => {
    view.setUint16(6, 10);
    view.setUint16(10, tags.length);
    tags.forEach((tag, index) => writeTag(view, 12 + index * 6, tag));
  });
}

const fvar = table(16 + 40, (view) => {
  view.setUint16(4, 16);
  view.setUint16(8, 2);
  view.setUint16(10, 20);
  writeTag(view, 16, "wdth");
  writeTag(view, 36, "wght");
  view.setInt32(40, 200 * 65536);
  view.setInt32(44, 400 * 65536);
  view.setInt32(48, 700 * 65536);
});

function sfnt(tables: Record<string, Uint8Array>): ArrayBuffer {
  const entries = Object.entries(tables);
  let offset = 12 + entries.length * 16;
  const size = entries.reduce((total, [, bytes]) => total + bytes.length, offset);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, entries.length);
  entries.forEach(([tag, bytes], index) => {
    const record = 12 + index * 16;
    writeTag(view, record, tag);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, bytes.length);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out.buffer;
}

function woff(tables: Record<string, Uint8Array>): ArrayBuffer {
  const entries = Object.entries(tables).map(([tag, bytes]) => {
    const compressed = new Uint8Array(deflateSync(bytes));
    return { tag, bytes, stored: compressed.length < bytes.length ? compressed : bytes };
  });
  let offset = 44 + entries.length * 20;
  const size = entries.reduce((total, entry) => total + entry.stored.length, offset);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  writeTag(view, 0, "wOFF");
  view.setUint16(12, entries.length);
  entries.forEach((entry, index) => {
    const record = 44 + index * 20;
    writeTag(view, record, entry.tag);
    view.setUint32(record + 4, offset);
    view.setUint32(record + 8, entry.stored.length);
    view.setUint32(record + 12, entry.bytes.length);
    out.set(entry.stored, offset);
    offset += entry.stored.length;
  });
  return out.buffer;
}

describe("readSfnt", () => {
  it("reads hhea metrics when USE_TYPO_METRICS is off", async () => {
    const result = await readSfnt(sfnt({ head, hhea, "OS/2": os2(false) }));
    expect(result).toEqual({
      kind: "ok",
      info: {
        metrics: {
          unitsPerEm: 2048,
          ascender: 1900,
          descender: -480,
          lineGap: 10,
          xHeight: 1060,
          capHeight: 1420,
        },
        features: [],
        axis: null,
        weightClass: 350,
        hasPalettes: false,
      },
    });
  });

  it("reads typo metrics when USE_TYPO_METRICS is on", async () => {
    const result = await readSfnt(sfnt({ head, hhea, "OS/2": os2(true) }));
    expect(result.kind === "ok" && result.info.metrics.ascender).toBe(1500);
  });

  it("unions GSUB and GPOS feature tags and finds the wght axis", async () => {
    const result = await readSfnt(
      sfnt({ head, hhea, GSUB: layout(["liga", "ss01"]), GPOS: layout(["kern", "liga"]), fvar }),
    );
    expect(result.kind === "ok" && result.info.features).toEqual(["kern", "liga", "ss01"]);
    expect(result.kind === "ok" && result.info.axis).toEqual({ min: 200, default: 400, max: 700 });
  });

  it("inflates compressed WOFF 1.0 tables", async () => {
    const result = await readSfnt(woff({ head, hhea, "OS/2": os2(false), GSUB: layout(["ss01"]) }));
    expect(result.kind === "ok" && result.info.metrics.unitsPerEm).toBe(2048);
    expect(result.kind === "ok" && result.info.features).toEqual(["ss01"]);
  });

  it("recognises WOFF2 without reading it", async () => {
    const bytes = new Uint8Array(48);
    writeTag(new DataView(bytes.buffer), 0, "wOF2");
    expect(await readSfnt(bytes.buffer)).toEqual({ kind: "woff2" });
  });

  it("reports anything else as unreadable", async () => {
    expect(await readSfnt(new TextEncoder().encode("not a font at all").buffer)).toEqual({
      kind: "unreadable",
    });
    expect(await readSfnt(sfnt({ head }))).toEqual({ kind: "unreadable" });
  });
});
