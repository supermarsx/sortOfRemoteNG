import React from "react";
import { Diff, Info } from "lucide-react";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";

/**
 * Delta-verified backups: skip emitting a backup when the canonical
 * payload hash hasn't changed since the previous successful run, with
 * a count-based safety valve so retention rotation doesn't stall.
 *
 * Logically separate from `DifferentialSection` — that one controls
 * block-level full-vs-delta inside an emitted backup. This one
 * decides whether a tick produces an emission at all.
 */
const DeltaSkipSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const forceN = mgr.backup.forceEmitEveryNSkippedTicks ?? 7;

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

      <div className="sor-settings-card">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(mgr.backup.deltaSkipEnabled)}
          onChange={(e) =>
            mgr.updateBackup({ deltaSkipEnabled: e.target.checked })
          }
          className="sor-settings-checkbox mt-0.5"
        />
        <span>
          <span className="text-[var(--color-text)]">
            Skip emitting unchanged backups
          </span>
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            Compares a SHA-256 hash of the pre-encryption payload to the
            previous successful run's hash, per destination.
          </p>
        </span>
      </label>

      <div
        className={`pl-6 space-y-2 transition-opacity ${
          mgr.backup.deltaSkipEnabled
            ? "opacity-100"
            : "opacity-50 pointer-events-none"
        }`}
      >
        <label className="block text-xs text-[var(--color-textSecondary)]">
          Force a backup after this many consecutive skips
          <InfoTooltip text="Safety valve so a long stretch of unchanged ticks doesn't void the retention rotation. 0 disables forcing — skip indefinitely." />
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={365}
            value={forceN}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return;
              const parsed = Number.parseInt(raw, 10);
              if (Number.isNaN(parsed) || parsed < 0) return;
              mgr.updateBackup({ forceEmitEveryNSkippedTicks: parsed });
            }}
            className="sor-settings-input text-sm w-24"
            disabled={!mgr.backup.deltaSkipEnabled}
          />
          <span className="text-xs text-[var(--color-textMuted)]">
            ticks {forceN === 0 ? "(never force)" : ""}
          </span>
        </div>
        <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1">
          <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            On a daily schedule, the default {7} means at least one
            guaranteed backup per week even when nothing has changed.
            Per-destination — a destination that failed last tick is
            recovered automatically without waiting for this counter.
          </span>
        </p>
      </div>
      </div>
    </div>
  );
};

export default DeltaSkipSection;
