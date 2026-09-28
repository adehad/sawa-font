import type { Locale } from "./locales";

const PAGE_SEGMENTS = {
  specimen: "",
  compare: "compare",
  report: "report",
  about: "about",
} as const;

export type PageName = keyof typeof PAGE_SEGMENTS;

// TypeScript's Object.keys always returns string[], with no way to narrow it
// to keyof typeof PAGE_SEGMENTS without an assertion (microsoft/TypeScript#12870).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const PAGE_NAMES: readonly PageName[] = Object.keys(PAGE_SEGMENTS) as PageName[];

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function withBase(base: string, segments: readonly string[]): string {
  const cleanBase = withTrailingSlash(base);
  const cleanSegments = segments.filter((segment) => segment.length > 0).join("/");
  return withTrailingSlash(cleanSegments ? `${cleanBase}${cleanSegments}` : cleanBase);
}

/** Builds the URL for `page` in `locale`, given the site's configured base path. */
export function localizedPath(base: string, locale: Locale, page: PageName): string {
  return withBase(base, [locale, PAGE_SEGMENTS[page]]);
}

/**
 * Swaps the locale segment of a pathname while keeping the rest of the path,
 * including nested segments and the trailing slash.
 */
export function swapLocale(base: string, pathname: string, newLocale: Locale): string {
  const cleanBase = withTrailingSlash(base);
  if (!pathname.startsWith(cleanBase)) {
    throw new Error(`pathname "${pathname}" is not under base "${cleanBase}"`);
  }
  const rest = pathname.slice(cleanBase.length);
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  segments[0] = newLocale;
  return withBase(base, segments);
}
