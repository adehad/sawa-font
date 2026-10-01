import * as hb from "harfbuzzjs";
import type { ShapedGlyph } from "./cells";
import { type Contour, flatten } from "./geometry";

export const harfbuzzVersion: string = hb.versionString();

/** One font loaded into HarfBuzz, with its glyph outlines cached. */
export class HbFont {
  readonly upem: number;
  private readonly face: hb.Face;
  private readonly font: hb.Font;
  private readonly outlines = new Map<number, Contour[]>();
  private readonly paths = new Map<number, string>();

  constructor(data: ArrayBuffer | Uint8Array) {
    this.face = new hb.Face(new hb.Blob(data));
    this.upem = this.face.upem;
    this.font = new hb.Font(this.face);
  }

  /** Shapes codepoints with clusters counted per character, as `sawa lab fonts` does. */
  shape(codepoints: number[]): ShapedGlyph[] {
    const buffer = new hb.Buffer();
    buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS);
    buffer.addCodePoints(codepoints);
    buffer.guessSegmentProperties();
    hb.shape(this.font, buffer);
    const positions = buffer.getGlyphPositions();
    return buffer.getGlyphInfos().map((info, i) => {
      const pos = positions[i];
      return {
        gid: info.codepoint,
        cluster: info.cluster,
        xAdvance: pos?.xAdvance ?? 0,
        xOffset: pos?.xOffset ?? 0,
        yOffset: pos?.yOffset ?? 0,
      };
    });
  }

  outline(gid: number): Contour[] {
    let contours = this.outlines.get(gid);
    if (contours === undefined) {
      contours = flatten(this.font.glyphToJson(gid));
      this.outlines.set(gid, contours);
    }
    return contours;
  }

  path(gid: number): string {
    let d = this.paths.get(gid);
    if (d === undefined) {
      d = this.font.glyphToPath(gid);
      this.paths.set(gid, d);
    }
    return d;
  }

  name(gid: number): string {
    return this.font.glyphName(gid) || `gid${gid}`;
  }

  /** Whether GDEF classes the glyph as a base or a ligature, not a mark. */
  isBase(gid: number): boolean {
    const cls = this.face.getGlyphClass(gid);
    return cls === hb.GlyphClass.BASE_GLYPH || cls === hb.GlyphClass.LIGATURE;
  }

  glyph(codepoint: number): number | undefined {
    return this.font.glyph(codepoint);
  }
}
