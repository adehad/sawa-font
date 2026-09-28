import { IntlMessageFormat } from "intl-messageformat";
import type { MessageKey } from "../../i18n/t";
import { FONT_ROSTER } from "../../fonts/roster";
import type { FontOrLocal } from "../../state/url";

/** The messages the Compare page's scripts format in the browser. */
export const CLIENT_KEYS = [
  ...FONT_ROSTER.flatMap((id) => [`font.${id}.name`, `font.${id}.note`] as const),
  "compare.localName",
  "compare.localNote",
  "compare.localPlaceholder",
  "compare.localLoaded",
  "compare.localError",
  "compare.statusLabel",
  "compare.paneWeight",
  "compare.paneWeightStatic",
  "compare.paneFont",
  "compare.panePalette",
  "compare.moveUp",
  "compare.moveDown",
  "compare.weightDefault",
  "compare.waterfallSize",
  "palette.mono",
  "palette.gray",
  "palette.groups",
] as const satisfies readonly MessageKey[];

export type ClientKey = (typeof CLIENT_KEYS)[number];

export type ClientMessages = Record<ClientKey, string>;

/**
 * The message naming a font everywhere on the Compare page. Status quo is
 * named for what it shows, the visitor's own Arabic fallback.
 */
export function fontNameKey(id: FontOrLocal): ClientKey {
  if (id === "status") {
    return "compare.statusLabel";
  }
  return id === "local" ? "compare.localName" : `font.${id}.name`;
}

const SELECTOR = "script[data-compare-messages]";

/** The page's JSON block, escaped so no message can close the script element. */
export function messagesJson(messages: ClientMessages): string {
  return JSON.stringify(messages).replaceAll("<", "\\u003c");
}

export type Format = (key: ClientKey, values?: Record<string, string | number>) => string;

/** Reads the page's message block and returns a formatter for the page's locale. */
export function clientFormat(): Format {
  const element = document.querySelector(SELECTOR);
  // The block is written by compare.astro from CLIENT_KEYS, so it has every key.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const messages = JSON.parse(element?.textContent ?? "{}") as ClientMessages;
  const locale = document.documentElement.lang;
  const cache = new Map<ClientKey, IntlMessageFormat>();
  return (key, values) => {
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = new IntlMessageFormat(messages[key] ?? key, locale);
      cache.set(key, formatter);
    }
    const result = formatter.format(values);
    return typeof result === "string" ? result : String(result);
  };
}
