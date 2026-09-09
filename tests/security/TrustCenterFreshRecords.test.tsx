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
  refreshTrustStoreRecords,
  resetTrustStoreCacheForTests,
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
});
