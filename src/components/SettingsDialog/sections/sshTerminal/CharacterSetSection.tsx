import React from "react";
import { CharacterSets } from "../../../../types/settings";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { Select } from "../../../ui/forms";

const CharacterSetSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.characterSet", "Character Set")}
    icon={<Type className="w-4 h-4 text-indigo-400" />}
    defaultOpen={false}
  >
    <Select
      value={cfg.characterSet}
      onChange={(v) => up({ characterSet: v })}
      label={t(
        "settings.sshTerminal.remoteCharset",
        "Remote Character Set",
      )}
      options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
    />
    <Select
      value={cfg.unicodeAmbiguousWidth}
      onChange={(v) =>
        up({ unicodeAmbiguousWidth: v as "narrow" | "wide" })
      }
      label={t(
        "settings.sshTerminal.unicodeWidth",
        "Unicode Ambiguous Width",
      )}
      options={[
        { value: "narrow", label: "Narrow (1 cell)" },
        { value: "wide", label: "Wide (2 cells)" },
      ]}
    />
  </SettingsCollapsibleSection>
);

export default CharacterSetSection;
