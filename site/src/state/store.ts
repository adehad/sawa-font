import { replaceSearch, replaceState } from "./history";
import {
  parseReportState,
  parseState,
  toReportSearch,
  type PlaygroundState,
  type ReportState,
} from "./url";

const STATE_EVENT = "sawa:state";
const REPORT_EVENT = "sawa:report-state";

/** The playground state the current URL describes. */
export function readState(): PlaygroundState {
  return parseState(location.search);
}

/**
 * Writes `next` into the URL and tells every listener on the page. Listeners
 * re-read the URL rather than trusting `next`, so they all see the same
 * canonical state.
 */
export function commit(next: PlaygroundState): void {
  replaceState(next);
  window.dispatchEvent(new Event(STATE_EVENT));
}

/** Calls `listener` with the current state now and after every commit. */
export function subscribe(listener: (state: PlaygroundState) => void): void {
  window.addEventListener(STATE_EVENT, () => listener(readState()));
  listener(readState());
}

/** The report page's state the current URL describes. */
export function readReportState(): ReportState {
  return parseReportState(location.search);
}

/** `commit` for the report page's state. */
export function commitReport(next: ReportState): void {
  replaceSearch(toReportSearch(next));
  window.dispatchEvent(new Event(REPORT_EVENT));
}

/** `subscribe` for the report page's state. */
export function subscribeReport(listener: (state: ReportState) => void): void {
  window.addEventListener(REPORT_EVENT, () => listener(readReportState()));
  listener(readReportState());
}
