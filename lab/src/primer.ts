/**
 * The primer's content, content/primer/<lang>.md, read into sections. The
 * Markdown is the small subset the primer uses: a front matter block, one
 * title, "##" sections, paragraphs, "-" lists, inline code, fenced code
 * and fenced `demo` blocks, whose first line names a demo and its
 * key=value parameters for the lab to render.
 */

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "demo"; name: string; params: Record<string, string> };

export interface Section {
  heading: string;
  /** For links: the heading in lower case, with dashes for spaces. */
  id: string;
  blocks: Block[];
}

export interface Primer {
  title: string;
  lang: string;
  intro: Block[];
  sections: Section[];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function demo(source: string): Block {
  const [name = "", ...pairs] = source.trim().split(/\s+/);
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at > 0) params[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return { kind: "demo", name, params };
}

export function parsePrimer(source: string): Primer {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const meta: Record<string, string> = {};
  let i = 0;
  if (lines[0] === "---") {
    i = 1;
    for (; i < lines.length && lines[i] !== "---"; i++) {
      const [key, ...rest] = (lines[i] ?? "").split(":");
      if (key) meta[key.trim()] = rest.join(":").trim();
    }
    i++;
  }
  const primer: Primer = {
    title: meta.title ?? "",
    lang: meta.lang ?? "en",
    intro: [],
    sections: [],
  };
  let blocks = primer.intro;
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    if (list) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = null;
  };
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i] ?? ""); i++)
        body.push(lines[i] ?? "");
      const text = body.join("\n");
      blocks.push(fence[1] === "demo" ? demo(text) : { kind: "code", lang: fence[1] ?? "", text });
    } else if (line.startsWith("# ")) {
      flush();
      primer.title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      flush();
      const heading = line.slice(3).trim();
      const section: Section = { heading, id: slug(heading), blocks: [] };
      primer.sections.push(section);
      blocks = section.blocks;
    } else if (line.startsWith("- ")) {
      if (paragraph.length) flush();
      list ??= [];
      list.push(line.slice(2).trim());
    } else if (!line.trim()) {
      flush();
    } else if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return primer;
}

/** Text split into plain runs and `code` runs. */
export function inline(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 1
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part },
    );
}
