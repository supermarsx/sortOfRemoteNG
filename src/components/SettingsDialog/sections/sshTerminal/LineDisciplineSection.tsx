import type { SectionProps } from "./types";
import React from "react";
import { LocalEchoModes, LineEditingModes } from "../../../../types/settings/settings";
import { Keyboard, Volume2, Edit3 } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const echoLabel = (m: string) =>
  m === "auto" ? "Auto (let server decide)" : m === "on" ? "Force On" : "Force Off";

const LineDisciplineSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Keyboard className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.lineDiscipline", "Line Discipline")}
    />
    <Card>
      <SettingsSelectRow
        settingKey="localEcho"
        icon={<Volume2 size={16} />}
        label={t("settings.sshTerminal.localEcho", "Local echo")}
        value={cfg.localEcho}
        onChange={(v) => up({ localEcho: v as typeof cfg.localEcho })}
        options={LocalEchoModes.map((m) => ({ value: m, label: echoLabel(m) }))}
        infoTooltip="Controls whether typed characters are echoed locally. Auto lets the server decide; Force On always echoes."
      />
      <SettingsSelectRow
        settingKey="localLineEditing"
        icon={<Edit3 size={16} />}
        label={t("settings.sshTerminal.localLineEditing", "Local line editing")}
        value={cfg.localLineEditing}
        onChange={(v) =>
          up({ localLineEditing: v as typeof cfg.localLineEditing })
        }
        options={LineEditingModes.map((m) => ({ value: m, label: echoLabel(m) }))}
        infoTooltip="Buffer input locally and send it all at once when Enter is pressed. Auto lets the server decide."
      />
    </Card>
  </div>
);

export default LineDisciplineSection;
