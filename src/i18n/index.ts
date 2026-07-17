import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enUS from "./locales/en-US.json";
import {
  SUPPORTED_LANGUAGES,
  getBaseLanguage,
  resolveSupportedLanguage,
} from "./languages";

const resources = {
  "en-US": { translation: enUS },
};

const languageLoaders: Record<string, () => Promise<any>> = {
  "es-ES": () => import("./locales/es-ES.json"),
  "fr-FR": () => import("./locales/fr-FR.json"),
  "de-DE": () => import("./locales/de-DE.json"),
  "pt-PT": () => import("./locales/pt-PT.json"),
  "zh-CN": () => import("./locales/zh-CN.json"),
  "ja-JP": () => import("./locales/ja-JP.json"),
  "ko-KR": () => import("./locales/ko-KR.json"),
  "it-IT": () => import("./locales/it-IT.json"),
  "ru-RU": () => import("./locales/ru-RU.json"),
};

/**
 * Load a locale bundle. Locale files are keyed by their full BCP-47 tag
 * ("fr-FR"), but callers may pass an unresolved value — a legacy stored
 * setting ("fr") or an OS locale ("fr-CA"). Resolve through the supported
 * list so those still find the shipped bundle; without this a bare "fr"
 * would match no loader and silently render untranslated.
 *
 * The bundle is registered under the *requested* tag, because callers pass
 * that same value to `changeLanguage` and i18next resolves the key directly
 * rather than walking down from a base language.
 */
const loadLanguage = async (lng: string) => {
  const loader =
    languageLoaders[lng] ?? languageLoaders[resolveSupportedLanguage(lng)];

  if (loader) {
    const { default: translations } = await loader();
    i18n.addResourceBundle(lng, "translation", translations, true, true);
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en-US",
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["navigator", "htmlTag"],
      caches: [],
    },
  });

export {
  loadLanguage,
  getBaseLanguage,
  SUPPORTED_LANGUAGES,
  resolveSupportedLanguage,
};
export default i18n;
