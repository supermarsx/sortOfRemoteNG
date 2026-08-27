/**
 * Native-backed TOFU trust store.
 *
 * Trust decisions and mutations always go through the durable Rust service.
 * The in-memory cache exists only for synchronous display consumers and stays
 * unavailable until native hydration succeeds. Legacy localStorage records
 * are migration input only and are never consulted for a trust decision.
 */

import { invoke } from "@tauri-apps/api/core";
import { onCurrentDatabaseChange } from "../connection/databaseManager";

export type TrustPolicy = "tofu" | "always-ask" | "always-trust" | "strict";

export type InheritableTrustPolicy = TrustPolicy | "inherit";

export type TrustRecordType = "https" | "certificate" | "rdp" | "ssh" | "tls";
export type CertificateTrustRecordType = Exclude<TrustRecordType, "ssh">;

export interface CertChainEntry {
  subject: string;
  issuer: string;
  fingerprint: string;
  validFrom: string;
  validTo: string;
}

export interface CertIdentity {
  fingerprint: string;
  subject?: string;
  issuer?: string;
  firstSeen: string;
  lastSeen: string;
  validFrom?: string;
  validTo?: string;
  pem?: string;
  serial?: string;
  signatureAlgorithm?: string;
  san?: string[];
  subjectCn?: string;
  subjectOrg?: string;
  subjectOu?: string;
  subjectCountry?: string;
  subjectState?: string;
  subjectLocality?: string;
  subjectEmail?: string;
  issuerCn?: string;
  issuerOrg?: string;
  issuerCountry?: string;
  keyAlgorithm?: string;
  keySize?: number;
  version?: number;
  chain?: CertChainEntry[];
}

export interface SshHostKeyIdentity {
  fingerprint: string;
  keyType?: string;
  keyBits?: number;
  firstSeen: string;
  lastSeen: string;
  publicKey?: string;
}

export type TrustIdentity = CertIdentity | SshHostKeyIdentity;
export type TrustIdentityFor<T extends TrustRecordType> = T extends "ssh"
  ? SshHostKeyIdentity
  : CertIdentity;

export interface TrustRecord {
  /** Display form, including the port. IPv6 hosts are bracketed. */
  host: string;
  /** Structured endpoint fields supplied by the native adapter. */
  hostname?: string;
  port?: number;
  type: TrustRecordType;
  identity: TrustIdentity;
  userApproved: boolean;
  nickname?: string;
  history?: TrustIdentity[];
  revoked?: boolean;
  hostPolicy?: TrustPolicy;
  trustExpires?: string;
}

export type TrustVerifyResult =
  | { status: "trusted" }
  | { status: "first-use"; identity: TrustIdentity }
  | {
      status: "mismatch";
      stored: TrustIdentity;
      received: TrustIdentity;
    }
  | { status: "expired"; identity: CertIdentity };

export interface ConnectionTrustGroup {
  connectionId: string;
  records: TrustRecord[];
}

// ─────────────────────── database scope (t62 / D1, D6) ───────────────────────

/**
 * The full native policy vocabulary. Wider than {@link TrustPolicy}, which is
 * the subset the frontend renders and can set; a store written by the Rust
 * verifiers may legitimately carry any of these, and an export document must
 * round-trip them unchanged rather than silently collapsing them.
 */
export type NativeTrustPolicy =
  | "tofu"
  | "tofu-with-expiry"
  | "always-ask"
  | "always-trust"
  | "strict"
  | "certificate-pinning"
  | "key-rotation-grace"
  | "trust-on-verify"
  | "conditional-trust"
  | "ca-trust-only"
  | "threshold-trust";

/**
 * Policy knobs as they appear on the wire. Note the snake_case keys: unlike
 * the export document itself, the Rust `TrustPolicyConfig` carries no
 * `rename_all`, so these fields are *not* camelCased.
 */
export interface NativeTrustPolicyConfig {
  expiry_days?: number | null;
  rotation_grace_hours?: number | null;
  threshold_count?: number | null;
  allowed_networks?: string[];
  trusted_ca_fingerprints?: string[];
}

/**
 * One record inside a trust export document, in the native wire shape.
 *
 * This is deliberately the *native* record and not the camelCased
 * {@link TrustRecord} the UI consumes: an export is opaque pass-through
 * between `trust_export_database` and `trust_import_database`, and lossily
 * projecting it through the display type would drop `stats`, `tags`,
 * `first_trusted` and per-host policy config.
 */
export interface TrustExportRecord {
  host: string;
  record_type: string;
  identity: Record<string, unknown>;
  user_approved: boolean;
  nickname?: string | null;
  history?: unknown[];
  host_policy?: NativeTrustPolicy | null;
  host_policy_config?: NativeTrustPolicyConfig | null;
  stats?: Record<string, unknown>;
  first_trusted?: string | null;
  trust_expires?: string | null;
  revoked?: boolean;
  tags?: string[];
}

/**
 * Portable trust export for one database (t62 / D6). Contains public key
 * material only — fingerprints and PEM — so it carries no secrets and is not
 * subject to `redactConnectionSecrets`.
 */
export interface TrustExportDocument {
  version: number;
  records: TrustExportRecord[];
  policy?: NativeTrustPolicy;
  policyConfig?: NativeTrustPolicyConfig;
}

/**
 * `merge` keeps an existing record for the same `type:host` unless the
 * imported one was seen more recently, and never lets an unrevoked import
 * overwrite a revoked record. `replace` takes the document verbatim.
 */
export type TrustImportMode = "merge" | "replace";

export interface TrustImportOutcome {
  imported: number;
  skipped: number;
}

/** Which database the Trust Center is currently reading and writing. */
export interface TrustStoreScope {
  /** `null` = no database is active; trust operations fail closed. */
  databaseId: string | null;
  /** The trust file is written as a P4 envelope rather than plaintext SDBF. */
  encrypted: boolean;
  recordCount: number;
  /** Records copied in from the legacy sidecars during the last activation. */
  seededRecords: number;
  /**
   * `false` until the scope has been established — either by an explicit
   * database transition or by a successful `trust_get_active_database`. While
   * unresolved the store keeps its pre-t62 behaviour and hydrates optimistically,
   * so a host without the native command (tests, browser dev server) is not
   * locked out of the Trust Center.
   */
  resolved: boolean;
}

/**
 * Thrown by {@link ensureTrustStoreReady} (and therefore by every trust
 * decision) when no database is open. Typed so callers can tell "you need to
 * open a database" apart from "the Trust Center is broken" and prompt
 * accordingly.
 */
export class NoActiveDatabaseError extends Error {
  readonly name = "NoActiveDatabaseError";

  constructor(
    message = "No database is open. Trust decisions are stored per database — open one to continue.",
  ) {
    super(message);
  }
}

interface NativeActiveTrustDatabase {
  databaseId?: string | null;
  encrypted?: boolean;
  recordCount?: number;
  seededRecords?: number;
}

