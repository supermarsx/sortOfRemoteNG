import Toggle from "./Toggle";
import React from "react";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";

const LineHandlingSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineHandling", "Line Handling")}
    icon={<Type className="w-4 h-4 text-blue-400" />}
  >
    <Toggle
      checked={cfg.implicitCrInLf}
      onChange={(v) => up({ implicitCrInLf: v })}
      label={t(
        "settings.sshTerminal.implicitCrInLf",
        "Implicit CR in every LF",
      )}
      description={t(
        "settings.sshTerminal.implicitCrInLfDesc",
        "Automatically add carriage return when receiving line feed",
      )}
    />
    <Toggle
      checked={cfg.implicitLfInCr}
      onChange={(v) => up({ implicitLfInCr: v })}
      label={t(
        "settings.sshTerminal.implicitLfInCr",
        "Implicit LF in every CR",
      )}
      description={t(
        "settings.sshTerminal.implicitLfInCrDesc",
        "Automatically add line feed when receiving carriage return",
      )}
    />
    <Toggle
      checked={cfg.autoWrap}
      onChange={(v) => up({ autoWrap: v })}
      label={t("settings.sshTerminal.autoWrap", "Auto wrap mode")}
      description={t(
        "settings.sshTerminal.autoWrapDesc",
        "Automatically wrap text at terminal edge",
      )}
    />
  </SettingsCollapsibleSection>
);

export default LineHandlingSection;
