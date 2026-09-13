import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { Select } from "../../ui/forms";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";
import { useSessionObservationActivity } from "../../../hooks/session/useSessionObservationActivity";
import {
  parseWebNetworkGuardStatus,
  type NativeHttpObservation,
  type NativeHttpObservationsSnapshot,
} from "../../../utils/protocol/webNetworkGuard";

type ObservationFilter = "current" | "web" | "all";

function canonicalOrigin(value: string | undefined): string | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password
    )
      return value;
  } catch {
    // Display filtering does not reinterpret invalid or secret-bearing URLs.
  }
  return undefined;
}

function isAppIpc(origin: string): boolean {
  // Match the WebView IPC host exactly, not arbitrary localhost traffic.
  return new URL(origin).hostname === "ipc.localhost";
}

function observationRow(row: NativeHttpObservation, index: number) {
  return (
    <li key={`${row.sequence}:${index}`} className="break-all">
      {row.method} {row.origin} — {row.resourceKind} / {row.sourceKind}
      {row.documentBlocked
        ? " · document blocked"
        : " · observed, outcome unknown"}
    </li>
  );
}

/** Explicit disclosure of WebView-wide diagnostics, never selected-tab traffic. */
export default function NativeHttpObservations({
  active,
  proxyOrigin,
}: {
  active: boolean;
  proxyOrigin?: string;
}) {
  const origin = canonicalOrigin(proxyOrigin);
  const { isActive } = useSessionRenderActivity();
  const observing = useSessionObservationActivity(active && isActive);
  const [result, setResult] = useState<{
    origin: string | undefined;
    snapshot: NativeHttpObservationsSnapshot;
  } | null>(null);
  const snapshot = result?.origin === origin ? result?.snapshot : null;
  const [selection, setSelection] = useState<{
    origin: string | undefined;
    filter: ObservationFilter;
  }>({ origin, filter: origin ? "current" : "web" });
  const filter =
    selection.origin === origin ? selection.filter : origin ? "current" : "web";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const current = useRef({ observing, origin });
  current.current = { observing, origin };
  const refresh = useCallback(async () => {
    if (!current.current.observing) return;
    const capturedOrigin = current.current.origin;
    const ticket = ++epoch.current;
    const isCurrent = () =>
      current.current.observing &&
      current.current.origin === capturedOrigin &&
      ticket === epoch.current;
    setBusy(true);
    setError("");
    try {
      const status = parseWebNetworkGuardStatus(
        await invoke("web_network_guard_status"),
      );
      if (!isCurrent()) return;
      if (!status.httpObservations) throw new Error("unavailable");
      setResult({ origin: capturedOrigin, snapshot: status.httpObservations });
    } catch {
      if (isCurrent()) {
        setResult(null);
        setError(
          "Native HTTP observations are unavailable. This requires the updated Windows desktop process.",
        );
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, []);
  useEffect(() => {
    ++epoch.current;
    setResult(null);
    setError("");
    setBusy(false);
    setSelection({ origin, filter: origin ? "current" : "web" });
    // An origin change clears the previous snapshot, but never initiates IPC.
    // The next snapshot still requires opening the disclosure or Refresh.
  }, [origin]);
  useEffect(() => {
    const lifetime = epoch;
    if (observing) void refresh();
    else {
      setResult(null);
      setError("");
      setBusy(false);
    }
    return () => {
      lifetime.current++;
    };
  }, [observing, refresh]);
  if (!observing) return null;
  const matchesFilter = (row: NativeHttpObservation) =>
    filter === "all" ||
    (filter === "current"
      ? row.origin === origin
      : !isAppIpc(row.origin) && row.origin !== origin);
  const newest = snapshot?.recent.slice().reverse() ?? [];
  const rows = newest.filter(matchesFilter);
  const blockedOutsideFilter = newest.filter(
    (row) => row.documentBlocked && !matchesFilter(row),
  );
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>Show</span>
        <Select
          label="Filter native observations"
          variant="form-sm"
          value={filter}
          onChange={(value) => {
            if (value === "current" || value === "web" || value === "all")
              setSelection({ origin, filter: value });
          }}
          options={[
            {
              value: "current",
              label: "Current proxy origin",
              disabled: !origin,
            },
            {
              value: "web",
              label: origin
                ? "Other website traffic"
                : "Website traffic (excluding app IPC)",
            },
            { value: "all", label: "All, including app IPC" },
          ]}
        />
      </div>
      <p className="mt-1">
        {origin
          ? `Current proxy origin: ${origin}. Matching an origin does not establish tab ownership.`
          : "No active proxy origin is available; website traffic is not assigned to a tab."}{" "}
        App IPC means the exact ipc.localhost host. Blocked document requests
        remain visible even when outside the selected filter.
      </p>
      {busy && <p role="status">Reading native observations…</p>}
      {error && <p role="status">{error}</p>}
      {snapshot && (
        <>
          <p className="mt-1">
            Global snapshot: {snapshot.total} observed;{" "}
            {snapshot.documentBlocked} document requests blocked. Latest{" "}
            {snapshot.recent.length} of at most 64 retained in application
            memory. App IPC may already have evicted website entries from this
            shared ring. Older entries are discarded; snapshots update only on
            opening or Refresh.
          </p>
          <p className="mt-1">
            {rows.length} retained observations match this filter.
          </p>
          <ul
            aria-label="Filtered native observations"
            className="mt-2 max-h-40 space-y-1 overflow-y-auto"
          >
            {rows.map(observationRow)}
          </ul>
          {!rows.length && (
            <p>No retained native HTTP observations match this filter.</p>
          )}
          {blockedOutsideFilter.length > 0 && (
            <>
              <p className="mt-2 font-medium">
                Blocked document requests outside this filter · all origins
              </p>
              <ul
                aria-label="Blocked documents outside filter"
                className="mt-1 max-h-32 space-y-1 overflow-y-auto"
              >
                {blockedOutsideFilter.map(observationRow)}
              </ul>
            </>
          )}
        </>
      )}
      {!snapshot && !busy && !error && (
        <p className="mt-1">
          Refresh to read a snapshot for this origin filter.
        </p>
      )}
      <p className="mt-1">
        No paths, queries, headers, bodies or credentials are retained. This
        does not grant destination access.
      </p>
    </section>
  );
}
