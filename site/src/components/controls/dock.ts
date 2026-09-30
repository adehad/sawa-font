import { SUMMARY_SEPARATOR, summaryParts } from "./summary";

const COMPACT = "(width < 1024px)";
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

function dockParts(): { dock: HTMLElement; toggle: HTMLButtonElement; panel: HTMLElement } | null {
  const dock = document.querySelector<HTMLElement>("[data-dock]");
  const toggle = dock?.querySelector<HTMLButtonElement>("[data-dock-toggle]");
  const panel = document.querySelector<HTMLElement>("[data-dock-panel]");
  return dock && toggle && panel ? { dock, toggle, panel } : null;
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

/** Shows the control group `id`, opening the compact bar if it has to, and focuses its first control. */
export function revealControl(id: string): void {
  const parts = dockParts();
  if (!parts) {
    return;
  }
  const { dock, toggle, panel } = parts;
  const [group] = groupsFor(panel, [id]);
  if (!group) {
    return;
  }
  if (matchMedia(COMPACT).matches) {
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

/** Wires the compact top bar's expand and collapse. */
export function initDock(dock: HTMLElement): void {
  const toggle = dock.querySelector<HTMLButtonElement>("[data-dock-toggle]");
  if (!toggle) {
    return;
  }
  toggle.addEventListener("click", () => setOpen(dock, toggle, dock.dataset.open !== "true"));
  dock.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dock.dataset.open === "true" && matchMedia(COMPACT).matches) {
      setOpen(dock, toggle, false);
      toggle.focus();
    }
  });
}
