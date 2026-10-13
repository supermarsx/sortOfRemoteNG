import type { TauriInvoke } from "../../src/utils/tauri/invoke";
import type {
  ScriptTrustEntry,
  ScriptTrustRecord,
} from "../../src/utils/recording/scriptRunTrust";

/**
 * An in-memory stand-in for the two native commands behind the app-data store
 * (`read_app_data`, `compare_and_swap_app_data`), for the suites that exercise
 * the record of trusted scripts. It holds synthetic data only and never
 * reaches the real profile.
 *
 * The store finds its backend through `getInvoke()`, which looks at
 * `globalThis.__TAURI__.core.invoke` first: `install()` puts this backend
 * there, so a suite needs no module mock for it (a suite that also stubs
 * that global must undo its stub before `uninstall()`). A suite that already mocks
 * `invoke` can hand the two commands to `backend.invoke` instead
 * (`backend.handles(command)` says which).
 */

/** Spelled out on purpose: the suites pin the literal key. */
export const SCRIPT_TRUST_TEST_KEY = "automation.run-trust.v1";

type AppDataCommand = "read_app_data" | "compare_and_swap_app_data";
type Operation = "read" | "write";

export interface ScriptTrustBackendCall {
  command: AppDataCommand;
  key: string;
  /** Only for a write: whether the swap was applied. */
  committed?: boolean;
}

export interface ScriptTrustTestBackend {
  /** The two commands. Anything else throws. */
  readonly invoke: TauriInvoke;
  handles(command: string): boolean;
  /** Makes `getInvoke()` return this backend; the returned function undoes it. */
  install(): () => void;
  /** As outside the desktop app: `getInvoke()` finds no backend. */
  uninstall(): void;

  /** The stored text, or null when the key is absent. */
  raw(key?: string): string | null;
  /** Writes behind the store's back, as another window or a damaged file would. */
  setRaw(value: string | null, key?: string): void;
  /** `setRaw(JSON.stringify(value))`. */
  seed(value: unknown, key?: string): void;
  /** The stored value, parsed. Throws when it is absent or not JSON. */
  stored(key?: string): ScriptTrustRecord;

  /** Every call so far, in order. */
  readonly calls: readonly ScriptTrustBackendCall[];
  reads(key?: string): number;
  /** Swap attempts, applied or refused. */
  writes(key?: string): number;
  /** Swaps that were applied. */
  commits(key?: string): number;

  /** Calls of this kind wait until the returned function is called. */
  stall(operation: Operation): () => void;
  /** The next `times` calls of this kind reject (all of them by default). */
  reject(operation: Operation, times?: number): void;
  /** Reads answer with this value, of any type, instead of the stored text. */
  answerReads(value: unknown): void;
  /** The next `times` swaps report a lost race and change nothing (all by default). */
  loseWrites(times?: number): void;
  /** Runs once, after the next read has taken its value and before it returns it. */
  afterNextRead(hook: () => void | Promise<void>): void;
  /** Runs once, before the next swap compares: a write here makes that swap lose. */
  beforeNextWrite(hook: () => void | Promise<void>): void;
  /** Clears every fault and hook; the stored data stays. */
  heal(): void;
}

