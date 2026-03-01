import Toggle from "./Toggle";
import React from "react";
import { Terminal, LayoutGrid } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput } from "../../../ui/forms";

const DimensionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.dimensions", "Terminal Dimensions")}
    icon={<LayoutGrid className="w-4 h-4 text-green-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.useCustomDimensions}
      onChange={(v) => up({ useCustomDimensions: v })}
      label={t(
        "settings.sshTerminal.useCustomDimensions",
        "Use custom dimensions",
      )}
      description={t(
        "settings.sshTerminal.useCustomDimensionsDesc",
        "Override automatic terminal size detection",
      )}
    />
    {cfg.useCustomDimensions && (
      <div className="grid grid-cols-2 gap-4 mt-3 ml-10">
        <NumberInput
          value={cfg.columns}
          onChange={(v) => up({ columns: v })}
          label={t("settings.sshTerminal.columns", "Columns")}
          min={40}
          max={500}
        />
        <NumberInput
          value={cfg.rows}
          onChange={(v) => up({ rows: v })}
          label={t("settings.sshTerminal.rows", "Rows")}
          min={10}
          max={200}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default DimensionsSection;
