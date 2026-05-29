import type { SectionProps } from "./types";
import React from "react";
import {
  Type,
  Bold,
  Italic,
  Maximize2,
  AlignVerticalSpaceAround,
  MoveHorizontal,
  CaseSensitive,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsTextRow,
  SettingsNumberRow,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const FontSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Type className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.font", "Font Configuration")}
    />
    <Card>
      <Toggle
        checked={cfg.useCustomFont}
        onChange={(v) => up({ useCustomFont: v })}
        icon={<CaseSensitive size={16} />}
        label={t("settings.sshTerminal.useCustomFont", "Use custom font")}
        description={t(
          "settings.sshTerminal.useCustomFontDesc",
          "Override default terminal font settings — specify a custom font family, size, weight, and style",
        )}
        infoTooltip="Override the default terminal font with a custom family, size, weight, and style."
      />

      <div
        className={`flex flex-col gap-2.5 ${
          cfg.useCustomFont ? "" : "opacity-50 pointer-events-none"
        }`}
      >
        <SettingsTextRow
          settingKey="fontFamily"
          icon={<Type size={16} />}
          label={t("settings.sshTerminal.fontFamily", "Font family")}
          value={cfg.font.family}
          onChange={(v) => up({ font: { ...cfg.font, family: v } })}
          placeholder="Consolas, Monaco, monospace"
          infoTooltip="CSS font family stack used for the terminal — use monospace fonts for best results."
        />
        <SettingsNumberRow
          settingKey="fontSize"
          icon={<Maximize2 size={16} />}
          label={t("settings.sshTerminal.fontSize", "Font size")}
          value={cfg.font.size}
          min={8}
          max={48}
          unit="px"
          onChange={(v) => up({ font: { ...cfg.font, size: v } })}
          infoTooltip="Font size in pixels for the terminal text."
        />
        <SettingsSelectRow
          settingKey="fontWeight"
          icon={<Bold size={16} />}
          label={t("settings.sshTerminal.fontWeight", "Font weight")}
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
          infoTooltip="Font weight — controls how bold or light the terminal text appears."
        />
        <SettingsSelectRow
          settingKey="fontStyle"
          icon={<Italic size={16} />}
          label={t("settings.sshTerminal.fontStyle", "Font style")}
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
          infoTooltip="Font style — normal, italic, or oblique."
        />
        <SettingsNumberRow
          settingKey="lineHeight"
          icon={<AlignVerticalSpaceAround size={16} />}
          label={t("settings.sshTerminal.lineHeight", "Line height")}
          value={cfg.font.lineHeight}
          min={0.8}
          max={3}
          step={0.1}
          onChange={(v) => up({ font: { ...cfg.font, lineHeight: v } })}
          infoTooltip="Multiplier applied to font size to determine line height."
        />
        <SettingsNumberRow
          settingKey="letterSpacing"
          icon={<MoveHorizontal size={16} />}
          label={t("settings.sshTerminal.letterSpacing", "Letter spacing")}
          value={cfg.font.letterSpacing}
          min={-5}
          max={10}
          step={0.5}
          unit="px"
          onChange={(v) => up({ font: { ...cfg.font, letterSpacing: v } })}
          infoTooltip="Extra horizontal spacing between characters in pixels."
        />
      </div>
    </Card>
  </div>
);

export default FontSection;