export function createScriptTrustTestBackend(): ScriptTrustTestBackend {
  const disk = new Map<string, string>();
  const calls: ScriptTrustBackendCall[] = [];
  const stalls: Record<Operation, Promise<void> | null> = {
    read: null,
    write: null,
  };
  const rejections: Record<Operation, number> = { read: 0, write: 0 };
  let readAnswer: { value: unknown } | null = null;
  let lostWrites = 0;
  let readHook: (() => void | Promise<void>) | null = null;
  let writeHook: (() => void | Promise<void>) | null = null;
  let installed = false;
  let previousGlobal: unknown;

  const gate = async (operation: Operation) => {
    const stalled = stalls[operation];
    if (stalled) await stalled;
    if (rejections[operation] > 0) {
      rejections[operation] -= 1;
      throw new Error("Storage is locked.");
    }
  };

  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    const key = String(args?.key);
    if (command === "read_app_data") {
      calls.push({ command, key });
      await gate("read");
      const value = readAnswer ? readAnswer.value : (disk.get(key) ?? null);
      const hook = readHook;
      readHook = null;
      if (hook) await hook();
      return value;
    }
    if (command === "compare_and_swap_app_data") {
      const call: ScriptTrustBackendCall = { command, key };
      calls.push(call);
      await gate("write");
      const hook = writeHook;
      writeHook = null;
      if (hook) await hook();
      const expected = (args?.expected ?? null) as string | null;
      const lost = lostWrites > 0;
      if (lost) lostWrites -= 1;
      if (lost || (disk.get(key) ?? null) !== expected) {
        call.committed = false;
        return false;
      }
      disk.set(key, String(args?.replacement));
      call.committed = true;
      return true;
    }
    throw new Error(`Unexpected command: ${command}`);
  }) as TauriInvoke;

  const count = (
    command: AppDataCommand,
    key: string,
    committedOnly = false,
  ): number =>
    calls.filter(
      (call) =>
        call.command === command &&
        call.key === key &&
        (!committedOnly || call.committed === true),
    ).length;

  const backend: ScriptTrustTestBackend = {
    invoke,
    handles: (command) =>
      command === "read_app_data" || command === "compare_and_swap_app_data",
    install() {
      const scope = globalThis as { __TAURI__?: unknown };
      if (!installed) previousGlobal = scope.__TAURI__;
      installed = true;
      scope.__TAURI__ = { core: { invoke } };
      return () => backend.uninstall();
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      const scope = globalThis as { __TAURI__?: unknown };
      if (previousGlobal === undefined) delete scope.__TAURI__;
      else scope.__TAURI__ = previousGlobal;
    },
    raw: (key = SCRIPT_TRUST_TEST_KEY) => disk.get(key) ?? null,
    setRaw(value, key = SCRIPT_TRUST_TEST_KEY) {
      if (value === null) disk.delete(key);
      else disk.set(key, value);
    },
    seed(value, key = SCRIPT_TRUST_TEST_KEY) {
      disk.set(key, JSON.stringify(value));
    },
    stored(key = SCRIPT_TRUST_TEST_KEY) {
      const raw = disk.get(key);
      if (raw === undefined) throw new Error("Nothing is stored.");
      return JSON.parse(raw) as ScriptTrustRecord;
    },
    calls,
    reads: (key = SCRIPT_TRUST_TEST_KEY) => count("read_app_data", key),
    writes: (key = SCRIPT_TRUST_TEST_KEY) =>
      count("compare_and_swap_app_data", key),
    commits: (key = SCRIPT_TRUST_TEST_KEY) =>
      count("compare_and_swap_app_data", key, true),
    stall(operation) {
      let release!: () => void;
      const stalled = new Promise<void>((resolve) => {
        release = resolve;
      });
      stalls[operation] = stalled;
      return () => {
        if (stalls[operation] === stalled) stalls[operation] = null;
        release();
      };
    },
    reject(operation, times = Number.POSITIVE_INFINITY) {
      rejections[operation] = times;
    },
    answerReads(value) {
      readAnswer = { value };
    },
    loseWrites(times = Number.POSITIVE_INFINITY) {
      lostWrites = times;
    },
    afterNextRead(hook) {
      readHook = hook;
    },
    beforeNextWrite(hook) {
      writeHook = hook;
    },
    heal() {
      stalls.read = null;
      stalls.write = null;
      rejections.read = 0;
      rejections.write = 0;
      readAnswer = null;
      lostWrites = 0;
      readHook = null;
      writeHook = null;
    },
  };
  return backend;
}

// ─── The cross-window event ─────────────────────────────────────

export const SCRIPT_TRUST_TEST_EVENT = "sorng-run-trust-changed";

export interface ScriptTrustTestEventBus {
  /** Every payload emitted so far, with the event name it was emitted under. */
  readonly emitted: readonly { event: string; payload: unknown }[];
  /** How many listeners are registered right now. */
  listeners(): number;
  /** One window's view of the bus, in the shape the store's `events` option takes. */
  runtime(): {
    emit(payload: { revision: number }): Promise<void>;
    listen(handler: () => void): Promise<() => void>;
  };
  /** The shape of `@tauri-apps/api/event`, for `vi.mock`. */
  module(): {
    emit(event: string, payload?: unknown): Promise<void>;
    listen(
      event: string,
      handler: (event: { event: string; payload: unknown }) => void,
    ): Promise<() => void>;
  };
  /** Delivers the event as another process would: no window event comes with it. */
  deliver(event?: string, payload?: unknown): void;
  /** `emit` and `listen` reject, as they do outside the desktop app. */
  fail(failing?: boolean): void;
  reset(): void;
}

