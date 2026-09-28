import type { DiscoveredHost } from "../../types/connection/connection";
import type { NetworkDiscoveryConfig } from "../../types/settings/settings";
import {
  DISCOVERY_PING_METHODS,
  DISCOVERY_PROBE_METHODS,
  isDiscoveryProbeMethods,
} from "./discoveryPing";

export interface SavedDiscoveryScan {
  id: string;
  /** Optional display name; older entries use their scan date as the label. */
  name?: string;
  startedAt: number;
  elapsedMs: number;
  outcome: "complete" | "stopped" | "failed";
  config: NetworkDiscoveryConfig;
  hosts: DiscoveredHost[];
}

export const DISCOVERY_HISTORY_LIMIT = 20;
export const DISCOVERY_HISTORY_NAME_MAX_LENGTH = 200;
export const DISCOVERY_HISTORY_MAX_BYTES = 20 * 1024 * 1024;
export const DISCOVERY_HISTORY_MAX_HOSTS = 10_000;
/** Display alongside history; saves can evict entire older snapshots. */
export const DISCOVERY_HISTORY_RETENTION_NOTICE =
  "History keeps the newest 20 scans within 20 MiB of serialized metadata and results. Older whole scans are removed automatically. Scans over 10,000 hosts or 20 MiB are rejected; results are never truncated.";
const DB_NAME = "sorng-discovery-history";
const STORE = "scans";

type Parser = (value: unknown) => unknown;
function invalid(detail: string): never {
  throw new Error(`Invalid discovery history: ${detail}.`);
}
export function normalizeDiscoveryScanName(value: unknown): string {
  if (typeof value !== "string") invalid("scan name must be text");
  const name = value.trim();
  if (!name || name.length > DISCOVERY_HISTORY_NAME_MAX_LENGTH)
    invalid(
      `scan name must contain 1–${DISCOVERY_HISTORY_NAME_MAX_LENGTH} characters`,
    );
  if (
    Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    invalid("scan name must not contain control characters");
  return name;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("expected an object");
  return value as Record<string, unknown>;
};
const number: Parser = (value) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    invalid("expected a finite nonnegative number");
  return value;
};
const port: Parser = (value) => {
  number(value);
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 65535
  )
    invalid("port outside 1–65535");
  return value;
};
const boolean: Parser = (value) => {
  if (typeof value !== "boolean") invalid("expected a boolean");
  return value;
};
const choice =
  (...choices: string[]): Parser =>
  (value) => {
    if (typeof value !== "string" || !choices.includes(value))
      invalid("unsupported enum value");
    return value;
  };
const array =
  (parse: Parser, max: number): Parser =>
  (value) => {
    if (!Array.isArray(value) || value.length > max)
      invalid(`array exceeds ${max} entries or is malformed`);
    return Array.from(value, parse);
  };
const optional =
  (parse: Parser): Parser =>
  (value) =>
    value === undefined ? undefined : parse(value);
const shape =
  (fields: Record<string, Parser>): Parser =>
  (value) => {
    const input = object(value);
    // Allowlist fields: connection credentials and unknown extension fields never persist.
    return Object.fromEntries(
      Object.entries(fields).flatMap(([key, parse]) => {
        const parsed = parse(input[key]);
        return parsed === undefined ? [] : [[key, parsed]];
      }),
    );
  };

