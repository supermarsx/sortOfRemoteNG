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
  originBrowserSourceChangesExhausted,
} from "./originBrowserSessionError";
import { getOriginBrowserRuntimeFailureDetail } from "./originBrowserFailureDetails";
import { useOriginBrowserFailureLog } from "./useOriginBrowserFailureLog";
import {
  originBrowserStartRetriesExhausted,
  originBrowserStartTimeout,
  originBrowserStartupError,
  originBrowserStartupRetryable,
  originBrowserStartupStale,
  type OriginBrowserStartupStage,
  type OriginBrowserStartupFailure,
} from "./originBrowserStartupError";
import {
  ORIGIN_BROWSER_STATE_EVENT,
  originBrowserBounds,
  originBrowserFailureReason,
  originBrowserFaviconUrl,
  originBrowserLoadFailure,
  originBrowserRuntimeFailure,
  type OriginBrowserAction,
  type OriginBrowserBounds,
  type OriginBrowserConsent,
  type OriginBrowserCreateResult,
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
  /** The saved row's authority signature, for the shell that computes it.
   * The hook does not read it: native's saved-connection report is handled
   * the same whether the row or a record it depends on changed. */
  authoritySignature?: string;
  /** Deadline for one native create. The default covers native's slowest
   * permitted start; pass less when the saved load timeout is known. */
  startTimeoutMs?: number;
}

/** Bounds of the attempt lifecycle, in one place for the shell and its tests. */
export const ORIGIN_BROWSER_LIFECYCLE = Object.freeze({
  /** Creates per start for a failure that passes by itself, the first included. */
  startTries: 3,
  /** Pause before the second and before the third create. */
  startRetryDelaysMs: Object.freeze([500, 2_000] as const),
  /** One event subscription, capability or resync request, or caller work. */
  startStepTimeoutMs: 30_000,
  /** One create: native's 20 s engine wait plus its 125 s longest tab load. */
  startTimeoutMs: 180_000,
  /** One close. Native answers within 25 s: 5 s to reach its UI thread, then
   * 20 s for cleanup. Also added to the create deadline while a predecessor,
   * whose own create may still be unanswered, is waited for. */
  closeTimeoutMs: 30_000,
  /** Pause before a rejected presentation, control or navigation is resent,
   * and again before a second rejection fails the attempt. */
  ipcRetryDelayMs: 250,
  /** Loop window for the automatic restart of a tab whose relay ended: a
   * relay that ends again this soon after its replacement came up is not
   * repaired by one more restart. */
  relayEndedWindowMs: 10_000,
  /** Automatic relay restarts in a row before the tab stops and offers Retry. */
  relayEndedRunLimit: 3,
  /** A replacement that stayed up this long ends the relay's run. */
  relayEndedRunResetMs: 600_000,
  /** A completed page must remain healthy before another independent repair. */
  proxyRepairQuietMs: 10_000,
  proxyRepairRunLimit: 3,
  proxyRepairRunResetMs: 600_000,
  /** Automatic restarts for a saved change within sourceChangedBudgetMs. A
   * saved change is not a failure, so each one is followed however soon it
   * comes after the last: the editor saves a second after every pause in
   * typing. The budget only ends a record that is rewritten on every start,
   * which gets here within minutes; nobody edits at this rate for this long. */
  sourceChangedBudget: 60,
  sourceChangedBudgetMs: 600_000,
  /** Before the replacement for a saved change is created, no further saved
   * change for this long. The editor saves 1 s after the last keystroke, so a
   * user who is still typing saves again within it; the replacement is then
   * made once, for what they typed last, and not for every half-typed value. */
  sourceChangedQuietMs: 1_500,
  /** The quiet period ends this long after the first saved change at most, so
   * a steady trickle of saves cannot keep the tab waiting. */
  sourceChangedQuietCapMs: 5_000,
});

const restartReasons = [
  "requested",
  "settings-saved",
  "session-cleared",
  "source-changed",
  /** A live tab's private relay ended; a fresh attempt gets a fresh relay. */
  "relay-ended",
  "proxy-unreachable",
] as const;
/** Why the tab is being replaced in place. Fixed values, safe to display. */
export type OriginBrowserRestartReason = (typeof restartReasons)[number];

export interface OriginBrowserRestart {
  reason: OriginBrowserRestartReason;
  /** The hook restarted by itself, on native's report of a saved change or of
   * a live tab's relay that ended. */
  automatic: boolean;
  /** Increases with every restart of this tab, so a repeat is a new value. */
  serial: number;
}

export interface OriginBrowserRestartOptions {
  /** Runs once the old attempt is confirmed closed and before its replacement
   * is created. If it throws, the tab is still replaced and restart() rejects
   * with the same error. */
  beforeCreate?: () => void | Promise<void>;
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
  /** Set until replacement attachment or failure; proxy recovery additionally
   * waits for a completed real document load. */
  restart?: OriginBrowserRestartReason | null;
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
  restart: null,
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
    (value.documentLoaded !== undefined &&
      typeof value.documentLoaded !== "boolean") ||
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
  const faviconUrl = originBrowserFaviconUrl(value.faviconUrl);
  return {
    identity: copyIdentity(value.identity),
    sequence: value.sequence,
    phase: value.phase,
    ...(failureReason === undefined ? {} : { failureReason }),
    ...(loadFailure === undefined ? {} : { loadFailure }),
    displayUrl,
    ...(currentUrl === undefined ? {} : { currentUrl }),
    title: Array.from(value.title).filter(printable).join(""),
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    loading: value.loading,
    ...(value.documentLoaded === undefined
      ? {}
      : { documentLoaded: value.documentLoaded }),
    canGoBack: value.canGoBack,
    canGoForward: value.canGoForward,
  };
}

