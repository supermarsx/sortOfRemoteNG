import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Card } from "../../ui/settings/SettingsPrimitives";
import {
  getMemoryWatchdog,
  type MemoryWatchdogSnapshot,
} from "../../../utils/debug/memoryWatchdog";

/**
 * Live readout of the memory watchdog, rendered under the threshold controls
 * so the numbers above have context.
 *
 * Refresh strategy: the watchdog has no multi-listener subscription — the only
 * callback (`onStatusChange`) is a single config slot owned by
 * `MemoryWatchdogController`, and it fires only on pressure transitions, so it
 * would never report the normal state a user tuning thresholds wants to see.
 * This component therefore polls `getSnapshot()`, which is a synchronous read
 * of `performance.memory` that records no heap history and launches no native
 * probe. Polling is capped at 1s, runs only while this component is mounted
 * (the Advanced tab is unmounted when another tab is active), skips ticks while
 * the document is hidden, and skips `setState` when nothing visible changed —
 * so an idle panel does not re-render, and a changed one re-renders only this
 * subtree, never the settings page.
 */
const STATS_REFRESH_MS = 1000;

interface Readout {
  running: boolean;
  heapAvailable: boolean;
  severity: MemoryWatchdogSnapshot["severity"];
  source: MemoryWatchdogSnapshot["source"];
  usedMb: number;
  limitMb: number;
  heapPct: number;
  trend: MemoryWatchdogSnapshot["stats"]["trend"];
  growthRateMbPerSec: number;
  intervalMs: number;
  systemUsedPct: number | null;
  systemUsedGb: number | null;
  systemTotalGb: number | null;
  warningMb: number;
  criticalMb: number;
  killMb: number;
  systemWarningPct: number;
  systemKillPct: number;
  windowLabel: string;
}

function toReadout(snapshot: MemoryWatchdogSnapshot): Readout {
  const { stats, thresholds } = snapshot;
  return {
    running: snapshot.running,
    heapAvailable: snapshot.heapAvailable,
    severity: snapshot.severity,
    source: snapshot.source,
    usedMb: stats.usedMb,
    limitMb: stats.limitMb,
    heapPct: stats.heapPct,
    trend: stats.trend,
    growthRateMbPerSec: stats.growthRateMbPerSec,
    intervalMs: thresholds.intervalMs,
    systemUsedPct: stats.system ? stats.system.usedPct : null,
    systemUsedGb: stats.system ? stats.system.usedGb : null,
    systemTotalGb: stats.system ? stats.system.totalGb : null,
    warningMb: thresholds.warningMb,
    criticalMb: thresholds.criticalMb,
    killMb: thresholds.killMb,
    systemWarningPct: thresholds.systemWarningPct,
    systemKillPct: thresholds.systemKillPct,
    windowLabel: thresholds.windowLabel,
  };
}

/**
 * Compares every rendered field. The sample timestamp is deliberately not
 * rendered or compared: it changes on every tick and would force a repaint per
 * second even when no measured value moved.
 */
function sameReadout(a: Readout | null, b: Readout | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.running === b.running &&
    a.heapAvailable === b.heapAvailable &&
    a.severity === b.severity &&
    a.source === b.source &&
    a.usedMb === b.usedMb &&
    a.limitMb === b.limitMb &&
    a.heapPct === b.heapPct &&
    a.trend === b.trend &&
    a.growthRateMbPerSec === b.growthRateMbPerSec &&
    a.intervalMs === b.intervalMs &&
    a.systemUsedPct === b.systemUsedPct &&
    a.systemUsedGb === b.systemUsedGb &&
    a.systemTotalGb === b.systemTotalGb &&
    a.warningMb === b.warningMb &&
    a.criticalMb === b.criticalMb &&
    a.killMb === b.killMb &&
    a.systemWarningPct === b.systemWarningPct &&
    a.systemKillPct === b.systemKillPct &&
    a.windowLabel === b.windowLabel
  );
}

function readSnapshot(): Readout | null {
  const watchdog = getMemoryWatchdog();
  if (!watchdog) return null;
  try {
    return toReadout(watchdog.getSnapshot());
  } catch {
    return null;
  }
}

function formatMb(value: number): string {
  return `${value.toFixed(1)} MB`;
}

