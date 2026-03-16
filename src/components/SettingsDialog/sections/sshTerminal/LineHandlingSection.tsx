import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const LineHandlingSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineHandling", "Line Handling")}
    icon={<Type className="w-4 h-4 text-primary" />}
  >
    <Toggle
      checked={cfg.implicitCrInLf}
      onChange={(v) => up({ implicitCrInLf: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.implicitCrInLf",
        "Implicit CR in every LF",
      )} <InfoTooltip text="Automatically insert a carriage return when a line feed is received. Needed for some legacy systems." /></span>}
      description={t(
        "settings.sshTerminal.implicitCrInLfDesc",
        "Automatically add carriage return when receiving line feed",
      )}
    />
    <Toggle
      checked={cfg.implicitLfInCr}
      onChange={(v) => up({ implicitLfInCr: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.implicitLfInCr",
        "Implicit LF in every CR",
      )} <InfoTooltip text="Automatically insert a line feed when a carriage return is received. Useful for certain mainframe protocols." /></span>}
      description={t(
        "settings.sshTerminal.implicitLfInCrDesc",
        "Automatically add line feed when receiving carriage return",
      )}
    />
    <Toggle
      checked={cfg.autoWrap}
      onChange={(v) => up({ autoWrap: v })}
      label={<span className="flex items-center gap-1">{t("settings.sshTerminal.autoWrap", "Auto wrap mode")} <InfoTooltip text="Automatically wrap text to the next line when it reaches the right edge of the terminal." /></span>}
      description={t(
        "settings.sshTerminal.autoWrapDesc",
        "Automatically wrap text at terminal edge",
      )}
    />
  </SettingsCollapsibleSection>
);

export default LineHandlingSection;
