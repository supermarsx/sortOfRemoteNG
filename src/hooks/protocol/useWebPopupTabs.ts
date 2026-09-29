import { useEffect, useLayoutEffect, useRef } from "react";
import type { Dispatch, RefObject } from "react";
import type { ConnectionAction } from "../../contexts/ConnectionContextTypes";
import type { ConnectionSession } from "../../types/connection/connection";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import { webPopupTabs } from "../../utils/protocol/webPopupTabs";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";

interface Options {
  session: ConnectionSession;
  sessions: readonly ConnectionSession[];
  enabled: boolean;
  iframe: RefObject<HTMLIFrameElement | null>;
  getDocument: () => WebAutomationDocument | null;
  getProxyUrl: () => string;
  dispatch: Dispatch<ConnectionAction>;
  onActivateSession?: (id: string) => void;
}

const sameDocument = (
  a: WebAutomationDocument | null,
  b: WebAutomationDocument,
) =>
  !!a &&
  a.sessionId === b.sessionId &&
  a.generation === b.generation &&
  a.sequence === b.sequence &&
  a.token === b.token &&
  a.navigationToken === b.navigationToken;

function popupTitle(path: string): string | null {
  if (/^\/takecontrol\/[^/]+\/?$/.test(path)) return "Take Control";
  if (/^\/remotebackground\/[^/]+\/?$/.test(path)) return "Remote Background";
  if (/^\/webvnc\/[^/]+\/[0-9]+\/?$/.test(path)) return "Remote VNC";
  if (/^\/webterm\/?$/.test(path)) return "Remote Terminal";
  return null;
}

/** Only the accepted source frame can open a source-owned, runtime-only tab. */
export function useWebPopupTabs(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const children = useRef(
    new Map<
      string,
      {
        id: string;
        pendingSessions: readonly ConnectionSession[];
        activationScheduled: boolean;
      }
    >(),
  );

  useLayoutEffect(() => {
    for (const child of children.current.values()) {
      const present = options.sessions.some(
        (session) => session.id === child.id,
      );
      if (
        !webPopupTabs.isCurrent(child.id) ||
        (!present && options.sessions !== child.pendingSessions)
      ) {
        webPopupTabs.close(child.id);
      } else if (present && !child.activationScheduled) {
        child.activationScheduled = true;
        requestAnimationFrame(() => {
          if (
            latest.current.sessions.some((session) => session.id === child.id)
          )
            webPopupTabs.focus(child.id);
        });
      }
    }
  });

  useEffect(() => {
    const sourceId = options.session.id;
    const owned = children.current;
    let disposed = false;
    const receive = (event: MessageEvent) => {
      const current = latest.current;
      const frame = current.iframe.current;
      const doc = current.getDocument();
      const message = event.data;
      if (
        disposed ||
        !current.enabled ||
        !frame ||
        !doc ||
        event.source !== frame.contentWindow ||
        !message ||
        message.type !== "proxy_web_popup" ||
        message.version !== 1 ||
        message.sessionId !== doc.sessionId ||
        message.documentSequence !== doc.sequence ||
        message.documentToken !== doc.token ||
        message.navigationToken !== doc.navigationToken ||
        typeof message.id !== "string" ||
        !/^[0-9a-f]{32}$/.test(message.id)
      )
        return;
      const proxyUrl = current.getProxyUrl();
      let origin: string;
      try {
        origin = new URL(proxyUrl).origin;
        if (event.origin !== origin || new URL(message.url).origin !== origin)
          return;
      } catch {
        return;
      }
      const existing = owned.get(message.id)?.id;
      if (message.action === "close") {
        if (existing) webPopupTabs.close(existing, doc);
        return;
      }
      if (message.action === "focus") {
        if (existing) webPopupTabs.focus(existing, doc);
        return;
      }
      if (message.action !== "open" && message.action !== "navigate") return;
      let title: string | null;
      let url: URL;
      try {
        if (
          typeof message.destination !== "string" ||
          message.destination.length > 16_384
        )
          return;
        url = new URL(message.destination);
        title = popupTitle(url.pathname);
        if (
          !title ||
          url.origin !== origin ||
          url.username ||
          url.password ||
          url.searchParams.getAll("__sorng_popup_parent_v1").length !== 1 ||
          url.searchParams.get("__sorng_popup_parent_v1") !==
            String(doc.sequence)
        )
          return;
      } catch {
        return;
      }
      if (existing) {
        webPopupTabs.navigate(existing, doc, url.href);
        return;
      }
      if (message.action !== "open") return;
      try {
        const source = current.session;
        const assertOwner = captureSessionDatabaseAccess(source);
        const sourceWindow = frame.contentWindow;
        const isCurrent = () => {
          assertOwner();
          const now = latest.current;
          return (
            !disposed &&
            now.enabled &&
            now.session.id === sourceId &&
            now.session.status === "connected" &&
            now.session.connectionId === source.connectionId &&
            now.session.ownerDatabaseId === source.ownerDatabaseId &&
            now.session.layout?.windowId === source.layout?.windowId &&
            now.iframe.current?.contentWindow === sourceWindow &&
            sameDocument(now.getDocument(), doc) &&
            now.getProxyUrl() === proxyUrl
          );
        };
        const popup = webPopupTabs.open({
          source,
          document: doc,
          proxyUrl,
          url: url.href,
          isCurrent,
          onFocus: (id) => {
            if (latest.current.sessions.some((session) => session.id === id))
              latest.current.onActivateSession?.(id);
          },
          onClose: (id) => {
            owned.delete(message.id);
            latest.current.dispatch({ type: "REMOVE_SESSION", payload: id });
            if (!disposed && sameDocument(latest.current.getDocument(), doc)) {
              sourceWindow?.postMessage(
                {
                  type: "sorng_web_popup",
                  version: 1,
                  action: "closed",
                  id: message.id,
                  sessionId: doc.sessionId,
                  documentSequence: doc.sequence,
                },
                origin,
              );
            }
          },
        });
        owned.set(message.id, {
          id: popup.id,
          pendingSessions: current.sessions,
          activationScheduled: false,
        });
        current.dispatch({
          type: "ADD_SESSION",
          payload: { ...popup, name: title },
        });
      } catch {
        // No fresh proxy, anonymous tab, or direct-network fallback on refusal.
        frame.contentWindow?.postMessage(
          {
            type: "sorng_web_popup",
            version: 1,
            action: "closed",
            id: message.id,
            sessionId: doc.sessionId,
            documentSequence: doc.sequence,
          },
          origin,
        );
      }
    };
    window.addEventListener("message", receive);
    return () => {
      disposed = true;
      window.removeEventListener("message", receive);
      webPopupTabs.revokeSource(sourceId);
      owned.clear();
    };
  }, [options.session.id]);
}