interface Attempt {
  ownerKey: string;
  /** Native requests still unanswered: an open create, a close in flight. */
  holds: number;
  /** Stops the start deadline once the attempt is verified or retired. */
  disarm: () => void;
  /** Ends the pause before this start's next create, if it is in one. */
  wake: (() => void) | null;
  /** A page was shown: what ends it now is a failed session, not a start. */
  everAttached: boolean;
  cancelled: boolean;
  verified: boolean;
  pendingSnapshot: OriginBrowserSnapshot | null;
  attached: boolean;
  loadFailed: boolean;
  proxyRecoveryResolved: boolean;
  createStarted: boolean;
  pendingCreateRequestId: string | null;
  identity: OriginBrowserIdentity | null;
  closeTask: Promise<boolean> | null;
  closeFailed: boolean;
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

interface RestartRequest {
  beforeCreate?: () => void | Promise<void>;
  resolve: (replaced: boolean) => void;
  reject: (error: unknown) => void;
}

interface RestartCycle {
  reason: OriginBrowserRestartReason;
  waiting: RestartRequest[];
  /** Shared by every attempt of the cycle, so caller work runs once. */
  work: Promise<void> | null;
  /** Set by a final close, Retry or disposal: nothing more is run for it. */
  ended: boolean;
  /** For a saved change: the wait before the replacement is created. */
  quiet: QuietPeriod | null;
}

interface QuietPeriod {
  /** Settles when the saved changes have settled, or the period has ended. */
  done: Promise<void>;
  /** Another saved change: wait the quiet time again, within the cap. */
  extend: () => void;
  /** Over at once: the user asked, or the restart ended. */
  end: () => void;
}

/** Timers only, no clock reads: every saved change restarts the quiet timer,
 * and the cap timer, started with the first, ends the period regardless. */
function startQuietPeriod(): QuietPeriod | null {
  const { ms, capMs } = quietPeriod;
  if (ms <= 0) return null;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let cap: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    clearTimeout(quiet);
    clearTimeout(cap);
    quiet = cap = undefined;
    settle();
  };
  const extend = () => {
    if (cap === undefined) return;
    clearTimeout(quiet);
    quiet = setTimeout(end, ms);
  };
  quiet = setTimeout(end, ms);
  cap = setTimeout(end, Math.max(ms, capMs));
  return { done, extend, end };
}

/** Attempts with a native request still unanswered, by owner triple. Module
 * scope, so a remounted tab waits for the tab it replaces. Once the close has
 * settled the attempt leaves; an unconfirmed one stays only with the tab
 * instance that can retry it. */
const closing = new Map<string, Set<Attempt>>();
/** The last slot any tab measured: the size for a tab created while hidden. */
let knownViewport: OriginBrowserBounds | null = null;

function hold(attempt: Attempt) {
  if (attempt.holds++) return;
  const attempts = closing.get(attempt.ownerKey) ?? new Set<Attempt>();
  attempts.add(attempt);
  closing.set(attempt.ownerKey, attempts);
}

function release(attempt: Attempt) {
  if (--attempt.holds) return;
  const attempts = closing.get(attempt.ownerKey);
  attempts?.delete(attempt);
  if (attempts && !attempts.size) closing.delete(attempt.ownerKey);
}

/** The quiet period in force; tests that are not about it may switch it off. */
let quietPeriod: { ms: number; capMs: number } = {
  ms: ORIGIN_BROWSER_LIFECYCLE.sourceChangedQuietMs,
  capMs: ORIGIN_BROWSER_LIFECYCLE.sourceChangedQuietCapMs,
};

/** Test isolation only: every test stands for a freshly loaded shell document. */
export function resetOriginBrowserLifecycleForTests() {
  closing.clear();
  knownViewport = null;
  quietPeriod = {
    ms: ORIGIN_BROWSER_LIFECYCLE.sourceChangedQuietMs,
    capMs: ORIGIN_BROWSER_LIFECYCLE.sourceChangedQuietCapMs,
  };
}

/** Tests only: a different quiet period, or none (0), until the next reset. */
export function setOriginBrowserQuietPeriodForTests(
  ms: number,
  capMs: number = ms,
) {
  quietPeriod = { ms, capMs };
}

/** A hidden tab still lays its page out, and a login form must render to be
 * filled. The shell content size stands in until a slot has been measured. */
