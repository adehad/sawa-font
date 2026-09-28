import { IntlMessageFormat } from "intl-messageformat";
import en from "./en.json";
import ar from "./ar.json";
import type { Locale } from "./locales";

export type MessageKey = keyof typeof en;

// Assigning to Record<MessageKey, string> makes a key missing from ar.json a
// build-time type error; it does not catch an extra key ar has but en lacks.
const arMessages: Record<MessageKey, string> = ar;

const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  ar: arMessages,
};

const formatterCache = new Map<string, IntlMessageFormat>();

export function t(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const cacheKey = `${locale}:${key}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(messages[locale][key], locale);
    formatterCache.set(cacheKey, formatter);
  }
  const formatted = formatter.format(values);
  if (typeof formatted !== "string") {
    // IntlMessageFormat#format returns a Part[] only when the message uses
    // rich-text tags with custom formatters; our messages never do.
    throw new Error(`message "${key}" formatted to a non-string result`);
  }
  return formatted;
}

/** The unformatted ICU message, for pages that format a few messages in the browser. */
export function rawMessage(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
