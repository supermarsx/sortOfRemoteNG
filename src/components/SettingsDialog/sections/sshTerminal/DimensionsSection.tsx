import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Terminal, LayoutGrid } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, FormField } from "../../../ui/forms";

const DimensionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.dimensions", "Terminal Dimensions")}
    icon={<LayoutGrid className="w-4 h-4 text-success" />}
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
        <FormField label={t("settings.sshTerminal.columns", "Columns")}>
          <NumberInput
            value={cfg.columns}
            onChange={(v) => up({ columns: v })}
            min={40}
            max={500}
          />
        </FormField>
        <FormField label={t("settings.sshTerminal.rows", "Rows")}>
          <NumberInput
            value={cfg.rows}
            onChange={(v) => up({ rows: v })}
            min={10}
            max={200}
          />
        </FormField>
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default DimensionsSection;
