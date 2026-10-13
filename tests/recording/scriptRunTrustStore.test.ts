import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SCRIPT_TRUST_ENTRIES,
  MAX_SCRIPT_TRUST_RECORD_CHARS,
  RUN_TRUST_STORE_KEY,
  type ScriptTrustEntry,
  type ScriptTrustGrant,
  type ScriptTrustQuery,
} from "../../src/utils/recording/scriptRunTrust";
import {
  RUN_TRUST_CHANGED_EVENT,
  SCRIPT_TRUST_TIMEOUT_MS,
  consultScriptTrust,
  createScriptRunTrustStore,
  grantScriptTrust,
  pruneScriptTrust,
  readScriptTrustRecord,
  revokeAllScriptTrust,
  revokeScriptTrust,
  revokeScriptTrustForSubject,
  scriptRunTrustStore,
  subscribeScriptTrust,
  type ScriptRunTrustStore,
} from "../../src/utils/recording/scriptRunTrustStore";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  SCRIPT_TRUST_TEST_EVENT,
  SENTINELS,
  TRUST_TEST_TIME,
  connectionTrustEntry,
  containsSentinel,
  createScriptTrustEventBus,
  createScriptTrustTestBackend,
  fakeDigest,
  trustEntry,
  type ScriptTrustTestBackend,
} from "./scriptTrustTestBackend";

const binding = {
  databaseId: "db-1",
  connectionId: "conn-1",
  endpointDigest: fakeDigest("endpoint-1"),
};
const everywhere = {
  kind: "ssh-script",
  library: { kind: "app" },
  subjectId: "script-1",
  contentDigest: fakeDigest("content-1"),
  scope: "everywhere",
  risk: "standard",
} satisfies ScriptTrustGrant;
const onConnection = {
  kind: "ssh-script",
  library: { kind: "app" },
  subjectId: "script-1",
  contentDigest: fakeDigest("content-1"),
  scope: "connection",
  connection: binding,
  risk: "standard",
} satisfies ScriptTrustGrant;
const query = (
  overrides: Partial<ScriptTrustQuery> = {},
): ScriptTrustQuery => ({
  kind: "ssh-script",
  library: { kind: "app" },
  subjectId: "script-1",
  contentDigest: fakeDigest("content-1"),
  connection: binding,
  ...overrides,
});
const ASK = { trusted: false, scope: null } as const;

let backend: ScriptTrustTestBackend;
const bus = createScriptTrustEventBus();
const now = () => new Date(TRUST_TEST_TIME);
const makeStore = (): ScriptRunTrustStore =>
  createScriptRunTrustStore({ events: bus.runtime(), now });

/** A second window: its own module graph, so its own write queue, on the same backend. */
async function otherWindow(): Promise<ScriptRunTrustStore> {
  vi.resetModules();
  const fresh = await import("../../src/utils/recording/scriptRunTrustStore");
  return fresh.createScriptRunTrustStore({ events: bus.runtime(), now });
}

