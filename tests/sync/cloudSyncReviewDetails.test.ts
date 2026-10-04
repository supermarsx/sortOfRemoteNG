import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { summarizeCloudSyncReview } from "../../src/utils/services/cloudSyncReviewDetails";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
} from "../../src/utils/services/cloudSyncSmartMerge";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const record = (id: string, value = "PRIVATE_VALUE") => ({ id, value });
const date = "2026-09-01T12:00:00.000Z";
const ledger = (updatedAt: string, updatedAtSource = "observed") => ({
  records: { $: { updatedAt, updatedAtSource } },
});

describe("metadata-only sync review details", () => {
  it("compares stable records by category without names, IDs, values, private fields or source mutation", () => {
    const local = {
      connections: [
        record("PRIVATE_SAME"),
        record("PRIVATE_EDIT", "PRIVATE_LOCAL"),
        record("PRIVATE_ONLY_LOCAL"),
      ],
      credentialVault: { entries: [record("PRIVATE_CREDENTIAL")] },
      documents: { documents: [record("PRIVATE_DOCUMENT")] },
      automationLibrary: { terminalMacros: [record("PRIVATE_MACRO")] },
      privatePath: "F:/PRIVATE_PATH",
      recordMetadata: ledger(date),
    };
    const remote = {
      connections: [
        record("PRIVATE_EDIT", "PRIVATE_REMOTE"),
        record("PRIVATE_SAME"),
        record("PRIVATE_ONLY_REMOTE"),
      ],
      recordMetadata: ledger("2026-09-02T12:00:00.000Z", "inferred"),
    };
    const before = JSON.stringify([local, remote]);
    const details = summarizeCloudSyncReview(
      "database:PRIVATE_ID",
      local,
      remote,
      true,
      Date.parse(date),
    );
    expect(
      details.records.find((entry) => entry.kind === "connections"),
    ).toEqual({
      kind: "connections",
      local: 3,
      remote: 3,
      same: 1,
      different: 1,
      localOnly: 1,
      remoteOnly: 1,
      reordered: true,
    });
    for (const kind of ["credentials", "documents", "terminalMacros"])
      expect(
        details.records.find((entry) => entry.kind === kind),
      ).toMatchObject({ local: 1, remote: 0, localOnly: 1 });
    expect(details.localRecordedAt).toEqual({ at: date, source: "observed" });
    expect(details.remoteRecordedAt?.source).toBe("inferred");
    expect(details.remoteSnapshotAt).toBe(date);
    expect(details.otherDifferences).toBe(true);
    expect(JSON.stringify(details)).not.toMatch(
      /PRIVATE_|privatePath|recordMetadata/,
    );
    expect(JSON.stringify([local, remote])).toBe(before);
  });

  it("counts database settings separately and app preferences without the ledger", () => {
    const details = summarizeCloudSyncReview(
      "database:db",
      {
        settings: { theme: "PRIVATE_LOCAL" },
        databaseSettings: { mode: "PRIVATE_LOCAL" },
      },
      {
        settings: { theme: "PRIVATE_REMOTE" },
        databaseSettings: { mode: "PRIVATE_REMOTE" },
      },
      true,
    );
    expect(details.records.filter((row) => row.different)).toEqual([
      expect.objectContaining({ kind: "preferences", different: 1 }),
      expect.objectContaining({ kind: "databasePreferences", different: 1 }),
    ]);
    expect(details.otherDifferences).toBe(false);
    const settings = summarizeCloudSyncReview(
      "app:settings",
      { theme: "dark", recordMetadata: ledger(date) },
      { theme: "dark" },
      true,
    );
    expect(settings.records[0]).toMatchObject({
      local: 1,
      remote: 1,
      same: 1,
      different: 0,
    });
    expect(settings.otherDifferences).toBe(true);
  });

  it("flags history-only and unknown private-field differences without outputting their keys", () => {
    for (const extra of [
      { recordMetadata: ledger(date) },
      { PRIVATE_PATH: "PRIVATE_VALUE" },
      { PRIVATE_PATH: null },
      { "documents/documents": "PRIVATE_VALUE" },
    ]) {
      const details = summarizeCloudSyncReview(
        "database:db",
        { connections: [record("private")], ...extra },
        { connections: [record("private")] },
        true,
      );
      expect(
        details.records.find((row) => row.kind === "connections"),
      ).toMatchObject({ same: 1, different: 0 });
      expect(details.otherDifferences).toBe(true);
      expect(JSON.stringify(details)).not.toMatch(/PRIVATE_|recordMetadata/);
    }
  });

  it("never calls archive capture/export dates last record edits, and treats epoch/invalid dates as unknown", () => {
    for (const stamp of [
      "1970-01-01T00:00:00.000Z",
      "PRIVATE_VALUE",
      "",
      "99999-01-01T00:00:00Z",
    ])
      expect(
        summarizeCloudSyncReview(
          "database:db",
          {
            timestamp: Date.now(),
            collection: { exportDate: date },
            recordMetadata: ledger(stamp),
          },
          {},
          false,
          NaN,
        ),
      ).toMatchObject({
        localRecordedAt: undefined,
        remoteRecordedAt: undefined,
        remoteSnapshotAt: undefined,
      });
  });

  it.each([
    [
      "app:recording.managed-scripts",
      { customScripts: [record("x")], modifiedDefaults: [] },
      "terminalScripts",
    ],
    [
      "app:recording.terminal-macros",
      { macros: [record("x")] },
      "terminalMacros",
    ],
    [
      "app:recording.web-automation.v1",
      { scripts: [record("x")], macros: [] },
      "websiteScripts",
    ],
    ["app:documents.app-wide.v1", { documents: [record("x")] }, "documents"],
  ])("summarizes %s in its original scope", (id, body, kind) => {
    expect(
      summarizeCloudSyncReview(id as string, body, body, true).records.find(
        (row) => row.kind === kind,
      ),
    ).toMatchObject({ local: 1, remote: 1, same: 1 });
  });

  it("marks unsupported/ambiguous or over-budget categories incomplete instead of deduplicating or claiming equality", () => {
    for (const connections of [
      [record("same"), record("same")],
      Array.from({ length: 200_001 }, () => record("x")),
    ])
      expect(
        summarizeCloudSyncReview("database:db", { connections }, {}, false),
      ).toMatchObject({ comparisonLimited: true, otherDifferences: true });
    expect(
      summarizeCloudSyncReview("unknown", {}, {}, false).comparisonLimited,
    ).toBe(true);
  });
});

