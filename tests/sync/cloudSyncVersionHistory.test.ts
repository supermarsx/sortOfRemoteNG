import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { summarizeCloudSyncVersionHistory } from "../../src/utils/services/cloudSyncVersionHistory";
import {
  reconcileMergedRecordLedgers,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

const data = (a = "Original", b = "Original") => ({
  connections: [
    { id: "PRIVATE_A", name: a },
    { id: "PRIVATE_B", name: b },
  ],
});
async function version(
  body = data(),
  previous?: RecordLedger,
  now = "2026-10-05T12:00:00.000Z",
) {
  return {
    ...body,
    recordMetadata: await reconcileRecordLedger(body, previous, {
      mode: "write",
      now,
    }),
  };
}

describe("internal revision ancestry projection", () => {
  it("recognizes equal versions and exposes no record identities or content", async () => {
    const base = await version();
    const summary = summarizeCloudSyncVersionHistory(
      base,
      structuredClone(base),
    );
    expect(summary).toEqual({
      relationship: "same",
      sharedRevisions: base.recordMetadata.journal.length,
      localOnlyRevisions: 0,
      remoteOnlyRevisions: 0,
    });
    const receipt = JSON.stringify(summary);
    expect(receipt).not.toMatch(/PRIVATE_|Original/);
    for (const event of base.recordMetadata.journal)
      expect(receipt).not.toContain(event.revision);
  });

  it("identifies descendants in both directions even when the editing clock moved backwards", async () => {
    const base = await version();
    const edited = await version(
      data("Edit"),
      base.recordMetadata,
      "2026-10-05T09:00:00.000Z",
    );
    const before = JSON.stringify([base, edited]);
    const changes =
      edited.recordMetadata.journal.length - base.recordMetadata.journal.length;
    expect(summarizeCloudSyncVersionHistory(edited, base)).toEqual({
      relationship: "local-ahead",
      sharedRevisions: base.recordMetadata.journal.length,
      localOnlyRevisions: changes,
      remoteOnlyRevisions: 0,
    });
    expect(summarizeCloudSyncVersionHistory(base, edited)).toEqual({
      relationship: "remote-ahead",
      sharedRevisions: base.recordMetadata.journal.length,
      localOnlyRevisions: 0,
      remoteOnlyRevisions: changes,
    });
    expect(JSON.stringify([base, edited])).toBe(before);
  });

  it("does not choose the later timestamp when both branches contain edits", async () => {
    const base = await version();
    const local = await version(
      data("Local"),
      base.recordMetadata,
      "2026-10-05T13:00:00.000Z",
    );
    const remote = await version(
      data("Original", "Remote"),
      base.recordMetadata,
      "2026-10-05T15:00:00.000Z",
    );
    expect(summarizeCloudSyncVersionHistory(local, remote)).toMatchObject({
      relationship: "diverged",
      sharedRevisions: base.recordMetadata.journal.length,
    });
    const body = data("Local", "Remote");
    const merged = {
      ...body,
      recordMetadata: await reconcileMergedRecordLedgers(
        body,
        local.recordMetadata,
        remote.recordMetadata,
      ),
    };
    expect(summarizeCloudSyncVersionHistory(merged, local).relationship).toBe(
      "local-ahead",
    );
    expect(summarizeCloudSyncVersionHistory(merged, remote).relationship).toBe(
      "local-ahead",
    );
  });

  it("recognizes unrelated histories without using their dates as ordering", async () => {
    const a = await version();
    const b = await version(data(), undefined, "2026-10-06T12:00:00.000Z");
    expect(summarizeCloudSyncVersionHistory(a, b)).toEqual({
      relationship: "unrelated",
    });
  });

  it("handles tombstones and restoration as real descendant revisions", async () => {
    const base = await version();
    const body = { connections: [data().connections[0]] };
    const deleted = {
      ...body,
      recordMetadata: await reconcileRecordLedger(body, base.recordMetadata, {
        mode: "write",
      }),
    };
    expect(summarizeCloudSyncVersionHistory(deleted, base).relationship).toBe(
      "local-ahead",
    );
    const restored = await version(data(), deleted.recordMetadata);
    expect(
      summarizeCloudSyncVersionHistory(restored, deleted).relationship,
    ).toBe("local-ahead");
  });

  it("cannot treat conflicting stamps for the same revision as the same history", async () => {
    const base = await version();
    const forged = structuredClone(base);
    forged.recordMetadata.records.$.contentHash = "f".repeat(64);
    expect(summarizeCloudSyncVersionHistory(base, forged)).toEqual({
      relationship: "incompatible",
    });
  });

  it("reports missing, invalid and over-limit history without mutating it or leaking errors", () => {
    expect(summarizeCloudSyncVersionHistory({}, {})).toEqual({
      relationship: "unavailable",
    });
    expect(
      summarizeCloudSyncVersionHistory(
        { recordMetadata: { private: "SECRET" } },
        { recordMetadata: {} },
      ),
    ).toEqual({ relationship: "incompatible" });
    expect(
      summarizeCloudSyncVersionHistory(
        { recordMetadata: { journal: new Array(5_001) } },
        { recordMetadata: {} },
      ),
    ).toEqual({ relationship: "limited" });
  });

  it.each([null, false, 0, ""])(
    "does not hide present corrupt metadata %s behind a missing peer",
    (recordMetadata) => {
      expect(summarizeCloudSyncVersionHistory({ recordMetadata }, {})).toEqual({
        relationship: "incompatible",
      });
      expect(summarizeCloudSyncVersionHistory({}, { recordMetadata })).toEqual({
        relationship: "incompatible",
      });
    },
  );

  it("caps metadata bytes independently of event count without weakening the ledger validator", async () => {
    const base = await version();
    const oversized = structuredClone(base);
    oversized.recordMetadata.journal[0].record = "x".repeat(600 * 1024);
    expect(summarizeCloudSyncVersionHistory(oversized, base)).toEqual({
      relationship: "limited",
    });
    expect(summarizeCloudSyncVersionHistory(base, oversized)).toEqual({
      relationship: "limited",
    });
  });
});
