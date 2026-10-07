import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  reconcileMergedRecordLedgers,
  RecordLedgerError,
  type RecordLedgerErrorCode,
} from "../storage/recordLedger";
import {
  fullDatabaseArchiveData,
  type FullDatabaseArchive,
} from "../connection/fullDatabaseArchive";
import {
  reviewRecordKind,
  reviewConflictLabels,
  type SmartSyncConflictCode,
  type SmartSyncConflictDetail,
} from "./cloudSyncReviewDetails";

type Json = null | boolean | number | string | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };
type Node = {
  hash: string;
  kind: "atomic" | "object" | "records";
  children?: Record<string, Node>;
  order?: string[];
};

/** Opaque checkpoint data: only salted hashes, structural tags and a random salt.
 * Never contains payloads, property names, record IDs, or ledger revisions. */
export interface SmartSyncBaseline {
  version: 1;
  salt: string;
  root: Node;
  history?: string;
  /** No safe granular index was available; normal sync must still succeed. */
  disabled?: true;
}

const MAX_BYTES = 48 * 1024 * 1024;
const MAX_NODES = 200_000;
const MAX_DEPTH = 48;
const MAX_BASELINE_NODES = 4096;
const MAX_BASELINE_BYTES = 1024 * 1024;
const MAX_HASH_BYTES = 256 * 1024 * 1024;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const containers = new Set([
  "",
  "settings",
  "databaseSettings",
  "colorTags",
  "provenance",
  "automationLibrary",
  "automationLibrary/terminalScripts",
  "automationLibrary/website",
  "automationLibrary/provenance",
  "terminalScripts",
  "website",
  "credentialVault",
  "documents",
  "recycleBin",
]);
const recordLists = new Set([
  "connections",
  "tabGroups",
  "credentialVault/entries",
  "recycleBin/entries",
  "documents",
  "people",
  "tickets",
  "attachments",
  "documents/documents",
  "documents/people",
  "documents/tickets",
  "documents/attachments",
  "customScripts",
  "modifiedDefaults",
  "scripts",
  "macros",
  "terminalMacros",
  "terminalScripts/customScripts",
  "terminalScripts/modifiedDefaults",
  "website/scripts",
  "website/macros",
  "automationLibrary/terminalMacros",
  "automationLibrary/terminalScripts/customScripts",
  "automationLibrary/terminalScripts/modifiedDefaults",
  "automationLibrary/website/scripts",
  "automationLibrary/website/macros",
]);
const object = (value: Json | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (): never => {
  throw new Error(
    "Smart sync input is unsupported or exceeds safe limits; review both copies.",
  );
};
const canonical = (value: Json): string => JSON.stringify(value);
const childPath = (path: string, key: string) =>
  path ? `${path}/${encodeURIComponent(key)}` : encodeURIComponent(key);

const historyConflictCodes: Record<
  RecordLedgerErrorCode,
  SmartSyncConflictCode
> = {
  "unrelated-histories": "history-unrelated",
  "revision-identity-collision": "history-revision-collision",
  "revision-stamp-collision": "history-stamp-collision",
  "creation-provenance": "history-creation-provenance",
  "missing-branch-head": "history-missing-head",
  "deleted-content": "history-deleted-content",
  "safety-limit": "history-safety-limit",
  "timestamp-overflow": "history-timestamp-overflow",
  "invalid-ledger": "history-invalid",
};

/** JSON descriptors only. Do not run getters, toJSON, or prototype hooks. */
function snapshot(
  value: unknown,
  maxBytes = MAX_BYTES,
  maxNodes = MAX_NODES,
): Json {
  let count = 0,
    bytes = 0;
  const ancestors = new Set<object>();
  const charge = (text: string) => {
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) invalid();
  };
  const visit = (input: unknown, depth: number): Json => {
    if (++count > maxNodes || depth > MAX_DEPTH) return invalid();
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string") {
      charge(JSON.stringify(input));
      return input;
    }
    if (!input || typeof input !== "object" || ancestors.has(input))
      return invalid();
    const array = Array.isArray(input),
      proto = Object.getPrototypeOf(input);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      return invalid();
    ancestors.add(input);
    const keys = Reflect.ownKeys(input);
    if (keys.length > maxNodes || keys.some((key) => typeof key !== "string"))
      return invalid();
    const result: Json[] | JsonObject = array ? [] : Object.create(null);
    if (array && keys.length !== input.length + 1) return invalid();
    for (const key of (keys as string[]).sort()) {
      if (array && key === "length") continue;
      if (forbidden.has(key)) return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) return invalid();
      charge(JSON.stringify(key) + ": ,");
      if (array) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)
          return invalid();
        (result as Json[])[Number(key)] = visit(descriptor.value, depth + 1);
      } else (result as JsonObject)[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(input);
    return result;
  };
  return visit(value, 0);
}