describe("specific smart merge blockers", () => {
  it.each([
    [
      { connections: [record("private", "base")] },
      { connections: [record("private", "local")] },
      { connections: [record("private", "remote")] },
      "concurrent-edit",
    ],
    [
      { connections: [record("private")] },
      { connections: [] },
      { connections: [record("private", "edit")] },
      "delete-versus-edit",
    ],
    [
      { connections: [] },
      { connections: [record("private", "local")] },
      { connections: [record("private", "remote")] },
      "concurrent-addition",
    ],
    [
      { connections: [record("a"), record("b")] },
      { connections: [record("a"), record("b"), record("x")] },
      { connections: [record("a"), record("b"), record("y")] },
      "ordering",
    ],
  ])("identifies %s safely", async (base, local, remote, code) => {
    const result = await smartMergeSyncSection(
      local,
      remote,
      await buildSmartSyncBaseline(base),
    );
    expect(result.conflicts).toContainEqual({
      code,
      kind: "connections",
      count: 1,
    });
    expect(result).not.toHaveProperty("value");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|private/);
  });
  it("distinguishes missing baseline from an actual record conflict", async () => {
    expect(
      (
        await smartMergeSyncSection(
          { theme: "PRIVATE_LOCAL" },
          { theme: "PRIVATE_REMOTE" },
        )
      ).conflicts,
    ).toEqual([{ code: "missing-baseline", kind: "other", count: 1 }]);
  });
});
