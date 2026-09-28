import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./html-entities";

describe("decodeHtmlEntities", () => {
  it("decodes the entities Astro emits in attributes", () => {
    expect(decodeHtmlEntities("&quot;Sawa&quot;, serif")).toBe('"Sawa", serif');
    expect(decodeHtmlEntities("&#34;Sawa&#34;")).toBe('"Sawa"');
    expect(decodeHtmlEntities("&#39;Sawa&#39;")).toBe("'Sawa'");
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeHtmlEntities("&lt;div&gt;")).toBe("<div>");
    expect(decodeHtmlEntities("&#x41;")).toBe("A");
  });
});
