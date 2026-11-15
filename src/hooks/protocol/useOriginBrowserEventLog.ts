import { useEffect, useRef } from "react";
import type { OriginBrowserState } from "./useOriginBrowser";
import {
  browserHistoryStore,
  logBrowserEvent,
  logProxyEvent,
} from "../../utils/browser/browserEventLog";

export interface OriginBrowserEventLogOptions {
  connectionId: string;
  sessionId: string;
  connectionName?: string;
  /** Volatile tabs (Quick Connect) keep no browsing history. */
  private?: boolean;
}

/**
 * Feeds the Browser Logs/History views from a native browser's state. Only
 * redacted URLs (origin + path) and fixed classification text are recorded.
 */
export function useOriginBrowserEventLog(
  state: OriginBrowserState,
  options: OriginBrowserEventLogOptions,
) {
  const { connectionId, sessionId, connectionName } = options;
  const isPrivate = options.private === true;
  const last = useRef({
    url: "",
    sequence: -1,
    phase: "",
    loaded: false,
    failure: "",
    error: "",
    appPhase: "",
  });
  const snapshot = state.snapshot;
  const base = { connectionId, sessionId };

  useEffect(() => {
    const seen = last.current;
    if (seen.appPhase !== state.phase) {
      seen.appPhase = state.phase;
      if (state.phase !== "idle")
        logBrowserEvent({
          ...base,
          level: state.phase === "error" ? "error" : "info",
          type: "lifecycle",
          message: `Browser ${state.phase}`,
        });
    }
    const errorKey = state.error
      ? JSON.stringify([
          state.startupFailure?.stage,
          state.startupFailure?.category,
          state.operationFailure,
        ])
      : "";
    if (errorKey && errorKey !== seen.error) {
      const detail =
        state.startupFailure?.category ?? state.operationFailure ?? "unknown";
      logBrowserEvent({
        ...base,
        level: "error",
        type: "error",
        message: `Browser error (${detail})`,
      });
    }
    seen.error = errorKey;
    if (!snapshot || snapshot.sequence === seen.sequence) return;
    seen.sequence = snapshot.sequence;
    const url = snapshot.currentUrl || snapshot.displayUrl;
    if (url && url !== seen.url) {
      seen.url = url;
      seen.loaded = false;
      logBrowserEvent({
        ...base,
        level: "info",
        type: "navigation",
        message: "Navigated",
        url,
      });
    }
    if (snapshot.phase !== seen.phase) {
      seen.phase = snapshot.phase;
      logBrowserEvent({
        ...base,
        level: snapshot.phase === "failed" ? "error" : "info",
        type: "lifecycle",
        message: snapshot.failureReason
          ? `Native tab ${snapshot.phase} (${snapshot.failureReason})`
          : `Native tab ${snapshot.phase}`,
      });
    }
    const loaded = snapshot.documentLoaded === true && !snapshot.loading;
    if (loaded && !seen.loaded) {
      logBrowserEvent({
        ...base,
        level: "info",
        type: "load",
        message: snapshot.title ? `Loaded: ${snapshot.title}` : "Loaded",
        url,
      });
    }
    seen.loaded = loaded;
    if (loaded || snapshot.title) {
      browserHistoryStore.record({
        connectionId,
        sessionId,
        connectionName,
        url,
        title: snapshot.title,
        private: isPrivate,
      });
    }
    const failureKey = snapshot.loadFailure
      ? `${snapshot.loadFailure.category}:${snapshot.loadFailure.code}`
      : "";
    if (failureKey && failureKey !== seen.failure) {
      const { category, code } = snapshot.loadFailure!;
      const tls = category === "certificate" || category === "tls";
      logBrowserEvent({
        ...base,
        level: "error",
        type: tls ? "certificate" : "load-failure",
        message: `Load failed: ${category} (code ${code})`,
        url,
      });
      if (tls || category === "proxy")
        logProxyEvent({
          source: "cef",
          level: "error",
          kind: tls ? "tls" : "upstream",
          message: `${tls ? "TLS/certificate failure" : "Proxy failure"} (code ${code})`,
          sessionId,
          url,
        });
      if (
        category === "proxy" ||
        category === "dns" ||
        category === "connection"
      )
        logBrowserEvent({
          ...base,
          level: "warn",
          type: "network",
          message: `Network error: ${category}`,
          url,
        });
    }
    seen.failure = failureKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, snapshot, connectionId, sessionId, connectionName, isPrivate]);
}
