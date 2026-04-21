import type { SectionProps } from "./types";
/* eslint-disable react-refresh/only-export-components */
import Toggle from "./Toggle";
import React from "react";
import { BellStyles, TaskbarFlashModes } from "../../../../types/settings/settings";
import { Bell, Volume2, VolumeX } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select, FormField } from "../../../ui/forms";

const BELL_STYLE_LABELS: Record<string, string> = {
  none: "None (disabled)",
  system: "System default",
  visual: "Visual bell (flash terminal)",
  "flash-window": "Flash window",
  "pc-speaker": "Beep using PC speaker",
};

const BellSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.bellSettings", "Bell Settings")}
    icon={<Bell className="w-4 h-4 text-warning" />}
  >
    <FormField label={t("settings.sshTerminal.bellStyle", "Bell Style")}>
      <Select
        value={cfg.bellStyle}
        onChange={(v) =>
          up({ bellStyle: v as typeof cfg.bellStyle })
        }
        options={BellStyles.map((s) => ({
          value: s,
          label: BELL_STYLE_LABELS[s] || s,
        }))}
      />
    </FormField>

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <h5 className="text-sm font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
        {cfg.bellOveruseProtection.enabled ? (
          <VolumeX className="w-4 h-4 text-warning" />
        ) : (
          <Volume2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
        {t("settings.sshTerminal.bellOveruse", "Bell Overuse Protection")}
      </h5>
      <Toggle
        checked={cfg.bellOveruseProtection.enabled}
        onChange={(v) =>
          up({
            bellOveruseProtection: {
              ...cfg.bellOveruseProtection,
              enabled: v,
            },
          })
        }
        label={t(
          "settings.sshTerminal.enableBellOveruse",
          "Enable bell overuse protection",
        )}
        description={t(
          "settings.sshTerminal.bellOveruseDesc",
          "Silence the bell if it rings too frequently",
        )}
      />
      {cfg.bellOveruseProtection.enabled && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 ml-10">
          <FormField label={t("settings.sshTerminal.maxBells", "Max bells")}>
            <NumberInput
              value={cfg.bellOveruseProtection.maxBells}
              onChange={(v) =>
                up({
                  bellOveruseProtection: {
                    ...cfg.bellOveruseProtection,
                    maxBells: v,
                  },
                })
              }
              min={1}
              max={100}
            />
          </FormField>
          <FormField label={t(
              "settings.sshTerminal.timeWindow",
              "Time window (sec)",
            )}>
            <NumberInput
              value={cfg.bellOveruseProtection.timeWindowSeconds}
              onChange={(v) =>
                up({
                  bellOveruseProtection: {
                    ...cfg.bellOveruseProtection,
                    timeWindowSeconds: v,
                  },
                })
              }
              min={1}
              max={60}
            />
          </FormField>
          <FormField label={t(
              "settings.sshTerminal.silenceDuration",
              "Silence duration (sec)",
            )}>
            <NumberInput
              value={cfg.bellOveruseProtection.silenceDurationSeconds}
              onChange={(v) =>
                up({
                  bellOveruseProtection: {
                    ...cfg.bellOveruseProtection,
                    silenceDurationSeconds: v,
                  },
                })
              }
              min={1}
              max={300}
            />
          </FormField>
        </div>
      )}
    </div>

    <Toggle
      checked={cfg.blinkWindowOnActivity}
      onChange={(v) => up({ blinkWindowOnActivity: v })}
      label={t("settings.sshTerminal.blinkOnActivity", "Blink window on activity")}
      description={t("settings.sshTerminal.blinkOnActivityDesc", "Flash the taskbar when SSH output arrives while the window is not focused")}
    />

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <FormField label={t("settings.sshTerminal.taskbarFlash", "Taskbar Flashing")}>
        <Select
          value={cfg.taskbarFlash}
          onChange={(v) =>
            up({
              taskbarFlash: v as typeof cfg.taskbarFlash,
            })
          }
          options={TaskbarFlashModes.map((m) => ({
            value: m,
            label:
              m === "disabled"
                ? "Disabled"
                : m === "flashing"
                  ? "Flash until focused"
                  : "Steady highlight",
          }))}
        />
      </FormField>
    </div>
  </SettingsCollapsibleSection>
);

export { BellSection };
export default BELL_STYLE_LABELS;
