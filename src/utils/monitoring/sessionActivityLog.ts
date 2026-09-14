import type { ActionLogEntry } from "../../types/settings/settings";
import { SettingsManager } from "../settings/settingsManager";

export type SessionActivitySource =
  "autofill" | "website_script" | "website_macro" | "ssh_script" | "ssh_macro";
export interface SessionActivityContext {
  sessionId: string;
  connectionId: string;
  databaseId: string;
}
const SOURCES: Record<SessionActivitySource, string> = {
  autofill: "Website auto-fill",
  website_script: "Website script",
  website_macro: "Website macro",
  ssh_script: "SSH script",
  ssh_macro: "SSH macro",
};
const CODES = {
  awaiting_nas: ["info", "Native attempt is awaiting the verified NAS."],
  waiting_for_form: ["info", "Native attempt is waiting for the DSM form."],
  waiting_for_password: [
    "info",
    "Native attempt is waiting for the password stage.",
  ],
  credentials_released: [
    "info",
    "One-shot credentials were released. This does not confirm sign-in.",
  ],
  expired: ["warn", "Native auto-fill attempt expired."],
  cancelled: ["warn", "Native auto-fill attempt was cancelled."],
  status_unavailable: [
    "warn",
    "Native auto-fill status could not be observed. No sign-in retry was made.",
  ],
  waiting_document: ["info", "Page helper is waiting for document loading."],
  waiting_root: ["info", "Page helper is finding the reviewed DSM root."],
  waiting_account_form: [
    "info",
    "Page helper is finding the reviewed account form.",
  ],
  waiting_account_editable: [
    "info",
    "Page helper is waiting for an editable username field.",
  ],
  waiting_account_stable: [
    "info",
    "Page helper is checking account-control stability.",
  ],
  requesting_username: [
    "info",
    "Page helper requested the one-use username grant.",
  ],
  waiting_next_button: ["info", "Page helper is waiting for Next."],
  waiting_password_form: [
    "info",
    "Page helper is waiting for the reviewed password form.",
  ],
  requesting_password: [
    "info",
    "Page helper requested the one-use password grant.",
  ],
  waiting_signin_button: ["info", "Page helper is waiting for Sign in."],
  submitted: [
    "info",
    "Page helper reported submission. This does not confirm authentication.",
  ],
  timeout: ["warn", "Page helper reached its existing deadline."],
  stopped: ["warn", "Page helper stopped before completing submission."],
  helper_reported: [
    "info",
    "The page sent an unscoped auto-fill result hint. This is not native status or proof of authentication.",
  ],
  started: ["info", "The requested action started its guarded execution flow."],
  dispatched: [
    "info",
    "The command was accepted for dispatch. Remote completion is not known.",
  ],
  completed: [
    "info",
    "The action runner completed. Remote application success is not inferred.",
  ],
  failed: [
    "warn",
    "The action did not complete. It may have stopped after partial execution; no retry was made by this log.",
  ],
} as const;
export type SessionActivityCode = keyof typeof CODES;
const REASONS = {
  "next-not-advanced":
    "Next was clicked once, but the reviewed password transition was not accepted.",
  "form-changed": "The reviewed form identity changed.",
  "route-changed": "The reviewed page route changed.",
  captcha: "An interactive CAPTCHA was detected.",
  "credentials-unavailable": "The one-use credential grant was unavailable.",
  "invalid-credential-response":
    "The credential response did not match the reviewed protocol.",
  "input-settling":
    "The helper is allowing the page to process its input events.",
  "form-settling":
    "The helper is checking the reviewed controls; framework readiness is not inferred.",
  "button-disabled": "The reviewed action button is disabled.",
  "button-hidden": "The reviewed action button is hidden.",
  "field-disabled": "The reviewed input is disabled.",
  "field-hidden": "The reviewed input is hidden.",
  "field-readonly": "The reviewed input is read-only.",
  "panel-transition": "The page is transitioning between reviewed panels.",
} as const;

export interface SessionActivityEntry
  extends Omit<ActionLogEntry, "connectionId">, SessionActivityContext {
  source: SessionActivitySource;
  code: SessionActivityCode;
}
let sequence = 0;
let entries: readonly SessionActivityEntry[] = Object.freeze([]);
const listeners = new Set<() => void>();
function changed() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* Observers cannot affect the action being logged. */
    }
  }
}
export function subscribeSessionActivityLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSessionActivityLog(): readonly SessionActivityEntry[] {
  return entries;
}
export function clearSessionActivityLog(): void {
  if (!entries.length) return;
  entries = Object.freeze([]);
  changed();
}
/** Volatile metadata only. Never reads credentials, page content, output or a native endpoint. */
export function recordSessionActivity(
  context: SessionActivityContext | undefined,
  source: SessionActivitySource,
  code: SessionActivityCode,
  options: { durationMs?: number; reason?: string } = {},
): void {
  try {
    const settings = SettingsManager.getInstance().getSettings();
    if (!settings.enableActionLog || !context) return;
    const ids = [context.sessionId, context.connectionId, context.databaseId];
    if (
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id),
      )
    )
      return;
    if (
      !Object.prototype.hasOwnProperty.call(SOURCES, source) ||
      !Object.prototype.hasOwnProperty.call(CODES, code)
    )
      return;
    const actionCode =
      code === "started" ||
      code === "dispatched" ||
      code === "completed" ||
      code === "failed";
    if ((source === "autofill") === actionCode) return;
    const [level, summary] = CODES[code];
    const reason =
      options.reason &&
      Object.prototype.hasOwnProperty.call(REASONS, options.reason)
        ? REASONS[options.reason as keyof typeof REASONS]
        : "";
    const duration =
      typeof options.durationMs === "number" &&
      Number.isFinite(options.durationMs)
        ? Math.min(86_400_000, Math.max(0, Math.round(options.durationMs)))
        : undefined;
    const configured = settings.maxLogEntries;
    const limit =
      Number.isInteger(configured) && configured > 0
        ? Math.min(1000, configured)
        : 1000;
    const entry: SessionActivityEntry = Object.freeze({
      id: `session-activity-${++sequence}`,
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      connectionId: context.connectionId,
      databaseId: context.databaseId,
      source,
      code,
      level,
      action: SOURCES[source],
      details: reason ? `${summary} ${reason}` : summary,
      ...(duration === undefined ? {} : { duration }),
    });
    entries = Object.freeze([entry, ...entries].slice(0, limit));
    changed();
  } catch {
    /* Logging must never block, retry or change an action or credential grant. */
  }
}
