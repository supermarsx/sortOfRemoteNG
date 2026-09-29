import type { ConnectionSession } from "../../types/connection/connection";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import { createWebPopupSession } from "../../components/app/toolSession";
import { generateId } from "../core/id";
import { webPopupTitle } from "./webPopupTitle";
import {
  assertWebBrowserFrameNavigation,
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
} from "./webBrowserFrame";

export type WebPopupDocument = Readonly<
  Pick<
    WebAutomationDocument,
    "generation" | "sessionId" | "token" | "sequence" | "navigationToken"
  >
>;

export interface WebPopupSnapshot {
  readonly id: string;
  readonly sourceSessionId: string;
  readonly sourceConnectionId: string;
  readonly ownerDatabaseId: string | undefined;
  readonly sourceWindowId: string | undefined;
  readonly document: WebPopupDocument;
  readonly proxyUrl: string;
  readonly url: string;
}

export interface OpenWebPopupOptions {
  source: ConnectionSession;
  document: WebPopupDocument;
  /** Protected proxy root URL, not an upstream address. */
  proxyUrl: string;
  /** Already mapped and natively authorized child navigation URL. */
  url: string;
  /** Must check the current source owner AND exact root document identity. */
  isCurrent: () => boolean;
  onClose?: (id: string) => void;
  onFocus?: (id: string) => void;
}

type Entry = {
  snapshot: WebPopupSnapshot;
  isCurrent: () => boolean;
  onClose?: (id: string) => void;
  onFocus?: (id: string) => void;
  viewer?: { frame: HTMLIFrameElement };
  childSequence: number;
  childDocument?: {
    sequence: number;
    token: string;
    navigationToken: string | null;
  };
};
export interface WebPopupViewerLease {
  navigate: () => boolean;
  /** Bind native proxy_document_start identity before proxy_web_popup_title v1.
   * Titles must echo the child sequence/token/navigationToken and parent root
   * sequence. Existing readiness reports may omit popupParentSequence.
   * Report URLs validate origin/path only and are never retained.
   */
  receiveTitleReport: (event: MessageEvent) => string | null;
  release: (options?: { preserveTab?: boolean }) => void;
}
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const sameDocument = (a: WebPopupDocument, b: WebPopupDocument) =>
  a.sessionId === b.sessionId &&
  a.generation === b.generation &&
  a.sequence === b.sequence &&
  a.token === b.token &&
  a.navigationToken === b.navigationToken;
const current = (entry: Entry) => {
  try {
    return entry.isCurrent() === true;
  } catch {
    return false;
  }
};
const safely = (callback: () => void) => {
  try {
    callback();
  } catch {
    /* An observer cannot interrupt revocation. */
  }
};
const notify = (id: string) =>
  listeners.get(id)?.forEach((listener) => safely(listener));

function checkedUrl(url: string, proxyUrl: string): string {
  if (url.length > 16_384) throw new Error("Popup navigation is unavailable.");
  assertWebBrowserFrameNavigation(url, proxyUrl, window.location.origin);
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/__sortofremoteng_"))
    throw new Error("Popup navigation is unavailable.");
  return parsed.href;
}

/** Runtime-only child views. No native session, credentials or primary activation.
 * The source bridge must revokeSource synchronously on navigation/owner loss.
 * isCurrent is a second stale-operation guard, not a replacement for revocation.
 */
