import type { SectionProps } from "./types";
import React from "react";
import {
  Monitor,
  History,
  ArrowDownToLine,
  Keyboard,
  Copy,
  ClipboardPaste,
  Type,
  MousePointer2,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
  SettingsTextRow,
} from "../../../ui/settings/SettingsPrimitives";
import { SettingsSubGroupHeader as SubGroupHeader } from "../../../ui/settings/NetworkPrimitives";

const ScrollbackSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Monitor className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.scrollback", "Scrollback & Selection")}
    />
    <Card>
      <SettingsNumberRow
        settingKey="scrollbackLines"
        icon={<History size={16} />}
        label={t("settings.sshTerminal.scrollbackLines", "Scrollback lines")}
        value={cfg.scrollbackLines}
        min={100}
        max={100000}
        step={100}
        onChange={(v) => up({ scrollbackLines: v })}
        infoTooltip="Maximum number of lines kept in the scrollback buffer. Higher values use more memory."
      />
      <Toggle
        checked={cfg.scrollOnOutput}
        onChange={(v) => up({ scrollOnOutput: v })}
        icon={<ArrowDownToLine size={16} />}
        label={t("settings.sshTerminal.scrollOnOutput", "Scroll on output")}
        description={t(
          "settings.sshTerminal.scrollOnOutputDesc",
          "Automatically scroll to bottom when new output appears",
        )}
        infoTooltip="Automatically scroll the terminal to the bottom whenever new output is received from the remote host."
      />
      <Toggle
        checked={cfg.scrollOnKeystroke}
        onChange={(v) => up({ scrollOnKeystroke: v })}
        icon={<Keyboard size={16} />}
        label={t(
          "settings.sshTerminal.scrollOnKeystroke",
          "Scroll on keystroke",
        )}
        description={t(
          "settings.sshTerminal.scrollOnKeystrokeDesc",
          "Automatically scroll to bottom when typing",
        )}
        infoTooltip="Automatically scroll the terminal to the bottom when you start typing."
      />

      <SubGroupHeader icon={<MousePointer2 size={11} />} label="Selection" />

      <Toggle
        checked={cfg.copyOnSelect}
        onChange={(v) => up({ copyOnSelect: v })}
        icon={<Copy size={16} />}
        label={t("settings.sshTerminal.copyOnSelect", "Copy on select")}
        description={t(
          "settings.sshTerminal.copyOnSelectDesc",
          "Automatically copy selected text to clipboard",
        )}
        infoTooltip="Automatically copy text to the clipboard as soon as you select it in the terminal."
      />
      <Toggle
        checked={cfg.pasteOnRightClick}
        onChange={(v) => up({ pasteOnRightClick: v })}
        icon={<ClipboardPaste size={16} />}
        label={t(
          "settings.sshTerminal.pasteOnRightClick",
          "Paste on right-click",
        )}
        description={t(
          "settings.sshTerminal.pasteOnRightClickDesc",
          "Paste clipboard content when right-clicking",
        )}
        infoTooltip="Paste clipboard content into the terminal when you right-click, instead of showing a context menu."
      />
      <SettingsTextRow
        settingKey="wordSeparators"
        icon={<Type size={16} />}
        label={t("settings.sshTerminal.wordSeparators", "Word separators")}
        value={cfg.wordSeparators}
        onChange={(v) => up({ wordSeparators: v })}
        placeholder={' !"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~'}
        infoTooltip="Characters that define word boundaries when double-clicking to select text in the terminal."
      />
    </Card>
  </div>
);

export default ScrollbackSection;
