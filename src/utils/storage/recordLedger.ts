import { normalizeRecordTimestamp as timestamp } from "./recordTimestamps";

/** Private database metadata. No payload bodies or historical copies belong here. */
export type RecordStampSource = "record" | "inferred" | "observed";

export interface RecordStamp {
  createdAt: string;
  updatedAt: string;
  createdAtSource: RecordStampSource;
  updatedAtSource: RecordStampSource;
  /** Opaque token; consumers must not interpret or increment it. */
  revision: string;
  contentHash: string;
  deletedAt?: string;
}

export interface RecordChange {
  record: string;
  revision: string;
  parentRevision?: string;
  /** V2 merge events only. Original single-parent events are never rewritten. */
  parentRevisions?: string[];
  timestamp: string;
  kind:
    | "migrate"
    | "create"
    | "update"
    | "delete"
    | "restore"
    | "merge"
    | "merge-delete";
}

export interface RecordLedger {
  version: 1 | 2;
  records: Record<string, RecordStamp>;
  journal: RecordChange[];
}

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}
type Dates = Pick<
  RecordStamp,
  "createdAt" | "updatedAt" | "createdAtSource" | "updatedAtSource"
>;

// Bounds apply to the complete ledger, including tombstones and old journal
// entries. Reaching one rejects the operation; history is never truncated.
const MAX_RECORDS = 200_000;
const MAX_JOURNAL = 1_000_000;
const MAX_MERGE_PARENTS = 64;
const MAX_DEPTH = 64;
const MAX_NODES = 4_000_000;
const MAX_METADATA_BYTES = 128 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_HASH_BYTES = 256 * 1024 * 1024;
const MAX_PATH = 4096;
const EPOCH = "1970-01-01T00:00:00.000Z";
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const dictionaries = new Set([
  "settings",
  "databaseSettings",
  "colorTags",
  "provenance",
  "modifiedDefaults",
]);
const recordArrays = new Set([
  "$/connections",
  "$/tabGroups",
  "$/documents/documents",
  "$/documents/attachments",
  "$/documents/people",
  "$/documents/tickets",
  "$/credentialVault/entries",
  "$/recycleBin/entries",
  "$/automationLibrary/terminalScripts/customScripts",
  "$/automationLibrary/terminalScripts/modifiedDefaults",
  "$/automationLibrary/terminalMacros",
  "$/automationLibrary/website/scripts",
  "$/automationLibrary/website/macros",
  // The same libraries can also be persisted as standalone global payloads.
  "$/terminalScripts/customScripts",
  "$/terminalScripts/modifiedDefaults",
  "$/terminalMacros",
  "$/website/scripts",
  "$/website/macros",
  "$/scripts",
  "$/macros",
]);
export type RecordLedgerErrorCode =
  | "invalid-ledger"
  | "unrelated-histories"
  | "revision-identity-collision"
  | "revision-stamp-collision"
  | "creation-provenance"
  | "missing-branch-head"
  | "deleted-content"
  | "safety-limit"
  | "timestamp-overflow";

/** Only fixed diagnostic codes cross into sync review; never attach the
 * offending record path, revision, stamp, or private payload to an error. */
export class RecordLedgerError extends Error {
  constructor(
    readonly code: RecordLedgerErrorCode,
    reason: string,
  ) {
    super(`Invalid record ledger: ${reason}. Existing metadata was retained.`);
    this.name = "RecordLedgerError";
  }
}

