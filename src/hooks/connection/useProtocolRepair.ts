/**
 * Non-destructive repair of connections that were imported / created with the
 * wrong protocol (t71 D4). Typical case: an HTTPS web UI imported from
 * mRemoteNG as "RDP on port 443".
 *
 * The hook only *computes* suggestions; nothing changes until the user clicks
 * "Fix selected" in `ProtocolRepairDialog`. Rows the user dismisses are stored
 * in `localStorage["sor-protocol-repair-ignored"]` (connection ids).
 */
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  Connection,
  ConnectionProtocol,
} from "../../types/connection/connection";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import {
  suspectMisclassifiedConnection,
  WEB_PORTS,
} from "../../utils/connection/normalizeImportedProtocol";
import { sanitizeHostname } from "../../utils/connection/sanitizeHostname";
import { DEFAULT_PORTS } from "../../utils/discovery/defaultPorts";

export const PROTOCOL_REPAIR_IGNORED_KEY = "sor-protocol-repair-ignored";
export const PROTOCOL_REPAIR_NOTIFIED_PREFIX = "sor-protocol-repair-notified:";

/** Fired on `window` whenever the ignore list changes so all hook instances re-read it. */
const IGNORE_CHANGED_EVENT = "sor-protocol-repair-ignored-changed";

export interface ProtocolRepairSuggestion {
  id: string;
  name: string;
  hostname: string;
  port: number;
  currentProtocol: string;
  suggestedProtocol: ConnectionProtocol;
  reason: string;
  /** The exact patch `applyFixes` will dispatch for this row. */
  patch: ProtocolRepairPatch;
}

export interface ProtocolRepairPatch {
  protocol: ConnectionProtocol;
  port: number;
  hostname: string;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readIgnoredIds(): Set<string> {
  const storage = safeStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(PROTOCOL_REPAIR_IGNORED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeIgnoredIds(ids: Iterable<string>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const list = Array.from(new Set(ids));
    if (list.length === 0) storage.removeItem(PROTOCOL_REPAIR_IGNORED_KEY);
    else storage.setItem(PROTOCOL_REPAIR_IGNORED_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore list is a convenience only */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(IGNORE_CHANGED_EVENT));
  }
}

/**
 * Compute the `{protocol, port, hostname}` patch for one connection:
 * - protocol: the suggestion
 * - hostname: scheme/path stripped (`https://x:8443/admin` → `x`)
 * - port: port embedded in the URL, else the existing port if it is an
 *   explicit web port (or any non-default port for a non-web suggestion),
 *   else the suggested protocol's default port.
 */
export function buildRepairPatch(
  connection: Pick<Connection, "protocol" | "hostname" | "port">,
  suggested: ConnectionProtocol,
): ProtocolRepairPatch {
  const sanitized = sanitizeHostname(String(connection.hostname ?? ""));
  const existingPort = Number(connection.port);
  const hasExistingPort = Number.isInteger(existingPort) && existingPort > 0;
  const currentDefault = DEFAULT_PORTS[String(connection.protocol)];
  const suggestedDefault = DEFAULT_PORTS[suggested] ?? existingPort;

  let port: number;
  if (sanitized.port) {
    port = sanitized.port;
  } else if (hasExistingPort && WEB_PORTS[existingPort]) {
    port = existingPort;
  } else if (
    hasExistingPort &&
    existingPort !== currentDefault &&
    existingPort !== 3389
  ) {
    // User-set non-default port: keep it.
    port = existingPort;
  } else {
    port = suggestedDefault;
  }

  return {
    protocol: suggested,
    port,
    hostname: sanitized.hostname || String(connection.hostname ?? ""),
  };
}

/** Pure: list suggestions for the given connections, minus ignored ids. */
export function buildRepairSuggestions(
  connections: readonly Connection[] | undefined,
  ignoredIds: ReadonlySet<string> = new Set(),
): ProtocolRepairSuggestion[] {
  if (!connections) return [];
  const out: ProtocolRepairSuggestion[] = [];
  for (const connection of connections) {
    if (!connection || typeof connection.id !== "string") continue;
    if (ignoredIds.has(connection.id)) continue;
    if (typeof connection.protocol !== "string" || !connection.protocol)
      continue;
    const suspicion = suspectMisclassifiedConnection(connection);
    if (!suspicion) continue;
    if (suspicion.suggested === connection.protocol) continue;
    out.push({
      id: connection.id,
      name: connection.name ?? "",
      hostname: connection.hostname ?? "",
      port: Number(connection.port) || 0,
      currentProtocol: String(connection.protocol),
      suggestedProtocol: suspicion.suggested,
      reason: suspicion.reason,
      patch: buildRepairPatch(connection, suspicion.suggested),
    });
  }
  return out;
}

export interface UseProtocolRepair {
  suggestions: ProtocolRepairSuggestion[];
  ignoredCount: number;
  /** Dispatch UPDATE_CONNECTION for the chosen ids only. Returns the count applied. */
  applyFixes: (ids: readonly string[]) => number;
  ignore: (id: string) => void;
  resetIgnored: () => void;
}

/**
 * Tolerant of rendering outside a `ConnectionProvider` (returns no
 * suggestions) so settings sections and dialogs can be unit-tested in isolation.
 */
export function useProtocolRepair(): UseProtocolRepair {
  const ctx = useContext(ConnectionContext);
  const connections = ctx?.state.connections;
  const dispatch = ctx?.dispatch;

  const [ignored, setIgnored] = useState<Set<string>>(() => readIgnoredIds());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIgnored(readIgnoredIds());
    window.addEventListener(IGNORE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(IGNORE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const suggestions = useMemo(
    () => buildRepairSuggestions(connections, ignored),
    [connections, ignored],
  );

  const applyFixes = useCallback(
    (ids: readonly string[]) => {
      if (!dispatch || !connections) return 0;
      const wanted = new Set(ids);
      let applied = 0;
      for (const suggestion of suggestions) {
        if (!wanted.has(suggestion.id)) continue;
        const original = connections.find((c) => c.id === suggestion.id);
        if (!original) continue;
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...original,
            ...suggestion.patch,
            updatedAt: new Date().toISOString(),
          },
        });
        applied += 1;
      }
      return applied;
    },
    [connections, dispatch, suggestions],
  );

  const ignore = useCallback((id: string) => {
    const next = readIgnoredIds();
    next.add(id);
    writeIgnoredIds(next);
    setIgnored(next);
  }, []);

  const resetIgnored = useCallback(() => {
    writeIgnoredIds([]);
    setIgnored(new Set());
  }, []);

  return {
    suggestions,
    ignoredCount: ignored.size,
    applyFixes,
    ignore,
    resetIgnored,
  };
}

export default useProtocolRepair;
