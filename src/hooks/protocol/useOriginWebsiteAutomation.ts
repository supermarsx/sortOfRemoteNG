"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  captureWebAutomationAccess,
  useWebAutomation,
  type WebAutomationOptions,
} from "./useWebAutomation";
import { resolveHttpAutomationPermissions } from "../../utils/connection/sessionQuickActions";
import {
  OriginWebsiteAutomationBridge,
  nativeAutomationDocument,
  requestNativeAutomation,
  type OriginAutomationDocument,
  type OriginAutomationTransport,
} from "../../utils/recording/originWebsiteAutomationBridge";
export type {
  OriginAutomationDocument,
  OriginAutomationTransport,
} from "../../utils/recording/originWebsiteAutomationBridge";

export const tauriOriginAutomationTransport: OriginAutomationTransport = {
  request: (request) => invoke("origin_browser_automation", { request }),
};
export interface UseOriginWebsiteAutomationOptions extends Omit<
  WebAutomationOptions,
  | "iframe"
  | "getDocument"
  | "bridge"
  | "nativeAppearance"
  | "appearanceScopeKey"
  | "navigationKey"
> {
  /** Current native attempt. Null until attached; never a renderer-generated ID. */
  identity?: OriginBrowserIdentity | null;
  /** Changes on load start/end and native current-URL changes, not title updates. */
  navigationKey?: string;
  /** Optional native receipt supplied by a caller that already fetched it. */
  document?: OriginAutomationDocument | null;
  assertOwner: () => void;
  transport?: OriginAutomationTransport;
}

/** Protected library/replay reuse, native-only document getter and execution. */
export function useOriginWebsiteAutomation(
  options: UseOriginWebsiteAutomationOptions,
) {
  const latest = useRef(options);
  latest.current = options;
  const transport = options.transport ?? tauriOriginAutomationTransport;
  const [refresh, setRefresh] = useState(0);
  const documentKey = JSON.stringify([
    options.identity,
    options.document,
    options.navigationKey,
    options.scopeKey,
    options.ownerDatabaseId,
    options.blocked,
    options.settingsReady,
    refresh,
  ]);
  const [fetched, setFetched] = useState<{
    key: string;
    document: OriginAutomationDocument | null;
    failed: boolean;
  } | null>(null);
  const keyRef = useRef(documentKey);
  keyRef.current = documentKey;
  const activeDocument =
    options.document !== undefined
      ? options.document
      : fetched?.key === documentKey
        ? fetched.document
        : null;
  const documentRef = useRef(activeDocument);
  documentRef.current = activeDocument;
  const currentDocument = () => {
    const document = documentRef.current;
    const current = latest.current;
    if (
      !document ||
      document.identity.ownerDatabaseId !== current.ownerDatabaseId ||
      document.identity.connectionId !== current.connection?.id
    )
      return null;
    // A supplied receipt must belong to this tab and attempt too. A reconnect
    // can retain the same connection/database while replacing the native owner.
    if (
      current.identity !== undefined &&
      (!current.identity ||
        document.identity.ownerDatabaseId !==
          current.identity.ownerDatabaseId ||
        document.identity.connectionId !== current.identity.connectionId ||
        document.identity.sessionId !== current.identity.sessionId ||
        document.identity.attemptId !== current.identity.attemptId)
    )
      return null;
    return document;
  };
  const assertCurrent = () => {
    const current = latest.current;
    if (
      current.blocked ||
      !current.settingsReady ||
      !current.scopeKey ||
      !current.connection ||
      current.connection.isGroup
    )
      throw new Error("Native automation is unavailable.");
    current.assertOwner();
    captureWebAutomationAccess(current.ownerDatabaseId)();
  };
  useLayoutEffect(() => {
    let active = true;
    if (
      options.document !== undefined ||
      !options.identity ||
      options.blocked ||
      !options.settingsReady ||
      !options.scopeKey
    )
      return;
    const identity = { ...options.identity };
    try {
      assertCurrent();
      if (
        identity.ownerDatabaseId !== options.ownerDatabaseId ||
        identity.connectionId !== options.connection?.id
      )
        throw new Error();
    } catch {
      return;
    }
    void requestNativeAutomation(transport, {
      identity,
      operation: { action: "document" },
    }).then(
      (reply) => {
        if (!active || keyRef.current !== documentKey) return;
        try {
          assertCurrent();
          setFetched({
            key: documentKey,
            document: nativeAutomationDocument(identity, reply),
            failed: false,
          });
        } catch {
          setFetched({ key: documentKey, document: null, failed: true });
        }
      },
      () => {
        if (active && keyRef.current === documentKey)
          setFetched({ key: documentKey, document: null, failed: true });
      },
    );
    return () => {
      active = false;
    };
    // documentKey captures all scope primitives. Callback identity is not a
    // navigation, and must not trigger a new receipt on every UI render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, transport]);
  const bridge = useMemo(
    () =>
      new OriginWebsiteAutomationBridge(() => {
        const current = latest.current,
          document = currentDocument();
        try {
          assertCurrent();
          if (!document || !current.connection) return null;
          const permissions = resolveHttpAutomationPermissions(
            current.settings.sessionQuickActions,
            current.connection.httpAutomation,
          );
          return {
            ...document,
            scriptInjectionEnabled: permissions.scriptInjectionEnabled,
            interactionMacrosEnabled: permissions.interactionMacrosEnabled,
          };
        } catch {
          return null;
        }
        // A new attempt/explicit refresh recreates a transport whose cancellation
        // failed; native document tokens still prohibit retargeting old cleanup.
      }, transport),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      transport,
      options.identity?.ownerDatabaseId,
      options.identity?.connectionId,
      options.identity?.sessionId,
      options.identity?.attemptId,
      refresh,
    ],
  );
  useLayoutEffect(() => () => bridge.dispose(), [bridge]);
  useLayoutEffect(() => {
    bridge.cancel();
  }, [bridge, documentKey]);
  const automation = useWebAutomation({
    ...options,
    bridge,
    nativeAppearance: true,
    blocked: options.blocked || !activeDocument,
    navigationKey: JSON.stringify([documentKey, activeDocument]),
    getDocument: () => {
      const document = currentDocument();
      try {
        assertCurrent();
        if (!document) return null;
      } catch {
        return null;
      }
      return {
        generation: 0,
        sessionId: document.identity.sessionId,
        token: document.documentToken,
        sequence: 0,
        navigationToken: document.identity.attemptId,
        url: document.origin,
      };
    },
  });
  const documentUnavailable = fetched?.key === documentKey && fetched.failed;
  return {
    ...automation,
    documentUnavailable,
    refreshDocument: () => {
      automation.cancel();
      setRefresh((value) => value + 1);
    },
    error: documentUnavailable
      ? "Native automation needs a ready HTTPS document. Refresh after loading, or reconnect if the owner changed."
      : automation.error,
  };
}
