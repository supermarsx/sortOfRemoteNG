import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentDatabaseChange } from "../../src/utils/connection/databaseManager";

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  databaseId: "db-a",
  records: [] as Array<Record<string, unknown>>,
  changed: [] as Array<(event: CurrentDatabaseChange) => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => fixture.invoke,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({
        id: fixture.databaseId,
        name: "Test database",
      }),
    }),
  },
  onCurrentDatabaseChange: (
    callback: (event: CurrentDatabaseChange) => void,
  ) => {
    fixture.changed.push(callback);
    return () => {
      fixture.changed = fixture.changed.filter((value) => value !== callback);
    };
  },
}));
import { useTrustCenter } from "../../src/hooks/security/useTrustCenter";
import {
  ensureTrustStoreReady,
  getAllTrustRecords,
  getStoredIdentity,
  isTransientTrustStoreError,
  refreshTrustStoreRecords,
  resetTrustStoreCacheForTests,
  TransientTrustStoreError,
  verifyIdentity,
} from "../../src/utils/auth/trustStore";

const identity = {
  kind: "tls",
  fingerprint: "EXACT-CERT",
  first_seen: "2026-01-01",
  last_seen: "2026-09-01",
};
const record = () => ({
  host: "device.test:443",
  record_type: "https",
  identity,
  user_approved: true,
  history: [],
});
beforeEach(() => {
  resetTrustStoreCacheForTests();
  localStorage.clear();
  fixture.databaseId = "db-a";
  fixture.records = [record()];
  fixture.invoke.mockReset();
  fixture.invoke.mockImplementation(async (command: string) => {
    if (command === "trust_get_active_database")
      return {
        databaseId: fixture.databaseId,
        encrypted: true,
        recordCount: fixture.records.length,
        seededRecords: 0,
      };
    if (command === "trust_get_all_records")
      return structuredClone(fixture.records);
    if (command === "trust_get_summary")
      return {
        total_records: fixture.records.length,
        revoked_count: 0,
        expired_count: 0,
        records_with_history: 0,
        total_verifications: 0,
        total_mismatches: 0,
        average_trust_score: 0,
      };
    if (command === "trust_apply_reviewed_batch") {
      fixture.records = [];
      return { updated: 1 };
    }
    if (command === "trust_verify_identity")
      return { status: "first-use", identity };
    throw new Error(`Unexpected fixture command ${command}`);
  });
});
afterEach(cleanup);

