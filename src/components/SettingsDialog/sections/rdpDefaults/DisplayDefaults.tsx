import type { SectionProps } from "./selectClass";
import { RESOLUTION_PRESETS } from "./selectClass";
import React from "react";
import {
  Monitor,
  Minimize2,
  Palette,
  Maximize,
  ArrowLeftRight,
  ArrowUpDown,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

const DisplayDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const currentW = rdp.defaultWidth ?? 1920;
  const currentH = rdp.defaultHeight ?? 1080;
  const matchedPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === currentW && p.h === currentH,
  );
  const selectedValue = matchedPreset
    ? `${matchedPreset.w}x${matchedPreset.h}`
    : "custom";
  const scalingValue = rdp.resizeToWindow
    ? "resize"
    : rdp.smartSizing !== false
      ? "smart"
      : "none";

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Monitor className="w-4 h-4 text-primary" />}
        title="Display Defaults"
      />

      <Card>
        <SettingsSelectRow
          settingKey="defaultResolution"
          icon={<Maximize size={16} />}
          label="Default resolution"
          value={selectedValue}
          options={[
            ...RESOLUTION_PRESETS.map((p) => ({
              value: `${p.w}x${p.h}`,
              label: p.label,
            })),
            { value: "custom", label: "Custom…" },
          ]}
          onChange={(v) => {
            if (v === "custom") return;
            const [w, h] = v.split("x").map(Number);
            update({ defaultWidth: w, defaultHeight: h });
          }}
          infoTooltip="The screen resolution used when opening a new RDP connection."
        />

        {selectedValue === "custom" && (
          <>
            <SettingsNumberRow
              icon={<ArrowLeftRight size={16} />}
              label="Width"
              value={currentW}
              min={640}
              max={7680}
              unit="px"
              onChange={(v) => update({ defaultWidth: v })}
              infoTooltip="Custom horizontal resolution in pixels for the remote desktop."
            />
            <SettingsNumberRow
              icon={<ArrowUpDown size={16} />}
              label="Height"
              value={currentH}
              min={480}
              max={4320}
              unit="px"
              onChange={(v) => update({ defaultHeight: v })}
              infoTooltip="Custom vertical resolution in pixels for the remote desktop."
            />
          </>
        )}

        <SettingsSelectRow
          settingKey="defaultColorDepth"
          icon={<Palette size={16} />}
          label="Default color depth"
          value={String(rdp.defaultColorDepth ?? 32)}
          options={[
            { value: "16", label: "16-bit (High Color)" },
            { value: "24", label: "24-bit (True Color)" },
            { value: "32", label: "32-bit (True Color + Alpha)" },
          ]}
          onChange={(v) =>
            update({ defaultColorDepth: parseInt(v, 10) as 16 | 24 | 32 })
          }
          infoTooltip="The number of bits used per pixel for color rendering. Higher values produce better color fidelity."
        />

        <SettingsSelectRow
          settingKey="scalingMode"
          icon={<Maximize size={16} />}
          label="Scaling mode"
          value={scalingValue}
          options={[
            { value: "smart", label: "Smart Sizing (scale to fit)" },
            { value: "resize", label: "Resize to Window (dynamic resolution)" },
            { value: "none", label: "None (scrollbars if needed)" },
          ]}
          onChange={(v) => {
            if (v === "resize") {
              update({ resizeToWindow: true, smartSizing: false });
            } else if (v === "smart") {
              update({ resizeToWindow: false, smartSizing: true });
            } else {
              update({ resizeToWindow: false, smartSizing: false });
            }
          }}
          infoTooltip="How the remote desktop fits the local window. Smart Sizing scales a fixed resolution. Resize to Window dynamically changes the remote resolution. These are mutually exclusive."
        />

        <Toggle
          checked={rdp.lossyCompression ?? true}
          onChange={(v) => update({ lossyCompression: v })}
          icon={<Minimize2 size={16} />}
          label="Lossy compression"
          description="Trade minor visual fidelity for lower bandwidth."
          infoTooltip="Enables lossy image compression to reduce bandwidth usage at the cost of minor visual artifacts."
        />
      </Card>
    </div>
  );
};

export default DisplayDefaults;
