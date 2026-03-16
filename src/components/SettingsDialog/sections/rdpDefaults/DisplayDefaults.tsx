import { inputClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import { selectClass, RESOLUTION_PRESETS } from "./selectClass";
import React from "react";
import { Monitor } from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const DisplayDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const currentW = rdp.defaultWidth ?? 1920;
  const currentH = rdp.defaultHeight ?? 1080;
  const matchedPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === currentW && p.h === currentH,
  );
  const selectedValue = matchedPreset
    ? `${matchedPreset.w}x${matchedPreset.h}`
    : "custom";

  return (
    <div className="sor-settings-card">
      <h4 className="sor-section-heading">
        <Monitor className="w-4 h-4 text-primary" />
        Display Defaults
      </h4>

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Resolution <InfoTooltip text="The screen resolution used when opening a new RDP connection." />
        </label>
        <Select value={selectedValue} onChange={(v: string) => {
            if (v === "custom") return;
            const [w, h] = v.split("x").map(Number);
            update({ defaultWidth: w, defaultHeight: h });
          }} options={[...RESOLUTION_PRESETS.map((p) => ({ value: `${p.w}x${p.h}`, label: p.label })), { value: 'custom', label: 'Custom...' }]} className={selectClass} />
      </div>

      {selectedValue === "custom" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Width <InfoTooltip text="Custom horizontal resolution in pixels for the remote desktop." />
            </label>
            <NumberInput value={currentW} onChange={(v: number) => update({
                  defaultWidth: v,
                })} className="inputClass" min={640} max={7680} />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Height <InfoTooltip text="Custom vertical resolution in pixels for the remote desktop." />
            </label>
            <NumberInput value={currentH} onChange={(v: number) => update({
                  defaultHeight: v,
                })} className="inputClass" min={480} max={4320} />
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Color Depth <InfoTooltip text="The number of bits used per pixel for color rendering. Higher values produce better color fidelity." />
        </label>
        <Select value={rdp.defaultColorDepth ?? 32} onChange={(v: string) => update({
              defaultColorDepth: parseInt(v) as 16 | 24 | 32,
            })} options={[{ value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="selectClass" />
      </div>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={rdp.smartSizing ?? true} onChange={(v: boolean) => update({ smartSizing: v })} />
        <span className="sor-toggle-label">
          Smart Sizing (scale remote desktop to fit window) <InfoTooltip text="Scales the remote desktop image to fit the local window without changing the remote resolution." />
        </span>
      </label>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={rdp.resizeToWindow ?? true} onChange={(v: boolean) => update({ resizeToWindow: v })} />
        <span className="sor-toggle-label">
          Resize to Window (dynamically match window dimensions) <InfoTooltip text="Dynamically adjusts the remote desktop resolution to match the local window size when resized." />
        </span>
      </label>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={rdp.lossyCompression ?? true} onChange={(v: boolean) => update({ lossyCompression: v })} />
        <span className="sor-toggle-label">
          Lossy Compression (reduce bandwidth) <InfoTooltip text="Enables lossy image compression to reduce bandwidth usage at the cost of minor visual artifacts." />
        </span>
      </label>
    </div>
  );
};

export default DisplayDefaults;
