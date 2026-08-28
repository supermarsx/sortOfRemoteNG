import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `language` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * ── A note on the long pickers ──────────────────────────────────
 * `region`, `timeZone`, `calendarSystem` and `numberingSystem` are populated at
 * runtime (`COUNTRIES`, `Intl.supportedValuesOf`), so their full option lists —
 * 250 countries, ~400 IANA zones — are neither literal nor stable enough to
 * mirror here. Each of those controls is itself `searchable`, so settings search
 * only has to land the user on the right control. What is indexed below is the
 * fixed head of each list plus the option set the app falls back to when
 * `Intl.supportedValuesOf` is unavailable, which is what actually ships in that
 * case. The matcher squashes punctuation, so `America/New_York` is reachable as
 * "new york" and `pt-PT` as "pt pt".
 */
export const LANGUAGE_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "autoDetectOsLanguage",
    label: "Auto-detect from system",
    description:
      "When enabled, the app follows the OS/browser language at launch. Your explicit choice below is preserved and restored if you turn this off.",
    tags: ["locale", "os", "system", "detect", "automatic", "browser"],
    synonyms: ["autodetect language", "follow system language", "os locale"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "language",
    label: "Display Language",
    labelKey: "settings.language",
    description:
      "Choose the display language for the application interface. Changes apply immediately.",
    tags: [
      "locale",
      "i18n",
      "translation",
      "language",
      "interface",
      "ui language",
    ],
    // Both halves of every SUPPORTED_LANGUAGES option, plus the English exonym
    // and an unaccented spelling for each — the matcher's squash step strips
    // "ê"/"ñ"/"ç" rather than folding them, so "portugues" would otherwise miss
    // "Português".
    values: [
      "en-US",
      "English (US)",
      "english",
      "en-x-leet",
      "English (Leetspeak)",
      "leetspeak",
      "en-x-pirate",
      "English (Pirate)",
      "pirate",
      "es-ES",
      "Español (España)",
      "espanol",
      "spanish",
      "fr-FR",
      "Français (France)",
      "francais",
      "french",
      "de-DE",
      "Deutsch (Deutschland)",
      "german",
      "it-IT",
      "Italiano (Italia)",
      "italian",
      "pt-PT",
      "Português (Portugal)",
      "portugues",
      "portuguese",
      "ru-RU",
      "Русский (Россия)",
      "russkiy",
      "russian",
      "zh-CN",
      "中文 (简体, 中国)",
      "zhongwen",
      "chinese",
      "simplified chinese",
      "mandarin",
      "ja-JP",
      "日本語 (日本)",
      "nihongo",
      "japanese",
      "ko-KR",
      "한국어 (대한민국)",
      "hangugeo",
      "korean",
    ],
    synonyms: ["change language", "ui language", "display language"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "region",
    label: "Region / Country",
    description:
      "Country used for regional formatting (dates, numbers). Set to System default to follow the OS.",
    tags: ["country", "region", "locale", "format", "iso 3166"],
    values: [
      "auto",
      "System default",
      "United States",
      "United Kingdom",
      "Canada",
      "Australia",
      "Germany",
      "France",
      "Spain",
      "Portugal",
      "Brazil",
      "Italy",
      "Netherlands",
      "Poland",
      "Russian Federation",
      "China",
      "Japan",
      "Korea, Republic of",
      "India",
      "Mexico",
      "South Africa",
    ],
    synonyms: ["country", "regional format", "locale region"],
    section: "language",
    sectionLabel: "Language",
  },

  // ─── Date & time formatting ─────────────────────────────────────
  {
    key: "timeFormat",
    label: "Time Format",
    description:
      "How clock times are displayed across the app (logs, recordings, status). Locale default follows the selected language/region.",
    tags: ["time", "clock", "format", "locale", "timestamp"],
    values: [
      "auto",
      "Locale default",
      "12h",
      "12-hour (1:30 PM)",
      "24h",
      "24-hour (13:30)",
    ],
    synonyms: [
      "12 hour",
      "24 hour",
      "am pm",
      "military time",
      "1:30 pm",
      "13:30",
    ],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "dateFormat",
    label: "Date Format",
    description:
      "How dates are displayed. Locale default follows the selected language/region; Short/Medium/Long pick an explicit style.",
    tags: ["date", "format", "locale", "timestamp", "style"],
    values: [
      "auto",
      "Locale default",
      "short",
      "Short",
      "medium",
      "Medium",
      "long",
      "Long",
    ],
    synonyms: ["date style", "short date", "long date"],
    section: "language",
    sectionLabel: "Language",
  },

  // ─── Regional formats (advanced) ────────────────────────────────
  {
    key: "timeZone",
    label: "Time Zone",
    description:
      "Display timestamps in a specific IANA time zone instead of the system zone — useful when operating servers in another region.",
    tags: ["timezone", "tz", "utc", "iana", "zone", "clock", "offset"],
    values: [
      "auto",
      "System default",
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Australia/Sydney",
    ],
    synonyms: ["time zone", "tz", "gmt", "utc offset"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "calendarSystem",
    label: "Calendar System",
    description:
      "Calendar used to render dates (Gregorian, Islamic, Hebrew, Buddhist, Japanese, Persian, …). Locale default follows the language/region.",
    tags: ["calendar", "dates", "era"],
    values: [
      "auto",
      "Locale default",
      "gregory",
      "gregorian",
      "buddhist",
      "chinese",
      "coptic",
      "ethiopic",
      "hebrew",
      "indian",
      "islamic",
      "hijri",
      "japanese",
      "persian",
    ],
    synonyms: ["calendar", "gregorian", "hijri", "lunar calendar"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "numberingSystem",
    label: "Numbering System",
    description:
      "Digit set used in numbers and dates (Latin, Arabic-Indic, Devanagari, Thai, …). Locale default follows the language/region.",
    tags: ["numbering", "digits", "numerals", "numbers"],
    values: [
      "auto",
      "Locale default",
      "latn",
      "latin",
      "arab",
      "arabic",
      "arabext",
      "beng",
      "bengali",
      "deva",
      "devanagari",
      "fullwide",
      "hanidec",
      "thai",
    ],
    synonyms: ["digits", "numerals", "number format"],
    section: "language",
    sectionLabel: "Language",
  },

  // ─── Text direction ─────────────────────────────────────────────
  {
    key: "rtlLayout",
    label: "Right-to-left (RTL) layout",
    description:
      "Sets the document direction to RTL, mirroring the entire interface. Enable this for right-to-left languages.",
    tags: ["rtl", "right-to-left", "arabic", "hebrew", "direction", "mirror"],
    synonyms: ["rtl", "right to left", "bidi", "mirror interface"],
    section: "language",
    sectionLabel: "Language",
  },
];