function invalid(
  reason: string,
  code: RecordLedgerErrorCode = "invalid-ledger",
): never {
  // Deliberately never interpolate keys, IDs, or values from private payloads.
  throw new RecordLedgerError(code, reason);
}
const isObject = (value: Json): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Clone data descriptors only: do not invoke getters, toJSON, or runtime APIs. */
function jsonSnapshot(
  value: unknown,
  maxBytes: number,
  skipRootMetadata = false,
  serializeDates = false,
): Json {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const charge = (amount: number) => {
    bytes += amount;
    if (bytes > maxBytes) invalid("JSON byte limit exceeded", "safety-limit");
  };
  const copy = (input: unknown, depth: number): Json => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      invalid("JSON complexity limit exceeded", "safety-limit");
    if (input === null || typeof input === "boolean") {
      charge(5);
      return input;
    }
    if (typeof input === "string") {
      if (input.length > maxBytes)
        invalid("JSON byte limit exceeded", "safety-limit");
      charge(byteLength(JSON.stringify(input)));
      return input;
    }
    if (typeof input === "number" && Number.isFinite(input)) {
      charge(24);
      return input;
    }
    if (!input || typeof input !== "object") invalid("non-JSON value");
    const array = Array.isArray(input);
    const proto = Object.getPrototypeOf(input);
    // Runtime connection timestamps are Dates. Convert them only at the
    // persistence boundary; ledger validation itself remains JSON-only.
    if (serializeDates && proto === Date.prototype) {
      if (
        Reflect.ownKeys(input).length !== 0 ||
        !Number.isFinite(Date.prototype.getTime.call(input))
      )
        invalid("invalid runtime date");
      return copy(Date.prototype.toISOString.call(input), depth);
    }
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      invalid("runtime object");
    if (
      array &&
      (input as unknown[]).length >
        (maxBytes === MAX_METADATA_BYTES ? MAX_JOURNAL : MAX_NODES)
    )
      invalid("JSON array count limit exceeded", "safety-limit");
    if (ancestors.has(input)) invalid("cyclic JSON");
    ancestors.add(input);
    const keys = Reflect.ownKeys(input);
    if (keys.length > MAX_NODES - nodes)
      invalid("JSON complexity limit exceeded", "safety-limit");
    const output: JsonObject | Json[] = array ? [] : Object.create(null);
    let items = 0;
    for (const key of keys.sort((a, b) =>
      String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
    )) {
      if (typeof key !== "string" || forbidden.has(key))
        invalid("unsafe JSON key");
      if (array && key === "length") continue;
      if (key.length > MAX_PATH) invalid("JSON key limit exceeded");
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!descriptor.enumerable || !("value" in descriptor))
        invalid("non-data JSON property");
      if (skipRootMetadata && depth === 0 && key === "recordMetadata") continue;
      // Match JSON.stringify for optional object properties. Array omissions
      // have positional meaning and are rejected, as are sparse arrays.
      if (!array && descriptor.value === undefined) continue;
      charge(byteLength(JSON.stringify(key)) + 2);
      if (array) {
        if (
          !/^(0|[1-9]\d*)$/.test(key) ||
          Number(key) >= (input as unknown[]).length
        )
          invalid("non-JSON array property");
        (output as Json[])[Number(key)] = copy(descriptor.value, depth + 1);
        items++;
      } else {
        (output as JsonObject)[key] = copy(descriptor.value, depth + 1);
      }
    }
    if (array && items !== (input as unknown[]).length)
      invalid("sparse JSON array");
    ancestors.delete(input);
    charge(2);
    return output;
  };
  return copy(value, 0);
}

/** Freeze a runtime draft as persisted JSON without invoking getters/toJSON. */
export function snapshotRecordPayload<T extends object>(value: T): T {
  const descriptor = Object.getOwnPropertyDescriptor(value, "recordMetadata");
  const metadata = normalizeRecordLedger(
    descriptor && "value" in descriptor ? descriptor.value : undefined,
  );
  const payload = object(jsonSnapshot(value, MAX_PAYLOAD_BYTES, true, true));
  if (metadata !== undefined)
    payload.recordMetadata = metadata as unknown as Json;
  return payload as T;
}

function byteLength(value: string): number {
  return /[^\x20-\x7e]/.test(value)
    ? new TextEncoder().encode(value).byteLength
    : value.length;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function utc(value: Json | undefined): string {
  if (typeof value !== "string" || !value.endsWith("Z"))
    invalid("UTC timestamp required");
  return timestamp(value) ?? invalid("invalid timestamp");
}

function source(value: Json | undefined): RecordStampSource {
  if (value === "record" || value === "inferred" || value === "observed")
    return value;
  return invalid("invalid timestamp provenance");
}

function token(value: Json | undefined): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    hasControlCharacters(value)
  )
    invalid("invalid revision");
  return value;
}

