import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Mouse } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const InputDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Mouse className="w-4 h-4 text-warning" />
      Input Defaults
    </h4>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Mouse Mode <InfoTooltip text="Absolute mode sends exact cursor coordinates; relative mode sends movement deltas, useful for some remote applications." />
      </label>
      <Select value={rdp.mouseMode ?? "absolute"} onChange={(v: string) => update({
            mouseMode: v as "relative" | "absolute",
          })} options={[
            { value: "absolute", label: "Absolute (real mouse position)" },
            { value: "relative", label: "Relative (virtual mouse delta)" },
          ]} className={selectClass} />
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.autoDetectKeyboardLayout ?? true} onChange={(v: boolean) => update({ autoDetectKeyboardLayout: v })} />
      <span className="sor-toggle-label">Auto-detect keyboard layout on connect <InfoTooltip text="Automatically detects and applies the local keyboard layout when establishing a new connection." /></span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enableUnicodeInput ?? true} onChange={(v: boolean) => update({ enableUnicodeInput: v })} />
      <span className="sor-toggle-label">Enable Unicode keyboard input <InfoTooltip text="Sends keystrokes as Unicode characters, enabling support for non-Latin scripts and special characters." /></span>
    </label>
  </div>
);

export default InputDefaults;
