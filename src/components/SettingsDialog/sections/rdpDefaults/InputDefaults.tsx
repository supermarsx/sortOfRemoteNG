import type { SectionProps } from "./selectClass";
import React from "react";
import { Mouse, Keyboard, Languages } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const InputDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Mouse className="w-4 h-4 text-primary" />}
      title="Input Defaults"
    />

    <Card>
      <SettingsSelectRow
        settingKey="mouseMode"
        icon={<Mouse size={16} />}
        label="Mouse mode"
        value={rdp.mouseMode ?? "absolute"}
        options={[
          { value: "absolute", label: "Absolute (real mouse position)" },
          { value: "relative", label: "Relative (virtual mouse delta)" },
        ]}
        onChange={(v) => update({ mouseMode: v as "relative" | "absolute" })}
        infoTooltip="Absolute mode sends exact cursor coordinates; relative mode sends movement deltas, useful for some remote applications."
      />

      <Toggle
        checked={rdp.autoDetectKeyboardLayout ?? true}
        onChange={(v) => update({ autoDetectKeyboardLayout: v })}
        icon={<Keyboard size={16} />}
        label="Auto-detect keyboard layout on connect"
        description="Apply the local keyboard layout when establishing a new session."
        infoTooltip="Automatically detects and applies the local keyboard layout when establishing a new connection."
      />

      <Toggle
        checked={rdp.enableUnicodeInput ?? true}
        onChange={(v) => update({ enableUnicodeInput: v })}
        icon={<Languages size={16} />}
        label="Enable Unicode keyboard input"
        description="Send keystrokes as Unicode for non-Latin scripts and special characters."
        infoTooltip="Sends keystrokes as Unicode characters, enabling support for non-Latin scripts and special characters."
      />
    </Card>
  </div>
);

export default InputDefaults;
