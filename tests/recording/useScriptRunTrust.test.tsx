import React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptTrustReconciler } from "../../src/components/recording/scriptTrust/ScriptTrustReconciler";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import {
  useScriptRunTrust,
  useScriptTrustMarks,
  type ScriptTrustMarkSubject,
} from "../../src/hooks/recording/useScriptRunTrust";
import {
  deletedDatabaseId,
  useScriptRunTrustReconciler,
} from "../../src/hooks/recording/useScriptRunTrustReconciler";
import type { Connection } from "../../src/types/connection/connection";
import {
  digestRunContent,
  scriptTrustSubjectKey,
  sshMacroRunContent,
  sshScriptRunContent,
  type ScriptTrustEntry,
} from "../../src/utils/recording/scriptRunTrust";
import { grantScriptTrust } from "../../src/utils/recording/scriptRunTrustStore";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import {
  SCRIPT_TRUST_TEST_KEY,
  SENTINELS,
  connectionTrustEntry,
  containsSentinel,
  createScriptTrustTestBackend,
  fakeDigest,
  scriptTrustTauriEvents as bus,
  trustEntry,
  type ScriptTrustTestBackend,
} from "./scriptTrustTestBackend";

vi.mock("@tauri-apps/api/event", async () =>
  (await import("./scriptTrustTestBackend")).scriptTrustTauriEvents.module(),
);

const database = vi.hoisted(() => ({
  listeners: new Set<(change: unknown) => void>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: (listener: (change: unknown) => void) => {
    database.listeners.add(listener);
    return () => {
      database.listeners.delete(listener);
    };
  },
}));

let backend: ScriptTrustTestBackend;
const record = (...entries: ScriptTrustEntry[]) => ({ version: 1, entries });
const announce = (key: unknown = SCRIPT_TRUST_TEST_KEY) =>
  window.dispatchEvent(
    new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, { detail: { key } }),
  );
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  backend = createScriptTrustTestBackend();
  backend.install();
  bus.reset();
  database.listeners.clear();
});
afterEach(() => {
  backend.uninstall();
  vi.restoreAllMocks();
});

