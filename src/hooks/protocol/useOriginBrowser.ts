"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  originBrowserConfigurationDetails,
  originBrowserNavigationUrl as navigationUrl,
  validateOriginBrowserConfiguration,
  type BrowserConfigurationIssue,
} from "./originBrowserConfiguration";
import {
  originBrowserLoadError,
  originBrowserSessionError,
} from "./originBrowserSessionError";
import { getOriginBrowserRuntimeFailureDetail } from "./originBrowserFailureDetails";
import {
  originBrowserStartupError,
  type OriginBrowserStartupStage,
  type OriginBrowserStartupFailure,
} from "./originBrowserStartupError";
import {
  ORIGIN_BROWSER_STATE_EVENT,
  originBrowserBounds,
  originBrowserFailureReason,
  originBrowserLoadFailure,
  originBrowserRuntimeFailure,
  type OriginBrowserAction,
  type OriginBrowserBounds,
  type OriginBrowserConsent,
  type OriginBrowserIdentity,
  type OriginBrowserOwner,
  type OriginBrowserQuickConnect,
  type OriginBrowserRuntimeFailure,
  type OriginBrowserSnapshot,
  type OriginBrowserTransport,
  type OriginBrowserUnavailableReason,
} from "../../types/protocols/originBrowser";

export const tauriOriginBrowserTransport: OriginBrowserTransport = {
  create: (request) => invoke("origin_browser_create", { request }),
  navigate: (request) => invoke("origin_browser_navigate", { request }),
  control: (request) => invoke("origin_browser_control", { request }),
  close: (request) => invoke("origin_browser_close", { request }),
  status: (request) => invoke("origin_browser_status", { request }),
  listen: (listener) =>
    listen<OriginBrowserSnapshot>(ORIGIN_BROWSER_STATE_EVENT, (event) =>
      listener(event.payload),
    ),
};

export interface UseOriginBrowserOptions {
  quickConnect?: OriginBrowserQuickConnect;
  owner: OriginBrowserOwner;
  expectedSecurityRevision: string;
  sourceSessionId: string;
  initialUrl: string;
  enabled: boolean;
  ownerAvailable: boolean;
  active: boolean;
  /** Include menus, trust prompts and any UI which can overlap the child. */
  dialogOpen: boolean;
  /** Native region clipping keeps the uncovered browser painting. */
  preserveRenderingUnderOverlays?: boolean;
  occlusions?: readonly OriginBrowserBounds[];
  consent: OriginBrowserConsent;
  transport?: OriginBrowserTransport;
  /** Captured local owner lease, checked again immediately before native work. */
  assertOwner?: () => void;
}

export interface OriginBrowserState {
  phase:
    | "idle"
    | "starting"
    | "attached"
    | "closing"
    | "closed"
    | "unavailable"
    | "error";
  snapshot: OriginBrowserSnapshot | null;
  unavailableReason: OriginBrowserUnavailableReason | null;
  error: string | null;
  /** Safe classification for shell recovery UI; never contains native error text. */
  startupFailure?: OriginBrowserStartupFailure | null;
  /** Fixed validation codes; never the rejected URL, reference or login grant. */
  configurationFailure?: { issues: BrowserConfigurationIssue[] } | null;
  operationFailure?:
    "presentation" | "navigation" | "control" | "state" | "cleanup" | null;
  runtimeFailure?: OriginBrowserRuntimeFailure | null;
}

const initialState: OriginBrowserState = {
  phase: "idle",
  snapshot: null,
  unavailableReason: null,
  error: null,
  startupFailure: null,
  configurationFailure: null,
  operationFailure: null,
  runtimeFailure: null,
};

function sameOwner(a: OriginBrowserOwner, b: OriginBrowserOwner) {
  return (
    a.ownerDatabaseId === b.ownerDatabaseId &&
    a.connectionId === b.connectionId &&
    a.sessionId === b.sessionId
  );
}

function validIdentity(
  value: OriginBrowserIdentity | undefined,
): value is OriginBrowserIdentity {
  return (
    !!value &&
    [
      value.ownerDatabaseId,
      value.connectionId,
      value.sessionId,
      value.attemptId,
    ].every(
      (part) =>
        typeof part === "string" && part.length > 0 && part.length <= 256,
    )
  );
}

