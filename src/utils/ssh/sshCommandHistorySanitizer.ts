import {
  SSHCommandCategories,
  type CommandExecution,
  type CommandExecutionEvidence,
  type CommandExecutionSource,
  type CommandExecutionStatus,
  type SSHCommandCategory,
  type SSHCommandHistoryEntry,
} from "../../types/ssh/sshCommandHistory";
import { generateId } from "../core/id";
import { redactSecrets } from "../errors/redact";
import { commandExecutionDisplayStatus } from "./sshCommandEvidence";

export const SSH_COMMAND_HISTORY_SYNC_EVENT =
  "sortofremoteng:ssh-command-history-sync";

const UNSAFE_BIDI_CONTROLS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
const SECRET_ARGUMENT_PATTERN =
  /(^|\s)((?:--?)(?:password|passwd|passphrase|secret|token|api[_-]?key|authorization)(?:\s+))("[^"]*"|'[^']*'|\S+)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;

export const MAX_SSH_HISTORY_ENTRIES = 250;
export const MAX_SSH_HISTORY_EXECUTIONS_PER_ENTRY = 20;
export const MAX_SSH_HISTORY_OUTPUT_CHARS = 16_384;
export const MAX_SSH_HISTORY_COMMAND_CHARS = 8_192;

type SanitizeMode = "storage" | "import";

interface SanitizeOptions {
  mode?: SanitizeMode;
  maxOutputSize?: number;
  fallbackCategory?: (command: string) => SSHCommandCategory;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function sanitizeSSHHistoryString(
  value: unknown,
  maxLength: number,
  options: { required?: boolean; multiline?: boolean } = {},
): string | undefined {
  if (typeof value !== "string") return undefined;
  const withoutControls = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
        return true;
      }
      return !(
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        UNSAFE_BIDI_CONTROLS.has(codePoint)
      );
    })
    .join("");
  const normalized = options.multiline
    ? withoutControls
    : withoutControls.replace(/[\r\n\t]/g, " ");
  const bounded = normalized.slice(0, maxLength);
  return options.required && !bounded.trim() ? undefined : bounded;
}

export function redactSSHHistoryString(value: string): string {
  return redactSecrets(value)
    .replace(
      SECRET_ARGUMENT_PATTERN,
      (_match, leading: string, flag: string) => `${leading}${flag}[redacted]`,
    )
    .replace(BEARER_PATTERN, (_match, prefix: string) => `${prefix}[redacted]`)
    .replace(
      URL_CREDENTIAL_PATTERN,
      (_match, prefix: string, _password: string, suffix: string) =>
        `${prefix}[redacted]${suffix}`,
    );
}

const validDate = (value: unknown, fallback?: string): string | undefined => {
  const date = sanitizeSSHHistoryString(value, 128);
  return date && Number.isFinite(Date.parse(date)) ? date : fallback;
};

function sanitizeExecution(
  value: unknown,
  options: Required<Pick<SanitizeOptions, "mode" | "maxOutputSize">>,
): CommandExecution | null {
  if (!isRecord(value)) return null;
  const sessionId = sanitizeSSHHistoryString(value.sessionId, 512, {
    required: true,
  });
  const sessionName = sanitizeSSHHistoryString(value.sessionName, 512, {
    required: true,
  });
  const hostname = sanitizeSSHHistoryString(value.hostname, 512, {
    required: true,
  });
  if (!sessionId || !sessionName || !hostname) return null;

  const status = ["success", "error", "pending", "cancelled"].includes(
    String(value.status),
  )
    ? (value.status as CommandExecutionStatus)
    : "cancelled";
  const source =
    options.mode === "import"
      ? "imported"
      : ["bulk-dispatch", "web-terminal-script", "imported"].includes(
            String(value.source),
          )
        ? (value.source as CommandExecutionSource)
        : undefined;
  const evidence =
    options.mode === "storage" &&
    ["dispatch-accepted", "dispatch-failed", "remote-completion"].includes(
      String(value.evidence),
    )
      ? (value.evidence as CommandExecutionEvidence)
      : undefined;
  const execution: CommandExecution = {
    sessionId,
    sessionName,
    hostname,
    executedAt: validDate(value.executedAt),
    source,
    evidence,
    status,
    output: sanitizeSSHHistoryString(value.output, options.maxOutputSize, {
      multiline: true,
    }),
    stderr: sanitizeSSHHistoryString(value.stderr, options.maxOutputSize, {
      multiline: true,
    }),
    errorMessage: sanitizeSSHHistoryString(value.errorMessage, 8192, {
      multiline: true,
    }),
    exitCode:
      typeof value.exitCode === "number" && Number.isFinite(value.exitCode)
        ? value.exitCode
        : undefined,
    durationMs:
      typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
        ? value.durationMs
        : undefined,
  };
  const displayStatus = commandExecutionDisplayStatus(execution);
  const metadata: CommandExecution = {
    sessionId,
    sessionName,
    hostname,
    ...(execution.executedAt ? { executedAt: execution.executedAt } : {}),
    ...(source ? { source } : {}),
    ...(evidence ? { evidence } : {}),
    status,
  };
  if (displayStatus === "unverified" || displayStatus === "dispatched") {
    return metadata;
  }
  if (displayStatus === "dispatch-failed") {
    return {
      ...metadata,
      ...(execution.errorMessage
        ? { errorMessage: execution.errorMessage }
        : {}),
    };
  }
  return execution;
}

