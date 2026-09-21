import type {
  WebAutomationDocument,
  WebInteractionStep,
} from "../../types/recording/webAutomation";
import { normalizeWebInteractionStep } from "./webAutomationLibrary";

export type WebAutomationAction =
  | "recordStart"
  | "recordStop"
  | "step"
  | "script"
  | "dark"
  | "print"
  | "cancel"
  | "totpProbe"
  | "totpSubmit"
  | "totpCancel";
export interface WebAutomationContext {
  frame: Window;
  document: WebAutomationDocument;
}
/**
 * Which path themed the page, for `dark` acknowledgements only. A fixed,
 * two-member enum: the page supplies no wording, and an unrecognized value is
 * dropped, so nothing a page controls can reach app chrome as text.
 */
export type WebDarkOutcome = "engine" | "cssOnly";
const DARK_OUTCOMES: readonly unknown[] = ["engine", "cssOnly"];
type Pending = {
  context: WebAutomationContext;
  action: WebAutomationAction;
  resolve: (outcome?: WebDarkOutcome) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  stopRecordingId?: string;
};
const sameDocument = (a: WebAutomationDocument, b: WebAutomationDocument) =>
  a.generation === b.generation &&
  a.sessionId === b.sessionId &&
  a.token === b.token &&
  a.sequence === b.sequence &&
  a.navigationToken === b.navigationToken &&
  a.url === b.url;
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** Parent-owned request correlation. Page replies can only acknowledge an armed
 * action or supply a strictly typed, value-free step; never native capabilities. */
export class WebAutomationBridge {
  private pending = new Map<string, Pending>();
  private lastContext: WebAutomationContext | null = null;
  private recording: {
    id: string;
    context: WebAutomationContext;
    count: number;
    onStep: (step: WebInteractionStep) => void;
    onStop: () => void;
  } | null = null;
  constructor(private current: () => WebAutomationContext | null) {}

  private disarmRecording(id: string | undefined) {
    if (id === undefined || this.recording?.id !== id) return;
    const recording = this.recording;
    this.recording = null;
    recording.onStop();
  }

  private send(
    context: WebAutomationContext,
    id: string,
    action: WebAutomationAction,
    payload?: unknown,
  ) {
    const doc = context.document;
    this.lastContext = context;
    context.frame.postMessage(
      {
        type: "sorng_web_automation",
        version: 1,
        sessionId: doc.sessionId,
        documentToken: doc.token,
        documentSequence: doc.sequence,
        navigationToken: doc.navigationToken,
        url: doc.url,
        requestId: id,
        action,
        payload,
      },
      new URL(doc.url).origin,
    );
  }
  request(
    action: WebAutomationAction,
    payload?: unknown,
    recording?: {
      onStep: (step: WebInteractionStep) => void;
      onStop: () => void;
    },
  ): Promise<WebDarkOutcome | undefined> {
    const context = this.current();
    if (!context)
      return Promise.reject(
        new Error("Wait for the current trusted page to be ready."),
      );
    if (this.pending.size >= 4)
      return Promise.reject(new Error("A website action is already pending."));
    const id = token();
    if (action === "recordStart" && recording)
      this.recording = { id, context, count: 0, ...recording };
    // The stop acknowledgement is the same-frame FIFO end marker. Keep the
    // reviewed recorder armed for steps already queued before that marker.
    const stopRecordingId =
      action === "recordStop" ? this.recording?.id : undefined;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.disarmRecording(id);
        this.disarmRecording(stopRecordingId);
        reject(
          new Error(
            "The page action did not acknowledge completion. It may already have run.",
          ),
        );
      }, 15000);
      this.pending.set(id, {
        context,
        action,
        resolve,
        reject,
        timer,
        stopRecordingId,
      });
      try {
        this.send(context, id, action, payload);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.disarmRecording(id);
        this.disarmRecording(stopRecordingId);
        reject(new Error("The website action could not be delivered."));
      }
    });
  }
  handleMessage(event: MessageEvent): void {
    const context = this.current(),
      data = event.data;
    if (
      !context ||
      event.source !== context.frame ||
      event.origin !== new URL(context.document.url).origin ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.type !== "proxy_web_automation" ||
      data.version !== 1
    )
      return;
    const doc = context.document;
    if (
      data.sessionId !== doc.sessionId ||
      data.documentToken !== doc.token ||
      data.documentSequence !== doc.sequence ||
      data.navigationToken !== doc.navigationToken ||
      data.url !== doc.url ||
      typeof data.requestId !== "string"
    )
      return;
    const recorder = this.recording;
    if (
      recorder !== null &&
      recorder.id === data.requestId &&
      sameDocument(recorder.context.document, doc)
    ) {
      if (data.status === "limit") {
        this.disarmRecording(recorder.id);
        return;
      }
      if (data.status === "step") {
        if (
          !Number.isSafeInteger(data.stepNumber) ||
          data.stepNumber !== recorder.count + 1 ||
          recorder.count >= 200
        )
          return;
        try {
          const step = normalizeWebInteractionStep(data.step);
          recorder.count++;
          recorder.onStep(step);
        } catch {
          /* Hostile/unsupported step data is never stored. */
        }
        return;
      }
    }
    const pending = this.pending.get(data.requestId);
    if (
      !pending ||
      !sameDocument(pending.context.document, doc) ||
      !["ok", "failed"].includes(data.status)
    )
      return;
    clearTimeout(pending.timer);
    this.pending.delete(data.requestId);
    this.disarmRecording(pending.stopRecordingId);
    if (data.status === "ok")
      pending.resolve(
        pending.action === "dark" && DARK_OUTCOMES.includes(data.darkOutcome)
          ? (data.darkOutcome as WebDarkOutcome)
          : undefined,
      );
    else {
      this.disarmRecording(data.requestId);
      pending.reject(
        new Error(
          "The page refused or could not complete this action. Check the current target and script.",
        ),
      );
    }
  }
  cancel(
    disableDark = false,
    action: "cancel" | "totpCancel" = "cancel",
  ): void {
    // Revocation may already make current() unavailable. Cleanup only targets
    // the previously addressed document; a replacement rejects its identity.
    const context = this.current() ?? this.lastContext;
    if (context)
      try {
        this.send(context, token(), action);
        if (disableDark)
          this.send(context, token(), "dark", { enabled: false });
      } catch {
        /* Page is already gone. */
      }
    if (this.recording) this.recording.onStop();
    this.recording = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          "Website action cancelled because its page or access changed.",
        ),
      );
    }
    this.pending.clear();
    if (disableDark) this.lastContext = null;
  }
}
