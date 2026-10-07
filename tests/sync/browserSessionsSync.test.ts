import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
} from "../../src/utils/services/cloudSyncSmartMerge";
import { summarizeCloudSyncReview } from "../../src/utils/services/cloudSyncReviewDetails";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const record = (connectionId: string, revision = "a") => ({
  connectionId,
  revision: revision.repeat(64),
});
const data = (...records: ReturnType<typeof record>[]) => ({
  browserSessions: { version: 1, records },
});
const merge = async (base: unknown, local: unknown, remote: unknown) =>
  smartMergeSyncSection(local, remote, await buildSmartSyncBaseline(base));

describe("per-connection indivisible browser session records", () => {
  it("merges changes to different connections and never field-merges one snapshot", async () => {
    const base = data(record("a"), record("b"));
    expect(
      await merge(
        base,
        data(record("a", "b"), record("b")),
        data(record("a"), record("b", "c")),
      ),
    ).toEqual({
      conflictCount: 0,
      value: data(record("a", "b"), record("b", "c")),
    });
    const conflict = await merge(
      base,
      data(record("a", "b"), record("b")),
      data(record("a", "c"), record("b")),
    );
    expect(conflict).toMatchObject({
      conflictCount: 1,
      conflicts: [
        { code: "concurrent-edit", kind: "browserSessions", count: 1 },
      ],
    });
    expect(conflict).not.toHaveProperty("value");
    expect(JSON.stringify(conflict)).not.toContain("a".repeat(64));
  });
  it("retains one-sided deletion and conflicts on deletion versus changed session", async () => {
    const base = data(record("a"), record("b"));
    expect(await merge(base, data(record("b")), base)).toEqual({
      conflictCount: 0,
      value: data(record("b")),
    });
    expect(
      await merge(base, data(record("b")), data(record("a", "c"), record("b"))),
    ).toMatchObject({
      conflictCount: 1,
      conflicts: [
        { code: "delete-versus-edit", kind: "browserSessions", count: 1 },
      ],
    });
  });
  it("never writes renderer ledger events for native session capture, rotation or deletion", async () => {
    const initial = {
      ...data(record("a")),
      timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
    };
    const ledger = await reconcileRecordLedger(initial);
    expect(Object.keys(ledger.records)).toEqual(["$"]);
    for (let seconds = 5; seconds <= 20; seconds += 5)
      expect(
        await reconcileRecordLedger(
          { ...initial, timestamp: initial.timestamp + seconds * 1000 },
          ledger,
          {
            mode: "write",
            now: new Date(initial.timestamp + seconds * 1000).toISOString(),
          },
        ),
      ).toEqual(ledger);
    const removed = await reconcileRecordLedger(data(), ledger, {
      mode: "write",
      now: "2026-01-01T00:01:00.000Z",
    });
    expect(removed).toEqual(ledger);
    expect(
      await reconcileRecordLedger(data(record("a", "c")), ledger, {
        mode: "write",
        now: "2026-01-01T00:02:00.000Z",
      }),
    ).toEqual(ledger);
    expect(await reconcileRecordLedger({}, ledger)).toEqual(ledger);
  });
  it("still detects independent session changes and delete/edit conflicts with unchanged renderer history", async () => {
    const initial = data(record("a"), record("b"));
    const recordMetadata = await reconcileRecordLedger(initial);
    const base = { ...initial, recordMetadata };
    expect(
      await merge(
        base,
        { ...data(record("a", "b"), record("b")), recordMetadata },
        { ...data(record("a"), record("b", "c")), recordMetadata },
      ),
    ).toEqual({
      conflictCount: 0,
      value: { ...data(record("a", "b"), record("b", "c")), recordMetadata },
    });
    expect(
      await merge(
        base,
        { ...data(record("b")), recordMetadata },
        { ...data(record("a", "c"), record("b")), recordMetadata },
      ),
    ).toMatchObject({
      conflictCount: 1,
      conflicts: [
        { code: "delete-versus-edit", kind: "browserSessions", count: 1 },
      ],
    });
  });
  it("excludes only the native root descriptor field, not same-named nested user data", async () => {
    const initial = { settings: { browserSessions: "ordinary user text" } };
    const before = await reconcileRecordLedger(initial);
    const after = await reconcileRecordLedger(
      { settings: { browserSessions: "changed" } },
      before,
    );
    expect(after.records["$"].revision).not.toBe(before.records["$"].revision);
    expect(after.records["$/settings"].revision).not.toBe(
      before.records["$/settings"].revision,
    );
  });
  it("shows only fixed labels/counts in review, not connection IDs or revisions", () => {
    const result = summarizeCloudSyncReview(
      "database:db",
      data(record("PRIVATE_CONNECTION")),
      data(record("PRIVATE_CONNECTION", "b")),
      true,
    );
    expect(result.records).toContainEqual({
      kind: "browserSessions",
      local: 1,
      remote: 1,
      same: 0,
      different: 1,
      localOnly: 0,
      remoteOnly: 0,
      reordered: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_CONNECTION|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb/,
    );
  });
});
