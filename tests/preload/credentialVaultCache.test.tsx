import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";
import {
  clearVaultCache,
  preloadCredentialVault,
  setVaultCacheClockForTests,
  vaultCacheSizeForTests,
  VAULT_FRESH_MS,
} from "../../src/hooks/security/credentialVaultCache";
import { useDatabaseCredentialVault } from "../../src/hooks/security/useDatabaseCredentialVault";

const snap = (receipt: string, generation = 1): DatabaseCredentialSnapshot => ({
  scope: { databaseId: "db", generation },
  revision: 1,
  receipt,
  entries: [
    {
      id: "c1",
      name: "Router",
      createdAt: "t",
      updatedAt: "t",
      availableFacets: ["password"],
    },
  ],
});
let now = 1_000;
const makeApi = (
  overrides: Partial<DatabaseCredentialVaultApi> = {},
): DatabaseCredentialVaultApi => ({
  scope: { databaseId: "db", generation: 1 },
  changeRevision: 0,
  list: vi.fn(async () => snap("r1")),
  resolve: vi.fn(async () => ({})),
  compareAndSwap: vi.fn(async () => undefined),
  ...overrides,
});
beforeEach(() => {
  now = 1_000;
  setVaultCacheClockForTests(() => now);
  clearVaultCache();
});
afterEach(() => {
  cleanup();
  setVaultCacheClockForTests();
});

describe("credential vault preload and SWR", () => {
  it("dedupes concurrent preloads and never discloses secrets", async () => {
    const api = makeApi();
    await Promise.all([
      preloadCredentialVault(api),
      preloadCredentialVault(api),
    ]);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it("a fresh cache hit renders synchronously with no list call", async () => {
    const api = makeApi();
    await preloadCredentialVault(api);
    const { result } = renderHook(() => useDatabaseCredentialVault(api));
    expect(result.current.snapshot?.receipt).toBe("r1");
    expect(result.current.loading).toBe(false);
    await act(async () => undefined);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("a stale hit renders at once and revalidates in place without a spinner", async () => {
    const api = makeApi();
    await preloadCredentialVault(api);
    now += VAULT_FRESH_MS + 1;
    (api.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(snap("r2"));
    const { result } = renderHook(() => useDatabaseCredentialVault(api));
    expect(result.current.snapshot?.receipt).toBe("r1");
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.snapshot?.receipt).toBe("r2"));
    expect(result.current.loading).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("invalidates on a change revision", async () => {
    const api = makeApi();
    await preloadCredentialVault(api);
    const next = { ...api, changeRevision: 1 };
    (next.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(snap("r3"));
    const { result } = renderHook(() => useDatabaseCredentialVault(next));
    await waitFor(() => expect(result.current.snapshot?.receipt).toBe("r3"));
  });

  it("clears on lock (no scope) and never calls list when locked", async () => {
    const api = makeApi();
    await preloadCredentialVault(api);
    expect(vaultCacheSizeForTests()).toBe(1);
    const locked = makeApi({ scope: null });
    await preloadCredentialVault(locked);
    expect(locked.list).not.toHaveBeenCalled();
    expect(vaultCacheSizeForTests()).toBe(0);
  });

  it("a preload failure caches nothing and raises nothing (no unlock prompt)", async () => {
    const api = makeApi({
      list: vi.fn(async () => {
        throw new Error("locked");
      }),
    });
    await expect(preloadCredentialVault(api)).resolves.toBeUndefined();
    expect(vaultCacheSizeForTests()).toBe(0);
  });

  it("is bounded across database generations", async () => {
    for (let generation = 1; generation <= 6; generation++) {
      const api = makeApi({
        scope: { databaseId: "db", generation },
        list: vi.fn(async () => snap("r", generation)),
      });
      // Different generations of one owner are purged on each preload.
      await preloadCredentialVault(api);
    }
    expect(vaultCacheSizeForTests()).toBeLessThanOrEqual(3);
  });
});
