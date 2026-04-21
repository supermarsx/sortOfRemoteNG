import type { SectionProps } from "./types";
import React from "react";
import { CharacterSets } from "../../../../types/settings/settings";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { Select, FormField } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const CharacterSetSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.characterSet", "Character Set")}
    icon={<Type className="w-4 h-4 text-primary" />}
    defaultOpen={false}
  >
    <FormField label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.remoteCharset",
        "Remote Character Set",
      )} <InfoTooltip text="The character encoding used by the remote server. Must match the server's locale to display text correctly." /></span>}>
      <Select
        value={cfg.characterSet}
        onChange={(v) => up({ characterSet: v })}
        options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
      />
    </FormField>
    <FormField label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.unicodeWidth",
        "Unicode Ambiguous Width",
      )} <InfoTooltip text="How wide ambiguous-width Unicode characters are rendered. East Asian locales typically use wide (2 cells)." /></span>}>
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
