import {
  originBrowserFailureReason,
  type OriginBrowserIdentity,
  type OriginBrowserSnapshot,
} from "./originBrowser";

/** Child commands always retain the source attempt/session, including its
 * original quick-connect:<sourceSessionId> owner. viewId is native allocated. */
export interface OriginPopupReference {
  readonly sourceIdentity: OriginBrowserIdentity;
  readonly viewId: string;
}

export interface OriginPopupView {
  readonly viewId: string;
  readonly disposition: "foreground" | "background";
  readonly phase: "available" | "adopted" | "closing";
  /** Optional, bounded owner-window display data. Never persisted. */
  readonly title?: string;
  readonly snapshot?: OriginBrowserSnapshot;
}

/** Full inventory, monotonic per SOURCE attempt, including removals. Pending
 * native creations are omitted until their real OnAfterCreated callback. */
export interface OriginPopupInventory {
  readonly sourceIdentity: OriginBrowserIdentity;
  readonly sequence: number;
  readonly sourceClosed: boolean;
  readonly views: readonly OriginPopupView[];
}

/** Main supplies authenticated owner-window IPC once native wiring is ready.
 * No default invoke names, connection creation, URL replay or network fallback.
 * Adoption ACKs registration only; native views remain hidden until presented
 * through child controls addressed by {sourceIdentity, viewId}.
 */
export interface OriginPopupTransport {
  subscribe: (
    sourceIdentity: OriginBrowserIdentity,
    listener: (inventory: unknown) => void,
  ) => Promise<() => void>;
  list: (sourceIdentity: OriginBrowserIdentity) => Promise<unknown>;
  adopt: (reference: OriginPopupReference) => Promise<unknown>;
  /** Accept original owner-window cleanup even after the source lease expires.
   * Resolves when close is requested; inventory removal follows native ACK. */
  close: (reference: OriginPopupReference) => Promise<void>;
}

export const samePopupSource = (
  a: OriginBrowserIdentity | null | undefined,
  b: OriginBrowserIdentity | null | undefined,
) =>
  !!a &&
  !!b &&
  a.ownerDatabaseId === b.ownerDatabaseId &&
  a.connectionId === b.connectionId &&
  a.sessionId === b.sessionId &&
  a.attemptId === b.attemptId;

const id = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  new TextEncoder().encode(value).length <= 256 &&
  !/[\s\p{Cc}]/u.test(value);

/** Shape validation is not authority. Copy only display fields; unknown
 * payload fields can never enter transient tab metadata or a session store. */
export function readPopupInventory(
  value: unknown,
  source: OriginBrowserIdentity,
): OriginPopupInventory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const identity = row.sourceIdentity as OriginBrowserIdentity | undefined;
  if (
    !samePopupSource(identity, source) ||
    ![
      identity?.ownerDatabaseId,
      identity?.connectionId,
      identity?.sessionId,
      identity?.attemptId,
    ].every(id) ||
    !Number.isSafeInteger(row.sequence) ||
    (row.sequence as number) < 0 ||
    typeof row.sourceClosed !== "boolean" ||
    !Array.isArray(row.views) ||
    row.views.length > 16
  )
    return null;
  const seen = new Set<string>();
  const views: OriginPopupView[] = [];
  for (const value of row.views) {
    if (!value || typeof value !== "object") return null;
    const view = value as Record<string, unknown>;
    if (
      !id(view.viewId) ||
      seen.has(view.viewId) ||
      (view.disposition !== "foreground" &&
        view.disposition !== "background") ||
      (view.phase !== "available" &&
        view.phase !== "adopted" &&
        view.phase !== "closing") ||
      (view.title !== undefined &&
        (typeof view.title !== "string" ||
          view.title.length > 512 ||
          /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(view.title)))
    )
      return null;
    seen.add(view.viewId);
    const snapshot = readPopupSnapshot(view.snapshot, source);
    if (view.snapshot != null && !snapshot) return null;
    views.push(
      Object.freeze({
        viewId: view.viewId,
        disposition: view.disposition,
        phase: view.phase,
        ...(view.title !== undefined && { title: view.title as string }),
        ...(snapshot && { snapshot }),
      }),
    );
  }
  return Object.freeze({
    sourceIdentity: Object.freeze({
      ownerDatabaseId: source.ownerDatabaseId,
      connectionId: source.connectionId,
      sessionId: source.sessionId,
      attemptId: source.attemptId,
    }),
    sequence: row.sequence as number,
    sourceClosed: row.sourceClosed,
    views: Object.freeze(views),
  });
}

function readPopupSnapshot(
  value: unknown,
  source: OriginBrowserIdentity,
): OriginBrowserSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !samePopupSource(row.identity as OriginBrowserIdentity, source) ||
    !Number.isSafeInteger(row.sequence) ||
    (row.sequence as number) < 0 ||
    !["attached", "closing", "closed", "failed"].includes(String(row.phase)) ||
    typeof row.title !== "string" ||
    row.title.length > 512 ||
    /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(row.title) ||
    typeof row.displayUrl !== "string" ||
    row.displayUrl.length > 16384 ||
    typeof row.currentUrl !== "string" ||
    row.currentUrl.length > 16384 ||
    ![row.loading, row.canGoBack, row.canGoForward].every(
      (v) => typeof v === "boolean",
    )
  )
    return null;
  for (const text of [row.currentUrl, row.displayUrl]) {
    if (!text || text === "about:blank") continue;
    try {
      const url = new URL(text);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        /[\p{Cc}]/u.test(text)
      )
        return null;
    } catch {
      return null;
    }
  }
  const failureReason = originBrowserFailureReason(
    row.phase,
    row.failureReason,
  );
  return Object.freeze({
    identity: Object.freeze({ ...source }),
    sequence: row.sequence as number,
    phase: row.phase as OriginBrowserSnapshot["phase"],
    ...(failureReason === undefined ? {} : { failureReason }),
    title: row.title,
    displayUrl: row.displayUrl,
    currentUrl: row.currentUrl,
    loading: row.loading as boolean,
    canGoBack: row.canGoBack as boolean,
    canGoForward: row.canGoForward as boolean,
  });
}
