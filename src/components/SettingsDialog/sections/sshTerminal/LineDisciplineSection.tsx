import React from "react";
import { LocalEchoModes, LineEditingModes } from "../../../../types/settings";
import { Keyboard } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { Select } from "../../../ui/forms";

const LineDisciplineSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineDiscipline", "Line Discipline")}
    icon={<Keyboard className="w-4 h-4 text-purple-400" />}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Select
        value={cfg.localEcho}
        onChange={(v) =>
          up({ localEcho: v as typeof cfg.localEcho })
        }
        label={t("settings.sshTerminal.localEcho", "Local Echo")}
        options={LocalEchoModes.map((m) => ({
          value: m,
          label:
            m === "auto"
              ? "Auto (let server decide)"
              : m === "on"
                ? "Force On"
                : "Force Off",
        }))}
      />
      <Select
        value={cfg.localLineEditing}
        onChange={(v) =>
          up({
            localLineEditing: v as typeof cfg.localLineEditing,
          })
        }
        label={t(
          "settings.sshTerminal.localLineEditing",
          "Local Line Editing",
        )}
        options={LineEditingModes.map((m) => ({
          value: m,
          label:
            m === "auto"
              ? "Auto (let server decide)"
              : m === "on"
                ? "Force On"
                : "Force Off",
        }))}
      />
    </div>
  </SettingsCollapsibleSection>
);

export default LineDisciplineSection;
