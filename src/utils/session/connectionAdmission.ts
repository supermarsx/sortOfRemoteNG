import { invoke } from "@tauri-apps/api/core";

export type ConnectionAdmissionMode = "automatic" | "fixed";
export interface AdmissionSettings {
  connectionAdmissionMode?: ConnectionAdmissionMode;
  maxConcurrentConnections?: number;
}
export interface AdmissionSession {
  id: string;
  protocol: string;
  status?: string;
  startTime?: Date | string;
}
interface MemorySample {
  total_bytes: number;
  available_bytes: number;
}
interface Context {
  settings: AdmissionSettings;
  sessions: readonly AdmissionSession[];
}
const MIB = 1024 * 1024;
const FRESH_MS = 1000;
const PROBE_MS = 2000;
export const MEMORY_UNAVAILABLE =
  "Available system memory could not be checked. Try again, or choose a fixed connection limit in Performance settings.";
export const MEMORY_PRESSURE =
  "There is not enough available system memory to safely open another connection. Close an unused connection or another application, then try again.";

export function normalizeConnectionAdmissionSettings(
  settings: AdmissionSettings,
): Required<AdmissionSettings> {
  const count =
    typeof settings.maxConcurrentConnections === "number" &&
    Number.isSafeInteger(settings.maxConcurrentConnections)
      ? Math.max(0, settings.maxConcurrentConnections)
      : 10;
  // Unmarked default10 was persisted by older versions. A newly selected
  // fixed10 has an explicit marker and remains a deliberate limit.
  const mode =
    settings.connectionAdmissionMode === "automatic"
      ? "automatic"
      : settings.connectionAdmissionMode === "fixed" ||
          settings.connectionAdmissionMode !== undefined ||
          count !== 10
        ? "fixed"
        : "automatic";
  return { connectionAdmissionMode: mode, maxConcurrentConnections: count };
}

export function connectionMemoryEstimate(protocol: string): number {
  return (
    (protocol === "ssh"
      ? 64
      : protocol === "http" || protocol === "https"
        ? 512
        : protocol === "rdp"
          ? 256
          : 128) * MIB
  );
}

function validSample(value: unknown): MemorySample | null {
  if (!value || typeof value !== "object") return null;
  const sample = value as Partial<MemorySample>;
  return Number.isSafeInteger(sample.total_bytes) &&
    Number.isSafeInteger(sample.available_bytes) &&
    sample.total_bytes! > 0 &&
    sample.available_bytes! >= 0 &&
    sample.available_bytes! <= sample.total_bytes!
    ? (sample as MemorySample)
    : null;
}

/** Shared across managers in this renderer realm, not across native windows.
 * Estimates cover pending/unreflected openings, not established-session count.
 * They are not a hard cap on real process RAM. */
export class ConnectionAdmission {
  private sample: {
    value: MemorySample;
    at: number;
    startedAt: number;
  } | null = null;
  private probe: Promise<MemorySample | null> | null = null;
  private pending = new Map<
    symbol,
    { owner: symbol; bytes: number; sessionId?: string }
  >();
  constructor(
    private readonly read: () => Promise<unknown>,
    private readonly now = () => Date.now(),
  ) {}

  private fresh(): MemorySample | null {
    return this.sample &&
      this.now() >= this.sample.at &&
      this.now() - this.sample.at <= FRESH_MS
      ? this.sample.value
      : null;
  }
  async warm(): Promise<MemorySample | null> {
    const cached = this.fresh();
    if (cached) return cached;
    if (!this.probe) {
      const started = this.now();
      const probe = Promise.resolve()
        .then(this.read)
        .then(validSample, () => null);
      this.probe = probe;
      void probe.then((value) => {
        if (this.probe !== probe) return;
        this.probe = null;
        this.sample =
          value && this.now() - started <= PROBE_MS
            ? { value, at: this.now(), startedAt: started }
            : null;
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.probe,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), PROBE_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  reconcile(owner: symbol, sessions: readonly AdmissionSession[]): void {
    const ids = new Set(sessions.map(({ id }) => id));
    for (const [token, entry] of this.pending) {
      if (entry.owner === owner && entry.sessionId && ids.has(entry.sessionId))
        this.pending.delete(token);
    }
  }
  releaseOwner(owner: symbol): void {
    for (const [token, entry] of this.pending)
      if (entry.owner === owner) this.pending.delete(token);
  }
  releaseSession(sessionId: string): void {
    for (const [token, entry] of this.pending)
      if (entry.sessionId === sessionId) this.pending.delete(token);
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  private check(context: Context, bytes: number, except?: symbol): void {
    const visible = new Set(context.sessions.map(({ id }) => id));
    const pending = [...this.pending].filter(
      ([token, entry]) =>
        token !== except && (!entry.sessionId || !visible.has(entry.sessionId)),
    );
    const settings = context.settings;
    // Runtime snapshots are normalized on load. Missing mode here is an old
    // in-memory caller and conservatively retains its explicit numeric policy.
    if (settings.connectionAdmissionMode !== "automatic") {
      const limit = Number.isSafeInteger(settings.maxConcurrentConnections)
        ? Math.max(0, settings.maxConcurrentConnections!)
        : 0;
      if (context.sessions.length + pending.length >= limit)
        throw new Error(`Maximum concurrent connections (${limit}) reached.`);
      return;
    }
    const memory = this.fresh();
    if (!memory) throw new Error(MEMORY_UNAVAILABLE);
    const reserve = Math.max(1024 * MIB, Math.ceil(memory.total_bytes * 0.1));
    const estimates = context.sessions.reduce((sum, session) => {
      const began = session.startTime
        ? new Date(session.startTime).getTime()
        : NaN;
      const pending =
        session.status === "connecting" || session.status === "reconnecting";
      const unreflected =
        Number.isFinite(began) &&
        began >= this.sample!.startedAt &&
        began <= this.now();
      return (
        sum +
        (pending || unreflected
          ? connectionMemoryEstimate(session.protocol)
          : 0)
      );
    }, 0);
    const reserved = pending.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    if (memory.available_bytes - reserve - estimates - reserved < bytes)
      throw new Error(MEMORY_PRESSURE);
  }
  async acquire(
    owner: symbol,
    protocol: string,
    current: () => Context,
    assertCurrent?: () => void,
  ) {
    if (current().settings.connectionAdmissionMode === "automatic")
      await this.warm();
    assertCurrent?.();
    const token = Symbol("connection-admission");
    const bytes = connectionMemoryEstimate(protocol);
    this.check(current(), bytes);
    this.pending.set(token, { owner, bytes });
    let committed = false;
    return {
      revalidate: () => {
        assertCurrent?.();
        if (!this.pending.has(token))
          throw new Error("Connection opening was cancelled.");
        this.check(current(), bytes, token);
      },
      commit: (sessionId: string) => {
        const entry = this.pending.get(token);
        if (!entry) throw new Error("Connection opening was cancelled.");
        entry.sessionId = sessionId;
        committed = true;
      },
      release: () => {
        if (!committed) this.pending.delete(token);
      },
      abort: () => {
        this.pending.delete(token);
      },
    };
  }
}

export const connectionAdmission = new ConnectionAdmission(() =>
  invoke("get_system_memory_info"),
);
