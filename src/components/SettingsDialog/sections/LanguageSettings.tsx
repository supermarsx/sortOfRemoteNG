import React from "react";
import { useTranslation } from "react-i18next";
import {
  Languages,
  Globe,
  MapPin,
  ScanText,
  AlignRight,
  Clock,
  CalendarDays,
  CalendarClock,
  Hash,
  Sparkles,
} from "lucide-react";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  SUPPORTED_LANGUAGES,
  resolveSupportedLanguage,
} from "../../../i18n";
import { COUNTRIES } from "../../../data/countries";
import { formatDateTime } from "../../../utils/i18n/localeFormat";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../ui/settings/SettingsPrimitives";

interface LanguageSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* Country / region options for locale-aware formatting. Persisted only —
 * "auto" follows the system region. */
const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "System default" },
  ...COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
];

const languageLabel = (value: string): string =>
  SUPPORTED_LANGUAGES.find((l) => l.value === value)?.label ?? value;

/* Specialty formatting option lists, sourced from the engine's
 * `Intl.supportedValuesOf` where available with a static fallback so the
 * pickers still populate in environments that lack it. */
function intlSupportedValues(
  key: "calendar" | "numberingSystem" | "timeZone",
  fallback: string[],
): string[] {
  try {
    const fn = (
      Intl as unknown as {
        supportedValuesOf?: (k: string) => string[];
      }
    ).supportedValuesOf;
    if (typeof fn === "function") {
      const values = fn(key);
      if (Array.isArray(values) && values.length) return values;
    }
  } catch {
    /* not supported — use fallback */
  }
  return fallback;
}

const AUTO_OPTION = { value: "auto", label: "Locale default" };

const TIME_ZONE_OPTIONS = [
  { value: "auto", label: "System default" },
  ...intlSupportedValues("timeZone", [
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
  ]).map((z) => ({ value: z, label: z.replace(/_/g, " ") })),
];

const CALENDAR_OPTIONS = [
  AUTO_OPTION,
  ...intlSupportedValues("calendar", [
    "gregory",
    "buddhist",
    "chinese",
    "coptic",
    "ethiopic",
    "hebrew",
    "indian",
    "islamic",
    "japanese",
    "persian",
  ]).map((c) => ({ value: c, label: c })),
];

const NUMBERING_OPTIONS = [
  AUTO_OPTION,
  ...intlSupportedValues("numberingSystem", [
    "latn",
    "arab",
    "arabext",
    "beng",
    "deva",
    "fullwide",
    "hanidec",
    "thai",
  ]).map((n) => ({ value: n, label: n })),
];

