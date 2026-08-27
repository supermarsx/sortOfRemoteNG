import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  records: [] as Array<Record<string, any>>,
  failReads: false,
  /**
   * `null` = the shell does not implement `trust_get_active_database`, which
   * is what the pre-t62 suites below assume: the scope stays unresolved and
   * the store behaves exactly as it did before.
   */
  activeDatabase: null as null | {
    databaseId: string | null;
    encrypted: boolean;
    recordCount: number;
    seededRecords: number;
  },
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
}));

import {
  ensureTrustStoreReady,
  getAllTrustRecords,
  getEffectiveTrustPolicy,
  getStoredIdentity,
  getTrustStoreScope,
  isCertificateTrustRecordType,
  NoActiveDatabaseError,
  refreshTrustStoreScope,
  removeIdentity,
  resetTrustStoreCacheForTests,
  resolveEffectiveTrustPolicy,
  trustIdentity,
  verifyIdentity,
} from "../../src/utils/auth/trustStore";
import type {
  CertIdentity,
  SshHostKeyIdentity,
} from "../../src/utils/auth/trustStore";

const makeSshIdentity = (fingerprint: string): SshHostKeyIdentity => ({
  fingerprint,
  keyType: "ssh-ed25519",
  firstSeen: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

const makeTlsIdentity = (fingerprint: string): CertIdentity => ({
  fingerprint,
  subject: "example.com",
  issuer: "Test CA",
  firstSeen: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

function nativeRecord(args: Record<string, any>) {
  return {
    host: args.host,
    record_type: args.recordType,
    identity: args.identity,
    user_approved: args.userApproved,
    nickname: args.nickname ?? null,
    history:
      args.migrationHistory?.map((identity: unknown) => ({
        identity,
        changed_at: new Date().toISOString(),
        reason: "migrated",
        approved_by: "test",
        note: null,
        verification_count: 0,
        trust_score: 0,
      })) ?? [],
  };
}

function installNativeMock() {
  native.invoke.mockImplementation(
    async (command: string, args: Record<string, any> = {}) => {
      if (command === "trust_get_active_database") {
        if (!native.activeDatabase) {
          throw new Error(`Unexpected command: ${command}`);
        }
        return { ...native.activeDatabase };
      }
      if (command === "trust_get_all_records") {
        if (native.failReads) throw new Error("native trust store unavailable");
        return structuredClone(native.records);
      }
      if (command === "trust_verify_identity") {
        if (native.failReads) throw new Error("native trust store unavailable");
        const record = native.records.find(
          (candidate) =>
            candidate.host === args.host &&
            candidate.record_type === args.recordType,
        );
        if (!record) return { status: "first-use", identity: args.identity };
        if (record.identity.fingerprint === args.identity.fingerprint) {
          return { status: "trusted" };
        }
        return {
          status: "mismatch",
          stored: record.identity,
          presented: args.identity,
        };
      }
      if (
        command === "trust_store_identity" ||
        command === "trust_store_identity_with_reason"
      ) {
        const index = native.records.findIndex(
          (candidate) =>
            candidate.host === args.host &&
            candidate.record_type === args.recordType,
        );
        const next = nativeRecord(args);
        if (index >= 0) {
          const previous = native.records[index];
          next.history = [
            ...previous.history,
            {
              identity: previous.identity,
              changed_at: new Date().toISOString(),
              reason: "user_accepted",
              approved_by: null,
              note: null,
              verification_count: 0,
              trust_score: 0,
            },
          ];
          native.records[index] = next;
        } else {
          native.records.push(next);
        }
        return;
      }
      if (command === "trust_remove_identity") {
        native.records = native.records.filter(
          (candidate) =>
            candidate.host !== args.host ||
            candidate.record_type !== args.recordType,
        );
        return;
      }
      if (command === "trust_update_nickname") {
        const record = native.records.find(
          (candidate) =>
            candidate.host === args.host &&
            candidate.record_type === args.recordType,
        );
        if (!record) throw new Error("not found");
        record.nickname = args.nickname;
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
}

describe("native-backed trustStore", () => {
  beforeEach(() => {
    localStorage.clear();
    native.records = [];
    native.failReads = false;
    native.activeDatabase = null;
    native.invoke.mockReset();
    installNativeMock();
    resetTrustStoreCacheForTests();
  });

  it("fails closed while native hydration is unavailable", async () => {
    native.failReads = true;
    expect(getStoredIdentity("host", 22, "ssh")).toBeUndefined();
    await expect(
      verifyIdentity("host", 22, "ssh", makeSshIdentity("SHA256:a")),
    ).rejects.toThrow(
      "The native Trust Center is unavailable. Trust decisions remain blocked until it recovers.",
    );
    expect(getAllTrustRecords()).toEqual([]);
  });

  it("verifies first use, matches, and mismatches through native commands", async () => {
    const original = makeSshIdentity("SHA256:original");
    expect((await verifyIdentity("host", 22, "ssh", original)).status).toBe(
      "first-use",
    );

    await trustIdentity("host", 22, "ssh", original);
    expect((await verifyIdentity("host", 22, "ssh", original)).status).toBe(
      "trusted",
    );

    const changed = makeSshIdentity("SHA256:changed");
    const result = await verifyIdentity("host", 22, "ssh", changed);
    expect(result.status).toBe("mismatch");
    if (result.status === "mismatch") {
      expect(result.stored.fingerprint).toBe("SHA256:original");
      expect(result.received.fingerprint).toBe("SHA256:changed");
    }
  });

  it("keeps global and per-connection native records isolated", async () => {
    await trustIdentity(
      "host",
      22,
      "ssh",
      makeSshIdentity("SHA256:scoped"),
      true,
      "connection-1",
    );
    expect(getStoredIdentity("host", 22, "ssh")).toBeUndefined();
    expect(
      getStoredIdentity("host", 22, "ssh", "connection-1")?.identity
        .fingerprint,
    ).toBe("SHA256:scoped");
  });

  it("removes records durably before changing the display cache", async () => {
    await trustIdentity("host", 22, "ssh", makeSshIdentity("SHA256:remove"));
    await removeIdentity("host", 22, "ssh");
    expect(getStoredIdentity("host", 22, "ssh")).toBeUndefined();
    expect(native.records).toHaveLength(0);
  });

  it("migrates legacy records and only then removes localStorage", async () => {
    const identity = makeTlsIdentity("SHA256:legacy");
    localStorage.setItem(
      "trustStore",
      JSON.stringify({
        "https:legacy.example:443": {
          host: "legacy.example:443",
          type: "https",
          identity,
          userApproved: true,
          history: [makeTlsIdentity("SHA256:older")],
          nickname: "Legacy endpoint",
        },
      }),
    );

    await ensureTrustStoreReady();

    expect(localStorage.getItem("trustStore")).toBeNull();
    const record = getStoredIdentity("legacy.example", 443, "https");
    expect(record?.identity.fingerprint).toBe("SHA256:legacy");
    expect(record?.history?.[0].fingerprint).toBe("SHA256:older");
    expect(record?.nickname).toBe("Legacy endpoint");
  });

  it("retains legacy data when durable migration fails", async () => {
    localStorage.setItem(
      "trustStore",
      JSON.stringify({
        "ssh:legacy:22": {
          host: "legacy:22",
          type: "ssh",
          identity: makeSshIdentity("SHA256:legacy"),
          userApproved: true,
        },
      }),
    );
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "trust_get_all_records") return [];
      throw new Error("durable write failed");
    });

    await ensureTrustStoreReady();
    expect(localStorage.getItem("trustStore")).not.toBeNull();
    expect(getStoredIdentity("legacy", 22, "ssh")).toBeUndefined();
  });

  it("preserves record type separation", async () => {
    await trustIdentity(
      "host",
      443,
      "certificate",
      makeTlsIdentity("SHA256:certificate"),
    );
    await trustIdentity("host", 443, "https", makeTlsIdentity("SHA256:https"));
    await trustIdentity("host", 443, "rdp", makeTlsIdentity("SHA256:rdp"));
    await trustIdentity("host", 443, "tls", makeTlsIdentity("SHA256:tls"));
    expect(
      getAllTrustRecords()
        .map((record) => record.type)
        .sort(),
    ).toEqual(["certificate", "https", "rdp", "tls"]);
  });

  it("classifies certificate record types", () => {
    expect(isCertificateTrustRecordType("certificate")).toBe(true);
    expect(isCertificateTrustRecordType("https")).toBe(true);
    expect(isCertificateTrustRecordType("rdp")).toBe(true);
    expect(isCertificateTrustRecordType("tls")).toBe(true);
    expect(isCertificateTrustRecordType("ssh")).toBe(false);
  });

  it("resolves inherited policies without involving mutable storage", () => {
    expect(resolveEffectiveTrustPolicy("strict", "tofu", "always-trust")).toBe(
      "strict",
    );
    expect(resolveEffectiveTrustPolicy("inherit", "tofu", "always-trust")).toBe(
      "tofu",
    );
    expect(resolveEffectiveTrustPolicy(undefined, undefined, undefined)).toBe(
      "always-ask",
    );
    expect(getEffectiveTrustPolicy("inherit", "strict")).toBe("strict");
  });
});

describe("database scope (t62)", () => {
  beforeEach(() => {
    localStorage.clear();
    native.records = [];
    native.failReads = false;
    native.activeDatabase = null;
    native.invoke.mockReset();
    installNativeMock();
    resetTrustStoreCacheForTests();
  });

  it("starts unresolved and stays permissive when the runtime cannot answer", async () => {
    // `installNativeMock` throws on `trust_get_active_database`, standing in
    // for a shell that predates the per-database trust store. The store must
    // keep its pre-t62 behaviour rather than locking every host out.
    expect(getTrustStoreScope()).toMatchObject({
      databaseId: null,
      resolved: false,
    });

    await expect(ensureTrustStoreReady()).resolves.toBeUndefined();
    expect(getTrustStoreScope().resolved).toBe(false);
  });

  it("reports the active database and its encryption state", async () => {
    native.activeDatabase = {
      databaseId: "db-alpha",
      encrypted: true,
      recordCount: 4,
      seededRecords: 2,
    };

    const scope = await refreshTrustStoreScope();

    expect(scope).toEqual({
      databaseId: "db-alpha",
      encrypted: true,
      recordCount: 4,
      seededRecords: 2,
      resolved: true,
    });
    expect(getTrustStoreScope()).toEqual(scope);
  });

  it("fails closed with NoActiveDatabaseError when no database is open", async () => {
    native.activeDatabase = {
      databaseId: null,
      encrypted: false,
      recordCount: 0,
      seededRecords: 0,
    };

    await expect(ensureTrustStoreReady()).rejects.toBeInstanceOf(
      NoActiveDatabaseError,
    );
    // The typed error is what separates "open a database" from "the Trust
    // Center is broken" — callers branch on it.
    await expect(
      verifyIdentity("host", 22, "ssh", makeSshIdentity("SHA256:a")),
    ).rejects.toBeInstanceOf(NoActiveDatabaseError);
    expect(
      native.invoke.mock.calls.some((c) => c[0] === "trust_get_all_records"),
    ).toBe(false);
  });

  it("tracks the live record count of the active database", async () => {
    native.activeDatabase = {
      databaseId: "db-alpha",
      encrypted: false,
      recordCount: 0,
      seededRecords: 0,
    };

    await ensureTrustStoreReady();
    expect(getTrustStoreScope().recordCount).toBe(0);

    await trustIdentity("host", 22, "ssh", makeSshIdentity("SHA256:a"));
    expect(getTrustStoreScope()).toMatchObject({
      databaseId: "db-alpha",
      recordCount: 1,
    });
  });
});
