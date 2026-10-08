import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { DatabaseProtectionUnlockResult } from "../../src/types/encryption/databaseProtection";
import type { DatabaseCredentialEntry } from "../../src/types/security/databaseCredentialVault";
import type { StorageData } from "../../src/utils/storage/storage";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));

// Model serde_json::Value independently of the application's comparator:
// objects round-trip in sorted key order; array positions remain significant.
function nativeJson<T>(value: T): T {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry !== null && typeof entry === "object")
      return Object.fromEntries(
        Object.keys(entry)
          .sort()
          .map((key) => [key, sort((entry as Record<string, unknown>)[key])]),
      );
    return entry;
  };
  return sort(JSON.parse(JSON.stringify(value))) as T;
}

const databaseId = "native-vault-fixture";
const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const date = "2026-09-10T00:00:00.000Z";
const entry = (): DatabaseCredentialEntry => ({
  id: credentialId,
  name: "Synthetic reusable credential",
  createdAt: date,
  updatedAt: date,
  facets: { username: "SYNTHETIC_ACCOUNT", password: "SYNTHETIC_PASSWORD" },
});
let rows: ConnectionDatabase[];
let lease: DatabaseProtectionUnlockResult;
let manager: DatabaseManager;
const writes = () =>
  bridge.invoke.mock.calls.filter(
    ([command]) => command === "database_protection_save",
  );

beforeEach(async () => {
  DatabaseManager.resetInstance();
  vi.clearAllMocks();
  rows = [
    {
      id: databaseId,
      name: "Synthetic managed database",
      isEncrypted: true,
      protectionFormat: "sorng-db",
      securityRevision: "fixture-security-revision",
      createdAt: date,
      updatedAt: date,
      lastAccessed: date,
    },
  ];
  lease = nativeJson({
    sessionId: "synthetic-native-session",
    sessionExpiresAt: Date.now() + 900_000,
    securityRevision: rows[0].securityRevision!,
    data: {
      connections: [
        {
          id: "connection-fixture",
          name: "Local credential connection",
          protocol: "ssh",
          hostname: "fixture.invalid",
          port: 22,
          isGroup: false,
          createdAt: date,
          updatedAt: date,
          username: "SYNTHETIC_ACCOUNT",
          password: "SYNTHETIC_PASSWORD",
        },
      ],
      settings: { retained: true },
      timestamp: Date.parse(date),
    },
  });
  bridge.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case "databases_list":
          return nativeJson({ value: rows, source: "current" });
        case "databases_save_index":
          expect(nativeJson(args.expectedList)).toEqual(rows);
          rows = nativeJson(args.list as ConnectionDatabase[]);
          return;
        case "database_protection_unlock":
          expect(args.databaseId).toBe(databaseId);
          return nativeJson(lease);
        case "database_protection_load":
        case "database_protection_save": {
          expect(args).toMatchObject({
            databaseId,
            sessionId: lease.sessionId,
            expectedSecurityRevision: lease.securityRevision,
          });
          if (command === "database_protection_load") return nativeJson(lease);
          // Native CAS compares JSON structure, not insertion order or references.
          if (
            JSON.stringify(nativeJson(args.expectedData)) !==
            JSON.stringify(lease.data)
          )
            throw new Error(
              "Native database contents changed; no write committed.",
            );
          lease.data = nativeJson(args.data as StorageData);
          return {
            committed: true,
            cleanupPending: false,
            warnings: [],
            securityRevision: lease.securityRevision,
          };
        }
        case "database_protection_status":
          expect(args.databaseId).toBe(databaseId);
          return {
            kind: "managed",
            dataCipher: "aes-256-gcm",
            unlocked: true,
            securityRevision: lease.securityRevision,
            slots: [],
          };
        case "database_browser_sessions_describe":
          expect(args).toEqual({
            databaseId,
            sessionId: lease.sessionId,
            expectedSecurityRevision: lease.securityRevision,
          });
          return { version: 1, records: [] };
        case "trust_set_active_database":
          return;
        default:
          throw new Error(`Unexpected native fixture command: ${command}`);
      }
    },
  );
  manager = DatabaseManager.getInstance();
  await manager.unlockManagedDatabase(
    databaseId,
    "synthetic-slot",
    "SYNTHETIC_UNLOCK",
  );
  await manager.selectDatabase(databaseId);
});

afterEach(() => {
  cleanup();
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
});