const consoleSpies = () =>
  (["log", "info", "warn", "error", "debug", "trace"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );

beforeEach(() => {
  backend = createScriptTrustTestBackend();
  backend.install();
  bus.reset();
});
afterEach(() => {
  backend.uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the durable store", () => {
  it("is the native app-data store alone: no local storage key, no fallback, no sync history", () => {
    const source = readFileSync(
      "src/utils/recording/scriptRunTrustStore.ts",
      "utf8",
    );
    const options = source.slice(
      source.indexOf("new AppDataJsonStore<ScriptTrustRecord>({"),
      source.indexOf("});", source.indexOf("new AppDataJsonStore<")),
    );
    expect(options).toContain("key: RUN_TRUST_STORE_KEY,");
    expect(options).toContain("requireNative: true,");
    expect(options).toContain("sanitize: sanitizeScriptTrustRecord,");
    expect(source.match(/new AppDataJsonStore\b/g)).toHaveLength(1);
    for (const forbidden of [
      "legacyLocalStorageKey",
      "trackRecords",
      "backend:",
      "localStorage",
      "sessionStorage",
      "IndexedDb",
      "indexedDB",
      "console.",
    ])
      expect(source, forbidden).not.toContain(forbidden);
  });
});

describe("a record that cannot vouch for anything (S4)", () => {
  it("asks when there is no record, offers the lasting choice and writes nothing", async () => {
    const store = makeStore();
    expect(await store.consult(query())).toStrictEqual({
      ...ASK,
      canGrant: true,
      reason: "not-trusted",
    });
    expect(await store.read()).toStrictEqual({
      status: "ready",
      record: { version: 1, entries: [] },
    });
    expect(backend.raw()).toBeNull();
    expect(backend.writes()).toBe(0);
    expect(backend.reads()).toBe(2);
  });

  const trusted = () => ({ version: 1, entries: [trustEntry()] });
  const damaged: [string, () => string][] = [
    ["text that is not JSON", () => `${JSON.stringify(trusted())}}`],
    ["an empty text", () => ""],
    ["another version", () => JSON.stringify({ ...trusted(), version: 2 })],
    ["no version", () => JSON.stringify({ entries: trusted().entries })],
    ["a list", () => JSON.stringify(trusted().entries)],
    [
      "one entry that is not valid among valid ones",
      () =>
        JSON.stringify({
          version: 1,
          entries: [
            trustEntry(),
            { ...trustEntry({ subjectId: "script-2" }), scope: "session" },
          ],
        }),
    ],
    [
      "an entry with a key that does not belong",
      () =>
        JSON.stringify({
          version: 1,
          entries: [{ ...trustEntry(), name: "Nightly cleanup" }],
        }),
    ],
    [
      "a key that does not belong on the record",
      () => JSON.stringify({ ...trusted(), recordMetadata: {} }),
    ],
    [
      "the same entry twice",
      () =>
        JSON.stringify({ version: 1, entries: [trustEntry(), trustEntry()] }),
    ],
    [
      "more entries than the cap",
      () =>
        JSON.stringify({
          version: 1,
          entries: [
            trustEntry(),
            ...Array.from({ length: MAX_SCRIPT_TRUST_ENTRIES }, (_, index) =>
              trustEntry({ subjectId: `filler-${index}` }),
            ),
          ],
        }),
    ],
    [
      "text over the size limit",
      () =>
        JSON.stringify(trusted()) + " ".repeat(MAX_SCRIPT_TRUST_RECORD_CHARS),
    ],
  ];

  it.each(damaged)(
    "trusts nothing, offers no lasting choice and leaves the value alone: %s",
    async (_label, make) => {
      const raw = make();
      backend.setRaw(raw);
      const store = makeStore();
      // The entry for this very script is in there, and still it asks.
      expect(await store.consult(query())).toStrictEqual({
        ...ASK,
        canGrant: false,
        reason: "unreadable",
      });
      expect(await store.read()).toStrictEqual({
        status: "unavailable",
        reason: "unreadable",
      });
      expect(await store.grant(everywhere)).toStrictEqual({
        ok: false,
        reason: "unreadable",
      });
      expect(await store.revoke(trustEntry())).toStrictEqual({
        ok: false,
        reason: "unreadable",
      });
      expect(
        await store.prune({ kind: "database", databaseId: "db-1" }),
      ).toStrictEqual({ ok: false, reason: "unreadable" });
      expect(backend.raw()).toBe(raw);
      expect(backend.commits()).toBe(0);
      expect(await store.consult(query())).toMatchObject(ASK);
    },
  );

  it("asks when the read is refused", async () => {
    backend.seed(trusted());
    const store = makeStore();
    expect(await store.consult(query())).toMatchObject({ trusted: true });
    backend.reject("read");
    expect(await store.consult(query())).toStrictEqual({
      ...ASK,
      canGrant: false,
      reason: "unreadable",
    });
    expect(await store.read()).toStrictEqual({
      status: "unavailable",
      reason: "unreadable",
    });
    expect(await store.grant(onConnection)).toMatchObject({ ok: false });
    backend.heal();
    expect(backend.stored()).toStrictEqual(trusted());
    expect(await store.consult(query())).toMatchObject({ trusted: true });
  });

  it("asks when the backend answers with something that is not text", async () => {
    const store = makeStore();
    backend.seed(trusted());
    for (const answer of [undefined, 0, {}, trusted(), true, [trusted()]]) {
      backend.answerReads(answer);
      expect(await store.consult(query())).toStrictEqual({
        ...ASK,
        canGrant: false,
        reason: "unreadable",
      });
      expect(await store.grant(everywhere)).toStrictEqual({
        ok: false,
        reason: "unreadable",
      });
    }
    backend.answerReads(JSON.stringify(trusted()));
    expect(await store.consult(query())).toMatchObject({ trusted: true });
    expect(backend.writes()).toBe(0);
  });

  it("asks after 1,500 ms without the durable value, and never from memory", async () => {
    expect(SCRIPT_TRUST_TIMEOUT_MS).toBe(1500);
    backend.seed(trusted());
    const store = makeStore();
    // The same question was answered "trusted" a moment ago.
    expect(await store.consult(query())).toMatchObject({ trusted: true });
    vi.useFakeTimers();
    const release = backend.stall("read");
    let answer: unknown;
    void store.consult(query()).then((value) => {
      answer = value;
    });
    await vi.advanceTimersByTimeAsync(SCRIPT_TRUST_TIMEOUT_MS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toStrictEqual({
      ...ASK,
      canGrant: false,
      reason: "timeout",
    });
    const reading = store.read();
    await vi.advanceTimersByTimeAsync(SCRIPT_TRUST_TIMEOUT_MS);
    expect(await reading).toStrictEqual({
      status: "unavailable",
      reason: "timeout",
    });
    // The late answers change nothing, and the next consult reads again.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toMatchObject(ASK);
    expect(await store.consult(query())).toMatchObject({ trusted: true });
    expect(backend.writes()).toBe(0);
  });

  it("asks outside the desktop app and never looks in local or IndexedDB storage (S5)", async () => {
    backend.uninstall();
    const planted = JSON.stringify(trusted());
    const touched: string[] = [];
    const tracking = new Proxy(
      {},
      {
        get: (_target, property) => {
          touched.push(String(property));
          return () => planted;
        },
        has: () => true,
        ownKeys: () => [RUN_TRUST_STORE_KEY],
      },
    );
    vi.stubGlobal("localStorage", tracking);
    vi.stubGlobal("sessionStorage", tracking);
    const indexed = [
      vi.spyOn(IndexedDbService, "getItem").mockResolvedValue(planted),
      vi.spyOn(IndexedDbService, "getItemStrict").mockResolvedValue(planted),
      vi.spyOn(IndexedDbService, "setItem").mockResolvedValue(undefined),
      vi
        .spyOn(IndexedDbService, "transactItemsStrict")
        .mockResolvedValue(true as never),
    ];
    const store = makeStore();
    expect(await store.consult(query())).toStrictEqual({
      ...ASK,
      canGrant: false,
      reason: "unavailable",
    });
    expect(await store.read()).toStrictEqual({
      status: "unavailable",
      reason: "unavailable",
    });
    for (const result of [
      await store.grant(everywhere),
      await store.revoke(trustEntry()),
      await store.revokeSubject(trustEntry()),
      await store.revokeAll(),
      await store.prune({ kind: "database", databaseId: "db-1" }),
    ])
      expect(result).toStrictEqual({ ok: false, reason: "unavailable" });
    expect(touched).toEqual([]);
    for (const spy of indexed) expect(spy).not.toHaveBeenCalled();
    expect(backend.calls).toHaveLength(0);
  });

  it("does not adopt a planted value while the native record is missing (S5)", async () => {
    const planted = JSON.stringify(trusted());
    const plantedKeys = [
      RUN_TRUST_STORE_KEY,
      "automation.run-trust",
      "mremote-run-trust",
      "sorng-run-trust",
      "trustedScripts",
    ];
    for (const key of plantedKeys) {
      localStorage.setItem(key, planted);
      await IndexedDbService.setItem(key, planted);
    }
    const getItem = vi.spyOn(IndexedDbService, "getItemStrict");
    const store = makeStore();
    expect(await store.consult(query())).toMatchObject({
      ...ASK,
      canGrant: true,
    });
    expect((await store.grant(onConnection)).ok).toBe(true);
    expect(await store.revokeAll()).toStrictEqual({ ok: true, removed: 1 });
    expect(await store.consult(query())).toMatchObject(ASK);
    expect(getItem).not.toHaveBeenCalled();
    // The planted values are neither adopted nor "migrated away".
    expect(localStorage.getItem(RUN_TRUST_STORE_KEY)).toBe(planted);
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
    for (const key of plantedKeys) {
      localStorage.removeItem(key);
      await IndexedDbService.removeItem(key);
    }
  });

  it("does not look at the record at all for a question that is not well formed", async () => {
    backend.seed(trusted());
    const store = makeStore();
    for (const bad of [
      null,
      {},
      query({ contentDigest: "*" }),
      query({ subjectId: "" }),
      { ...query(), connection: undefined },
    ])
      expect(await store.consult(bad as ScriptTrustQuery)).toStrictEqual({
        ...ASK,
        canGrant: false,
        reason: "invalid",
      });
    expect(backend.calls).toHaveLength(0);
  });
});

describe("granting", () => {
  it("stores exactly the entry, tells every listener, and the next consult trusts it", async () => {
    const store = makeStore();
    const windowEvents: unknown[] = [];
    const onWindow = (event: Event) =>
      windowEvents.push((event as CustomEvent).detail);
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, onWindow);
    try {
      const result = await store.grant(onConnection);
      const entry: ScriptTrustEntry = {
        kind: "ssh-script",
        library: { kind: "app" },
        subjectId: "script-1",
        contentDigest: fakeDigest("content-1"),
        scope: "connection",
        connection: binding,
        risk: "standard",
        grantedAt: TRUST_TEST_TIME,
      };
      expect(result).toStrictEqual({ ok: true, entry });
      expect(backend.raw()).toBe(
        JSON.stringify({ version: 1, entries: [entry] }),
      );
      expect(backend.raw()).not.toContain("recordMetadata");
      // The window event names the key and nothing else; the cross-window one a counter.
      expect(windowEvents).toStrictEqual([{ key: RUN_TRUST_STORE_KEY }]);
      expect(RUN_TRUST_CHANGED_EVENT).toBe(SCRIPT_TRUST_TEST_EVENT);
      expect(bus.emitted).toStrictEqual([
        { event: "sorng-run-trust-changed", payload: { revision: 1 } },
      ]);
    } finally {
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, onWindow);
    }
    expect(await store.consult(query())).toStrictEqual({
      trusted: true,
      scope: "connection",
      canGrant: true,
    });
    expect(await store.consult(query({ connection: null }))).toMatchObject(ASK);
    // A fresh store on the same durable value: the grant lasts (S12).
    expect(await makeStore().consult(query())).toMatchObject({ trusted: true });
  });

  it("keeps one entry per key: a new answer replaces the content that was trusted", async () => {
    const store = makeStore();
    await store.grant(everywhere);
    await store.grant(onConnection);
    await store.grant({ ...everywhere, contentDigest: fakeDigest("edited") });
    const stored = backend.stored().entries;
    expect(stored).toHaveLength(2);
    expect(stored.map((entry) => [entry.scope, entry.contentDigest])).toEqual([
      ["connection", fakeDigest("content-1")],
      ["everywhere", fakeDigest("edited")],
    ]);
    expect(await store.consult(query({ connection: null }))).toMatchObject(ASK);
    expect(
      await store.consult(
        query({ connection: null, contentDigest: fakeDigest("edited") }),
      ),
    ).toMatchObject({ trusted: true, scope: "everywhere" });
  });

  it("refuses a grant that does not name everything, without reading or writing", async () => {
    backend.seed({ version: 1, entries: [] });
    const store = makeStore();
    const raw = backend.raw();
    const bad: unknown[] = [
      undefined,
      {},
      { ...everywhere, scope: undefined },
      { ...everywhere, scope: "*" },
      { ...everywhere, library: undefined },
      { ...everywhere, risk: undefined },
      { ...everywhere, contentDigest: "*" },
      { ...onConnection, connection: undefined },
      {
        ...onConnection,
        connection: { ...binding, endpointDigest: undefined },
      },
      { ...everywhere, subjectId: "*".repeat(200) },
    ];
    for (const grant of bad)
      expect(await store.grant(grant as ScriptTrustGrant)).toStrictEqual({
        ok: false,
        reason: "invalid",
      });
    expect(backend.calls).toHaveLength(0);
    expect(backend.raw()).toBe(raw);
  });

  it("refuses a new entry at the cap, and still replaces an existing one", async () => {
    const full = {
      version: 1,
      entries: Array.from({ length: MAX_SCRIPT_TRUST_ENTRIES }, (_, index) =>
        trustEntry({ subjectId: `script-${index}` }),
      ),
    };
    backend.seed(full);
    const store = makeStore();
    const raw = backend.raw();
    expect(
      await store.grant({ ...everywhere, subjectId: "one-too-many" }),
    ).toStrictEqual({ ok: false, reason: "full" });
    expect(backend.raw()).toBe(raw);
    expect(backend.commits()).toBe(0);
    expect(
      (
        await store.grant({
          ...everywhere,
          subjectId: "script-7",
          contentDigest: fakeDigest("edited"),
        })
      ).ok,
    ).toBe(true);
    expect(backend.stored().entries).toHaveLength(MAX_SCRIPT_TRUST_ENTRIES);
  });

  it("reports a write that fails, and the grant did not happen", async () => {
    const store = makeStore();
    backend.reject("write", 1);
    expect(await store.grant(everywhere)).toStrictEqual({
      ok: false,
      reason: "failed",
    });
    expect(backend.raw()).toBeNull();
    expect(await store.consult(query())).toMatchObject(ASK);
    expect(bus.emitted).toHaveLength(0);

    // A swap that keeps losing: five attempts, then the caller is told.
    backend.seed({ version: 1, entries: [] });
    backend.loseWrites();
    expect(await store.grant(everywhere)).toStrictEqual({
      ok: false,
      reason: "failed",
    });
    expect(backend.writes()).toBe(6);
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
    expect(await store.revokeAll()).toStrictEqual({ ok: true, removed: 0 });
    backend.seed({ version: 1, entries: [trustEntry()] });
    expect(await store.revoke(trustEntry())).toStrictEqual({
      ok: false,
      reason: "failed",
    });
    expect(await store.revokeAll()).toStrictEqual({
      ok: false,
      reason: "failed",
    });
    expect(backend.stored().entries).toHaveLength(1);
    expect(bus.emitted).toHaveLength(0);
  });

  it("reports a grant as made when the write landed and only its check failed", async () => {
    const store = makeStore();
    // The swap commits; the read that verifies it is refused once.
    backend.beforeNextWrite(() => backend.reject("read", 1));
    expect((await store.grant(everywhere)).ok).toBe(true);
    expect(backend.stored().entries).toHaveLength(1);
    expect(await store.consult(query())).toMatchObject({ trusted: true });
  });

  it("gives up after 1,500 ms and takes back a write that lands later", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    await store.grant({ ...everywhere, subjectId: "kept" });
    const release = backend.stall("write");
    let result: unknown;
    void store.grant(everywhere).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(SCRIPT_TRUST_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toStrictEqual({ ok: false, reason: "timeout" });
    // The stalled swap now commits behind the caller's back...
    release();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    await vi.waitFor(() =>
      expect(backend.stored().entries.map((entry) => entry.subjectId)).toEqual([
        "kept",
      ]),
    );
    // ...and is withdrawn: the caller was told it did not happen.
    expect(await store.consult(query())).toMatchObject(ASK);
    expect(await store.consult(query({ subjectId: "kept" }))).toMatchObject({
      trusted: true,
    });
  });

  it("writes nothing at all when the bound passes before the swap", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    const release = backend.stall("read");
    const granting = store.grant(everywhere);
    await vi.advanceTimersByTimeAsync(SCRIPT_TRUST_TIMEOUT_MS);
    expect(await granting).toStrictEqual({ ok: false, reason: "timeout" });
    release();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.writes()).toBe(0);
    expect(backend.raw()).toBeNull();
  });
});