function records(value: Json): Map<string, JsonObject> | undefined {
  if (!Array.isArray(value)) return;
  const result = new Map<string, JsonObject>();
  for (const item of value) {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      result.has(item.id)
    )
      return;
    result.set(item.id, item);
  }
  return result;
}

function kind(value: Json, path: string, atomic = false): Node["kind"] {
  if (atomic || (object(value) && typeof value.id === "string"))
    return "atomic";
  if (Array.isArray(value))
    return recordLists.has(path) && records(value) ? "records" : "atomic";
  return object(value) && containers.has(path) ? "object" : "atomic";
}

function hasher(salt: string) {
  let work = 0;
  return async (domain: string, value: Json): Promise<string> => {
    const bytes = new TextEncoder().encode(
      JSON.stringify([salt, domain, value]),
    );
    work += bytes.length;
    if (work > MAX_HASH_BYTES) return invalid();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
}

function split(value: Json) {
  if (!object(value)) return { body: value, ledger: undefined };
  const { recordMetadata, ...body } = value;
  return { body: body as Json, ledger: normalizeRecordLedger(recordMetadata) };
}

function ledgerBody(body: Json): Json {
  return object(body) && body.format === "sorng-full-database"
    ? (fullDatabaseArchiveData(
        body as unknown as FullDatabaseArchive,
      ) as unknown as Json)
    : body;
}

/** Never fail a completed sync when its optional index cannot be built. Large
 * indexes collapse to an atomic hash; unsupported inputs get a disabled marker. */
export async function buildSmartSyncBaseline(
  section: unknown,
): Promise<SmartSyncBaseline> {
  try {
    const { body, ledger } = split(snapshot(section));
    const salt = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const hash = hasher(salt);
    let count = 0;
    const build = async (
      value: Json,
      path: string,
      address: string,
      atomic = false,
    ): Promise<Node> => {
      if (++count > MAX_BASELINE_NODES) return invalid();
      const node: Node = {
        hash: await hash("content", value),
        kind: kind(value, path, atomic),
      };
      if (node.kind === "atomic") return node;
      node.children = Object.create(null);
      if (node.kind === "records") node.order = [];
      const entries =
        node.kind === "records"
          ? [...records(value)!]
          : Object.entries(value as JsonObject);
      for (const [key, child] of entries) {
        const token = await hash("path", [address, node.kind, key]);
        node.order?.push(token);
        node.children![token] = await build(
          child,
          childPath(path, key),
          token,
          node.kind === "records",
        );
      }
      return node;
    };
    let root: Node;
    try {
      root = await build(body, "", "root");
    } catch {
      root = { hash: await hasher(salt)("content", body), kind: "atomic" };
    }
    const result: SmartSyncBaseline = { version: 1, salt, root };
    if (ledger)
      result.history = await hasher(salt)("history", ledger as unknown as Json);
    if (
      new TextEncoder().encode(JSON.stringify(result)).length >
      MAX_BASELINE_BYTES
    )
      result.root = { hash: result.root.hash, kind: "atomic" };
    return result;
  } catch {
    return {
      version: 1,
      salt: "0".repeat(32),
      root: { hash: "0".repeat(64), kind: "atomic" },
      disabled: true,
    };
  }
}

function baselineSnapshot(value: SmartSyncBaseline): SmartSyncBaseline {
  const raw = snapshot(value, MAX_BASELINE_BYTES, MAX_BASELINE_NODES * 8);
  if (
    !object(raw) ||
    raw.version !== 1 ||
    typeof raw.salt !== "string" ||
    !/^[a-f0-9]{32}$/.test(raw.salt) ||
    Object.keys(raw).some(
      (key) =>
        !["version", "salt", "root", "history", "disabled"].includes(key),
    ) ||
    (raw.disabled !== undefined && raw.disabled !== true)
  )
    return invalid();
  const digest = (value: Json | undefined) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (raw.history !== undefined && !digest(raw.history)) return invalid();
  let count = 0;
  const check = (value: Json): void => {
    if (
      ++count > MAX_BASELINE_NODES ||
      !object(value) ||
      !digest(value.hash) ||
      !["atomic", "object", "records"].includes(String(value.kind))
    )
      return invalid();
    if (
      Object.keys(value).some(
        (key) => !["hash", "kind", "children", "order"].includes(key),
      )
    )
      return invalid();
    if (value.kind === "atomic") {
      if (value.children !== undefined || value.order !== undefined)
        return invalid();
      return;
    }
    if (
      !object(value.children) ||
      Object.keys(value.children).some((key) => !digest(key))
    )
      return invalid();
    if (value.kind === "records") {
      if (
        !Array.isArray(value.order) ||
        value.order.length !== Object.keys(value.children).length ||
        new Set(value.order).size !== value.order.length ||
        value.order.some(
          (key) =>
            typeof key !== "string" ||
            !Object.prototype.hasOwnProperty.call(value.children, key),
        )
      )
        return invalid();
    } else if (value.order !== undefined) return invalid();
    Object.values(value.children).forEach(check);
  };
  check(raw.root);
  return raw as unknown as SmartSyncBaseline;
}

/** No clock winner and no partial value on conflict. Callers MUST run the normal
 * payload/dependency validator before applying or uploading a merged value. */
export async function smartMergeSyncSection(
  local: unknown,
  remote: unknown,
  baseline?: SmartSyncBaseline,
  options?: { reconcileOrigins?: boolean },
): Promise<{
  value?: unknown;
  conflictCount: number;
  reason?: string;
  conflicts?: SmartSyncConflictDetail[];
}> {
  const conflict = (
    reason: string,
    code: SmartSyncConflictCode,
    count = 1,
    details?: SmartSyncConflictDetail[],
  ) => ({
    conflictCount: count,
    reason,
    conflicts: details ?? [{ code, kind: "other" as const, count }],
  });
  try {
    const left = snapshot(local),
      right = snapshot(remote);
    const l = split(left),
      r = split(right);
    const base =
      baseline === undefined ? undefined : baselineSnapshot(baseline);
    // Repair is a reviewed operation, not permission to infer ancestry from
    // equal content or a clock. Require the same bounded three-way baseline
    // used for content conflict checks and both complete input histories.
    if (options?.reconcileOrigins && !base)
      return conflict(
        "History reconciliation requires a shared smart-sync baseline. Neither copy was changed.",
        "missing-baseline",
      );
    if (base?.disabled)
      return !options?.reconcileOrigins && canonical(left) === canonical(right)
        ? { value: left, conflictCount: 0 }
        : conflict(
            "A bounded smart-sync baseline is unavailable. Review both copies before choosing a version.",
            "unavailable-baseline",
          );
    if (!base && canonical(left) !== canonical(right))
      return conflict(
        "No shared smart-sync baseline. Review both copies before choosing a version.",
        "missing-baseline",
      );
    if (base?.history && (!l.ledger || !r.ledger))
      return conflict(
        "Record history was removed. Review both copies; history cannot be silently discarded.",
        "history-removed",
      );
    if (options?.reconcileOrigins && (!l.ledger || !r.ledger))
      return conflict(
        "History reconciliation requires both recorded histories. Neither copy was changed.",
        "history-removed",
      );
    for (const part of [l, r])
      if (
        part.ledger &&
        JSON.stringify(
          await reconcileRecordLedger(ledgerBody(part.body), part.ledger, {
            mode: "migrate",
          }),
        ) !== JSON.stringify(part.ledger)
      )
        return conflict(
          "Record history does not match its section. Review both copies; untracked edits cannot be silently repaired.",
          "history-mismatch",
        );
    const hash = hasher(base?.salt ?? "equal-copies");
    let conflicts = 0;
    const details: SmartSyncConflictDetail[] = [];
    const noteConflict = (code: SmartSyncConflictCode, path: string) => {
      conflicts++;
      const kind = reviewRecordKind(path, l.body);
      const existing = details.find(
        (entry) => entry.code === code && entry.kind === kind,
      );
      if (existing) existing.count++;
      else details.push({ code, kind, count: 1 });
    };
    const same = (a: Json | undefined, b: Json | undefined) =>
      a === undefined
        ? b === undefined
        : b !== undefined && canonical(a) === canonical(b);
    const merge = async (
      a: Json | undefined,
      b: Json | undefined,
      node: Node | undefined,
      path: string,
      address: string,
    ): Promise<Json | undefined> => {
      if (same(a, b)) return a;
      if (!node) {
        if (a === undefined) return b;
        if (b === undefined) return a;
        noteConflict("concurrent-addition", path);
        return undefined;
      }
      if (a !== undefined && (await hash("content", a)) === node.hash) return b;
      if (b !== undefined && (await hash("content", b)) === node.hash) return a;
      if (
        a === undefined ||
        b === undefined ||
        node.kind === "atomic" ||
        kind(a, path) !== node.kind ||
        kind(b, path) !== node.kind
      ) {
        noteConflict(
          a === undefined || b === undefined
            ? "delete-versus-edit"
            : node.kind === "atomic"
              ? "concurrent-edit"
              : "incompatible-shape",
          path,
        );
        return undefined;
      }
      const aEntries =
        node.kind === "records"
          ? records(a)!
          : new Map(Object.entries(a as JsonObject));
      const bEntries =
        node.kind === "records"
          ? records(b)!
          : new Map(Object.entries(b as JsonObject));
      const merged = new Map<string, Json>();
      const tokens = new Map<string, string>();
      for (const key of new Set([...aEntries.keys(), ...bEntries.keys()])) {
        const token = await hash("path", [address, node.kind, key]);
        tokens.set(key, token);
        const value = await merge(
          aEntries.get(key),
          bEntries.get(key),
          node.children![token],
          childPath(path, key),
          token,
        );
        if (value !== undefined) merged.set(key, value);
      }
      if (node.kind === "object") return Object.fromEntries(merged);
      const order = (entries: Map<string, Json>) =>
        [...entries.keys()]
          .filter((key) => merged.has(key))
          .map((key) => tokens.get(key)!);
      const ao = order(aEntries),
        bo = order(bEntries);
      const surviving = new Set(
        [...merged.keys()].map((key) => tokens.get(key)!),
      );
      const old = node.order!.filter((token) => surviving.has(token));
      let chosen: string[];
      if (same(ao, bo)) chosen = ao;
      else if (same(ao, old)) chosen = bo;
      else if (same(bo, old)) chosen = ao;
      else {
        // Only accept the unique order implied by both copies. Concurrent
        // insertions into the same gap or contradictory reorders need review.
        const edges = new Map(
          [...surviving].map((token) => [token, new Set<string>()]),
        );
        const degrees = new Map([...surviving].map((token) => [token, 0]));
        for (const sequence of [ao, bo])
          for (let index = 1; index < sequence.length; index++) {
            const before = sequence[index - 1],
              after = sequence[index];
            if (!edges.get(before)!.has(after)) {
              edges.get(before)!.add(after);
              degrees.set(after, degrees.get(after)! + 1);
            }
          }
        chosen = [];
        const ready = [...surviving].filter(
          (token) => degrees.get(token) === 0,
        );
        while (ready.length === 1) {
          const next = ready.pop()!;
          chosen.push(next);
          for (const after of edges.get(next)!) {
            degrees.set(after, degrees.get(after)! - 1);
            if (degrees.get(after) === 0) ready.push(after);
          }
        }
        if (chosen.length !== surviving.size) {
          noteConflict("ordering", path);
          return undefined;
        }
      }
      const byToken = new Map(
        [...merged].map(([key, value]) => [tokens.get(key)!, value]),
      );
      return chosen.map((token) => byToken.get(token)!);
    };
    const body = await merge(l.body, r.body, base?.root, "", "root");
    if (conflicts || body === undefined)
      return conflict(
        "The affected records or properties need review. No partial merge was applied.",
        "concurrent-edit",
        conflicts || 1,
        details.length ? details : undefined,
      );
    if (l.ledger || r.ledger) {
      if (!object(body))
        return conflict(
          "Record history requires an object section. Review both copies.",
          "history-incompatible",
        );
      try {
        body.recordMetadata = (await reconcileMergedRecordLedgers(
          ledgerBody(body),
          l.ledger,
          r.ledger,
          options,
        )) as unknown as Json;
      } catch (error) {
        // The ledger intentionally stops at the first failed invariant. Report
        // that fixed code, not an invented count of affected records or the raw
        // exception (which could originate outside the ledger, e.g. WebCrypto).
        const code =
          error instanceof RecordLedgerError
            ? historyConflictCodes[error.code]
            : "history-incompatible";
        return conflict(
          `${reviewConflictLabels[code]}. No history was discarded.`,
          code,
        );
      }
    }
    return { value: body, conflictCount: 0 };
  } catch {
    return conflict(
      "Smart sync data or checkpoint is invalid or exceeds safe limits. Review both copies; no data was applied.",
      "invalid-data",
    );
  }
}
