"use client";

import { useEffect, useMemo, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  defaultTerminalBufferingSettings,
  normalizeTerminalBufferingSettings,
  type TerminalBufferingSettings,
} from "../../types/ssh/terminalBuffering";
import { getMemoryWatchdog } from "../../utils/debug/memoryWatchdog";

interface TerminalBufferControllerProps {
  settings?: TerminalBufferingSettings;
  /** Tests and explicit roots may override the current Tauri window label. */
  windowLabel?: string;
}

const REPORT_INTERVAL_MS = 5_000;
const INITIAL_RETRY_MS = 1_000;
// Leave room to renew native pressure before its 30-second expiry.
const MAX_RETRY_MS = 20_000;

function currentWindowLabel(): string | undefined {
  try {
    return getCurrentWindow().label;
  } catch {
    // An unidentified window must not publish the main window's policy.
    return undefined;
  }
}

/** Shares the existing watchdog's pressure with native SSH replay buffers. */
export function TerminalBufferController({
  settings,
  windowLabel,
}: TerminalBufferControllerProps) {
  const resolvedWindowLabel = useMemo(
    () => windowLabel ?? currentWindowLabel(),
    [windowLabel],
  );
  const { mode, minMiB, maxMiB, fixedMiB, totalMiB } =
    normalizeTerminalBufferingSettings(
      settings ?? defaultTerminalBufferingSettings,
    );
  const config = useMemo(
    () =>
      resolvedWindowLabel === "main"
        ? { mode, minMiB, maxMiB, fixedMiB, totalMiB }
        : undefined,
    [resolvedWindowLabel, mode, minMiB, maxMiB, fixedMiB, totalMiB],
  );
  const configRef = useRef(config);
  const requestReportRef = useRef<(() => void) | null>(null);
  // Survives effect cleanup/replay: Tauri calls cannot be cancelled, and a new
  // effect must wait for the old call even during React Strict Mode replay.
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    configRef.current = config;
    requestReportRef.current?.();
  }, [config]);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let busy = false;
    let dirty = false;
    let retryAt = 0;
    let retryDelay = INITIAL_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function clearScheduledReport() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    }

    function schedule(delay: number) {
      if (disposed) return;
      clearScheduledReport();
      timer = setTimeout(() => {
        timer = undefined;
        void report();
      }, delay);
    }

    async function report() {
      if (disposed || busy) return;
      clearScheduledReport();
      if (retryAt > Date.now()) {
        schedule(retryAt - Date.now());
        return;
      }

      busy = true;
      await inFlightRef.current;
      if (disposed) return;

      dirty = false;
      const startedAt = Date.now();
      let failed = false;
      const flight = Promise.resolve()
        .then(async () => {
          if (disposed) return;
          const snapshot = getMemoryWatchdog()?.getSnapshot();
          const pressure = snapshot?.running ? snapshot.severity : "normal";
          const policy = configRef.current;
          await invoke<void>("configure_terminal_buffering", {
            ...(policy ? { config: policy } : {}),
            pressure,
          });
        })
        .catch(() => {
          // Native failures may contain sensitive details; retry silently.
          failed = true;
        });
      inFlightRef.current = flight;
      await flight;
      busy = false;
      if (disposed) return;

      if (failed) {
        retryAt = Date.now() + retryDelay;
        schedule(retryDelay);
        retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
      } else {
        retryAt = 0;
        retryDelay = INITIAL_RETRY_MS;
        schedule(
          dirty ? 0 : Math.max(0, startedAt + REPORT_INTERVAL_MS - Date.now()),
        );
      }
    }

    requestReportRef.current = () => {
      dirty = true;
      void report();
    };
    void report();

    return () => {
      disposed = true;
      requestReportRef.current = null;
      clearScheduledReport();
      // Let native pressure expire. A final normal report could race an
      // uncancellable call or a replacement controller's pressure report.
    };
  }, []);

  return null;
}
