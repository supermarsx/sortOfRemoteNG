import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentDatabaseChange } from "../../src/utils/connection/databaseManager";
const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  databaseId: "db-a",
  changed: undefined as undefined | ((event: CurrentDatabaseChange) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: (
    callback: (event: CurrentDatabaseChange) => void,
  ) => {
    fixture.changed = callback;
    return () => {};
  },
}));
import {
  ensureTrustStoreReady,
  getAllTrustRecords,
  resetTrustStoreCacheForTests,
  setTrustRecordRevoked,
  setTrustRecordTags,
  verifyIdentity,
  refreshTrustStoreRecords,
} from "../../src/utils/auth/trustStore";
const identity = {
  kind: "tls",
  fingerprint: "REVIEWED-FP",
  first_seen: "2026-01-01",
  last_seen: "2026-09-01",
};
beforeEach(() => {
  resetTrustStoreCacheForTests();
  fixture.databaseId = "db-a";
  fixture.invoke.mockReset();
  fixture.invoke.mockImplementation(async (command: string) => {
    if (command === "trust_get_active_database")
      return {
        databaseId: fixture.databaseId,
        encrypted: false,
        recordCount: 1,
        seededRecords: 0,
      };
    if (command === "trust_get_all_records")
      return [
        {
          host: "server:443",
          record_type: "tls",
          identity,
          user_approved: true,
          history: [],
          tags: ["old"],
          revoked: true,
        },
      ];
    return undefined;
  });
});
describe("queued trust mutation scope", () => {
  it("rejects a pre-Forget result superseded by a fresh records read without clearing that read", async () => {
    await ensureTrustStoreReady();
    let release!: (value: unknown) => void;
    fixture.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = verifyIdentity("server", 443, "tls", {
      fingerprint: "REVIEWED-FP",
      firstSeen: "2026-01-01",
      lastSeen: "2026-09-01",
    });
    const rejected = expect(pending).rejects.toThrow("superseded");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await refreshTrustStoreRecords();
    release({ status: "trusted" });
    await rejected;
    expect(getAllTrustRecords()).toHaveLength(1);
  });
  it("preserves the native fresh-approval requirement and rejects malformed flags", async () => {
    await ensureTrustStoreReady();
    fixture.invoke.mockResolvedValueOnce({
      status: "first-use",
      requiresApproval: true,
    });
    const presented = {
      fingerprint: "NEW",
      firstSeen: "2026-01-01",
      lastSeen: "2026-09-01",
    };
    await expect(
      verifyIdentity("server", 443, "tls", presented),
    ).resolves.toEqual({
      status: "first-use",
      requiresApproval: true,
      identity: presented,
    });
    fixture.invoke.mockResolvedValueOnce({
      status: "first-use",
      requiresApproval: "false",
    });
    await expect(
      verifyIdentity("server", 443, "tls", presented),
    ).rejects.toThrow("unavailable");
  });
  it("rejects an in-flight trusted result after the database closes", async () => {
    await ensureTrustStoreReady();
    let release!: (value: unknown) => void;
    fixture.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = verifyIdentity("server", 443, "tls", {
      fingerprint: "REVIEWED-FP",
      firstSeen: "2026-01-01",
      lastSeen: "2026-09-01",
    });
    const rejected = expect(pending).rejects.toThrow("Trust database changed");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    fixture.changed?.({
      database: null,
      databaseId: null,
      previousDatabaseId: "db-a",
      reason: "close",
      connectionIds: [],
      trustActivation: Promise.resolve(),
    });
    release({ status: "trusted" });
    await rejected;
    expect(fixture.invoke).toHaveBeenCalledWith(
      "trust_verify_identity",
      expect.objectContaining({ expectedDatabaseId: "db-a" }),
    );
  });
  it("passes native DB and reviewed fingerprint guards for reinstatement and tags", async () => {
    await ensureTrustStoreReady();
    const record = getAllTrustRecords()[0];
    await setTrustRecordRevoked(record, false);
    expect(fixture.invoke).toHaveBeenCalledWith("trust_reinstate_identity", {
      host: "server:443",
      recordType: "tls",
      expectedDatabaseId: "db-a",
      expectedFingerprint: "REVIEWED-FP",
    });
    await setTrustRecordTags(record, ["new", "new", " reviewed "]);
    expect(fixture.invoke).toHaveBeenCalledWith("trust_set_record_tags", {
      host: "server:443",
      recordType: "tls",
      expectedDatabaseId: "db-a",
      expectedFingerprint: "REVIEWED-FP",
      tags: ["new", "reviewed"],
    });
  });
  it("rejects a queued approval after DB close instead of applying to a new active store", async () => {
    await ensureTrustStoreReady();
    const record = getAllTrustRecords()[0];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.invoke.mockImplementationOnce(() => pending);
    const first = setTrustRecordTags(record, ["first"]);
    const firstRejected = expect(first).rejects.toThrow(
      "Trust database changed",
    );
    await vi.waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_set_record_tags",
        expect.anything(),
      ),
    );
    const queued = setTrustRecordRevoked(record, false);
    const rejected = expect(queued).rejects.toThrow("Trust database changed");
    fixture.changed?.({
      database: null,
      databaseId: null,
      previousDatabaseId: "db-a",
      reason: "close",
      connectionIds: [],
      trustActivation: Promise.resolve(),
    });
    release();
    await firstRejected;
    await rejected;
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_reinstate_identity",
      expect.anything(),
    );
  });
});
