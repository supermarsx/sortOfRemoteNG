// Bounded in-memory history for server stats sparklines. Fed by the existing
// SSH polling; nothing is persisted and nothing is synthesised.

import type { ServerStatsSnapshot } from "../../types/monitoring/serverStats";
import { isNum } from "./serverStatsFormat";

export class RingBuffer<T> {
  private buf: T[];
  private start = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.buf = new Array<T>(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(item: T): void {
    if (this.size < this.capacity) {
      this.buf[(this.start + this.size) % this.capacity] = item;
      this.size++;
    } else {
      this.buf[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Oldest to newest. */
  toArray(): T[] {
    const out: T[] = new Array(this.size);
    for (let i = 0; i < this.size; i++)
      out[i] = this.buf[(this.start + i) % this.capacity];
    return out;
  }

  last(): T | undefined {
    return this.size === 0
      ? undefined
      : this.buf[(this.start + this.size - 1) % this.capacity];
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }
}

export const METRIC_KEYS = [
  "cpu",
  "mem",
  "swap",
  "disk",
  "load1",
  "conns",
  "diskRead",
  "diskWrite",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricValues = Record<MetricKey, number | null>;

export const HISTORY_CAPACITY = 60;

/** Pure: reduce a snapshot to the numeric metrics the collectors supplied. */
export function extractMetrics(
  snap: ServerStatsSnapshot,
  prev?: { io: { read: number; write: number } | null; at: number } | null,
  atMs?: number,
): { values: MetricValues; io: { read: number; write: number } | null } {
  const num = (v: unknown) => (isNum(v) ? v : null);
  const parts = snap.disk?.partitions ?? [];
  const diskPcts = parts.map((p) => p.usagePercent).filter(isNum);
  const io =
    snap.disk?.io &&
    isNum(snap.disk.io.readBytes) &&
    isNum(snap.disk.io.writeBytes)
      ? { read: snap.disk.io.readBytes, write: snap.disk.io.writeBytes }
      : null;
  let diskRead: number | null = null;
  let diskWrite: number | null = null;
  if (io && prev?.io && isNum(atMs) && atMs > prev.at) {
    const dt = (atMs - prev.at) / 1000;
    // Counter reset (reboot) => no rate rather than a negative one.
    if (io.read >= prev.io.read) diskRead = (io.read - prev.io.read) / dt;
    if (io.write >= prev.io.write) diskWrite = (io.write - prev.io.write) / dt;
  }
  return {
    io,
    values: {
      cpu: num(snap.cpu?.usagePercent),
      mem: num(snap.memory?.usagePercent),
      swap:
        snap.memory && snap.memory.swapTotalBytes > 0
          ? num(snap.memory.swapUsagePercent)
          : null,
      disk: diskPcts.length ? Math.max(...diskPcts) : null,
      load1: num(snap.cpu?.loadAvg1),
      conns: num(snap.ports?.establishedConnections),
      diskRead,
      diskWrite,
    },
  };
}

export interface ServerStatsEntry {
  sessionId: string;
  /** Monotonic per-entry revision; changes whenever the entry is replaced. */
  rev: number;
  /** Epoch ms of the last successful sample (null if none yet). */
  sampledAt: number | null;
  hostname: string | null;
  osName: string | null;
  uptimeSeconds: number | null;
  latest: MetricValues;
  series: Record<MetricKey, Array<number | null>>;
  snapshot: ServerStatsSnapshot | null;
  error: string | null;
}

interface Internal {
  rings: Record<MetricKey, RingBuffer<number | null>>;
  io: { read: number; write: number } | null;
  ioAt: number;
  entry: ServerStatsEntry;
}

const emptyValues = (): MetricValues =>
  Object.fromEntries(METRIC_KEYS.map((k) => [k, null])) as MetricValues;

export class ServerStatsHistoryStore {
  private items = new Map<string, Internal>();
  private listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cached: ReadonlyMap<string, ServerStatsEntry> = new Map();

  constructor(
    private capacity = HISTORY_CAPACITY,
    /** Notification coalescing window; many servers => one render. */
    private flushMs = 200,
  ) {}

  private ensure(sessionId: string): Internal {
    let it = this.items.get(sessionId);
    if (!it) {
      const rings = Object.fromEntries(
        METRIC_KEYS.map((k) => [
          k,
          new RingBuffer<number | null>(this.capacity),
        ]),
      ) as Record<MetricKey, RingBuffer<number | null>>;
      it = {
        rings,
        io: null,
        ioAt: 0,
        entry: {
          sessionId,
          rev: 0,
          sampledAt: null,
          hostname: null,
          osName: null,
          uptimeSeconds: null,
          latest: emptyValues(),
          series: Object.fromEntries(
            METRIC_KEYS.map((k) => [k, []]),
          ) as unknown as ServerStatsEntry["series"],
          snapshot: null,
          error: null,
        },
      };
      this.items.set(sessionId, it);
    }
    return it;
  }

  record(
    sessionId: string,
    snap: ServerStatsSnapshot,
    atMs: number = Date.now(),
  ): void {
    const it = this.ensure(sessionId);
    const { values, io } = extractMetrics(
      snap,
      { io: it.io, at: it.ioAt },
      atMs,
    );
    it.io = io;
    it.ioAt = atMs;
    for (const k of METRIC_KEYS) it.rings[k].push(values[k]);
    this.commit(it, {
      sampledAt: atMs,
      hostname: snap.system?.hostname || null,
      osName: snap.system?.osName || null,
      uptimeSeconds: isNum(snap.system?.uptimeSeconds)
        ? snap.system.uptimeSeconds
        : null,
      latest: values,
      snapshot: snap,
      error: null,
    });
  }

  recordError(sessionId: string, message: string): void {
    const it = this.ensure(sessionId);
    this.commit(it, { error: message });
  }

  remove(sessionId: string): void {
    if (this.items.delete(sessionId)) this.schedule();
  }

  clear(): void {
    this.items.clear();
    this.schedule();
  }

  private commit(it: Internal, patch: Partial<ServerStatsEntry>): void {
    const series = Object.fromEntries(
      METRIC_KEYS.map((k) => [k, it.rings[k].toArray()]),
    ) as ServerStatsEntry["series"];
    it.entry = { ...it.entry, ...patch, series, rev: it.entry.rev + 1 };
    this.schedule();
  }

  private schedule(): void {
    this.version++;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.cached = new Map([...this.items].map(([id, v]) => [id, v.entry]));
      this.listeners.forEach((l) => l());
    }, this.flushMs);
  }

  /** Synchronously publish pending changes (tests, unmount). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cached = new Map([...this.items].map(([id, v]) => [id, v.entry]));
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Stable between flushes: safe for useSyncExternalStore. */
  getSnapshot = (): ReadonlyMap<string, ServerStatsEntry> => this.cached;

  get(sessionId: string): ServerStatsEntry | undefined {
    return this.items.get(sessionId)?.entry;
  }
}

export const serverStatsHistory = new ServerStatsHistoryStore();
