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
  return formatter.format(values) as string;
}
