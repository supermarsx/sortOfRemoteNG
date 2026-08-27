/**
 * t62 / D6 — trust records travel with export, import and clone.
 *
 * These tests drive the real portability helpers against a fake native Trust
 * Center (two in-memory databases behind `trust_export_database` /
 * `trust_import_database`), so the assertions cover the actual seam the
 * Export / Import / Clone tabs use rather than a re-implementation of it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTrustDocument,
  isTrustExportDocument,
  mergeTrustDocuments,
  readTrustDocument,
  type TrustExportDocument,
  type TrustExportRecord,
} from "../../src/utils/services/trustPortability";

/* ── Fake native Trust Center ──────────────────────────────────────── */

const stores = new Map<string, TrustExportDocument>();
let activeDatabaseId = "db-a";

const emptyDocument = (): TrustExportDocument => ({ version: 1, records: [] });

const storeFor = (databaseId?: string): TrustExportDocument => {
  const id = databaseId ?? activeDatabaseId;
  const existing = stores.get(id);
  if (existing) return existing;
  const created = emptyDocument();
  stores.set(id, created);
  return created;
};

const key = (record: TrustExportRecord) =>
  `${record.record_type}:${record.host}`;

const nativeInvoke = vi.fn(
  async (command: string, args?: Record<string, unknown>) => {
    if (command === "trust_export_database") {
      // The native command answers with a copy; mutating the caller's
      // document must never reach back into the store.
      return JSON.parse(
        JSON.stringify(storeFor(args?.databaseId as string | undefined)),
      );
    }
    if (command === "trust_import_database") {
      const target = args?.databaseId as string | undefined;
      const document = args?.document as TrustExportDocument;
      const mode = (args?.mode as string) ?? "merge";
      const current = mode === "replace" ? emptyDocument() : storeFor(target);
      const byKey = new Map(current.records.map((r) => [key(r), r]));
      let imported = 0;
      let skipped = 0;
      for (const record of document.records) {
        const existing = byKey.get(key(record));
        // Mirrors the native rule: never un-revoke through an import.
        if (existing?.revoked && !record.revoked) {
          skipped += 1;
          continue;
        }
        byKey.set(key(record), record);
        imported += 1;
      }
      stores.set(target ?? activeDatabaseId, {
        version: document.version,
        records: Array.from(byKey.values()),
        ...(document.policy ? { policy: document.policy } : {}),
        ...(document.policyConfig
          ? { policyConfig: document.policyConfig }
          : {}),
      });
      return { imported, skipped };
    }
    throw new Error(`unexpected command ${command}`);
  },
);

const makeRecord = (
  overrides: Partial<TrustExportRecord> = {},
): TrustExportRecord => ({
  host: "vault.example.test:443",
  record_type: "https",
  identity: {
    fingerprint: "AA:BB:CC",
    pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    last_seen: "2026-05-01T00:00:00.000Z",
  },
  user_approved: true,
  nickname: "Prod vault",
  history: [{ reason: "Initial", at: "2026-01-01T00:00:00.000Z" }],
  stats: { successful_verifications: 12 },
  first_trusted: "2026-01-01T00:00:00.000Z",
  revoked: false,
  tags: ["prod"],
  ...overrides,
});

