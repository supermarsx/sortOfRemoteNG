"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  NATIVE_DOWNLOAD_EVENT,
  nativeDownload,
  type NativeDownload,
  type NativeDownloadAction,
} from "../../types/protocols/nativeBrowserDownloads";

export function useNativeBrowserDownloads(
  identity: OriginBrowserIdentity | null,
  enabled: boolean,
  assertOwner: () => void,
) {
  const scope = enabled && identity ? JSON.stringify(identity) : "";
  const latest = useRef({ scope, identity, assertOwner });
  latest.current = { scope, identity, assertOwner };
  const [state, setState] = useState<{
    scope: string;
    rows: NativeDownload[];
    error: string;
  }>({ scope: "", rows: [], error: "" });
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const pending = useRef(new Set<string>());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const identity = latest.current.identity;
    if (!scope || !identity) return;
    let live = true;
    let off: (() => void) | undefined;
    const rows = new Map<number, NativeDownload>();
    const current = () => live && latest.current.scope === scope;
    const ingest = (value: unknown) => {
      if (!current()) return;
      const row = nativeDownload(value, identity);
      if (!row) return;
      const previous = rows.get(row.downloadId);
      if (previous && previous.sequence >= row.sequence) return;
      if (!previous && rows.size >= 128) rows.delete(rows.keys().next().value!);
      rows.set(row.downloadId, row);
      setState({
        scope,
        rows: [...rows.values()].sort((a, b) => b.downloadId - a.downloadId),
        error: "",
      });
    };
    setState({ scope, rows: [], error: "" });
    setBusy(new Set());
    void (async () => {
      latest.current.assertOwner();
      off = await listen<unknown>(NATIVE_DOWNLOAD_EVENT, (event) =>
        ingest(event.payload),
      );
      if (!current()) {
        off();
        return;
      }
      latest.current.assertOwner();
      const snapshot = await invoke<unknown>("origin_browser_downloads", {
        request: { identity },
      });
      if (!current()) return;
      if (!Array.isArray(snapshot) || snapshot.length > 128) throw new Error();
      snapshot.forEach(ingest);
    })().catch(() => {
      if (current())
        setState((old) => ({
          scope,
          rows: old.scope === scope ? old.rows : [],
          error:
            "Downloads could not be refreshed. Check this browser session and retry.",
        }));
    });
    return () => {
      live = false;
      off?.();
    };
  }, [scope, refresh]); // scope captures the complete immutable attempt identity
  const act = useCallback(
    async (downloadId: number, action: NativeDownloadAction) => {
      const captured = latest.current;
      const key = `${captured.scope}:${downloadId}`;
      if (!captured.scope || !captured.identity || pending.current.has(key))
        return false;
      pending.current.add(key);
      setBusy((old) => new Set(old).add(downloadId));
      try {
        captured.assertOwner();
        await invoke("origin_browser_download_control", {
          request: { identity: captured.identity, downloadId, action },
        });
        return latest.current.scope === captured.scope;
      } catch {
        if (latest.current.scope === captured.scope)
          setState((old) => ({
            ...old,
            error:
              "The download action could not be completed. Refresh its current status and retry.",
          }));
        return false;
      } finally {
        pending.current.delete(key);
        if (latest.current.scope === captured.scope)
          setBusy((old) => {
            const next = new Set(old);
            next.delete(downloadId);
            return next;
          });
      }
    },
    [],
  );
  const rows = state.scope === scope ? state.rows : [];
  return {
    scope,
    rows,
    error: state.scope === scope ? state.error : "",
    busy,
    act,
    refresh: () => setRefresh((value) => value + 1),
    activeCount: rows.filter((row) =>
      ["awaiting-destination", "in-progress", "paused"].includes(row.status),
    ).length,
  };
}
export type NativeBrowserDownloadsController = ReturnType<
  typeof useNativeBrowserDownloads
>;
