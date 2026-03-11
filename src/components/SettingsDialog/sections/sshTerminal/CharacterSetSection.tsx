import type { SectionProps } from "./types";
import React from "react";
import { CharacterSets } from "../../../../types/settings/settings";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { Select, FormField } from "../../../ui/forms";

const CharacterSetSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.characterSet", "Character Set")}
    icon={<Type className="w-4 h-4 text-accent" />}
    defaultOpen={false}
  >
    <FormField label={t(
        "settings.sshTerminal.remoteCharset",
        "Remote Character Set",
      )}>
      <Select
        value={cfg.characterSet}
        onChange={(v) => up({ characterSet: v })}
        options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
      />
    </FormField>
    <FormField label={t(
        "settings.sshTerminal.unicodeWidth",
        "Unicode Ambiguous Width",
      )}>
      <Select
        value={cfg.unicodeAmbiguousWidth}
        onChange={(v) =>
          up({ unicodeAmbiguousWidth: v as "narrow" | "wide" })
        }
        options={[
          { value: "narrow", label: "Narrow (1 cell)" },
          { value: "wide", label: "Wide (2 cells)" },
        ]}
      />
    </FormField>
  </SettingsCollapsibleSection>
);

export default CharacterSetSection;
