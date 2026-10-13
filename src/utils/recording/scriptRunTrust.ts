import { isDestructiveBulkScript } from "../../hooks/ssh/bulkScriptLibrary";
import type { AutomationScope } from "../../types/recording/automationLibrary";
import type { SanitizedValue } from "../storage/appDataJsonStore";

/**
 * The record of scripts the user chose to run without being asked again, on
 * one saved connection or everywhere. This file is the pure part: the shape
 * of the record, the digests it is bound to, and the one function that says
 * whether a run is trusted. Reading and writing live in `scriptRunTrustStore`.
 *
 * The record holds ids and digests only: never script text, a step, a name,
 * a host, a user or a secret. A script is trusted for exactly the content
 * whose digest was recorded; an edit asks again, and the same content back
 * again is trusted again. Anything that cannot be read as a whole, valid
 * record trusts nothing.
 */

/** The only app-data key the record lives under. No export, backup or sync names it. */
export const RUN_TRUST_STORE_KEY = "automation.run-trust.v1";
export const MAX_SCRIPT_TRUST_ENTRIES = 1000;
/** Stored text longer than this is refused unparsed. A full record stays well under it. */
export const MAX_SCRIPT_TRUST_RECORD_CHARS = 2_000_000;
export const MAX_SCRIPT_TRUST_ID_LENGTH = 128;

const CONTENT_DIGEST_TAG = "sorng.run-trust.content.v1";
const ENDPOINT_DIGEST_TAG = "sorng.run-trust.endpoint.v1";

const SCRIPT_TRUST_KINDS = ["ssh-script", "ssh-macro", "bulk-script"] as const;
export type ScriptTrustKind = (typeof SCRIPT_TRUST_KINDS)[number];
/** The library the script lives in. The same id in another library is another script. */
export type ScriptTrustLibrary = AutomationScope;
export type ScriptTrustScope = "everywhere" | "connection";
/** The classifier's answer when the trust was given. Display only. */
export type ScriptTrustRisk = "standard" | "destructive";

/** What a "connection" grant is tied to: one saved row, as it was when trusted. */
export interface ScriptTrustConnectionBinding {
  databaseId: string;
  connectionId: string;
  /** `digestConnectionEndpoint` of the row's protocol, host, port, user, domain and credential reference. */
  endpointDigest: string;
}

export interface ScriptTrustEntry {
  kind: ScriptTrustKind;
  library: ScriptTrustLibrary;
  subjectId: string;
  /** `digestRunContent` of exactly what would be sent. */
  contentDigest: string;
  scope: ScriptTrustScope;
  /** Present for the "connection" scope, and only then. */
  connection?: ScriptTrustConnectionBinding;
  risk: ScriptTrustRisk;
  /** ISO time. */
  grantedAt: string;
}

export interface ScriptTrustRecord {
  version: 1;
  entries: ScriptTrustEntry[];
}

/** One script or macro in one library. */
export interface ScriptTrustSubjectRef {
  kind: ScriptTrustKind;
  library: ScriptTrustLibrary;
  subjectId: string;
}

/** One entry of the record, whatever content it was given for. */
export interface ScriptTrustEntryRef extends ScriptTrustSubjectRef {
  scope: ScriptTrustScope;
  /** For the "connection" scope, and only then. */
  connection?: { databaseId: string; connectionId: string };
}

/** The question a run asks: is this exact content trusted here? */
export interface ScriptTrustQuery extends ScriptTrustSubjectRef {
  contentDigest: string;
  /** The verified binding of the session's saved connection, or null when there is none. */
  connection: ScriptTrustConnectionBinding | null;
}

interface ScriptTrustGrantBase {
  library: ScriptTrustLibrary;
  subjectId: string;
  contentDigest: string;
  risk: ScriptTrustRisk;
}

/**
 * A lasting answer, as the user gave it in a confirmed prompt. Every part is
 * named by the caller: there is no default scope, no wildcard and no pattern,
 * and a connection grant carries the whole binding.
 */
