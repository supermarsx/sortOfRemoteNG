import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Settings2 } from "lucide-react";
import { TextInput, FormField } from "../../../ui/forms";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";

const MiscSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.misc", "Miscellaneous")}
    icon={
      <Settings2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
    }
    defaultOpen={false}
  >
    <FormField label={t("settings.sshTerminal.answerback", "Answerback String")}>
      <TextInput
        value={cfg.answerbackString}
        onChange={(v) => up({ answerbackString: v })}
        placeholder="Optional terminal identification string"
      />
    </FormField>
    <Toggle
      checked={cfg.localPrinting}
      onChange={(v) => up({ localPrinting: v })}
      label={t(
        "settings.sshTerminal.localPrinting",
        "Enable local printing",
      )}
      description={t(
        "settings.sshTerminal.localPrintingDesc",
        "Allow print commands from terminal",
      )}
    />
    <Toggle
      checked={cfg.remoteControlledPrinting}
      onChange={(v) => up({ remoteControlledPrinting: v })}
      label={t(
        "settings.sshTerminal.remotePrinting",
        "Enable remote-controlled printing",
      )}
      description={t(
        "settings.sshTerminal.remotePrintingDesc",
        "Allow remote host to trigger printing",
      )}
    />
  </SettingsCollapsibleSection>
);

export default MiscSection;
