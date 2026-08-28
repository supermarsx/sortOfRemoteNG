import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `language` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const LANGUAGE_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Language ───────────────────────────────────────────────────
  {
    key: "language",
    label: "Language",
    description: "Application display language",
    tags: [
      "locale",
      "i18n",
      "translation",
      "english",
      "spanish",
      "french",
      "region",
    ],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "autoDetectOsLanguage",
    label: "Auto-detect Language",
    description: "Follow the OS/browser locale",
    tags: ["locale", "os", "system", "detect", "automatic"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "region",
    label: "Region / Country",
    description: "Country used for regional formatting",
    tags: ["country", "region", "locale", "format"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "timeFormat",
    label: "Time Format",
    description: "12-hour or 24-hour clock for timestamps",
    tags: ["time", "12h", "24h", "clock", "format", "locale"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "dateFormat",
    label: "Date Format",
    description: "Date display style for timestamps",
    tags: ["date", "format", "short", "long", "locale"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "timeZone",
    label: "Time Zone",
    description: "Display timestamps in a specific IANA time zone",
    tags: ["timezone", "tz", "utc", "iana", "zone", "clock"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "calendarSystem",
    label: "Calendar System",
    description:
      "Calendar used to render dates (Gregorian, Islamic, Hebrew, …)",
    tags: [
      "calendar",
      "gregorian",
      "islamic",
      "hebrew",
      "buddhist",
      "japanese",
      "persian",
    ],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "numberingSystem",
    label: "Numbering System",
    description: "Digit set used in numbers and dates",
    tags: ["numbering", "digits", "arabic", "latin", "devanagari", "numerals"],
    section: "language",
    sectionLabel: "Language",
  },
  {
    key: "rtlLayout",
    label: "RTL Layout",
    description: "Right-to-left interface direction",
    tags: ["rtl", "right-to-left", "arabic", "hebrew", "direction", "mirror"],
    section: "language",
    sectionLabel: "Language",
  },
];