export type ScriptTrustGrant =
  | (ScriptTrustGrantBase & { kind: ScriptTrustKind; scope: "everywhere" })
  | (ScriptTrustGrantBase & {
      kind: "ssh-script" | "ssh-macro";
      scope: "connection";
      connection: ScriptTrustConnectionBinding;
    });

/** Thrown for stored data that is not a whole, valid record. Says nothing about it. */
export class ScriptTrustRecordError extends Error {
  constructor() {
    super("The record of trusted scripts could not be read.");
    this.name = "ScriptTrustRecordError";
  }
}

export const emptyScriptTrustRecord = (): ScriptTrustRecord => ({
  version: 1,
  entries: [],
});

// ─── What a run sends ───────────────────────────────────────────

/**
 * A value of the expected type as it is. Anything else goes under a tag that
 * no well-formed value can equal, so two different inputs never share a digest.
 */
const exact = (value: unknown, type: "string" | "number" | "boolean") => {
  if (typeof value === type && (type !== "number" || Number.isFinite(value)))
    return value;
  let text = "";
  try {
    text = String(value);
  } catch {
    // An object that cannot be printed is still not a well-formed value.
  }
  return { invalid: `${typeof value}:${text}` };
};

/** The text a terminal script sends: the stored text without its `#!` lines. */
export const sshScriptCommand = (scriptText: string): string =>
  scriptText
    .split("\n")
    .filter((line) => !line.startsWith("#!"))
    .join("\n");

/** A terminal script as it is executed: the interpreter's language and the command. */
export const sshScriptRunContent = (language: string, command: string) =>
  JSON.stringify([exact(language, "string"), exact(command, "string")]);

/** A macro as it is replayed: text, pause and Enter of every step, in order. */
export const sshMacroRunContent = (
  steps: readonly { command: string; delayMs: number; sendNewline: boolean }[],
): string =>
  JSON.stringify(
    steps.map((step) => [
      exact(step?.command, "string"),
      exact(step?.delayMs, "number"),
      exact(step?.sendNewline, "boolean"),
    ]),
  );

/** A Bulk-commander command as it is sent, before the line feed. */
export const bulkScriptRunContent = (command: string): string => command.trim();

