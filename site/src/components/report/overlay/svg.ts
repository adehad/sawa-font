const PATH_DATA = /<path\b[^>]*?\sd="([^"]*)"/g;

/**
 * The outline data of every <path> in a layer file. The viewer draws only
 * these into its own <svg>, so nothing else in the file (scripts, styles,
 * fixed fills) reaches the page.
 */
export function layerPaths(svg: string): string[] {
  return [...svg.matchAll(PATH_DATA)].map((match) => match[1] ?? "").filter((d) => d !== "");
}

const cache = new Map<string, Promise<string[]>>();

/** Fetches a layer file once per page and resolves to its path data. */
export function fetchLayer(url: string): Promise<string[]> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`);
      }
      return layerPaths(await response.text());
    });
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}