async function mount() {
  const hook = renderHook(() => useConnections(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    ),
  });
  await act(async () => {
    expect(await hook.result.current.loadData(databaseId)).toBe(true);
  });
  expect(hook.result.current.databaseAvailability?.status).toBe("ready");
  return hook;
}

async function putCredential(hook: Awaited<ReturnType<typeof mount>>) {
  const api = hook.result.current.credentialVault!;
  const review = await api.list(api.scope!);
  await act(async () => {
    await api.compareAndSwap(review, [{ operation: "put", entry: entry() }]);
  });
  const current = hook.result.current.credentialVault!;
  return current.list(current.scope!);
}

describe("credential vault through the real provider and native-round-trip manager", () => {
  it("survives ordinary autosave, vault CAS, local-to-vault reference save, and reload", async () => {
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    expect((await api.list(api.scope!)).entries).toEqual([]);
    const beforeAutosave = writes().length;
    act(() =>
      hook.result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...hook.result.current.state.connections[0],
          name: "Autosaved before vault listing",
        },
      }),
    );
    // Exercise the actual 500ms debounce instead of bypassing it with target.save.
    await waitFor(
      () => {
        expect(lease.data.connections[0].name).toBe(
          "Autosaved before vault listing",
        );
        expect(hook.result.current.persistence.dirty).toBe(false);
      },
      { timeout: 3000 },
    );
    expect(writes().length).toBe(beforeAutosave + 1);
    expect((await api.list(api.scope!)).entries).toEqual([]);

    const review = await putCredential(hook);
    expect(review.entries).toEqual([
      {
        id: credentialId,
        name: entry().name,
        createdAt: date,
        updatedAt: date,
        availableFacets: ["username", "password"],
      },
    ]);
    expect(JSON.stringify(review)).not.toContain("SYNTHETIC_PASSWORD");
    const current = hook.result.current.credentialVault!;
    expect(
      await current.resolve(review, credentialId, ["username", "password"]),
    ).toEqual(entry().facets);
    // Match conversion's order: save and verify the vault before clearing local fields.
    expect(lease.data.connections[0].password).toBe("SYNTHETIC_PASSWORD");
    await act(async () => {
      await hook.result.current.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: {
          ...hook.result.current.state.connections[0],
          username: undefined,
          password: undefined,
          credentialSource: { kind: "vault", credentialId },
        },
      });
    });
    expect(lease.data.credentialVault?.entries).toEqual([entry()]);
    expect(lease.data.connections[0]).not.toHaveProperty("password");
    expect(lease.data.connections[0]).not.toHaveProperty("username");
    expect(lease.data.connections[0].credentialSource).toEqual({
      kind: "vault",
      credentialId,
    });
    expect(lease.data.settings).toEqual({ retained: true });
    await act(async () => {
      await hook.result.current.loadData(databaseId);
    });
    const reloaded = hook.result.current.credentialVault!;
    const reloadedReview = await reloaded.list(reloaded.scope!);
    expect(reloadedReview.entries).toEqual(review.entries);
    expect(
      await reloaded.resolve(reloadedReview, credentialId, ["password"]),
    ).toEqual({ password: "SYNTHETIC_PASSWORD" });
    expect(JSON.stringify(hook.result.current.state)).not.toContain(
      "SYNTHETIC_PASSWORD",
    );
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "save_database_data",
      ),
    ).toBe(false);
  });

  it("rejects real external edits without adopting their baseline or writing over them", async () => {
    const hook = await mount();
    const review = await putCredential(hook);
    const api = hook.result.current.credentialVault!;
    const writeCount = writes().length;
    lease.data = nativeJson({
      ...lease.data,
      settings: { retained: true, external: "changed" },
    });
    const external = nativeJson(lease.data);
    // Both the vault CAS check and the native browser projection check reject
    // external body edits without adopting the foreign baseline.
    const conflict =
      /Database (contents changed in another window|body changed during browser projection refresh)/;
    await expect(api.list(api.scope!)).rejects.toThrow(conflict);
    await expect(
      api.resolve(review, credentialId, ["password"]),
    ).rejects.toThrow(conflict);
    await expect(
      api.compareAndSwap(review, [{ operation: "delete", id: credentialId }]),
    ).rejects.toThrow(conflict);
    await expect(api.list(api.scope!)).rejects.toThrow(conflict);
    expect(writes().length).toBe(writeCount);
    expect(lease.data).toEqual(external);
    expect(lease.data.credentialVault?.entries).toEqual([entry()]);
  });
});
