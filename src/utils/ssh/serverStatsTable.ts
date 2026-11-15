// Row building, sorting, filtering and grouping for the aggregate view.

import type { ServerStatsEntry, MetricKey } from "./serverStatsHistory";
import { isNum } from "./serverStatsFormat";

export type RowStatus =
  "online" | "stale" | "error" | "pending" | "disconnected";

export interface AggregateRow {
  sessionId: string;
  name: string;
  host: string;
  folder: string | null;
  tags: string[];
  status: RowStatus;
  entry: ServerStatsEntry | null;
}

export type SortKey =
  | "name"
  | "status"
  | "cpu"
  | "mem"
  | "swap"
  | "disk"
  | "load1"
  | "conns"
  | "diskIo"
  | "uptime";
export type SortDir = "asc" | "desc";
export type GroupBy = "none" | "folder" | "tag";

export const STALE_AFTER_MS = 120_000;

export interface SessionLike {
  id: string;
  connectionId?: string;
  name?: string;
  hostname?: string;
  status: string;
}
export interface ConnectionLike {
  id: string;
  name?: string;
  parentId?: string;
  isGroup?: boolean;
  tags?: string[];
}

export function deriveStatus(
  sessionStatus: string,
  entry: ServerStatsEntry | null | undefined,
  now: number,
  staleAfterMs = STALE_AFTER_MS,
): RowStatus {
  if (sessionStatus !== "connected" && sessionStatus !== "connecting")
    return "disconnected";
  if (!entry) return "pending";
  if (entry.error && entry.sampledAt === null) return "error";
  if (entry.sampledAt === null) return "pending";
  if (entry.error) return "error";
  return now - entry.sampledAt > staleAfterMs ? "stale" : "online";
}

export function buildRows(
  sessions: readonly SessionLike[],
  connections: readonly ConnectionLike[],
  entries: ReadonlyMap<string, ServerStatsEntry>,
  now: number,
): AggregateRow[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  return sessions.map((s) => {
    const conn = s.connectionId ? byId.get(s.connectionId) : undefined;
    const parent = conn?.parentId ? byId.get(conn.parentId) : undefined;
    const entry = entries.get(s.id) ?? null;
    return {
      sessionId: s.id,
      name: s.name || s.hostname || s.id,
      host: s.hostname ?? "",
      folder: parent?.isGroup ? (parent.name ?? null) : null,
      tags: conn?.tags ?? [],
      status: deriveStatus(s.status, entry, now),
      entry,
    };
  });
}

const STATUS_ORDER: Record<RowStatus, number> = {
  error: 0,
  stale: 1,
  disconnected: 2,
  pending: 3,
  online: 4,
};

export function sortValue(
  row: AggregateRow,
  key: SortKey,
): number | string | null {
  const l = row.entry?.latest;
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "status":
      return STATUS_ORDER[row.status];
    case "uptime":
      return row.entry?.uptimeSeconds ?? null;
    case "diskIo": {
      const a = l?.diskRead;
      const b = l?.diskWrite;
      return isNum(a) || isNum(b)
        ? (isNum(a) ? a : 0) + (isNum(b) ? b : 0)
        : null;
    }
    default:
      return l ? (l[key as MetricKey] ?? null) : null;
  }
}

/** Stable sort; rows with no value for the key always sink to the bottom. */
export function sortRows(
  rows: readonly AggregateRow[],
  key: SortKey,
  dir: SortDir,
): AggregateRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, key) }))
    .sort((a, b) => {
      const am =
        a.v === null || (typeof a.v === "number" && !Number.isFinite(a.v));
      const bm =
        b.v === null || (typeof b.v === "number" && !Number.isFinite(b.v));
      if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
      const c =
        typeof a.v === "string" && typeof b.v === "string"
          ? a.v.localeCompare(b.v)
          : (a.v as number) - (b.v as number);
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.row);
}

export function filterRows(
  rows: readonly AggregateRow[],
  query: string,
): AggregateRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.slice();
  return rows.filter((r) =>
    [
      r.name,
      r.host,
      r.folder ?? "",
      r.entry?.hostname ?? "",
      r.entry?.osName ?? "",
      r.status,
      ...r.tags,
    ]
      .join("\u0000")
      .toLowerCase()
      .includes(q),
  );
}

export interface RowGroup {
  key: string;
  label: string | null;
  rows: AggregateRow[];
}

/** Rows keep their incoming order inside groups; ungrouped rows go last. A row with several tags appears under each. */
export function groupRows(
  rows: readonly AggregateRow[],
  by: GroupBy,
): RowGroup[] {
  if (by === "none") return [{ key: "all", label: null, rows: rows.slice() }];
  const map = new Map<string, AggregateRow[]>();
  const none: AggregateRow[] = [];
  for (const r of rows) {
    const keys = by === "folder" ? (r.folder ? [r.folder] : []) : r.tags;
    if (keys.length === 0) none.push(r);
    for (const k of keys) {
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
  }
  const groups: RowGroup[] = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ key: `g:${k}`, label: k, rows: v }));
  if (none.length)
    groups.push({ key: "g:\u0000none", label: null, rows: none });
  return groups;
}