function object(
  value: Json | undefined,
  fields?: readonly string[],
): JsonObject {
  if (value === undefined || !isObject(value)) invalid("object required");
  if (fields && Object.keys(value).some((key) => !fields.includes(key)))
    invalid("unexpected metadata field");
  return value;
}

function encode(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return invalid("invalid identity encoding");
  }
}

function recordKey(value: Json | undefined): string {
  if (typeof value !== "string" || value.length > MAX_PATH)
    invalid("invalid record path");
  if (value === "$") return value;
  const parts = value.split("/");
  if (
    parts.shift() !== "$" ||
    parts.length === 0 ||
    parts[0].startsWith("@") ||
    parts[0] === "recordMetadata" ||
    parts[0] === "timestamp"
  )
    invalid("invalid record path");
  for (const part of parts) {
    const identity = part.startsWith("@");
    const encoded = identity ? part.slice(1) : part;
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      return invalid("invalid record path encoding");
    }
    if (
      encode(decoded) !== encoded ||
      forbidden.has(decoded) ||
      (identity &&
        (!decoded.trim() ||
          decoded.length > 512 ||
          hasControlCharacters(decoded)))
    )
      invalid("invalid record path segment");
  }
  return value;
}

const deletedEvent = (event: RecordChange) =>
  event.kind === "delete" || event.kind === "merge-delete";
const eventParents = (event: RecordChange): readonly string[] =>
  event.parentRevisions ?? (event.parentRevision ? [event.parentRevision] : []);

/** V2 is a topologically ordered DAG with one resolved head per record. An
 * explicit merge event joins branches; a version bump alone cannot bless forks.
 * Existing events retain their original parents, timestamps and revisions. */
function normalizeDagHistory(
  entries: Json[],
  records: Record<string, RecordStamp>,
): { journal: RecordChange[]; latest: Map<string, RecordChange> } {
  const events = new Map<string, RecordChange>();
  const heads = new Map<string, Set<string>>();
  const roots = new Set<string>();
  const journal: RecordChange[] = [];
  let merges = 0;
  let edges = 0;
  for (const entry of entries) {
    const change = object(entry, [
      "record",
      "revision",
      "parentRevision",
      "parentRevisions",
      "timestamp",
      "kind",
    ]);
    const key = recordKey(change.record),
      revision = token(change.revision),
      time = utc(change.timestamp);
    const stamp = records[key];
    if (!stamp || events.has(revision))
      invalid("unknown record or duplicate revision");
    const kind = change.kind;
    const merging = kind === "merge" || kind === "merge-delete";
    let parents: string[];
    if (merging) {
      if (
        "parentRevision" in change ||
        !Array.isArray(change.parentRevisions) ||
        change.parentRevisions.length < 2 ||
        change.parentRevisions.length > MAX_MERGE_PARENTS
      )
        invalid("invalid merge parents");
      parents = change.parentRevisions.map(token);
      if (
        parents.some(
          (parent, index) => index > 0 && parent <= parents[index - 1],
        )
      )
        invalid("merge parents must be unique and sorted");
      merges++;
    } else {
      if ("parentRevisions" in change) invalid("unexpected merge parents");
      parents =
        "parentRevision" in change ? [token(change.parentRevision)] : [];
    }
    edges += parents.length;
    if (edges > MAX_JOURNAL * 4)
      invalid("history edge limit exceeded", "safety-limit");
    if (!parents.length) {
      if (
        (kind !== "create" && kind !== "migrate") ||
        roots.has(key) ||
        time < stamp.createdAt
      )
        invalid("invalid initial history");
      if (
        kind === "create"
          ? stamp.createdAtSource !== "observed" || stamp.createdAt !== time
          : stamp.createdAtSource === "observed"
      )
        invalid("inconsistent creation provenance");
      roots.add(key);
    } else {
      for (const parent of parents) {
        const prior = events.get(parent);
        if (!prior || prior.record !== key || time <= prior.timestamp)
          invalid("broken revision history");
        if (
          !merging &&
          (deletedEvent(prior)
            ? kind !== "restore"
            : kind !== "update" && kind !== "delete")
        )
          invalid("broken revision history");
      }
    }
    const event: RecordChange = {
      record: key,
      revision,
      timestamp: time,
      kind: kind as RecordChange["kind"],
    };
    if (merging) event.parentRevisions = parents;
    else if (parents.length) event.parentRevision = parents[0];
    if (key === "$" && deletedEvent(event)) invalid("root cannot be deleted");
    const recordHeads = heads.get(key) ?? new Set<string>();
    parents.forEach((parent) => recordHeads.delete(parent));
    recordHeads.add(revision);
    heads.set(key, recordHeads);
    events.set(revision, event);
    journal.push(event);
  }
  if (!merges) invalid("version two requires explicit merge history");
  const latest = new Map<string, RecordChange>();
  for (const [key, recordHeads] of heads) {
    if (recordHeads.size !== 1) invalid("unresolved history branches");
    latest.set(key, events.get([...recordHeads][0])!);
  }
  return { journal, latest };
}