describe("useScriptRunTrust", () => {
  it("loads the record for display", async () => {
    backend.seed(record(trustEntry(), connectionTrustEntry()));
    const view = renderHook(() => useScriptRunTrust());
    expect(view.result.current).toMatchObject({
      status: "loading",
      reason: null,
      entries: [],
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.entries).toStrictEqual([
      trustEntry(),
      connectionTrustEntry(),
    ]);
    expect(view.result.current.reason).toBeNull();
    // No way to grant from here: a grant is made by the prompt's own flow.
    expect(Object.keys(view.result.current).sort()).toEqual([
      "entries",
      "reason",
      "refresh",
      "revoke",
      "revokeAll",
      "revokeSubject",
      "status",
    ]);
  });

  it("reads an absent record as an empty one", async () => {
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.entries).toStrictEqual([]);
    expect(backend.writes()).toBe(0);
  });

  it("reads again on this window's event, for this key only", async () => {
    backend.seed(record(trustEntry()));
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(view.result.current.entries).toHaveLength(1));
    const reads = backend.reads();
    backend.seed(record());
    act(() => {
      announce("recording.managed-scripts");
      announce("automation.run-trust");
      // Not through `announce`: its default would name this very key.
      for (const detail of [{ key: undefined }, { key: null }, {}, null])
        window.dispatchEvent(
          new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, { detail }),
        );
      window.dispatchEvent(new CustomEvent(APP_DATA_STORE_CHANGED_EVENT));
    });
    await settle();
    expect(backend.reads()).toBe(reads);
    expect(view.result.current.entries).toHaveLength(1);
    act(() => {
      announce();
    });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(0));
    expect(backend.reads()).toBe(reads + 1);
  });

  it("reads again on the cross-window event, and stops listening when it unmounts", async () => {
    backend.seed(record(trustEntry()));
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(view.result.current.entries).toHaveLength(1));
    await waitFor(() => expect(bus.listeners()).toBe(1));
    // Another window revoked it: no window event here, only the Tauri one.
    backend.seed(record());
    act(() => {
      bus.deliver("settings-sync");
    });
    await settle();
    expect(view.result.current.entries).toHaveLength(1);
    act(() => {
      bus.deliver();
    });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(0));

    const reads = backend.reads();
    view.unmount();
    expect(bus.listeners()).toBe(0);
    bus.deliver();
    announce();
    await settle();
    expect(backend.reads()).toBe(reads);
  });

  it("keeps the newest read when an older one answers late", async () => {
    backend.seed(record(trustEntry()));
    let releaseFirst!: () => void;
    backend.afterNextRead(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(backend.reads()).toBe(1));
    // The first read holds the old value; the record changes and is read again.
    backend.seed(record());
    act(() => {
      announce();
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.entries).toHaveLength(0);
    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.result.current.entries).toHaveLength(0);
  });

  it.each([
    ["damaged", () => backend.setRaw("{not json"), "unreadable"],
    [
      "partly invalid",
      () =>
        backend.seed({
          version: 1,
          entries: [trustEntry(), { ...trustEntry(), kind: "?" }],
        }),
      "unreadable",
    ],
    ["refused", () => backend.reject("read"), "unreadable"],
    ["outside the desktop app", () => backend.uninstall(), "unavailable"],
  ] as const)(
    "shows nothing as trusted when the record is %s",
    async (_label, arrange, reason) => {
      arrange();
      const view = renderHook(() => useScriptRunTrust());
      await waitFor(() =>
        expect(view.result.current.status).toBe("unavailable"),
      );
      expect(view.result.current.reason).toBe(reason);
      expect(view.result.current.entries).toStrictEqual([]);
    },
  );

  it("repairs an unreadable record with a reset, and revokes through the store", async () => {
    backend.setRaw("{not json");
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(view.result.current.status).toBe("unavailable"));
    await act(async () => {
      expect(await view.result.current.revokeAll()).toStrictEqual({
        ok: true,
        removed: 0,
      });
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(backend.raw()).toBe('{"version":1,"entries":[]}');

    backend.seed(
      record(
        trustEntry(),
        connectionTrustEntry(),
        trustEntry({ subjectId: "script-2" }),
      ),
    );
    act(() => {
      announce();
    });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(3));
    await act(async () => {
      expect(
        await view.result.current.revoke(view.result.current.entries[1]),
      ).toStrictEqual({ ok: true, removed: 1 });
    });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(2));
    await act(async () => {
      expect(
        await view.result.current.revokeSubject({
          kind: "ssh-script",
          library: { kind: "app" },
          subjectId: "script-1",
        }),
      ).toStrictEqual({ ok: true, removed: 1 });
    });
    await waitFor(() =>
      expect(view.result.current.entries).toStrictEqual([
        trustEntry({ subjectId: "script-2" }),
      ]),
    );
    backend.reject("write", 1);
    await act(async () => {
      expect(await view.result.current.revokeAll()).toStrictEqual({
        ok: false,
        reason: "failed",
      });
    });
    // The failed revoke is reported, and the entry is shown again.
    await waitFor(() => expect(view.result.current.entries).toHaveLength(1));
    expect(backend.stored().entries).toHaveLength(1);
  });

  it("keeps the same functions and the same list between renders", async () => {
    backend.seed(record(trustEntry()));
    const view = renderHook(() => useScriptRunTrust());
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    const first = view.result.current;
    act(() => {
      announce();
    });
    await settle();
    view.rerender();
    expect(view.result.current.entries).toBe(first.entries);
    expect(view.result.current.revoke).toBe(first.revoke);
    expect(view.result.current.refresh).toBe(first.refresh);
  });
});

