import type { SectionProps } from "./types";
import React from "react";
import { LayoutGrid, ArrowLeftRight, ArrowUpDown, Maximize2 } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

const DimensionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<LayoutGrid className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.dimensions", "Terminal Dimensions")}
    />
    <Card>
      <Toggle
        checked={cfg.useCustomDimensions}
        onChange={(v) => up({ useCustomDimensions: v })}
        icon={<Maximize2 size={16} />}
        label={t(
          "settings.sshTerminal.useCustomDimensions",
          "Use custom dimensions",
        )}
        description={t(
          "settings.sshTerminal.useCustomDimensionsDesc",
          "Override automatic terminal size detection",
        )}
        infoTooltip="Override automatic terminal size detection and specify exact column and row counts."
      />

      <div
        className={`flex flex-col gap-2.5 ${
          cfg.useCustomDimensions ? "" : "opacity-50 pointer-events-none"
        }`}
      >
        <SettingsNumberRow
          settingKey="columns"
          icon={<ArrowLeftRight size={16} />}
          label={t("settings.sshTerminal.columns", "Columns")}
          value={cfg.columns}
          min={40}
          max={500}
          onChange={(v) => up({ columns: v })}
          infoTooltip="Number of character columns in the terminal. Standard is 80."
        />
        <SettingsNumberRow
          settingKey="rows"
          icon={<ArrowUpDown size={16} />}
          label={t("settings.sshTerminal.rows", "Rows")}
          value={cfg.rows}
          min={10}
          max={200}
          onChange={(v) => up({ rows: v })}
          infoTooltip="Number of character rows in the terminal. Standard is 24."
        />
      </div>
    </Card>
  </div>
);

export default DimensionsSection;
