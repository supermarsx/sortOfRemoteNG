import React from "react";
import { MemoryStick } from "lucide-react";
import {
  normalizeTerminalBufferingSettings,
  type TerminalBufferingSettings,
} from "../../../../types/ssh/terminalBuffering";
import { Select } from "../../../ui/forms/Select";
import {
  Card,
  SettingsNumberRow,
  SettingsSectionHeader,
} from "../../../ui/settings/SettingsPrimitives";
import type { SectionProps } from "./types";

const OutputBufferSection: React.FC<SectionProps> = ({ cfg, up, t }) => {
  const buffer = normalizeTerminalBufferingSettings(cfg.outputBuffer);
  const updateBuffer = (updates: Partial<TerminalBufferingSettings>) => {
    up({
      outputBuffer: normalizeTerminalBufferingSettings({
        ...buffer,
        ...updates,
      }),
    });
  };
  const modeLabel = t("settings.sshTerminal.outputBuffer.mode", "Buffer mode");

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<MemoryStick className="w-4 h-4 text-primary" />}
        title={t(
          "settings.sshTerminal.outputBuffer.title",
          "Output replay buffer",
        )}
      />
      <p className="text-xs text-[var(--color-textSecondary)]">
        {t(
          "settings.sshTerminal.outputBuffer.description",
          "Global policy for all SSH sessions. Native output replay history is measured in MiB and is separate from xterm scrollback lines. Buffers grow as output arrives; these limits do not preallocate memory.",
        )}
      </p>
      <Card>
        <div className="sor-settings-select-row">
          <span className="sor-settings-row-label">{modeLabel}</span>
          <Select
            label={modeLabel}
            value={buffer.mode}
            onChange={(mode) =>
              updateBuffer({ mode: mode === "fixed" ? "fixed" : "adaptive" })
            }
            options={[
              {
                value: "adaptive",
                label: t(
                  "settings.sshTerminal.outputBuffer.adaptive",
                  "Adaptive",
                ),
              },
              {
                value: "fixed",
                label: t("settings.sshTerminal.outputBuffer.fixed", "Fixed"),
              },
            ]}
          />
        </div>
        {buffer.mode === "adaptive" ? (
          <>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "settings.sshTerminal.outputBuffer.adaptiveDescription",
                "Adaptive mode adjusts replay retention between the per-session minimum and maximum. The memory monitor influences the target as memory pressure changes.",
              )}
            </p>
            <SettingsNumberRow
              label={t(
                "settings.sshTerminal.outputBuffer.minMiB",
                "Minimum per session (MiB)",
              )}
              value={buffer.minMiB}
              min={1}
              max={buffer.maxMiB}
              step={1}
              onChange={(minMiB) => updateBuffer({ minMiB })}
            />
            <SettingsNumberRow
              label={t(
                "settings.sshTerminal.outputBuffer.maxMiB",
                "Maximum per session (MiB)",
              )}
              value={buffer.maxMiB}
              min={1}
              max={100}
              step={1}
              onChange={(maxMiB) => updateBuffer({ maxMiB })}
            />
          </>
        ) : (
          <SettingsNumberRow
            label={t(
              "settings.sshTerminal.outputBuffer.fixedMiB",
              "Fixed target per session (MiB)",
            )}
            description={t(
              "settings.sshTerminal.outputBuffer.fixedDescription",
              "The fixed target is still subject to memory safety pressure and the shared budget cap.",
            )}
            value={buffer.fixedMiB}
            min={1}
            max={100}
            step={1}
            onChange={(fixedMiB) => updateBuffer({ fixedMiB })}
          />
        )}
        <SettingsNumberRow
          label={t(
            "settings.sshTerminal.outputBuffer.totalMiB",
            "Shared budget (MiB)",
          )}
          description={t(
            "settings.sshTerminal.outputBuffer.sharedDescription",
            "Total replay-history cap across all SSH sessions (16–1024 MiB). With many sessions, the shared cap takes priority over the per-session minimum or fixed target.",
          )}
          value={buffer.totalMiB}
          min={16}
          max={1024}
          step={1}
          onChange={(totalMiB) => updateBuffer({ totalMiB })}
        />
      </Card>
    </div>
  );
};

export default OutputBufferSection;
