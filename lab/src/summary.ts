import { type CellKey, type Note, type Override, TAG_LABELS, keyId } from "./store";

export interface Names {
  letter(codepoint: string): string;
  marks(codepoints: string[]): string;
}

function cellName(key: CellKey, names: Names): string {
  const marks = key.marks.length ? ` + ${names.marks(key.marks)}` : "";
  return `${names.letter(key.letter)} ${key.form}${marks}`;
}

/** A short plain-text summary of the notes and proposed offsets, to paste into chat. */
export function summary(notes: Note[], overrides: Override[], build: string, names: Names): string {
  const lines = [`Sawa Lab feedback (${build})`];
  const open = notes.filter((n) => n.status !== "rejected");
  lines.push(
    `${open.length} note${open.length === 1 ? "" : "s"}, ${overrides.length} proposed offset${overrides.length === 1 ? "" : "s"}`,
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
      lines.push(
        `  - [${note.status}] ${TAG_LABELS[note.tag]}, severity ${note.severity} (${note.font})${text}`,
      );
    }
  }
  for (const entry of overrides) {
    const moves = entry.marks
      .filter((m) => m.dx !== 0 || m.dy !== 0)
      .map((m) => `${m.glyph} dx ${m.dx} dy ${m.dy}`)
      .join("; ");
    if (moves)
      lines.push(`- offset ${cellName(entry.key, names)}: ${moves} (units at wght ${entry.wght})`);
  }
  return lines.join("\n");
}
