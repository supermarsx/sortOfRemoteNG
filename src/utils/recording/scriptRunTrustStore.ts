import {
  APP_DATA_STORE_CHANGED_EVENT,
  AppDataJsonStore,
} from "../storage/appDataJsonStore";
import { getInvoke } from "../tauri/invoke";
import {
  MAX_SCRIPT_TRUST_ENTRIES,
  RUN_TRUST_STORE_KEY,
  createScriptTrustEntry,
  emptyScriptTrustRecord,
  evaluateScriptTrust,
  isScriptTrustEntryRef,
  isScriptTrustId,
  isScriptTrustQuery,
  isScriptTrustSubjectRef,
  parseScriptTrustRecord,
  sanitizeScriptTrustRecord,
  scriptTrustEntryKey,
  scriptTrustSubjectKey,
  type ScriptTrustEntry,
  type ScriptTrustEntryRef,
  type ScriptTrustGrant,
  type ScriptTrustQuery,
  type ScriptTrustRecord,
  type ScriptTrustScope,
  type ScriptTrustSubjectRef,
} from "./scriptRunTrust";

/**
 * Reading and writing the record of trusted scripts.
 *
 * Every answer comes from the durable value, read again each time: nothing
 * here keeps a copy to answer "trusted" from, so a revoke in any window is
 * obeyed by the next run in every window. Whatever cannot be read as a whole,
 * valid record within the bound means "ask". A write that does not land is
 * reported to the caller, and a grant that was reported as failed is taken
 * back if it lands after all.
 */

/** Sent to every window after a change. It carries a counter and nothing else. */
export const RUN_TRUST_CHANGED_EVENT = "sorng-run-trust-changed";
/** How long a consult or a write may take before the caller is answered without it. */
export const SCRIPT_TRUST_TIMEOUT_MS = 1500;

export type ScriptTrustFailureReason =
  /** The arguments do not name a complete, well-formed grant or target. */
  | "invalid"
  /** The record holds its maximum number of entries. */
  | "full"
  /** The stored value is damaged or the read was refused. "Revoke all" repairs it. */
  | "unreadable"
  /** Not in the desktop app: there is no durable store. */
  | "unavailable"
  | "timeout"
  /** The write was refused or kept losing to other windows. */
  | "failed";

export interface ScriptTrustFailure {
  ok: false;
  reason: ScriptTrustFailureReason;
}
export type ScriptTrustGrantResult =
  { ok: true; entry: ScriptTrustEntry } | ScriptTrustFailure;
export type ScriptTrustRevokeResult =
  { ok: true; removed: number } | ScriptTrustFailure;

/**
 * `trusted` is true only for a durable entry read just now. `canGrant` says
 * whether a lasting choice can be offered: false whenever the record could
 * not be read, so that nothing is offered that cannot be saved.
 */
export type ScriptTrustConsult =
  | { trusted: true; scope: ScriptTrustScope; canGrant: true }
  | {
      trusted: false;
      scope: null;
      canGrant: boolean;
      reason:
        "not-trusted" | "invalid" | "unreadable" | "unavailable" | "timeout";
    };

/** For lists and marks. A missing record reads as an empty one. */
export type ScriptTrustRecordRead =
  | { status: "ready"; record: ScriptTrustRecord }
  | { status: "unavailable"; reason: "unreadable" | "unavailable" | "timeout" };

/** What the reconciler removes: positive signals only. */
export type ScriptTrustPrune =
  | {
      kind: "connections";
      databaseId: string;
      connectionIds: readonly string[];
    }
  | { kind: "database"; databaseId: string };

export interface ScriptTrustEventRuntime {
  emit(payload: { revision: number }): Promise<void>;
  listen(handler: () => void): Promise<() => void>;
}