export const LanguageSettings: React.FC<LanguageSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  const autoDetect = settings.autoDetectOsLanguage ?? false;
  const detected = resolveSupportedLanguage(
    typeof navigator !== "undefined" ? navigator.language : "en",
  );
  // The explicit pick, normalized to a full locale for the dropdown.
  const explicit = resolveSupportedLanguage(settings.language);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Languages className="w-5 h-5 text-primary" />}
        title="Language"
        description="Display language, regional formatting, and text direction."
      />

      {/* Language */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Language"
        />
        <Card>
          <Toggle
            settingKey="autoDetectOsLanguage"
            icon={<ScanText size={16} />}
            label="Auto-detect from system"
            description={
              autoDetect
                ? `Following the operating system locale — currently ${languageLabel(detected)}.`
                : "Use the operating system / browser locale instead of an explicit choice."
            }
            checked={autoDetect}
            onChange={(v) => updateSettings({ autoDetectOsLanguage: v })}
            infoTooltip="When enabled, the app follows the OS/browser language at launch. Your explicit choice below is preserved and restored if you turn this off."
          />

          <div
            className={
              autoDetect ? "opacity-50 pointer-events-none" : undefined
            }
          >
            <SettingsSelectRow
              settingKey="language"
              icon={<Languages size={16} />}
              label={t("settings.language", "Display Language")}
              value={explicit}
              options={SUPPORTED_LANGUAGES}
              onChange={(v) => updateSettings({ language: v })}
              infoTooltip="Choose the display language for the application interface. Changes take effect after restarting the app."
            />
          </div>

          <SettingsSelectRow
            settingKey="region"
            icon={<MapPin size={16} />}
            label="Region / Country"
            value={settings.region ?? "auto"}
            options={REGION_OPTIONS}
            onChange={(v) => updateSettings({ region: v })}
            searchable
            searchPlaceholder="Search countries…"
            infoTooltip="Country used for regional formatting (dates, numbers). Set to System default to follow the OS."
          />
        </Card>
      </div>

      {/* Formatting */}
      <div className="space-y-4">
        <SectionHeader
          icon={<CalendarClock className="w-4 h-4 text-primary" />}
          title="Date & Time Formatting"
        />
        <Card>
          <SettingsSelectRow
            settingKey="timeFormat"
            icon={<Clock size={16} />}
            label="Time Format"
            value={settings.timeFormat ?? "auto"}
            options={[
              { value: "auto", label: "Locale default" },
              { value: "12h", label: "12-hour (1:30 PM)" },
              { value: "24h", label: "24-hour (13:30)" },
            ]}
            onChange={(v) =>
              updateSettings({
                timeFormat: v as NonNullable<GlobalSettings["timeFormat"]>,
              })
            }
            infoTooltip="How clock times are displayed across the app (logs, recordings, status). Locale default follows the selected language/region."
          />
          <SettingsSelectRow
            settingKey="dateFormat"
            icon={<CalendarDays size={16} />}
            label="Date Format"
            value={settings.dateFormat ?? "auto"}
            options={[
              { value: "auto", label: "Locale default" },
              { value: "short", label: "Short" },
              { value: "medium", label: "Medium" },
              { value: "long", label: "Long" },
            ]}
            onChange={(v) =>
              updateSettings({
                dateFormat: v as NonNullable<GlobalSettings["dateFormat"]>,
              })
            }
            infoTooltip="How dates are displayed. Locale default follows the selected language/region; Short/Medium/Long pick an explicit style."
          />
          <p className="text-xs text-[var(--color-textMuted)] mt-1 ml-7">
            Preview: {formatDateTime(new Date(), settings)}
          </p>
        </Card>
      </div>

      {/* Specialty / advanced regional formats */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Sparkles className="w-4 h-4 text-primary" />}
          title="Regional Formats (Advanced)"
        />
        <Card>
          <SettingsSelectRow
            settingKey="timeZone"
            icon={<Globe size={16} />}
            label="Time Zone"
            value={settings.timeZone ?? "auto"}
            options={TIME_ZONE_OPTIONS}
            onChange={(v) => updateSettings({ timeZone: v })}
            searchable
            searchPlaceholder="Search time zones…"
            infoTooltip="Display timestamps in a specific IANA time zone instead of the system zone — useful when operating servers in another region."
          />
          <SettingsSelectRow
            settingKey="calendarSystem"
            icon={<CalendarDays size={16} />}
            label="Calendar System"
            value={settings.calendarSystem ?? "auto"}
            options={CALENDAR_OPTIONS}
            onChange={(v) => updateSettings({ calendarSystem: v })}
            searchable
            searchPlaceholder="Search calendars…"
            infoTooltip="Calendar used to render dates (Gregorian, Islamic, Hebrew, Buddhist, Japanese, Persian, …). Locale default follows the language/region."
          />
          <SettingsSelectRow
            settingKey="numberingSystem"
            icon={<Hash size={16} />}
            label="Numbering System"
            value={settings.numberingSystem ?? "auto"}
            options={NUMBERING_OPTIONS}
            onChange={(v) => updateSettings({ numberingSystem: v })}
            searchable
            searchPlaceholder="Search numbering systems…"
            infoTooltip="Digit set used in numbers and dates (Latin, Arabic-Indic, Devanagari, Thai, …). Locale default follows the language/region."
          />
        </Card>
      </div>

      {/* Text Direction */}
      <div className="space-y-4">
        <SectionHeader
          icon={<AlignRight className="w-4 h-4 text-primary" />}
          title="Text Direction"
        />
        <Card>
          <Toggle
            settingKey="rtlLayout"
            icon={<AlignRight size={16} />}
            label="Right-to-left (RTL) layout"
            description="Mirror the interface for right-to-left languages such as Arabic or Hebrew"
            checked={settings.rtlLayout ?? false}
            onChange={(v) => updateSettings({ rtlLayout: v })}
            infoTooltip="Sets the document direction to RTL, mirroring the entire interface. Enable this for right-to-left languages."
          />
        </Card>
      </div>
    </div>
  );
};

export default LanguageSettings;
