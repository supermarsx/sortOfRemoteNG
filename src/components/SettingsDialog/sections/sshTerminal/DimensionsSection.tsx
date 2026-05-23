import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Terminal, LayoutGrid } from "lucide-react";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, FormField } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const DimensionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<LayoutGrid className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.dimensions", "Terminal Dimensions")}
    />
    <div className="sor-settings-card">
    <Toggle
      checked={cfg.useCustomDimensions}
      onChange={(v) => up({ useCustomDimensions: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.useCustomDimensions",
        "Use custom dimensions",
      )} <InfoTooltip text="Override automatic terminal size detection and specify exact column and row counts." /></span>}
      description={t(
        "settings.sshTerminal.useCustomDimensionsDesc",
        "Override automatic terminal size detection",
      )}
    />
    {cfg.useCustomDimensions && (
      <div className="grid grid-cols-2 gap-4 mt-3 ml-10">
        <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.columns", "Columns")} <InfoTooltip text="Number of character columns in the terminal. Standard is 80." /></span>}>
          <NumberInput
            value={cfg.columns}
            onChange={(v) => up({ columns: v })}
            min={40}
            max={500}
          />
        </FormField>
        <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.rows", "Rows")} <InfoTooltip text="Number of character rows in the terminal. Standard is 24." /></span>}>
          <NumberInput
            value={cfg.rows}
            onChange={(v) => up({ rows: v })}
            min={10}
            max={200}
          />
        </FormField>
      </div>
    )}
    </div>
  </div>
);

export default DimensionsSection;