export interface ScriptRunTrustStore {
  /** Never throws. One durable read, bounded; anything but a fresh match is "ask". */
  consult(query: ScriptTrustQuery): Promise<ScriptTrustConsult>;
  /** Never throws. The record as it is now, for display only. */
  read(): Promise<ScriptTrustRecordRead>;
  /** Never throws. Call only after a confirmed prompt in which the user chose this. */
  grant(grant: ScriptTrustGrant): Promise<ScriptTrustGrantResult>;
  /** One entry, whatever content it was given for. */
  revoke(entry: ScriptTrustEntryRef): Promise<ScriptTrustRevokeResult>;
  /** Every entry of one script or macro. */
  revokeSubject(
    subject: ScriptTrustSubjectRef,
  ): Promise<ScriptTrustRevokeResult>;
  /** Everything. Also repairs a record that cannot be read. */
  revokeAll(): Promise<ScriptTrustRevokeResult>;
  prune(target: ScriptTrustPrune): Promise<ScriptTrustRevokeResult>;
  /** Called after any change, from this window or another. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface ScriptRunTrustStoreOptions {
  events?: ScriptTrustEventRuntime;
  now?: () => Date;
}

// Native app data only: no legacy key to adopt, no browser fallback, no sync history.
const durableStore = new AppDataJsonStore<ScriptTrustRecord>({
  key: RUN_TRUST_STORE_KEY,
  requireNative: true,
  sanitize: sanitizeScriptTrustRecord,
});

const tauriEvents: ScriptTrustEventRuntime = {
  async emit(payload) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(RUN_TRUST_CHANGED_EVENT, payload);
  },
  async listen(handler) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(RUN_TRUST_CHANGED_EVENT, () => handler());
  },
};

type Durable =
  | { status: "ready"; record: ScriptTrustRecord }
  | { status: "missing" | "unreadable" | "unavailable" };

const TIMED_OUT = Symbol("timed-out");

const startDeadline = (ms: number) => {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(TIMED_OUT);
    }, ms);
  });
  return {
    elapsed,
    isExpired: () => expired,
    cancel: () => clearTimeout(timer),
  };
};

/** Stops a write before its swap. Carries the reason and nothing else. */
class Refusal extends Error {
  constructor(readonly reason: "timeout" | "full") {
    super("The trusted-script record was not changed.");
  }
}

const fail = (reason: ScriptTrustFailureReason): ScriptTrustFailure => ({
  ok: false,
  reason,
});

const ask = (
  reason: Extract<ScriptTrustConsult, { trusted: false }>["reason"],
  canGrant: boolean,
): ScriptTrustConsult => ({ trusted: false, scope: null, canGrant, reason });

const sameEntry = (left: ScriptTrustEntry, right: ScriptTrustEntry) =>
  JSON.stringify(left) === JSON.stringify(right);

/** One read of the durable value. Never throws and never writes. */
async function readDurable(): Promise<Durable> {
  try {
    const invoke = await getInvoke();
    if (!invoke) return { status: "unavailable" };
    let raw: unknown;
    try {
      raw = await invoke("read_app_data", { key: RUN_TRUST_STORE_KEY });
    } catch {
      return { status: "unreadable" };
    }
    if (raw === null) return { status: "missing" };
    return {
      status: "ready",
      record: parseScriptTrustRecord(raw as string),
    };
  } catch {
    return { status: "unreadable" };
  }
}

export function createScriptRunTrustStore(
  options: ScriptRunTrustStoreOptions = {},
): ScriptRunTrustStore {
  const events = options.events ?? tauriEvents;
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  /** Revokes this window has asked for and that have not settled yet. */
  const revoking = new Set<(entry: ScriptTrustEntry) => boolean>();
  let tail: Promise<void> = Promise.resolve();
  let revision = 0;

  /** This window's writes, one after the other, in the order they were asked for. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const tellLocal = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  /** After a durable change: the other windows hear of it through the event. */
  const announce = () => {
    revision += 1;
    void (async () => {
      try {
        await events.emit({ revision });
      } catch {
        // No event bridge: every consult reads the durable value regardless.
      }
    })();
  };

  /** The durable record without what this window is in the middle of revoking. */
  const effective = (record: ScriptTrustRecord): ScriptTrustRecord =>
    revoking.size === 0
      ? record
      : {
          version: 1,
          entries: record.entries.filter(
            (entry) => !Array.from(revoking).some((matches) => matches(entry)),
          ),
        };

  const boundedRead = async (): Promise<Durable | typeof TIMED_OUT> => {
    const deadline = startDeadline(SCRIPT_TRUST_TIMEOUT_MS);
    try {
      return await Promise.race([readDurable(), deadline.elapsed]);
    } finally {
      deadline.cancel();
    }
  };

  /** A grant that was reported as failed must not stand: remove it if it landed. */
  const withdraw = async (
    entry: ScriptTrustEntry,
    settled: Promise<unknown>,
  ) => {
    try {
      await settled;
      await serial(async () => {
        const durable = await readDurable();
        if (
          durable.status !== "ready" ||
          !durable.record.entries.some((stored) => sameEntry(stored, entry))
        )
          return;
        await durableStore.update((current) => ({
          version: 1,
          entries: (current?.entries ?? []).filter(
            (stored) => !sameEntry(stored, entry),
          ),
        }));
        announce();
      });
    } catch {
      // Best effort: the caller already knows the grant was not saved.
    }
  };

  const remove = async (
    matches: (entry: ScriptTrustEntry) => boolean,
    everything = false,
  ): Promise<ScriptTrustRevokeResult> => {
    // From this moment the window stops honouring the entries, written or not.
    revoking.add(matches);
    const deadline = startDeadline(SCRIPT_TRUST_TIMEOUT_MS);
    let wrote = false;
    const work = serial(async (): Promise<ScriptTrustRevokeResult> => {
      const before = await readDurable();
      if (before.status === "unavailable") return fail("unavailable");
      if (before.status === "missing") return { ok: true, removed: 0 };
      if (before.status === "unreadable" && !everything)
        return fail("unreadable");
      let removed =
        before.status === "ready"
          ? before.record.entries.filter(matches).length
          : 0;
      if (before.status === "ready" && removed === 0)
        return { ok: true, removed: 0 };
      wrote = true;
      try {
        if (everything) await durableStore.save(emptyScriptTrustRecord());
        else
          await durableStore.update((current) => {
            // Always from the value just read: a lost swap is redone on the
            // fresh record, so nothing another window removed comes back.
            const entries = current?.entries ?? [];
            const kept = entries.filter((entry) => !matches(entry));
            removed = entries.length - kept.length;
            return { version: 1, entries: kept };
          });
        return { ok: true, removed };
      } catch {
        const after = await readDurable();
        if (
          after.status === "missing" ||
          (after.status === "ready" && !after.record.entries.some(matches))
        )
          return { ok: true, removed };
        return fail(after.status === "ready" ? "failed" : after.status);
      }
    }).catch(() => fail("failed"));
    void work.then((result) => {
      revoking.delete(matches);
      if (result.ok && wrote) announce();
      // Listeners showed the record without these entries; show it as it is.
      tellLocal();
    });
    tellLocal();
    const outcome = await Promise.race([work, deadline.elapsed]);
    deadline.cancel();
    return outcome === TIMED_OUT ? fail("timeout") : outcome;
  };

  const store: ScriptRunTrustStore = {
    async consult(query) {
      try {
        if (!isScriptTrustQuery(query)) return ask("invalid", false);
        const durable = await boundedRead();
        if (durable === TIMED_OUT) return ask("timeout", false);
        if (durable.status === "missing") return ask("not-trusted", true);
        if (durable.status !== "ready") return ask(durable.status, false);
        const scope = evaluateScriptTrust(effective(durable.record), query);
        return scope
          ? { trusted: true, scope, canGrant: true }
          : ask("not-trusted", true);
      } catch {
        return ask("unreadable", false);
      }
    },

    async read() {
      const durable = await boundedRead();
      if (durable === TIMED_OUT)
        return { status: "unavailable", reason: "timeout" };
      if (durable.status === "missing")
        return { status: "ready", record: emptyScriptTrustRecord() };
      if (durable.status !== "ready")
        return { status: "unavailable", reason: durable.status };
      return { status: "ready", record: effective(durable.record) };
    },

    async grant(grant) {
      try {
        const entry = createScriptTrustEntry(grant, now().toISOString());
        if (!entry) return fail("invalid");
        const key = scriptTrustEntryKey(entry);
        const deadline = startDeadline(SCRIPT_TRUST_TIMEOUT_MS);
        let attempted = false;
        const work = serial(async (): Promise<ScriptTrustGrantResult> => {
          if (deadline.isExpired()) return fail("timeout");
          // The store's own reader does not see the size limit: check first.
          const before = await readDurable();
          if (before.status === "unavailable" || before.status === "unreadable")
            return fail(before.status);
          try {
            await durableStore.update((current) => {
              if (deadline.isExpired()) throw new Refusal("timeout");
              const kept = (current?.entries ?? []).filter(
                (stored) => scriptTrustEntryKey(stored) !== key,
              );
              if (kept.length >= MAX_SCRIPT_TRUST_ENTRIES)
                throw new Refusal("full");
              attempted = true;
              return { version: 1, entries: [...kept, entry] };
            });
            return { ok: true, entry };
          } catch (error) {
            if (error instanceof Refusal) return fail(error.reason);
            // The swap may have landed although its check failed: look.
            const after = await readDurable();
            if (
              after.status === "ready" &&
              after.record.entries.some((stored) => sameEntry(stored, entry))
            )
              return { ok: true, entry };
            return fail(
              after.status === "unreadable" ? "unreadable" : "failed",
            );
          }
        }).catch(() => fail("failed"));
        const outcome = await Promise.race([work, deadline.elapsed]);
        deadline.cancel();
        const result = outcome === TIMED_OUT ? fail("timeout") : outcome;
        if (result.ok) announce();
        else
          void work.then(() => {
            if (attempted) void withdraw(entry, work);
          });
        return result;
      } catch {
        return fail("failed");
      }
    },

    async revoke(entry) {
      if (!isScriptTrustEntryRef(entry)) return fail("invalid");
      const key = scriptTrustEntryKey(entry);
      return remove((stored) => scriptTrustEntryKey(stored) === key);
    },

    async revokeSubject(subject) {
      if (!isScriptTrustSubjectRef(subject)) return fail("invalid");
      const key = scriptTrustSubjectKey(subject);
      return remove((stored) => scriptTrustSubjectKey(stored) === key);
    },

    revokeAll: () => remove(() => true, true),

    async prune(target) {
      if (!target || !isScriptTrustId(target.databaseId))
        return fail("invalid");
      const databaseId = target.databaseId;
      if (target.kind === "database")
        return remove(
          (stored) =>
            stored.connection?.databaseId === databaseId ||
            (stored.library.kind === "database" &&
              stored.library.databaseId === databaseId),
        );
      if (
        target.kind !== "connections" ||
        !Array.isArray(target.connectionIds) ||
        !target.connectionIds.every(isScriptTrustId)
      )
        return fail("invalid");
      const ids = new Set<string>(target.connectionIds);
      return remove(
        (stored) =>
          stored.scope === "connection" &&
          stored.connection?.databaseId === databaseId &&
          ids.has(stored.connection.connectionId),
      );
    },

    subscribe(listener) {
      let active = true;
      let unlisten: (() => void) | null = null;
      const tell = () => {
        if (!active) return;
        try {
          listener();
        } catch {
          // One listener's failure is not the others' concern.
        }
      };
      const onWindowEvent = (event: Event) => {
        const detail = (event as CustomEvent<{ key?: unknown } | null>).detail;
        if (detail?.key === RUN_TRUST_STORE_KEY) tell();
      };
      listeners.add(tell);
      if (typeof window !== "undefined")
        window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, onWindowEvent);
      void (async () => {
        try {
          const off = await events.listen(tell);
          if (typeof off !== "function") return;
          if (active) unlisten = off;
          else off();
        } catch {
          // No event bridge: this window's own event still arrives.
        }
      })();
      return () => {
        active = false;
        listeners.delete(tell);
        if (typeof window !== "undefined")
          window.removeEventListener(
            APP_DATA_STORE_CHANGED_EVENT,
            onWindowEvent,
          );
        unlisten?.();
        unlisten = null;
      };
    },
  };
  return store;
}