export const webPopupTabs = {
  open(options: OpenWebPopupOptions): ConnectionSession {
    const { source, document } = options;
    if (
      !["http", "https"].includes(source.protocol) ||
      source.status !== "connected" ||
      !Number.isSafeInteger(document.generation) ||
      document.generation < 0 ||
      !Number.isSafeInteger(document.sequence) ||
      document.sequence < 1 ||
      !document.sessionId ||
      !/^[0-9a-f]{32}$/.test(document.token) ||
      !(
        document.navigationToken === null ||
        typeof document.navigationToken === "string"
      ) ||
      options.isCurrent() !== true
    )
      throw new Error("Popup source is unavailable.");
    const url = checkedUrl(options.url, options.proxyUrl);
    const owned = [...entries.values()].filter(
      (entry) => entry.snapshot.sourceSessionId === source.id,
    );
    if (owned.length >= 8)
      throw new Error("This browser's popup limit has been reached.");
    const id = `web-popup-${generateId()}`;
    const snapshot: WebPopupSnapshot = Object.freeze({
      id,
      sourceSessionId: source.id,
      sourceConnectionId: source.connectionId,
      ownerDatabaseId: source.ownerDatabaseId,
      sourceWindowId: source.layout?.windowId,
      document: Object.freeze({
        generation: document.generation,
        sessionId: document.sessionId,
        token: document.token,
        sequence: document.sequence,
        navigationToken: document.navigationToken,
      }),
      proxyUrl: options.proxyUrl,
      url,
    });
    entries.set(id, {
      snapshot,
      isCurrent: options.isCurrent,
      onClose: options.onClose,
      onFocus: options.onFocus,
      childSequence: document.sequence,
    });
    return createWebPopupSession(id, source);
  },
  getSnapshot(id: string): WebPopupSnapshot | null {
    return entries.get(id)?.snapshot ?? null;
  },
  isCurrent(id: string): boolean {
    const entry = entries.get(id);
    return !!entry && current(entry);
  },
  /** A duplicate shares the original source lease, not the sibling's lifetime. */
  sourceGuard(id: string): () => boolean {
    const entry = entries.get(id);
    return () => !!entry && current(entry);
  },
  subscribe(id: string, listener: () => void): () => void {
    const set = listeners.get(id) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(id);
    };
  },
  navigate(id: string, document: WebPopupDocument, url: string): boolean {
    const entry = entries.get(id);
    if (
      !entry ||
      !sameDocument(entry.snapshot.document, document) ||
      !current(entry)
    )
      return false;
    let mapped: string;
    try {
      mapped = checkedUrl(url, entry.snapshot.proxyUrl);
    } catch {
      return false;
    }
    if (entry.snapshot.url !== mapped) entry.childDocument = undefined;
    entry.snapshot = Object.freeze({ ...entry.snapshot, url: mapped });
    notify(id);
    return true;
  },
  focus(id: string, document?: WebPopupDocument): boolean {
    const entry = entries.get(id);
    if (
      !entry ||
      (document && !sameDocument(entry.snapshot.document, document)) ||
      !current(entry)
    )
      return false;
    entry.onFocus?.(id);
    entry.viewer?.frame.focus();
    return true;
  },
  close(id: string, document?: WebPopupDocument): boolean {
    const entry = entries.get(id);
    if (
      !entry ||
      (document && !sameDocument(entry.snapshot.document, document))
    )
      return false;
    entries.delete(id);
    // Restrict the actual child immediately, including when React has not committed.
    if (entry.viewer) clearWebBrowserFrame(entry.viewer.frame);
    notify(id);
    safely(() => entry.onClose?.(id));
    return true;
  },
  revokeSource(sourceSessionId: string, document?: WebPopupDocument): void {
    for (const [id, entry] of [...entries]) {
      if (
        entry.snapshot.sourceSessionId === sourceSessionId &&
        (!document || sameDocument(entry.snapshot.document, document))
      )
        webPopupTabs.close(id);
    }
  },
  /** Viewer lease cleanup tolerates React StrictMode's setup/cleanup/setup cycle. */
  attachViewer(
    id: string,
    frame: HTMLIFrameElement,
  ): WebPopupViewerLease | null {
    const entry = entries.get(id);
    if (!entry || !current(entry) || entry.viewer) return null;
    const viewer = { frame };
    entry.viewer = viewer;
    return {
      receiveTitleReport: (event) => {
        const message = event.data;
        const root = entry.snapshot.document;
        if (
          entries.get(id) !== entry ||
          entry.viewer !== viewer ||
          !current(entry) ||
          !frame.contentWindow ||
          event.source !== frame.contentWindow ||
          !message ||
          message.version !== 1 ||
          ![
            "proxy_document_start",
            "proxy_navigation_start",
            "proxy_web_popup_title",
          ].includes(message.type) ||
          message.sessionId !== root.sessionId ||
          ((message.type === "proxy_web_popup_title" ||
            message.popupParentSequence !== undefined) &&
            message.popupParentSequence !== root.sequence) ||
          !Number.isSafeInteger(message.documentSequence) ||
          message.documentSequence <= root.sequence ||
          typeof message.documentToken !== "string" ||
          !/^[0-9a-f]{32}$/.test(message.documentToken) ||
          !(
            message.navigationToken === null ||
            (typeof message.navigationToken === "string" &&
              /^[0-9a-f]{32}$/.test(message.navigationToken))
          ) ||
          typeof message.url !== "string" ||
          message.url.length > 16_384
        )
          return null;
        try {
          const origin = new URL(entry.snapshot.proxyUrl).origin;
          const reportUrl = new URL(message.url);
          const popupPath = new URL(entry.snapshot.url).pathname;
          if (
            event.origin !== origin ||
            reportUrl.origin !== origin ||
            reportUrl.username ||
            reportUrl.password ||
            reportUrl.pathname !== popupPath ||
            !/^\/takecontrol\/[^/]+\/?$/.test(popupPath)
          )
            return null;
        } catch {
          return null;
        }
        const child = entry.childDocument;
        const matches =
          child &&
          child.sequence === message.documentSequence &&
          child.token === message.documentToken &&
          child.navigationToken === message.navigationToken;
        if (message.type === "proxy_document_start") {
          if (message.documentSequence > entry.childSequence) {
            entry.childSequence = message.documentSequence;
            entry.childDocument = {
              sequence: message.documentSequence,
              token: message.documentToken,
              navigationToken: message.navigationToken,
            };
          }
          return null;
        }
        if (!matches) return null;
        if (message.type === "proxy_navigation_start") {
          entry.childDocument = undefined;
          return null;
        }
        return typeof message.title === "string"
          ? webPopupTitle(message.title)
          : null;
      },
      navigate: () => {
        if (
          entries.get(id) !== entry ||
          entry.viewer !== viewer ||
          !current(entry)
        )
          return false;
        navigateWebBrowserFrame(
          frame,
          entry.snapshot.url,
          entry.snapshot.proxyUrl,
        );
        return true;
      },
      release: (options) => {
        if (entry.viewer !== viewer) return;
        entry.viewer = undefined;
        queueMicrotask(() => {
          if (entry.viewer?.frame !== frame) clearWebBrowserFrame(frame);
          if (
            !options?.preserveTab &&
            entries.get(id) === entry &&
            !entry.viewer
          )
            webPopupTabs.close(id);
        });
      },
    };
  },
};
