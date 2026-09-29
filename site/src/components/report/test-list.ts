import { commitReport, readReportState, subscribeReport } from "../../state/store";
import { toReportSearch, type ReportState } from "../../state/url";

/** The test a state shows: its own if the bundle has it, else the bundle's first. */
export function selectedTest(state: ReportState, ids: readonly string[]): string | undefined {
  return state.test !== undefined && ids.includes(state.test) ? state.test : ids[0];
}

/** Scrolls the list, not the page, so a test picked from the URL is in view. */
function revealInList(link: HTMLElement | undefined): void {
  const list = link?.closest("ol");
  const scroller = [list, list?.parentElement].find(
    (element) => element && element.scrollHeight > element.clientHeight,
  );
  if (!link || !scroller) return;
  const offset = link.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += offset - (scroller.clientHeight - link.offsetHeight) / 2;
}

/** Shows the selected test's card and keeps the list's links in step with the URL. */
export function mountTestList(root: HTMLElement): void {
  const links = [...root.querySelectorAll<HTMLAnchorElement>("[data-test-link]")];
  const cards = [...root.querySelectorAll<HTMLElement>("[data-test-card]")];
  const ids = links.map((link) => link.dataset.testLink ?? "");
  const canonical = (id: string | undefined) => (id === ids[0] ? undefined : id);

  for (const link of links) {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      commitReport({ ...readReportState(), test: canonical(link.dataset.testLink) });
    });
  }

  let revealed = false;
  subscribeReport((state) => {
    const id = selectedTest(state, ids);
    if (state.test !== canonical(id)) {
      commitReport({ ...state, test: canonical(id) });
      return;
    }
    for (const link of links) {
      const search = toReportSearch({ ...state, test: canonical(link.dataset.testLink) });
      link.href = `${location.pathname}${search}`;
      if (link.dataset.testLink === id) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
    for (const card of cards) {
      card.hidden = card.dataset.testCard !== id;
    }
    if (!revealed) {
      revealed = true;
      revealInList(links.find((link) => link.dataset.testLink === id));
    }
  });
}
