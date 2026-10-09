"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  readPopupInventory,
  samePopupSource,
  type OriginPopupReference,
  type OriginPopupTransport,
  type OriginPopupView,
} from "../../types/protocols/originBrowserPopups";

interface Options {
  sourceIdentity: OriginBrowserIdentity | null;
  enabled: boolean;
  assertOwner: () => void;
  transport: OriginPopupTransport;
  /** Main presents this actual child, or the parent for null. Never ADD_SESSION
   * or origin_browser_create. Mount the hook once per source Attempt. */
  onActivate: (reference: OriginPopupReference | null) => void | Promise<void>;
}

export interface OriginPopupTab extends OriginPopupView {
  readonly closing: boolean;
}

interface State {
  scope: string;
  tabs: readonly OriginPopupTab[];
  activeViewId: string | null;
  error: string | null;
}
const empty = { tabs: [], activeViewId: null, error: null } as const;

/** Owner-window transient tab adoption. Nothing is written to ConnectionSession,
 * the connection registry, a database or local/session storage. */
export function useOriginBrowserPopups(options: Options) {
  const { sourceIdentity: identity, enabled, transport } = options;
  const ownerDatabaseId = identity?.ownerDatabaseId;
  const connectionId = identity?.connectionId;
  const sessionId = identity?.sessionId;
  const attemptId = identity?.attemptId;
  const source = useMemo(
    () =>
      ownerDatabaseId && connectionId && sessionId && attemptId
        ? Object.freeze({ ownerDatabaseId, connectionId, sessionId, attemptId })
        : null,
    [ownerDatabaseId, connectionId, sessionId, attemptId],
  );
  const scope = JSON.stringify(source);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [state, setState] = useState<State>({ scope, ...empty });
  const driver = useRef<{
    select: (viewId: string | null) => void;
    close: (viewId: string) => Promise<void>;
    reorder: (
      viewId: string,
      targetViewId: string,
      placement: "before" | "after",
    ) => void;
  } | null>(null);

  useLayoutEffect(() => {
    setState({ scope, ...empty });
    if (!source || !enabled) return;
    let disposed = false;
    let revoked = false;
    let unsubscribe: (() => void) | undefined;
    let sequence = -1;
    let activeViewId: string | null = null;
    let selection = 0;
    let error: string | null = null;
    const onActivateSource = latest.current.onActivate;
    const rows = new Map<string, OriginPopupTab>();
    const adopting = new Set<string>();
    const closing = new Set<string>();
    const reference = (viewId: string): OriginPopupReference =>
      Object.freeze({ sourceIdentity: source, viewId });
    const current = () => {
      if (
        disposed ||
        revoked ||
        !latest.current.enabled ||
        !samePopupSource(latest.current.sourceIdentity, source)
      )
        return false;
      try {
        latest.current.assertOwner();
        return true;
      } catch {
        return false;
      }
    };
    const publish = () => {
      if (!disposed)
        setState({ scope, tabs: [...rows.values()], activeViewId, error });
    };
    const report = (message: string) => {
      if (!disposed) {
        error = message;
        publish();
      }
    };
    const closeNative = async (viewId: string) => {
      try {
        await transport.close(reference(viewId));
      } catch {
        report("A popup could not be closed. Retry closing it.");
      }
    };
    const activateParent = () => {
      if (activeViewId === null) return;
      activeViewId = null;
      // This callback belongs to the old source; it cannot select a successor.
      try {
        void Promise.resolve(onActivateSource(null)).catch(() =>
          report("The parent view could not be selected."),
        );
      } catch {
        error = "The parent view could not be selected.";
      }
    };
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      activateParent();
      for (const viewId of new Set([...rows.keys(), ...adopting]))
        void closeNative(viewId);
      rows.clear();
      publish();
    };
    const select = (viewId: string | null) => {
      if (!current()) {
        revoke();
        return;
      }
      const row = viewId ? rows.get(viewId) : null;
      if (viewId && (!row || row.phase !== "adopted" || row.closing)) return;
      try {
        const serial = ++selection;
        const result = latest.current.onActivate(
          viewId ? reference(viewId) : null,
        );
        const commit = () => {
          if (!current() || serial !== selection) return;
          if (
            viewId &&
            (rows.get(viewId)?.phase !== "adopted" || rows.get(viewId)?.closing)
          )
            return;
          activeViewId = viewId;
          publish();
        };
        if (result)
          void result.then(commit, () =>
            report("The popup view could not be selected."),
          );
        else commit();
      } catch {
        report("The popup view could not be selected.");
      }
    };
    const receive = (payload: unknown) => {
      if (!current()) {
        revoke();
        return;
      }
      const inventory = readPopupInventory(payload, source);
      if (!inventory) {
        report("The native popup inventory was invalid.");
        return;
      }
      if (inventory.sequence <= sequence) return;
      sequence = inventory.sequence;
      if (inventory.sourceClosed) {
        revoke();
        return;
      }
      const present = new Set(inventory.views.map((view) => view.viewId));
      for (const viewId of rows.keys()) {
        if (!present.has(viewId)) {
          rows.delete(viewId);
          if (activeViewId === viewId) activateParent();
        }
      }
      for (const view of inventory.views) {
        const previous = rows.get(view.viewId);
        // Never regress a locally closing/adopted view on a malformed update.
        if (previous?.phase === "adopted" && view.phase === "available")
          continue;
        const isClosing =
          closing.has(view.viewId) ||
          previous?.closing === true ||
          view.phase === "closing";
        rows.set(view.viewId, { ...view, closing: isClosing });
        if (isClosing && activeViewId === view.viewId) activateParent();
        if (
          view.phase !== "available" ||
          isClosing ||
          adopting.has(view.viewId)
        )
          continue;
        adopting.add(view.viewId);
        void (async () => {
          try {
            if (!current()) {
              revoke();
              return;
            }
            const payload = await transport.adopt(reference(view.viewId));
            if (!current()) {
              await closeNative(view.viewId);
              return;
            }
            const receipt = readPopupInventory(payload, source);
            if (
              !receipt ||
              receipt.sourceClosed ||
              !receipt.views.some(
                (candidate) =>
                  candidate.viewId === view.viewId &&
                  candidate.phase === "adopted",
              )
            )
              throw new Error();
            receive(receipt);
            const adopted = rows.get(view.viewId);
            // A newer native close/removal wins over an old adoption reply.
            if (
              adopted?.phase === "adopted" &&
              !adopted.closing &&
              view.disposition === "foreground"
            )
              select(view.viewId);
          } catch {
            if (current()) report("A popup could not be adopted.");
            if (current() && rows.has(view.viewId))
              await actions.close(view.viewId);
            else await closeNative(view.viewId);
          } finally {
            adopting.delete(view.viewId);
          }
        })();
      }
      publish();
    };
    const actions = {
      select,
      reorder: (
        viewId: string,
        targetViewId: string,
        placement: "before" | "after",
      ) => {
        if (
          !current() ||
          viewId === targetViewId ||
          !rows.has(viewId) ||
          !rows.has(targetViewId) ||
          rows.get(viewId)?.closing ||
          rows.get(targetViewId)?.closing
        )
          return;
        const order = [...rows.keys()].filter((id) => id !== viewId);
        const index = order.indexOf(targetViewId);
        order.splice(index + (placement === "after" ? 1 : 0), 0, viewId);
        const ordered = order.map((id) => rows.get(id)!);
        // Map updates retain this display order; new native handles append and
        // removals leave the survivors in place. Never activate/re-adopt here.
        rows.clear();
        for (const row of ordered) rows.set(row.viewId, row);
        publish();
      },
      close: async (viewId: string) => {
        const row = rows.get(viewId);
        if (!row || row.closing || closing.has(viewId)) return;
        closing.add(viewId);
        rows.set(viewId, { ...row, closing: true });
        if (activeViewId === viewId) activateParent();
        publish();
        try {
          await transport.close(reference(viewId));
        } catch {
          if (current() && rows.get(viewId)?.phase !== "closing") {
            const remaining = rows.get(viewId);
            if (remaining) rows.set(viewId, { ...remaining, closing: false });
            report("A popup could not be closed. Retry closing it.");
          }
        } finally {
          closing.delete(viewId);
        }
      },
    };
    driver.current = actions;
    void (async () => {
      try {
        if (!current()) {
          revoke();
          return;
        }
        const off = await transport.subscribe(source, receive);
        if (!current()) {
          off();
          revoke();
          return;
        }
        unsubscribe = off;
        // Subscribe first; a later stale list reply cannot undo newer events.
        receive(await transport.list(source));
      } catch {
        if (current()) report("Native popup tabs are unavailable.");
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      revoke();
      if (driver.current === actions) driver.current = null;
    };
  }, [source, scope, enabled, transport]);

  const visible = state.scope === scope && enabled ? state : empty;
  return {
    ...visible,
    select: (viewId: string | null) => driver.current?.select(viewId),
    close: (viewId: string) =>
      driver.current?.close(viewId) ?? Promise.resolve(),
    reorder: (
      viewId: string,
      targetViewId: string,
      placement: "before" | "after",
    ) => driver.current?.reorder(viewId, targetViewId, placement),
  };
}

export type OriginBrowserPopups = ReturnType<typeof useOriginBrowserPopups>;
