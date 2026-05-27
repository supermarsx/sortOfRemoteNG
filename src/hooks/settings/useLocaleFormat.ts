import { useContext, useMemo } from "react";
import SettingsContext from "../../contexts/SettingsContext";
import {
  formatDate,
  formatTime,
  formatDateTime,
  getEffectiveLocale,
  type LocaleFormatSettings,
} from "../../utils/i18n/localeFormat";

/**
 * Locale-aware formatters bound to the current Language settings.
 *
 * Tolerant of a missing SettingsProvider (e.g. in isolated tests): when no
 * context is present it falls back to defaults, which pass `undefined` to
 * Intl and follow the runtime locale.
 */
export function useLocaleFormat() {
  const ctx = useContext(SettingsContext);
  const settings = (ctx?.settings ?? {}) as LocaleFormatSettings;

  const { language, autoDetectOsLanguage, region, timeFormat, dateFormat } =
    settings;

  return useMemo(() => {
    const s: LocaleFormatSettings = {
      language,
      autoDetectOsLanguage,
      region,
      timeFormat,
      dateFormat,
    };
    return {
      locale: getEffectiveLocale(s),
      formatDate: (v: Date | number | string) => formatDate(v, s),
      formatTime: (v: Date | number | string) => formatTime(v, s),
      formatDateTime: (v: Date | number | string) => formatDateTime(v, s),
    };
  }, [language, autoDetectOsLanguage, region, timeFormat, dateFormat]);
}

export default useLocaleFormat;
