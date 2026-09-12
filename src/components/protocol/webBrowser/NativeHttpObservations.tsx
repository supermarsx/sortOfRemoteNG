import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";
import { useSessionObservationActivity } from "../../../hooks/session/useSessionObservationActivity";
import {
  parseWebNetworkGuardStatus,
  type NativeHttpObservationsSnapshot,
} from "../../../utils/protocol/webNetworkGuard";

/** Explicit disclosure of WebView-wide diagnostics, never selected-tab traffic. */
export default function NativeHttpObservations({
  active,
}: {
  active: boolean;
}) {
  const { isActive } = useSessionRenderActivity();
  const observing = useSessionObservationActivity(active && isActive);
  const [snapshot, setSnapshot] =
    useState<NativeHttpObservationsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const current = useRef(observing);
  current.current = observing;
  const refresh = useCallback(async () => {
    if (!current.current) return;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const status = parseWebNetworkGuardStatus(
        await invoke("web_network_guard_status"),
      );
      if (!current.current || ticket !== epoch.current) return;
      if (!status.httpObservations) throw new Error("unavailable");
      setSnapshot(status.httpObservations);
    } catch {
      if (current.current && ticket === epoch.current) {
        setSnapshot(null);
        setError(
          "Native HTTP observations are unavailable. This requires the updated Windows desktop process.",
        );
      }
    } finally {
      if (current.current && ticket === epoch.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const lifetime = epoch;
    if (observing) void refresh();
    else {
      setSnapshot(null);
      setError("");
      setBusy(false);
    }
    return () => {
      lifetime.current++;
    };
  }, [observing, refresh]);
  if (!observing) return null;
  return (
    <section
      aria-label="Native WebView HTTP observations"
      className="mt-3 border-t border-[var(--color-border)] pt-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          Native HTTP observations · all website tabs and application shell
        </span>
        <button
          type="button"
          className="sor-btn-secondary inline-flex items-center gap-1"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} aria-hidden="true" />
          Refresh snapshot
        </button>
      </div>
      <p className="mt-1">
        WebView HTTP(S) only, not native upstream or service traffic. These
        observations are not attributed to this tab and do not prove routing or
        successful responses. WebSockets, WebRTC and speculative connections are
        not covered.
      </p>
      {busy && <p role="status">Reading native observations…</p>}
      {error && <p role="status">{error}</p>}
      {snapshot && (
        <>
          <p className="mt-1">
            {snapshot.total} observed; {snapshot.documentBlocked} document
            requests blocked. Latest {snapshot.recent.length} of at most 64
            retained in application memory. Older entries are discarded;
            snapshots update only on opening or Refresh.
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {snapshot.recent
              .slice()
              .reverse()
              .map((row, index) => (
                <li key={`${row.sequence}:${index}`} className="break-all">
                  {row.method} {row.origin} — {row.resourceKind} /{" "}
                  {row.sourceKind}
                  {row.documentBlocked
                    ? " · document blocked"
                    : " · observed, outcome unknown"}
                </li>
              ))}
          </ul>
          {!snapshot.recent.length && (
            <p>No retained native HTTP observations.</p>
          )}
        </>
      )}
      <p className="mt-1">
        No paths, queries, headers, bodies or credentials are retained. This
        does not grant destination access.
      </p>
    </section>
  );
}
