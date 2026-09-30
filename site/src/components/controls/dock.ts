import { SUMMARY_SEPARATOR, summaryParts } from "./summary";

const COMPACT = "(720px <= width < 1024px)";
const MOBILE = "(width < 720px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const EDGE = 12;
const FOCUSABLE = "input, button, select, textarea, [tabindex]";

/**
 * Writes the one-line settings summary everywhere the dock shows it. Each
 * part is bidi-isolated, or a Latin family name and the digits around it
 * reorder inside an Arabic line.
 */
export function setDockSummary(parts: readonly (string | undefined)[]): void {
  const shown = summaryParts(parts);
  document.querySelectorAll<HTMLElement>("[data-dock-summary]").forEach((element) => {
    element.replaceChildren(
      ...shown.flatMap((part, index) => {
        const isolated = document.createElement("bdi");
        isolated.textContent = part;
        return index === 0 ? [isolated] : [SUMMARY_SEPARATOR, isolated];
      }),
    );
  });
}

interface DockParts {
  dock: HTMLElement;
  toggle: HTMLButtonElement;
  panel: HTMLElement;
  home: HTMLElement;
  fab: HTMLButtonElement;
  sheet: HTMLDialogElement;
  slot: HTMLElement;
}

function dockParts(): DockParts | null {
  const dock = document.querySelector<HTMLElement>("[data-dock]");
  const toggle = dock?.querySelector<HTMLButtonElement>("[data-dock-toggle]");
  const panel = document.querySelector<HTMLElement>("[data-dock-panel]");
  const home = document.querySelector<HTMLElement>("[data-dock-home]");
  const fab = document.querySelector<HTMLButtonElement>("[data-dock-fab]");
  const sheet = document.querySelector<HTMLDialogElement>("[data-dock-sheet]");
  const slot = sheet?.querySelector<HTMLElement>("[data-dock-sheet-slot]");
  return dock && toggle && panel && home && fab && sheet && slot
    ? { dock, toggle, panel, home, fab, sheet, slot }
    : null;
}

let sheetOpener: HTMLElement | null = null;

/**
 * Shows the one panel inside the sheet. The panel is moved rather than
 * copied so every control keeps its listeners and there is one set of controls.
 */
function openSheet(parts: DockParts, opener: HTMLElement): void {
  sheetOpener = opener;
  parts.slot.append(parts.panel);
  parts.sheet.showModal();
}

function setOpen(dock: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
  dock.dataset.open = String(open);
  toggle.setAttribute("aria-expanded", String(open));
}

function behavior(): ScrollBehavior {
  return matchMedia(REDUCED_MOTION).matches ? "auto" : "smooth";
}

/** Scrolls the panel, and only the panel, just far enough to show `target`. */
function scrollIntoPanel(panel: HTMLElement, target: HTMLElement): void {
  const box = panel.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  let delta = 0;
  if (rect.top < box.top + EDGE) {
    delta = rect.top - box.top - EDGE;
  } else if (rect.bottom > box.bottom - EDGE) {
    delta = Math.min(rect.top - box.top - EDGE, rect.bottom - box.bottom + EDGE);
  }
  if (delta !== 0) {
    panel.scrollBy({ top: delta, behavior: behavior() });
  }
}

function groupsFor(panel: HTMLElement, ids: readonly string[]): HTMLElement[] {
  return ids
    .map((id) => panel.querySelector<HTMLElement>(`[data-control-group="${id}"]`))
    .filter((group): group is HTMLElement => group !== null && !group.hidden);
}

/**
 * Marks the groups for `ids` as the current ones and brings the first into
 * view, unless the visitor is already working in the panel.
 */
export function highlightControls(ids: readonly string[]): void {
  const parts = dockParts();
  if (!parts) {
    return;
  }
  const { panel } = parts;
  const current = new Set(groupsFor(panel, ids));
  panel.querySelectorAll<HTMLElement>("[data-control-group]").forEach((group) => {
    if (current.has(group)) {
      group.setAttribute("aria-current", "true");
    } else {
      group.removeAttribute("aria-current");
    }
  });
  const [first] = current;
  if (first && !panel.matches(":hover, :focus-within")) {
    scrollIntoPanel(panel, first);
  }
}

/**
 * Shows the control group `id`, opening the compact bar or the sheet if it
 * has to, and focuses its current choice. Closing the sheet returns focus to `opener`.
 */
export function revealControl(id: string, opener: HTMLElement): void {
  const parts = dockParts();
  if (!parts) {
    return;
  }
  const { dock, toggle, panel } = parts;
  const [group] = groupsFor(panel, [id]);
  if (!group) {
    return;
  }
  if (matchMedia(MOBILE).matches) {
    openSheet(parts, opener);
  } else if (matchMedia(COMPACT).matches) {
    setOpen(dock, toggle, true);
  }
  scrollIntoPanel(panel, group);
  const controls = [...group.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    element.checkVisibility(),
  );
  const control =
    controls.find((element) => element.getAttribute("aria-pressed") === "true") ?? controls[0];
  control?.focus({ preventScroll: true });
}

/** Wires the compact top bar's expand and collapse and the small-screen sheet. */
export function initDock(): void {
  const parts = dockParts();
  if (!parts) {
    return;
  }
  const { dock, toggle, panel, home, fab, sheet } = parts;
  toggle.addEventListener("click", () => setOpen(dock, toggle, dock.dataset.open !== "true"));
  dock.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dock.dataset.open === "true" && matchMedia(COMPACT).matches) {
      setOpen(dock, toggle, false);
      toggle.focus();
    }
  });

  fab.addEventListener("click", () => openSheet(parts, fab));
  sheet.querySelector("[data-dock-close]")?.addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) {
      sheet.close();
    }
  });
  sheet.addEventListener("close", () => {
    home.append(panel);
    const opener = sheetOpener?.checkVisibility() ? sheetOpener : fab;
    sheetOpener = null;
    opener.focus();
  });
  matchMedia(MOBILE).addEventListener("change", (event) => {
    if (!event.matches && sheet.open) {
      sheet.close();
    }
  });
}
