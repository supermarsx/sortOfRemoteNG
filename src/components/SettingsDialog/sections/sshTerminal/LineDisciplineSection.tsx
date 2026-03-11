import type { SectionProps } from "./types";
import React from "react";
import { LocalEchoModes, LineEditingModes } from "../../../../types/settings/settings";
import { Keyboard } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { Select, FormField } from "../../../ui/forms";

const LineDisciplineSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineDiscipline", "Line Discipline")}
    icon={<Keyboard className="w-4 h-4 text-accent" />}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label={t("settings.sshTerminal.localEcho", "Local Echo")}>
        <Select
          value={cfg.localEcho}
          onChange={(v) =>
            up({ localEcho: v as typeof cfg.localEcho })
          }
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
      </FormField>
      <FormField label={t(
          "settings.sshTerminal.localLineEditing",
          "Local Line Editing",
        )}>
        <Select
          value={cfg.localLineEditing}
          onChange={(v) =>
            up({
              localLineEditing: v as typeof cfg.localLineEditing,
            })
          }
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
      </FormField>
    </div>
  </SettingsCollapsibleSection>
);

export default LineDisciplineSection;
