import type { SectionProps } from "./types";
import React from "react";
import { CharacterSets } from "../../../../types/settings/settings";
import { Type, Globe, AlignJustify } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const CharacterSetSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Type className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.characterSet", "Character Set")}
    />
    <Card>
      <SettingsSelectRow
        settingKey="characterSet"
        icon={<Globe size={16} />}
        label={t(
          "settings.sshTerminal.remoteCharset",
          "Remote character set",
        )}
        value={cfg.characterSet}
        onChange={(v) => up({ characterSet: v })}
        options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
        searchable
        searchPlaceholder="Search encodings…"
        infoTooltip="The character encoding used by the remote server. Must match the server's locale to display text correctly."
      />
      <SettingsSelectRow
        settingKey="unicodeAmbiguousWidth"
        icon={<AlignJustify size={16} />}
        label={t(
          "settings.sshTerminal.unicodeWidth",
          "Unicode ambiguous width",
        )}
        value={cfg.unicodeAmbiguousWidth}
        onChange={(v) =>
          up({ unicodeAmbiguousWidth: v as "narrow" | "wide" })
        }
        options={[
          { value: "narrow", label: "Narrow (1 cell)" },
          { value: "wide", label: "Wide (2 cells)" },
        ]}
        infoTooltip="How wide ambiguous-width Unicode characters are rendered. East Asian locales typically use wide (2 cells)."
      />
    </Card>
  </div>
);

export default CharacterSetSection;
