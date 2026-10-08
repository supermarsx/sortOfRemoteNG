"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  nativeDownload,
  NATIVE_DOWNLOAD_EVENT,
  type NativeDownload,
  type NativeDownloadAction,
} from "../../types/protocols/nativeBrowserDownloads";
import { popupRequest } from "./useNativeOriginPopupBridge";
import { samePopupSource } from "../../types/protocols/originBrowserPopups";

/** Source-wide download snapshots, fenced to the currently selected UI view.
 * Native resolves each globally unique ID to its exact owning attachment. */
export function useOriginSelectedDownloads(
  identity: OriginBrowserIdentity | null,
  viewId: string | null,
  enabled: boolean,
  assertOwner: () => void,
) {
  const scope = enabled && identity ? JSON.stringify([identity, viewId]) : "";
  const latest = useRef({ scope, assertOwner });
  latest.current = { scope, assertOwner };
  const [state, setState] = useState({
    scope: "",
    rows: [] as NativeDownload[],
    error: "",
  });
  const [busy, setBusy] = useState(new Set<number>());
  const published = useRef(state);
  const actions = useRef(new Set<string>());
  const publish = useCallback((next: typeof state) => {
    if (JSON.stringify(published.current) === JSON.stringify(next)) return;
    published.current = next;
    setState(next);
  }, []);
  const [generation, refresh] = useState(0);
  useEffect(() => {
    if (!identity || !scope) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off: (() => void) | undefined;
    let inFlight = false;
    let dirty = false;
    let due = Infinity;
    let lastStarted = 0;
    if (published.current.scope !== scope)
      publish({ scope, rows: [], error: "" });
    setBusy(new Set());
    const current = () => live && latest.current.scope === scope;
    const schedule = (delay: number) => {
      if (!current()) return;
      const next = Math.max(Date.now() + delay, lastStarted + 750);
      if (next >= due) return;
      clearTimeout(timer);
      due = next;
      timer = setTimeout(
        () => {
          due = Infinity;
          void poll();
        },
        Math.max(0, next - Date.now()),
      );
    };
    const poll = async () => {
      if (!current()) return;
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      lastStarted = Date.now();
      try {
        latest.current.assertOwner();
        const result = await popupRequest(identity, {
          kind: "downloads",
          viewId,
        });
        if (!current()) return;
        if (!Array.isArray(result) || result.length > 128) throw new Error();
        const rows = result.map((row) => nativeDownload(row, identity));
        if (rows.some((row) => !row)) throw new Error();
        publish({
          scope,
          rows: (rows as NativeDownload[]).sort(
            (a, b) => b.downloadId - a.downloadId,
          ),
          error: "",
        });
      } catch {
        if (current()) {
          const old = published.current;
          publish({
            scope,
            rows: old.scope === scope ? old.rows : [],
            error: "Downloads could not be refreshed for this view.",
          });
        }
      } finally {
        inFlight = false;
        schedule(dirty ? 0 : 10_000);
        dirty = false;
      }
    };
    // Events invalidate this exact slot; their source-only payload is never
    // merged into another view. Coalesce bursts and reconcile active tabs only.
    void listen<unknown>(NATIVE_DOWNLOAD_EVENT, (event) => {
      const owner = (
        event.payload as { identity?: OriginBrowserIdentity } | null
      )?.identity;
      if (samePopupSource(owner, identity)) schedule(100);
    })
      .then((unsubscribe) => {
        if (!current()) unsubscribe();
        else off = unsubscribe;
      })
      .catch(() => {});
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      off?.();
    };
    // Identity and view are captured in scope; object churn must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, generation]);
  const act = async (downloadId: number, action: NativeDownloadAction) => {
    const key = `${scope}:${downloadId}`;
    if (
      !scope ||
      !identity ||
      latest.current.scope !== scope ||
      actions.current.has(key)
    )
      return false;
    actions.current.add(key);
    setBusy((old) => new Set(old).add(downloadId));
    try {
      latest.current.assertOwner();
      await popupRequest(identity, {
        kind: "download-control",
        viewId,
        request: { identity, downloadId, action },
      });
      if (latest.current.scope !== scope) return false;
      refresh((v) => v + 1);
      return true;
    } catch {
      if (latest.current.scope === scope)
        publish({
          scope,
          rows: published.current.scope === scope ? published.current.rows : [],
          error:
            "The download action could not be completed for this view. Refresh and retry.",
        });
      return false;
    } finally {
      actions.current.delete(key);
      if (latest.current.scope === scope)
        setBusy((old) => {
          const next = new Set(old);
          next.delete(downloadId);
          return next;
        });
    }
  };
  const rows = state.scope === scope ? state.rows : [];
  return {
    scope,
    rows,
    busy,
    act,
    refresh: () => refresh((v) => v + 1),
    error: state.scope === scope ? state.error : "",
    activeCount: rows.filter((row) =>
      ["awaiting-destination", "in-progress", "paused"].includes(row.status),
    ).length,
  };
}
