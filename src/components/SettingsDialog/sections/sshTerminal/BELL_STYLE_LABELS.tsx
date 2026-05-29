import type { SectionProps } from "./types";
import React from "react";
import { BellStyles, TaskbarFlashModes } from "../../../../types/settings/settings";
import {
  Bell,
  Volume2,
  VolumeX,
  Hash,
  Timer,
  Clock,
  Flag,
  AppWindow,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import { SettingsSubGroupHeader as SubGroupHeader } from "../../../ui/settings/NetworkPrimitives";

const BELL_STYLE_LABELS: Record<string, string> = {
  none: "None (disabled)",
  system: "System default",
  visual: "Visual bell (flash terminal)",
  "flash-window": "Flash window",
  "pc-speaker": "Beep using PC speaker",
};

const BellSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Bell className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.bellSettings", "Bell Settings")}
    />
    <Card>
      <SettingsSelectRow
        settingKey="bellStyle"
        icon={<Bell size={16} />}
        label={t("settings.sshTerminal.bellStyle", "Bell style")}
        value={cfg.bellStyle}
        onChange={(v) => up({ bellStyle: v as typeof cfg.bellStyle })}
        options={BellStyles.map((s) => ({
          value: s,
          label: BELL_STYLE_LABELS[s] || s,
        }))}
        infoTooltip="How the terminal bell is signaled — visually, audibly, or via a system notification."
      />

      <SubGroupHeader
        icon={
          cfg.bellOveruseProtection.enabled ? (
            <VolumeX size={11} />
          ) : (
            <Volume2 size={11} />
          )
        }
        label={t("settings.sshTerminal.bellOveruse", "Bell overuse protection")}
      />

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
        icon={<VolumeX size={16} />}
        label={t(
          "settings.sshTerminal.enableBellOveruse",
          "Enable bell overuse protection",
        )}
        description={t(
          "settings.sshTerminal.bellOveruseDesc",
          "Silence the bell if it rings too frequently",
        )}
        infoTooltip="Silences the bell temporarily when it triggers too many times in a short window."
      />

      <div
        className={`flex flex-col gap-2.5 ${
          cfg.bellOveruseProtection.enabled
            ? ""
            : "opacity-50 pointer-events-none"
        }`}
      >
        <SettingsNumberRow
          settingKey="maxBells"
          icon={<Hash size={16} />}
          label={t("settings.sshTerminal.maxBells", "Max bells")}
          value={cfg.bellOveruseProtection.maxBells}
          min={1}
          max={100}
          onChange={(v) =>
            up({
              bellOveruseProtection: {
                ...cfg.bellOveruseProtection,
                maxBells: v,
              },
            })
          }
          infoTooltip="Number of bell rings within the time window before overuse protection kicks in."
        />
        <SettingsNumberRow
          settingKey="timeWindow"
          icon={<Timer size={16} />}
          label={t("settings.sshTerminal.timeWindow", "Time window")}
          value={cfg.bellOveruseProtection.timeWindowSeconds}
          min={1}
          max={60}
          unit="s"
          onChange={(v) =>
            up({
              bellOveruseProtection: {
                ...cfg.bellOveruseProtection,
                timeWindowSeconds: v,
              },
            })
          }
          infoTooltip="Sliding window in seconds used to count bell rings."
        />
        <SettingsNumberRow
          settingKey="silenceDuration"
          icon={<Clock size={16} />}
          label={t(
            "settings.sshTerminal.silenceDuration",
            "Silence duration",
          )}
          value={cfg.bellOveruseProtection.silenceDurationSeconds}
          min={1}
          max={300}
          unit="s"
          onChange={(v) =>
            up({
              bellOveruseProtection: {
                ...cfg.bellOveruseProtection,
                silenceDurationSeconds: v,
              },
            })
          }
          infoTooltip="How long the bell stays silenced after overuse is detected."
        />
      </div>

      <SubGroupHeader
        icon={<Flag size={11} />}
        label={t("settings.sshTerminal.windowAlerts", "Window alerts")}
      />

      <Toggle
        checked={cfg.blinkWindowOnActivity}
        onChange={(v) => up({ blinkWindowOnActivity: v })}
        icon={<AppWindow size={16} />}
        label={t(
          "settings.sshTerminal.blinkOnActivity",
          "Blink window on activity",
        )}
        description={t(
          "settings.sshTerminal.blinkOnActivityDesc",
          "Flash the taskbar when SSH output arrives while the window is not focused",
        )}
        infoTooltip="Flash the taskbar entry when SSH output arrives while the window is not in focus."
      />

      <SettingsSelectRow
        settingKey="taskbarFlash"
        icon={<Flag size={16} />}
        label={t("settings.sshTerminal.taskbarFlash", "Taskbar flashing")}
        value={cfg.taskbarFlash}
        onChange={(v) =>
          up({ taskbarFlash: v as typeof cfg.taskbarFlash })
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
        infoTooltip="Style of taskbar flash used to notify of activity in an unfocused terminal."
      />
    </Card>
  </div>
);

export { BellSection };
export default BELL_STYLE_LABELS;