/** Validates and copies only config/result metadata, never arbitrary extensions. */
export function normalizeDiscoveryScan(value: unknown): SavedDiscoveryScan {
  let textBytes = 0;
  let entries = 0;
  const boundedArray =
    (parse: Parser, max: number): Parser =>
    (input) => {
      if (Array.isArray(input)) entries += input.length;
      if (entries > 1_000_000)
        invalid("snapshot exceeds 1,000,000 metadata entries");
      return array(parse, max)(input);
    };
  const text: Parser = (input) => {
    if (typeof input !== "string" || input.length > 65536)
      invalid("text exceeds 65536 characters or is malformed");
    textBytes += new TextEncoder().encode(input).byteLength;
    if (textBytes > DISCOVERY_HISTORY_MAX_BYTES)
      invalid("snapshot exceeds 20 MiB");
    return input;
  };
  const dictionary =
    (parse: Parser): Parser =>
    (input) => {
      const entries = Object.entries(object(input));
      if (entries.length > 256) invalid("too many protocol entries");
      return Object.fromEntries(
        entries.map(([key, val]) => [text(key), parse(val)]),
      );
    };
  const service = shape({
    port,
    protocol: text,
    service: text,
    version: optional(text),
    banner: optional(text),
    product: optional(text),
    detection: optional(choice("identified", "port-hint", "unknown")),
    evidence: optional(text),
    identificationError: optional(text),
  });
  const host = shape({
    ip: text,
    hostname: optional(text),
    openPorts: boundedArray(port, 65535),
    services: boundedArray(service, 65535),
    responseTime: number,
    macAddress: optional(text),
    reachability: optional(
      choice("responsive", "unresponsive", "unavailable", "not-checked"),
    ),
    discoveryProbes: optional(
      boundedArray(
        shape({
          method: choice(...DISCOVERY_PROBE_METHODS),
          status: choice("responsive", "unresponsive", "unavailable"),
          elapsedMs: number,
          error: optional(text),
        }),
        7,
      ),
    ),
  });
  const config = shape({
    enabled: boolean,
    identifyServices: optional(boolean),
    hostDiscoveryEnabled: optional(boolean),
    serviceScanEnabled: optional(boolean),
    pauseOnHighLoad: optional(boolean),
    pingMethod: optional(choice(...DISCOVERY_PING_METHODS)),
    pingMethods: optional((value) => {
      if (!isDiscoveryProbeMethods(value))
        invalid("invalid discovery method selection");
      return [...value];
    }),
    pingTimeout: optional(number),
    pingPort: optional(port),
    pingUdpPort: optional(port),
    scanUnresponsiveHosts: optional(boolean),
    adaptiveConcurrency: optional(boolean),
    nativeBatchProbes: optional(boolean),
    absoluteMaxProbes: optional(number),
    maxCpuPercent: optional(number),
    maxNetworkUtilizationPercent: optional(number),
    workerLaunchIntervalMs: optional(number),
    probeLaunchIntervalMs: optional(number),
    resolveHostnames: optional(boolean),
    ipRange: text,
    portRanges: boundedArray(text, 65535),
    protocols: boundedArray(text, 256),
    timeout: number,
    maxConcurrent: number,
    maxPortConcurrent: number,
    customPorts: dictionary(boundedArray(port, 65535)),
    probeStrategies: dictionary(
      boundedArray(choice("websocket", "http", "rfb"), 3),
    ),
    cacheTTL: number,
    hostnameTtl: number,
    macTtl: number,
  });
  const scan = shape({
    id: text,
    name: optional(normalizeDiscoveryScanName),
    startedAt: number,
    elapsedMs: number,
    outcome: choice("complete", "stopped", "failed"),
    config,
    hosts: boundedArray(host, DISCOVERY_HISTORY_MAX_HOSTS),
  })(value) as SavedDiscoveryScan;
  if (!scan.id || scan.id.length > 256)
    invalid("scan ID must contain 1–256 characters");
  if (size(scan) > DISCOVERY_HISTORY_MAX_BYTES)
    invalid("snapshot exceeds 20 MiB");
  return scan;
}
const size = (scan: SavedDiscoveryScan) =>
  new TextEncoder().encode(JSON.stringify(scan)).byteLength;
const newestFirst = (a: SavedDiscoveryScan, b: SavedDiscoveryScan) =>
  b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Same deterministic whole-snapshot retention for persistent and session history. */
