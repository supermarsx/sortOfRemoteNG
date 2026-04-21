import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Palette } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const ColorsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.colors", "Color Settings")}
    icon={<Palette className="w-4 h-4 text-warning" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.allowTerminalAnsiColors}
      onChange={(v) => up({ allowTerminalAnsiColors: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.allowAnsi",
        "Allow terminal to specify ANSI colors",
      )} <InfoTooltip text="Let remote applications set the 16 standard ANSI colors used in the terminal palette." /></span>}
      description={t(
        "settings.sshTerminal.allowAnsiDesc",
        "Let remote applications set the 16 standard colors",
      )}
    />
    <Toggle
      checked={cfg.allowXterm256Colors}
      onChange={(v) => up({ allowXterm256Colors: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.allowXterm256",
        "Allow xterm 256-color mode",
      )} <InfoTooltip text="Enable the extended 256-color palette for applications that support xterm color indexing." /></span>}
      description={t(
        "settings.sshTerminal.allowXterm256Desc",
        "Enable extended 256-color palette support",
      )}
    />
    <Toggle
      checked={cfg.allow24BitColors}
      onChange={(v) => up({ allow24BitColors: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.allow24Bit",
        "Allow 24-bit true colors",
      )} <InfoTooltip text="Enable full RGB color support with 16 million colors for modern terminal applications." /></span>}
      description={t(
        "settings.sshTerminal.allow24BitDesc",
        "Enable full RGB color support (16 million colors)",
      )}
    />
  </SettingsCollapsibleSection>
);

export default ColorsSection;