beforeEach(() => {
  stores.clear();
  activeDatabaseId = "db-a";
  nativeInvoke.mockClear();
  (globalThis as Record<string, unknown>).__TAURI__ = {
    core: { invoke: nativeInvoke },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI__;
});

/* ── Guards ────────────────────────────────────────────────────────── */

describe("isTrustExportDocument", () => {
  it("accepts a document with a records array and rejects anything else", () => {
    expect(isTrustExportDocument({ version: 1, records: [] })).toBe(true);
    expect(isTrustExportDocument({ version: 1 })).toBe(false);
    expect(isTrustExportDocument(null)).toBe(false);
    expect(isTrustExportDocument([])).toBe(false);
    expect(isTrustExportDocument("records")).toBe(false);
  });
});

/* ── Best-effort contract ──────────────────────────────────────────── */

describe("readTrustDocument / applyTrustDocument are best-effort", () => {
  it("returns null instead of throwing when the native side fails", async () => {
    nativeInvoke.mockRejectedValueOnce(new Error("no active trust database"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(readTrustDocument("db-a")).resolves.toBeNull();
    warn.mockRestore();
  });

  it("returns null without invoking anything outside Tauri", async () => {
    delete (globalThis as Record<string, unknown>).__TAURI__;
    await expect(readTrustDocument("db-a")).resolves.toBeNull();
    await expect(
      applyTrustDocument(
        { version: 1, records: [makeRecord()] },
        {
          databaseId: "db-b",
        },
      ),
    ).resolves.toBeNull();
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("skips the native call when the caller opted out or has no document", async () => {
    await expect(readTrustDocument("db-a", false)).resolves.toBeNull();
    await expect(
      applyTrustDocument(null, { databaseId: "db-b" }),
    ).resolves.toBeNull();
    await expect(
      applyTrustDocument(
        { version: 1, records: [makeRecord()] },
        { databaseId: "db-b", includeTrust: false },
      ),
    ).resolves.toBeNull();
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("ignores a malformed document rather than handing it to the backend", async () => {
    await expect(
      applyTrustDocument({ version: 1 } as unknown as TrustExportDocument, {
        databaseId: "db-b",
      }),
    ).resolves.toBeNull();
    expect(nativeInvoke).not.toHaveBeenCalled();
  });
});

/* ── The round trip ────────────────────────────────────────────────── */

describe("export → import round trip into a second database", () => {
  it("preserves nickname, revoked state and history across the file", async () => {
    const revoked = makeRecord({
      host: "old.example.test:443",
      nickname: "Decommissioned",
      revoked: true,
      history: [
        { reason: "Initial", at: "2026-01-01T00:00:00.000Z" },
        { reason: "Revoked", at: "2026-04-01T00:00:00.000Z" },
      ],
    });
    stores.set("db-a", {
      version: 1,
      records: [makeRecord(), revoked],
      policy: "tofu-with-expiry",
      policyConfig: { expiry_days: 90 },
    });

    // 1. Export side: the database's records are read straight from the
    //    Trust Center and serialized into the export file.
    const exported = await readTrustDocument("db-a");
    expect(exported).not.toBeNull();
    const file = JSON.stringify({
      collection: { id: "db-a", name: "Primary" },
      connections: [],
      trustRecords: exported,
    });

    // 2. Import side: the file is parsed and applied to a *different*
    //    database, exactly as `confirmImport` does.
    const parsed = JSON.parse(file);
    expect(isTrustExportDocument(parsed.trustRecords)).toBe(true);
    const outcome = await applyTrustDocument(parsed.trustRecords, {
      databaseId: "db-b",
    });
    expect(outcome).toEqual({ imported: 2, skipped: 0 });

    // 3. The second database now holds both records byte-for-byte, and the
    //    source database is untouched.
    const landed = await readTrustDocument("db-b");
    expect(landed?.records).toHaveLength(2);
    const landedRevoked = landed?.records.find(
      (record) => record.host === "old.example.test:443",
    );
    expect(landedRevoked?.nickname).toBe("Decommissioned");
    expect(landedRevoked?.revoked).toBe(true);
    expect(landedRevoked?.history).toEqual(revoked.history);
    expect(landed?.records.find((r) => r.nickname === "Prod vault")).toEqual(
      makeRecord(),
    );
    expect(landed?.policy).toBe("tofu-with-expiry");
    expect(landed?.policyConfig).toEqual({ expiry_days: 90 });
    expect((await readTrustDocument("db-a"))?.records).toHaveLength(2);
  });

  it("never re-trusts a record the target database has revoked", async () => {
    stores.set("db-b", {
      version: 1,
      records: [makeRecord({ revoked: true, nickname: "Revoked here" })],
    });
    const outcome = await applyTrustDocument(
      { version: 1, records: [makeRecord({ revoked: false })] },
      { databaseId: "db-b" },
    );
    expect(outcome).toEqual({ imported: 0, skipped: 1 });
    const landed = await readTrustDocument("db-b");
    expect(landed?.records[0].revoked).toBe(true);
    expect(landed?.records[0].nickname).toBe("Revoked here");
  });

  it("clones with mode replace so the clone mirrors its source", async () => {
    stores.set("db-b", {
      version: 1,
      records: [makeRecord({ host: "stale.example.test:443" })],
    });
    await applyTrustDocument(
      { version: 1, records: [makeRecord()] },
      { databaseId: "db-b", mode: "replace" },
    );
    const landed = await readTrustDocument("db-b");
    expect(landed?.records.map((record) => record.host)).toEqual([
      "vault.example.test:443",
    ]);
    expect(nativeInvoke).toHaveBeenCalledWith(
      "trust_import_database",
      expect.objectContaining({ databaseId: "db-b", mode: "replace" }),
    );
  });

  it("targets the active database when no id is given (backup restore)", async () => {
    await applyTrustDocument({ version: 1, records: [makeRecord()] });
    expect(nativeInvoke).toHaveBeenCalledWith("trust_import_database", {
      document: expect.objectContaining({ version: 1 }),
      mode: "merge",
    });
    expect(stores.get("db-a")?.records).toHaveLength(1);
  });
});

/* ── Multi-source fan-in (clone) ───────────────────────────────────── */

describe("mergeTrustDocuments", () => {
  it("returns null when nothing was contributed", () => {
    expect(mergeTrustDocuments([])).toBeNull();
    expect(mergeTrustDocuments([null, undefined])).toBeNull();
    expect(mergeTrustDocuments([{ version: 1 } as never])).toBeNull();
  });

  it("keeps the more recently seen record for the same host and type", () => {
    const older = makeRecord({
      nickname: "old",
      identity: { fingerprint: "AA", last_seen: "2026-01-01T00:00:00.000Z" },
    });
    const newer = makeRecord({
      nickname: "new",
      identity: { fingerprint: "BB", last_seen: "2026-06-01T00:00:00.000Z" },
    });
    const merged = mergeTrustDocuments([
      { version: 1, records: [older] },
      { version: 1, records: [newer] },
    ]);
    expect(merged?.records).toHaveLength(1);
    expect(merged?.records[0].nickname).toBe("new");
  });

  it("lets a revoked record win regardless of which source it came from", () => {
    const revoked = makeRecord({
      revoked: true,
      identity: { fingerprint: "AA", last_seen: "2026-01-01T00:00:00.000Z" },
    });
    const active = makeRecord({
      revoked: false,
      identity: { fingerprint: "BB", last_seen: "2026-06-01T00:00:00.000Z" },
    });
    expect(
      mergeTrustDocuments([
        { version: 1, records: [active] },
        { version: 1, records: [revoked] },
      ])?.records[0].revoked,
    ).toBe(true);
    expect(
      mergeTrustDocuments([
        { version: 1, records: [revoked] },
        { version: 1, records: [active] },
      ])?.records[0].revoked,
    ).toBe(true);
  });

  it("keeps records for different hosts and types side by side", () => {
    const merged = mergeTrustDocuments([
      { version: 1, records: [makeRecord()] },
      {
        version: 1,
        records: [
          makeRecord({ host: "shell.example.test:22", record_type: "ssh" }),
          makeRecord({ record_type: "rdp" }),
        ],
        policy: "strict",
      },
    ]);
    expect(merged?.records).toHaveLength(3);
    expect(merged?.policy).toBe("strict");
  });
});