/** Undefined means legacy absence. Present corrupt/future metadata always throws. */
export function normalizeRecordLedger(
  value: unknown,
): RecordLedger | undefined {
  if (value === undefined) return undefined;
  const raw = object(jsonSnapshot(value, MAX_METADATA_BYTES), [
    "version",
    "records",
    "journal",
  ]);
  if (raw.version !== 1 && raw.version !== 2) invalid("unsupported version");
  const rawRecords = object(raw.records);
  const keys = Object.keys(rawRecords);
  if (!keys.includes("$") || keys.length > MAX_RECORDS)
    invalid("record count limit or missing root");
  if (!Array.isArray(raw.journal) || raw.journal.length > MAX_JOURNAL)
    invalid("journal limit or invalid journal");
  const records: Record<string, RecordStamp> = Object.create(null);
  for (const key of keys) {
    recordKey(key);
    const stamp = object(rawRecords[key], [
      "createdAt",
      "updatedAt",
      "createdAtSource",
      "updatedAtSource",
      "revision",
      "contentHash",
      "deletedAt",
    ]);
    const createdAt = utc(stamp.createdAt),
      updatedAt = utc(stamp.updatedAt);
    if (createdAt > updatedAt) invalid("timestamps out of order");
    if (
      typeof stamp.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(stamp.contentHash)
    )
      invalid("invalid content hash");
    records[key] = {
      createdAt,
      updatedAt,
      createdAtSource: source(stamp.createdAtSource),
      updatedAtSource: source(stamp.updatedAtSource),
      revision: token(stamp.revision),
      contentHash: stamp.contentHash,
    };
    if ("deletedAt" in stamp) {
      const deletedAt = utc(stamp.deletedAt);
      if (key === "$" || deletedAt !== updatedAt)
        invalid("invalid tombstone timestamp");
      records[key].deletedAt = deletedAt;
    }
  }
  const dag =
    raw.version === 2 ? normalizeDagHistory(raw.journal, records) : undefined;
  const latest = dag?.latest ?? new Map<string, RecordChange>();
  const revisions = new Set<string>();
  const journal: RecordChange[] = dag?.journal ?? [];
  for (const entry of dag ? [] : raw.journal) {
    const change = object(entry, [
      "record",
      "revision",
      "parentRevision",
      "timestamp",
      "kind",
    ]);
    const key = recordKey(change.record),
      revision = token(change.revision),
      time = utc(change.timestamp);
    const stamp = records[key];
    if (!stamp || revisions.has(revision))
      invalid("unknown record or duplicate revision");
    const prior = latest.get(key);
    const kind = change.kind;
    if (!prior) {
      if (
        (kind !== "create" && kind !== "migrate") ||
        "parentRevision" in change ||
        time < stamp.createdAt
      )
        invalid("invalid initial history");
      if (
        kind === "create"
          ? stamp.createdAtSource !== "observed" || stamp.createdAt !== time
          : stamp.createdAtSource === "observed"
      )
        invalid("inconsistent creation provenance");
    } else {
      if (
        token(change.parentRevision) !== prior.revision ||
        time <= prior.timestamp ||
        (prior.kind === "delete"
          ? kind !== "restore"
          : kind !== "update" && kind !== "delete")
      )
        invalid("broken revision history");
    }
    const event: RecordChange = {
      record: key,
      revision,
      timestamp: time,
      kind: kind as RecordChange["kind"],
    };
    if (prior) event.parentRevision = prior.revision;
    journal.push(event);
    latest.set(key, event);
    revisions.add(revision);
  }
  for (const [key, stamp] of Object.entries(records)) {
    const last = latest.get(key);
    if (
      !last ||
      last.revision !== stamp.revision ||
      last.timestamp !== stamp.updatedAt ||
      deletedEvent(last) !== (stamp.deletedAt !== undefined) ||
      ((last.kind === "merge" || last.kind === "merge-delete") &&
        stamp.updatedAtSource !== "inferred") ||
      (last.kind === "migrate"
        ? stamp.updatedAtSource === "observed"
        : last.kind === "create"
          ? stamp.updatedAtSource !== "observed"
          : stamp.updatedAtSource === "record")
    )
      invalid("stamp does not match history");
    if (key !== "$") {
      const parts = key.split("/");
      if (!records[`$/${parts[1]}`]) invalid("missing section record");
      while (parts.length > 1) {
        parts.pop();
        if (records[parts.join("/")]?.deletedAt && !stamp.deletedAt)
          invalid("live record beneath tombstone");
      }
    }
  }
  return { version: raw.version, records, journal };
}