export function sanitizeSSHCommandHistoryEntry(
  value: unknown,
  options: SanitizeOptions = {},
): SSHCommandHistoryEntry | null {
  if (!isRecord(value)) return null;
  const command = sanitizeSSHHistoryString(
    value.command,
    MAX_SSH_HISTORY_COMMAND_CHARS,
    {
      required: true,
    },
  );
  const redactedCommand = command
    ? redactSSHHistoryString(command).trim()
    : undefined;
  if (!redactedCommand) return null;
  const now = new Date().toISOString();
  const createdAt = validDate(value.createdAt, now) ?? now;
  const lastExecutedAt =
    validDate(value.lastExecutedAt, createdAt) ?? createdAt;
  const mode = options.mode ?? "storage";
  const maxOutputSize = Math.max(0, options.maxOutputSize ?? 65_536);
  const executions = Array.isArray(value.executions)
    ? value.executions
        .map((execution) =>
          sanitizeExecution(execution, { mode, maxOutputSize }),
        )
        .filter(
          (execution): execution is CommandExecution => execution !== null,
        )
        .slice(-MAX_SSH_HISTORY_EXECUTIONS_PER_ENTRY)
    : [];
  const category =
    typeof value.category === "string" &&
    SSHCommandCategories.includes(value.category as SSHCommandCategory)
      ? (value.category as SSHCommandCategory)
      : (options.fallbackCategory?.(redactedCommand) ?? "unknown");
  return {
    id:
      sanitizeSSHHistoryString(value.id, 512, { required: true })?.trim() ??
      generateId(),
    command: redactedCommand,
    createdAt,
    lastExecutedAt,
    executionCount:
      typeof value.executionCount === "number" &&
      Number.isFinite(value.executionCount) &&
      value.executionCount >= 0
        ? Math.min(Math.floor(value.executionCount), 1_000_000)
        : Math.max(1, executions.length),
    starred: value.starred === true,
    tags: Array.isArray(value.tags)
      ? value.tags
          .map((tag) => sanitizeSSHHistoryString(tag, 128, { required: true }))
          .filter((tag): tag is string => tag !== undefined)
          .slice(0, 64)
      : [],
    category,
    executions,
    note: sanitizeSSHHistoryString(value.note, 8192, { multiline: true }),
  };
}

export function sanitizeSSHCommandHistory(
  value: unknown,
  options: SanitizeOptions = {},
): SSHCommandHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeSSHCommandHistoryEntry(entry, options))
    .filter((entry): entry is SSHCommandHistoryEntry => entry !== null);
}

export function redactSSHCommandHistorySecrets(
  entries: readonly SSHCommandHistoryEntry[],
  maxOutputSize = MAX_SSH_HISTORY_OUTPUT_CHARS,
): SSHCommandHistoryEntry[] {
  const boundedOutputSize = Math.min(
    MAX_SSH_HISTORY_OUTPUT_CHARS,
    Math.max(0, Math.floor(maxOutputSize)),
  );
  const redacted = entries.slice(0, MAX_SSH_HISTORY_ENTRIES).map((entry) => ({
    ...entry,
    command: redactSSHHistoryString(entry.command),
    note:
      entry.note === undefined ? undefined : redactSSHHistoryString(entry.note),
    tags: entry.tags.map(redactSSHHistoryString),
    executions: entry.executions
      .slice(-MAX_SSH_HISTORY_EXECUTIONS_PER_ENTRY)
      .map((execution) => ({
        ...execution,
        sessionName: redactSSHHistoryString(execution.sessionName),
        hostname: redactSSHHistoryString(execution.hostname),
        output:
          execution.output === undefined
            ? undefined
            : redactSSHHistoryString(execution.output).slice(
                0,
                boundedOutputSize,
              ),
        stderr:
          execution.stderr === undefined
            ? undefined
            : redactSSHHistoryString(execution.stderr).slice(
                0,
                boundedOutputSize,
              ),
        errorMessage:
          execution.errorMessage === undefined
            ? undefined
            : redactSSHHistoryString(execution.errorMessage).slice(
                0,
                boundedOutputSize,
              ),
      })),
  }));
  return sanitizeSSHCommandHistory(redacted, {
    mode: "storage",
    maxOutputSize: boundedOutputSize,
  });
}