describe("fresh native Trust Center records", () => {
  it.each([true, false])(
    "requires native metadata readback before reporting save success (persisted=%s)",
    async (persisted) => {
      fixture.records[0].description = "Old description";
      fixture.records[0].tags = ["old"];
      const invoke = fixture.invoke.getMockImplementation()!;
      fixture.invoke.mockImplementation(async (command, args) => {
        if (
          command === "trust_apply_reviewed_batch" &&
          args.action === "metadata"
        ) {
          if (persisted)
            fixture.records[0] = {
              ...fixture.records[0],
              tags: args.metadata.tags,
              description: args.metadata.description,
            };
          return { updated: 1 };
        }
        return invoke(command, args);
      });
      const { result } = renderHook(() => useTrustCenter());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.rows[0].record.description).toBe("Old description");
      await act(async () => {
        expect(
          await result.current.saveMetadata(
            result.current.rows[0],
            ["office"],
            "Verified owner note",
            result.current.metadataScopeKey,
          ),
        ).toBe(persisted);
      });
      if (persisted) {
        expect(
          getStoredIdentity("device.test", 443, "https")?.description,
        ).toBe("Verified owner note");
        act(() => result.current.setQuery("verified owner"));
        expect(result.current.visible).toHaveLength(1);
        expect(result.current.message).toContain("tags and description saved");
      } else {
        expect(result.current.message).toBeNull();
        expect(result.current.error).toContain(
          "readback could not be confirmed",
        );
      }
    },
  );
  it("rejects malformed native descriptions instead of silently dropping metadata", async () => {
    fixture.records[0].description = "\0";
    await expect(refreshTrustStoreRecords()).rejects.toThrow();
    expect(getAllTrustRecords()).toEqual([]);
  });
  it("does not expose a suppressed legacy identity while bootstrap awaits its final native read", async () => {
    fixture.records = [];
    localStorage.setItem(
      "trustStore",
      JSON.stringify({
        "https:device.test:443": {
          host: "device.test:443",
          type: "https",
          identity: {
            fingerprint: "SUPPRESSED",
            firstSeen: "2026-01-01",
            lastSeen: "2026-09-01",
          },
          userApproved: true,
        },
      }),
    );
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    let finalReadStarted = false;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_store_identity_with_reason")
        return Promise.resolve(); // Native suppression: successful no-op.
      if (command === "trust_get_all_records" && ++reads === 2) {
        finalReadStarted = true;
        return pending;
      }
      return invoke(command, ...args);
    });
    const bootstrap = ensureTrustStoreReady();
    await waitFor(() => expect(finalReadStarted).toBe(true));
    expect(getStoredIdentity("device.test", 443, "https")).toBeUndefined();
    let ready = false;
    const concurrent = ensureTrustStoreReady().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    release([]);
    await Promise.all([bootstrap, concurrent]);
    expect(getStoredIdentity("device.test", 443, "https")).toBeUndefined();
  });

  it("reviewed Forget refreshes the table and new-connection display without replaying legacy data", async () => {
    const { result } = renderHook(() => useTrustCenter());
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(
      getStoredIdentity("device.test", 443, "https")?.identity.fingerprint,
    ).toBe("EXACT-CERT");
    localStorage.setItem(
      "trustStore",
      JSON.stringify({
        "device.test:443": {
          type: "https",
          identity: {
            fingerprint: "EXACT-CERT",
            firstSeen: "2026-01-01",
            lastSeen: "2026-09-01",
          },
          userApproved: true,
        },
      }),
    );
    act(() => result.current.requestAction("forget", result.current.rows));
    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => expect(result.current.rows).toEqual([]));
    expect(fixture.records).toEqual([]);
    expect(getStoredIdentity("device.test", 443, "https")).toBeUndefined();
    expect(fixture.invoke).toHaveBeenCalledWith("trust_get_all_records", {
      expectedDatabaseId: "db-a",
    });
    expect(
      fixture.invoke.mock.calls.some(
        ([command]) => command === "trust_store_identity_with_reason",
      ),
    ).toBe(false);
    expect(localStorage.getItem("trustStore")).not.toBeNull();
    // The next connection still asks the native verifier. First-use is not
    // itself persisted approval; an explicitly configured TOFU policy may
    // subsequently trust it, which is separate from cache resurrection.
    await expect(
      verifyIdentity("device.test", 443, "https", {
        fingerprint: "EXACT-CERT",
        firstSeen: "2026-01-01",
        lastSeen: "2026-09-01",
      }),
    ).resolves.toMatchObject({ status: "first-use" });
  });

  it("an older same-scope read cannot reinstall records after a newer post-Forget read", async () => {
    await refreshTrustStoreRecords();
    let release!: (value: unknown) => void;
    let started = false;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    fixture.invoke.mockImplementationOnce(() => {
      started = true;
      return pending;
    });
    const older = refreshTrustStoreRecords();
    const superseded = expect(older).rejects.toThrow("superseded");
    await waitFor(() => expect(started).toBe(true));
    fixture.records = [];
    await refreshTrustStoreRecords();
    release([record()]);
    await superseded;
    expect(getAllTrustRecords()).toEqual([]);
  });

  it("rejects a refresh completed after database close and leaves no old identity visible", async () => {
    await refreshTrustStoreRecords();
    let started = false;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    fixture.invoke.mockImplementationOnce(() => {
      started = true;
      return pending;
    });
    const refresh = refreshTrustStoreRecords();
    const rejected = expect(refresh).rejects.toThrow("Trust database changed");
    await waitFor(() => expect(started).toBe(true));
    for (const changed of fixture.changed)
      changed({
        database: null,
        databaseId: null,
        previousDatabaseId: "db-a",
        reason: "close",
        connectionIds: [],
        trustActivation: Promise.resolve(),
      });
    release([record()]);
    await rejected;
    expect(getStoredIdentity("device.test", 443, "https")).toBeUndefined();
  });

  it("a failed fresh read clears stale display records and can retry without importing legacy input", async () => {
    await refreshTrustStoreRecords();
    fixture.invoke.mockRejectedValueOnce(new Error("Locked trust destination"));
    await expect(refreshTrustStoreRecords()).rejects.toThrow("Trust Center");
    fixture.records = [];
    await refreshTrustStoreRecords();
    expect(getAllTrustRecords()).toEqual([]);
  });

  it("retries recognized storage transitions after one then two seconds", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records" && ++reads < 3) {
        return Promise.reject(
          new Error(
            "encryption storage transition in progress; retry after it completes",
          ),
        );
      }
      return invoke(command, ...args);
    });
    try {
      const refresh = refreshTrustStoreRecords();
      await vi.advanceTimersByTimeAsync(999);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toBe(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(reads).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(refresh).resolves.toBeUndefined();
      expect(reads).toBe(3);
      expect(getAllTrustRecords()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues a refresh after an in-flight hydration hits a storage transition", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    let rejectHydration!: (reason: Error) => void;
    let hydrationReadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      hydrationReadStarted = resolve;
    });
    const pendingHydration = new Promise((_, reject) => {
      rejectHydration = reject;
    });
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records" && ++reads === 1) {
        hydrationReadStarted();
        return pendingHydration;
      }
      return invoke(command, ...args);
    });
    try {
      const hydrationFailure = ensureTrustStoreReady().catch((error) => error);
      await started;
      const refresh = refreshTrustStoreRecords();
      rejectHydration(
        new Error(
          "encryption storage transition in progress; retry after it completes",
        ),
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(refresh).resolves.toBeUndefined();
      expect(await hydrationFailure).toBeInstanceOf(TransientTrustStoreError);
      expect(reads).toBe(2);
      expect(getAllTrustRecords()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a delayed retry when the owning database changes", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records" && ++reads === 1) {
        return Promise.reject(
          new Error(
            "encryption storage transition in progress; retry after it completes",
          ),
        );
      }
      return invoke(command, ...args);
    });
    try {
      const failure = refreshTrustStoreRecords().catch((error) => error);
      await vi.advanceTimersByTimeAsync(0);
      for (const changed of fixture.changed)
        changed({
          database: null,
          databaseId: null,
          previousDatabaseId: "db-a",
          reason: "close",
          connectionIds: [],
          trustActivation: Promise.resolve(),
        });
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await failure).message).toContain("Trust database changed");
      expect(reads).toBe(1);
      expect(getAllTrustRecords()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry terminal refresh failures", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records") {
        reads += 1;
        return Promise.reject(new Error("Locked trust destination"));
      }
      return invoke(command, ...args);
    });
    try {
      const failure = refreshTrustStoreRecords().catch((error) => error);
      await vi.advanceTimersByTimeAsync(60_000);
      const error = await failure;
      expect(reads).toBe(1);
      expect(isTransientTrustStoreError(error)).toBe(false);
      expect(getAllTrustRecords()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not extend a slow transition beyond the refresh retry budget", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records") {
        reads += 1;
        return new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("encryption key transition in progress")),
            5_000,
          ),
        );
      }
      return invoke(command, ...args);
    });
    try {
      const failure = refreshTrustStoreRecords().catch((error) => error);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(isTransientTrustStoreError(await failure)).toBe(true);
      expect(reads).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after two transient refresh retries and remains fail-closed", async () => {
    vi.useFakeTimers();
    const invoke = fixture.invoke.getMockImplementation()!;
    let reads = 0;
    fixture.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "trust_get_all_records") {
        reads += 1;
        return Promise.reject(
          new Error("encryption key transition in progress"),
        );
      }
      return invoke(command, ...args);
    });
    try {
      const failure = refreshTrustStoreRecords().catch((error) => error);
      await vi.advanceTimersByTimeAsync(3_000);
      const error = await failure;
      expect(reads).toBe(3);
      expect(isTransientTrustStoreError(error)).toBe(true);
      expect(getAllTrustRecords()).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
