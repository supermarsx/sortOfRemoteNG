import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionProvider,
  connectionReducer,
} from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { useTrustedRedirectDestinations } from "../../src/hooks/security/useTrustedRedirectDestinations";
import type { Connection } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { emptyDatabaseCredentialVault } from "../../src/utils/security/databaseCredentialVault";
import { applyTrustedRedirectChanges } from "../../src/utils/security/trustedRedirectManagement";

const h = vi.hoisted(() => ({
  currentId: "db-a",
  epoch: 1,
  locked: false,
  saved: null as StorageData | null,
  save: vi.fn(),
  read: vi.fn(),
  manager: {} as Record<string, unknown>,
  access: null as null | ((event: { databaseId: string }) => void),
  change: null as
    | null
    | ((event: { reason: string; database: null; databaseId: string }) => void),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));

const grant = (origins = ["https://destination.invalid"]) => ({
  version: 1 as const,
  origins,
});
const connection = (
  id: string,
  origins = ["https://destination.invalid"],
): Connection => ({
  id,
  name: `NAS ${id}`,
  hostname: `${id}.invalid`,
  protocol: "https",
  port: 443,
  isGroup: false,
  basicAuthUsername: "private-user",
  basicAuthPassword: "private-password",
  httpAutoLogin: true,
  httpTrustedRedirectDestinations: grant(origins),
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
});
const initial = (): StorageData => ({
  connections: [
    connection("one"),
    connection("two", [
      "https://destination.invalid",
      "https://retained.invalid",
    ]),
    { ...connection("ssh"), protocol: "ssh", port: 22 },
    { ...connection("folder"), isGroup: true },
  ],
  settings: { retained: "setting" },
  timestamp: 1,
  documents: emptyDatabaseDocuments(),
  credentialVault: emptyDatabaseCredentialVault(),
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  h.currentId = "db-a";
  h.epoch = 1;
  h.locked = false;
  h.saved = initial();
  h.save.mockReset().mockImplementation(async (data: StorageData) => {
    h.saved = JSON.parse(JSON.stringify(data)) as StorageData;
  });
  h.read.mockReset().mockImplementation(async () => structuredClone(h.saved));
  h.manager = {
    getCurrentDatabase: () => (h.currentId ? { id: h.currentId } : null),
    getDatabaseAccessState: () => ({
      status: h.locked ? "suspended" : "ready",
    }),
    onCurrentDatabaseChange: (listener: typeof h.change) => {
      h.change = listener;
      return () => {
        h.change = null;
      };
    },
    onDatabaseAccessChange: (listener: typeof h.access) => {
      h.access = listener;
      return () => {
        h.access = null;
      };
    },
    registerBeforeDatabaseTransition: () => () => undefined,
    captureCurrentDatabaseDataTarget: (): DatabaseDataTarget => {
      const id = h.currentId,
        epoch = h.epoch;
      let baseline: StorageData | null = null;
      const assertAccessible = () => {
        if (h.locked || h.currentId !== id || h.epoch !== epoch)
          throw new Error("private backend access failure");
      };
      return {
        databaseId: id,
        assertAccessible,
        load: async () => {
          assertAccessible();
          baseline = structuredClone(h.saved);
          return structuredClone(h.saved);
        },
        readCurrent: async () => {
          assertAccessible();
          const data = await h.read();
          assertAccessible();
          return data;
        },
        save: async (data) => {
          assertAccessible();
          if (JSON.stringify(h.saved) !== JSON.stringify(baseline))
            throw new Error("private CAS drift");
          await h.save(data);
          assertAccessible();
          baseline = structuredClone(data);
        },
      };
    },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount() {
  const hook = renderHook(
    () => ({
      context: useConnections(),
      redirects: useTrustedRedirectDestinations(),
    }),
    { wrapper },
  );
  await act(() => hook.result.current.context.loadData("db-a"));
  await waitFor(() =>
    expect(hook.result.current.redirects.loading).toBe(false),
  );
  return hook;
}
async function rejects(operation: () => Promise<void>, message: string) {
  await act(async () => {
    await expect(operation()).rejects.toThrow(message);
  });
}

describe("Trust Center database-owned redirect management", () => {
  it("lists only persisted saved HTTP(S) non-folder records with scope-qualified metadata", async () => {
    const view = await mount();
    expect(view.result.current.redirects.available).toBe(true);
    expect(
      view.result.current.redirects.connections.map((item) => item.id),
    ).toEqual(["one", "two"]);
    expect(view.result.current.redirects.rows).toHaveLength(3);
    expect(view.result.current.redirects.rows[0]).toMatchObject({
      connectionId: "one",
      connectionName: "NAS one",
      sourceOrigin: "https://one.invalid",
      origin: "https://destination.invalid",
    });
    expect(JSON.stringify(view.result.current.redirects)).not.toContain(
      "private-",
    );
    expect(h.save).not.toHaveBeenCalled();
  });

  it("adds a canonical origin using one existing Provider save and preserves credentials, documents, vault and settings", async () => {
    const view = await mount();
    const original = JSON.parse(
      JSON.stringify({
        ...h.saved!,
        connections: view.result.current.context.state.connections,
      }),
    ) as StorageData;
    await act(() =>
      view.result.current.redirects.add("one", "https://NEW.invalid:443/"),
    );
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.saved!.connections[0]).toEqual({
      ...original.connections[0],
      httpTrustedRedirectDestinations: grant([
        "https://destination.invalid",
        "https://new.invalid",
      ]),
    });
    expect(h.saved!.connections.slice(1)).toEqual(
      original.connections.slice(1),
    );
    expect(h.saved!.documents).toEqual(original.documents);
    expect(h.saved!.credentialVault).toEqual(original.credentialVault);
    expect(h.saved!.settings).toEqual(original.settings);
    expect(view.result.current.redirects.notice).toContain("destination saved");
  });

  it("forgets rows from multiple saved connections in one durable batch without changing other origins", async () => {
    const view = await mount();
    const rows = view.result.current.redirects.rows.filter(
      (row) => row.origin === "https://destination.invalid",
    );
    await act(() => view.result.current.redirects.forget(rows));
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.saved!.connections[0].httpTrustedRedirectDestinations).toEqual(
      grant([]),
    );
    expect(h.saved!.connections[1].httpTrustedRedirectDestinations).toEqual(
      grant(["https://retained.invalid"]),
    );
    expect(view.result.current.redirects.rows).toHaveLength(1);
  });

  it("rejects every selected row if one review has changed, with no partial forget", async () => {
    const view = await mount();
    const rows = view.result.current.redirects.rows.slice(0, 2);
    await act(() =>
      view.result.current.context.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: {
          ...view.result.current.context.state.connections[1],
          basicAuthPassword: "updated",
        },
      }),
    );
    await waitFor(() =>
      expect(view.result.current.redirects.loading).toBe(false),
    );
    h.save.mockClear();
    await rejects(() => view.result.current.redirects.forget(rows), "changed");
    expect(h.save).not.toHaveBeenCalled();
    expect(
      h.saved!.connections[0].httpTrustedRedirectDestinations?.origins,
    ).toContain("https://destination.invalid");
  });

  it.each(["different database", "same database new lease"])(
    "a retained Add callback cannot adopt a colliding saved ID in a %s",
    async (mode) => {
      const view = await mount();
      const oldAdd = view.result.current.redirects.add;
      const oldScope = view.result.current.redirects.scopeKey;
      h.currentId = mode === "different database" ? "db-b" : "db-a";
      h.epoch++;
      h.saved = initial();
      await act(() => view.result.current.context.loadData(h.currentId));
      await waitFor(() =>
        expect(view.result.current.redirects.loading).toBe(false),
      );
      expect(view.result.current.redirects.scopeKey).not.toBe(oldScope);
      expect(view.result.current.redirects.connections[0].id).toBe("one");
      h.save.mockClear();
      await rejects(() => oldAdd("one", "https://new.invalid"), "changed");
      expect(h.save).not.toHaveBeenCalled();
      expect(view.result.current.redirects.error).toBeNull();
      await act(() =>
        view.result.current.redirects.add("one", "https://current.invalid"),
      );
      expect(
        h.saved!.connections[0].httpTrustedRedirectDestinations?.origins,
      ).toContain("https://current.invalid");
    },
  );

  it("provides distinct repair guidance for malformed present settings without resetting data", async () => {
    const view = await mount();
    const malformed = grant(["https://user:private-secret@invalid.example"]);
    view.result.current.context.state.connections[0].httpTrustedRedirectDestinations =
      malformed;
    view.rerender();
    expect(view.result.current.redirects.available).toBe(false);
    expect(view.result.current.redirects.error).toContain(
      "HTTP(S) Advanced settings",
    );
    expect(view.result.current.redirects.error).not.toContain("private-secret");
    expect(view.result.current.redirects.rows).toEqual([]);
    expect(
      view.result.current.context.state.connections[0]
        .httpTrustedRedirectDestinations,
    ).toBe(malformed);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("merges only the trusted field into the latest synchronous Provider state", async () => {
    const view = await mount();
    const expected = structuredClone(
      view.result.current.context.state.connections[0],
    );
    const availability = view.result.current.context.databaseAvailability!;
    await act(async () => {
      view.result.current.context.dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...expected,
          name: "Concurrent renamed NAS",
          connectionCount: 5,
        },
      });
      await view.result.current.context.dispatchAndFlush({
        type: "UPDATE_HTTP_TRUSTED_REDIRECTS",
        payload: {
          databaseId: "db-a",
          generation: availability.generation,
          changes: [{ expected, destinations: grant([]) }],
        },
      });
    });
    expect(h.saved!.connections[0]).toMatchObject({
      name: "Concurrent renamed NAS",
      connectionCount: 5,
      httpTrustedRedirectDestinations: grant([]),
      basicAuthPassword: "private-password",
    });
  });

  it.each(["owner", "generation", "locked"])(
    "Provider rejects %s drift before any field changes or save",
    async (kind) => {
      const view = await mount();
      const expected = view.result.current.context.state.connections[0];
      const availability = view.result.current.context.databaseAvailability!;
      if (kind === "locked") h.locked = true;
      await rejects(
        () =>
          view.result.current.context.dispatchAndFlush({
            type: "UPDATE_HTTP_TRUSTED_REDIRECTS",
            payload: {
              databaseId: kind === "owner" ? "db-b" : "db-a",
              generation:
                availability.generation + (kind === "generation" ? 1 : 0),
              changes: [{ expected, destinations: grant([]) }],
            },
          }),
        kind === "locked" ? "access failure" : "Open and unlock",
      );
      expect(h.save).not.toHaveBeenCalled();
      expect(view.result.current.context.state.connections[0]).toEqual(
        expected,
      );
    },
  );

  it("does not publish optimistic grants after a failed save and offers an explicit refresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await mount();
    h.save.mockRejectedValue(
      new Error("private secret-bearing save diagnostic"),
    );
    await rejects(
      () => view.result.current.redirects.add("one", "https://new.invalid"),
      "could not be verified as saved",
    );
    expect(view.result.current.redirects.notice).toBeNull();
    expect(view.result.current.redirects.rows).toEqual([]);
    expect(view.result.current.redirects.error).not.toContain("private");
    expect(
      h.saved!.connections[0].httpTrustedRedirectDestinations?.origins,
    ).not.toContain("https://new.invalid");
    await act(() => view.result.current.redirects.refresh());
    expect(view.result.current.redirects.rows).toEqual([]);
    expect(view.result.current.redirects.error).toContain("verified");
  });

  it("rejects a successful-looking write without matching durable readback", async () => {
    const view = await mount();
    h.save.mockResolvedValue(undefined);
    await rejects(
      () => view.result.current.redirects.add("one", "https://new.invalid"),
      "could not be verified as saved",
    );
    expect(view.result.current.redirects.notice).toBeNull();
    expect(view.result.current.redirects.rows).toEqual([]);
  });

  it("detects same-tick renderer revocation before React commits during durable readback", async () => {
    const view = await mount();
    const read = h.read.getMockImplementation()!;
    h.read.mockImplementation(async () => {
      const data = await read();
      if (h.save.mock.calls.length) {
        const scope = view.result.current.context.databaseAvailability!;
        const latest = view.result.current.context.getCurrentConnections!({
          databaseId: "db-a",
          generation: scope.generation,
        })[0];
        view.result.current.context.dispatch({
          type: "UPDATE_CONNECTION",
          payload: { ...latest, httpTrustedRedirectDestinations: grant([]) },
        });
      }
      return data;
    });
    await rejects(
      () => view.result.current.redirects.add("one", "https://new.invalid"),
      "could not be verified as saved",
    );
    expect(view.result.current.redirects.notice).toBeNull();
    expect(view.result.current.redirects.rows).toEqual([]);
  });

  it("blocks cross-window changed persisted preferences rather than silently overwriting or blessing a baseline", async () => {
    const view = await mount();
    h.saved!.connections[0].httpTrustedRedirectDestinations = grant([
      "https://external.invalid",
    ]);
    await act(() => view.result.current.redirects.refresh());
    expect(view.result.current.redirects.rows).toEqual([]);
    await rejects(
      () => view.result.current.redirects.add("one", "https://new.invalid"),
      "changed",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(
      h.saved!.connections[0].httpTrustedRedirectDestinations?.origins,
    ).toEqual(["https://external.invalid"]);
  });

  it.each([
    "https://user:secret@bad.invalid",
    "https://bad.invalid/path",
    "javascript:alert(1)",
  ])(
    "rejects invalid origin %s before writes while retaining valid rows",
    async (origin) => {
      const view = await mount();
      await rejects(
        () => view.result.current.redirects.add("one", origin),
        "exact HTTP(S) origin",
      );
      expect(h.save).not.toHaveBeenCalled();
      expect(view.result.current.redirects.rows).toHaveLength(3);
      await act(() =>
        view.result.current.redirects.add("one", "https://valid.invalid"),
      );
      expect(view.result.current.redirects.notice).toContain("saved");
    },
  );

  it("enforces the 32-origin limit with actionable guidance", async () => {
    h.saved!.connections[0].httpTrustedRedirectDestinations = grant(
      Array.from({ length: 32 }, (_, index) => `https://host${index}.invalid`),
    );
    const view = await mount();
    await rejects(
      () => view.result.current.redirects.add("one", "https://new.invalid"),
      "32 trusted destinations",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(view.result.current.redirects.connections).toHaveLength(2);
  });

  it("latches the original database lease across lock/unlock ABA during mutation reads", async () => {
    const view = await mount();
    const deferredRead = deferred<StorageData | null>();
    h.read.mockImplementationOnce(() => deferredRead.promise);
    const pending = view.result.current.redirects.add(
      "one",
      "https://new.invalid",
    );
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2));
    h.epoch++;
    deferredRead.resolve(h.saved);
    await rejects(() => pending, "could not be verified as saved");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("hides stale rows immediately on database suspension and does not publish a delayed read after unmount", async () => {
    const view = await mount();
    const oldKey = view.result.current.redirects.scopeKey;
    await act(async () => {
      h.locked = true;
      h.epoch++;
      h.access?.({ databaseId: "db-a" });
    });
    expect(view.result.current.redirects.scopeKey).not.toBe(oldKey);
    expect(view.result.current.redirects.rows).toEqual([]);
    expect(view.result.current.redirects.available).toBe(false);
    h.locked = false;
    await act(() => view.result.current.context.loadData("db-a"));
    await waitFor(() =>
      expect(view.result.current.redirects.loading).toBe(false),
    );
    const pendingRead = deferred<StorageData | null>();
    h.read.mockImplementationOnce(() => pendingRead.promise);
    const pending = view.result.current.redirects.refresh();
    view.unmount();
    pendingRead.resolve(h.saved);
    await pending;
    expect(h.save).not.toHaveBeenCalled();
  });

  it("validates all reducer targets before producing any changed row, and bounds malformed batches", async () => {
    const view = await mount();
    const state = view.result.current.context.state;
    const first = state.connections[0],
      second = state.connections[1];
    const stale = { ...second, basicAuthPassword: "stale" };
    expect(() =>
      connectionReducer(state, {
        type: "UPDATE_HTTP_TRUSTED_REDIRECTS",
        payload: {
          databaseId: "db-a",
          generation: 1,
          changes: [
            { expected: first, destinations: grant([]) },
            { expected: stale, destinations: grant([]) },
          ],
        },
      }),
    ).toThrow("changed");
    expect(
      state.connections[0].httpTrustedRedirectDestinations?.origins,
    ).toHaveLength(1);
    expect(() => applyTrustedRedirectChanges(state.connections, [])).toThrow(
      "128",
    );
    expect(() =>
      applyTrustedRedirectChanges(
        state.connections,
        Array.from({ length: 129 }, () => ({
          expected: first,
          destinations: grant([]),
        })),
      ),
    ).toThrow("128");
    expect(() =>
      applyTrustedRedirectChanges(state.connections, [
        { expected: first, destinations: grant([]) },
        { expected: first, destinations: grant([]) },
      ]),
    ).toThrow("changed");
    expect(() =>
      applyTrustedRedirectChanges(state.connections, [
        { expected: state.connections[2], destinations: grant([]) },
      ]),
    ).toThrow("changed");
  });
});
