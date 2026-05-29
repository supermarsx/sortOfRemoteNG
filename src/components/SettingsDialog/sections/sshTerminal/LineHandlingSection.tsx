import type { SectionProps } from "./types";
import React from "react";
import { Type, CornerDownLeft, CornerDownRight, WrapText } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const LineHandlingSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Type className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.lineHandling", "Line Handling")}
    />
    <Card>
      <Toggle
        checked={cfg.implicitCrInLf}
        onChange={(v) => up({ implicitCrInLf: v })}
        icon={<CornerDownLeft size={16} />}
        label={t(
          "settings.sshTerminal.implicitCrInLf",
          "Implicit CR in every LF",
        )}
        description={t(
          "settings.sshTerminal.implicitCrInLfDesc",
          "Automatically add carriage return when receiving line feed",
        )}
        infoTooltip="Automatically insert a carriage return when a line feed is received. Needed for some legacy systems."
      />
      <Toggle
        checked={cfg.implicitLfInCr}
        onChange={(v) => up({ implicitLfInCr: v })}
        icon={<CornerDownRight size={16} />}
        label={t(
          "settings.sshTerminal.implicitLfInCr",
          "Implicit LF in every CR",
        )}
        description={t(
          "settings.sshTerminal.implicitLfInCrDesc",
          "Automatically add line feed when receiving carriage return",
        )}
        infoTooltip="Automatically insert a line feed when a carriage return is received. Useful for certain mainframe protocols."
      />
      <Toggle
        checked={cfg.autoWrap}
        onChange={(v) => up({ autoWrap: v })}
        icon={<WrapText size={16} />}
        label={t("settings.sshTerminal.autoWrap", "Auto wrap mode")}
        description={t(
          "settings.sshTerminal.autoWrapDesc",
          "Automatically wrap text at terminal edge",
        )}
        infoTooltip="Automatically wrap text to the next line when it reaches the right edge of the terminal."
      />
    </Card>
  </div>
);

export default LineHandlingSection;
