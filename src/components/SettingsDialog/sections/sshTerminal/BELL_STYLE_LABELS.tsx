import Toggle from "./Toggle";
import React from "react";
import { BellStyles, TaskbarFlashModes } from "../../../../types/settings";
import { Bell, Volume2, VolumeX } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select } from "../../../ui/forms";

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
    icon={<Bell className="w-4 h-4 text-yellow-400" />}
  >
    <Select
      value={cfg.bellStyle}
      onChange={(v) =>
        up({ bellStyle: v as typeof cfg.bellStyle })
      }
      label={t("settings.sshTerminal.bellStyle", "Bell Style")}
      options={BellStyles.map((s) => ({
        value: s,
        label: BELL_STYLE_LABELS[s] || s,
      }))}
    />

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <h5 className="text-sm font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
        {cfg.bellOveruseProtection.enabled ? (
          <VolumeX className="w-4 h-4 text-orange-400" />
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
            label={t("settings.sshTerminal.maxBells", "Max bells")}
            min={1}
            max={100}
          />
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
            label={t(
              "settings.sshTerminal.timeWindow",
              "Time window (sec)",
            )}
            min={1}
            max={60}
          />
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
            label={t(
              "settings.sshTerminal.silenceDuration",
              "Silence duration (sec)",
            )}
            min={1}
            max={300}
          />
        </div>
      )}
    </div>

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <Select
        value={cfg.taskbarFlash}
        onChange={(v) =>
          up({
            taskbarFlash: v as typeof cfg.taskbarFlash,
          })
        }
        label={t("settings.sshTerminal.taskbarFlash", "Taskbar Flashing")}
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
    </div>
  </SettingsCollapsibleSection>
);

export default BELL_STYLE_LABELS;
