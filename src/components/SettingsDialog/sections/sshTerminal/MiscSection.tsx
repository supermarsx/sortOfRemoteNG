import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Settings2 } from "lucide-react";
import { TextInput, FormField } from "../../../ui/forms";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const MiscSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.misc", "Miscellaneous")}
    icon={
      <Settings2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
    }
    defaultOpen={false}
  >
    <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.answerback", "Answerback String")} <InfoTooltip text="Terminal identification string sent to the remote host in response to an ENQ character." /></span>}>
      <TextInput
        value={cfg.answerbackString}
        onChange={(v) => up({ answerbackString: v })}
        placeholder="Optional terminal identification string"
      />
    </FormField>
    <Toggle
      checked={cfg.localPrinting}
      onChange={(v) => up({ localPrinting: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.localPrinting",
        "Enable local printing",
      )} <InfoTooltip text="Allow terminal escape sequences to trigger printing on the local system's printer." /></span>}
      description={t(
        "settings.sshTerminal.localPrintingDesc",
        "Allow print commands from terminal",
      )}
    />
    <Toggle
      checked={cfg.remoteControlledPrinting}
      onChange={(v) => up({ remoteControlledPrinting: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.remotePrinting",
        "Enable remote-controlled printing",
      )} <InfoTooltip text="Allow the remote host to initiate print jobs on your local printer through terminal escape sequences." /></span>}
      description={t(
        "settings.sshTerminal.remotePrintingDesc",
        "Allow remote host to trigger printing",
      )}
    />
  </SettingsCollapsibleSection>
);

export default MiscSection;