function copyIdentity(identity: OriginBrowserIdentity): OriginBrowserIdentity {
  return Object.freeze({
    ownerDatabaseId: identity.ownerDatabaseId,
    connectionId: identity.connectionId,
    sessionId: identity.sessionId,
    attemptId: identity.attemptId,
  });
}

function sameIdentity(a: OriginBrowserIdentity, b: OriginBrowserIdentity) {
  return sameOwner(a, b) && a.attemptId === b.attemptId;
}

function printable(character: string) {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127;
}

/** Owner-window display state, NOT diagnostics. Full URLs can contain secrets;
 * keep them in volatile controller state and never log or persist snapshots. */
function shellSnapshot(
  value: OriginBrowserSnapshot,
): OriginBrowserSnapshot | null {
  if (
    !value ||
    !validIdentity(value.identity) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !["starting", "attached", "closing", "closed", "failed"].includes(
      value.phase,
    ) ||
    typeof value.displayUrl !== "string" ||
    value.displayUrl.length > 16_384 ||
    (value.currentUrl !== undefined && typeof value.currentUrl !== "string") ||
    typeof value.title !== "string" ||
    value.title.length > 512 ||
    typeof value.loading !== "boolean" ||
    typeof value.canGoBack !== "boolean" ||
    typeof value.canGoForward !== "boolean"
  )
    return null;
  let displayUrl = "";
  if (value.displayUrl) {
    const url = navigationUrl(value.displayUrl);
    if (!url) return null;
    const redacted = new URL(url);
    redacted.search = "";
    redacted.hash = "";
    displayUrl = redacted.href;
  }
  let currentUrl: string | undefined;
  if (value.currentUrl !== undefined) {
    currentUrl =
      value.currentUrl === ""
        ? ""
        : (navigationUrl(value.currentUrl) ?? undefined);
    if (
      currentUrl === undefined ||
      new TextEncoder().encode(currentUrl).length > 16_384
    )
      return null;
  }
  const failureReason = originBrowserFailureReason(
    value.phase,
    value.failureReason,
  );
  const loadFailure = originBrowserLoadFailure(value.phase, value.loadFailure);
  return {
    identity: copyIdentity(value.identity),
    sequence: value.sequence,
    phase: value.phase,
    ...(failureReason === undefined ? {} : { failureReason }),
    ...(loadFailure === undefined ? {} : { loadFailure }),
    displayUrl,
    ...(currentUrl === undefined ? {} : { currentUrl }),
    title: Array.from(value.title).filter(printable).join(""),
    loading: value.loading,
    canGoBack: value.canGoBack,
    canGoForward: value.canGoForward,
  };
}

interface Attempt {
  cancelled: boolean;
  verified: boolean;
  pendingSnapshot: OriginBrowserSnapshot | null;
  attached: boolean;
  identity: OriginBrowserIdentity | null;
  closeTask: Promise<boolean> | null;
  startup: Promise<void>;
  unsubscribe: (() => void) | null;
  sequence: number;
  presentationRevision: number;
  presentationKey: string;
  transport: OriginBrowserTransport;
  publish: (snapshot: OriginBrowserSnapshot) => void;
  fail: (
    operation?: NonNullable<OriginBrowserState["operationFailure"]>,
  ) => void;
}

