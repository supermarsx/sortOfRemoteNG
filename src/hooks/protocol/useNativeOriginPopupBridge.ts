"use client";
import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { tauriOriginBrowserTransport } from "./useOriginBrowser";
import type {
  OriginBrowserIdentity,
  OriginBrowserAction,
  OriginBrowserTransport,
} from "../../types/protocols/originBrowser";
import {
  samePopupSource,
  type OriginPopupReference,
  type OriginPopupTransport,
} from "../../types/protocols/originBrowserPopups";

export const popupRequest = (
  sourceIdentity: OriginBrowserIdentity,
  action: object,
) =>
  invoke<unknown>("origin_browser_popup", {
    request: { sourceIdentity, action },
  });

/** Stable transport avoids recreating the source context when selecting a tab.
 * Only presentation is source-scoped; user controls carry an explicit view ID. */
export function useNativeOriginPopupBridge() {
  const current = useRef<{
    source: OriginBrowserIdentity | null;
    viewId: string | null;
    revision: number;
    pending: Promise<unknown> | null;
  }>({ source: null, viewId: null, revision: 0, pending: null });
  const [selection, setSelection] = useState<OriginPopupReference | null>(null);
  const [pending, setPending] = useState(false);
  const bridge = useMemo(() => {
    let presentation: {
      source: OriginBrowserIdentity;
      action: Extract<OriginBrowserAction, { kind: "presentation" }>;
      acknowledged: Promise<void>;
    } | null = null;
    const targeted = async (
      source: OriginBrowserIdentity,
      action: object,
      root: () => Promise<void>,
    ) => {
      const captured = current.current;
      if (captured.pending) await captured.pending;
      if (current.current !== captured) return; // a superseding selection wins
      const viewId = samePopupSource(captured.source, source)
        ? captured.viewId
        : null;
      if (
        !samePopupSource(captured.source, source) ||
        (viewId === null && captured.revision === 0)
      ) {
        await root();
        return;
      }
      await popupRequest(source, { ...action, viewId });
    };
    const browserTransport: OriginBrowserTransport = {
      ...tauriOriginBrowserTransport,
      navigate: ({ identity, url }) =>
        targeted(identity, { kind: "navigate", url }, () =>
          tauriOriginBrowserTransport.navigate({ identity, url }),
        ),
      control: ({ identity, action }) => {
        if (action.kind === "presentation") {
          const acknowledged = tauriOriginBrowserTransport.control({
            identity,
            action,
          });
          presentation = { source: identity, action, acknowledged };
          return acknowledged;
        }
        return targeted(identity, { kind: "control", action }, () =>
          tauriOriginBrowserTransport.control({ identity, action }),
        );
      },
    };
    const popupTransport: OriginPopupTransport = {
      subscribe: async (source, callback) =>
        listen<unknown>(
          "origin-browser-popups",
          (event) => {
            const payload = event.payload as {
              sourceIdentity?: OriginBrowserIdentity;
            } | null;
            if (samePopupSource(source, payload?.sourceIdentity))
              callback(event.payload);
          },
          {
            target: {
              kind: "WebviewWindow",
              label: getCurrentWebviewWindow().label,
            },
          },
        ),
      list: (source) => popupRequest(source, { kind: "list" }),
      adopt: (ref) =>
        popupRequest(ref.sourceIdentity, { kind: "adopt", viewId: ref.viewId }),
      close: async (ref) => {
        await popupRequest(ref.sourceIdentity, {
          kind: "close",
          viewId: ref.viewId,
        });
      },
    };
    const activate = async (
      source: OriginBrowserIdentity,
      reference: OriginPopupReference | null,
    ) => {
      if (reference && !samePopupSource(reference.sourceIdentity, source))
        throw new Error("Popup owner changed.");
      if (
        current.current.source &&
        !samePopupSource(current.current.source, source)
      )
        throw new Error("Popup source was replaced.");
      const previous = current.current;
      const revision = samePopupSource(current.current.source, source)
        ? current.current.revision + 1
        : 1;
      const next = {
        source,
        viewId: reference?.viewId ?? null,
        revision,
        pending: null as Promise<unknown> | null,
      };
      next.pending = popupRequest(source, {
        kind: "select",
        viewId: next.viewId,
        revision,
      });
      current.current = next;
      setPending(true);
      try {
        await next.pending;
        if (current.current === next) setSelection(reference);
      } catch (error) {
        if (current.current === next) {
          current.current = { ...previous, revision, pending: null };
          setPending(false);
        }
        throw error;
      } finally {
        if (current.current === next) {
          next.pending = null;
          setPending(false);
        }
      }
    };
    const bind = (source: OriginBrowserIdentity | null) => {
      if (samePopupSource(source, current.current.source)) return;
      current.current = { source, viewId: null, revision: 0, pending: null };
      setSelection(null);
      setPending(false);
    };
    // Call only after the shell committed closing its overlay. Presentation is
    // acknowledged before focus; both ACKs must still refer to this exact
    // selection incarnation (including A-B-A) before a single mutation.
    const runInteractive = async (
      source: OriginBrowserIdentity,
      viewId: string | null,
      assertCurrent: () => void,
      mutation: (presentationRevision: number) => Promise<unknown>,
    ) => {
      const selected = current.current;
      const shown = presentation;
      const check = () => {
        assertCurrent();
        if (
          document.hidden ||
          current.current !== selected ||
          selected.pending ||
          !samePopupSource(selected.source, source) ||
          selected.viewId !== viewId ||
          !shown ||
          presentation !== shown ||
          !samePopupSource(shown.source, source) ||
          !shown.action.visible ||
          shown.action.inputBlocked ||
          !shown.action.bounds
        )
          throw new Error("The selected website presentation changed.");
      };
      check();
      await shown!.acknowledged;
      check();
      const revision = shown!.action.revision;
      await popupRequest(source, {
        kind: "control",
        viewId,
        action: { kind: "focus", presentationRevision: revision },
      });
      check();
      return mutation(revision);
    };
    return { browserTransport, popupTransport, activate, bind, runInteractive };
  }, []);
  return { ...bridge, selection, pending };
}