interface NativeCertChainEntry {
  subject: string;
  issuer: string;
  fingerprint: string;
  valid_from: string;
  valid_to: string;
}

interface NativeIdentity {
  kind: "tls" | "ssh";
  fingerprint: string;
  first_seen: string;
  last_seen: string;
  subject?: string | null;
  issuer?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  pem?: string | null;
  serial?: string | null;
  signature_algorithm?: string | null;
  san?: string[] | null;
  subject_cn?: string | null;
  subject_org?: string | null;
  subject_ou?: string | null;
  subject_country?: string | null;
  subject_state?: string | null;
  subject_locality?: string | null;
  subject_email?: string | null;
  issuer_cn?: string | null;
  issuer_org?: string | null;
  issuer_country?: string | null;
  key_algorithm?: string | null;
  key_size?: number | null;
  version?: number | null;
  chain?: NativeCertChainEntry[] | null;
  chain_fingerprints?: string[];
  key_type?: string | null;
  key_bits?: number | null;
  public_key?: string | null;
  algorithms_offered?: string[];
}

interface NativeHistoryEntry {
  identity: NativeIdentity;
  changed_at: string;
  reason: string;
  approved_by?: string | null;
  note?: string | null;
  verification_count: number;
  trust_score: number;
}

interface NativeTrustRecord {
  host: string;
  record_type: string;
  identity: NativeIdentity;
  user_approved: boolean;
  nickname?: string | null;
  history: NativeHistoryEntry[];
  host_policy?: string | null;
  trust_expires?: string | null;
  revoked?: boolean;
}

interface NativeTrustVerifyResult {
  status: string;
  identity?: NativeIdentity;
  stored?: NativeIdentity;
  presented?: NativeIdentity;
}

interface CachedTrustRecord {
  nativeHost: string;
  connectionId?: string;
  record: TrustRecord;
}

const LEGACY_GLOBAL_KEY = "trustStore";
const LEGACY_CONNECTION_PREFIX = "trustStore:";
const NATIVE_CONNECTION_PREFIX = "@sorng/connection/v1/";
const MAX_LEGACY_STORE_BYTES = 8 * 1024 * 1024;
const MAX_LEGACY_RECORDS = 2_000;
const MAX_TOTAL_LEGACY_MIGRATIONS = 5_000;
const MAX_LEGACY_HISTORY = 256;
const MAX_CONNECTION_STORES = 500;
const MAX_HOST_LENGTH = 253;
const MAX_NATIVE_HOST_LENGTH = 8_192;
const MAX_FINGERPRINT_LENGTH = 512;
const MAX_NICKNAME_LENGTH = 512;
const MAX_PEM_BYTES = 1536 * 1024;
const MAX_PUBLIC_KEY_BYTES = 64 * 1024;
const MAX_IDENTITY_FIELD_BYTES = 4_096;
const MAX_SAN_ENTRIES = 256;
const MAX_CHAIN_ENTRIES = 32;
const MAX_PENDING_MUTATIONS = 128;
const MAX_HYDRATION_RETRY_DELAY_MS = 30_000;
const NATIVE_INVOKE_DEADLINE_MS = 20_000;
const MAX_NATIVE_IN_FLIGHT = 32;
const VALID_RECORD_TYPES = new Set<TrustRecordType>([
  "https",
  "certificate",
  "rdp",
  "ssh",
  "tls",
]);
const VALID_TRUST_POLICIES = new Set<TrustPolicy>([
  "tofu",
  "always-ask",
  "always-trust",
  "strict",
]);

let globalCache = new Map<string, CachedTrustRecord>();
let connectionCache = new Map<string, Map<string, CachedTrustRecord>>();
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let mutationTail: Promise<unknown> = Promise.resolve();
let pendingMutations = 0;
let hydrationFailureCount = 0;
let nextHydrationAttemptAt = 0;
let hydrationState: "idle" | "loading" | "ready" | "error" = "idle";
let nextNativeOperationId = 1;

const UNRESOLVED_SCOPE: TrustStoreScope = {
  databaseId: null,
  encrypted: false,
  recordCount: 0,
  seededRecords: 0,
  resolved: false,
};

let activeScope: TrustStoreScope = { ...UNRESOLVED_SCOPE };
let scopeResolution: Promise<TrustStoreScope> | null = null;
/**
 * Bumped on every scope change. Work started under an older generation
 * (an in-flight hydration, a queued mutation refresh) must not install its
 * result: those records belong to the database the user just left.
 */
let scopeGeneration = 0;
/**
 * Barrier for the in-flight `trust_set_active_database`. Every read and every
 * mutation waits on it, so a connection attempted the instant a database
 * opens cannot race ahead of the runtime being re-pointed. Never rejects.
 */
let scopeActivation: Promise<void> = Promise.resolve();

interface NativeTrustOperation {
  timedOut: boolean;
  settled: Promise<void>;
}

const nativeTrustOperations = new Map<number, NativeTrustOperation>();

export interface TrustStoreAvailability {
  state: "idle" | "loading" | "ready" | "error";
  retryCount: number;
  retryAfterMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(
  value: unknown,
  maximumLength = MAX_HOST_LENGTH,
): string | undefined {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boundedNativeString(
  value: unknown,
  maximumLength: number,
  required = false,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    value.includes("\0") ||
    (required && value.length === 0)
  ) {
    if (required || value != null) {
      throw new Error("Malformed bounded native trust identity");
    }
    return undefined;
  }
  return value;
}

function boundedNativeStrings(
  value: unknown,
  maximumEntries: number,
  maximumLength: number,
): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw new Error("Malformed bounded native trust identity list");
  }
  return value.map((entry) => {
    const normalized = boundedNativeString(entry, maximumLength, true);
    if (!normalized)
      throw new Error("Malformed bounded native trust identity list");
    return normalized;
  });
}

function boundedNativeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error("Invalid bounded trust identity number");
  }
  return value;
}

class NativeTrustDeadlineError extends Error {}

function allocateNativeOperationId(): number {
  for (let attempts = 0; attempts <= MAX_NATIVE_IN_FLIGHT; attempts += 1) {
    const operationId = nextNativeOperationId;
    nextNativeOperationId =
      nextNativeOperationId >= Number.MAX_SAFE_INTEGER
        ? 1
        : nextNativeOperationId + 1;
    if (!nativeTrustOperations.has(operationId)) return operationId;
  }
  throw new NativeTrustDeadlineError(
    "The native Trust Center operation limit is exhausted",
  );
}

