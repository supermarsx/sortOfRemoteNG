import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { Monitor } from "lucide-react";
import { TextInput, FormField } from "../../../ui/forms";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput } from "../../../ui/forms";

const ScrollbackSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.scrollback", "Scrollback & Selection")}
    icon={<Monitor className="w-4 h-4 text-text-muted" />}
    defaultOpen={false}
  >
    <FormField label={t("settings.sshTerminal.scrollbackLines", "Scrollback Lines")}>
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
      label={t("settings.sshTerminal.scrollOnOutput", "Scroll on output")}
      description={t(
        "settings.sshTerminal.scrollOnOutputDesc",
        "Automatically scroll to bottom when new output appears",
      )}
    />
    <Toggle
      checked={cfg.scrollOnKeystroke}
      onChange={(v) => up({ scrollOnKeystroke: v })}
      label={t(
        "settings.sshTerminal.scrollOnKeystroke",
        "Scroll on keystroke",
      )}
      description={t(
        "settings.sshTerminal.scrollOnKeystrokeDesc",
        "Automatically scroll to bottom when typing",
      )}
    />
    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <Toggle
        checked={cfg.copyOnSelect}
        onChange={(v) => up({ copyOnSelect: v })}
        label={t("settings.sshTerminal.copyOnSelect", "Copy on select")}
        description={t(
          "settings.sshTerminal.copyOnSelectDesc",
          "Automatically copy selected text to clipboard",
        )}
      />
      <Toggle
        checked={cfg.pasteOnRightClick}
        onChange={(v) => up({ pasteOnRightClick: v })}
        label={t(
          "settings.sshTerminal.pasteOnRightClick",
          "Paste on right-click",
        )}
        description={t(
          "settings.sshTerminal.pasteOnRightClickDesc",
          "Paste clipboard content when right-clicking",
        )}
      />
      <div className="mt-3">
        <FormField label={t(
            "settings.sshTerminal.wordSeparators",
            "Word Separators (for double-click selection)",
          )}>
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
