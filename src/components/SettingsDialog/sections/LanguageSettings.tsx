import React from "react";
import { useTranslation } from "react-i18next";
import { Languages, Globe, MapPin, ScanText, AlignRight } from "lucide-react";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  SUPPORTED_LANGUAGES,
  resolveSupportedLanguage,
} from "../../../i18n";
import { COUNTRIES } from "../../../data/countries";
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