async function invokeTrustNative<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (
    Array.from(nativeTrustOperations.values()).some(
      (operation) => operation.timedOut,
    )
  ) {
    throw new NativeTrustDeadlineError(
      "A timed-out native Trust Center operation is still completing",
    );
  }
  if (nativeTrustOperations.size >= MAX_NATIVE_IN_FLIGHT) {
    throw new NativeTrustDeadlineError(
      "Too many native Trust Center operations are in flight",
    );
  }

  const operationId = allocateNativeOperationId();
  const nativeWork = invoke<T>(command, args);
  const operation: NativeTrustOperation = {
    timedOut: false,
    settled: Promise.resolve(),
  };
  operation.settled = nativeWork.then(
    () => undefined,
    () => undefined,
  );
  nativeTrustOperations.set(operationId, operation);
  void operation.settled.finally(() => {
    nativeTrustOperations.delete(operationId);
  });

  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () =>
        reject(
          new NativeTrustDeadlineError(
            "The native Trust Center operation exceeded its UI deadline",
          ),
        ),
      NATIVE_INVOKE_DEADLINE_MS,
    );
  });

  try {
    return await Promise.race([nativeWork, timeout]);
  } catch (error) {
    if (error instanceof NativeTrustDeadlineError) {
      // Tauri invoke cannot be cancelled. Keep the original Promise tracked and
      // reject all retries without spawning new native work until every timed
      // out operation settles.
      operation.timedOut = true;
    }
    throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}

function boundedNativeChain(value: unknown): CertChainEntry[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CHAIN_ENTRIES) {
    throw new Error("Malformed bounded native certificate chain");
  }
  return value.map((entry) => {
    if (!isObject(entry)) {
      throw new Error("Malformed bounded native certificate chain");
    }
    return {
      subject: boundedNativeString(
        entry.subject,
        MAX_IDENTITY_FIELD_BYTES,
        true,
      )!,
      issuer: boundedNativeString(
        entry.issuer,
        MAX_IDENTITY_FIELD_BYTES,
        true,
      )!,
      fingerprint: boundedNativeString(
        entry.fingerprint,
        MAX_FINGERPRINT_LENGTH,
        true,
      )!,
      validFrom: boundedNativeString(entry.valid_from, 128, true)!,
      validTo: boundedNativeString(entry.valid_to, 128, true)!,
    };
  });
}

function normalizeHost(host: string): string {
  const normalized = host.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_HOST_LENGTH ||
    normalized.includes("\0")
  ) {
    throw new Error("Invalid trust-store host");
  }
  return normalized;
}

function normalizePort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid trust-store port");
  }
  return port;
}

function normalizeConnectionId(connectionId?: string): string | undefined {
  if (connectionId === undefined) return undefined;
  const normalized = connectionId.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_HOST_LENGTH ||
    normalized.includes("\0")
  ) {
    throw new Error("Invalid trust-store connection ID");
  }
  return normalized;
}

function formatHostPort(host: string, port: number): string {
  const normalizedHost = normalizeHost(host);
  const normalizedPort = normalizePort(port);
  const displayHost =
    normalizedHost.includes(":") &&
    !(normalizedHost.startsWith("[") && normalizedHost.endsWith("]"))
      ? `[${normalizedHost}]`
      : normalizedHost;
  return `${displayHost}:${normalizedPort}`;
}

function parseHostPort(value: string): { host: string; port: number } | null {
  if (value.length === 0 || value.length > MAX_HOST_LENGTH + 8) return null;

  if (value.startsWith("[")) {
    const closingBracket = value.lastIndexOf("]:");
    if (closingBracket <= 1) return null;
    const host = value.slice(1, closingBracket);
    const port = Number(value.slice(closingBracket + 2));
    try {
      return { host: normalizeHost(host), port: normalizePort(port) };
    } catch {
      return null;
    }
  }

  const separator = value.lastIndexOf(":");
  if (separator <= 0) return null;
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  try {
    return { host: normalizeHost(host), port: normalizePort(port) };
  } catch {
    return null;
  }
}

export function parseTrustRecordAddress(record: TrustRecord): {
  host: string;
  port: number;
} {
  if (record.hostname !== undefined && record.port !== undefined) {
    return {
      host: normalizeHost(record.hostname),
      port: normalizePort(record.port),
    };
  }
  const parsed = parseHostPort(record.host);
  if (!parsed) throw new Error("Trust record has an invalid endpoint");
  return parsed;
}

function encodeNativeHost(
  host: string,
  port: number,
  connectionId?: string,
): string {
  const normalizedHost = normalizeHost(host);
  const normalizedPort = normalizePort(port);
  const normalizedConnectionId = normalizeConnectionId(connectionId);
  if (!normalizedConnectionId)
    return formatHostPort(normalizedHost, normalizedPort);
  return `${NATIVE_CONNECTION_PREFIX}${encodeURIComponent(
    normalizedConnectionId,
  )}/${encodeURIComponent(normalizedHost)}/${normalizedPort}`;
}

function decodeNativeHost(nativeHost: string): {
  host: string;
  port: number;
  connectionId?: string;
} | null {
  if (!nativeHost.startsWith(NATIVE_CONNECTION_PREFIX)) {
    return parseHostPort(nativeHost);
  }

  const parts = nativeHost.slice(NATIVE_CONNECTION_PREFIX.length).split("/");
  if (parts.length !== 3) return null;
  try {
    const connectionId = normalizeConnectionId(decodeURIComponent(parts[0]));
    const host = normalizeHost(decodeURIComponent(parts[1]));
    const port = normalizePort(Number(parts[2]));
    if (!connectionId) return null;
    return { connectionId, host, port };
  } catch {
    return null;
  }
}

function recordCacheKey(
  host: string,
  port: number,
  type: TrustRecordType,
): string {
  return `${type}\0${normalizeHost(host).toLocaleLowerCase()}\0${normalizePort(port)}`;
}

function cloneIdentity<T extends TrustIdentity>(identity: T): T {
  const clone = { ...identity } as T & {
    san?: string[];
    chain?: CertChainEntry[];
  };
  if ("san" in identity && identity.san) clone.san = [...identity.san];
  if ("chain" in identity && identity.chain) {
    clone.chain = identity.chain.map((entry) => ({ ...entry }));
  }
  return clone as T;
}

function cloneRecord(record: TrustRecord): TrustRecord {
  return {
    ...record,
    identity: cloneIdentity(record.identity),
    history: record.history?.map((identity) => cloneIdentity(identity)),
  };
}

