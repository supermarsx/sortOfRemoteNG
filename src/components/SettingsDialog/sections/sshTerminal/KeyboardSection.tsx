import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Keyboard } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const KeyboardSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.keyboard", "Keyboard")}
    icon={<Keyboard className="w-4 h-4 text-info" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.disableKeypadMode}
      onChange={(v) => up({ disableKeypadMode: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.disableKeypadMode",
        "Disable keypad application mode",
      )} <InfoTooltip text="Prevent the remote host from switching the numeric keypad into application mode. Keys will always send numeric values." /></span>}
      description={t(
        "settings.sshTerminal.disableKeypadModeDesc",
        "Force numeric keypad to always send numbers",
      )}
    />
    <Toggle
      checked={cfg.disableApplicationCursorKeys}
      onChange={(v) => up({ disableApplicationCursorKeys: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.disableAppCursorKeys",
        "Disable application cursor keys",
      )} <InfoTooltip text="Prevent the remote host from switching cursor keys into application mode. Arrow keys will always send standard ANSI escape sequences." /></span>}
      description={t(
        "settings.sshTerminal.disableAppCursorKeysDesc",
        "Force cursor keys to always send ANSI sequences",
      )}
    />
  </SettingsCollapsibleSection>
);

export default KeyboardSection;
