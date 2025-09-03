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

const loadLanguage = async (lng: string) => {
  const loader = languageLoaders[lng];
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

const originalChangeLanguage = i18n.changeLanguage.bind(i18n);
(i18n as any).changeLanguage = async (lng: string, ...args: any[]) => {
  if (!i18n.hasResourceBundle(lng, "translation")) {
    await loadLanguage(lng);
  }
  return originalChangeLanguage(lng, ...args);
};

export default i18n;
