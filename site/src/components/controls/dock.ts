import { SUMMARY_SEPARATOR, summaryParts } from "./summary";

const COMPACT = "(width < 1024px)";

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

function setOpen(dock: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
  dock.dataset.open = String(open);
  toggle.setAttribute("aria-expanded", String(open));
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