/** The app's store. Each window has its own instance over the same durable value. */
export const scriptRunTrustStore = createScriptRunTrustStore();

export const consultScriptTrust = (
  query: ScriptTrustQuery,
): Promise<ScriptTrustConsult> => scriptRunTrustStore.consult(query);
export const readScriptTrustRecord = (): Promise<ScriptTrustRecordRead> =>
  scriptRunTrustStore.read();
export const grantScriptTrust = (
  grant: ScriptTrustGrant,
): Promise<ScriptTrustGrantResult> => scriptRunTrustStore.grant(grant);
export const revokeScriptTrust = (
  entry: ScriptTrustEntryRef,
): Promise<ScriptTrustRevokeResult> => scriptRunTrustStore.revoke(entry);
export const revokeScriptTrustForSubject = (
  subject: ScriptTrustSubjectRef,
): Promise<ScriptTrustRevokeResult> =>
  scriptRunTrustStore.revokeSubject(subject);
/** Also the call for "reset settings" and "delete app data": it returns to "ask". */
export const revokeAllScriptTrust = (): Promise<ScriptTrustRevokeResult> =>
  scriptRunTrustStore.revokeAll();
export const pruneScriptTrust = (
  target: ScriptTrustPrune,
): Promise<ScriptTrustRevokeResult> => scriptRunTrustStore.prune(target);
export const subscribeScriptTrust = (listener: () => void): (() => void) =>
  scriptRunTrustStore.subscribe(listener);
