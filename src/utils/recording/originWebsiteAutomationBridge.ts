import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import type { WebInteractionStep } from "../../types/recording/webAutomation";
import type {
  WebAutomationAction,
  WebAutomationOutcome,
  WebAutomationRecordingSink,
  WebAutomationTransport,
} from "./webAutomationBridge";
import {
  MAX_WEB_MACRO_STEPS,
  MAX_WEB_SCRIPT_BYTES,
  normalizeWebInteractionStep,
} from "./webAutomationLibrary";

/** Canonical host schema: native_automation.rs. No event stream or iframe. */
export interface OriginAutomationDocument {
  identity: OriginBrowserIdentity;
  documentToken: string;
  origin: string;
}
export interface OriginAutomationContext extends OriginAutomationDocument {
  scriptInjectionEnabled: boolean;
  interactionMacrosEnabled: boolean;
}
interface MutationReceipt {
  documentToken: string;
  origin: string;
  requestId: string;
}
export type NativeAutomationAction =
  | { action: "document" }
  | (MutationReceipt & { action: "script"; code: string })
  | (MutationReceipt & {
      action: "step";
      step: WebInteractionStep;
      value?: string;
    })
  | (MutationReceipt & { action: "recordStart" | "recordStop" | "cancel" });
export type NativeAutomationReply =
  | { status: "document"; documentToken: string; origin: string }
  | { status: "completed"; requestId: string }
  | {
      status: "recordingStopped";
      requestId: string;
      steps: WebInteractionStep[];
      truncated: boolean;
    }
  | {
      status: "failed";
      reason:
        | "denied"
        | "invalidRequest"
        | "staleDocument"
        | "unavailable"
        | "busy"
        | "timedOut"
        | "executionFailed";
    };
export interface OriginAutomationRequest {
  identity: OriginBrowserIdentity;
  operation: NativeAutomationAction;
}
export interface OriginAutomationTransport {
  request(request: OriginAutomationRequest): Promise<NativeAutomationReply>;
}
const unavailable = () =>
  new Error(
    "Native website automation is unavailable or its owner, permission or document changed.",
  );
const failed = () =>
  new Error(
    "The native website action was not confirmed. It may already have run; no automatic retry was made.",
  );
const printable = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  Array.from(value).every(
    (character) =>
      character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127,
  );
export function nativeAutomationDocument(
  identity: OriginBrowserIdentity,
  reply: NativeAutomationReply,
): OriginAutomationDocument {
  if (
    reply?.status !== "document" ||
    !printable(reply.documentToken, 80) ||
    !printable(reply.origin, 1024) ||
    !identity ||
    ![
      identity.ownerDatabaseId,
      identity.connectionId,
      identity.sessionId,
      identity.attemptId,
    ].every((part) => printable(part, 256))
  )
    throw unavailable();
  const url = new URL(reply.origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== reply.origin ||
    url.username ||
    url.password
  )
    throw unavailable();
  return {
    identity: { ...identity },
    documentToken: reply.documentToken,
    origin: reply.origin,
  };
}
const same = (a: OriginAutomationDocument, b: OriginAutomationDocument) =>
  a.documentToken === b.documentToken &&
  a.origin === b.origin &&
  a.identity.ownerDatabaseId === b.identity.ownerDatabaseId &&
  a.identity.connectionId === b.identity.connectionId &&
  a.identity.sessionId === b.identity.sessionId &&
  a.identity.attemptId === b.identity.attemptId;

/** Bounds command lifetimes; opaque native error text is never surfaced. */
export function requestNativeAutomation(
  transport: OriginAutomationTransport,
  request: OriginAutomationRequest,
): Promise<NativeAutomationReply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failed()), 16000);
    try {
      void transport.request(request).then(
        (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        () => {
          clearTimeout(timer);
          reject(failed());
        },
      );
    } catch {
      clearTimeout(timer);
      reject(failed());
    }
  });
}
type Recorder = WebAutomationRecordingSink & {
  context: OriginAutomationContext;
};

/** Native enforces permission, owner/attempt/document, secure targets and result
 * shape too. The trusted shell's checks are defense in depth, not authority. */
