import { inputClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import { selectClass, RESOLUTION_PRESETS } from "./selectClass";
import React from "react";
import { Monitor } from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";

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
        <Monitor className="w-4 h-4 text-blue-400" />
        Display Defaults
      </h4>

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Resolution
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
              Width
            </label>
            <NumberInput value={currentW} onChange={(v: number) => update({
                  defaultWidth: v,
                })} className="inputClass" min={640} max={7680} />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Height
            </label>
            <NumberInput value={currentH} onChange={(v: number) => update({
                  defaultHeight: v,
                })} className="inputClass" min={480} max={4320} />
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Color Depth
        </label>
        <Select value={rdp.defaultColorDepth ?? 32} onChange={(v: string) => update({
              defaultColorDepth: parseInt(v) as 16 | 24 | 32,
            })} options={[{ value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="selectClass" />
      </div>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={rdp.smartSizing ?? true} onChange={(v: boolean) => update({ smartSizing: v })} />
        <span className="sor-toggle-label">
          Smart Sizing (scale remote desktop to fit window)
        </span>
      </label>
    </div>
  );
};

export default DisplayDefaults;
