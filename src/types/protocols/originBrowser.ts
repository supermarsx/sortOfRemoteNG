/** Trusted shell IPC only. The native host resolves parents, routes and secrets. */
export interface OriginBrowserOwner {
  readonly ownerDatabaseId: string;
  readonly connectionId: string;
  /** Connection tab/session ID, matching native BrowserIdentity::session_id. */
  readonly sessionId: string;
}

export interface OriginBrowserIdentity extends OriginBrowserOwner {
  /** Native allocated; a renderer requestId is never an attemptId. */
  readonly attemptId: string;
}

/** Logical pixels relative to the containing app content view. No DPI scaling. */
export interface OriginBrowserBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type OriginBrowserConsent =
  | { readonly kind: "required" }
  | { readonly kind: "existing-grant"; readonly grantId: string };

export interface OriginBrowserPolicy {
  readonly darkMode: "forced";
  readonly autoLogin: {
    readonly enabled: true;
    /** A reference only; native must verify owner, origin, scope and validity. */
    readonly consent: OriginBrowserConsent;
  };
}

export type OriginBrowserUnavailableReason =
  | "runtime-missing"
  | "platform-unsupported"
  | "containment-unverified"
  | "policy-unavailable"
  | "owner-unavailable"
  | "host-unavailable";

export type OriginBrowserCapability =
  // An authorized create may start the runtime; this is not verified readiness.
  | { readonly availability: "deferred" }
  // Only native acceptance of every required policy may report available.
  | { readonly availability: "available" }
  | {
      readonly availability: "unavailable";
      readonly reason: OriginBrowserUnavailableReason;
    };

export interface OriginBrowserSnapshot {
  readonly identity: OriginBrowserIdentity;
  /** Monotonic per native attempt, including status replies and events. */
  readonly sequence: number;
  /** Attachment is a lifecycle fact, never a provider-login readiness claim. */
  readonly phase: "starting" | "attached" | "closing" | "closed" | "failed";
  /** Native redacts credentials, query and fragment before emitting. */
  readonly displayUrl: string;
  /** Owner-window address only: full HTTP(S) URL without userinfo. Never log,
   * persist or copy into diagnostics. Optional for older native payloads. */
  readonly currentUrl?: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** Volatile Quick Connect input. No saved-record, route or vault references. */
export interface OriginBrowserQuickConnect {
  readonly protocol: "http" | "https";
  readonly hostname: string;
  readonly port: number;
  readonly httpVerifySsl: boolean;
  readonly basicAuthUsername?: string;
  readonly basicAuthPassword?: string;
}

export interface OriginBrowserCreateRequest {
  readonly quickConnect?: OriginBrowserQuickConnect;
  readonly owner: OriginBrowserOwner;
  /** Compare with authoritative native database state; not renderer authority. */
  readonly expectedSecurityRevision: string;
  /** Required managed unlock-session proof; no unprotected/legacy fallback. */
  readonly sourceSessionId: string;
  readonly requestId: string;
  /** Requested source URL. Native validates the saved connection before use. */
  readonly initialUrl: string;
  readonly bounds: OriginBrowserBounds;
  /** Create hidden and unfocused, including while awaiting the reply. */
  readonly visible: false;
  readonly policy: OriginBrowserPolicy;
}

export interface OriginBrowserCreateResult {
  readonly requestId: string;
  readonly snapshot: OriginBrowserSnapshot;
}

export type OriginBrowserAction =
  | {
      readonly kind: "zoom";
      /** Finite percentage in the inclusive range 25–500. */
      readonly percent: number;
      readonly presentationRevision: number;
    }
  | {
      readonly kind: "find";
      /** Correlation only; owner/attempt authority stays native. */
      readonly requestId?: string;
      /** Nonempty, at most 1,024 UTF-8 bytes; no NUL. */
      readonly text: string;
      readonly forward: boolean;
      readonly matchCase: boolean;
      readonly findNext: boolean;
      readonly presentationRevision: number;
    }
  | {
      readonly kind: "stop-find";
      readonly clearSelection: boolean;
      readonly presentationRevision: number;
    }
  | {
      readonly kind: "presentation";
      /** Native ignores older revisions, including queued UI-thread work. */
      readonly revision: number;
      readonly bounds: OriginBrowserBounds | null;
      readonly visible: boolean;
      /** Window-logical rectangles covered by shell menus/dialogs. */
      readonly occlusions?: readonly OriginBrowserBounds[];
      readonly inputBlocked?: boolean;
    }
  | {
      readonly kind: "focus";
      /** Native only focuses the current visible presentation revision. */
      readonly presentationRevision: number;
    }
  | { readonly kind: "back" | "forward" | "reload" | "stop" };

export interface OriginBrowserStatusRequest {
  readonly owner: OriginBrowserOwner;
  readonly identity?: OriginBrowserIdentity;
}

export const ORIGIN_BROWSER_FIND_EVENT = "origin-browser-find-result";
export interface OriginBrowserFindResult {
  readonly requestId: string;
  readonly activeMatchOrdinal: number;
  readonly numberOfMatches: number;
  readonly finalUpdate: boolean;
}
export interface OriginBrowserFindEvent {
  readonly sourceIdentity: OriginBrowserIdentity;
  readonly viewId: string | null;
  readonly result: OriginBrowserFindResult;
}

export interface OriginBrowserStatusResult {
  readonly capability: OriginBrowserCapability;
  readonly snapshot: OriginBrowserSnapshot | null;
}

export const ORIGIN_BROWSER_STATE_EVENT = "origin-browser-state";

/** All invokes use `{ request }`. Close is idempotent, revokes immediately and
 * resolves only after native cleanup is acknowledged.
 * Native must also close on owner lock, window destruction and host failure;
 * renderer teardown is best effort and cannot enforce those boundaries.
 */
export interface OriginBrowserTransport {
  create(
    request: OriginBrowserCreateRequest,
  ): Promise<OriginBrowserCreateResult>;
  navigate(request: {
    identity: OriginBrowserIdentity;
    url: string;
  }): Promise<void>;
  control(request: {
    identity: OriginBrowserIdentity;
    action: OriginBrowserAction;
  }): Promise<void>;
  close(request: { identity: OriginBrowserIdentity }): Promise<void>;
  status(
    request: OriginBrowserStatusRequest,
  ): Promise<OriginBrowserStatusResult>;
  listen(
    listener: (snapshot: OriginBrowserSnapshot) => void,
  ): Promise<() => void>;
}

/** Mirrors native control.rs; zero/minimized bounds mean hide, never resize. */
export function originBrowserBounds(
  value: OriginBrowserBounds | null,
): OriginBrowserBounds | null {
  if (
    !value ||
    ![value.x, value.y, value.width, value.height].every(Number.isFinite) ||
    value.x < 0 ||
    value.y < 0 ||
    value.width < 1 ||
    value.height < 1 ||
    value.x + value.width > 32_768 ||
    value.y + value.height > 32_768 ||
    value.width * value.height > 67_108_864
  )
    return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