function fromNativeIdentity(identity: NativeIdentity): TrustIdentity {
  if (!isObject(identity)) throw new Error("Malformed native trust identity");
  if (
    (identity.kind !== "tls" && identity.kind !== "ssh") ||
    !boundedNativeString(identity.fingerprint, MAX_FINGERPRINT_LENGTH, true) ||
    !boundedNativeString(identity.first_seen, 128, true) ||
    !boundedNativeString(identity.last_seen, 128, true)
  ) {
    throw new Error("Malformed native trust identity");
  }

  if (identity.kind === "ssh") {
    return {
      fingerprint: identity.fingerprint,
      keyType: boundedNativeString(identity.key_type, 128),
      keyBits: boundedNativeInteger(identity.key_bits, 1, 1_048_576),
      firstSeen: identity.first_seen,
      lastSeen: identity.last_seen,
      publicKey: boundedNativeString(identity.public_key, MAX_PUBLIC_KEY_BYTES),
    };
  }

  return {
    fingerprint: identity.fingerprint,
    subject: boundedNativeString(identity.subject, MAX_IDENTITY_FIELD_BYTES),
    issuer: boundedNativeString(identity.issuer, MAX_IDENTITY_FIELD_BYTES),
    firstSeen: identity.first_seen,
    lastSeen: identity.last_seen,
    validFrom: identity.valid_from ?? undefined,
    validTo: identity.valid_to ?? undefined,
    pem: boundedNativeString(identity.pem, MAX_PEM_BYTES),
    serial: boundedNativeString(identity.serial, 512),
    signatureAlgorithm: boundedNativeString(identity.signature_algorithm, 256),
    san: boundedNativeStrings(
      identity.san,
      MAX_SAN_ENTRIES,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectCn: boundedNativeString(
      identity.subject_cn,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectOrg: boundedNativeString(
      identity.subject_org,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectOu: boundedNativeString(
      identity.subject_ou,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectCountry: boundedNativeString(identity.subject_country, 128),
    subjectState: boundedNativeString(
      identity.subject_state,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectLocality: boundedNativeString(
      identity.subject_locality,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subjectEmail: boundedNativeString(
      identity.subject_email,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    issuerCn: boundedNativeString(identity.issuer_cn, MAX_IDENTITY_FIELD_BYTES),
    issuerOrg: boundedNativeString(
      identity.issuer_org,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    issuerCountry: boundedNativeString(identity.issuer_country, 128),
    keyAlgorithm: boundedNativeString(identity.key_algorithm, 256),
    keySize: boundedNativeInteger(identity.key_size, 1, 1_048_576),
    version: boundedNativeInteger(identity.version, 0, 4),
    chain: boundedNativeChain(identity.chain),
  };
}

function toNativeIdentity(
  type: TrustRecordType,
  identity: TrustIdentity,
): NativeIdentity {
  if (
    typeof identity.fingerprint !== "string" ||
    identity.fingerprint.length === 0 ||
    identity.fingerprint.length > MAX_FINGERPRINT_LENGTH
  ) {
    throw new Error("Invalid trust identity fingerprint");
  }
  const now = new Date().toISOString();
  const firstSeen = identity.firstSeen || now;
  const lastSeen = identity.lastSeen || now;
  if (
    firstSeen.length > 128 ||
    lastSeen.length > 128 ||
    firstSeen.includes("\0") ||
    lastSeen.includes("\0")
  ) {
    throw new Error("Invalid trust identity timestamps");
  }

  if (type === "ssh") {
    const ssh = identity as SshHostKeyIdentity;
    return {
      kind: "ssh",
      fingerprint: ssh.fingerprint,
      key_type: boundedNativeString(ssh.keyType, 128),
      key_bits: boundedNativeInteger(ssh.keyBits, 1, 1_048_576),
      first_seen: firstSeen,
      last_seen: lastSeen,
      public_key: boundedNativeString(ssh.publicKey, MAX_PUBLIC_KEY_BYTES),
      algorithms_offered: [],
    };
  }

  const cert = identity as CertIdentity;
  if (cert.chain && cert.chain.length > MAX_CHAIN_ENTRIES) {
    throw new Error("Certificate chain exceeds the Trust Center safety limit");
  }
  const chain = cert.chain?.map((entry) => ({
    subject: boundedNativeString(
      entry.subject,
      MAX_IDENTITY_FIELD_BYTES,
      true,
    )!,
    issuer: boundedNativeString(entry.issuer, MAX_IDENTITY_FIELD_BYTES, true)!,
    fingerprint: boundedNativeString(
      entry.fingerprint,
      MAX_FINGERPRINT_LENGTH,
      true,
    )!,
    valid_from: boundedNativeString(entry.validFrom, 128, true)!,
    valid_to: boundedNativeString(entry.validTo, 128, true)!,
  }));
  return {
    kind: "tls",
    fingerprint: cert.fingerprint,
    subject: boundedNativeString(cert.subject, MAX_IDENTITY_FIELD_BYTES),
    issuer: boundedNativeString(cert.issuer, MAX_IDENTITY_FIELD_BYTES),
    first_seen: firstSeen,
    last_seen: lastSeen,
    valid_from: cert.validFrom,
    valid_to: cert.validTo,
    pem: boundedNativeString(cert.pem, MAX_PEM_BYTES),
    serial: boundedNativeString(cert.serial, 512),
    signature_algorithm: boundedNativeString(cert.signatureAlgorithm, 256),
    san: boundedNativeStrings(
      cert.san,
      MAX_SAN_ENTRIES,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subject_cn: boundedNativeString(cert.subjectCn, MAX_IDENTITY_FIELD_BYTES),
    subject_org: boundedNativeString(cert.subjectOrg, MAX_IDENTITY_FIELD_BYTES),
    subject_ou: boundedNativeString(cert.subjectOu, MAX_IDENTITY_FIELD_BYTES),
    subject_country: boundedNativeString(cert.subjectCountry, 128),
    subject_state: boundedNativeString(
      cert.subjectState,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subject_locality: boundedNativeString(
      cert.subjectLocality,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    subject_email: boundedNativeString(
      cert.subjectEmail,
      MAX_IDENTITY_FIELD_BYTES,
    ),
    issuer_cn: boundedNativeString(cert.issuerCn, MAX_IDENTITY_FIELD_BYTES),
    issuer_org: boundedNativeString(cert.issuerOrg, MAX_IDENTITY_FIELD_BYTES),
    issuer_country: boundedNativeString(cert.issuerCountry, 128),
    key_algorithm: boundedNativeString(cert.keyAlgorithm, 256),
    key_size: boundedNativeInteger(cert.keySize, 1, 1_048_576),
    version: boundedNativeInteger(cert.version, 0, 4),
    chain,
    chain_fingerprints: chain?.map((entry) => entry.fingerprint) ?? [],
  };
}

function mapNativeRecord(nativeRecord: NativeTrustRecord): CachedTrustRecord {
  if (
    !isObject(nativeRecord) ||
    typeof nativeRecord.host !== "string" ||
    nativeRecord.host.length > MAX_NATIVE_HOST_LENGTH ||
    nativeRecord.host.includes("\0") ||
    typeof nativeRecord.record_type !== "string" ||
    !VALID_RECORD_TYPES.has(nativeRecord.record_type as TrustRecordType) ||
    typeof nativeRecord.user_approved !== "boolean" ||
    !Array.isArray(nativeRecord.history) ||
    nativeRecord.history.length > MAX_LEGACY_HISTORY
  ) {
    throw new Error("Malformed native trust record");
  }

  const type = nativeRecord.record_type as TrustRecordType;
  if (
    (type === "ssh" && nativeRecord.identity.kind !== "ssh") ||
    (type !== "ssh" && nativeRecord.identity.kind !== "tls")
  ) {
    throw new Error("Native trust record identity type mismatch");
  }

  const endpoint = decodeNativeHost(nativeRecord.host);
  if (!endpoint) throw new Error("Malformed native trust record endpoint");
  const history = nativeRecord.history.map((entry) => {
    if (!isObject(entry) || !isObject(entry.identity)) {
      throw new Error("Malformed native trust history");
    }
    return fromNativeIdentity(entry.identity);
  });

  return {
    nativeHost: nativeRecord.host,
    connectionId: endpoint.connectionId,
    record: {
      host: formatHostPort(endpoint.host, endpoint.port),
      hostname: endpoint.host,
      port: endpoint.port,
      type,
      identity: fromNativeIdentity(nativeRecord.identity),
      userApproved: nativeRecord.user_approved,
      nickname: boundedNativeString(nativeRecord.nickname, MAX_NICKNAME_LENGTH),
      history: history.length > 0 ? history : undefined,
      revoked: nativeRecord.revoked === true,
      hostPolicy: VALID_TRUST_POLICIES.has(
        nativeRecord.host_policy as TrustPolicy,
      )
        ? (nativeRecord.host_policy as TrustPolicy)
        : undefined,
      trustExpires: boundedNativeString(nativeRecord.trust_expires, 128),
    },
  };
}

function installNativeRecords(records: NativeTrustRecord[]): void {
  if (!Array.isArray(records) || records.length > MAX_LEGACY_RECORDS) {
    throw new Error("Malformed native trust-store response");
  }

  const nextGlobal = new Map<string, CachedTrustRecord>();
  const nextConnections = new Map<string, Map<string, CachedTrustRecord>>();
  for (const nativeRecord of records) {
    const cached = mapNativeRecord(nativeRecord);
    const address = parseTrustRecordAddress(cached.record);
    const key = recordCacheKey(address.host, address.port, cached.record.type);
    if (cached.connectionId) {
      let scoped = nextConnections.get(cached.connectionId);
      if (!scoped) {
        scoped = new Map();
        nextConnections.set(cached.connectionId, scoped);
      }
      if (scoped.has(key)) throw new Error("Duplicate native trust record");
      scoped.set(key, cached);
    } else {
      if (nextGlobal.has(key)) throw new Error("Duplicate native trust record");
      nextGlobal.set(key, cached);
    }
  }

  globalCache = nextGlobal;
  connectionCache = nextConnections;
}

function clearCache(): void {
  hydrated = false;
  globalCache = new Map();
  connectionCache = new Map();
}

function cachedRecord(
  host: string,
  port: number,
  type: TrustRecordType,
  connectionId?: string,
): CachedTrustRecord | undefined {
  const key = recordCacheKey(host, port, type);
  const normalizedConnectionId = normalizeConnectionId(connectionId);
  return normalizedConnectionId
    ? connectionCache.get(normalizedConnectionId)?.get(key)
    : globalCache.get(key);
}

function notifyTrustStoreChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("trustStoreChanged"));
  }
}

async function refreshNativeCache(notify = true): Promise<void> {
  const generation = scopeGeneration;
  try {
    const records = await invokeTrustNative<NativeTrustRecord[]>(
      "trust_get_all_records",
    );
    // The active database changed while this read was in flight. Installing
    // now would show database A's records under database B.
    if (generation !== scopeGeneration) return;
    installNativeRecords(records);
    // Live count of what this scope actually holds — fresher than the count
    // `trust_get_active_database` reported at activation time.
    activeScope = { ...activeScope, recordCount: records.length };
    hydrated = true;
    if (notify) notifyTrustStoreChanged();
  } catch (error) {
    // A stale failure must not wipe the cache the new scope just filled.
    if (generation !== scopeGeneration) return;
    clearCache();
    throw error;
  }
}

function markTrustStoreUnavailable(): Error {
  clearCache();
  hydrationState = "error";
  hydrationFailureCount = Math.min(hydrationFailureCount + 1, 16);
  const delay = Math.min(
    MAX_HYDRATION_RETRY_DELAY_MS,
    1_000 * 2 ** Math.min(hydrationFailureCount - 1, 5),
  );
  nextHydrationAttemptAt = Date.now() + delay;
  notifyTrustStoreChanged();
  return new Error(
    "The native Trust Center is unavailable. Trust decisions remain blocked until it recovers.",
  );
}

function legacyIdentity(
  value: unknown,
  type: TrustRecordType,
): TrustIdentity | null {
  if (!isObject(value)) return null;
  const fingerprint = asOptionalString(
    value.fingerprint,
    MAX_FINGERPRINT_LENGTH,
  );
  if (!fingerprint) return null;
  const now = new Date().toISOString();
  const firstSeen = asOptionalString(value.firstSeen, 128) ?? now;
  const lastSeen = asOptionalString(value.lastSeen, 128) ?? firstSeen;

  if (type === "ssh") {
    return {
      fingerprint,
      firstSeen,
      lastSeen,
      keyType: asOptionalString(value.keyType, 128),
      keyBits: asOptionalNumber(value.keyBits),
      publicKey: asOptionalString(value.publicKey, 1024 * 1024),
    };
  }

  const san = Array.isArray(value.san)
    ? value.san
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length <= MAX_HOST_LENGTH,
        )
        .slice(0, 1_000)
    : undefined;
  const chain = Array.isArray(value.chain)
    ? value.chain
        .filter(isObject)
        .slice(0, 64)
        .map((entry) => ({
          subject: asOptionalString(entry.subject) ?? "",
          issuer: asOptionalString(entry.issuer) ?? "",
          fingerprint:
            asOptionalString(entry.fingerprint, MAX_FINGERPRINT_LENGTH) ?? "",
          validFrom: asOptionalString(entry.validFrom, 128) ?? "",
          validTo: asOptionalString(entry.validTo, 128) ?? "",
        }))
        .filter((entry) => entry.fingerprint.length > 0)
    : undefined;

  return {
    fingerprint,
    firstSeen,
    lastSeen,
    subject: asOptionalString(value.subject),
    issuer: asOptionalString(value.issuer),
    validFrom: asOptionalString(value.validFrom, 128),
    validTo: asOptionalString(value.validTo, 128),
    pem: asOptionalString(value.pem, 2 * 1024 * 1024),
    serial: asOptionalString(value.serial, 512),
    signatureAlgorithm: asOptionalString(value.signatureAlgorithm, 256),
    san,
    subjectCn: asOptionalString(value.subjectCn),
    subjectOrg: asOptionalString(value.subjectOrg),
    subjectOu: asOptionalString(value.subjectOu),
    subjectCountry: asOptionalString(value.subjectCountry, 128),
    subjectState: asOptionalString(value.subjectState),
    subjectLocality: asOptionalString(value.subjectLocality),
    subjectEmail: asOptionalString(value.subjectEmail),
    issuerCn: asOptionalString(value.issuerCn),
    issuerOrg: asOptionalString(value.issuerOrg),
    issuerCountry: asOptionalString(value.issuerCountry, 128),
    keyAlgorithm: asOptionalString(value.keyAlgorithm, 256),
    keySize: asOptionalNumber(value.keySize),
    version: asOptionalNumber(value.version),
    chain,
  };
}

function legacyRecord(value: unknown): {
  host: string;
  port: number;
  record: TrustRecord;
} | null {
  if (!isObject(value)) return null;
  if (
    typeof value.type !== "string" ||
    !VALID_RECORD_TYPES.has(value.type as TrustRecordType) ||
    typeof value.host !== "string" ||
    typeof value.userApproved !== "boolean"
  ) {
    return null;
  }
  const type = value.type as TrustRecordType;
  const endpoint = parseHostPort(value.host);
  const identity = legacyIdentity(value.identity, type);
  if (!endpoint || !identity) return null;
  const historyValues = Array.isArray(value.history)
    ? value.history.slice(0, MAX_LEGACY_HISTORY)
    : [];
  const history: TrustIdentity[] = [];
  for (const entry of historyValues) {
    const parsed = legacyIdentity(entry, type);
    if (!parsed) return null;
    history.push(parsed);
  }
  return {
    ...endpoint,
    record: {
      host: formatHostPort(endpoint.host, endpoint.port),
      hostname: endpoint.host,
      port: endpoint.port,
      type,
      identity,
      userApproved: value.userApproved,
      nickname: asOptionalString(value.nickname, MAX_NICKNAME_LENGTH),
      history: history.length > 0 ? history : undefined,
    },
  };
}

async function migrateLegacyLocalStorage(): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage) return;

  const keys: string[] = [];
  try {
    for (
      let index = 0;
      index < window.localStorage.length &&
      keys.length < MAX_CONNECTION_STORES + 1;
      index += 1
    ) {
      const key = window.localStorage.key(index);
      if (
        key === LEGACY_GLOBAL_KEY ||
        (key?.startsWith(LEGACY_CONNECTION_PREFIX) &&
          key.length > LEGACY_CONNECTION_PREFIX.length)
      ) {
        keys.push(key);
      }
    }
  } catch {
    return;
  }

  let migratedRecords = 0;
  for (const storageKey of keys) {
    const connectionId =
      storageKey === LEGACY_GLOBAL_KEY
        ? undefined
        : storageKey.slice(LEGACY_CONNECTION_PREFIX.length);
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      continue;
    }
    if (!raw || raw.length > MAX_LEGACY_STORE_BYTES) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isObject(parsed)) continue;
    const values = Object.values(parsed);
    if (values.length > MAX_LEGACY_RECORDS) continue;
    if (migratedRecords + values.length > MAX_TOTAL_LEGACY_MIGRATIONS) break;
    const records = values.map(legacyRecord);
    if (records.some((record) => record === null)) continue;

    let complete = true;
    for (const parsedRecord of records) {
      if (!parsedRecord) {
        complete = false;
        break;
      }
      const { host, port, record } = parsedRecord;
      if (cachedRecord(host, port, record.type, connectionId)) continue;
      try {
        const nativeHost = encodeNativeHost(host, port, connectionId);
        const nativeIdentity = toNativeIdentity(record.type, record.identity);
        await invokeTrustNative<void>("trust_store_identity_with_reason", {
          host: nativeHost,
          recordType: record.type,
          identity: nativeIdentity,
          userApproved: record.userApproved,
          reason: "migrated",
          approvedBy: "legacy-local-storage-migration",
          note: "Migrated from the legacy frontend trust store",
          migrationHistory:
            record.history?.map((identity) =>
              toNativeIdentity(record.type, identity),
            ) ?? [],
          nickname: record.nickname ?? null,
        });
        const nativeRecord: NativeTrustRecord = {
          host: nativeHost,
          record_type: record.type,
          identity: nativeIdentity,
          user_approved: record.userApproved,
          nickname: record.nickname,
          history:
            record.history?.map((identity) => ({
              identity: toNativeIdentity(record.type, identity),
              changed_at: new Date().toISOString(),
              reason: "migrated",
              approved_by: "legacy-local-storage-migration",
              note: null,
              verification_count: 0,
              trust_score: 0,
            })) ?? [],
        };
        const cached = mapNativeRecord(nativeRecord);
        const key = recordCacheKey(host, port, record.type);
        if (connectionId) {
          let scoped = connectionCache.get(connectionId);
          if (!scoped) {
            scoped = new Map();
            connectionCache.set(connectionId, scoped);
          }
          scoped.set(key, cached);
        } else {
          globalCache.set(key, cached);
        }
        migratedRecords += 1;
      } catch {
        complete = false;
        break;
      }
    }

    if (complete) {
      try {
        if (window.localStorage.getItem(storageKey) === raw) {
          window.localStorage.removeItem(storageKey);
        }
      } catch {
        // The durable native migration succeeded. Leaving a legacy copy is
        // safe because it is never read for trust decisions.
      }
    }
  }
}

async function hydrateTrustStore(): Promise<void> {
  const generation = scopeGeneration;
  await refreshNativeCache(false);
  if (generation !== scopeGeneration) return;
  await migrateLegacyLocalStorage();
  if (generation !== scopeGeneration) return;
  await refreshNativeCache(false);
  if (generation !== scopeGeneration) return;
  hydrated = true;
  hydrationState = "ready";
  hydrationFailureCount = 0;
  nextHydrationAttemptAt = 0;
  notifyTrustStoreChanged();
}

/**
 * Establish which database the Trust Center is pointed at.
 *
 * Deliberately fail-soft: if `trust_get_active_database` is unavailable
 * (older shell, jsdom test, browser dev server) the scope stays *unresolved*
 * and the store behaves exactly as it did before t62. Only a successful
 * answer of `databaseId: null` — or an explicit close / lock transition —
 * marks the scope resolved-and-empty, which is what makes
 * {@link ensureTrustStoreReady} throw {@link NoActiveDatabaseError}. The
 * durable fail-closed guarantee lives in Rust, where a verifier with no
 * active database errors rather than accepting.
 */
async function resolveTrustStoreScope(): Promise<TrustStoreScope> {
  if (activeScope.resolved) return activeScope;
  if (!scopeResolution) {
    const generation = scopeGeneration;
    scopeResolution = invokeTrustNative<NativeActiveTrustDatabase | null>(
      "trust_get_active_database",
    )
      .then((info) => {
        if (generation !== scopeGeneration) return activeScope;
        activeScope = {
          databaseId:
            typeof info?.databaseId === "string" ? info.databaseId : null,
          encrypted: Boolean(info?.encrypted),
          recordCount: asOptionalNumber(info?.recordCount) ?? 0,
          seededRecords: asOptionalNumber(info?.seededRecords) ?? 0,
          resolved: true,
        };
        return activeScope;
      })
      .catch(() => activeScope)
      .finally(() => {
        scopeResolution = null;
      });
  }
  return scopeResolution;
}

/**
 * The Trust Center's current database scope. Synchronous, for display
 * consumers; call {@link refreshTrustStoreScope} to force a native re-read.
 */
export function getTrustStoreScope(): TrustStoreScope {
  return { ...activeScope };
}

/** Re-read the active database from the native runtime. */
export async function refreshTrustStoreScope(): Promise<TrustStoreScope> {
  activeScope = { ...activeScope, resolved: false };
  return resolveTrustStoreScope();
}

/**
 * Move the cache to a new database scope.
 *
 * Everything hydrated for the previous database is dropped rather than
 * filtered: per-connection records key on connection ids that only exist in
 * one database, and a stale global record would read as "already trusted" in
 * a database that never trusted it. Bumping the generation also disowns any
 * hydration or mutation refresh still in flight for the old scope.
 */
function adoptTrustStoreScope(
  databaseId: string | null,
  activation: Promise<void>,
): void {
  scopeGeneration += 1;
  scopeResolution = null;
  scopeActivation = activation.catch(() => undefined);
  // Synchronous, deliberately: a display consumer that reads between the
  // transition and the re-hydration must see nothing, never the previous
  // database's records.
  clearCache();
  hydrationPromise = null;
  hydrationState = "idle";
  hydrationFailureCount = 0;
  nextHydrationAttemptAt = 0;
  activeScope = {
    databaseId,
    encrypted: false,
    recordCount: 0,
    seededRecords: 0,
    resolved: true,
  };
  notifyTrustStoreChanged();
  if (databaseId === null) return;
  void hydrateAdoptedScope(scopeGeneration, activation);
}

/**
 * Re-hydrate after a switch, but only once the native runtime has actually
 * been re-pointed — reading first would either serve the outgoing database's
 * records or fail closed against a runtime that has not been told about the
 * incoming one.
 */
async function hydrateAdoptedScope(
  generation: number,
  activation: Promise<void>,
): Promise<void> {
  try {
    await activation;
  } catch {
    // Activation is best-effort; hydration will surface any real failure.
  }
  if (generation !== scopeGeneration) return;

  try {
    const info = await invokeTrustNative<NativeActiveTrustDatabase | null>(
      "trust_get_active_database",
    );
    if (generation !== scopeGeneration) return;
    if (typeof info?.databaseId === "string") {
      activeScope = {
        ...activeScope,
        databaseId: info.databaseId,
        encrypted: Boolean(info.encrypted),
        seededRecords: asOptionalNumber(info.seededRecords) ?? 0,
      };
      notifyTrustStoreChanged();
    }
  } catch {
    // The scope is already known from the transition itself; the extra
    // detail (encrypted, seeded count) is display-only.
  }
  if (generation !== scopeGeneration) return;
  startHydrationForDisplay();
}

/**
 * Follow the active database (t62 / D1). Registered at module scope on the
 * module-level registry, so it survives `DatabaseManager.resetInstance()`.
 */
onCurrentDatabaseChange((change) => {
  const nextDatabaseId = change.database?.id ?? null;
  // Events about a *different* database (create, unlocking a non-current one)
  // leave the scope where it is.
  if (change.databaseId !== nextDatabaseId) return;
  if (activeScope.resolved && activeScope.databaseId === nextDatabaseId) {
    // Same database. An unlock can make a previously unreadable store
    // readable, so re-hydrate; a redundant open is a no-op.
    if (change.reason !== "unlock") return;
  }
  adoptTrustStoreScope(nextDatabaseId, change.trustActivation);
});

export async function ensureTrustStoreReady(): Promise<void> {
  await scopeActivation;
  const scope = await resolveTrustStoreScope();
  if (scope.resolved && scope.databaseId === null) {
    throw new NoActiveDatabaseError();
  }
  if (hydrated) return;
  if (Date.now() < nextHydrationAttemptAt) {
    throw new Error(
      "The native Trust Center is temporarily unavailable. Retry from the Trust Center.",
    );
  }
  if (!hydrationPromise) {
    hydrationState = "loading";
    notifyTrustStoreChanged();
    hydrationPromise = hydrateTrustStore()
      .catch(() => {
        throw markTrustStoreUnavailable();
      })
      .finally(() => {
        hydrationPromise = null;
      });
  }
  return hydrationPromise;
}

export function getTrustStoreAvailability(): TrustStoreAvailability {
  return {
    state: hydrationState,
    retryCount: hydrationFailureCount,
    retryAfterMs: Math.max(0, nextHydrationAttemptAt - Date.now()),
  };
}

export async function retryTrustStoreHydration(): Promise<void> {
  nextHydrationAttemptAt = 0;
  await ensureTrustStoreReady();
}

function startHydrationForDisplay(): void {
  void ensureTrustStoreReady().catch(() => {
    // Display consumers remain empty. Connection decisions call the async API
    // and receive the failure explicitly.
  });
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (pendingMutations >= MAX_PENDING_MUTATIONS) {
    return Promise.reject(
      new Error("Too many Trust Center operations are already queued"),
    );
  }
  pendingMutations += 1;
  const result = mutationTail.then(operation, operation);
  const tracked = result.finally(() => {
    pendingMutations -= 1;
  });
  mutationTail = tracked.then(
    () => undefined,
    () => undefined,
  );
  return tracked;
}

export async function verifyIdentity<T extends TrustRecordType>(
  host: string,
  port: number,
  type: T,
  received: TrustIdentityFor<T>,
  connectionId?: string,
): Promise<TrustVerifyResult> {
  await ensureTrustStoreReady();
  const existing = cachedRecord(host, port, type, connectionId);
  const nativeHost =
    existing?.nativeHost ?? encodeNativeHost(host, port, connectionId);
  const nativeIdentity = toNativeIdentity(type, received);
  try {
    const result = await invokeTrustNative<NativeTrustVerifyResult>(
      "trust_verify_identity",
      {
        host: nativeHost,
        recordType: type,
        identity: nativeIdentity,
      },
    );
    if (!isObject(result) || typeof result.status !== "string") {
      throw new Error("Malformed native trust verification response");
    }
    switch (result.status) {
      case "trusted": {
        if (
          type !== "ssh" &&
          (received as CertIdentity).validTo &&
          new Date((received as CertIdentity).validTo as string).getTime() <
            Date.now()
        ) {
          return {
            status: "expired",
            identity: received as CertIdentity,
          };
        }
        return { status: "trusted" };
      }
      case "first-use":
        return {
          status: "first-use",
          identity: result.identity
            ? fromNativeIdentity(result.identity)
            : received,
        };
      case "mismatch":
      case "chain-mismatch":
      case "rotation-grace":
        if (!result.stored) {
          throw new Error("Native mismatch response omitted stored identity");
        }
        return {
          status: "mismatch",
          stored: fromNativeIdentity(result.stored),
          received: result.presented
            ? fromNativeIdentity(result.presented)
            : received,
        };
      case "expired":
        if (type === "ssh") {
          throw new Error("Native trust store returned an invalid SSH expiry");
        }
        return {
          status: "expired",
          identity: result.presented
            ? (fromNativeIdentity(result.presented) as CertIdentity)
            : (received as CertIdentity),
        };
      case "revoked":
      case "pending-threshold":
      case "pending-verification":
        throw new Error(
          `Native trust policy rejected identity (${result.status})`,
        );
      default:
        throw new Error("Unknown native trust verification status");
    }
  } catch {
    throw markTrustStoreUnavailable();
  }
}

export function trustIdentity<T extends TrustRecordType>(
  host: string,
  port: number,
  type: T,
  identity: TrustIdentityFor<T>,
  userApproved = true,
  connectionId?: string,
): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const existing = cachedRecord(host, port, type, connectionId);
    const nativeIdentity = toNativeIdentity(type, identity);
    try {
      await invokeTrustNative<void>("trust_store_identity", {
        host:
          existing?.nativeHost ?? encodeNativeHost(host, port, connectionId),
        recordType: type,
        identity: nativeIdentity,
        userApproved,
      });
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function removeIdentity(
  host: string,
  port: number,
  type: TrustRecordType,
  connectionId?: string,
): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const existing = cachedRecord(host, port, type, connectionId);
    if (!existing) return;
    try {
      await invokeTrustNative<void>("trust_remove_identity", {
        host: existing.nativeHost,
        recordType: type,
      });
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function getStoredIdentity(
  host: string,
  port: number,
  type: TrustRecordType,
  connectionId?: string,
): TrustRecord | undefined {
  startHydrationForDisplay();
  if (!hydrated) return undefined;
  const cached = cachedRecord(host, port, type, connectionId);
  return cached ? cloneRecord(cached.record) : undefined;
}

export function getAllTrustRecords(connectionId?: string): TrustRecord[] {
  startHydrationForDisplay();
  if (!hydrated) return [];
  const normalizedConnectionId = normalizeConnectionId(connectionId);
  const values = normalizedConnectionId
    ? connectionCache.get(normalizedConnectionId)?.values()
    : globalCache.values();
  return values ? Array.from(values, (entry) => cloneRecord(entry.record)) : [];
}

export function getAllPerConnectionTrustRecords(): ConnectionTrustGroup[] {
  startHydrationForDisplay();
  if (!hydrated) return [];
  return Array.from(connectionCache.entries(), ([connectionId, records]) => ({
    connectionId,
    records: Array.from(records.values(), (entry) => cloneRecord(entry.record)),
  }));
}

export function clearAllTrustRecords(connectionId?: string): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const targets = normalizedConnectionId
      ? Array.from(connectionCache.get(normalizedConnectionId)?.values() ?? [])
      : Array.from(globalCache.values());
    try {
      for (const target of targets) {
        await invokeTrustNative<void>("trust_remove_identity", {
          host: target.nativeHost,
          recordType: target.record.type,
        });
      }
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function clearEntireTrustStore(): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    try {
      await invokeTrustNative<void>("trust_clear_all");
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function setTrustRecordRevoked(
  record: TrustRecord,
  revoked: boolean,
  connectionId?: string,
): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const address = parseTrustRecordAddress(record);
    const existing = cachedRecord(
      address.host,
      address.port,
      record.type,
      connectionId,
    );
    if (!existing) throw new Error("Trust record not found");
    try {
      await invokeTrustNative<void>(
        revoked ? "trust_revoke_identity" : "trust_reinstate_identity",
        {
          host: existing.nativeHost,
          recordType: record.type,
        },
      );
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function setTrustRecordPolicy(
  record: TrustRecord,
  policy: TrustPolicy | undefined,
  connectionId?: string,
): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const address = parseTrustRecordAddress(record);
    const existing = cachedRecord(
      address.host,
      address.port,
      record.type,
      connectionId,
    );
    if (!existing) throw new Error("Trust record not found");
    try {
      await invokeTrustNative<void>("trust_set_host_policy", {
        host: existing.nativeHost,
        recordType: record.type,
        policy: policy ?? null,
        config: null,
      });
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function updateTrustRecordNickname(
  host: string,
  port: number,
  type: TrustRecordType,
  nickname: string,
  connectionId?: string,
): Promise<void> {
  return serializeMutation(async () => {
    await ensureTrustStoreReady();
    const existing = cachedRecord(host, port, type, connectionId);
    if (!existing) throw new Error("Trust record not found");
    const normalizedNickname = nickname.trim();
    if (normalizedNickname.length > MAX_NICKNAME_LENGTH) {
      throw new Error("Trust record nickname is too long");
    }
    try {
      await invokeTrustNative<void>("trust_update_nickname", {
        host: existing.nativeHost,
        recordType: type,
        nickname: normalizedNickname || null,
      });
      await refreshNativeCache();
    } catch {
      throw markTrustStoreUnavailable();
    }
  });
}

export function isCertificateTrustRecordType(
  type: TrustRecordType,
): type is CertificateTrustRecordType {
  return (
    type === "certificate" ||
    type === "https" ||
    type === "rdp" ||
    type === "tls"
  );
}

export function formatFingerprint(fp: string): string {
  if (fp.includes(":") || fp.startsWith("SHA256:")) return fp;
  return fp.match(/.{1,2}/g)?.join(":") ?? fp;
}

function isConcreteTrustPolicy(
  policy: InheritableTrustPolicy | undefined,
): policy is TrustPolicy {
  return policy !== undefined && policy !== "inherit";
}

export function resolveEffectiveTrustPolicy(
  connectionPolicy: InheritableTrustPolicy | undefined,
  categoryPolicy: InheritableTrustPolicy | undefined,
  rootPolicy: InheritableTrustPolicy | undefined,
  fallbackPolicy: TrustPolicy = "always-ask",
): TrustPolicy {
  if (isConcreteTrustPolicy(connectionPolicy)) return connectionPolicy;
  if (isConcreteTrustPolicy(categoryPolicy)) return categoryPolicy;
  if (isConcreteTrustPolicy(rootPolicy)) return rootPolicy;
  return fallbackPolicy;
}

export function getEffectiveTrustPolicy(
  connectionPolicy: InheritableTrustPolicy | undefined,
  globalPolicy: InheritableTrustPolicy | undefined,
): TrustPolicy {
  return resolveEffectiveTrustPolicy(connectionPolicy, globalPolicy, undefined);
}

/** Test-only cache reset. Production code should never bypass hydration. */
export function resetTrustStoreCacheForTests(): void {
  clearCache();
  hydrationPromise = null;
  mutationTail = Promise.resolve();
  pendingMutations = 0;
  hydrationFailureCount = 0;
  nextHydrationAttemptAt = 0;
  hydrationState = "idle";
  nativeTrustOperations.clear();
  scopeGeneration += 1;
  scopeResolution = null;
  scopeActivation = Promise.resolve();
  activeScope = { ...UNRESOLVED_SCOPE };
}
