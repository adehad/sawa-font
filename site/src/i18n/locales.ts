export type Locale = "en" | "ar";

export const LOCALES: readonly Locale[] = ["en", "ar"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "sawa.locale";

export interface LocaleInfo {
  /** The language's name written in its own script; never translated. */
  autonym: string;
  dir: "ltr" | "rtl";
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { autonym: "English", dir: "ltr" },
  ar: { autonym: "العربية", dir: "rtl" },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
