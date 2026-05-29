import type { SectionProps } from "./types";
import React from "react";
import { Settings2, Tag, Printer, PrinterCheck } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsTextRow,
} from "../../../ui/settings/SettingsPrimitives";

const MiscSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Settings2 className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.misc", "Miscellaneous")}
    />
    <Card>
      <SettingsTextRow
        settingKey="answerbackString"
        icon={<Tag size={16} />}
        label={t("settings.sshTerminal.answerback", "Answerback string")}
        value={cfg.answerbackString}
        onChange={(v) => up({ answerbackString: v })}
        placeholder="Optional terminal identification string"
        infoTooltip="Terminal identification string sent to the remote host in response to an ENQ character."
      />

      <Toggle
        checked={cfg.localPrinting}
        onChange={(v) => up({ localPrinting: v })}
        icon={<Printer size={16} />}
        label={t(
          "settings.sshTerminal.localPrinting",
          "Enable local printing",
        )}
        description={t(
          "settings.sshTerminal.localPrintingDesc",
          "Allow print commands from terminal",
        )}
        infoTooltip="Allow terminal escape sequences to trigger printing on the local system's printer."
      />

      <Toggle
        checked={cfg.remoteControlledPrinting}
        onChange={(v) => up({ remoteControlledPrinting: v })}
        icon={<PrinterCheck size={16} />}
        label={t(
          "settings.sshTerminal.remotePrinting",
          "Enable remote-controlled printing",
        )}
        description={t(
          "settings.sshTerminal.remotePrintingDesc",
          "Allow remote host to trigger printing",
        )}
        infoTooltip="Allow the remote host to initiate print jobs on your local printer through terminal escape sequences."
      />
    </Card>
  </div>
);

export default MiscSection;
