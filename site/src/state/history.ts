import { toSearch, type PlaygroundState } from "./url";

/**
 * Writes `state` into the current URL without adding a history entry, so a
 * slider tick or palette change never adds a back-button stop.
 */
export function replaceState(state: PlaygroundState): void {
  const { pathname, hash } = location;
  history.replaceState(history.state, "", `${pathname}${toSearch(state)}${hash}`);
}