function formatGrowth(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} MB/s`;
}

const SEVERITY_LABEL: Record<Readout["severity"], string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
  pressure: "Pressure",
};

const SEVERITY_CLASS: Record<Readout["severity"], string> = {
  normal: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  critical: "bg-error/20 text-error",
  pressure: "bg-error/30 text-error",
};

/** One label / value / "against its threshold" line. */
const StatRow: React.FC<{
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  testId?: string;
}> = ({ label, value, detail, testId }) => (
  <div className="flex items-start justify-between gap-4 py-1">
    <span className="text-xs text-[var(--color-textSecondary)] shrink-0">
      {label}
    </span>
    <span className="min-w-0 text-right">
      <span
        className="block font-mono text-xs text-[var(--color-text)]"
        data-testid={testId}
      >
        {value}
      </span>
      {detail ? (
        <span className="block text-[11px] text-[var(--color-textSecondary)]">
          {detail}
        </span>
      ) : null}
    </span>
  </div>
);

/** Threshold ticks over the used/limit bar; purely presentational. */
const HeapBar: React.FC<{ readout: Readout }> = ({ readout }) => {
  const scaleMb = Math.max(readout.limitMb, readout.killMb, readout.usedMb, 1);
  const pct = (mb: number) => Math.min(100, Math.max(0, (mb / scaleMb) * 100));
  const fillClass =
    readout.usedMb >= readout.killMb
      ? "bg-error"
      : readout.usedMb >= readout.criticalMb
        ? "bg-error/70"
        : readout.usedMb >= readout.warningMb
          ? "bg-warning"
          : "bg-primary";

  return (
    <div
      className="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-[var(--color-border)]"
      aria-hidden="true"
    >
      <div
        className={`h-full rounded ${fillClass}`}
        style={{ width: `${pct(readout.usedMb)}%` }}
      />
      {[readout.warningMb, readout.criticalMb, readout.killMb].map((mb) => (
        <span
          key={mb}
          className="absolute top-0 h-full w-px bg-[var(--color-textSecondary)]"
          style={{ left: `${pct(mb)}%` }}
        />
      ))}
    </div>
  );
};

export const MemoryWatchdogStats: React.FC = () => {
  const [readout, setReadout] = useState<Readout | null>(() => readSnapshot());
  const readoutRef = useRef<Readout | null>(readout);

  const refresh = useCallback(() => {
    const next = readSnapshot();
    if (sameReadout(readoutRef.current, next)) return;
    readoutRef.current = next;
    setReadout(next);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      refresh();
    };
    const timer = setInterval(tick, STATS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const running = readout?.running ?? false;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <Activity size={16} className="text-primary" />
          Current stats
        </span>
        <span className="flex items-center gap-2">
          {running && readout ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASS[readout.severity]}`}
              data-testid="memory-watchdog-severity"
            >
              {SEVERITY_LABEL[readout.severity]}
            </span>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh memory stats"
            className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
            data-testid="memory-watchdog-refresh"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </span>
      </div>

      {!running || !readout ? (
        <p
          className="text-xs text-[var(--color-textSecondary)]"
          data-testid="memory-watchdog-stats-idle"
        >
          The memory watchdog is not running in this window, so there are no
          live values to show. Enable it above; the readout populates on the
          next sample.
        </p>
      ) : (
        <div
          className="divide-y divide-[var(--color-border)]"
          data-testid="memory-watchdog-stats"
        >
          <div className="pb-1">
            <StatRow
              label="JS heap"
              testId="memory-watchdog-heap"
              value={
                readout.heapAvailable
                  ? `${formatMb(readout.usedMb)} / ${formatMb(readout.limitMb)} limit (${readout.heapPct}%)`
                  : "unavailable in this runtime"
              }
              detail={
                readout.heapAvailable
                  ? `Warning ${readout.warningMb} MB · Critical ${readout.criticalMb} MB · Pressure ${readout.killMb} MB`
                  : "performance.memory is not exposed here, so heap thresholds cannot fire."
              }
            />
            {readout.heapAvailable ? <HeapBar readout={readout} /> : null}
          </div>

          <StatRow
            label="System RAM"
            testId="memory-watchdog-system"
            value={
              readout.systemUsedPct === null
                ? "unavailable"
                : `${readout.systemUsedPct}% (${readout.systemUsedGb} GB / ${readout.systemTotalGb} GB)`
            }
            detail={
              readout.systemUsedPct === null
                ? "No system sample delivered yet; the native probe may be unavailable."
                : `Warning ${readout.systemWarningPct}% · Pressure ${readout.systemKillPct}%`
            }
          />

          <StatRow
            label="Trend"
            testId="memory-watchdog-trend"
            value={
              readout.heapAvailable
                ? `${readout.trend} (${formatGrowth(readout.growthRateMbPerSec)})`
                : "unavailable in this runtime"
            }
            detail={`Pressure source: ${readout.source}`}
          />

          <StatRow
            label="Window"
            testId="memory-watchdog-window"
            value={readout.windowLabel}
            detail={`Sampled every ${readout.intervalMs} ms`}
          />
        </div>
      )}
    </Card>
  );
};

export default MemoryWatchdogStats;
