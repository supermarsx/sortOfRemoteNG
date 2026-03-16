import type { SectionProps } from "./types";
import React from "react";
import { Clipboard, ShieldAlert } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ClipboardSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Clipboard className="w-4 h-4 text-warning" />}
      title="Clipboard"
    />
    <Card>
      <Toggle
        checked={s.copyOnSelect}
        onChange={(v) => u({ copyOnSelect: v })}
        icon={<Clipboard size={16} />}
        label="Copy on select"
        description="Selecting text in the terminal copies it to clipboard automatically"
        settingKey="copyOnSelect"
        infoTooltip="Automatically copy text to the clipboard as soon as you select it in the terminal, without needing to press Ctrl+C."
      />
      <Toggle
        checked={s.pasteOnRightClick}
        onChange={(v) => u({ pasteOnRightClick: v })}
        icon={<Clipboard size={16} />}
        label="Paste on right-click"
        description="Right-click inside the terminal pastes from clipboard"
        settingKey="pasteOnRightClick"
        infoTooltip="Right-clicking inside the terminal area will paste the current clipboard contents. When disabled, right-click opens a context menu instead."
      />
      <Toggle
        checked={s.trimPastedWhitespace}
        onChange={(v) => u({ trimPastedWhitespace: v })}
        icon={<Clipboard size={16} />}
        label="Trim whitespace from pasted text"
        description="Strip leading and trailing whitespace when pasting"
        settingKey="trimPastedWhitespace"
        infoTooltip="Remove leading and trailing spaces or newlines from clipboard text before pasting it into the terminal. Helps avoid accidental command execution."
      />
      <Toggle
        checked={s.warnOnMultiLinePaste}
        onChange={(v) => u({ warnOnMultiLinePaste: v })}
        icon={<ShieldAlert size={16} />}
        label="Warn before pasting multi-line text"
        description="Show a confirmation when pasting text that contains newlines"
        settingKey="warnOnMultiLinePaste"
        infoTooltip="Display a confirmation dialog when pasting text that contains newline characters, which could execute multiple commands at once."
      />
      <SliderRow
        label="Clear clipboard after paste"
        value={s.clearClipboardAfterSeconds}
        min={0}
        max={120}
        step={5}
        unit="s"
        onChange={(v) => u({ clearClipboardAfterSeconds: v })}
        settingKey="clearClipboardAfterSeconds"
        infoTooltip="Automatically clear the clipboard a set number of seconds after pasting a password. Set to 0 to disable this security feature."
      />
      <div className="text-[10px] text-[var(--color-textMuted)] pl-1">
        {s.clearClipboardAfterSeconds === 0
          ? "Disabled — clipboard is never cleared automatically"
          : `Clipboard will be cleared ${s.clearClipboardAfterSeconds}s after pasting a password`}
      </div>
      <SliderRow
        label="Max paste length"
        value={s.maxPasteLengthChars}
        min={0}
        max={100000}
        step={1000}
        unit=""
        onChange={(v) => u({ maxPasteLengthChars: v })}
        settingKey="maxPasteLengthChars"
        infoTooltip="Show a confirmation prompt before pasting text longer than this many characters. Set to 0 for no limit."
      />
      <div className="text-[10px] text-[var(--color-textMuted)] pl-1">
        {s.maxPasteLengthChars === 0
          ? "No limit — paste any amount of text"
          : `Prompt before pasting more than ${s.maxPasteLengthChars.toLocaleString()} characters`}
      </div>
    </Card>
  </div>
);

export default ClipboardSection;
