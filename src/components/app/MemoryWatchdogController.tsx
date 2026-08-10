"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MemoryWatchdogSettings } from "../../types/settings/settings";
import {
  startMemoryWatchdog,
  stopMemoryWatchdog,
  type MemoryWatchdogOwner,
  type MemoryWatchdogStatus,
} from "../../utils/debug/memoryWatchdog";

interface MemoryWatchdogControllerProps {
  settings: MemoryWatchdogSettings;
  /** Tests and explicit roots may override the current Tauri window label. */
  windowLabel?: string;
}

function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label || "main";
  } catch {
    return "main";
  }
}

/**
 * Owns one watchdog for the current React/Tauri window and renders its
 * non-destructive pressure alert inside the existing React tree.
 */
export const MemoryWatchdogController: React.FC<
  MemoryWatchdogControllerProps
> = ({ settings, windowLabel }) => {
  const owner = useRef<MemoryWatchdogOwner>(
    Symbol("react-memory-watchdog-owner"),
  ).current;
  const resolvedWindowLabel = useMemo(
    () => windowLabel || currentWindowLabel(),
    [windowLabel],
  );
  const [pressureStatus, setPressureStatus] =
    useState<MemoryWatchdogStatus | null>(null);
  const dismissedStatusRef = useRef<string | null>(null);

  const handleStatus = useCallback((status: MemoryWatchdogStatus) => {
    if (status.severity === "recovered") {
      dismissedStatusRef.current = null;
      setPressureStatus(null);
      return;
    }
    const statusKey = `${status.severity}:${status.source}`;
    if (dismissedStatusRef.current !== statusKey) {
      setPressureStatus(status);
    }
  }, []);

  useEffect(() => {
    if (!settings.enabled) {
      stopMemoryWatchdog(undefined, owner);
      dismissedStatusRef.current = null;
      setPressureStatus(null);
      return;
    }

    const isDetached = resolvedWindowLabel !== "main";
    const detached = settings.detached;
    startMemoryWatchdog(
      {
        intervalMs: settings.intervalMs,
        warningMb: isDetached
          ? (detached?.heapWarningMb ?? settings.heapWarningMb)
          : settings.heapWarningMb,
        criticalMb: isDetached
          ? (detached?.heapCriticalMb ?? settings.heapCriticalMb)
          : settings.heapCriticalMb,
        killMb: isDetached
          ? (detached?.heapKillMb ?? settings.heapKillMb)
          : settings.heapKillMb,
        systemWarningPct: settings.systemWarningPct,
        systemKillPct: settings.systemKillPct,
        windowLabel: resolvedWindowLabel,
        onStatusChange: handleStatus,
      },
      owner,
    );
  }, [handleStatus, owner, resolvedWindowLabel, settings]);

  useEffect(() => () => stopMemoryWatchdog(undefined, owner), [owner]);

  if (!pressureStatus) return null;

  return (
    <aside
      data-testid="memory-pressure-alert"
      data-window-label={pressureStatus.windowLabel}
      role="alert"
      aria-live="assertive"
      className="fixed bottom-3 right-3 z-[2147483646] w-[min(360px,calc(100vw-24px))] rounded-lg border border-red-500 bg-[var(--color-surface)] p-4 text-sm shadow-2xl"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-red-400">
            {pressureStatus.severity === "pressure"
              ? "Memory pressure detected"
              : pressureStatus.severity === "critical"
                ? "Memory usage is critical"
                : "Memory usage is elevated"}
          </div>
          <div className="mt-1 text-xs text-[var(--color-textMuted)]">
            Window: {pressureStatus.windowLabel}; source:{" "}
            {pressureStatus.source}
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss memory warning"
          className="sor-btn sor-btn-ghost min-h-0 px-2 py-1"
          onClick={() => {
            dismissedStatusRef.current = `${pressureStatus.severity}:${pressureStatus.source}`;
            setPressureStatus(null);
          }}
        >
          ×
        </button>
      </div>
      <div className="space-y-1 font-mono text-xs">
        <div>
          JS heap: {pressureStatus.stats.usedMb} MB /{" "}
          {pressureStatus.stats.limitMb} MB
        </div>
        {pressureStatus.stats.system && (
          <div>
            System RAM: {pressureStatus.stats.system.usedPct}% ({" "}
            {pressureStatus.stats.system.usedGb} GB /{" "}
            {pressureStatus.stats.system.totalGb} GB)
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--color-textMuted)]">
        Active connections remain untouched. Reduce load or reload this window
        when it is safe to do so.
      </p>
      <button
        type="button"
        className="sor-btn sor-btn-primary mt-3 px-3 py-1.5 text-xs"
        onClick={() => window.location.reload()}
      >
        Reload window
      </button>
    </aside>
  );
};
