import { replaceState } from "./history";
import { parseState, type PlaygroundState } from "./url";

const STATE_EVENT = "sawa:state";

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
