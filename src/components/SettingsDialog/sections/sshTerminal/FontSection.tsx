import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Type } from "lucide-react";
import { TextInput, FormField } from "../../../ui/forms";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const FontSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.font", "Font Configuration")}
    icon={<Type className="w-4 h-4 text-primary" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.useCustomFont}
      onChange={(v) => up({ useCustomFont: v })}
      label={t("settings.sshTerminal.useCustomFont", "Use custom font")}
      description={t(
        "settings.sshTerminal.useCustomFontDesc",
        "Override default terminal font settings — specify a custom font family, size, weight, and style",
      )}
    />
    {cfg.useCustomFont && (
      <div className="space-y-4 mt-3 ml-10">
        <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.fontFamily", "Font Family")} <InfoTooltip text="CSS font family stack used for the terminal — use monospace fonts for best results" /></span>}>
          <TextInput
            value={cfg.font.family}
            onChange={(v) => up({ font: { ...cfg.font, family: v } })}
            placeholder="Consolas, Monaco, monospace"
          />
        </FormField>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.fontSize", "Size (px)")} <InfoTooltip text="Font size in pixels for the terminal text" /></span>}>
            <NumberInput
              value={cfg.font.size}
              onChange={(v) => up({ font: { ...cfg.font, size: v } })}
              min={8}
              max={48}
            />
          </FormField>
          <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.fontWeight", "Weight")} <InfoTooltip text="Font weight — controls how bold or light the terminal text appears" /></span>}>
            <Select
              value={String(cfg.font.weight)}
              onChange={(v) =>
                up({
                  font: {
                    ...cfg.font,
                    weight:
                      v === "normal" ||
                      v === "bold" ||
                      v === "lighter" ||
                      v === "bolder"
                        ? v
                        : Number(v),
                  },
                })
              }
              options={[
                { value: "lighter", label: "Lighter" },
                { value: "normal", label: "Normal" },
                { value: "bold", label: "Bold" },
                { value: "bolder", label: "Bolder" },
              ]}
            />
          </FormField>
          <FormField label={t("settings.sshTerminal.fontStyle", "Style")}>
            <Select
              value={cfg.font.style}
              onChange={(v) =>
                up({
                  font: {
                    ...cfg.font,
                    style: v as typeof cfg.font.style,
                  },
                })
              }
              options={[
                { value: "normal", label: "Normal" },
                { value: "italic", label: "Italic" },
                { value: "oblique", label: "Oblique" },
              ]}
            />
          </FormField>
          <FormField label={t("settings.sshTerminal.lineHeight", "Line Height")}>
            <NumberInput
              value={cfg.font.lineHeight}
              onChange={(v) => up({ font: { ...cfg.font, lineHeight: v } })}
              min={0.8}
              max={3}
              step={0.1}
            />
          </FormField>
        </div>
        <FormField label={t(
            "settings.sshTerminal.letterSpacing",
            "Letter Spacing (px)",
          )}>
          <NumberInput
            value={cfg.font.letterSpacing}
            onChange={(v) =>
              up({ font: { ...cfg.font, letterSpacing: v } })
            }
            min={-5}
            max={10}
            step={0.5}
          />
        </FormField>
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default FontSection;
