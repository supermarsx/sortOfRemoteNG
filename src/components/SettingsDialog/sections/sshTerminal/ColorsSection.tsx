import Toggle from "./Toggle";
import React from "react";
import { Palette } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";

const ColorsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.colors", "Color Settings")}
    icon={<Palette className="w-4 h-4 text-orange-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.allowTerminalAnsiColors}
      onChange={(v) => up({ allowTerminalAnsiColors: v })}
      label={t(
        "settings.sshTerminal.allowAnsi",
        "Allow terminal to specify ANSI colors",
      )}
      description={t(
        "settings.sshTerminal.allowAnsiDesc",
        "Let remote applications set the 16 standard colors",
      )}
    />
    <Toggle
      checked={cfg.allowXterm256Colors}
      onChange={(v) => up({ allowXterm256Colors: v })}
      label={t(
        "settings.sshTerminal.allowXterm256",
        "Allow xterm 256-color mode",
      )}
      description={t(
        "settings.sshTerminal.allowXterm256Desc",
        "Enable extended 256-color palette support",
      )}
    />
    <Toggle
      checked={cfg.allow24BitColors}
      onChange={(v) => up({ allow24BitColors: v })}
      label={t(
        "settings.sshTerminal.allow24Bit",
        "Allow 24-bit true colors",
      )}
      description={t(
        "settings.sshTerminal.allow24BitDesc",
        "Enable full RGB color support (16 million colors)",
      )}
    />
  </SettingsCollapsibleSection>
);

export default ColorsSection;