async function digest(parts: readonly unknown[]): Promise<string> {
  // A JSON array keeps the parts apart: no text can move from one to the next.
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/** `content` is the result of one of the three `...RunContent` functions for `kind`. */
export const digestRunContent = (
  kind: ScriptTrustKind,
  content: string,
): Promise<string> =>
  digest([CONTENT_DIGEST_TAG, exact(kind, "string"), exact(content, "string")]);

export interface ScriptTrustEndpoint {
  databaseId: string;
  connectionId: string;
  protocol: string;
  host: string;
  port: number;
  username?: string | null;
  domain?: string | null;
  /** `credentialSource.kind` of the saved row. */
  credentialKind?: string | null;
  /** The vault credential the row refers to. */
  credentialId?: string | null;
}

/** An empty user, domain or credential reference is the same as none. */
export const digestConnectionEndpoint = (
  endpoint: ScriptTrustEndpoint,
): Promise<string> =>
  digest([
    ENDPOINT_DIGEST_TAG,
    endpoint.databaseId,
    endpoint.connectionId,
    endpoint.protocol,
    endpoint.host,
    endpoint.port,
    endpoint.username || null,
    endpoint.domain || null,
    endpoint.credentialKind || null,
    endpoint.credentialId || null,
  ]);

export type ScriptRunRiskInput =
  | { kind: "ssh-script" | "bulk-script"; command: string }
  | { kind: "ssh-macro"; steps: readonly { command: string }[] };

/** The Bulk library's classifier, over the command or over the steps as lines. */
export function classifyRunRisk(input: ScriptRunRiskInput): ScriptTrustRisk {
  const text =
    input.kind === "ssh-macro"
      ? input.steps.map((step) => step.command).join("\n")
      : input.command;
  return isDestructiveBulkScript(text) ? "destructive" : "standard";
}

// ─── Reading values ─────────────────────────────────────────────

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A script, connection or database id as the record accepts it. */
export const isScriptTrustId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_SCRIPT_TRUST_ID_LENGTH &&
  value.trim().length > 0 &&
  !Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && DIGEST_PATTERN.test(value);

const isKind = (value: unknown): value is ScriptTrustKind =>
  SCRIPT_TRUST_KINDS.includes(value as ScriptTrustKind);

const isRisk = (value: unknown): value is ScriptTrustRisk =>
  value === "standard" || value === "destructive";

const isTime = (value: unknown): value is string => {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

/** `strict` is for stored data: a key that does not belong makes the value invalid. */
const readLibrary = (
  value: unknown,
  strict: boolean,
): ScriptTrustLibrary | null => {
  if (!isObject(value)) return null;
  const keys = Object.keys(value).length;
  if (value.kind === "app")
    return value.databaseId !== undefined || (strict && keys !== 1)
      ? null
      : { kind: "app" };
  if (value.kind === "database" && isScriptTrustId(value.databaseId))
    return strict && keys !== 2
      ? null
      : { kind: "database", databaseId: value.databaseId };
  return null;
};

const readBinding = (
  value: unknown,
  strict: boolean,
): ScriptTrustConnectionBinding | null =>
  isObject(value) &&
  isScriptTrustId(value.databaseId) &&
  isScriptTrustId(value.connectionId) &&
  isDigest(value.endpointDigest) &&
  !(strict && Object.keys(value).length !== 3)
    ? {
        databaseId: value.databaseId,
        connectionId: value.connectionId,
        endpointDigest: value.endpointDigest,
      }
    : null;

/** A new object with the entry's own fields in a fixed order, or null. Nothing else is copied. */
const readEntry = (
  value: unknown,
  strict: boolean,
): ScriptTrustEntry | null => {
  if (!isObject(value)) return null;
  const { kind, subjectId, contentDigest, scope, risk, grantedAt } = value;
  if (
    !isKind(kind) ||
    !isScriptTrustId(subjectId) ||
    !isDigest(contentDigest) ||
    !isRisk(risk) ||
    !isTime(grantedAt)
  )
    return null;
  const library = readLibrary(value.library, strict);
  if (!library) return null;
  // A bulk script goes to a selection of sessions and lives in the app's library.
  if (
    kind === "bulk-script" &&
    (scope !== "everywhere" || library.kind !== "app")
  )
    return null;
  const keys = Object.keys(value).length;
  if (scope === "everywhere") {
    if (value.connection !== undefined || (strict && keys !== 7)) return null;
    return { kind, library, subjectId, contentDigest, scope, risk, grantedAt };
  }
  if (scope !== "connection") return null;
  const connection = readBinding(value.connection, strict);
  if (!connection || (strict && keys !== 8)) return null;
  return {
    kind,
    library,
    subjectId,
    contentDigest,
    scope,
    connection,
    risk,
    grantedAt,
  };
};

/**
 * The entry a grant becomes, or null when the grant is not complete and
 * coherent. Only the entry's own fields are taken from `grant`.
 */
export function createScriptTrustEntry(
  grant: ScriptTrustGrant,
  grantedAt: string,
): ScriptTrustEntry | null {
  return isObject(grant) ? readEntry({ ...grant, grantedAt }, false) : null;
}

const libraryKey = (library: ScriptTrustLibrary): [string, string] => [
  library.kind,
  library.kind === "database" ? library.databaseId : "",
];

/** The same for every entry of one script in one library. */
export const scriptTrustSubjectKey = (subject: ScriptTrustSubjectRef): string =>
  JSON.stringify([
    subject.kind,
    ...libraryKey(subject.library),
    subject.subjectId,
  ]);

/** The record holds one entry per key: a grant with the same key replaces it. */
export const scriptTrustEntryKey = (entry: ScriptTrustEntryRef): string =>
  JSON.stringify([
    entry.kind,
    ...libraryKey(entry.library),
    entry.subjectId,
    entry.scope,
    entry.scope === "connection" ? (entry.connection?.databaseId ?? "") : "",
    entry.scope === "connection" ? (entry.connection?.connectionId ?? "") : "",
  ]);

export const isScriptTrustSubjectRef = (
  value: unknown,
): value is ScriptTrustSubjectRef =>
  isObject(value) &&
  isKind(value.kind) &&
  isScriptTrustId(value.subjectId) &&
  readLibrary(value.library, false) !== null;

export const isScriptTrustEntryRef = (
  value: unknown,
): value is ScriptTrustEntryRef => {
  if (!isScriptTrustSubjectRef(value)) return false;
  const { scope, connection } = value as {
    scope?: unknown;
    connection?: unknown;
  };
  if (scope === "everywhere") return connection === undefined;
  return (
    scope === "connection" &&
    isObject(connection) &&
    isScriptTrustId(connection.databaseId) &&
    isScriptTrustId(connection.connectionId)
  );
};

export const isScriptTrustQuery = (value: unknown): value is ScriptTrustQuery =>
  isScriptTrustSubjectRef(value) &&
  isDigest((value as { contentDigest?: unknown }).contentDigest) &&
  ((value as { connection?: unknown }).connection === null ||
    readBinding((value as { connection?: unknown }).connection, false) !==
      null);

// ─── The record ─────────────────────────────────────────────────

/**
 * The store's reader. It returns a valid record entry for entry and never
 * repairs one: a foreign shape, another version, an entry that is not valid,
 * two entries with one key or more than the cap throw, so that a damaged
 * record trusts nothing and is never rewritten from what is left of it.
 */
export function sanitizeScriptTrustRecord(
  value: unknown,
): SanitizedValue<ScriptTrustRecord> {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    Object.keys(value).length !== 2 ||
    value.entries.length > MAX_SCRIPT_TRUST_ENTRIES
  )
    throw new ScriptTrustRecordError();
  const keys = new Set<string>();
  const entries: ScriptTrustEntry[] = [];
  for (let index = 0; index < value.entries.length; index += 1) {
    const entry = readEntry(value.entries[index], true);
    const key = entry ? scriptTrustEntryKey(entry) : undefined;
    if (!entry || key === undefined || keys.has(key))
      throw new ScriptTrustRecordError();
    keys.add(key);
    entries.push(entry);
  }
  return { value: { version: 1, entries }, changed: false };
}

/** Stored text to a record, by the same rules. Throws `ScriptTrustRecordError`. */
export function parseScriptTrustRecord(raw: string): ScriptTrustRecord {
  if (typeof raw !== "string" || raw.length > MAX_SCRIPT_TRUST_RECORD_CHARS)
    throw new ScriptTrustRecordError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ScriptTrustRecordError();
  }
  return sanitizeScriptTrustRecord(parsed).value;
}

/**
 * The scope under which this run is trusted, or null: ask. Trusted means an
 * entry for the same kind, library and id with the same content digest that
 * is either "everywhere" or bound to exactly `query.connection`. Reading
 * never changes the record, so content that returns to what was trusted is
 * trusted again. With both scopes present the connection is reported.
 */
export function evaluateScriptTrust(
  record: ScriptTrustRecord,
  query: ScriptTrustQuery,
): ScriptTrustScope | null {
  if (!isScriptTrustQuery(query)) return null;
  const subject = scriptTrustSubjectKey(query);
  const bound = query.connection;
  let everywhere = false;
  for (const entry of record.entries) {
    if (
      entry.contentDigest !== query.contentDigest ||
      scriptTrustSubjectKey(entry) !== subject
    )
      continue;
    if (entry.scope === "everywhere") everywhere = true;
    else if (
      bound &&
      entry.connection &&
      entry.connection.databaseId === bound.databaseId &&
      entry.connection.connectionId === bound.connectionId &&
      entry.connection.endpointDigest === bound.endpointDigest
    )
      return "connection";
  }
  return everywhere ? "everywhere" : null;
}
