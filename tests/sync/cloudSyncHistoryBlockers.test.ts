import { webcrypto } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as ledger from "../../src/utils/storage/recordLedger";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
} from "../../src/utils/services/cloudSyncSmartMerge";
import {
  reviewConflictGuidance,
  reviewConflictLabels,
  summarizeCloudSyncReview,
  type SmartSyncConflictCode,
} from "../../src/utils/services/cloudSyncReviewDetails";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

const data = (a = "PRIVATE_A", b = "PRIVATE_B") => ({
  connections: [
    { id: "PRIVATE_A_ID", name: a },
    { id: "PRIVATE_B_ID", name: b },
  ],
});
const key = "$/connections/@PRIVATE_A_ID";
const write = (now = "2026-10-04T11:42:20.010Z") => ({
  mode: "write" as const,
  now,
});
async function tracked(
  body: ReturnType<typeof data>,
  prior?: ledger.RecordLedger,
  options?: Parameters<typeof ledger.reconcileRecordLedger>[2],
) {
  return {
    ...body,
    recordMetadata: await ledger.reconcileRecordLedger(body, prior, options),
  };
}
type Section = Awaited<ReturnType<typeof tracked>>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function expectBlocker(
  base: Section,
  local: Section,
  remote: Section,
  code: SmartSyncConflictCode,
) {
  const before = JSON.stringify([base, local, remote]);
  const checkpoint = await buildSmartSyncBaseline(base);
  for (const [left, right] of [
    [local, remote],
    [remote, local],
  ]) {
    const result = await smartMergeSyncSection(
      freeze(left),
      freeze(right),
      checkpoint,
    );
    expect(result).toEqual({
      conflictCount: 1,
      reason: `${reviewConflictLabels[code]}. No history was discarded.`,
      conflicts: [{ code, kind: "other", count: 1 }],
    });
    expect(result).not.toHaveProperty("value");
    const receipt = JSON.stringify(result);
    expect(receipt).not.toMatch(/PRIVATE_|recordMetadata|\$\//);
    for (const source of [base, local, remote])
      for (const event of source.recordMetadata.journal)
        expect(receipt).not.toContain(event.revision);
    expect(reviewConflictGuidance[code]).toBeTruthy();
  }
  expect(JSON.stringify([base, local, remote])).toBe(before);
}

describe("specific, private-data-free history merge blockers", () => {
  it("distinguishes a shared content baseline from separately started record histories", async () => {
    const base = await tracked(data());
    const local = await tracked(
      data("PRIVATE_EDIT"),
      base.recordMetadata,
      write(),
    );
    // Simulates an independent import/migration, not a descendant write.
    const remote = await tracked(data(), undefined, write());
    await expectBlocker(base, local, remote, "history-unrelated");
    const details = summarizeCloudSyncReview(
      "database:PRIVATE_DB",
      local,
      remote,
      true,
    );
    expect(details.hasBaseline).toBe(true);
    expect(
      details.records.find((row) => row.kind === "connections"),
    ).toMatchObject({ different: 1, same: 1 });
  });

  it("identifies different events using the same revision without disclosing that revision", async () => {
    const base = await tracked(data());
    const local = await tracked(
      data("PRIVATE_EDIT"),
      base.recordMetadata,
      write(),
    );
    const remote = structuredClone(local);
    remote.recordMetadata.journal.find(
      (event) => event.record === "$" && event.kind === "migrate",
    )!.timestamp = "1970-01-01T00:00:00.001Z";
    // Each input is individually valid and still describes its current data.
    expect(ledger.normalizeRecordLedger(remote.recordMetadata)).toEqual(
      remote.recordMetadata,
    );
    await expectBlocker(base, local, remote, "history-revision-collision");
  });

  it("identifies creation provenance disagreements instead of guessing a timezone", async () => {
    const base = await tracked(data());
    const remote = structuredClone(base);
    remote.recordMetadata.records[key].createdAtSource = "record";
    expect(ledger.normalizeRecordLedger(remote.recordMetadata)).toEqual(
      remote.recordMetadata,
    );
    await expectBlocker(base, base, remote, "history-creation-provenance");
  });

  it("identifies different metadata for an identical deleted-record revision", async () => {
    const base = await tracked(data());
    const local = await tracked(
      { connections: [data().connections[1]] },
      base.recordMetadata,
      write(),
    );
    const remote = structuredClone(local);
    remote.recordMetadata.records[key].contentHash = "f".repeat(64);
    expect(ledger.normalizeRecordLedger(remote.recordMetadata)).toEqual(
      remote.recordMetadata,
    );
    await expectBlocker(base, local, remote, "history-stamp-collision");
  });

  it("identifies deletion history ambiguity even when all current content is identical", async () => {
    const base = await tracked(data());
    const changed = await tracked(
      data("PRIVATE_EDIT"),
      base.recordMetadata,
      write(),
    );
    const deleted = { connections: [data().connections[1]] };
    const local = await tracked(deleted, base.recordMetadata, write());
    const remote = await tracked(deleted, changed.recordMetadata, write());
    await expectBlocker(base, local, remote, "history-deleted-content");
  });

  it("identifies timestamp overflow without resetting dates or discarding either history", async () => {
    const base = await tracked(data());
    const local = await tracked(
      data("PRIVATE_EDIT"),
      base.recordMetadata,
      write("9999-12-31T23:59:59.998Z"),
    );
    const remote = await tracked(
      data("PRIVATE_A", "PRIVATE_EDIT"),
      base.recordMetadata,
      write("9999-12-31T23:59:59.999Z"),
    );
    await expectBlocker(base, local, remote, "history-timestamp-overflow");
  });

  it("never forwards an unexpected exception message from history processing", async () => {
    const base = await tracked(data());
    vi.spyOn(ledger, "reconcileMergedRecordLedgers").mockRejectedValue(
      new Error("PRIVATE_RECORD_ID PRIVATE_SECRET"),
    );
    await expectBlocker(base, base, base, "history-incompatible");
  });

  it.each([
    ["missing-branch-head", "history-missing-head"],
    ["safety-limit", "history-safety-limit"],
    ["invalid-ledger", "history-invalid"],
  ] satisfies [ledger.RecordLedgerErrorCode, SmartSyncConflictCode][])(
    "reports %s using only its fixed diagnostic, never its exception text",
    async (code, conflictCode) => {
      const base = await tracked(data());
      // Exercise the service contract without allocating a million-event
      // journal or manufacturing an otherwise invalid input before this phase.
      vi.spyOn(ledger, "reconcileMergedRecordLedgers").mockRejectedValue(
        new ledger.RecordLedgerError(code, "PRIVATE_EXCEPTION_TEXT"),
      );
      await expectBlocker(base, base, base, conflictCode);
    },
  );

  it("provides guidance for every fixed conflict code including legacy generic reports", () => {
    expect(Object.keys(reviewConflictGuidance).sort()).toEqual(
      Object.keys(reviewConflictLabels).sort(),
    );
    for (const text of Object.values(reviewConflictGuidance))
      expect(text.length).toBeGreaterThan(20);
    expect(reviewConflictGuidance["history-incompatible"]).toContain(
      "Refresh review",
    );
  });
});
