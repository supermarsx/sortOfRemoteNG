"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import type { OriginCredentialInputTransport } from "../../types/protocols/originCredentialTyping";
import {
  CredentialFailure,
  settleWithin,
  type CredentialFailureCode,
} from "../../utils/security/credentialFailure";
import {
  assertCredentialText,
  type CredentialTypingTarget,
} from "../../utils/security/credentialTyping";

const focusTimeoutMs = 30000;
const pollMs = 300;
// The engine gives one typing request 32 seconds; this only catches an
// acknowledgement that never arrives.
const typeTimeoutMs = 35000;
// Above the credential read's own limit plus typing, so that the more specific
// inner failure is the one reported.
const actionTimeoutMs = 60000;
const nativeTransport: OriginCredentialInputTransport = (request) =>
  invoke("origin_browser_manual_input", { request });
const unavailable = () => new CredentialFailure("typing-unavailable");

/** The fixed reasons `origin_browser_manual_input` stops with (contract K7). */
const nativeReasons = new Map<unknown, CredentialFailureCode>([
  ["unsupported-frame", "typing-unsupported-frame"],
  ["field-not-empty", "typing-field-not-empty"],
  ["focus-lost", "typing-focus-lost"],
  ["timed-out", "typing-timed-out"],
  ["cancelled", "typing-cancelled"],
  ["stale", "typing-stale"],
]);
/** Reasons after which part of the value may already be in the field. */
const interruptions: ReadonlySet<CredentialFailureCode> = new Set([
  "typing-focus-lost",
  "typing-cancelled",
  "typing-stale",
]);

/** Only an exact reason is recognised: bare, or as the `reason` or `code` of a
 * rejection or reply. Native prose is never read or shown. */
function nativeReason(value: unknown): CredentialFailureCode | undefined {
  if (value === null || typeof value !== "object")
    return nativeReasons.get(value);
  const coded = value as { reason?: unknown; code?: unknown };
  return nativeReasons.get(coded.reason) ?? nativeReasons.get(coded.code);
}

/** Why typing stopped. A specific cause wins; the generic one is named by
 * phase. `started` says whether characters may already have reached the field. */
function typingFailure(
  error: unknown,
  started: boolean,
  waitedOut = false,
): CredentialFailure {
  const known =
    error instanceof CredentialFailure && error.code !== "typing-unavailable"
      ? error
      : null;
  if (!started)
    return (
      known ??
      new CredentialFailure(
        waitedOut ? "typing-timed-out" : "typing-unavailable",
      )
    );
  if (!known || known.code === "typing-timed-out")
    return new CredentialFailure("typing-not-confirmed", true);
  return interruptions.has(known.code) && !known.partial
    ? new CredentialFailure(known.code, true)
    : known;
}

/** Abort local waiting, including stalled IPC. The capture caller separately
 * revokes any late native receipt; a timeout never grants disclosure authority. */
function until<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(unavailable()));
    const timer = setTimeout(
      () => finish(() => reject(new CredentialFailure("typing-timed-out"))),
      Math.max(0, milliseconds),
    );
    function finish(action: () => void) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      action();
    }
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) abort();
  });
}

export interface OriginCredentialTypingOptions {
  sessionId: string;
  identity: OriginBrowserIdentity | null;
  viewId: string | null;
  /** Includes selected navigation/loading, not unrelated snapshot updates. */
  documentKey: string;
  enabled: boolean;
  interactive: boolean;
  open: boolean;
  assertOwner: () => void;
  runInteractive: (
    identity: OriginBrowserIdentity,
    viewId: string | null,
    assertCurrent: () => void,
    mutation: (revision: number) => Promise<unknown>,
  ) => Promise<unknown>;
  transport?: OriginCredentialInputTransport;
}

/** Only an explicit Type action captures focus. No disclosure runs until native
 * confirms an eligible empty field in this exact owner/document/view scope. */
