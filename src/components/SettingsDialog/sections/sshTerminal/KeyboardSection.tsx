import Toggle from "./Toggle";
import React from "react";
import { Keyboard } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";

const KeyboardSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.keyboard", "Keyboard")}
    icon={<Keyboard className="w-4 h-4 text-cyan-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.disableKeypadMode}
      onChange={(v) => up({ disableKeypadMode: v })}
      label={t(
        "settings.sshTerminal.disableKeypadMode",
        "Disable keypad application mode",
      )}
      description={t(
        "settings.sshTerminal.disableKeypadModeDesc",
        "Force numeric keypad to always send numbers",
      )}
    />
    <Toggle
      checked={cfg.disableApplicationCursorKeys}
      onChange={(v) => up({ disableApplicationCursorKeys: v })}
      label={t(
        "settings.sshTerminal.disableAppCursorKeys",
        "Disable application cursor keys",
      )}
      description={t(
        "settings.sshTerminal.disableAppCursorKeysDesc",
        "Force cursor keys to always send ANSI sequences",
      )}
    />
  </SettingsCollapsibleSection>
);

export default KeyboardSection;
