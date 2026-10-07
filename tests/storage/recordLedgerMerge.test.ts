import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  normalizeRecordLedger,
  reconcileMergedRecordLedgers,
  reconcileRecordLedger,
  type RecordChange,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const clone = <T>(value: T): T => structuredClone(value);
const write = (now = "2026-10-02T12:00:00.000Z") => ({
  mode: "write" as const,
  now,
});
const data = (a = "a", b = "b") => ({
  scripts: [
    { id: "a", name: a },
    { id: "b", name: b },
  ],
});
async function fork() {
  const base = await reconcileRecordLedger(data());
  const left = await reconcileRecordLedger(data("local"), base, write());
  const right = await reconcileRecordLedger(data("a", "remote"), base, write());
  const payload = data("local", "remote");
  const merged = await reconcileMergedRecordLedgers(payload, left, right);
  return { base, left, right, payload, merged };
}
function rootMerge(ledger: RecordLedger): RecordChange {
  return ledger.journal.find(
    (event) => event.record === "$" && event.kind === "merge",
  )!;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("record ledger v2 DAG merge", () => {
  it("joins real root/container forks with both parents and every original event unchanged", async () => {
    const { left, right, payload, merged } = await fork();
    expect(merged.version).toBe(2);
    expect(merged.journal).toEqual(expect.arrayContaining(left.journal));
    expect(merged.journal).toEqual(expect.arrayContaining(right.journal));
    expect(
      merged.journal
        .filter((event) => event.kind === "merge")
        .map((event) => event.record)
        .sort(),
    ).toEqual(["$", "$/scripts"]);
    for (const key of ["$", "$/scripts"]) {
      const event = merged.journal.find(
        (item) => item.revision === merged.records[key].revision,
      )!;
      expect(event.parentRevisions).toEqual(
        [left.records[key].revision, right.records[key].revision].sort(),
      );
      expect(event).not.toHaveProperty("parentRevision");
      expect(event.timestamp).toBe("2026-10-02T12:00:00.001Z");
      expect(merged.records[key].updatedAtSource).toBe("inferred");
    }
    expect(await reconcileRecordLedger(payload, merged)).toEqual(merged);
    expect(normalizeRecordLedger(merged)).toEqual(merged);
    expect(await reconcileMergedRecordLedgers(payload, right, left)).toEqual(
      merged,
    );
    const original = clone([left, right, payload]);
    await reconcileMergedRecordLedgers(
      freeze(payload),
      freeze(left),
      freeze(right),
    );
    expect([left, right, payload]).toEqual(original);
  });

  it("retains compatible v1 journals without an unnecessary version bump or rewriting", async () => {
    const { base, left } = await fork();
    for (const inputs of [
      [base, left],
      [left, base],
      [left, left],
      [undefined, left],
    ]) {
      const result = await reconcileMergedRecordLedgers(
        data("local"),
        inputs[0],
        inputs[1],
      );
      expect(result).toEqual(left);
      expect(result.version).toBe(1);
    }
    expect(await reconcileMergedRecordLedgers(data())).toEqual(base);
    expect(() => normalizeRecordLedger({ ...left, version: 2 })).toThrow(
      /explicit merge/,
    );
    expect(() => normalizeRecordLedger({ ...left, version: 4 })).toThrow(
      /unsupported version/,
    );
  });

  it("supports local writes after merge, repeated merges, and another two-branch merge without history nesting", async () => {
    const { merged, payload } = await fork();
    expect(await reconcileMergedRecordLedgers(payload, merged, merged)).toEqual(
      merged,
    );
    const nextPayload = data("next local", "remote");
    const next = await reconcileRecordLedger(
      nextPayload,
      merged,
      write("2000-01-01T00:00:00.000Z"),
    );
    expect(next.version).toBe(2);
    expect(next.journal).toEqual(expect.arrayContaining(merged.journal));
    expect(
      next.journal.find(
        (event) => event.revision === next.records["$"].revision,
      )?.parentRevision,
    ).toBe(merged.records["$"].revision);
    expect(
      await reconcileMergedRecordLedgers(nextPayload, merged, next),
    ).toEqual(next);
    const other = await reconcileRecordLedger(
      data("local", "next remote"),
      merged,
      write(),
    );
    const joined = await reconcileMergedRecordLedgers(
      data("next local", "next remote"),
      next,
      other,
    );
    expect(joined.journal).toEqual(expect.arrayContaining(next.journal));
    expect(joined.journal).toEqual(expect.arrayContaining(other.journal));
    expect(Object.keys(joined).sort()).toEqual([
      "journal",
      "records",
      "version",
    ]);
    const originalEvents = new Set(
      [...next.journal, ...other.journal].map((event) => event.revision),
    );
    expect(joined.journal.length).toBe(originalEvents.size + 2);
    expect(
      await reconcileRecordLedger(data("next local", "next remote"), joined),
    ).toEqual(joined);
  });

  it("retains concurrent deletions as merge tombstones and supports later restoration", async () => {
    const base = await reconcileRecordLedger(data());
    const deleted = { scripts: [data().scripts[1]] };
    const left = await reconcileRecordLedger(deleted, base, write());
    const right = await reconcileRecordLedger(
      deleted,
      base,
      write("2026-10-02T13:00:00.000Z"),
    );
    const joined = await reconcileMergedRecordLedgers(deleted, left, right);
    const key = "$/scripts/@a";
    expect(
      joined.journal.find(
        (event) => event.revision === joined.records[key].revision,
      ),
    ).toMatchObject({
      kind: "merge-delete",
      parentRevisions: [
        left.records[key].revision,
        right.records[key].revision,
      ].sort(),
    });
    expect(joined.records[key].deletedAt).toBe(joined.records[key].updatedAt);
    expect(await reconcileRecordLedger(deleted, joined)).toEqual(joined);
    const restored = await reconcileRecordLedger(data(), joined, write());
    expect(restored.journal).toEqual(expect.arrayContaining(joined.journal));
    expect(
      restored.journal.find(
        (event) => event.revision === restored.records[key].revision,
      ),
    ).toMatchObject({
      kind: "restore",
      parentRevision: joined.records[key].revision,
    });
    expect(restored.records[key]).not.toHaveProperty("deletedAt");
  });

  it("rejects unrelated histories, revision/stamp collisions, and unsafe input without altering sources", async () => {
    const { left, right, payload } = await fork();
    const unrelated = await reconcileRecordLedger(
      data("local", "remote"),
      undefined,
      write(),
    );
    await expect(
      reconcileMergedRecordLedgers(payload, left, unrelated),
    ).rejects.toThrow(/unrelated/);
    const badStamp = clone(left);
    badStamp.records["$/scripts/@a"].contentHash = "f".repeat(64);
    await expect(
      reconcileMergedRecordLedgers(payload, left, badStamp),
    ).rejects.toThrow(/stamp collision/);
    const badEvent = clone(left);
    const initial = badEvent.journal.find(
      (event) => event.record === "$" && event.kind === "migrate",
    )!;
    initial.timestamp = "1970-01-01T00:00:00.001Z";
    await expect(
      reconcileMergedRecordLedgers(payload, left, badEvent),
    ).rejects.toThrow(/identity collision/);
    const getter = vi.fn(() => "PRIVATE_SECRET");
    const unsafe = Object.defineProperty({}, "private", {
      enumerable: true,
      get: getter,
    });
    await expect(
      reconcileMergedRecordLedgers(unsafe, left, right),
    ).rejects.toThrow(/non-data/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not choose a tombstone content hash by clock when deleted histories diverge", async () => {
    const base = await reconcileRecordLedger(data());
    const changed = await reconcileRecordLedger(data("changed"), base, write());
    const deleted = { scripts: [data().scripts[1]] };
    const left = await reconcileRecordLedger(deleted, base, write());
    const right = await reconcileRecordLedger(deleted, changed, write());
    await expect(
      reconcileMergedRecordLedgers(deleted, left, right),
    ).rejects.toThrow(/ambiguous deleted/);
  });
});

describe("strict v2 history validation", () => {
  const mutations: [string, (ledger: RecordLedger) => void][] = [
    [
      "missing parent",
      (ledger) => {
        rootMerge(ledger).parentRevisions![0] = "missing";
        rootMerge(ledger).parentRevisions!.sort();
      },
    ],
    [
      "cross-record parent",
      (ledger) => {
        rootMerge(ledger).parentRevisions![0] =
          ledger.records["$/scripts/@a"].revision;
        rootMerge(ledger).parentRevisions!.sort();
      },
    ],
    [
      "duplicate parent",
      (ledger) => {
        rootMerge(ledger).parentRevisions![1] =
          rootMerge(ledger).parentRevisions![0];
      },
    ],
    [
      "unsorted parents",
      (ledger) => {
        rootMerge(ledger).parentRevisions!.reverse();
      },
    ],
    [
      "single merge parent",
      (ledger) => {
        rootMerge(ledger).parentRevisions!.pop();
      },
    ],
    [
      "excessive parents",
      (ledger) => {
        rootMerge(ledger).parentRevisions = Array.from({ length: 65 }, (_, i) =>
          String(i).padStart(3, "0"),
        );
      },
    ],
    [
      "self-cycle",
      (ledger) => {
        rootMerge(ledger).parentRevisions![0] = rootMerge(ledger).revision;
        rootMerge(ledger).parentRevisions!.sort();
      },
    ],
    [
      "forward parent",
      (ledger) => {
        const event = rootMerge(ledger);
        ledger.journal.splice(ledger.journal.indexOf(event), 1);
        ledger.journal.unshift(event);
      },
    ],
    [
      "both parent formats",
      (ledger) => {
        rootMerge(ledger).parentRevision =
          rootMerge(ledger).parentRevisions![0];
      },
    ],
    [
      "unknown kind",
      (ledger) => {
        (rootMerge(ledger) as { kind: string }).kind = "choose-newest";
      },
    ],
    [
      "duplicate revision",
      (ledger) => {
        ledger.journal.push(clone(rootMerge(ledger)));
      },
    ],
    [
      "unresolved heads",
      (ledger) => {
        const merge = rootMerge(ledger);
        const parent = ledger.journal.find(
          (event) => event.revision === merge.parentRevisions![0],
        )!;
        const branch = { ...parent, revision: "unresolved-private-branch" };
        ledger.journal.push(branch);
      },
    ],
    [
      "unresolved stamp",
      (ledger) => {
        ledger.records["$"].revision = rootMerge(ledger).parentRevisions![0];
      },
    ],
    [
      "noncausal time",
      (ledger) => {
        rootMerge(ledger).timestamp = "2026-10-02T12:00:00.000Z";
        ledger.records["$"].updatedAt = rootMerge(ledger).timestamp;
      },
    ],
    [
      "observed merge time",
      (ledger) => {
        ledger.records["$"].updatedAtSource = "observed";
      },
    ],
    [
      "changed creation provenance",
      (ledger) => {
        ledger.records["$"].createdAtSource = "observed";
      },
    ],
    [
      "merge parents on ordinary event",
      (ledger) => {
        ledger.journal[0].parentRevisions = [];
      },
    ],
    [
      "deleted root",
      (ledger) => {
        rootMerge(ledger).kind = "merge-delete";
        ledger.records["$"].deletedAt = ledger.records["$"].updatedAt;
      },
    ],
    [
      "future version",
      (ledger) => {
        (ledger as { version: number }).version = 4;
      },
    ],
    [
      "v2 events disguised as v1",
      (ledger) => {
        ledger.version = 1;
      },
    ],
  ];
  it.each(mutations)(
    "rejects %s without leaking identities or mutating metadata",
    async (_name, mutate) => {
      const ledger = (await fork()).merged;
      mutate(ledger);
      const before = clone(ledger);
      expect(() => normalizeRecordLedger(freeze(ledger))).toThrow(
        /Invalid record ledger:/,
      );
      try {
        normalizeRecordLedger(ledger);
      } catch (error) {
        expect(String(error)).not.toMatch(
          /\$\/scripts|unresolved-private-branch/,
        );
      }
      expect(ledger).toEqual(before);
    },
  );
});
