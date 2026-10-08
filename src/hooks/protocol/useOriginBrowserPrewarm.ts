"use client";

import { useLayoutEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import { normalizeWebBrowserSettings } from "../../utils/settings/webBrowserSettings";

interface Options {
  appReady: boolean;
  settingsReady: boolean;
  locked: boolean;
  closing: { readonly current: boolean };
  connections: readonly Connection[];
  settings: GlobalSettings;
}

/** No session creation, owner unlock, URL, cookie or credential work. Native
 * independently authorizes the saved website and bounds startup to one attempt. */
export function useOriginBrowserPrewarm({
  appReady,
  settingsReady,
  locked,
  closing,
  connections,
  settings,
}: Options) {
  const attempted = useRef(false);
  let enabled = false;
  try {
    const config = normalizeWebBrowserSettings(settings.webBrowser);
    enabled = config.engine !== "legacy" && config.idlePrewarmEnabled !== false;
  } catch {
    // Malformed settings cannot opt into speculative native work.
  }

  useLayoutEffect(() => {
    if (!appReady || !settingsReady || locked || !enabled || !isTauri()) return;
    let nativeWindow: ReturnType<typeof getCurrentWindow>;
    try {
      nativeWindow = getCurrentWindow();
    } catch {
      return;
    }
    if (nativeWindow.label !== "main") return;
    const manager = DatabaseManager.getInstance();
    let disposed = false;
    let closingWindow = false;
    let cancelScheduled: (() => void) | undefined;
    let pendingNative = false;
    let ownerKey = "";

    const cancel = () => {
      cancelScheduled?.();
      cancelScheduled = undefined;
      ownerKey = "";
      if (pendingNative) {
        pendingNative = false;
        void invoke("origin_browser_cancel_prewarm").catch(() => {});
      }
    };
    const closingNow = () => disposed || closingWindow || closing.current;
    const refresh = () => {
      if (closingNow() || document.visibilityState === "hidden") {
        cancel();
        return;
      }
      try {
        const database = manager.getCurrentDatabase();
        if (!database) {
          cancel();
          return;
        }
        const connection = connections.find(
          (row) =>
            !row.isGroup &&
            (row.protocol === "http" || row.protocol === "https"),
        );
        if (!connection) {
          cancel();
          return;
        }
        const proof = manager.captureOriginBrowserOwnerProof(database.id);
        // Do not copy the native unlock token into a key, diagnostic or browser ID.
        const key = JSON.stringify([
          database.id,
          proof.expectedSecurityRevision,
          connection.id,
        ]);
        proof.assertCurrent();
        if (ownerKey === key) return;
        cancel();
        if (attempted.current) return;
        ownerKey = key;
        let cancelled = false;
        let idle: number | undefined;
        let frame: number | undefined;
        let idleChecks = 0;
        let timer: ReturnType<typeof setTimeout>;
        const start = () => {
          if (
            cancelled ||
            closingNow() ||
            document.visibilityState === "hidden" ||
            attempted.current
          )
            return;
          try {
            proof.assertCurrent();
          } catch {
            cancel();
            return;
          }
          attempted.current = true;
          pendingNative = true;
          // The native DTO has no URL, tab identity, settings overrides or consent.
          void invoke("origin_browser_prewarm", {
            request: {
              ownerDatabaseId: proof.ownerDatabaseId,
              connectionId: connection.id,
              expectedSecurityRevision: proof.expectedSecurityRevision,
              sourceSessionId: proof.sourceSessionId,
            },
          })
            .catch(() => {
              // Speculation is best effort; never deny shell startup or retry-loop.
            })
            .finally(() => {
              pendingNative = false;
            });
        };
        const scheduleIdle = () => {
          if (cancelled || closingNow()) return;
          if (typeof window.requestIdleCallback === "function") {
            idleChecks += 1;
            idle = window.requestIdleCallback(
              (deadline) => {
                idle = undefined;
                if (cancelled || closingNow()) return;
                // A busy initial window gets at most three idle opportunities.
                // Timeouts schedule another low-priority check, never startup.
                if (!deadline.didTimeout && deadline.timeRemaining() > 0)
                  start();
                else if (idleChecks < 3) timer = setTimeout(scheduleIdle, 500);
              },
              { timeout: 5_000 },
            );
          } else {
            // WKWebView may lack idle callbacks. Wait for a painted frame, then
            // yield a further task interval; never initialize inside animation.
            frame = window.requestAnimationFrame(() => {
              frame = undefined;
              if (!cancelled && !closingNow()) timer = setTimeout(start, 250);
            });
          }
        };
        timer = setTimeout(scheduleIdle, 2_000);
        cancelScheduled = () => {
          cancelled = true;
          clearTimeout(timer);
          if (idle !== undefined) window.cancelIdleCallback(idle);
          if (frame !== undefined) window.cancelAnimationFrame(frame);
        };
      } catch {
        // A locked/legacy/unavailable database is not an eligible saved owner.
        cancel();
      }
    };
    const close = () => {
      closingWindow = true;
      cancel();
    };
    const accessOff = onDatabaseAccessChange(() => {
      // A proof captured before an access transition must never survive it.
      cancel();
      refresh();
    });
    const databaseOff = manager.onCurrentDatabaseChange(() => {
      cancel();
      refresh();
    });
    const closeOff = nativeWindow.onCloseRequested(close).catch(() => () => {});
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", close);
    refresh();
    return () => {
      disposed = true;
      cancel();
      accessOff();
      databaseOff();
      void closeOff.then((off) => off()).catch(() => {});
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", close);
    };
  }, [appReady, settingsReady, locked, enabled, closing, connections]);
}
