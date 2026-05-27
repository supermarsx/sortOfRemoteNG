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
    | "language"
    | "autoDetectOsLanguage"
    | "region"
    | "timeFormat"
    | "dateFormat"
    | "timeZone"
    | "calendarSystem"
    | "numberingSystem"
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

/** Layer the specialty Intl options (time zone, calendar, numbering
 *  system) onto a base options object when they aren't "auto". */
const withSpecialtyOptions = (
  settings: LocaleFormatSettings,
  base: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions => {
  const opts: Intl.DateTimeFormatOptions = { ...base };
  if (settings.timeZone && settings.timeZone !== "auto") {
    opts.timeZone = settings.timeZone;
  }
  if (settings.calendarSystem && settings.calendarSystem !== "auto") {
    opts.calendar = settings.calendarSystem;
  }
  if (settings.numberingSystem && settings.numberingSystem !== "auto") {
    opts.numberingSystem = settings.numberingSystem;
  }
  return opts;
};

/** Format defensively: a stale/invalid specialty option (e.g. a time zone
 *  from a downgraded build) must never throw and break a render. */
const safeFormat = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
  date: Date,
): string => {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale).format(date);
    } catch {
      return date.toLocaleString();
    }
  }
};

export function formatDate(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return safeFormat(
    getEffectiveLocale(settings, navLang),
    withSpecialtyOptions(settings, { dateStyle: dateStyleFrom(settings.dateFormat) }),
    toDate(value),
  );
}

export function formatTime(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return safeFormat(
    getEffectiveLocale(settings, navLang),
    withSpecialtyOptions(settings, {
      timeStyle: "medium",
      hour12: hour12From(settings.timeFormat),
    }),
    toDate(value),
  );
}

export function formatDateTime(
  value: Date | number | string,
  settings: LocaleFormatSettings,
  navLang?: string,
): string {
  return safeFormat(
    getEffectiveLocale(settings, navLang),
    withSpecialtyOptions(settings, {
      dateStyle: dateStyleFrom(settings.dateFormat),
      timeStyle: "medium",
      hour12: hour12From(settings.timeFormat),
    }),
    toDate(value),
  );
}