/** A Tauri event bus shared by every "window" a suite creates. */
export function createScriptTrustEventBus(): ScriptTrustTestEventBus {
  const emitted: { event: string; payload: unknown }[] = [];
  const handlers = new Set<{
    event: string;
    handler: (event: { event: string; payload: unknown }) => void;
  }>();
  let failing = false;

  const deliver = (event: string, payload: unknown) => {
    for (const entry of Array.from(handlers))
      if (entry.event === event) entry.handler({ event, payload });
  };
  const emit = async (event: string, payload?: unknown) => {
    if (failing) throw new Error("No event bridge.");
    emitted.push({ event, payload });
    deliver(event, payload);
  };
  const listen = async (
    event: string,
    handler: (event: { event: string; payload: unknown }) => void,
  ) => {
    if (failing) throw new Error("No event bridge.");
    const entry = { event, handler };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  };

  return {
    emitted,
    listeners: () => handlers.size,
    runtime: () => ({
      emit: (payload) => emit(SCRIPT_TRUST_TEST_EVENT, payload),
      listen: (handler) => listen(SCRIPT_TRUST_TEST_EVENT, () => handler()),
    }),
    module: () => ({ emit, listen }),
    deliver: (event = SCRIPT_TRUST_TEST_EVENT, payload = { revision: 0 }) =>
      deliver(event, payload),
    fail(value = true) {
      failing = value;
    },
    reset() {
      emitted.length = 0;
      handlers.clear();
      failing = false;
    },
  };
}

// ─── Synthetic data ─────────────────────────────────────────────

/** A well-formed digest that is the digest of nothing in particular. */
export const fakeDigest = (seed: number | string): string => {
  const text = String(seed);
  let hex = "";
  for (let index = 0; hex.length < 64; index += 1)
    hex += (text.charCodeAt(index % text.length) + index)
      .toString(16)
      .padStart(2, "0");
  return `sha256:${hex.slice(0, 64)}`;
};

export const TRUST_TEST_TIME = "2026-10-13T09:30:00.000Z";

/** A valid "everywhere" entry; `overrides` replace whole fields. */
export function trustEntry(
  overrides: Partial<ScriptTrustEntry> = {},
): ScriptTrustEntry {
  return {
    kind: "ssh-script",
    library: { kind: "app" },
    subjectId: "script-1",
    contentDigest: fakeDigest("content-1"),
    scope: "everywhere",
    risk: "standard",
    grantedAt: TRUST_TEST_TIME,
    ...overrides,
  };
}

/** A valid "connection" entry bound to `db-1` / `conn-1`. */
export function connectionTrustEntry(
  overrides: Partial<ScriptTrustEntry> = {},
): ScriptTrustEntry {
  return trustEntry({
    scope: "connection",
    connection: {
      databaseId: "db-1",
      connectionId: "conn-1",
      endpointDigest: fakeDigest("endpoint-1"),
    },
    ...overrides,
  });
}

/** Text that must never reach the record, a log, a toast or an error. */
export const SENTINELS = {
  script: "SENTINEL-SCRIPT-TEXT rm -rf /srv/zz-sentinel",
  step: "SENTINEL-STEP-TEXT systemctl stop zz-sentinel",
  name: "SENTINEL-NAME Nightly cleanup",
  host: "sentinel-host.zz.example",
  user: "sentinel-user-zz",
  domain: "SENTINELDOMAIN",
  credential: "sentinel-credential-id-zz",
} as const;

export const containsSentinel = (text: string): boolean =>
  Object.values(SENTINELS).some((value) => text.includes(value)) ||
  /sentinel/i.test(text);

/**
 * One bus for a suite that mocks `@tauri-apps/api/event`:
 * `vi.mock("@tauri-apps/api/event", async () =>
 *   (await import("./scriptTrustTestBackend")).scriptTrustTauriEvents.module())`.
 */
export const scriptTrustTauriEvents = createScriptTrustEventBus();
