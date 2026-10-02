import { type Edits, SCOPE_LABELS, targetId } from "./edits";
import { type CellKey, type Note, TAG_LABELS, keyId } from "./store";

export interface Names {
  letter(codepoint: string): string;
  marks(codepoints: string[]): string;
}

function cellName(key: CellKey, names: Names): string {
  const marks = key.marks.length ? ` + ${names.marks(key.marks)}` : "";
  return `${names.letter(key.letter)} ${key.form}${marks}`;
}

/** A short plain-text summary of the notes, edits and alternate requests, to paste into chat. */
export function summary(
  notes: Note[],
  edits: Edits,
  build: string,
  names: Names,
  rule: (edit: Edits["edits"][number]) => string = (edit) => targetId(edit.target),
): string {
  const lines = [`Sawa Lab feedback (${build})`];
  const open = notes.filter((n) => n.status !== "rejected");
  const count = edits.edits.length;
  const requests = edits.requests.length;
  lines.push(
    `${open.length} note${open.length === 1 ? "" : "s"}, ${count} proposed edit${count === 1 ? "" : "s"}` +
      (requests ? `, ${requests} request${requests === 1 ? "" : "s"} for a form of its own` : ""),
  );
  const byCell = new Map<string, Note[]>();
  for (const note of open.toSorted(
    (a, b) => b.severity - a.severity || a.created.localeCompare(b.created),
  )) {
    const id = keyId(note.key);
    byCell.set(id, [...(byCell.get(id) ?? []), note]);
  }
  for (const cellNotes of byCell.values()) {
    const first = cellNotes[0] as Note;
    lines.push(`- ${cellName(first.key, names)}:`);
    for (const note of cellNotes) {
      const text = note.text.trim() ? `: ${note.text.trim().replace(/\s+/g, " ")}` : "";
      const part = note.part ? `, on ${note.part.kind} ${note.part.id ?? note.part.glyph}` : "";
      lines.push(
        `  - [${note.status}] ${TAG_LABELS[note.tag]}, severity ${note.severity} (${note.font})${part}${text}`,
      );
    }
  }
  for (const edit of edits.edits.toSorted((a, b) =>
    targetId(a.target).localeCompare(targetId(b.target)),
  )) {
    const used = edit.usedBy.length ? ` (${edit.usedBy.join(", ")})` : "";
    lines.push(
      `- ${rule(edit)}${used}: dx ${edit.dx} dy ${edit.dy}, ${SCOPE_LABELS[edit.scope].toLowerCase()} (units at wght ${edit.wght})`,
    );
  }
  for (const entry of edits.requests) {
    const what = [entry.reason, entry.change].filter((t) => t.trim()).join("; ");
    lines.push(
      `- needs its own form: ${cellName(entry.key, names)} (${entry.glyphs.join(" ")})${what ? `: ${what}` : ""}`,
    );
  }
  return lines.join("\n");
}