describe("useScriptTrustMarks", () => {
  const binding = {
    databaseId: "db-1",
    connectionId: "conn-1",
    endpointDigest: fakeDigest("endpoint-1"),
  };
  const scriptSubject = (
    subjectId: string,
    text: string,
    language = "bash",
  ): ScriptTrustMarkSubject => ({
    kind: "ssh-script",
    library: { kind: "app" },
    subjectId,
    content: sshScriptRunContent(language, text),
  });
  const digestOf = (subject: ScriptTrustMarkSubject) =>
    digestRunContent(subject.kind, subject.content);
  const keyOf = (subject: ScriptTrustMarkSubject) =>
    scriptTrustSubjectKey(subject);

  it("marks a script only for the exact content and the exact binding", async () => {
    const one = scriptSubject("script-1", "echo one");
    const two = scriptSubject("script-2", "echo two");
    const three = scriptSubject("script-3", "echo three");
    const macro: ScriptTrustMarkSubject = {
      kind: "ssh-macro",
      library: { kind: "database", databaseId: "db-1" },
      subjectId: "script-1",
      content: sshMacroRunContent([
        { command: "ls", delayMs: 0, sendNewline: true },
      ]),
    };
    backend.seed(
      record(
        connectionTrustEntry({ contentDigest: await digestOf(one) }),
        trustEntry({
          subjectId: "script-2",
          contentDigest: await digestOf(two),
        }),
        // Trusted for other content than the library holds now.
        trustEntry({
          subjectId: "script-3",
          contentDigest: await digestOf(scriptSubject("script-3", "echo 3")),
        }),
        trustEntry({
          kind: "ssh-macro",
          library: { kind: "database", databaseId: "db-1" },
          subjectId: "script-1",
          contentDigest: await digestOf(macro),
        }),
      ),
    );
    const subjects = [one, two, three, macro];
    const view = renderHook(
      (props: { bound: typeof binding | null; list: typeof subjects }) =>
        useScriptTrustMarks(props.list, props.bound),
      {
        initialProps: {
          bound: binding as typeof binding | null,
          list: subjects,
        },
      },
    );
    expect(view.result.current.size).toBe(0);
    await waitFor(() => expect(view.result.current.size).toBe(3));
    expect(Array.from(view.result.current)).toEqual([
      [keyOf(one), "connection"],
      [keyOf(two), "everywhere"],
      [keyOf(macro), "everywhere"],
    ]);

    // Another connection, a changed endpoint, no verified connection at all.
    for (const bound of [
      { ...binding, connectionId: "conn-2" },
      { ...binding, databaseId: "db-2" },
      { ...binding, endpointDigest: fakeDigest("endpoint-edited") },
      null,
    ]) {
      view.rerender({ bound, list: subjects });
      await waitFor(() => expect(view.result.current.size).toBe(2));
      expect(view.result.current.has(keyOf(one))).toBe(false);
    }
    view.rerender({ bound: binding, list: subjects });
    await waitFor(() => expect(view.result.current.size).toBe(3));

    // One character edited: no mark. Edited back: marked again.
    const edited = [scriptSubject("script-1", "echo onf"), two, three, macro];
    view.rerender({ bound: binding, list: edited });
    await waitFor(() =>
      expect(view.result.current.has(keyOf(one))).toBe(false),
    );
    view.rerender({
      bound: binding,
      list: [scriptSubject("script-1", "echo one", "sh"), two, three, macro],
    });
    await settle();
    expect(view.result.current.has(keyOf(one))).toBe(false);
    view.rerender({ bound: binding, list: subjects });
    await waitFor(() => expect(view.result.current.has(keyOf(one))).toBe(true));
    // The same id in another library is another script.
    view.rerender({
      bound: binding,
      list: [
        { ...two, library: { kind: "database", databaseId: "db-1" } },
        { ...two, kind: "bulk-script" },
      ],
    });
    await waitFor(() => expect(view.result.current.size).toBe(0));
  });

  it("drops a mark as soon as the entry is revoked, here or in another window", async () => {
    const one = scriptSubject("script-1", "echo one");
    const subjects = [one];
    backend.seed(record(trustEntry({ contentDigest: await digestOf(one) })));
    const view = renderHook(() => useScriptTrustMarks(subjects, null));
    await waitFor(() => expect(view.result.current.size).toBe(1));
    backend.seed(record());
    act(() => {
      bus.deliver();
    });
    await waitFor(() => expect(view.result.current.size).toBe(0));
    // Granted again through the store: the mark returns without a remount.
    await act(async () => {
      const granted = await grantScriptTrust({
        kind: "ssh-script",
        library: { kind: "app" },
        subjectId: "script-1",
        contentDigest: await digestOf(one),
        scope: "everywhere",
        risk: "standard",
      });
      expect(granted.ok).toBe(true);
    });
    await waitFor(() => expect(view.result.current.size).toBe(1));
  });

  it("marks nothing while the record cannot be read", async () => {
    const one = scriptSubject("script-1", "echo one");
    const subjects = [one];
    backend.seed({
      version: 1,
      entries: [trustEntry({ contentDigest: await digestOf(one) }), {}],
    });
    const view = renderHook(() => useScriptTrustMarks(subjects, null));
    await settle();
    await settle();
    expect(view.result.current.size).toBe(0);
    backend.seed(record(trustEntry({ contentDigest: await digestOf(one) })));
    act(() => {
      announce();
    });
    await waitFor(() => expect(view.result.current.size).toBe(1));
    backend.reject("read");
    act(() => {
      announce();
    });
    await waitFor(() => expect(view.result.current.size).toBe(0));
  });

  it("settles when the caller builds a new list on every render", async () => {
    const one = scriptSubject("script-1", "echo one");
    backend.seed(record(trustEntry({ contentDigest: await digestOf(one) })));
    let renders = 0;
    const view = renderHook(() => {
      renders += 1;
      return useScriptTrustMarks([{ ...one }], null);
    });
    await waitFor(() => expect(view.result.current.size).toBe(1));
    await settle();
    await settle();
    const settled = renders;
    await settle();
    expect(renders).toBe(settled);
    expect(renders).toBeLessThan(12);
  });
});

