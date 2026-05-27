/**
 * Locale-aware date/time formatting derived from the user's Language
 * settings (display language, region, time/date format). Pure functions
 * so they can be unit-tested without React; consume them in components via
 * the `useLocaleFormat` hook.
 */
import type { GlobalSettings } from "../../types/settings/settings";
import { resolveSupportedLanguage } from "../../i18n/languages";

/** The slice of settings that affects formatting. */
export type LocaleFormatSettings = Partial<
  Pick<
    GlobalSettings,
    "language" | "autoDetectOsLanguage" | "region" | "timeFormat" | "dateFormat"
  >
>;

const navigatorLanguage = (): string =>
  typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en-US";

/**
 * Resolve the effective BCP-47 locale for formatting. When a region is
 * chosen it is combined with the base language (e.g. en + GB → "en-GB");
 * otherwise the display/auto-detected language locale is used as-is.
 */
export function getEffectiveLocale(
  settings: LocaleFormatSettings,
  navLang: string = navigatorLanguage(),
): string {
  const lang = settings.autoDetectOsLanguage
    ? resolveSupportedLanguage(navLang)
    : settings.language || "en-US";
  const region = settings.region;
  if (region && region !== "auto") {
    return `${lang.split("-")[0]}-${region}`;
  }
  return lang;
}

const hour12From = (
  fmt: LocaleFormatSettings["timeFormat"],
): boolean | undefined =>
  fmt === "12h" ? true : fmt === "24h" ? false : undefined;

const dateStyleFrom = (
  fmt: LocaleFormatSettings["dateFormat"],
): "short" | "medium" | "long" =>
  fmt && fmt !== "auto" ? fmt : "medium";

const toDate = (value: Date | number | string): Date =>
  value instanceof Date ? value : new Date(value);

export function formatDate(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(settings, navLang), {
    dateStyle: dateStyleFrom(settings.dateFormat),
  }).format(toDate(value));
}

export function formatTime(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(settings, navLang), {
    timeStyle: "medium",
    hour12: hour12From(settings.timeFormat),
  }).format(toDate(value));
}

export function formatDateTime(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(settings, navLang), {
    dateStyle: dateStyleFrom(settings.dateFormat),
    timeStyle: "medium",
    hour12: hour12From(settings.timeFormat),
  }).format(toDate(value));
}