export class OriginWebsiteAutomationBridge implements WebAutomationTransport {
  private epoch = 0;
  private pending: { reject: (reason: Error) => void } | null = null;
  private recording: Recorder | null = null;
  private last: OriginAutomationContext | null = null;
  private cancellation: Promise<unknown> = Promise.resolve();
  private cancellationFailed = false;
  constructor(
    private current: () => OriginAutomationContext | null,
    private transport: OriginAutomationTransport,
  ) {}
  private check(
    context: OriginAutomationContext,
    action: WebAutomationAction,
  ): void {
    const next = this.current();
    if (
      !next ||
      this.cancellationFailed ||
      !same(next, context) ||
      (action === "script"
        ? !next.scriptInjectionEnabled
        : !next.interactionMacrosEnabled)
    )
      throw unavailable();
  }
  async request(
    action: WebAutomationAction,
    payload?: unknown,
    sink?: WebAutomationRecordingSink,
  ): Promise<WebAutomationOutcome> {
    const initial = this.current();
    if (!initial) throw unavailable();
    const context = {
      ...initial,
      ...nativeAutomationDocument(initial.identity, {
        status: "document",
        ...initial,
      }),
    };
    const epoch = this.epoch;
    this.check(context, action);
    await this.cancellation;
    if (epoch !== this.epoch) throw unavailable();
    this.check(context, action);
    if (
      this.pending ||
      (action === "recordStart" && (!sink || this.recording)) ||
      (action === "recordStop" &&
        (!this.recording || !same(context, this.recording.context))) ||
      (this.recording && action !== "recordStop")
    )
      throw unavailable();
    const requestId = crypto.randomUUID();
    const scope = {
      documentToken: context.documentToken,
      origin: context.origin,
      requestId,
    };
    let operation: NativeAutomationAction;
    const data = payload as Record<string, unknown> | undefined;
    if (
      action === "script" &&
      data &&
      Object.keys(data).every((key) => key === "code") &&
      typeof data.code === "string" &&
      data.code.trim() &&
      new TextEncoder().encode(data.code).length <= MAX_WEB_SCRIPT_BYTES &&
      Array.from(data.code).every(
        (character) =>
          character.charCodeAt(0) >= 32 || "\n\r\t".includes(character),
      )
    ) {
      operation = { action, ...scope, code: data.code };
    } else if (
      action === "step" &&
      data &&
      Object.keys(data).every((key) => key === "step" || key === "value")
    ) {
      const step = normalizeWebInteractionStep(data.step);
      if (
        step.kind === "fill"
          ? typeof data.value !== "string" ||
            new TextEncoder().encode(data.value).length > 4096
          : data.value !== undefined
      )
        throw unavailable();
      operation = {
        action,
        ...scope,
        step,
        ...(typeof data.value === "string" ? { value: data.value } : {}),
      };
    } else if (
      (action === "recordStart" || action === "recordStop") &&
      payload === undefined
    )
      operation = { action, ...scope };
    else
      throw new Error(
        "This action is not supported by the native website automation transport.",
      );
    this.last = context;
    if (action === "recordStart") this.recording = { context, ...sink! };
    return new Promise((resolve, reject) => {
      const pending = { reject };
      this.pending = pending;
      void requestNativeAutomation(this.transport, {
        identity: context.identity,
        operation,
      }).then(
        (reply) => {
          if (this.pending !== pending) return;
          try {
            if (epoch !== this.epoch) throw unavailable();
            this.check(context, action);
            if (action === "recordStop") {
              if (
                reply?.status !== "recordingStopped" ||
                reply.requestId !== requestId ||
                typeof reply.truncated !== "boolean" ||
                !Array.isArray(reply.steps) ||
                reply.steps.length > MAX_WEB_MACRO_STEPS
              )
                throw failed();
              // Validate the whole batch before admitting any step. Never silently
              // save/replay a truncated recording as though it were complete.
              const steps = reply.steps.map(normalizeWebInteractionStep);
              if (reply.truncated)
                throw new Error(
                  "Native recording reached its limit. The incomplete recording was discarded; record a shorter macro.",
                );
              const recorder = this.recording;
              if (!recorder) throw unavailable();
              for (const step of steps) recorder.onStep(step);
              this.recording = null;
              recorder.onStop();
            } else if (
              reply?.status !== "completed" ||
              reply.requestId !== requestId
            )
              throw failed();
            this.pending = null;
            // A synchronous V8 evaluation ACK does not prove asynchronous website
            // effects completed. Keep the existing UI's conservative wording.
            resolve(action === "script" ? "dispatched" : undefined);
          } catch (error) {
            reject(error instanceof Error ? error : failed());
            this.cancel();
          }
        },
        () => {
          if (this.pending === pending) {
            reject(failed());
            this.cancel();
          }
        },
      );
    });
  }
  cancel(): void {
    this.epoch++;
    this.pending?.reject(unavailable());
    this.pending = null;
    const recorder = this.recording;
    this.recording = null;
    recorder?.onStop();
    const context = this.last;
    this.last = null;
    if (context)
      this.cancellation = this.cancellation.then(async () => {
        const requestId = crypto.randomUUID();
        try {
          const reply = await requestNativeAutomation(this.transport, {
            identity: context.identity,
            operation: {
              action: "cancel",
              documentToken: context.documentToken,
              origin: context.origin,
              requestId,
            },
          });
          // Host has already retired the document: there is nothing left to
          // cancel on it, and mutations still cannot target a replacement token.
          if (
            !(reply?.status === "completed" && reply.requestId === requestId) &&
            !(reply?.status === "failed" && reply.reason === "staleDocument")
          )
            this.cancellationFailed = true;
        } catch {
          this.cancellationFailed = true;
        }
      });
  }
  dispose(): void {
    this.cancel();
  }
}
