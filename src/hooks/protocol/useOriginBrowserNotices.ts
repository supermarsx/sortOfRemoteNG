"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";

type NoticeKind = "document-load-timeout" | "cookie-retention-failed";
interface BrowserNotice {
  id: number;
  kind: NoticeKind;
  reloading: boolean;
  reloadFailed: boolean;
}
interface Options {
  identity: OriginBrowserIdentity | null;
  enabled: boolean;
  canReload: boolean;
  assertOwner: () => void;
  reload: () => Promise<boolean>;
}

function identityKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const parts = [
    row.ownerDatabaseId,
    row.connectionId,
    row.sessionId,
    row.attemptId,
  ];
  return parts.every(
    (part) => typeof part === "string" && part.length > 0 && part.length <= 256,
  )
    ? JSON.stringify(parts)
    : null;
}

/** Owner-window notices only. Retain known kinds, never native diagnostic text. */
export function useOriginBrowserNotices(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const scope = identityKey(options.identity);
  const [notices, setNotices] = useState<BrowserNotice[]>([]);
  const [listenerFailed, setListenerFailed] = useState(false);
  const liveNotices = useRef<BrowserNotice[]>([]);
  const serial = useRef(0);
  const retentionNoticeScope = useRef<string | null>(null);
  const epoch = useRef(0);
  const alive = useRef(false);
  const publish = (next: BrowserNotice[]) => {
    liveNotices.current = next;
    setNotices(next);
  };
  const authorized = (expectedScope: string | null) => {
    const current = latest.current;
    if (
      !alive.current ||
      !current.enabled ||
      !expectedScope ||
      identityKey(current.identity) !== expectedScope
    )
      return false;
    try {
      current.assertOwner();
      return true;
    } catch {
      return false;
    }
  };

  useLayoutEffect(() => {
    const revision = ++epoch.current;
    alive.current = true;
    publish([]);
    setListenerFailed(false);
    let active = true;
    let unlisten: (() => void) | undefined;
    if (options.enabled && scope) {
      void Promise.resolve()
        .then(() => {
          if (!active) return;
          return listen<unknown>("origin-browser-notice", ({ payload }) => {
            if (
              !active ||
              revision !== epoch.current ||
              !authorized(scope) ||
              !payload ||
              typeof payload !== "object"
            )
              return;
            const row = payload as Record<string, unknown>;
            if (
              identityKey(row.identity) !== scope ||
              (row.kind !== "document-load-timeout" &&
                row.kind !== "cookie-retention-failed")
            )
              return;
            const kind = row.kind;
            if (kind === "cookie-retention-failed") {
              if (retentionNoticeScope.current === scope) return;
              retentionNoticeScope.current = scope;
            }
            // Repeated delivery does not stack toasts. A new timeout while Reload
            // is pending replaces its notice, so the old completion cannot erase it.
            if (
              liveNotices.current.some(
                (notice) => notice.kind === kind && !notice.reloading,
              )
            )
              return;
            publish([
              ...liveNotices.current.filter((notice) => notice.kind !== kind),
              {
                id: ++serial.current,
                kind,
                reloading: false,
                reloadFailed: false,
              },
            ]);
          });
        })
        .then(
          (stop) => {
            if (!active) stop?.();
            else unlisten = stop;
          },
          () => {
            if (active && authorized(scope)) setListenerFailed(true);
          },
        );
    }
    return () => {
      active = false;
      alive.current = false;
      epoch.current = revision + 1;
      liveNotices.current = [];
      unlisten?.();
    };
    // Scope primitives own registration. Render callback changes must not lose events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, options.enabled]);

  const dismiss = (id: number) => {
    if (authorized(scope))
      publish(liveNotices.current.filter((notice) => notice.id !== id));
  };
  const reload = async (id: number) => {
    const notice = liveNotices.current.find((item) => item.id === id);
    if (
      !notice ||
      notice.kind !== "document-load-timeout" ||
      notice.reloading ||
      !authorized(scope) ||
      !latest.current.canReload ||
      document.hidden
    )
      return;
    const revision = epoch.current;
    publish(
      liveNotices.current.map((item) =>
        item.id === id
          ? { ...item, reloading: true, reloadFailed: false }
          : item,
      ),
    );
    let accepted = false;
    try {
      accepted = await latest.current.reload();
    } catch {
      /* Fixed UI copy only. */
    }
    if (revision !== epoch.current || !authorized(scope)) return;
    publish(
      accepted
        ? liveNotices.current.filter((item) => item.id !== id)
        : liveNotices.current.map((item) =>
            item.id === id
              ? { ...item, reloading: false, reloadFailed: true }
              : item,
          ),
    );
  };
  return {
    notices,
    listenerFailed,
    dismiss,
    reload,
    canReload: options.canReload && options.enabled,
  };
}
