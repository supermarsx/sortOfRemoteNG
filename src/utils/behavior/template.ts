import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorEventContextInput,
  SafeConnectionBehaviorEventContext,
} from "../../types/connection/behavior";

const MAX_CONTEXT_TEXT = 2048;
const MAX_RENDERED_TEMPLATE = 4096;

export function sanitizeBehaviorText(
  value: unknown,
  maxLength = MAX_CONTEXT_TEXT,
): string {
  if (value === undefined || value === null) return "";
  let text = String(value).slice(0, Math.max(maxLength * 2, maxLength));

  text = text
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
      "[redacted private key]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/._~=-]+/gi, "$1 [redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(
      /\b(password|passwd|passphrase|token|api[_ -]?key|secret|authorization|cookie)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2[redacted]",
    )
    .replace(
      /([?&](?:password|passwd|passphrase|token|api[_-]?key|secret)=)[^&#\s]*/gi,
      "$1[redacted]",
    );

  return text.slice(0, maxLength);
}

const safeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function createSafeBehaviorEventContext(
  input: ConnectionBehaviorEventContextInput,
): SafeConnectionBehaviorEventContext {
  const connection = Object.freeze({
    id: sanitizeBehaviorText(input.connection?.id, 256),
    name: sanitizeBehaviorText(input.connection?.name),
    protocol: sanitizeBehaviorText(input.connection?.protocol, 128),
    hostname: sanitizeBehaviorText(input.connection?.hostname),
    port: safeNumber(input.connection?.port),
  });
  const session = input.session
    ? Object.freeze({
        id: sanitizeBehaviorText(input.session.id, 256),
        name: sanitizeBehaviorText(input.session.name),
        status: sanitizeBehaviorText(input.session.status, 128),
      })
    : undefined;
  const windowContext = input.window
    ? Object.freeze({
        id: sanitizeBehaviorText(input.window.id, 256),
        kind: input.window.kind,
        activeSessionId: input.window.activeSessionId
          ? sanitizeBehaviorText(input.window.activeSessionId, 256)
          : undefined,
      })
    : undefined;
  const error = input.error
    ? Object.freeze({
        message: sanitizeBehaviorText(input.error.message),
        code: input.error.code
          ? sanitizeBehaviorText(input.error.code, 256)
          : undefined,
      })
    : undefined;

  return Object.freeze({
    eventId: sanitizeBehaviorText(input.eventId, 256),
    parentEventId: input.parentEventId
      ? sanitizeBehaviorText(input.parentEventId, 256)
      : undefined,
    type: input.type,
    timestamp: safeNumber(input.timestamp) ?? 0,
    source: sanitizeBehaviorText(input.source, 256),
    reason: input.reason,
    previousStatus: input.previousStatus
      ? sanitizeBehaviorText(input.previousStatus, 128)
      : undefined,
    connection,
    session,
    window: windowContext,
    error,
  });
}

const templateValues = (
  context: SafeConnectionBehaviorEventContext,
): Readonly<Record<string, string>> => ({
  "event.id": context.eventId,
  "event.type": context.type,
  "event.reason": context.reason ?? "",
  "event.source": context.source,
  "connection.id": context.connection.id,
  "connection.name": context.connection.name,
  "connection.protocol": context.connection.protocol,
  "connection.hostname": context.connection.hostname,
  "connection.port":
    context.connection.port === undefined
      ? ""
      : String(context.connection.port),
  "session.id": context.session?.id ?? "",
  "session.name": context.session?.name ?? "",
  "session.status": context.session?.status ?? "",
  "window.id": context.window?.id ?? "",
  "window.kind": context.window?.kind ?? "",
  "error.message": context.error?.message ?? "",
  "error.code": context.error?.code ?? "",
});

export function renderBehaviorTemplate(
  template: string | undefined,
  context: SafeConnectionBehaviorEventContext,
): string {
  if (!template) return "";
  const values = templateValues(context);
  const rendered = template
    .slice(0, MAX_RENDERED_TEMPLATE)
    .replace(
      /{{\s*([A-Za-z0-9_.]+)\s*}}/g,
      (_match, key: string) => values[key] ?? "",
    );
  return sanitizeBehaviorText(rendered, MAX_RENDERED_TEMPLATE);
}

export function materializeBehaviorAction(
  action: ConnectionBehaviorActionV1,
  context: SafeConnectionBehaviorEventContext,
): ConnectionBehaviorActionV1 {
  if (action.type === "notify") {
    return {
      ...action,
      title: renderBehaviorTemplate(action.title, context),
      message: renderBehaviorTemplate(action.message, context),
    };
  }
  if (action.type === "writeLog") {
    return {
      ...action,
      message: renderBehaviorTemplate(action.message, context),
    };
  }
  return action;
}
