/**
 * Coverage for the open/switch/unlock loading state in
 * `useDatabaseSelector` — the `loadingCollection` the row animation is
 * driven from, and the `useRef` re-entrancy guard on the open paths.
 *
 * The `databaseManager` singleton is mocked at the module boundary
 * (rather than shimmed at the IPC layer as `tests/utils/databaseManagerIpc.test.ts`
 * does) because nothing here exercises persistence — the hook only asks
 * the manager which database is currently open.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDatabaseSelector } from "../../src/hooks/connection/useDatabaseSelector";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const mockGetCurrentDatabase = vi.fn<() => { id: string } | null>(() => null);
const mockGetAllDatabases = vi.fn(async () => [] as ConnectionDatabase[]);
const mockLoadDatabaseData = vi.fn(async () => ({}));
const mockDuplicateDatabase = vi.fn(async () => makeCollection({ id: "dup" }));
const mockIsDatabaseUnlocked = vi.fn(() => false);
const mockSaveData = vi.fn(async () => {});

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: mockGetCurrentDatabase,
      getAllDatabases: mockGetAllDatabases,
      loadDatabaseData: mockLoadDatabaseData,
      duplicateDatabase: mockDuplicateDatabase,
      isDatabaseUnlocked: mockIsDatabaseUnlocked,
    }),
  },
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getProfiles: () => [],
    getChains: () => [],
    searchProfiles: () => [],
    searchChains: () => [],
  },
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ saveData: mockSaveData }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────

function makeCollection(
  overrides: Partial<ConnectionDatabase> & { id: string },
): ConnectionDatabase {
  const iso = "2026-01-01T00:00:00.000Z";
  return {
    name: `db-${overrides.id}`,
    isEncrypted: false,
    createdAt: iso,
    updatedAt: iso,
    lastAccessed: iso,
    ...overrides,
  };
}

const plain = makeCollection({ id: "plain", name: "Personal" });
const encrypted = makeCollection({
  id: "enc",
  name: "Vault",
  isEncrypted: true,
});

/** A promise whose settlement the test controls, so `loadingCollection` can be observed mid-flight. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSelector(
  onDatabaseSelect: (id: string, password?: string) => Promise<void> | void,
) {
  return renderHook(() => useDatabaseSelector(false, onDatabaseSelect));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentDatabase.mockReturnValue(null);
});

describe("useDatabaseSelector — loadingCollection", () => {
  it("sets loadingCollection on select and clears it on success", async () => {
    const gate = deferred();
    const onDatabaseSelect = vi.fn(() => gate.promise);
    const { result } = renderSelector(onDatabaseSelect);

    expect(result.current.loadingCollection).toBeNull();

    act(() => {
      void result.current.handleSelectCollection(plain);
    });

    expect(result.current.loadingCollection).toEqual({
      id: "plain",
      name: "Personal",
      mode: "open",
    });

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(result.current.loadingCollection).toBeNull();
    expect(onDatabaseSelect).toHaveBeenCalledWith("plain");
  });

  it("clears loadingCollection when onDatabaseSelect rejects", async () => {
    // R1: `App.tsx handleDatabaseSelect` catches its own errors and shows an
    // alert, so in the real app this promise usually resolves even on failure
    // and the `finally` is never reached by integration coverage. It is not
    // dead in principle (`loadData()` can throw outside that try's reach), so
    // the rejection is constructed explicitly here — this test is the only
    // thing standing between a refactor and a permanently stuck spinner.
    const gate = deferred();
    const onDatabaseSelect = vi.fn(() => gate.promise);
    const { result } = renderSelector(onDatabaseSelect);

    let settled: Promise<void>;
    act(() => {
      settled = result.current.handleSelectCollection(plain);
    });

    expect(result.current.loadingCollection).not.toBeNull();

    await act(async () => {
      gate.reject(new Error("load failed"));
      await expect(settled).rejects.toThrow("load failed");
    });

    expect(result.current.loadingCollection).toBeNull();
  });

  it("uses mode 'open' when no database is currently open", async () => {
    mockGetCurrentDatabase.mockReturnValue(null);
    const gate = deferred();
    const { result } = renderSelector(() => gate.promise);

    act(() => {
      void result.current.handleSelectCollection(plain);
    });

    expect(result.current.loadingCollection?.mode).toBe("open");

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
  });

  it("uses mode 'switch' when a different database is currently open", async () => {
    mockGetCurrentDatabase.mockReturnValue({ id: "other" });
    const gate = deferred();
    const { result } = renderSelector(() => gate.promise);

    act(() => {
      void result.current.handleSelectCollection(plain);
    });

    expect(result.current.loadingCollection).toEqual({
      id: "plain",
      name: "Personal",
      mode: "switch",
    });

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
  });

  it("uses mode 'open' when re-opening the database that is already open", async () => {
    // Re-opening the current database tears nothing down, so it is not a switch.
    mockGetCurrentDatabase.mockReturnValue({ id: "plain" });
    const gate = deferred();
    const { result } = renderSelector(() => gate.promise);

    act(() => {
      void result.current.handleSelectCollection(plain);
    });

    expect(result.current.loadingCollection?.mode).toBe("open");

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
  });

  it("sets no loadingCollection for an encrypted collection — it opens the password card", async () => {
    const onDatabaseSelect = vi.fn();
    const { result } = renderSelector(onDatabaseSelect);

    await act(async () => {
      await result.current.handleSelectCollection(encrypted);
    });

    expect(result.current.loadingCollection).toBeNull();
    expect(result.current.showPasswordDialog).toBe(true);
    expect(result.current.selectedCollection).toEqual(encrypted);
    expect(result.current.passwordDialogMode).toBe("unlock");
    expect(onDatabaseSelect).not.toHaveBeenCalled();
  });
});

describe("useDatabaseSelector — re-entrancy guard", () => {
  it("fires onDatabaseSelect once for two synchronous selects", async () => {
    const gate = deferred();
    const onDatabaseSelect = vi.fn(() => gate.promise);
    const { result } = renderSelector(onDatabaseSelect);

    // Both calls must be made before any await: the guard is a `useRef`
    // precisely because React state would still read `null` on the second
    // call in the same tick. Awaiting the first would release the guard and
    // let the second through — a false pass.
    await act(async () => {
      const first = result.current.handleSelectCollection(plain);
      const second = result.current.handleSelectCollection(plain);
      gate.resolve();
      await Promise.all([first, second]);
    });

    expect(onDatabaseSelect).toHaveBeenCalledTimes(1);
    expect(result.current.loadingCollection).toBeNull();
  });

  it("releases the guard once the first select settles", async () => {
    const onDatabaseSelect = vi.fn(async () => {});
    const { result } = renderSelector(onDatabaseSelect);

    await act(async () => {
      await result.current.handleSelectCollection(plain);
    });
    await act(async () => {
      await result.current.handleSelectCollection(plain);
    });

    expect(onDatabaseSelect).toHaveBeenCalledTimes(2);
  });
});

describe("useDatabaseSelector — handlePasswordSubmit", () => {
  it("sets mode 'unlock' while unlocking and clears it afterwards", async () => {
    const gate = deferred();
    const onDatabaseSelect = vi.fn(() => gate.promise);
    const { result } = renderSelector(onDatabaseSelect);

    await act(async () => {
      await result.current.handleSelectCollection(encrypted);
    });
    act(() => {
      result.current.setPassword("hunter2");
    });

    act(() => {
      void result.current.handlePasswordSubmit();
    });

    // `loadDatabaseData` resolves immediately, so a flush is needed before the
    // state set ahead of it is observable.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loadingCollection).toEqual({
      id: "enc",
      name: "Vault",
      mode: "unlock",
    });
    expect(result.current.isWorking).toBe(true);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(result.current.loadingCollection).toBeNull();
    expect(result.current.isWorking).toBe(false);
    expect(onDatabaseSelect).toHaveBeenCalledWith("enc", "hunter2");
  });

  it("sets no loadingCollection on the clone path — cloning is not an open", async () => {
    const onDatabaseSelect = vi.fn();
    const { result } = renderSelector(onDatabaseSelect);

    await act(async () => {
      await result.current.handleCloneCollection(encrypted);
    });
    expect(result.current.passwordDialogMode).toBe("clone");

    act(() => {
      result.current.setPassword("hunter2");
    });

    await act(async () => {
      await result.current.handlePasswordSubmit();
    });

    expect(result.current.loadingCollection).toBeNull();
    expect(mockDuplicateDatabase).toHaveBeenCalledWith("enc", {
      password: "hunter2",
    });
    expect(onDatabaseSelect).not.toHaveBeenCalled();
  });
});