export function useOriginBrowser(options: UseOriginBrowserOptions) {
  const {
    owner: { ownerDatabaseId, connectionId, sessionId },
    expectedSecurityRevision,
    sourceSessionId,
    initialUrl: sourceUrl,
    enabled,
    ownerAvailable,
    active,
    dialogOpen,
    preserveRenderingUnderOverlays = false,
    occlusions,
    consent,
    transport = tauriOriginBrowserTransport,
    assertOwner,
    quickConnect: sourceQuickConnect,
  } = options;
  // An explicit address-bar hop in a temporary browser is new authority for
  // that destination, not permission for the old page to contact arbitrary
  // sites. Retire its private context before creating the replacement.
  const temporaryScope = JSON.stringify([
    ownerDatabaseId,
    connectionId,
    sessionId,
    expectedSecurityRevision,
    sourceSessionId,
    sourceUrl,
  ]);
  const [temporaryTarget, setTemporaryTarget] = useState<{
    scope: string;
    definition: OriginBrowserQuickConnect;
    url: string;
  } | null>(null);
  const initialUrl =
    sourceQuickConnect &&
    temporaryTarget?.scope === temporaryScope &&
    temporaryTarget.definition === sourceQuickConnect
      ? temporaryTarget.url
      : sourceUrl;
  const quickConnect = useMemo(() => {
    if (!sourceQuickConnect || initialUrl === sourceUrl)
      return sourceQuickConnect;
    const target = new URL(initialUrl);
    const original = new URL(sourceUrl);
    const sameOrigin = target.origin === original.origin;
    return Object.freeze({
      protocol:
        target.protocol === "https:" ? ("https" as const) : ("http" as const),
      hostname: target.href,
      port: Number(target.port || (target.protocol === "https:" ? 443 : 80)),
      // Never carry Basic Auth into a different website. Cookie/profile data
      // is isolated by the newly allocated native attempt too.
      httpVerifySsl: sameOrigin ? sourceQuickConnect.httpVerifySsl : true,
      ...(sameOrigin &&
        sourceQuickConnect.basicAuthUsername !== undefined && {
          basicAuthUsername: sourceQuickConnect.basicAuthUsername,
        }),
      ...(sameOrigin &&
        sourceQuickConnect.basicAuthPassword !== undefined && {
          basicAuthPassword: sourceQuickConnect.basicAuthPassword,
        }),
    });
  }, [sourceQuickConnect, initialUrl, sourceUrl]);
  const consentKind = consent.kind;
  const grantId = consent.kind === "existing-grant" ? consent.grantId : null;
  const [state, setState] = useState<OriginBrowserState>(initialState);
  const [generation, setGeneration] = useState(0);
  const commandScope = JSON.stringify([
    ownerDatabaseId,
    connectionId,
    sessionId,
    expectedSecurityRevision,
    sourceSessionId,
    initialUrl,
    consentKind,
    grantId,
    generation,
  ]);
  const latestScope = useRef(commandScope);
  useLayoutEffect(() => {
    latestScope.current = commandScope;
  }, [commandScope]);
  const current = useRef<Attempt | null>(null);
  const retiring = useRef(new Map<string, Promise<boolean>>());
  const viewport = useRef<OriginBrowserBounds | null>(null);
  const ownerGuard = useRef(assertOwner);
  useLayoutEffect(() => {
    ownerGuard.current = assertOwner;
  }, [assertOwner]);
  const presentation = useRef({
    active: false,
    dialogOpen: true,
    ownerAvailable: false,
    enabled: false,
    preserveRenderingUnderOverlays: false,
    occlusions: undefined as readonly OriginBrowserBounds[] | undefined,
  });

  const closeAttempt = useCallback(
    async (attempt: Attempt): Promise<boolean> => {
      attempt.cancelled = true;
      attempt.pendingSnapshot = null;
      attempt.unsubscribe?.();
      attempt.unsubscribe = null;
      if (!attempt.identity) return true;
      if (!attempt.closeTask) {
        attempt.closeTask = attempt.transport
          .close({ identity: attempt.identity })
          .then(
            () => true,
            () => false,
          );
      }
      // Never expose native error strings, which may contain URLs or secrets.
      return attempt.closeTask;
    },
    [],
  );

  const present = useCallback(() => {
    const attempt = current.current;
    if (!attempt?.identity || attempt.cancelled || !attempt.attached) return;
    const flags = presentation.current;
    const bounds = viewport.current;
    const visible =
      flags.enabled &&
      flags.ownerAvailable &&
      flags.active &&
      (!flags.dialogOpen || flags.preserveRenderingUnderOverlays) &&
      !!bounds;
    const clipping = flags.preserveRenderingUnderOverlays
      ? { occlusions: flags.occlusions ?? [], inputBlocked: flags.dialogOpen }
      : {};
    const key = JSON.stringify({ bounds, visible, ...clipping });
    if (key === attempt.presentationKey) return;
    attempt.presentationKey = key;
    const revision = ++attempt.presentationRevision;
    void attempt.transport
      .control({
        identity: attempt.identity,
        action: {
          kind: "presentation",
          revision,
          bounds,
          visible,
          ...clipping,
        },
      })
      .catch(() => {
        if (
          current.current === attempt &&
          !attempt.cancelled &&
          revision === attempt.presentationRevision
        )
          attempt.fail("presentation");
      });
  }, []);

  // Commit visibility before starting or reconciling asynchronous native work.
  useLayoutEffect(() => {
    presentation.current = {
      active,
      dialogOpen,
      ownerAvailable,
      enabled,
      preserveRenderingUnderOverlays,
      occlusions,
    };
    present();
  }, [
    active,
    dialogOpen,
    ownerAvailable,
    enabled,
    preserveRenderingUnderOverlays,
    occlusions,
    present,
  ]);

  useLayoutEffect(() => {
    const owner = Object.freeze({ ownerDatabaseId, connectionId, sessionId });
    const ownerKey = JSON.stringify([ownerDatabaseId, connectionId, sessionId]);
    const retirement = retiring.current;
    if (!enabled) {
      setState(initialState);
      return;
    }
    if (!ownerAvailable) {
      setState({
        ...initialState,
        phase: "unavailable",
        unavailableReason: "owner-unavailable",
      });
      return;
    }
    const { url, issues } = validateOriginBrowserConfiguration({
      initialUrl,
      ...owner,
      expectedSecurityRevision,
      sourceSessionId,
      consentKind,
      grantId,
    });
    if (!url || issues.length) {
      setState({
        ...initialState,
        phase: "error",
        error: originBrowserConfigurationDetails(issues)
          .map((issue) => issue.problem)
          .join(" "),
        configurationFailure: { issues },
      });
      return;
    }
    const attempt: Attempt = {
      cancelled: false,
      verified: false,
      pendingSnapshot: null,
      attached: false,
      identity: null,
      closeTask: null,
      startup: Promise.resolve(),
      unsubscribe: null,
      sequence: -1,
      presentationRevision: 0,
      presentationKey: "",
      transport,
      publish: () => undefined,
      fail: () => undefined,
    };
    current.current = attempt;
    const live = () => current.current === attempt && !attempt.cancelled;
    attempt.fail = (operation = "state") => {
      if (!live()) return;
      setState({
        ...initialState,
        phase: "error",
        error: "Native browser operation failed.",
        operationFailure: operation,
      });
      void closeAttempt(attempt);
    };
    attempt.publish = (value) => {
      if (
        !live() ||
        !attempt.identity ||
        !validIdentity(value?.identity) ||
        !sameIdentity(value.identity, attempt.identity)
      )
        return;
      const snapshot = shellSnapshot(value);
      if (!snapshot) {
        attempt.fail();
        return;
      }
      if (!attempt.verified) {
        if (
          !attempt.pendingSnapshot ||
          snapshot.sequence > attempt.pendingSnapshot.sequence
        )
          attempt.pendingSnapshot = snapshot;
        return;
      }
      if (snapshot.sequence <= attempt.sequence) return;
      attempt.sequence = snapshot.sequence;
      attempt.attached = snapshot.phase === "attached";
      setState({
        ...initialState,
        snapshot,
        phase:
          snapshot.phase === "failed" || snapshot.loadFailure
            ? "error"
            : snapshot.phase,
        error:
          snapshot.phase === "failed"
            ? originBrowserSessionError(snapshot.failureReason)
            : snapshot.loadFailure
              ? originBrowserLoadError(snapshot.loadFailure)
              : null,
      });
      if (["closing", "closed", "failed"].includes(snapshot.phase)) {
        void closeAttempt(attempt).then((closed) => {
          if (current.current !== attempt || snapshot.phase !== "closing")
            return;
          setState({
            ...initialState,
            phase: closed ? "closed" : "error",
            error: closed
              ? null
              : "Native browser cleanup could not be confirmed.",
            operationFailure: closed ? null : "cleanup",
          });
        });
      } else present();
    };
    setState({ ...initialState, phase: "starting" });
    const unavailable = (
      reason: OriginBrowserUnavailableReason,
      runtimeFailure?: unknown,
    ) => {
      if (!live()) return;
      const safeReason: OriginBrowserUnavailableReason = [
        "runtime-missing",
        "platform-unsupported",
        "containment-unverified",
        "policy-unavailable",
        "owner-unavailable",
        "host-unavailable",
      ].includes(reason)
        ? reason
        : "host-unavailable";
      setState({
        ...initialState,
        phase: "unavailable",
        unavailableReason: safeReason,
        runtimeFailure: originBrowserRuntimeFailure(runtimeFailure) ?? null,
      });
      void closeAttempt(attempt);
    };
    let startupStage: OriginBrowserStartupStage = "listen";
    const startupFailed = async (error: unknown) => {
      if (!live()) return;
      const failure = originBrowserStartupError(startupStage, error);
      let runtimeFailure: OriginBrowserRuntimeFailure | null = null;
      // Deferred initialization can fail inside create. Its legacy rejection
      // string may describe only a wrapper step; prefer the engine's recorded
      // cause when the same owner/attempt still exists. Never reclassify login,
      // permission or arbitrary IPC failures from an unrelated global record.
      if (startupStage === "create" && failure.category === "runtime") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          ownerGuard.current?.();
          const refreshed = await Promise.race([
            transport.status({ owner }),
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), 3000);
            }),
          ]);
          if (!live()) return;
          ownerGuard.current?.();
          if (
            refreshed?.capability?.availability === "unavailable" &&
            originBrowserRuntimeFailure(refreshed.runtimeFailure)
          ) {
            unavailable(
              refreshed.capability.reason ?? "host-unavailable",
              refreshed.runtimeFailure,
            );
            return;
          }
          if (refreshed?.capability?.availability === "deferred") {
            runtimeFailure =
              originBrowserRuntimeFailure(refreshed.runtimeFailure) ?? null;
          }
        } catch {
          // The original allowlisted failure remains useful if this secondary
          // diagnostic lookup fails. Do not replace it with another IPC error.
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      if (!live()) return;
      // Keep the mapper's safe optional recovery discriminator as well as the
      // stage/category. Its fixed display message is not a classification.
      const { message, ...startupFailure } = failure;
      const engine = getOriginBrowserRuntimeFailureDetail(runtimeFailure);
      setState({
        ...initialState,
        phase: "error",
        error: engine ? `${engine.problem} ${engine.nextStep}` : message,
        startupFailure,
        runtimeFailure,
      });
      void closeAttempt(attempt);
    };
    const start = async () => {
      // A reconnect cannot overlap an unacknowledged predecessor, including a
      // create reply which arrived only after its React owner was disposed.
      const predecessor = retirement.get(ownerKey);
      if (predecessor && !(await predecessor)) {
        if (!live()) return;
        setState({
          ...initialState,
          phase: "unavailable",
          unavailableReason: "host-unavailable",
          operationFailure: "cleanup",
        });
        void closeAttempt(attempt);
        return;
      }
      if (!live()) return;
      // Install before create. Resync after the reply to cover early events.
      const unsubscribe = await transport.listen(attempt.publish);
      if (!live()) {
        unsubscribe();
        return;
      }
      attempt.unsubscribe = unsubscribe;
      startupStage = "status";
      const status = await transport.status({ owner });
      if (!live()) return;
      if (status.capability?.availability === "unavailable") {
        unavailable(
          status.capability.reason ?? "host-unavailable",
          status.runtimeFailure,
        );
        return;
      }
      if (
        status.capability?.availability !== "available" &&
        status.capability?.availability !== "deferred"
      )
        throw new Error();
      startupStage = "owner-check";
      const requestId = crypto.randomUUID();
      ownerGuard.current?.();
      startupStage = "create";
      const result = await transport.create({
        ...(quickConnect ? { quickConnect } : {}),
        owner,
        expectedSecurityRevision,
        sourceSessionId,
        requestId,
        initialUrl: url,
        bounds: viewport.current ?? { x: 0, y: 0, width: 1, height: 1 },
        visible: false,
        policy: {
          darkMode: "forced",
          autoLogin: {
            enabled: true,
            consent:
              consentKind === "existing-grant"
                ? { kind: "existing-grant", grantId: grantId! }
                : { kind: "required" },
          },
        },
      });
      const identity = result?.snapshot?.identity;
      if (!validIdentity(identity) || !sameOwner(identity, owner)) {
        // Never close another owner's tab on a malformed response.
        attempt.fail();
        return;
      }
      attempt.identity = copyIdentity(identity);
      if (!live()) {
        await closeAttempt(attempt);
        return;
      }
      if (result.requestId !== requestId) {
        attempt.fail();
        return;
      }
      startupStage = "resync";
      const refreshed = await transport.status({
        owner,
        identity: attempt.identity,
      });
      if (!live()) return;
      if (refreshed.capability?.availability === "unavailable") {
        unavailable(
          refreshed.capability.reason ?? "host-unavailable",
          refreshed.runtimeFailure,
        );
        return;
      }
      if (refreshed.capability?.availability !== "available") throw new Error();
      // Fold early native events and both replies before exposing a view. A
      // newer failure/close must not briefly display an older attached state.
      attempt.publish(result.snapshot);
      if (!live()) return;
      if (refreshed.snapshot) attempt.publish(refreshed.snapshot);
      if (!live()) return;
      const latest = attempt.pendingSnapshot;
      attempt.pendingSnapshot = null;
      attempt.verified = true;
      if (latest) attempt.publish(latest);
    };
    attempt.startup = start().catch(startupFailed);
    return () => {
      if (current.current === attempt) current.current = null;
      void closeAttempt(attempt);
      const predecessor = retirement.get(ownerKey);
      retirement.set(
        ownerKey,
        attempt.startup.then(async () => {
          const closed = await closeAttempt(attempt);
          return closed && (!predecessor || (await predecessor));
        }),
      );
    };
  }, [
    ownerDatabaseId,
    connectionId,
    sessionId,
    expectedSecurityRevision,
    sourceSessionId,
    initialUrl,
    enabled,
    quickConnect,
    ownerAvailable,
    consentKind,
    grantId,
    transport,
    generation,
    closeAttempt,
    present,
  ]);

  const setViewport = useCallback(
    (bounds: OriginBrowserBounds | null) => {
      viewport.current = originBrowserBounds(bounds);
      present();
    },
    [present],
  );

  const runControl = useCallback(
    async (
      kind: "back" | "forward" | "reload" | "stop" | "focus" | "devtools",
    ) => {
      const attempt = current.current;
      const flags = presentation.current;
      if (
        !attempt?.identity ||
        attempt.cancelled ||
        !attempt.attached ||
        !flags.enabled ||
        !flags.ownerAvailable ||
        !flags.active ||
        flags.dialogOpen
      )
        return false;
      if (
        !state.snapshot ||
        !sameIdentity(state.snapshot.identity, attempt.identity)
      )
        return false;
      if (
        (kind === "focus" || kind === "devtools") &&
        (!viewport.current || attempt.presentationRevision < 1)
      )
        return false;
      const action: OriginBrowserAction =
        kind === "focus" || kind === "devtools"
          ? { kind, presentationRevision: attempt.presentationRevision }
          : { kind };
      const presentationBecameStale = () =>
        (action.kind === "focus" || action.kind === "devtools") &&
        action.presentationRevision !== attempt.presentationRevision;
      let dispatched = false;
      try {
        ownerGuard.current?.();
        dispatched = true;
        await attempt.transport.control({ identity: attempt.identity, action });
        return (
          current.current === attempt &&
          !attempt.cancelled &&
          !presentationBecameStale()
        );
      } catch {
        // An inspector failure must leave the failing page available to retry.
        // Owner-guard rejection still revokes the attempt as for other controls.
        if (!presentationBecameStale() && (kind !== "devtools" || !dispatched))
          attempt.fail("control");
        return false;
      }
    },
    [state.snapshot],
  );

  // Page operations, like focus, apply only to the current visible native
  // presentation. Callers cannot provide or invent a presentation revision.
  const runPageControl = useCallback(
    async (
      action:
        | Omit<
            Extract<OriginBrowserAction, { kind: "zoom" }>,
            "presentationRevision"
          >
        | Omit<
            Extract<OriginBrowserAction, { kind: "find" }>,
            "presentationRevision"
          >
        | Omit<
            Extract<OriginBrowserAction, { kind: "stop-find" }>,
            "presentationRevision"
          >,
    ) => {
      const attempt = current.current;
      const flags = presentation.current;
      if (
        !attempt?.identity ||
        attempt.cancelled ||
        !attempt.attached ||
        !flags.enabled ||
        !flags.ownerAvailable ||
        !flags.active ||
        flags.dialogOpen ||
        !viewport.current ||
        attempt.presentationRevision < 1 ||
        !state.snapshot ||
        !sameIdentity(state.snapshot.identity, attempt.identity)
      )
        return false;
      const revision = attempt.presentationRevision;
      const stale = () =>
        current.current !== attempt ||
        attempt.cancelled ||
        revision !== attempt.presentationRevision;
      try {
        ownerGuard.current?.();
        await attempt.transport.control({
          identity: attempt.identity,
          action: { ...action, presentationRevision: revision },
        });
        return !stale();
      } catch {
        if (!stale()) attempt.fail("control");
        return false;
      }
    },
    [state.snapshot],
  );
  const zoom = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent) || percent < 25 || percent > 500)
        return Promise.resolve(false);
      return runPageControl({ kind: "zoom", percent });
    },
    [runPageControl],
  );
  const find = useCallback(
    (
      text: string,
      forward = true,
      matchCase = false,
      findNext = false,
      requestId?: string,
    ) => {
      if (
        typeof text !== "string" ||
        !text ||
        text.includes("\0") ||
        new TextEncoder().encode(text).length > 1024 ||
        (requestId !== undefined &&
          !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
            requestId,
          ))
      )
        return Promise.resolve(false);
      return runPageControl({
        kind: "find",
        text,
        forward,
        matchCase,
        findNext,
        ...(requestId === undefined ? {} : { requestId }),
      });
    },
    [runPageControl],
  );
  const stopFind = useCallback(
    (clearSelection = true) =>
      runPageControl({ kind: "stop-find", clearSelection }),
    [runPageControl],
  );

  const navigate = useCallback(
    async (target: string) => {
      const attempt = current.current;
      const url = navigationUrl(target);
      if (
        !attempt?.identity ||
        attempt.cancelled ||
        !attempt.attached ||
        !presentation.current.ownerAvailable ||
        !presentation.current.enabled ||
        !presentation.current.active ||
        presentation.current.dialogOpen ||
        !url
      )
        return false;
      if (
        !state.snapshot ||
        !sameIdentity(state.snapshot.identity, attempt.identity)
      )
        return false;
      try {
        ownerGuard.current?.();
        if (
          sourceQuickConnect &&
          new URL(url).origin !== new URL(initialUrl).origin
        ) {
          if (latestScope.current !== commandScope) return false;
          setState({ ...initialState, phase: "starting" });
          // Immediately stop accepting actions on the predecessor. The effect
          // cleanup/start queue below waits for its actual close acknowledgement.
          void closeAttempt(attempt);
          setTemporaryTarget({
            scope: temporaryScope,
            definition: sourceQuickConnect,
            url,
          });
          return true;
        }
        await attempt.transport.navigate({ identity: attempt.identity, url });
        return current.current === attempt && !attempt.cancelled;
      } catch {
        attempt.fail("navigation");
        return false;
      }
    },
    [
      state.snapshot,
      sourceQuickConnect,
      initialUrl,
      commandScope,
      temporaryScope,
      closeAttempt,
    ],
  );

  const close = useCallback(
    async (requireConfirmation = false) => {
      if (latestScope.current !== commandScope) {
        if (requireConfirmation) throw new Error("Browser attempt changed.");
        return;
      }
      const attempt = current.current;
      if (!attempt) return;
      setState({ ...initialState, phase: "closing" });
      await closeAttempt(attempt);
      // A pending create may still return a native attempt which needs closing.
      await attempt.startup;
      const closed = await closeAttempt(attempt);
      if (current.current === attempt)
        setState({
          ...initialState,
          phase: closed ? "closed" : "error",
          error: closed
            ? null
            : "Native browser cleanup could not be confirmed.",
          operationFailure: closed ? null : "cleanup",
        });
      if (requireConfirmation && !closed)
        throw new Error("Native browser cleanup could not be confirmed.");
    },
    [closeAttempt, commandScope],
  );

  const reconnect = useCallback(() => {
    if (latestScope.current === commandScope)
      setGeneration((value) => value + 1);
  }, [commandScope]);
  const focus = useCallback(() => runControl("focus"), [runControl]);
  const back = useCallback(() => runControl("back"), [runControl]);
  const forward = useCallback(() => runControl("forward"), [runControl]);
  const reload = useCallback(() => runControl("reload"), [runControl]);
  const stop = useCallback(() => runControl("stop"), [runControl]);
  const openDevTools = useCallback(() => runControl("devtools"), [runControl]);

  // Verified native attachment is the connection lifecycle. CEF's loading bit
  // includes later navigation/subresources; login and automation readiness do
  // not hold an already usable native browser in the session's connecting state.
  const connectionStatus: ConnectionSession["status"] | null =
    state.phase === "idle"
      ? null
      : state.phase === "starting"
        ? "connecting"
        : state.phase === "attached"
          ? "connected"
          : state.phase === "error" || state.phase === "unavailable"
            ? "error"
            : "disconnected";

  return {
    state,
    connectionStatus,
    setViewport,
    navigate,
    focus,
    back,
    forward,
    reload,
    stop,
    openDevTools,
    zoom,
    find,
    stopFind,
    close,
    reconnect,
  };
}

export type OriginBrowserController = ReturnType<typeof useOriginBrowser>;