describe("the reconciler", () => {
  const row = (id: string): Connection =>
    ({ id, name: id, protocol: "ssh", hostname: "h", port: 22 }) as Connection;
  const bound = (databaseId: string, connectionId: string, subjectId: string) =>
    connectionTrustEntry({
      subjectId,
      connection: {
        databaseId,
        connectionId,
        endpointDigest: fakeDigest("endpoint-1"),
      },
    });
  const seedBound = () =>
    backend.seed(
      record(
        trustEntry(),
        bound("db-1", "conn-1", "a"),
        bound("db-1", "conn-2", "b"),
        bound("db-2", "conn-1", "c"),
        trustEntry({
          kind: "ssh-macro",
          subjectId: "m",
          library: { kind: "database", databaseId: "db-2" },
        }),
      ),
    );
  const subjects = () =>
    backend.stored().entries.map((entry) => entry.subjectId);

  const contextValue = (options: {
    status?: "none" | "loading" | "ready" | "suspended" | "error";
    databaseId?: string;
    binDatabaseId?: string | null;
    binned?: string[];
    live?: string[];
  }): ConnectionContextType =>
    ({
      state: { connections: (options.live ?? []).map(row) },
      databaseAvailability: {
        status: options.status ?? "ready",
        databaseId: options.databaseId ?? "db-1",
        generation: 3,
      },
      recycleBin:
        options.binDatabaseId === null
          ? { snapshot: null }
          : {
              snapshot: {
                scope: {
                  databaseId: options.binDatabaseId ?? "db-1",
                  generation: 9,
                  revision: "r1",
                },
                policy: { mode: "forever" },
                entries: (options.binned ?? []).map((connectionId, index) => ({
                  id: `bin-${index}`,
                  batchId: "batch",
                  connectionId,
                  name: SENTINELS.name,
                  protocol: "ssh",
                  isGroup: false,
                  deletedAt: 1,
                  expiresAt: null,
                  descendantCount: 0,
                })),
              },
            },
    }) as unknown as ConnectionContextType;

  const mount = (value: ConnectionContextType | undefined) => {
    const Harness = ({
      current,
    }: {
      current: ConnectionContextType | undefined;
    }) => (
      <ConnectionContext.Provider value={current}>
        <ScriptTrustReconciler />
      </ConnectionContext.Provider>
    );
    const view = render(<Harness current={value} />);
    return {
      ...view,
      update: (next: ConnectionContextType | undefined) =>
        view.rerender(<Harness current={next} />),
    };
  };

  it("renders nothing", async () => {
    const view = mount(contextValue({}));
    expect(view.container.innerHTML).toBe("");
    await settle();
    expect(backend.writes()).toBe(0);
  });

  it("removes the entries of a connection that is in the ready database's bin", async () => {
    seedBound();
    mount(contextValue({ binned: ["conn-1", "conn-7"], live: ["conn-2"] }));
    await waitFor(() =>
      expect(subjects()).toEqual(["script-1", "b", "c", "m"]),
    );
    // The same connection id in another database, the other connection and
    // "everywhere" entries are untouched.
    await settle();
    expect(backend.commits()).toBe(1);
  });

  it.each([
    [
      "the database is still loading",
      { status: "loading", binned: ["conn-1"] },
    ],
    ["the database is suspended", { status: "suspended", binned: ["conn-1"] }],
    ["no database is open", { status: "none", binned: ["conn-1"] }],
    ["the bin is not available", { binDatabaseId: null }],
    ["the bin is empty", { binned: [] }],
    [
      "the bin belongs to another database than the ready one",
      { binDatabaseId: "db-2", binned: ["conn-1"] },
    ],
    [
      "the ready database is another one",
      { databaseId: "db-3", binDatabaseId: "db-1", binned: ["conn-1"] },
    ],
    [
      "the id is also a live connection",
      { binned: ["conn-1"], live: ["conn-1"] },
    ],
    ["the id is not an id", { binned: ["", "a\nb"] }],
  ] as const)("removes nothing when %s", async (_label, options) => {
    seedBound();
    const raw = backend.raw();
    mount(contextValue(options as never));
    await settle();
    await settle();
    expect(backend.raw()).toBe(raw);
    expect(backend.writes()).toBe(0);
  });

  it("removes nothing without a connection context, and does not throw", async () => {
    seedBound();
    const view = mount(undefined);
    await settle();
    expect(view.container.innerHTML).toBe("");
    expect(backend.writes()).toBe(0);
    renderHook(() => useScriptRunTrustReconciler());
    await settle();
    expect(backend.writes()).toBe(0);
  });

  it("acts when the connection reaches the bin, and on a grant that lands afterwards", async () => {
    seedBound();
    const view = mount(contextValue({ live: ["conn-1", "conn-2"] }));
    await settle();
    expect(backend.writes()).toBe(0);
    view.update(contextValue({ binned: ["conn-2"], live: ["conn-1"] }));
    await waitFor(() =>
      expect(subjects()).toEqual(["script-1", "a", "c", "m"]),
    );
    // Another window's grant for the deleted connection arrives late.
    backend.seed(
      record(...backend.stored().entries, bound("db-1", "conn-2", "late")),
    );
    act(() => {
      bus.deliver();
    });
    await waitFor(() =>
      expect(subjects()).toEqual(["script-1", "a", "c", "m"]),
    );
    // Restored from the bin: its entries are gone, and nothing else is removed.
    view.update(contextValue({ binned: [], live: ["conn-1", "conn-2"] }));
    await settle();
    expect(subjects()).toEqual(["script-1", "a", "c", "m"]);
  });

  it("does not keep writing or reading when nothing is left to remove", async () => {
    seedBound();
    mount(contextValue({ binned: ["conn-1"] }));
    await waitFor(() => expect(subjects()).not.toContain("a"));
    await settle();
    await settle();
    const calls = backend.calls.length;
    await settle();
    expect(backend.calls.length).toBe(calls);
    expect(backend.commits()).toBe(1);
  });

  it("removes a deleted database's entries, whichever way the event names it", async () => {
    const emit = (change: unknown) =>
      act(() => {
        for (const listener of Array.from(database.listeners)) listener(change);
      });
    seedBound();
    const view = mount(contextValue({}));
    expect(database.listeners.size).toBe(1);

    // Not a deletion, or a deletion the event does not name with certainty.
    for (const change of [
      {
        reason: "close",
        database: null,
        databaseId: null,
        previousDatabaseId: "db-2",
      },
      {
        reason: "switch",
        database: { id: "db-1" },
        databaseId: "db-1",
        previousDatabaseId: "db-2",
      },
      {
        reason: "lock",
        database: null,
        databaseId: "db-2",
        previousDatabaseId: "db-2",
      },
      {
        reason: "delete",
        database: null,
        databaseId: null,
        previousDatabaseId: null,
      },
      {
        reason: "delete",
        database: { id: "db-2" },
        databaseId: "db-2",
        previousDatabaseId: "db-1",
      },
      {
        reason: "delete",
        database: { id: "db-1" },
        databaseId: null,
        previousDatabaseId: "db-2",
      },
      {
        reason: "delete",
        database: null,
        databaseId: "",
        previousDatabaseId: "db-2",
      },
    ])
      emit(change);
    await settle();
    expect(backend.writes()).toBe(0);

    // Another database than the open one was deleted.
    emit({
      reason: "delete",
      database: { id: "db-1" },
      databaseId: "db-2",
      previousDatabaseId: "db-1",
    });
    await waitFor(() => expect(subjects()).toEqual(["script-1", "a", "b"]));

    // The open database itself was deleted (here, or noticed from another window).
    emit({
      reason: "delete",
      database: null,
      databaseId: null,
      previousDatabaseId: "db-1",
    });
    await waitFor(() => expect(subjects()).toEqual(["script-1"]));

    view.unmount();
    expect(database.listeners.size).toBe(0);
  });

  it("reads the deleted database's id from the event, or nothing", () => {
    const change = (
      databaseId: string | null,
      active: string | null,
      previous: string | null,
      reason = "delete",
    ) =>
      ({
        reason,
        database: active ? { id: active } : null,
        databaseId,
        previousDatabaseId: previous,
      }) as never;
    expect(deletedDatabaseId(change("db-2", "db-1", "db-1"))).toBe("db-2");
    expect(deletedDatabaseId(change("db-2", null, null))).toBe("db-2");
    expect(deletedDatabaseId(change(null, null, "db-1"))).toBe("db-1");
    expect(deletedDatabaseId(change(null, null, null))).toBeNull();
    expect(deletedDatabaseId(change(null, "db-1", "db-2"))).toBeNull();
    expect(deletedDatabaseId(change("db-1", "db-1", "db-2"))).toBeNull();
    expect(deletedDatabaseId(change("a\nb", null, null))).toBeNull();
    expect(deletedDatabaseId(change(null, null, "db-1", "close"))).toBeNull();
    expect(
      deletedDatabaseId(change("db-2", "db-1", "db-1", "lock")),
    ).toBeNull();
  });

  it("says nothing about what it removed", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    seedBound();
    mount(contextValue({ binned: ["conn-1"] }));
    await waitFor(() => expect(subjects()).not.toContain("a"));
    backend.reject("read");
    act(() => {
      bus.deliver();
    });
    await settle();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(containsSentinel(backend.raw() ?? "")).toBe(false);
  });
});