function legacyDates(value: Json, enclosing: string): Dates {
  const raw = isObject(value) ? value : {};
  const created =
    timestamp(raw.createdAt) ??
    timestamp(raw.created_at) ??
    timestamp(raw.first_trusted);
  const updated = timestamp(raw.updatedAt) ?? timestamp(raw.updated_at);
  const fallback = timestamp(raw.timestamp) ?? enclosing;
  if (created && updated && created > updated)
    invalid("record timestamps out of order");
  return {
    createdAt: created ?? (updated && updated < fallback ? updated : fallback),
    updatedAt: updated ?? (created && created > fallback ? created : fallback),
    createdAtSource: created ? "record" : "inferred",
    updatedAtSource: updated ? "record" : "inferred",
  };
}

interface Candidate {
  key: string;
  value: Json;
  dates: Dates;
}

function enumerate(payload: JsonObject, prior?: RecordLedger): Candidate[] {
  const candidates = new Map<string, Candidate>();
  const knownArrays = new Set(recordArrays);
  // Losing all IDs in a formerly identified collection is corruption, not a
  // request to turn each old record into a tombstone plus anonymous content.
  for (const key of Object.keys(prior?.records ?? {})) {
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (parts[index].startsWith("@"))
        knownArrays.add(parts.slice(0, index).join("/"));
    }
  }
  const add = (key: string, value: Json, dates: Dates) => {
    recordKey(key);
    if (candidates.has(key)) invalid("duplicate record identity");
    if (candidates.size >= MAX_RECORDS)
      invalid("record count limit exceeded", "safety-limit");
    candidates.set(key, { key, value, dates });
  };
  const walk = (
    value: Json,
    path: string | undefined,
    enclosing: string,
    field: string,
  ) => {
    const dates = legacyDates(value, enclosing);
    if (Array.isArray(value)) {
      // Quick actions reference another owner. The same ID may legitimately
      // occur in the app, this database and a foreign database (or both kinds).
      // Document links likewise refer to scoped entities, rather than owning ID.
      if (
        (path !== undefined &&
          /\/(?:sshQuickActions|httpAutomation)\/items$/.test(path)) ||
        (field === "items" &&
          value.every(
            (item) =>
              isObject(item) &&
              (item.kind === "script" || item.kind === "macro") &&
              typeof item.id === "string" &&
              Object.keys(item).every(
                (key) => key === "kind" || key === "id" || key === "scope",
              ),
          )) ||
        (field === "references" &&
          value.every(
            (item) =>
              isObject(item) &&
              typeof item.databaseId === "string" &&
              typeof item.kind === "string" &&
              typeof item.id === "string",
          ))
      )
        return;
      const needsIds =
        (path !== undefined &&
          (knownArrays.has(path) ||
            /^\$\/documents\/documents\/@[^/]+\/blocks(?:\/@[^/]+\/workbook\/sheets)?$/.test(
              path,
            ))) ||
        value.some((item) => isObject(item) && "id" in item);
      const identities = new Set<string>();
      for (const item of value) {
        if (!needsIds) {
          // An anonymous ancestor has no stable address. Its entire subtree is
          // covered by the nearest recorded parent, never an invented index ID.
          walk(item, undefined, dates.updatedAt, "");
          continue;
        }
        if (
          !isObject(item) ||
          typeof item.id !== "string" ||
          !item.id.trim() ||
          item.id.length > 512 ||
          forbidden.has(item.id) ||
          hasControlCharacters(item.id)
        )
          invalid("missing or invalid stable ID");
        if (identities.has(item.id)) invalid("duplicate stable ID");
        identities.add(item.id);
        const child =
          path === undefined ? undefined : `${path}/@${encode(item.id)}`;
        if (child !== undefined)
          add(child, item, legacyDates(item, dates.updatedAt));
        walk(item, child, dates.updatedAt, "");
      }
    } else if (isObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        const childPath =
          path === undefined ? undefined : `${path}/${encode(name)}`;
        if (
          childPath !== undefined &&
          (path === "$" || dictionaries.has(field))
        )
          add(childPath, child, legacyDates(child, dates.updatedAt));
        walk(child, childPath, dates.updatedAt, name);
      }
    }
  };
  // The volatile root timestamp informs legacy inference, but is never hashed
  // or enumerated. Nested fields named timestamp/recordMetadata remain content.
  const rootDates = legacyDates(payload, EPOCH);
  const content = { ...payload };
  delete content.timestamp;
  delete content.recordMetadata;
  add("$", content, rootDates);
  walk(content, "$", rootDates.updatedAt, "");
  return [...candidates.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function nextTime(now: string, prior: string): string {
  return (
    timestamp(Math.max(Date.parse(now), Date.parse(prior) + 1)) ??
    invalid("timestamp overflow", "timestamp-overflow")
  );
}

/**
 * Pure reconciliation: no storage, networking, mutation, random IDs, or bodies in
 * history. Paths use URI-encoded property segments and /@<encoded string ID>.
 * Default mode is migrate. Stale migration metadata is reconciled deterministically
 * with inferred update times; only write mode observes the clock. Explicit
 * previous is authoritative, but embedded root recordMetadata is always validated.
 */
export async function reconcileRecordLedger(
  value: unknown,
  previous?: RecordLedger,
  options?: { mode?: "migrate" | "write"; now?: string },
): Promise<RecordLedger> {
  const metadata =
    value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "recordMetadata")
      : undefined;
  const embedded = normalizeRecordLedger(
    metadata && "value" in metadata ? metadata.value : undefined,
  );
  const payload = object(jsonSnapshot(value, MAX_PAYLOAD_BYTES, true));
  const prior = normalizeRecordLedger(previous) ?? embedded;
  const mode = options?.mode ?? "migrate";
  if (mode !== "migrate" && mode !== "write")
    invalid("unsupported reconciliation mode");
  const now =
    options?.now === undefined
      ? mode === "write"
        ? new Date().toISOString()
        : EPOCH
      : utc(options.now);
  const candidates = enumerate(payload, prior);
  const records: Record<string, RecordStamp> = Object.assign(
    Object.create(null),
    prior?.records,
  );
  const journal = prior ? [...prior.journal] : [];
  let recordCount = Object.keys(records).length;
  const present = new Set(candidates.map((candidate) => candidate.key));
  const missing = Object.keys(records)
    .filter((key) => !present.has(key) && !records[key].deletedAt)
    .sort();
  let hashedBytes = 0;
  const append = async (
    key: string,
    contentHash: string,
    dates: Dates,
    kind: RecordChange["kind"],
  ) => {
    if (journal.length >= MAX_JOURNAL)
      invalid("journal limit exceeded", "safety-limit");
    const before = records[key];
    if (!before && ++recordCount > MAX_RECORDS)
      invalid("record count limit exceeded", "safety-limit");
    const revision = await sha256(
      JSON.stringify([
        "record-ledger-v1",
        key,
        contentHash,
        kind,
        before?.revision ?? null,
        dates.createdAt,
        dates.updatedAt,
        dates.createdAtSource,
        dates.updatedAtSource,
      ]),
    );
    records[key] = { ...dates, revision, contentHash };
    if (kind === "delete") records[key].deletedAt = dates.updatedAt;
    const change: RecordChange = {
      record: key,
      revision,
      timestamp: dates.updatedAt,
      kind,
    };
    if (before) change.parentRevision = before.revision;
    journal.push(change);
  };
  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate.value);
    hashedBytes += byteLength(serialized);
    if (hashedBytes > MAX_HASH_BYTES)
      invalid("hash work limit exceeded", "safety-limit");
    const contentHash = await sha256(serialized);
    const before = records[candidate.key];
    if (before && !before.deletedAt && before.contentHash === contentHash)
      continue;
    const dates: Dates =
      mode === "migrate"
        ? before
          ? {
              createdAt: before.createdAt,
              createdAtSource: before.createdAtSource,
              updatedAt: nextTime(candidate.dates.updatedAt, before.updatedAt),
              updatedAtSource: "inferred",
            }
          : candidate.dates
        : {
            createdAt: before?.createdAt ?? now,
            createdAtSource: before?.createdAtSource ?? "observed",
            updatedAt: before ? nextTime(now, before.updatedAt) : now,
            updatedAtSource: "observed",
          };
    await append(
      candidate.key,
      contentHash,
      dates,
      !before
        ? mode === "migrate"
          ? "migrate"
          : "create"
        : before.deletedAt
          ? "restore"
          : "update",
    );
  }
  for (const key of missing) {
    const before = records[key];
    await append(
      key,
      before.contentHash,
      {
        createdAt: before.createdAt,
        createdAtSource: before.createdAtSource,
        updatedAt: nextTime(
          mode === "migrate" ? candidates[0].dates.updatedAt : now,
          before.updatedAt,
        ),
        updatedAtSource: mode === "migrate" ? "inferred" : "observed",
      },
      "delete",
    );
  }
  // Check aggregate metadata bounds and all cross-record/history invariants
  // before handing a replacement back to the integrating storage layer.
  return normalizeRecordLedger({
    version: prior?.version ?? 1,
    records,
    journal,
  })!;
}

