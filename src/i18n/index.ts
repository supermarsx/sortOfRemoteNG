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
};

const getBaseLanguage = (lng: string) => lng.split("-")[0];

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

export { loadLanguage };
export default i18n;