describe("revoking", () => {
  const seedThree = () =>
    backend.seed({
      version: 1,
      entries: [
        trustEntry(),
        connectionTrustEntry(),
        trustEntry({ subjectId: "script-2" }),
      ],
    });

  it("removes one entry, whatever content it was given for", async () => {
    seedThree();
    const store = makeStore();
    expect(await store.consult(query())).toMatchObject({ scope: "connection" });
    expect(
      await store.revoke({
        kind: "ssh-script",
        library: { kind: "app" },
        subjectId: "script-1",
        scope: "connection",
        connection: { databaseId: "db-1", connectionId: "conn-1" },
      }),
    ).toStrictEqual({ ok: true, removed: 1 });
    expect(await store.consult(query())).toMatchObject({ scope: "everywhere" });
    // An entry of the record is itself a valid target.
    expect(await store.revoke(trustEntry())).toStrictEqual({
      ok: true,
      removed: 1,
    });
    expect(await store.consult(query())).toMatchObject(ASK);
    expect(backend.stored().entries).toStrictEqual([
      trustEntry({ subjectId: "script-2" }),
    ]);
    expect(bus.emitted).toHaveLength(2);
  });

  it("removes every entry of one script and nothing of another", async () => {
    seedThree();
    const store = makeStore();
    expect(
      await store.revokeSubject({
        kind: "ssh-script",
        library: { kind: "app" },
        subjectId: "script-1",
      }),
    ).toStrictEqual({ ok: true, removed: 2 });
    expect(backend.stored().entries).toStrictEqual([
      trustEntry({ subjectId: "script-2" }),
    ]);
    // Same id in a database's library, or as a macro: another subject.
    expect(
      await store.revokeSubject({
        kind: "ssh-macro",
        library: { kind: "app" },
        subjectId: "script-2",
      }),
    ).toStrictEqual({ ok: true, removed: 0 });
    expect(
      await store.revokeSubject({
        kind: "ssh-script",
        library: { kind: "database", databaseId: "db-1" },
        subjectId: "script-2",
      }),
    ).toStrictEqual({ ok: true, removed: 0 });
    expect(backend.stored().entries).toHaveLength(1);
  });

  it("removes everything, and repairs a record that could not be read", async () => {
    seedThree();
    const store = makeStore();
    expect(await store.revokeAll()).toStrictEqual({ ok: true, removed: 3 });
    expect(backend.raw()).toBe('{"version":1,"entries":[]}');
    expect(await store.consult(query())).toMatchObject({
      ...ASK,
      canGrant: true,
    });

    backend.setRaw(`{"version":1,"entries":[${SENTINELS.script}`);
    expect(await store.consult(query())).toMatchObject({ canGrant: false });
    expect(await store.revokeAll()).toStrictEqual({ ok: true, removed: 0 });
    expect(backend.raw()).toBe('{"version":1,"entries":[]}');
    expect(await store.consult(query())).toMatchObject({ canGrant: true });
    expect((await store.grant(everywhere)).ok).toBe(true);
  });

  it("writes nothing when there is nothing to remove", async () => {
    const store = makeStore();
    expect(await store.revoke(trustEntry())).toStrictEqual({
      ok: true,
      removed: 0,
    });
    expect(await store.revokeAll()).toStrictEqual({ ok: true, removed: 0 });
    expect(backend.raw()).toBeNull();
    backend.seed({ version: 1, entries: [trustEntry({ subjectId: "other" })] });
    expect(await store.revoke(trustEntry())).toStrictEqual({
      ok: true,
      removed: 0,
    });
    expect(
      await store.prune({
        kind: "connections",
        databaseId: "db-1",
        connectionIds: ["conn-1"],
      }),
    ).toStrictEqual({ ok: true, removed: 0 });
    expect(backend.writes()).toBe(0);
    expect(bus.emitted).toHaveLength(0);
  });

  it("refuses a target that is not well formed", async () => {
    seedThree();
    const store = makeStore();
    const raw = backend.raw();
    for (const bad of [
      null,
      {},
      { ...trustEntry(), scope: "*" },
      { ...trustEntry(), subjectId: "" },
      { ...trustEntry(), scope: "connection" },
      { ...connectionTrustEntry(), scope: "everywhere" },
    ])
      expect(await store.revoke(bad as never)).toStrictEqual({
        ok: false,
        reason: "invalid",
      });
    expect(await store.revokeSubject({ kind: "*" } as never)).toStrictEqual({
      ok: false,
      reason: "invalid",
    });
    for (const bad of [
      null,
      { kind: "database" },
      { kind: "database", databaseId: "" },
      { kind: "connections", databaseId: "db-1" },
      { kind: "connections", databaseId: "db-1", connectionIds: [""] },
      { kind: "everything" },
    ])
      expect(await store.prune(bad as never)).toStrictEqual({
        ok: false,
        reason: "invalid",
      });
    expect(backend.raw()).toBe(raw);
    expect(backend.calls).toHaveLength(0);
  });

  it("asks at once in this window while the write is still on its way", async () => {
    seedThree();
    const store = makeStore();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    const release = backend.stall("write");
    const revoking = store.revoke(connectionTrustEntry());
    await vi.waitFor(() => expect(backend.writes()).toBe(1));
    // The durable value still holds the entry; this window no longer honours it.
    expect(backend.stored().entries).toHaveLength(3);
    expect(await store.consult(query())).toMatchObject({ scope: "everywhere" });
    const view = await store.read();
    expect(view.status === "ready" && view.record.entries).toStrictEqual([
      trustEntry(),
      trustEntry({ subjectId: "script-2" }),
    ]);
    expect(heard).toHaveBeenCalled();
    release();
    expect(await revoking).toStrictEqual({ ok: true, removed: 1 });
    expect(backend.stored().entries).toHaveLength(2);
    stop();
  });

  it("tells the caller when the write failed, and then follows the durable value again", async () => {
    seedThree();
    const store = makeStore();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    backend.reject("write", 1);
    expect(await store.revoke(connectionTrustEntry())).toStrictEqual({
      ok: false,
      reason: "failed",
    });
    expect(backend.stored().entries).toHaveLength(3);
    expect(await store.consult(query())).toMatchObject({ scope: "connection" });
    // Listeners hear of the failure too: the entry is back in their lists.
    expect(heard.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it("gives up waiting after 1,500 ms, and the revoke still lands", async () => {
    vi.useFakeTimers();
    seedThree();
    const store = makeStore();
    const release = backend.stall("write");
    const revoking = store.revokeAll();
    await vi.advanceTimersByTimeAsync(SCRIPT_TRUST_TIMEOUT_MS);
    expect(await revoking).toStrictEqual({ ok: false, reason: "timeout" });
    // Until it lands, this window already asks.
    let answer: unknown;
    void store.consult(query()).then((value) => {
      answer = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toMatchObject(ASK);
    release();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    await vi.waitFor(() => expect(backend.stored().entries).toHaveLength(0));
  });
});

describe("pruning", () => {
  const seed = () =>
    backend.seed({
      version: 1,
      entries: [
        trustEntry(),
        connectionTrustEntry(),
        connectionTrustEntry({
          subjectId: "script-2",
          connection: { ...binding, connectionId: "conn-2" },
        }),
        connectionTrustEntry({
          subjectId: "script-3",
          connection: { ...binding, databaseId: "db-2" },
        }),
        trustEntry({
          kind: "ssh-macro",
          subjectId: "macro-1",
          library: { kind: "database", databaseId: "db-1" },
        }),
      ],
    });

  it("removes the entries bound to the named connections of one database", async () => {
    seed();
    const store = makeStore();
    expect(
      await store.prune({
        kind: "connections",
        databaseId: "db-1",
        connectionIds: ["conn-1", "conn-9"],
      }),
    ).toStrictEqual({ ok: true, removed: 1 });
    // The same connection id in another database, the other connection and
    // every "everywhere" entry stay.
    expect(backend.stored().entries.map((entry) => entry.subjectId)).toEqual([
      "script-1",
      "script-2",
      "script-3",
      "macro-1",
    ]);
    expect(
      await store.prune({
        kind: "connections",
        databaseId: "db-1",
        connectionIds: [],
      }),
    ).toStrictEqual({ ok: true, removed: 0 });
  });

  it("removes what belongs to a deleted database: its connections and its library's scripts", async () => {
    seed();
    const store = makeStore();
    expect(
      await store.prune({ kind: "database", databaseId: "db-1" }),
    ).toStrictEqual({ ok: true, removed: 3 });
    expect(backend.stored().entries.map((entry) => entry.subjectId)).toEqual([
      "script-1",
      "script-3",
    ]);
  });
});

describe("two windows on one record (S6)", () => {
  it("obeys a revoke made in another window on the very next consult, with no event", async () => {
    const first = makeStore();
    const second = await otherWindow();
    bus.fail();
    expect((await first.grant(everywhere)).ok).toBe(true);
    expect(await second.consult(query())).toMatchObject({ trusted: true });
    expect((await second.revoke(trustEntry())).ok).toBe(true);
    expect(await first.consult(query())).toMatchObject(ASK);
    // And a value written behind both: nothing is cached anywhere.
    backend.seed({ version: 1, entries: [trustEntry()] });
    expect(await first.consult(query())).toMatchObject({ trusted: true });
    expect(await second.consult(query())).toMatchObject({ trusted: true });
    backend.setRaw(null);
    expect(await first.consult(query())).toMatchObject(ASK);
    expect(await second.consult(query())).toMatchObject(ASK);
    // One read per consult, each time.
    const before = backend.reads();
    await first.consult(query());
    expect(backend.reads()).toBe(before + 1);
  });

  it("tells the other window's listeners through the cross-window event", async () => {
    const first = makeStore();
    const second = await otherWindow();
    const heard = vi.fn();
    const stop = second.subscribe(heard);
    await vi.waitFor(() => expect(bus.listeners()).toBe(1));
    // Only the cross-window event: this window's own event is silenced.
    const dispatch = vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
    await first.grant(everywhere);
    expect(heard).toHaveBeenCalledTimes(1);
    await first.revokeAll();
    expect(heard).toHaveBeenCalledTimes(2);
    expect(bus.emitted.map((item) => item.payload)).toStrictEqual([
      { revision: 1 },
      { revision: 2 },
    ]);
    dispatch.mockRestore();
    bus.deliver();
    expect(heard).toHaveBeenCalledTimes(3);
    bus.deliver("settings-sync");
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    expect(bus.listeners()).toBe(0);
    bus.deliver();
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("retries a write that lost to another window and never brings a revoked entry back", async () => {
    const first = makeStore();
    const second = await otherWindow();
    await first.grant(everywhere);
    await first.grant({ ...everywhere, subjectId: "script-2" });

    // The other window revokes script-1 between this window's read and its swap.
    backend.beforeNextWrite(async () => {
      expect(await second.revoke(trustEntry())).toStrictEqual({
        ok: true,
        removed: 1,
      });
    });
    expect(
      (await first.grant({ ...everywhere, subjectId: "script-3" })).ok,
    ).toBe(true);
    expect(backend.stored().entries.map((entry) => entry.subjectId)).toEqual([
      "script-2",
      "script-3",
    ]);
    expect(
      backend.calls.filter((call) => call.committed === false),
    ).toHaveLength(1);
    expect(await first.consult(query())).toMatchObject(ASK);
    expect(await second.consult(query())).toMatchObject(ASK);

    // A revoke that loses is retried on the fresh value: both changes hold.
    backend.beforeNextWrite(async () => {
      expect(
        (await second.grant({ ...everywhere, subjectId: "script-4" })).ok,
      ).toBe(true);
    });
    expect(
      await first.revoke(trustEntry({ subjectId: "script-2" })),
    ).toStrictEqual({ ok: true, removed: 1 });
    expect(backend.stored().entries.map((entry) => entry.subjectId)).toEqual([
      "script-3",
      "script-4",
    ]);
    expect(
      backend.calls.filter((call) => call.committed === false),
    ).toHaveLength(2);

    // "Revoke all" elsewhere, in the middle of a prune here: nothing returns.
    backend.seed({
      version: 1,
      entries: [trustEntry(), connectionTrustEntry()],
    });
    backend.beforeNextWrite(async () => {
      expect((await second.revokeAll()).ok).toBe(true);
    });
    expect(
      (
        await first.prune({
          kind: "connections",
          databaseId: "db-1",
          connectionIds: ["conn-1"],
        })
      ).ok,
    ).toBe(true);
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
  });
});

describe("listening", () => {
  it("hears this window's event for this key only, until it stops", async () => {
    const store = makeStore();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    const announce = (key: unknown) =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, { detail: { key } }),
      );
    announce("recording.managed-scripts");
    announce(undefined);
    window.dispatchEvent(new CustomEvent(APP_DATA_STORE_CHANGED_EVENT));
    expect(heard).not.toHaveBeenCalled();
    announce(RUN_TRUST_STORE_KEY);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    announce(RUN_TRUST_STORE_KEY);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("works without an event bridge, and lets go of a listener that arrives late", async () => {
    bus.fail();
    const store = makeStore();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    expect((await store.grant(everywhere)).ok).toBe(true);
    expect(heard).toHaveBeenCalled();
    stop();

    bus.fail(false);
    const early = store.subscribe(vi.fn());
    early();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bus.listeners()).toBe(0);
    // A listener that throws does not stop the others.
    const second = vi.fn();
    const stopBad = store.subscribe(() => {
      throw new Error("listener");
    });
    const stopGood = store.subscribe(second);
    await vi.waitFor(() => expect(bus.listeners()).toBe(2));
    bus.deliver();
    expect(second).toHaveBeenCalledTimes(1);
    stopBad();
    stopGood();
  });
});

describe("the app's own store", () => {
  it("is one store behind the exported functions", async () => {
    expect(await consultScriptTrust(query())).toMatchObject({
      ...ASK,
      canGrant: true,
    });
    const heard = vi.fn();
    const stop = subscribeScriptTrust(heard);
    const granted = await grantScriptTrust(onConnection);
    expect(granted.ok).toBe(true);
    expect(heard).toHaveBeenCalled();
    expect(await scriptRunTrustStore.consult(query())).toMatchObject({
      trusted: true,
    });
    expect(await readScriptTrustRecord()).toMatchObject({
      status: "ready",
      record: { entries: [{ subjectId: "script-1" }] },
    });
    await grantScriptTrust(everywhere);
    expect(await revokeScriptTrust(connectionTrustEntry())).toStrictEqual({
      ok: true,
      removed: 1,
    });
    expect(
      await pruneScriptTrust({ kind: "database", databaseId: "db-1" }),
    ).toStrictEqual({ ok: true, removed: 0 });
    expect(await revokeScriptTrustForSubject(trustEntry())).toStrictEqual({
      ok: true,
      removed: 1,
    });
    await grantScriptTrust(everywhere);
    expect(await revokeAllScriptTrust()).toStrictEqual({
      ok: true,
      removed: 1,
    });
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
    stop();
  });
});

describe("what leaves the store (S8, S9)", () => {
  it("logs nothing, throws nothing and returns nothing that names a script, host or user", async () => {
    const spies = consoleSpies();
    const store = makeStore();
    const outputs: unknown[] = [];
    const run = async (work: () => Promise<unknown>) => {
      outputs.push(await work());
    };
    const hostile = {
      ...everywhere,
      name: SENTINELS.name,
      script: SENTINELS.script,
      hostname: SENTINELS.host,
      username: SENTINELS.user,
    } as ScriptTrustGrant;

    await run(() => store.grant(hostile));
    // Not an id: refused, and not repeated back.
    const notAnId = `${SENTINELS.script}\n${SENTINELS.host}`;
    await run(() => store.grant({ ...hostile, subjectId: notAnId }));
    await run(() => store.consult(query({ subjectId: notAnId })));
    backend.setRaw(`{"entries":"${SENTINELS.script} ${SENTINELS.host}"`);
    await run(() => store.consult(query()));
    await run(() => store.read());
    await run(() => store.grant(hostile));
    await run(() => store.revoke(trustEntry()));
    backend.seed({
      version: 1,
      entries: [{ ...trustEntry(), name: SENTINELS.name }],
    });
    await run(() => store.consult(query()));
    await run(() => store.revokeSubject(trustEntry()));
    backend.reject("read");
    await run(() => store.consult(query()));
    await run(() => store.revokeAll());
    backend.heal();
    backend.reject("write");
    await run(() => store.revokeAll());
    await run(() => store.grant(hostile));
    backend.heal();
    await run(() => store.revokeAll());
    await run(() => store.grant(hostile));

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(containsSentinel(JSON.stringify(outputs))).toBe(false);
    expect(containsSentinel(backend.raw() ?? "")).toBe(false);
    expect(outputs).toHaveLength(15);
    for (const item of bus.emitted)
      expect(Object.keys(item.payload as object)).toEqual(["revision"]);
  });
});