/** Preserve both histories for an ALREADY resolved payload. This helper never
 * chooses content or resolves record conflicts: the caller must do that first,
 * then validate the resulting payload/dependencies before any write. Forks are
 * closed by causal merge events, not clock winners or rewritten parent links.
 * No nested ledgers, payload bodies, or historical content are stored. */
export async function reconcileMergedRecordLedgers(
  value: unknown,
  local?: RecordLedger,
  remote?: RecordLedger,
): Promise<RecordLedger> {
  const left = normalizeRecordLedger(local),
    right = normalizeRecordLedger(remote);
  if (!left || !right) return reconcileRecordLedger(value, left ?? right);
  const metadata =
    value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "recordMetadata")
      : undefined;
  normalizeRecordLedger(
    metadata && "value" in metadata ? metadata.value : undefined,
  );
  const payload = object(jsonSnapshot(value, MAX_PAYLOAD_BYTES, true));
  const events = new Map<string, RecordChange>();
  for (const ledger of [left, right]) {
    for (const event of ledger.journal) {
      const existing = events.get(event.revision);
      if (existing && JSON.stringify(existing) !== JSON.stringify(event))
        invalid("revision identity collision", "revision-identity-collision");
      events.set(event.revision, event);
      if (events.size > MAX_JOURNAL)
        invalid("journal limit exceeded", "safety-limit");
    }
  }
  // A containing journal is retained byte-for-byte (including event order).
  // Otherwise timestamp ordering is only a deterministic topological sort:
  // every validated child is later than its parents. It never selects content.
  const journal =
    events.size === left.journal.length
      ? [...left.journal]
      : events.size === right.journal.length
        ? [...right.journal]
        : [...events.values()].sort((a, b) =>
            a.timestamp < b.timestamp
              ? -1
              : a.timestamp > b.timestamp
                ? 1
                : a.revision < b.revision
                  ? -1
                  : a.revision > b.revision
                    ? 1
                    : 0,
          );
  const heads = new Map<string, Set<string>>();
  const roots = new Set<string>();
  for (const event of journal) {
    const parents = eventParents(event);
    if (!parents.length) {
      if (roots.has(event.record))
        invalid("unrelated record histories", "unrelated-histories");
      roots.add(event.record);
    }
    const recordHeads = heads.get(event.record) ?? new Set<string>();
    parents.forEach((parent) => recordHeads.delete(parent));
    recordHeads.add(event.revision);
    heads.set(event.record, recordHeads);
  }
  if (heads.size > MAX_RECORDS)
    invalid("record count limit exceeded", "safety-limit");
  const records: Record<string, RecordStamp> = Object.create(null);
  for (const [key, recordHeads] of heads) {
    const a = left.records[key],
      b = right.records[key];
    if (
      a &&
      b &&
      (a.createdAt !== b.createdAt || a.createdAtSource !== b.createdAtSource)
    )
      invalid("inconsistent creation provenance", "creation-provenance");
    if (
      a &&
      b &&
      a.revision === b.revision &&
      JSON.stringify(a) !== JSON.stringify(b)
    )
      invalid("revision stamp collision", "revision-stamp-collision");
    records[key] = recordHeads.has(a?.revision) ? a : b;
    if (!records[key] || !recordHeads.has(records[key].revision))
      invalid("missing branch head stamp", "missing-branch-head");
  }
  // Enumeration uses the union's known stable identities, not the archive
  // envelope. Callers exporting a full database pass fullDatabaseArchiveData.
  const candidates = new Map(
    enumerate(payload, { version: 1, records, journal }).map((candidate) => [
      candidate.key,
      candidate,
    ]),
  );
  let version: RecordLedger["version"] =
    left.version === 2 || right.version === 2 ? 2 : 1;
  let hashedBytes = 0;
  for (const [key, recordHeads] of heads) {
    if (recordHeads.size === 1) continue;
    if (recordHeads.size > MAX_MERGE_PARENTS)
      invalid("merge parent limit exceeded", "safety-limit");
    const parents = [...recordHeads].sort();
    const before = records[key];
    const candidate = candidates.get(key);
    let contentHash: string;
    if (candidate) {
      const serialized = JSON.stringify(candidate.value);
      hashedBytes += byteLength(serialized);
      if (hashedBytes > MAX_HASH_BYTES)
        invalid("hash work limit exceeded", "safety-limit");
      contentHash = await sha256(serialized);
    } else {
      // Tombstones retain the last content hash. Divergent last contents have
      // no single unambiguous tombstone hash; require explicit review instead.
      if (left.records[key]?.contentHash !== right.records[key]?.contentHash)
        invalid("ambiguous deleted record content", "deleted-content");
      contentHash = before.contentHash;
    }
    const parentTimes = parents
      .map((parent) => events.get(parent)!.timestamp)
      .sort();
    const latestTime = parentTimes[parentTimes.length - 1];
    const updatedAt = nextTime(EPOCH, latestTime);
    const kind = candidate ? "merge" : "merge-delete";
    const revision = await sha256(
      JSON.stringify([
        "record-ledger-v2",
        key,
        parents,
        contentHash,
        kind,
        before.createdAt,
        before.createdAtSource,
        updatedAt,
      ]),
    );
    if (events.has(revision))
      invalid("revision identity collision", "revision-identity-collision");
    if (journal.length >= MAX_JOURNAL)
      invalid("journal limit exceeded", "safety-limit");
    records[key] = {
      createdAt: before.createdAt,
      createdAtSource: before.createdAtSource,
      updatedAt,
      updatedAtSource: "inferred",
      revision,
      contentHash,
      ...(candidate ? {} : { deletedAt: updatedAt }),
    };
    journal.push({
      record: key,
      revision,
      timestamp: updatedAt,
      kind,
      parentRevisions: parents,
    });
    version = 2;
  }
  const combined = normalizeRecordLedger({ version, records, journal })!;
  // Reconcile nonforked records changed by the already resolved payload, while
  // retaining every union event. This also verifies the final aggregate bounds.
  return reconcileRecordLedger(payload, combined, { mode: "migrate" });
}