export function retainDiscoveryScans(
  scans: SavedDiscoveryScan[],
): SavedDiscoveryScan[] {
  const sorted = [...scans].sort(newestFirst);
  let bytes = 0;
  const kept: SavedDiscoveryScan[] = [];
  for (const scan of sorted) {
    bytes += size(scan);
    if (
      kept.length === DISCOVERY_HISTORY_LIMIT ||
      bytes > DISCOVERY_HISTORY_MAX_BYTES
    )
      break;
    kept.push(scan);
  }
  return kept;
}

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(
        new Error("IndexedDB unavailable; discovery history is not persisted."),
      );
    const request = indexedDB.open(DB_NAME, 1);
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      reject(new Error("Opening discovery history timed out."));
    }, 5000);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "scan.id" });
    request.onblocked = () => {
      failed = true;
      clearTimeout(timer);
      reject(new Error("Discovery history is blocked by another window."));
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error("Cannot open discovery history."));
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  apply: (
    store: IDBObjectStore,
    done: (result: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await openHistory();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure ??
            tx.error ??
            new Error("Discovery history transaction aborted."),
        );
      const fail = (error: unknown) => {
        failure = error;
        tx.abort();
      };
      try {
        apply(
          tx.objectStore(STORE),
          (value) => {
            result = value;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  } finally {
    db.close();
  }
}

function readScans(
  store: IDBObjectStore,
  done: (scans: SavedDiscoveryScan[]) => void,
  fail: (error: unknown) => void,
) {
  const scans: SavedDiscoveryScan[] = [];
  let bytes = 0;
  const request = store.openCursor();
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (!cursor) {
        done(scans.sort(newestFirst));
        return;
      }
      if (scans.length >= DISCOVERY_HISTORY_LIMIT)
        invalid("stored history exceeds 20 scans; clear history to recover");
      const record = object(cursor.value);
      if (record.version !== 1)
        invalid("unsupported stored schema; clear history to recover");
      const scan = normalizeDiscoveryScan(record.scan);
      if (cursor.primaryKey !== scan.id)
        invalid("stored scan ID does not match its key");
      bytes += size(scan);
      if (bytes > DISCOVERY_HISTORY_MAX_BYTES)
        invalid("stored history exceeds 20 MiB; clear history to recover");
      scans.push(scan);
      cursor.continue();
    } catch (error) {
      fail(error);
    }
  };
}

export async function listDiscoveryScans(): Promise<SavedDiscoveryScan[]> {
  return transact("readonly", (store, done, fail) =>
    readScans(store, done, fail),
  );
}

/** Call only with a terminal snapshot; no scan-progress subscriptions or autosaves. */
export async function saveDiscoveryScan(
  input: SavedDiscoveryScan,
): Promise<void> {
  const scan = normalizeDiscoveryScan(input);
  await transact<void>("readwrite", (store, done, fail) => {
    readScans(
      store,
      (existing) => {
        // Retrying the original terminal snapshot must not erase a later rename.
        const previousName = existing.find((item) => item.id === scan.id)?.name;
        if (scan.name === undefined && previousName !== undefined)
          scan.name = previousName;
        const retained = retainDiscoveryScans([
          ...existing.filter((item) => item.id !== scan.id),
          scan,
        ]);
        if (!retained.some((item) => item.id === scan.id))
          invalid("snapshot is older than the retained history");
        const ids = new Set(retained.map((item) => item.id));
        for (const old of existing) if (!ids.has(old.id)) store.delete(old.id);
        store.put({ version: 1, scan });
        done();
      },
      fail,
    );
  });
}

/** Rename only a still-existing record, in the same transaction that reads it.
 * Never recreate a deleted entry or overwrite newer results from another window. */
export async function renameDiscoveryScan(
  id: string,
  input: string,
): Promise<SavedDiscoveryScan> {
  const name = normalizeDiscoveryScanName(input);
  return transact("readwrite", (store, done, fail) => {
    readScans(
      store,
      (existing) => {
        const previous = existing.find((scan) => scan.id === id);
        if (!previous) {
          fail(
            new Error(
              "This saved scan no longer exists. Reload history before editing it.",
            ),
          );
          return;
        }
        const scan = { ...previous, name };
        const bytes = existing.reduce(
          (total, item) => total + size(item.id === id ? scan : item),
          0,
        );
        if (bytes > DISCOVERY_HISTORY_MAX_BYTES) {
          fail(
            new Error(
              "The renamed history would exceed 20 MiB. Shorten the name or delete an older scan.",
            ),
          );
          return;
        }
        store.put({ version: 1, scan });
        done(scan);
      },
      fail,
    );
  });
}

export async function deleteDiscoveryScan(id: string): Promise<void> {
  await transact<void>("readwrite", (store, done) => {
    store.delete(id);
    done();
  });
}

export async function clearDiscoveryScans(): Promise<void> {
  await transact<void>("readwrite", (store, done) => {
    store.clear();
    done();
  });
}
