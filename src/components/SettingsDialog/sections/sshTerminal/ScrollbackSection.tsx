import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Monitor } from "lucide-react";
import { TextInput, FormField } from "../../../ui/forms";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const ScrollbackSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.scrollback", "Scrollback & Selection")}
    icon={<Monitor className="w-4 h-4 text-text-muted" />}
    defaultOpen={false}
  >
    <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.scrollbackLines", "Scrollback Lines")} <InfoTooltip text="Maximum number of lines kept in the scrollback buffer. Higher values use more memory." /></span>}>
      <NumberInput
        value={cfg.scrollbackLines}
        onChange={(v) => up({ scrollbackLines: v })}
        min={100}
        max={100000}
        step={100}
      />
    </FormField>
    <Toggle
      checked={cfg.scrollOnOutput}
      onChange={(v) => up({ scrollOnOutput: v })}
      label={<span className="flex items-center gap-1">{t("settings.sshTerminal.scrollOnOutput", "Scroll on output")} <InfoTooltip text="Automatically scroll the terminal to the bottom whenever new output is received from the remote host." /></span>}
      description={t(
        "settings.sshTerminal.scrollOnOutputDesc",
        "Automatically scroll to bottom when new output appears",
      )}
    />
    <Toggle
      checked={cfg.scrollOnKeystroke}
      onChange={(v) => up({ scrollOnKeystroke: v })}
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.scrollOnKeystroke",
        "Scroll on keystroke",
      )} <InfoTooltip text="Automatically scroll the terminal to the bottom when you start typing." /></span>}
      description={t(
        "settings.sshTerminal.scrollOnKeystrokeDesc",
        "Automatically scroll to bottom when typing",
      )}
    />
    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <Toggle
        checked={cfg.copyOnSelect}
        onChange={(v) => up({ copyOnSelect: v })}
        label={<span className="flex items-center gap-1">{t("settings.sshTerminal.copyOnSelect", "Copy on select")} <InfoTooltip text="Automatically copy text to the clipboard as soon as you select it in the terminal." /></span>}
        description={t(
          "settings.sshTerminal.copyOnSelectDesc",
          "Automatically copy selected text to clipboard",
        )}
      />
      <Toggle
        checked={cfg.pasteOnRightClick}
        onChange={(v) => up({ pasteOnRightClick: v })}
        label={<span className="flex items-center gap-1">{t(
          "settings.sshTerminal.pasteOnRightClick",
          "Paste on right-click",
        )} <InfoTooltip text="Paste clipboard content into the terminal when you right-click, instead of showing a context menu." /></span>}
        description={t(
          "settings.sshTerminal.pasteOnRightClickDesc",
          "Paste clipboard content when right-clicking",
        )}
      />
      <div className="mt-3">
        <FormField label={<span className="flex items-center gap-1">{t(
            "settings.sshTerminal.wordSeparators",
            "Word Separators (for double-click selection)",
          )} <InfoTooltip text="Characters that define word boundaries when double-clicking to select text in the terminal." /></span>}>
          <TextInput
            value={cfg.wordSeparators}
            onChange={(v) => up({ wordSeparators: v })}
            placeholder={' !"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~'}
          />
        </FormField>
      </div>
    </div>
  </SettingsCollapsibleSection>
);

export default ScrollbackSection;
