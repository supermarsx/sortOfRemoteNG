/**
 * Pure language metadata + helpers with NO dependency on i18next. Kept
 * separate from `i18n/index.ts` so non-UI modules (e.g. locale formatting)
 * can import the supported-language list without dragging the i18next
 * runtime (and its react-i18next init) into their module graph.
 */

/** Strip a BCP-47 tag down to its base language ("fr-CA" → "fr"). */
export const getBaseLanguage = (lng: string): string => lng.split("-")[0];

/**
 * Languages the app ships translations for — `en` is bundled, the rest are
 * lazy-loaded. Single source for the Language settings dropdown and OS
 * language detection.
 */
export const SUPPORTED_LANGUAGES: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español (España)" },
  { value: "fr-FR", label: "Français (France)" },
  { value: "de-DE", label: "Deutsch (Deutschland)" },
  { value: "it-IT", label: "Italiano (Italia)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "ru-RU", label: "Русский (Россия)" },
  { value: "zh-CN", label: "中文 (简体, 中国)" },
  { value: "ja-JP", label: "日本語 (日本)" },
  { value: "ko-KR", label: "한국어 (대한민국)" },
];

/**
 * Map an arbitrary `navigator.language` value (e.g. "fr-CA") to the closest
 * supported language, falling back to English. Used for OS-language
 * auto-detection.
 */
export const resolveSupportedLanguage = (lng: string | undefined): string => {
  if (!lng) return "en-US";
  if (SUPPORTED_LANGUAGES.some((l) => l.value === lng)) return lng;
  const base = getBaseLanguage(lng);
  const match = SUPPORTED_LANGUAGES.find(
    (l) => l.value === base || getBaseLanguage(l.value) === base,
  );
  return match?.value ?? "en-US";
};
