import Toggle from "./Toggle";
import React from "react";
import { Type } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select } from "../../../ui/forms";

const FontSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.font", "Font Configuration")}
    icon={<Type className="w-4 h-4 text-pink-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.useCustomFont}
      onChange={(v) => up({ useCustomFont: v })}
      label={t("settings.sshTerminal.useCustomFont", "Use custom font")}
      description={t(
        "settings.sshTerminal.useCustomFontDesc",
        "Override default terminal font settings",
      )}
    />
    {cfg.useCustomFont && (
      <div className="space-y-4 mt-3 ml-10">
        <TextInput
          value={cfg.font.family}
          onChange={(v) => up({ font: { ...cfg.font, family: v } })}
          label={t("settings.sshTerminal.fontFamily", "Font Family")}
          placeholder="Consolas, Monaco, monospace"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumberInput
            value={cfg.font.size}
            onChange={(v) => up({ font: { ...cfg.font, size: v } })}
            label={t("settings.sshTerminal.fontSize", "Size (px)")}
            min={8}
            max={48}
          />
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
            label={t("settings.sshTerminal.fontWeight", "Weight")}
            options={[
              { value: "lighter", label: "Lighter" },
              { value: "normal", label: "Normal" },
              { value: "bold", label: "Bold" },
              { value: "bolder", label: "Bolder" },
            ]}
          />
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
            label={t("settings.sshTerminal.fontStyle", "Style")}
            options={[
              { value: "normal", label: "Normal" },
              { value: "italic", label: "Italic" },
              { value: "oblique", label: "Oblique" },
            ]}
          />
          <NumberInput
            value={cfg.font.lineHeight}
            onChange={(v) => up({ font: { ...cfg.font, lineHeight: v } })}
            label={t("settings.sshTerminal.lineHeight", "Line Height")}
            min={0.8}
            max={3}
            step={0.1}
          />
        </div>
        <NumberInput
          value={cfg.font.letterSpacing}
          onChange={(v) =>
            up({ font: { ...cfg.font, letterSpacing: v } })
          }
          label={t(
            "settings.sshTerminal.letterSpacing",
            "Letter Spacing (px)",
          )}
          min={-5}
          max={10}
          step={0.5}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default FontSection;
