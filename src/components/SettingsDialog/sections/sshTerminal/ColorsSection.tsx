import type { SectionProps } from "./types";
import React from "react";
import { Palette, Paintbrush, Layers, Droplet } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const ColorsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Palette className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.colors", "Color Settings")}
    />
    <Card>
      <Toggle
        checked={cfg.allowTerminalAnsiColors}
        onChange={(v) => up({ allowTerminalAnsiColors: v })}
        icon={<Paintbrush size={16} />}
        label={t(
          "settings.sshTerminal.allowAnsi",
          "Allow terminal to specify ANSI colors",
        )}
        description={t(
          "settings.sshTerminal.allowAnsiDesc",
          "Let remote applications set the 16 standard colors",
        )}
        infoTooltip="Let remote applications set the 16 standard ANSI colors used in the terminal palette."
      />
      <Toggle
        checked={cfg.allowXterm256Colors}
        onChange={(v) => up({ allowXterm256Colors: v })}
        icon={<Layers size={16} />}
        label={t(
          "settings.sshTerminal.allowXterm256",
          "Allow xterm 256-color mode",
        )}
        description={t(
          "settings.sshTerminal.allowXterm256Desc",
          "Enable extended 256-color palette support",
        )}
        infoTooltip="Enable the extended 256-color palette for applications that support xterm color indexing."
      />
      <Toggle
        checked={cfg.allow24BitColors}
        onChange={(v) => up({ allow24BitColors: v })}
        icon={<Droplet size={16} />}
        label={t(
          "settings.sshTerminal.allow24Bit",
          "Allow 24-bit true colors",
        )}
        description={t(
          "settings.sshTerminal.allow24BitDesc",
          "Enable full RGB color support (16 million colors)",
        )}
        infoTooltip="Enable full RGB color support with 16 million colors for modern terminal applications."
      />
    </Card>
  </div>
);

export default ColorsSection;
