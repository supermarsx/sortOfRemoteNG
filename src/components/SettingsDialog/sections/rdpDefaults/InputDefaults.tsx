import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Mouse, Keyboard, Languages } from "lucide-react";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const InputDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Mouse className="w-4 h-4 text-primary" />}
      title="Input Defaults"
    />

    <Card>
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Mouse Mode{" "}
          <InfoTooltip text="Absolute mode sends exact cursor coordinates; relative mode sends movement deltas, useful for some remote applications." />
        </label>
        <Select
          value={rdp.mouseMode ?? "absolute"}
          onChange={(v: string) =>
            update({ mouseMode: v as "relative" | "absolute" })
          }
          options={[
            { value: "absolute", label: "Absolute (real mouse position)" },
            { value: "relative", label: "Relative (virtual mouse delta)" },
          ]}
          className={selectClass}
        />
      </div>

      <Toggle
        checked={rdp.autoDetectKeyboardLayout ?? true}
        onChange={(v) => update({ autoDetectKeyboardLayout: v })}
        icon={<Keyboard size={16} />}
        label="Auto-detect keyboard layout on connect"
        description="Apply the local keyboard layout when establishing a new session"
        infoTooltip="Automatically detects and applies the local keyboard layout when establishing a new connection."
      />

      <Toggle
        checked={rdp.enableUnicodeInput ?? true}
        onChange={(v) => update({ enableUnicodeInput: v })}
        icon={<Languages size={16} />}
        label="Enable Unicode keyboard input"
        description="Send keystrokes as Unicode for non-Latin scripts and special characters"
        infoTooltip="Sends keystrokes as Unicode characters, enabling support for non-Latin scripts and special characters."
      />
    </Card>
  </div>
);

export default InputDefaults;
