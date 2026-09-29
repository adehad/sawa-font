import { toSearch, type PlaygroundState } from "./url";

/**
 * Swaps the current URL's query for `search` without adding a history entry,
 * so a slider tick or palette change never adds a back-button stop.
 */
export function replaceSearch(search: string): void {
  const { pathname, hash } = location;
  history.replaceState(history.state, "", `${pathname}${search}${hash}`);
}

export function replaceState(state: PlaygroundState): void {
  replaceSearch(toSearch(state));
}
