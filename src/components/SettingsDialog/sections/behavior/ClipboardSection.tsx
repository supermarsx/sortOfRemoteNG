import React from "react";
import { Clipboard, ShieldAlert } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ClipboardSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Clipboard className="w-4 h-4 text-amber-400" />}
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
      />
      <Toggle
        checked={s.pasteOnRightClick}
        onChange={(v) => u({ pasteOnRightClick: v })}
        icon={<Clipboard size={16} />}
        label="Paste on right-click"
        description="Right-click inside the terminal pastes from clipboard"
        settingKey="pasteOnRightClick"
      />
      <Toggle
        checked={s.trimPastedWhitespace}
        onChange={(v) => u({ trimPastedWhitespace: v })}
        icon={<Clipboard size={16} />}
        label="Trim whitespace from pasted text"
        description="Strip leading and trailing whitespace when pasting"
        settingKey="trimPastedWhitespace"
      />
      <Toggle
        checked={s.warnOnMultiLinePaste}
        onChange={(v) => u({ warnOnMultiLinePaste: v })}
        icon={<ShieldAlert size={16} />}
        label="Warn before pasting multi-line text"
        description="Show a confirmation when pasting text that contains newlines"
        settingKey="warnOnMultiLinePaste"
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