export function useOriginCredentialTyping(
  options: OriginCredentialTypingOptions,
) {
  const key = JSON.stringify([
    options.enabled,
    options.identity,
    options.viewId,
    options.documentKey,
    options.sessionId,
  ]);
  const scope = useMemo(() => ({ key }), [key]);
  const latest = useRef(options);
  latest.current = options;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const alive = useRef(false);
  const sequence = useRef(0);
  const captured = useRef<CredentialTypingTarget | null>(null);
  const work = useRef<{
    completed: boolean;
    typingStarted: boolean;
    abort: AbortController;
  } | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const committed = useRef(false);
  // Bumped when an action is given up while still running: its target dies, so
  // that it cannot type into a later capture if it wakes up.
  const liveGeneration = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<
    "idle" | "countdown" | "waiting" | "preparing" | "typing"
  >("idle");
  const [remaining, setRemaining] = useState(0);
  const [notice, setNotice] = useState("");
  const [finished, setFinished] = useState(0);
  const [mode, setMode] = useState<"simulated" | "instant">("simulated");
  const [delaySeconds, setDelaySeconds] = useState(0);

  const cancel = useCallback(() => {
    sequence.current++;
    work.current?.abort.abort();
    // Keep an in-flight disclosure serialized until it settles: a stable proxy
    // from an older async action must never forward into a newer capture.
    captured.current?.dispose();
    captured.current = null;
    if (alive.current) {
      setPhase("idle");
      setRemaining(0);
    }
  }, []);
  useLayoutEffect(() => {
    alive.current = true;
    setNotice("");
    cancel();
    return () => {
      alive.current = false;
      cancel();
    };
  }, [scope, cancel]);
  useEffect(() => {
    if (!options.open) cancel();
  }, [options.open, cancel]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && work.current) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("keydown", escape);
    };
  }, [cancel]);
  useLayoutEffect(() => {
    committed.current = phase !== "idle";
    wake.current?.();
  }, [phase, options.interactive]);

  // Stable through waiting/capture renders, so the shared disclosure hook's
  // click closure sees the same target. This is not itself a focus receipt.
  const hasIdentity = options.identity !== null;
  const target = useMemo<CredentialTypingTarget | null>(() => {
    if (!options.enabled || !hasIdentity) return null;
    const current = () =>
      liveGeneration.current === generation && currentScope.current === scope;
    const receipt = () => {
      if (
        !current() ||
        !work.current ||
        work.current.abort.signal.aborted ||
        !captured.current
      )
        throw unavailable();
      captured.current.assertCurrent();
      return captured.current;
    };
    return {
      sessionId: options.sessionId,
      // Native typing resolves only after the page confirmed every character.
      confirmation: "typed",
      assertCurrent: () => {
        receipt();
      },
      type: async (value, assertDisclosure, validity) =>
        receipt().type(value, assertDisclosure, validity),
      dispose: () => {
        if (current()) cancel();
      },
    };
  }, [
    scope,
    cancel,
    options.enabled,
    hasIdentity,
    options.sessionId,
    generation,
  ]);

  async function run(action: () => Promise<void>) {
    if (work.current || !target) return;
    const ticket = ++sequence.current;
    const job = {
      completed: false,
      typingStarted: false,
      abort: new AbortController(),
    };
    work.current = job;
    const { identity, viewId, assertOwner: owner } = options;
    const transport = options.transport ?? nativeTransport;
    // Capture and type requests: a reason from the engine becomes the failure.
    const request: OriginCredentialInputTransport = (message) =>
      transport(message).then(
        (reply) => {
          // A reply that reports progress or success is never a refusal.
          const reason = ["waiting", "captured", "complete"].includes(
            reply.status,
          )
            ? undefined
            : nativeReason(reply);
          if (reason) throw new CredentialFailure(reason);
          return reply;
        },
        (error: unknown) => {
          throw new CredentialFailure(
            nativeReason(error) ?? "typing-unavailable",
          );
        },
      );
    const signal = job.abort.signal;
    const check = () => {
      if (
        !alive.current ||
        sequence.current !== ticket ||
        currentScope.current !== scope ||
        signal.aborted ||
        !latest.current.enabled ||
        !latest.current.open ||
        document.hidden
      )
        throw unavailable();
      owner();
      latest.current.assertOwner();
    };
    const interactive = () => {
      check();
      if (!committed.current || !latest.current.interactive)
        throw unavailable();
    };
    const pause = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(resolve), ms);
        const abort = () => finish(() => reject(unavailable()));
        function finish(done: () => void) {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          done();
        }
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    setNotice("");
    // Suspend immediately, including countdown and waiting, to release CEF input.
    setPhase(delaySeconds ? "countdown" : "waiting");
    setRemaining(delaySeconds || focusTimeoutMs / 1000);
    let deadline = Infinity;
    try {
      check();
      const startAt = Date.now() + delaySeconds * 1000;
      while (Date.now() < startAt) {
        await pause(Math.min(200, startAt - Date.now()));
        check();
        setRemaining(Math.ceil((startAt - Date.now()) / 1000));
      }
      setPhase("waiting");
      deadline = Date.now() + focusTimeoutMs;
      const waitForPresentation = () =>
        new Promise<void>((resolve) => {
          const ready = () => {
            if (committed.current && latest.current.interactive) resolve();
          };
          wake.current = ready;
          ready();
        });
      try {
        await until(waitForPresentation(), signal, deadline - Date.now());
      } finally {
        wake.current = null;
      }
      interactive();
      // React may be interactive before the native presentation ACK arrives.
      await until(
        latest.current.runInteractive(
          identity!,
          viewId,
          interactive,
          async () => {
            interactive();
          },
        ),
        signal,
        deadline - Date.now(),
      );
      while (true) {
        interactive();
        if (Date.now() >= deadline)
          throw new CredentialFailure("typing-timed-out");
        setRemaining(Math.ceil((deadline - Date.now()) / 1000));
        let accepting = true;
        let released = false;
        const disposeId = (captureId: string) => {
          if (released) return;
          released = true;
          void transport({
            identity: identity!,
            viewId: viewId ?? undefined,
            action: { kind: "cancel", captureId },
          }).catch(() => {});
        };
        const pending = request({
          identity: identity!,
          viewId: viewId ?? undefined,
          action: { kind: "capture" },
        }).then((reply) => {
          // IPC is not abortable; revoke a receipt even after timeout/unmount.
          if (
            reply.status === "captured" &&
            reply.captureId &&
            (!accepting ||
              signal.aborted ||
              sequence.current !== ticket ||
              Date.now() >= deadline)
          )
            disposeId(reply.captureId);
          return reply;
        });
        const reply = await until(
          pending,
          signal,
          deadline - Date.now(),
        ).finally(() => {
          accepting = false;
        });
        if (reply.status === "waiting" && reply.captureId === "") {
          interactive();
          await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())));
          continue;
        }
        if (
          reply.status !== "captured" ||
          typeof reply.captureId !== "string" ||
          !reply.captureId ||
          reply.captureId.length > 256
        )
          throw unavailable();
        const captureId = reply.captureId;
        let disposed = released;
        let used = false;
        const assertCurrent = () => {
          interactive();
          if (disposed || work.current !== job) throw unavailable();
        };
        const receipt: CredentialTypingTarget = {
          sessionId: options.sessionId,
          assertCurrent,
          dispose: () => {
            if (!disposed) {
              disposed = true;
              disposeId(captureId);
            }
          },
          type: async (value, assertDisclosure, validity) => {
            // The notice is set here as well as in run(), so the cause is
            // shown even when the calling action swallows this rejection.
            const stop = (error: unknown) => {
              const failure = typingFailure(error, job.typingStarted);
              if (alive.current && sequence.current === ticket)
                setNotice(failure.message);
              return failure;
            };
            try {
              assertCurrent();
              assertCredentialText(value);
            } catch (error) {
              throw stop(error);
            }
            if (used) throw unavailable();
            used = true;
            setPhase("typing");
            try {
              assertDisclosure();
              const typing = latest.current.runInteractive(
                identity!,
                viewId,
                assertCurrent,
                async () => {
                  assertCurrent();
                  assertDisclosure();
                  if (
                    validity &&
                    (Date.now() < validity.starts ||
                      Date.now() >= validity.expires)
                  )
                    throw new CredentialFailure("code-expired");
                  job.typingStarted = true;
                  const result = await request({
                    identity: identity!,
                    viewId: viewId ?? undefined,
                    action: {
                      kind: "type",
                      captureId,
                      text: value,
                      credentialKind: validity ? "totp" : "credential",
                      restoreFocus: true,
                      typingMode: mode,
                      ...(validity
                        ? {
                            startsAtUnixMs: validity.starts,
                            expiresAtUnixMs: validity.expires,
                          }
                        : {}),
                    },
                  });
                  assertCurrent();
                  if (
                    result.status !== "complete" ||
                    result.captureId !== captureId
                  )
                    throw unavailable();
                },
              );
              // Disposing below revokes the request if this gives up first.
              await settleWithin(
                typing,
                typeTimeoutMs,
                () =>
                  new CredentialFailure(
                    "typing-not-confirmed",
                    job.typingStarted,
                  ),
              );
              job.completed = true;
            } catch (error) {
              throw stop(error);
            } finally {
              receipt.dispose();
              if (captured.current === receipt) captured.current = null;
            }
          },
        };
        captured.current = receipt;
        assertCurrent();
        setPhase("preparing");
        // The shared hook first resolves credentials/TOTP HERE, never while waiting.
        // Cancelling does not end this wait: an action stays serialized until
        // it settles. Only this limit gives one up, and then retires its target.
        await settleWithin(action(), actionTimeoutMs, () => {
          liveGeneration.current++;
          if (alive.current) setGeneration(liveGeneration.current);
          return new CredentialFailure(
            job.typingStarted ? "typing-not-confirmed" : "resolution-timed-out",
            job.typingStarted,
          );
        });
        break;
      }
    } catch (error) {
      // A rejecting action reports why the credential could not be prepared.
      if (alive.current && sequence.current === ticket)
        setNotice(
          typingFailure(error, job.typingStarted, Date.now() >= deadline)
            .message,
        );
    } finally {
      if (work.current === job) {
        captured.current?.dispose();
        captured.current = null;
        work.current = null;
        if (alive.current && sequence.current === ticket) {
          setPhase("idle");
          setRemaining(0);
          if (job.completed) setFinished((n) => n + 1);
        }
      }
    }
  }
  return {
    target,
    run,
    cancel,
    phase,
    busy: phase !== "idle",
    suspended: phase !== "idle",
    remaining,
    notice,
    finished,
    mode,
    setMode: (next: "simulated" | "instant") => {
      if (!work.current) setMode(next);
    },
    delaySeconds,
    setDelaySeconds: (value: number) => {
      if (!work.current && [0, 3, 5].includes(value)) setDelaySeconds(value);
    },
  };
}

export type OriginCredentialTypingController = ReturnType<
  typeof useOriginCredentialTyping
>;
