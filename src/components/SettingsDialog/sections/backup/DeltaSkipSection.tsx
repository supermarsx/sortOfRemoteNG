import React from "react";
import { Diff, Info, FileCheck, Hash } from "lucide-react";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

/**
 * Delta-verified backups: skip emitting a backup when the canonical
 * payload hash hasn't changed since the previous successful run, with
 * a count-based safety valve so retention rotation doesn't stall.
 */
const DeltaSkipSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const forceN = mgr.backup.forceEmitEveryNSkippedTicks ?? 7;
  const enabled = Boolean(mgr.backup.deltaSkipEnabled);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Diff className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-2">
            Delta verification
            <InfoTooltip text="When on, the scheduled tick is skipped if the payload is byte-identical to the previous successful backup. Saves space on disk and in the cloud without changing retention." />
          </span>
        }
      />

      <Card>
        <Toggle
          icon={<FileCheck size={16} />}
          label="Skip emitting unchanged backups"
          description="Compares a SHA-256 hash of the pre-encryption payload to the previous successful run's hash, per destination."
          checked={enabled}
          onChange={(v) => mgr.updateBackup({ deltaSkipEnabled: v })}
          infoTooltip="If the canonical payload hasn't changed since the last successful run for a destination, the tick is a no-op for that destination."
        />

        <div
          className={
            enabled ? undefined : "opacity-50 pointer-events-none"
          }
        >
          <SettingsNumberRow
            icon={<Hash size={16} />}
            label="Force backup after N skips"
            value={forceN}
            min={0}
            max={365}
            unit="ticks"
            onChange={(v) =>
              mgr.updateBackup({ forceEmitEveryNSkippedTicks: v })
            }
            infoTooltip="Safety valve so a long stretch of unchanged ticks doesn't void the retention rotation. 0 disables forcing — skip indefinitely."
          />
          <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1 mt-1">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>
              {forceN === 0
                ? "Forcing disabled — destinations may go without a backup indefinitely if the payload never changes."
                : `On a daily schedule, ${forceN} means at least one guaranteed backup roughly every ${forceN} days even when nothing has changed. Per-destination — a destination that failed last tick is recovered automatically without waiting for this counter.`}
            </span>
          </p>
        </div>
      </Card>
    </div>
  );
};

export default DeltaSkipSection;