function shellBounds(): OriginBrowserBounds {
  return (
    (typeof window === "undefined"
      ? null
      : originBrowserBounds({
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        })) ?? { x: 0, y: 0, width: 1280, height: 720 }
  );
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Native revokes an attempt whose operation it rejects, then reports why.
 * Pausing lets that report retire the attempt and name the cause before the
 * request is sent once more. True: sent. False: rejected again and still
 * usable, so the attempt has failed. Null: no longer the caller's to send. */
async function resendRejected(
  usable: () => boolean,
  send: () => Promise<void>,
): Promise<boolean | null> {
  await pause(ORIGIN_BROWSER_LIFECYCLE.ipcRetryDelayMs);
  if (!usable()) return null;
  try {
    await send();
    return true;
  } catch {
    await pause(ORIGIN_BROWSER_LIFECYCLE.ipcRetryDelayMs);
    return usable() ? false : null;
  }
}

async function runRestartWork(cycle: RestartCycle) {
  while (cycle.waiting.length) {
    const request = cycle.waiting.shift()!;
    try {
      await request.beforeCreate?.();
      request.resolve(!cycle.ended);
    } catch (error) {
      request.reject(error);
    }
  }
  // The replacement is created next: a later request is a new restart.
  cycle.ended = true;
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
    startTimeoutMs,
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
  useOriginBrowserFailureLog(
    state,
    JSON.stringify([
      options.owner.ownerDatabaseId,
      options.owner.connectionId,
      options.owner.sessionId,
    ]),
  );
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
  // Keep the actual attempts until native confirms closure. A cached false
  // promise must not permanently poison every later Retry for this tab.
  const retiring = useRef(new Map<string, Set<Attempt>>());
  const cleanupRetryRequested = useRef(false);
  const viewport = useRef<OriginBrowserBounds | null>(null);
  const lastViewport = useRef<OriginBrowserBounds | null>(null);
  const ownerGuard = useRef(assertOwner);
  useLayoutEffect(() => {
    ownerGuard.current = assertOwner;
  }, [assertOwner]);
  const [lastRestart, setLastRestart] = useState<OriginBrowserRestart | null>(
    null,
  );
  const restartCycle = useRef<RestartCycle | null>(null);
  const restartSerial = useRef(0);
  // A changed deadline must not start an attempt, so it is not a scope.
  const lifecycle = useRef<{ createTimeoutMs: number }>({
    createTimeoutMs: ORIGIN_BROWSER_LIFECYCLE.startTimeoutMs,
  });
  useLayoutEffect(() => {
    lifecycle.current = {
      createTimeoutMs:
        typeof startTimeoutMs === "number" &&
        Number.isFinite(startTimeoutMs) &&
        startTimeoutMs >= 1_000
          ? Math.min(startTimeoutMs, 600_000)
          : ORIGIN_BROWSER_LIFECYCLE.startTimeoutMs,
    };
  }, [startTimeoutMs]);
  // The run of automatic relay restarts, and when its last replacement came up.
  const relayRun = useRef<{
    count: number;
    at: number;
    /** Until its replacement is up; a slow create must not use the window up. */
    starting: boolean;
  } | null>(null);
  // When each automatic restart for a saved change began, oldest first.
  const savedChanges = useRef<number[]>([]);
  const proxyRepairRun = useRef<{
    ownerKey: string;
    count: number;
    healthySince: number | null;
    healthyElapsed: number;
    healthyAttemptId: string | null;
  } | null>(null);
  const presentation = useRef({
    active: false,
    dialogOpen: true,
    ownerAvailable: false,
    enabled: false,
    preserveRenderingUnderOverlays: false,
    occlusions: undefined as readonly OriginBrowserBounds[] | undefined,
  });

  const closeAttempt = useCallback(
    async (attempt: Attempt, retryFailed = false): Promise<boolean> => {
      attempt.cancelled = true;
      const pendingRequestId = attempt.pendingCreateRequestId;
      attempt.pendingCreateRequestId = null;
      if (pendingRequestId) {
        try {
          void Promise.resolve(
            invoke("origin_browser_ssh_cancel_pending_create", {
              requestId: pendingRequestId,
            }),
          ).catch(() => {});
        } catch {
          /* Diagnostic/review IPC failure cannot revive the local attempt. */
        }
      }
      attempt.pendingSnapshot = null;
      attempt.disarm();
      // Whatever ends the attempt ends its pause: nothing is created for a tab
      // that was closed or replaced while its start waited to be retried.
      attempt.wake?.();
      attempt.wake = null;
      attempt.unsubscribe?.();
      attempt.unsubscribe = null;
      if (!attempt.identity) return true;
      // Retry only an already rejected acknowledgement, on explicit user
      // action. Pending requests remain coalesced; successful ones are final.
      if (retryFailed && attempt.closeFailed) attempt.closeTask = null;
      if (!attempt.closeTask) {
        attempt.closeFailed = false;
        const request = attempt.transport.close({ identity: attempt.identity });
        hold(attempt);
        // A reply that never comes must not keep this tab, or the tab that
        // replaces it, waiting. Past the deadline the close is unconfirmed like
        // a rejected one: reported, and asked again on an explicit Retry.
        let unanswered: ReturnType<typeof setTimeout> | undefined;
        const answer = request.then(
          () => true,
          () => false,
        );
        const task = Promise.race([
          answer,
          new Promise<boolean>((resolve) => {
            unanswered = setTimeout(
              () => resolve(false),
              ORIGIN_BROWSER_LIFECYCLE.closeTimeoutMs,
            );
          }),
        ]).then((closed) => {
          clearTimeout(unanswered);
          if (!closed) attempt.closeFailed = true;
          release(attempt);
          return closed;
        });
        attempt.closeTask = task;
        // An acknowledgement that arrives after the deadline still counts,
        // unless a Retry has asked again in the meantime.
        void answer.then((closed) => {
          if (closed && attempt.closeFailed && attempt.closeTask === task) {
            attempt.closeFailed = false;
            attempt.closeTask = Promise.resolve(true);
          }
        });
      }
      // Never expose native error strings, which may contain URLs or secrets.
      return attempt.closeTask;
    },
    [],
  );

  // A start that is only waiting to be retried ends with the Retry or the
  // restart that replaces it, at once and not when React gets to render it.
  // (An attempt that is still live is ended by the cleanup of its effect.)
  const endStartPause = useCallback(() => {
    const attempt = current.current;
    if (!attempt?.cancelled) return;
    attempt.wake?.();
    attempt.wake = null;
  }, []);

  // A restart that cannot go on: its callers learn that nothing was replaced.
  const endRestart = useCallback(() => {
    const cycle = restartCycle.current;
    if (!cycle) return;
    restartCycle.current = null;
    cycle.ended = true;
    cycle.quiet?.end();
    for (const request of cycle.waiting.splice(0)) request.resolve(false);
  }, []);
  useLayoutEffect(() => endRestart, [endRestart]);

  // Close, then create, without leaving the session's connected states: the
  // start effect below closes the retired attempt and waits for that close.
  const beginRestart = useCallback(
    (
      reason: OriginBrowserRestartReason,
      automatic: boolean,
      beforeCreate?: OriginBrowserRestartOptions["beforeCreate"],
    ) =>
      new Promise<boolean>((resolve, reject) => {
        const request = { beforeCreate, resolve, reject };
        // Until the replacement's create is issued, one restart serves all.
        const open = restartCycle.current;
        if (open && !open.ended) {
          open.waiting.push(request);
          // Another saved change while the replacement waits: wait again, for
          // the newest row. Anything else is the user's, and is not kept waiting.
          if (reason === "source-changed") open.quiet?.extend();
          else open.quiet?.end();
          return;
        }
        restartCycle.current = {
          reason,
          waiting: [request],
          work: null,
          ended: false,
          // Native's report of a saved change opens the quiet period. The
          // shell's own restart for a write it saw finish joins a period that
          // is open, but does not open one: it may be the only restart for
          // that write, and the shell expects it to begin at once.
          quiet:
            reason === "source-changed" && automatic
              ? startQuietPeriod()
              : null,
        };
        cleanupRetryRequested.current = true;
        endStartPause();
        setLastRestart({ reason, automatic, serial: ++restartSerial.current });
        if (reason === "proxy-unreachable")
          setState((previous) => ({ ...previous, restart: reason }));
        setGeneration((value) => value + 1);
      }),
    [endStartPause],
  );

  const present = useCallback(() => {
    const attempt = current.current;
    if (!attempt?.identity || attempt.cancelled || !attempt.attached) return;
    const { identity } = attempt;
    const flags = presentation.current;
    const bounds = viewport.current;
    const visible =
      !attempt.loadFailed &&
      flags.enabled &&
      flags.ownerAvailable &&
      flags.active &&
      (!flags.dialogOpen || flags.preserveRenderingUnderOverlays) &&
      !!bounds;
    const clipping = {
      ...(flags.preserveRenderingUnderOverlays
        ? { occlusions: flags.occlusions ?? [] }
        : {}),
      // Hidden diagnostic pages retain their context. Fence explicit input and
      // inspector actions natively when their shell presentation is not active.
      inputBlocked:
        !flags.enabled ||
        !flags.ownerAvailable ||
        !flags.active ||
        !bounds ||
        flags.dialogOpen,
    };
    const key = JSON.stringify({ bounds, visible, ...clipping });
    if (key === attempt.presentationKey) return;
    attempt.presentationKey = key;
    const send = (resent: boolean) => {
      const revision = ++attempt.presentationRevision;
      // A newer presentation, or the end of the attempt, makes this one moot.
      const superseded = () =>
        current.current !== attempt ||
        attempt.cancelled ||
        revision !== attempt.presentationRevision;
      void attempt.transport
        .control({
          identity,
          action: {
            kind: "presentation",
            revision,
            bounds,
            visible,
            ...clipping,
          },
        })
        .catch(async () => {
          if (superseded()) return;
          // See resendRejected. Native records a revision before its fallible
          // steps, so the same presentation goes out again under a newer one.
          await pause(ORIGIN_BROWSER_LIFECYCLE.ipcRetryDelayMs);
          if (superseded()) return;
          if (resent) attempt.fail("presentation");
          else send(true);
        });
    };
    send(false);
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
    // Only failures known when the user requested Retry may be retried. A
    // first close rejected during this restart must wait for another action,
    // rather than silently issuing a second close in the same recovery pass.
    const retryCleanup = new Set(
      cleanupRetryRequested.current
        ? [...(retirement.get(ownerKey) ?? [])].filter(
            (item) => item.closeFailed,
          )
        : [],
    );
    cleanupRetryRequested.current = false;
    if (!enabled) {
      endRestart();
      setState(initialState);
      return;
    }
    if (!ownerAvailable) {
      endRestart();
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
      endRestart();
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
    // The creates this start has spent, and the restart it belongs to. A
    // start that has to be retried after native had created its view goes on
    // as a new attempt of the same start: same controller, same count.
    const restarting = restartCycle.current;
    const budget = {
      used: 0,
      stale: false,
      restart: restarting && !restarting.ended ? restarting.reason : null,
    };
    const retire = (attempt: Attempt) => {
      if (current.current === attempt) current.current = null;
      void closeAttempt(attempt);
      // A cancelled listener/status/waiter cannot reach create. Do not retain
      // those placeholders behind a slow predecessor on repeated Retry clicks.
      if (!attempt.identity && !attempt.createStarted) return;
      const predecessors = retirement.get(ownerKey) ?? new Set<Attempt>();
      predecessors.add(attempt);
      retirement.set(ownerKey, predecessors);
      // Its create may still answer, with a native attempt that needs closing.
      hold(attempt);
      void attempt.startup.then(async () => {
        let closed = false;
        try {
          closed = await closeAttempt(attempt);
        } finally {
          release(attempt);
        }
        if (!closed) return;
        predecessors.delete(attempt);
        if (!predecessors.size && retirement.get(ownerKey) === predecessors)
          retirement.delete(ownerKey);
      });
    };
    let active: Attempt | null = null;
    const launch = (userRetry: ReadonlySet<Attempt>) => {
      const attempt: Attempt = {
        ownerKey,
        holds: 0,
        disarm: () => undefined,
        wake: null,
        everAttached: false,
        cancelled: false,
        verified: false,
        pendingSnapshot: null,
        attached: false,
        loadFailed: false,
        proxyRecoveryResolved: false,
        createStarted: false,
        pendingCreateRequestId: null,
        identity: null,
        closeTask: null,
        closeFailed: false,
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
        const completedDocument = (snapshot: OriginBrowserSnapshot) =>
          snapshot.phase === "attached" &&
          snapshot.documentLoaded === true &&
          snapshot.loading === false &&
          /^https?:\/\//i.test(snapshot.displayUrl);
        const terminal = (snapshot: OriginBrowserSnapshot) =>
          ["failed", "closing", "closed"].includes(snapshot.phase);
        if (
          attempt.loadFailed &&
          !value.loadFailure &&
          !terminal(value) &&
          !completedDocument(value)
        )
          return;
        if (
          budget.restart === "proxy-unreachable" &&
          !attempt.proxyRecoveryResolved &&
          value.phase === "attached" &&
          !value.loadFailure &&
          (value.displayUrl === "about:blank" ||
            value.displayUrl.startsWith("chrome-error:"))
        )
          return;
        const snapshot = shellSnapshot(value);
        if (!snapshot) {
          attempt.fail();
          return;
        }
        if (!attempt.verified) {
          if (
            attempt.pendingSnapshot &&
            snapshot.sequence <= attempt.pendingSnapshot.sequence
          )
            return;
          // A matched create already established this exact native identity.
          // Resync still gates presentation, but must not postpone a terminal
          // renderer denial behind an unanswered status request. Publishing
          // this failure closes/cancels the attempt before any surface appears.
          if (
            snapshot.phase === "failed" &&
            snapshot.failureReason === "renderer"
          ) {
            attempt.verified = true;
          } else {
            if (
              !attempt.pendingSnapshot ||
              snapshot.sequence > attempt.pendingSnapshot.sequence
            )
              attempt.pendingSnapshot = snapshot;
            return;
          }
        }
        if (snapshot.sequence <= attempt.sequence) return;
        attempt.sequence = snapshot.sequence;
        if (snapshot.loadFailure) {
          // Hide the failed child before repair cancels this attempt and waits
          // for close. Native also clamps visibility while failure is latched.
          attempt.attached = snapshot.phase === "attached";
          attempt.loadFailed = true;
          present();
        }
        // Repair an independent proxy failure only after a completed owned
        // page has stayed healthy. Immediate failures cannot form a retry loop.
        const previousRun = proxyRepairRun.current;
        const run = previousRun?.ownerKey === ownerKey ? previousRun : null;
        const healthyFor =
          run && run.healthyAttemptId === attempt.identity?.attemptId
            ? run.healthySince !== null
              ? Math.max(0, Date.now() - run.healthySince)
              : run.healthyElapsed
            : 0;
        const count =
          healthyFor >= ORIGIN_BROWSER_LIFECYCLE.proxyRepairRunResetMs
            ? 0
            : (run?.count ?? 0);
        if (
          snapshot.phase === "attached" &&
          snapshot.loadFailure?.code === -130 &&
          (!count ||
            (healthyFor >= ORIGIN_BROWSER_LIFECYCLE.proxyRepairQuietMs &&
              count < ORIGIN_BROWSER_LIFECYCLE.proxyRepairRunLimit)) &&
          (!restartCycle.current || restartCycle.current.ended) &&
          presentation.current.ownerAvailable
        ) {
          proxyRepairRun.current = {
            ownerKey,
            count: count + 1,
            healthySince: null,
            healthyElapsed: 0,
            healthyAttemptId: null,
          };
          void closeAttempt(attempt);
          void beginRestart("proxy-unreachable", true);
          return;
        }
        if (run) {
          if (
            snapshot.loadFailure ||
            ["failed", "closing", "closed"].includes(snapshot.phase)
          ) {
            run.healthySince = null;
            run.healthyElapsed = 0;
            run.healthyAttemptId = null;
          } else if (
            snapshot.phase === "attached" &&
            snapshot.documentLoaded === true &&
            !snapshot.loading &&
            /^https?:\/\//i.test(snapshot.displayUrl) &&
            (run.healthyAttemptId !== attempt.identity?.attemptId ||
              run.healthySince === null)
          ) {
            run.healthySince = Date.now();
            run.healthyElapsed = 0;
            run.healthyAttemptId = attempt.identity?.attemptId ?? null;
          } else if (
            (snapshot.phase !== "attached" ||
              snapshot.loading ||
              snapshot.documentLoaded !== true ||
              !/^https?:\/\//i.test(snapshot.displayUrl)) &&
            run.healthySince !== null
          ) {
            // Preserve earned quiet time for the next navigation, but a pending
            // load cannot mature a short healthy interval or reset the budget.
            run.healthyElapsed = healthyFor;
            run.healthySince = null;
          }
        }
        // Chromium's interim blank/error document cannot erase the failure UI.
        // A completed real page (or a fresh attempt) can make the child visible.
        if (
          attempt.loadFailed &&
          !snapshot.loadFailure &&
          !terminal(snapshot) &&
          !completedDocument(snapshot)
        )
          return;
        // A fresh attempt repairs two causes: the saved connection changed, or
        // a live tab's private relay ended (native ends it on purpose, so that
        // its successor binds a new port with new credentials). Every other
        // cause means the owner, the window or the engine is gone or unsafe.
        const repair =
          snapshot.phase !== "failed"
            ? null
            : snapshot.failureReason === "source-changed"
              ? ("source-changed" as const)
              : snapshot.failureReason === "private-proxy" &&
                  attempt.everAttached
                ? ("relay-ended" as const)
                : null;
        // Set when the saved changes used their budget up: the error says so.
        let exhausted = false;
        if (repair) {
          const now = Date.now();
          // A report about the attempt that a restart is already replacing
          // belongs to that restart, so one restart is under way at most. A
          // change that reaches the replacement instead ends it in turn, and
          // native authorises every create from the saved row: the last row
          // wins.
          const replacing =
            !!restartCycle.current && !restartCycle.current.ended;
          let follow = replacing;
          if (!replacing && repair === "source-changed") {
            // Followed however soon after the last one, and apart from the
            // relay's run. Only their number inside the budget's window is
            // bounded; Retry, or a restart the user asks for, starts a new
            // count.
            const recent = savedChanges.current.filter(
              (at) => now - at < ORIGIN_BROWSER_LIFECYCLE.sourceChangedBudgetMs,
            );
            follow =
              recent.length < ORIGIN_BROWSER_LIFECYCLE.sourceChangedBudget;
            if (follow) recent.push(now);
            savedChanges.current = recent;
            exhausted = !follow;
          } else if (!replacing) {
            // Loop protection: the relay is restarted unless it ended within
            // the loop window of its last automatic replacement coming up, or
            // this would be the fourth such restart in a row; a run ends when
            // the user retries or asks for a restart, or once a replacement
            // has stayed up for ten minutes.
            const last = relayRun.current;
            const up = last && !last.starting ? now - last.at : 0;
            const run =
              last && up < ORIGIN_BROWSER_LIFECYCLE.relayEndedRunResetMs
                ? last.count
                : 0;
            follow =
              !run ||
              (up >= ORIGIN_BROWSER_LIFECYCLE.relayEndedWindowMs &&
                run < ORIGIN_BROWSER_LIFECYCLE.relayEndedRunLimit);
            if (follow)
              relayRun.current = { count: run + 1, at: now, starting: true };
          }
          if (follow) {
            // Stop accepting actions now; the restart confirms this close.
            void closeAttempt(attempt);
            if (!replacing) void beginRestart(repair, true);
            return;
          }
        }
        // The relay ended before this start showed a page. That is one of the
        // start's tries, like a relay that could not bind its port, and not a
        // failed session: close what native created and start once more. Never
        // both this and the restart above: that one needs a page that was shown.
        const startFailed =
          snapshot.phase === "failed" &&
          snapshot.failureReason === "private-proxy" &&
          !attempt.everAttached;
        if (startFailed && budget.used < ORIGIN_BROWSER_LIFECYCLE.startTries) {
          void closeAttempt(attempt);
          // The pause is part of this start. Disposal, a final close, a Retry
          // or a restart ends it, and what is created next is then theirs.
          const timer = setTimeout(
            () => {
              attempt.wake = null;
              // Second barrier, should an ending ever miss the pause: nothing
              // is launched over an attempt that is no longer the current one.
              if (current.current !== attempt) return;
              retire(attempt);
              launch(new Set());
            },
            ORIGIN_BROWSER_LIFECYCLE.startRetryDelaysMs[budget.used - 1],
          );
          attempt.wake = () => clearTimeout(timer);
          return;
        }
        attempt.attached = snapshot.phase === "attached";
        attempt.everAttached ||= attempt.attached;
        // A transport failure keeps its context attached for diagnostics and
        // recovery, but its Chromium error surface must not cover the shell UI.
        // Update before present(): React state has not committed this snapshot yet.
        attempt.loadFailed = !!snapshot.loadFailure;
        // Attaching a fresh listener/context does not prove that its selected
        // upstream route can load the website. Keep recovery pending through
        // loading and inert/error placeholders; a failed load ends it honestly.
        const proxyRecovery = budget.restart === "proxy-unreachable";
        if (
          proxyRecovery &&
          (snapshot.loadFailure ||
            ["failed", "closing", "closed"].includes(snapshot.phase) ||
            (snapshot.phase === "attached" &&
              snapshot.documentLoaded === true &&
              !snapshot.loading &&
              /^https?:\/\//i.test(snapshot.displayUrl)))
        )
          attempt.proxyRecoveryResolved = true;
        setState({
          ...initialState,
          snapshot,
          phase:
            snapshot.phase === "failed" || snapshot.loadFailure
              ? "error"
              : snapshot.phase,
          error:
            snapshot.phase === "failed"
              ? exhausted
                ? originBrowserSourceChangesExhausted(
                    ORIGIN_BROWSER_LIFECYCLE.sourceChangedBudget,
                    ORIGIN_BROWSER_LIFECYCLE.sourceChangedBudgetMs / 60_000,
                  )
                : startFailed && budget.used > 1
                  ? originBrowserStartRetriesExhausted(
                      originBrowserSessionError(snapshot.failureReason),
                      budget.used,
                    )
                  : originBrowserSessionError(snapshot.failureReason)
              : snapshot.loadFailure
                ? originBrowserLoadError(snapshot.loadFailure)
                : null,
          // Native may answer before the page is attached: still the restart.
          restart:
            (snapshot.phase === "starting" ||
              (proxyRecovery && !attempt.proxyRecoveryResolved)) &&
            !snapshot.loadFailure
              ? budget.restart
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
      setState({ ...initialState, phase: "starting", restart: budget.restart });
      let startupStage: OriginBrowserStartupStage = "listen";
      // Native answers every start request within a bound of its own. Past the
      // shell's bound the request is treated as lost: report it and leave Retry
      // available. The request itself stays awaited, so a late create is closed.
      let deadline: ReturnType<typeof setTimeout> | undefined;
      attempt.disarm = () => {
        if (deadline !== undefined) clearTimeout(deadline);
        deadline = undefined;
      };
      const arm = (ms: number, expired: () => void) => {
        attempt.disarm();
        deadline = setTimeout(() => {
          deadline = undefined;
          if (live()) expired();
        }, ms);
      };
      const startTimedOut = () => {
        const { message, ...startupFailure } =
          originBrowserStartTimeout(startupStage);
        setState({
          ...initialState,
          phase: "error",
          error: message,
          startupFailure,
        });
        void closeAttempt(attempt);
      };
      const cleanupUnconfirmed = () => {
        endRestart();
        setState({
          ...initialState,
          phase: "unavailable",
          unavailableReason: "host-unavailable",
          error:
            "Native browser cleanup could not be confirmed. Retry browser to check again before starting a replacement.",
          operationFailure: "cleanup",
        });
        void closeAttempt(attempt);
      };
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
        const text = engine ? `${engine.problem} ${engine.nextStep}` : message;
        setState({
          ...initialState,
          phase: "error",
          error:
            budget.used > 1 &&
            (originBrowserStartupRetryable(failure) ||
              originBrowserStartupStale(failure))
              ? originBrowserStartRetriesExhausted(text, budget.used)
              : text,
          startupFailure,
          runtimeFailure,
        });
        void closeAttempt(attempt);
      };
      const start = async () => {
        // A reconnect cannot overlap an unacknowledged predecessor, including a
        // create reply which arrived only after its React owner was disposed.
        // Snapshot the set: a later effect cleanup can enqueue this attempt too.
        // Iterating the live set could then make startup wait on itself.
        // The same holds across a remount: the tab this one replaces may still
        // be closing, or still be waiting for its own create to answer.
        const predecessors = new Set([
          ...(retirement.get(ownerKey) ?? []),
          ...(closing.get(ownerKey) ?? []),
        ]);
        if (predecessors.size)
          arm(
            lifecycle.current.createTimeoutMs +
              ORIGIN_BROWSER_LIFECYCLE.closeTimeoutMs,
            cleanupUnconfirmed,
          );
        for (const predecessor of predecessors) {
          await predecessor.startup;
          if (!live()) return;
          const closed = await closeAttempt(
            predecessor,
            userRetry.has(predecessor),
          );
          if (!live()) return;
          if (!closed) {
            // Keep it with this tab: only its explicit Retry may ask again.
            const unconfirmed = retirement.get(ownerKey) ?? new Set<Attempt>();
            unconfirmed.add(predecessor);
            retirement.set(ownerKey, unconfirmed);
            cleanupUnconfirmed();
            return;
          }
          retirement.get(ownerKey)?.delete(predecessor);
        }
        if (!live()) return;
        const restart = restartCycle.current;
        if (restart?.quiet && !restart.ended) {
          // A saved change: nothing is created until the saved row has stopped
          // changing. The wait ends early with this attempt, or with the
          // restart; it is bounded by the period's cap either way.
          const { done } = restart.quiet;
          await new Promise<void>((resolve) => {
            attempt.wake = resolve;
            void done.then(resolve);
          });
          attempt.wake = null;
          if (!live()) return;
        }
        if (restart && !restart.ended) {
          // Work that outlasts the deadline no longer has a replacement to
          // wait for, so its caller is told that nothing was replaced.
          arm(ORIGIN_BROWSER_LIFECYCLE.startStepTimeoutMs, () => {
            endRestart();
            startTimedOut();
          });
          await (restart.work ??= runRestartWork(restart));
          if (!live()) return;
        }
        // Install before create. Resync after the reply to cover early events.
        arm(ORIGIN_BROWSER_LIFECYCLE.startStepTimeoutMs, startTimedOut);
        const unsubscribe = await transport.listen(attempt.publish);
        if (!live()) {
          unsubscribe();
          return;
        }
        attempt.unsubscribe = unsubscribe;
        startupStage = "status";
        arm(ORIGIN_BROWSER_LIFECYCLE.startStepTimeoutMs, startTimedOut);
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
        let requestId: string;
        let result: OriginBrowserCreateResult;
        for (;;) {
          startupStage = "owner-check";
          requestId = crypto.randomUUID();
          ownerGuard.current?.();
          startupStage = "create";
          attempt.pendingCreateRequestId = requestId;
          attempt.createStarted = true;
          budget.used++;
          arm(lifecycle.current.createTimeoutMs, startTimedOut);
          try {
            const creating = transport.create({
              ...(quickConnect ? { quickConnect } : {}),
              owner,
              expectedSecurityRevision,
              sourceSessionId,
              requestId,
              initialUrl: url,
              bounds:
                viewport.current ??
                lastViewport.current ??
                knownViewport ??
                shellBounds(),
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
            result = await Promise.resolve(creating).finally(() => {
              if (attempt.pendingCreateRequestId === requestId)
                attempt.pendingCreateRequestId = null;
            });
            break;
          } catch (error) {
            if (attempt.pendingCreateRequestId === requestId)
              attempt.pendingCreateRequestId = null;
            const failure = originBrowserStartupError("create", error);
            // A lease lost to an edit of the saved connection gets one fresh
            // create, which native authorizes from the saved row again.
            const lostLease =
              originBrowserStartupStale(failure) && !budget.stale;
            if (
              !live() ||
              budget.used >= ORIGIN_BROWSER_LIFECYCLE.startTries ||
              !(lostLease || originBrowserStartupRetryable(failure))
            )
              throw error;
            budget.stale ||= lostLease;
            // Otherwise the engine may still be starting, or the relay's port
            // was busy. Nothing native is left to answer, so no successor
            // waits, and the pause ends early if the attempt does.
            attempt.createStarted = false;
            attempt.disarm();
            await new Promise<void>((resolve) => {
              const timer = setTimeout(
                resolve,
                ORIGIN_BROWSER_LIFECYCLE.startRetryDelaysMs[budget.used - 1],
              );
              attempt.wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
            attempt.wake = null;
            if (!live()) return;
          }
        }
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
        if (
          result.snapshot.phase === "failed" &&
          result.snapshot.failureReason === "renderer"
        ) {
          attempt.publish(result.snapshot);
          return;
        }
        startupStage = "resync";
        arm(ORIGIN_BROWSER_LIFECYCLE.startStepTimeoutMs, startTimedOut);
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
        if (refreshed.capability?.availability !== "available")
          throw new Error();
        // Fold early native events and both replies before exposing a view. A
        // newer failure/close must not briefly display an older attached state.
        attempt.publish(result.snapshot);
        if (!live()) return;
        if (refreshed.snapshot) attempt.publish(refreshed.snapshot);
        if (!live()) return;
        const latest = attempt.pendingSnapshot;
        attempt.pendingSnapshot = null;
        attempt.verified = true;
        attempt.disarm();
        const restarted = relayRun.current;
        if (restarted?.starting) {
          restarted.starting = false;
          restarted.at = Date.now();
        }
        if (latest) attempt.publish(latest);
      };
      attempt.startup = start().catch(startupFailed);
      active = attempt;
    };
    launch(retryCleanup);
    return () => {
      if (active) retire(active);
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
    beginRestart,
    endRestart,
  ]);

  const setViewport = useCallback(
    (bounds: OriginBrowserBounds | null) => {
      viewport.current = originBrowserBounds(bounds);
      if (viewport.current) {
        lastViewport.current = viewport.current;
        knownViewport = viewport.current;
      }
      present();
    },
    [present],
  );

  // What every toolbar action required when it was issued, read again
  // before a rejected one is resent.
  const controllable = useCallback((attempt: Attempt) => {
    const flags = presentation.current;
    return (
      attempt.attached &&
      flags.enabled &&
      flags.ownerAvailable &&
      flags.active &&
      !flags.dialogOpen
    );
  }, []);

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
      if (kind === "focus" && attempt.loadFailed) return false;
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
      const { identity } = attempt;
      const accepted = () =>
        current.current === attempt &&
        !attempt.cancelled &&
        !presentationBecameStale();
      const send = async () => {
        ownerGuard.current?.();
        await attempt.transport.control({ identity, action });
      };
      let dispatched = false;
      try {
        ownerGuard.current?.();
        dispatched = true;
        await attempt.transport.control({ identity, action });
        return accepted();
      } catch {
        if (presentationBecameStale()) return false;
        // Owner-guard rejection still revokes the attempt as for other controls.
        if (!dispatched) {
          attempt.fail("control");
          return false;
        }
        // An inspector failure must leave the failing page available to retry.
        if (kind === "devtools" || !accepted()) return false;
      }
      const resent = await resendRejected(
        () => accepted() && controllable(attempt),
        send,
      );
      if (resent === false) attempt.fail("control");
      return resent === true && accepted();
    },
    [state.snapshot, controllable],
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
        attempt.loadFailed ||
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
      const { identity } = attempt;
      const send = async () => {
        ownerGuard.current?.();
        await attempt.transport.control({
          identity,
          action: { ...action, presentationRevision: revision },
        });
      };
      let dispatched = false;
      try {
        ownerGuard.current?.();
        dispatched = true;
        await attempt.transport.control({
          identity,
          action: { ...action, presentationRevision: revision },
        });
        return !stale();
      } catch {
        if (stale()) return false;
        if (!dispatched) {
          attempt.fail("control");
          return false;
        }
      }
      const resent = await resendRejected(
        () =>
          !stale() &&
          controllable(attempt) &&
          !attempt.loadFailed &&
          !!viewport.current,
        send,
      );
      if (resent === false) attempt.fail("control");
      return resent === true && !stale();
    },
    [state.snapshot, controllable],
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
      const { identity } = attempt;
      const accepted = () => current.current === attempt && !attempt.cancelled;
      let dispatched = false;
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
        dispatched = true;
        await attempt.transport.navigate({ identity, url });
        return accepted();
      } catch {
        if (!dispatched) {
          attempt.fail("navigation");
          return false;
        }
        if (!accepted()) return false;
      }
      const resent = await resendRejected(
        () => accepted() && controllable(attempt),
        async () => {
          ownerGuard.current?.();
          await attempt.transport.navigate({ identity, url });
        },
      );
      if (resent === false) attempt.fail("navigation");
      return resent === true && accepted();
    },
    [
      state.snapshot,
      sourceQuickConnect,
      initialUrl,
      commandScope,
      temporaryScope,
      closeAttempt,
      controllable,
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
      const ownerKey = JSON.stringify([
        ownerDatabaseId,
        connectionId,
        sessionId,
      ]);
      const predecessors = [
        ...new Set([
          ...(retiring.current.get(ownerKey) ?? []),
          ...(closing.get(ownerKey) ?? []),
        ]),
      ].filter((item) => item !== attempt);
      const retryCleanup = new Set(
        requireConfirmation
          ? [...predecessors, attempt].filter((item) => item.closeFailed)
          : [],
      );
      setState({ ...initialState, phase: "closing" });
      // Default close is also used by viewport effect disposal. Only the
      // explicit confirmed-close workflow may retry a rejected acknowledgement.
      await closeAttempt(attempt, retryCleanup.has(attempt));
      // That disposal runs for every new scope, a restart's included, and a
      // successor has then replaced the attempt. Only a final close, which
      // has none, ends a restart that is still waiting.
      if (current.current === attempt) endRestart();
      // A pending create may still return a native attempt which needs closing.
      await attempt.startup;
      let closed = await closeAttempt(attempt);
      // A blocked successor has no native identity of its own. Closing it must
      // not falsely acknowledge the failed predecessor it was waiting for.
      for (const predecessor of predecessors) {
        await predecessor.startup;
        const confirmed = await closeAttempt(
          predecessor,
          retryCleanup.has(predecessor),
        );
        if (confirmed) retiring.current.get(ownerKey)?.delete(predecessor);
        closed = closed && confirmed;
      }
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
    [
      closeAttempt,
      endRestart,
      commandScope,
      ownerDatabaseId,
      connectionId,
      sessionId,
    ],
  );

  const reconnect = useCallback(() => {
    if (latestScope.current === commandScope) {
      // An explicit Retry outranks a restart still waiting on its caller,
      // and the user has seen the tab: automatic restarts count from zero.
      endRestart();
      endStartPause();
      relayRun.current = null;
      savedChanges.current = [];
      proxyRepairRun.current = null;
      cleanupRetryRequested.current = true;
      setGeneration((value) => value + 1);
    }
  }, [commandScope, endRestart, endStartPause]);
  /** Replaces the attempt in place: confirmed close, then create. Resolves
   * true once the replacement is being created, false when it was refused,
   * superseded or its cleanup stayed unconfirmed. */
  const restart = useCallback(
    (
      reason: OriginBrowserRestartReason = "requested",
      { beforeCreate }: OriginBrowserRestartOptions = {},
    ) => {
      const flags = presentation.current;
      if (
        latestScope.current !== commandScope ||
        !flags.enabled ||
        !flags.ownerAvailable
      )
        return Promise.resolve(false);
      const safe = restartReasons.includes(reason) ? reason : "requested";
      // The shell acting on a cause that is counted is not a user action;
      // every other reason is something the user asked for.
      if (
        safe !== "source-changed" &&
        safe !== "relay-ended" &&
        safe !== "proxy-unreachable"
      ) {
        relayRun.current = null;
        savedChanges.current = [];
        proxyRepairRun.current = null;
      }
      return beginRestart(safe, false, beforeCreate);
    },
    [commandScope, beginRestart],
  );
  const focus = useCallback(() => runControl("focus"), [runControl]);
  const back = useCallback(() => runControl("back"), [runControl]);
  const forward = useCallback(() => runControl("forward"), [runControl]);
  const reload = useCallback(() => runControl("reload"), [runControl]);
  const stop = useCallback(() => runControl("stop"), [runControl]);
  const openDevTools = useCallback(() => runControl("devtools"), [runControl]);

  // Verified native attachment is the connection lifecycle. CEF's loading bit
  // includes later navigation/subresources; login and automation readiness do
  // not hold an already usable native browser in the session's connecting state.
  // A restart replaces the attempt in place, so the session never reads as
  // ended while one runs: `closing` and `closed` mean a final close only.
  const getPendingCreateRequestId = useCallback(() => {
    const attempt = current.current;
    return attempt && !attempt.cancelled
      ? attempt.pendingCreateRequestId
      : null;
  }, []);

  const connectionStatus: ConnectionSession["status"] | null =
    state.phase === "idle"
      ? null
      : state.phase === "attached"
        ? state.restart === "proxy-unreachable"
          ? "reconnecting"
          : "connected"
        : state.phase === "error" || state.phase === "unavailable"
          ? "error"
          : state.restart
            ? "reconnecting"
            : state.phase === "starting"
              ? "connecting"
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
    restart,
    lastRestart,
    getPendingCreateRequestId,
  };
}

type Controller = ReturnType<typeof useOriginBrowser>;
/** What shell components are handed. The restart members are optional here
 * because those components, and their fixtures, do not need them. */
export type OriginBrowserController = Omit<
  Controller,
  "restart" | "lastRestart" | "getPendingCreateRequestId"
> &
  Partial<
    Pick<Controller, "restart" | "lastRestart" | "getPendingCreateRequestId">
  >;
