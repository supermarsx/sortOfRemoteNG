import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";

const resources = {
  en: { translation: en },
};

const languageLoaders: Record<string, () => Promise<any>> = {
  es: () => import("./locales/es.json"),
  fr: () => import("./locales/fr.json"),
  de: () => import("./locales/de.json"),
  "pt-PT": () => import("./locales/pt-PT.json"),
  "zh-CN": () => import("./locales/zh-CN.json"),
  ja: () => import("./locales/ja.json"),
  ko: () => import("./locales/ko.json"),
  it: () => import("./locales/it.json"),
  ru: () => import("./locales/ru.json"),
};

const getBaseLanguage = (lng: string) => lng.split("-")[0];

/**
 * Languages the app ships translations for — `en` is bundled, the rest are
 * lazy-loaded via `languageLoaders`. Single source for the Language
 * settings dropdown and OS-language detection.
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
  if (!lng) return "en";
  if (SUPPORTED_LANGUAGES.some((l) => l.value === lng)) return lng;
  const base = getBaseLanguage(lng);
  const match = SUPPORTED_LANGUAGES.find(
    (l) => l.value === base || getBaseLanguage(l.value) === base,
  );
  return match?.value ?? "en";
};

const loadLanguage = async (lng: string) => {
  let language = lng;
  let loader = languageLoaders[language];

  if (!loader) {
    language = getBaseLanguage(language);
    loader = languageLoaders[language];
  }

  if (loader) {
    const { default: translations } = await loader();
    i18n.addResourceBundle(language, "translation", translations, true, true);
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["navigator", "htmlTag"],
      caches: [],
    },
  });

export { loadLanguage, getBaseLanguage };
export default i18n;
