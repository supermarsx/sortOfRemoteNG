import type { SectionProps } from "./types";
import React from "react";
import { Keyboard, Hash, ArrowUpDown } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const KeyboardSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Keyboard className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.keyboard", "Keyboard")}
    />
    <Card>
      <Toggle
        checked={cfg.disableKeypadMode}
        onChange={(v) => up({ disableKeypadMode: v })}
        icon={<Hash size={16} />}
        label={t(
          "settings.sshTerminal.disableKeypadMode",
          "Disable keypad application mode",
        )}
        description={t(
          "settings.sshTerminal.disableKeypadModeDesc",
          "Force numeric keypad to always send numbers",
        )}
        infoTooltip="Prevent the remote host from switching the numeric keypad into application mode. Keys will always send numeric values."
      />
      <Toggle
        checked={cfg.disableApplicationCursorKeys}
        onChange={(v) => up({ disableApplicationCursorKeys: v })}
        icon={<ArrowUpDown size={16} />}
        label={t(
          "settings.sshTerminal.disableAppCursorKeys",
          "Disable application cursor keys",
        )}
        description={t(
          "settings.sshTerminal.disableAppCursorKeysDesc",
          "Force cursor keys to always send ANSI sequences",
        )}
        infoTooltip="Prevent the remote host from switching cursor keys into application mode. Arrow keys will always send standard ANSI escape sequences."
      />
    </Card>
  </div>
);

export default KeyboardSection;
