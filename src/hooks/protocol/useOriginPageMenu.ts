"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  popupRequest,
  type useNativeOriginPopupBridge,
} from "./useNativeOriginPopupBridge";

export interface OriginHistorySnapshot {
  snapshotId: string;
  currentIndex: number;
  entries: { index: number; url: string; title: string }[];
}
function readHistory(value: unknown): OriginHistorySnapshot {
  const row = value as OriginHistorySnapshot | null;
  if (
    !row ||
    typeof row.snapshotId !== "string" ||
    !/^\d{1,32}$/.test(row.snapshotId) ||
    !Array.isArray(row.entries) ||
    row.entries.length > 128 ||
    !Number.isInteger(row.currentIndex) ||
    row.currentIndex < -1 ||
    row.currentIndex >= row.entries.length ||
    (row.currentIndex === -1 && row.entries.length > 0) ||
    row.entries.some(
      (e, index) =>
        !e ||
        e.index !== index ||
        typeof e.url !== "string" ||
        e.url.length > 16384 ||
        typeof e.title !== "string" ||
        e.title.length > 512,
    ) ||
    row.entries.reduce((n, e) => n + e.url.length + e.title.length, 0) > 262144
  )
    throw new Error("Invalid native history.");
  return {
    snapshotId: row.snapshotId,
    currentIndex: row.currentIndex,
    entries: row.entries.map(({ index, url, title }) => ({
      index,
      url,
      title,
    })),
  };
}
type Mutation =
  | { kind: "print" }
  | { kind: "open-tab" }
  | { kind: "historyJump"; snapshotId: string; index: number }
  | { kind: "find" };
interface Options {
  identity: OriginBrowserIdentity | null;
  viewId: string | null;
  enabled: boolean;
  interactive: boolean;
  assertOwner: () => void;
  runInteractive: ReturnType<
    typeof useNativeOriginPopupBridge
  >["runInteractive"];
}

/** No mount/menu polling. A queued click runs after overlay closure and native
 * presentation/focus ACKs. History is a volatile receipt, never URL replay. */
export function useOriginPageMenu(options: Options) {
  const key =
    options.enabled && options.identity
      ? JSON.stringify([
          options.identity.ownerDatabaseId,
          options.identity.connectionId,
          options.identity.sessionId,
          options.identity.attemptId,
          options.viewId,
        ])
      : "";
  const epoch = useMemo(() => ({ key }), [key]);
  const current = useRef({ options, epoch });
  current.current = { options, epoch };
  const alive = useRef(false);
  const queued = useRef<{
    epoch: typeof epoch;
    action: Mutation;
    assertOwner: () => void;
    started: boolean;
  } | null>(null);
  const read = useRef<object | null>(null);
  const [history, setHistory] = useState<{
    epoch: typeof epoch;
    value: OriginHistorySnapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [findOpenRequest, setFindOpenRequest] = useState(0);
  useLayoutEffect(() => {
    alive.current = true;
    queued.current = null;
    read.current = null;
    setHistory(null);
    setLoading(false);
    setBusy(false);
    setError("");
    setFindOpenRequest(0);
    return () => {
      alive.current = false;
      queued.current = null;
      read.current = null;
    };
  }, [epoch]);
  function check(captured = epoch) {
    if (
      !alive.current ||
      !captured.key ||
      current.current.epoch !== captured ||
      document.hidden
    )
      throw new Error("The selected website changed.");
    current.current.options.assertOwner();
  }
  async function refreshHistory() {
    if (read.current || queued.current) return;
    const token = {};
    const valid = () =>
      alive.current &&
      current.current.epoch === epoch &&
      read.current === token;
    try {
      check();
      options.assertOwner();
      read.current = token;
      setLoading(true);
      setHistory(null);
      setError("");
      const value = await invoke<unknown>("origin_browser_page_menu", {
        request: {
          identity: options.identity,
          viewId: options.viewId,
          action: { kind: "history" },
        },
      });
      if (!valid()) return;
      check();
      options.assertOwner();
      setHistory({ epoch, value: readHistory(value) });
    } catch {
      if (valid())
        setError(
          "History could not be loaded. Refresh the history menu to retry.",
        );
    } finally {
      if (valid()) {
        read.current = null;
        setLoading(false);
      }
    }
  }
  function enqueue(action: Mutation) {
    try {
      check();
    } catch {
      return;
    }
    if (queued.current || read.current) return;
    queued.current = {
      epoch,
      action,
      assertOwner: options.assertOwner,
      started: false,
    };
    setError("");
    setBusy(true);
  }
  useEffect(() => {
    const work = queued.current;
    if (!work || work.started || !options.interactive) return;
    work.started = true;
    const assertCurrent = () => {
      check(work.epoch);
      work.assertOwner();
      if (queued.current !== work || !current.current.options.interactive)
        throw new Error();
    };
    void (async () => {
      try {
        assertCurrent();
        await options.runInteractive(
          options.identity!,
          options.viewId,
          assertCurrent,
          async (revision) => {
            assertCurrent();
            if (work.action.kind === "find") {
              setFindOpenRequest((n) => n + 1);
            } else if (work.action.kind === "open-tab") {
              // Native duplicates the selected view's canonical current URL and
              // enforces popup/destination policy within the existing context.
              await popupRequest(options.identity!, {
                kind: "open-tab",
                viewId: options.viewId,
                presentationRevision: revision,
              });
            } else {
              await invoke("origin_browser_page_menu", {
                request: {
                  identity: options.identity,
                  viewId: options.viewId,
                  action: work.action,
                },
              });
            }
          },
        );
      } catch {
        if (alive.current && current.current.epoch === work.epoch)
          setError(
            "The selected page action was not completed. Reopen the menu and try again.",
          );
      } finally {
        if (queued.current === work) {
          queued.current = null;
          if (alive.current) setBusy(false);
        }
      }
    })();
  });
  const snapshot = history?.epoch === epoch ? history.value : null;
  return {
    history: snapshot,
    loading,
    busy,
    error,
    findOpenRequest,
    refreshHistory,
    print: () => enqueue({ kind: "print" }),
    openTab: () => enqueue({ kind: "open-tab" }),
    find: () => enqueue({ kind: "find" }),
    jump: (index: number) => {
      if (
        !snapshot ||
        snapshot.currentIndex === index ||
        !snapshot.entries.some((e) => e.index === index)
      )
        return;
      enqueue({ kind: "historyJump", snapshotId: snapshot.snapshotId, index });
      setHistory(null);
    },
  };
}
export type OriginPageMenuController = ReturnType<typeof useOriginPageMenu>;
