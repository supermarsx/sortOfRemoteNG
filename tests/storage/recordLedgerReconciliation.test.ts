import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  normalizeRecordLedger,
  reconcileMergedRecordLedgers,
  reconcileRecordLedger,
  type RecordLedger,
  type RecordChange,
  RecordLedgerError,
} from "../../src/utils/storage/recordLedger";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const data = (a = "a", b = "b") => ({
  scripts: [
    { id: "a", name: a },
    { id: "b", name: b },
  ],
});
const write = (now: string) => ({ mode: "write" as const, now });
const roots = (ledger: RecordLedger) =>
  ledger.journal.filter(
    (event) => !event.parentRevision && !event.parentRevisions,
  );
const repair = { reconcileOrigins: true };
const parents = (event: RecordChange) =>
  event.parentRevisions ?? (event.parentRevision ? [event.parentRevision] : []);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function initial(now = "2026-01-01T00:00:00.000Z") {
  return reconcileRecordLedger(data(), undefined, write(now));
}
async function fixture() {
  const left = await initial();
  const right = await initial("2026-01-02T00:00:00.000Z");
  const merged = await reconcileMergedRecordLedgers(
    data(),
    left,
    right,
    repair,
  );
  return { left, right, merged };
}

describe("explicit v3 independent-root reconciliation", () => {
  it("keeps strict defaults, original events and every root's creation provenance", async () => {
    const { left, right, merged } = await fixture();
    const before = structuredClone([left, right]);
    for (const options of [undefined, { reconcileOrigins: false }]) {
      await expect(
        reconcileMergedRecordLedgers(data(), left, right, options),
      ).rejects.toMatchObject({ code: "unrelated-histories" });
    }
    expect(merged.version).toBe(3);
    expect(Object.keys(merged).sort()).toEqual([
      "journal",
      "origins",
      "records",
      "version",
    ]);
    expect(merged.journal).toEqual(expect.arrayContaining(left.journal));
    expect(merged.journal).toEqual(expect.arrayContaining(right.journal));
    expect(Object.keys(merged.origins!).sort()).toEqual(
      [...roots(left), ...roots(right)].map((event) => event.revision).sort(),
    );
    for (const ledger of [left, right])
      for (const event of roots(ledger)) {
        expect(merged.origins![event.revision]).toEqual({
          createdAt: ledger.records[event.record].createdAt,
          createdAtSource: ledger.records[event.record].createdAtSource,
        });
      }
    for (const [key, stamp] of Object.entries(merged.records)) {
      expect(stamp.createdAt).toBe(left.records[key].createdAt);
      expect(stamp.createdAtSource).toBe("inferred");
      const event = merged.journal.find(
        (event) => event.revision === stamp.revision,
      )!;
      expect(event.kind).toBe("reconcile");
      expect(event.parentRevisions).toEqual(
        [left.records[key].revision, right.records[key].revision].sort(),
      );
      expect(event.timestamp).toBe("2026-01-02T00:00:00.001Z");
      expect(stamp.updatedAtSource).toBe("inferred");
    }
    expect(
      await reconcileMergedRecordLedgers(
        freeze(data()),
        freeze(right),
        freeze(left),
        repair,
      ),
    ).toEqual(merged);
    expect([left, right]).toEqual(before);
    expect(normalizeRecordLedger(JSON.parse(JSON.stringify(merged)))).toEqual(
      merged,
    );
  });

  it("never chooses content by clock and preserves migrate/observed origins", async () => {
    const legacy = await reconcileRecordLedger(data());
    const imported = await initial("2099-01-01T00:00:00.000Z");
    const left = await reconcileRecordLedger(
      data("reviewed-a"),
      legacy,
      write("2000-01-01T00:00:00.000Z"),
    );
    const right = await reconcileRecordLedger(
      data("a", "reviewed-b"),
      imported,
      write("2100-01-01T00:00:00.000Z"),
    );
    const content = data("reviewed-a", "reviewed-b");
    const merged = await reconcileMergedRecordLedgers(
      content,
      left,
      right,
      repair,
    );
    expect(await reconcileRecordLedger(content, merged)).toEqual(merged);
    expect(merged.journal).toEqual(expect.arrayContaining(left.journal));
    expect(merged.journal).toEqual(expect.arrayContaining(right.journal));
    expect(merged.records["$"].createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(merged.origins![roots(legacy)[0].revision].createdAtSource).toBe(
      "inferred",
    );
    expect(merged.origins![roots(imported)[0].revision].createdAtSource).toBe(
      "observed",
    );
  });

  it("is idempotent with either contained pre-repair peer, including different summaries", async () => {
    const { left, right, merged } = await fixture();
    for (const peer of [left, right, merged])
      for (const inputs of [
        [merged, peer],
        [peer, merged],
      ]) {
        expect(
          await reconcileMergedRecordLedgers(data(), inputs[0], inputs[1]),
        ).toEqual(merged);
        expect(
          await reconcileMergedRecordLedgers(
            data(),
            inputs[0],
            inputs[1],
            repair,
          ),
        ).toEqual(merged);
      }
    expect(await reconcileRecordLedger(data(), merged)).toEqual(merged);
  });

  it("accepts later offline edits from each known old root without another reconciliation", async () => {
    const { left, right, merged } = await fixture();
    for (const old of [left, right]) {
      const offline = await reconcileRecordLedger(
        data("offline"),
        old,
        write("2000-01-01T00:00:00.000Z"),
      );
      const current = await reconcileRecordLedger(
        data("a", "current"),
        merged,
        write("2026-02-01T00:00:00.000Z"),
      );
      const content = data("offline", "current");
      const result = await reconcileMergedRecordLedgers(
        content,
        offline,
        current,
      );
      expect(result.version).toBe(3);
      expect(result.origins).toEqual(merged.origins);
      const originalRepairs = merged.journal.filter(
        (event) => event.kind === "reconcile",
      );
      const retainedRepairs = result.journal.filter(
        (event) => event.kind === "reconcile",
      );
      expect(retainedRepairs).toHaveLength(originalRepairs.length);
      expect(retainedRepairs).toEqual(expect.arrayContaining(originalRepairs));
      expect(result.journal).toEqual(expect.arrayContaining(offline.journal));
      expect(result.journal).toEqual(expect.arrayContaining(current.journal));
      expect(await reconcileRecordLedger(content, result)).toEqual(result);
      expect(
        await reconcileMergedRecordLedgers(content, current, offline),
      ).toEqual(result);
    }
  });

  it("retains v3 on ordinary writes, registers new roots and supports deletion/restoration", async () => {
    const { merged } = await fixture();
    const added = { scripts: [...data().scripts, { id: "new", name: "new" }] };
    const next = await reconcileRecordLedger(
      added,
      merged,
      write("2026-02-01T00:00:00.000Z"),
    );
    const root = roots(next).find(
      (event) => event.record === "$/scripts/@new",
    )!;
    expect(root.kind).toBe("create");
    expect(next.version).toBe(3);
    expect(next.origins![root.revision]).toEqual({
      createdAt: root.timestamp,
      createdAtSource: "observed",
    });
    expect(next.origins).toMatchObject(merged.origins!);
    const deleted = await reconcileRecordLedger(
      data(),
      next,
      write("2026-02-02T00:00:00.000Z"),
    );
    expect(deleted.origins).toEqual(next.origins);
    const restored = await reconcileRecordLedger(
      added,
      deleted,
      write("2026-02-03T00:00:00.000Z"),
    );
    expect(restored.origins).toEqual(next.origins);
    expect(restored.journal[restored.journal.length - 1]).toMatchObject({
      record: "$/scripts/@new",
      kind: "restore",
    });
    const migrated = await reconcileRecordLedger(added, merged);
    expect(
      roots(migrated).find((event) => event.record === "$/scripts/@new")!.kind,
    ).toBe("migrate");
    expect(normalizeRecordLedger(migrated)).toEqual(migrated);
  });

  it("joins equal tombstone contents explicitly and never invents ambiguous last content", async () => {
    const { left, right } = await fixture();
    const deleted = { scripts: [data().scripts[1]] };
    const a = await reconcileRecordLedger(
      deleted,
      left,
      write("2026-02-01T00:00:00.000Z"),
    );
    const b = await reconcileRecordLedger(
      deleted,
      right,
      write("2026-02-02T00:00:00.000Z"),
    );
    const merged = await reconcileMergedRecordLedgers(deleted, a, b, repair);
    const stamp = merged.records["$/scripts/@a"];
    expect(
      merged.journal.find((event) => event.revision === stamp.revision),
    ).toMatchObject({ kind: "reconcile-delete" });
    expect(stamp.deletedAt).toBe(stamp.updatedAt);
    expect(await reconcileRecordLedger(deleted, merged)).toEqual(merged);
    const restored = await reconcileRecordLedger(
      data(),
      merged,
      write("2026-02-03T00:00:00.000Z"),
    );
    expect(restored.records["$/scripts/@a"].deletedAt).toBeUndefined();
    const edited = await reconcileRecordLedger(
      data("different"),
      right,
      write("2026-02-01T00:00:00.000Z"),
    );
    const ambiguous = await reconcileRecordLedger(
      deleted,
      edited,
      write("2026-02-02T00:00:00.000Z"),
    );
    await expect(
      reconcileMergedRecordLedgers(deleted, a, ambiguous, repair),
    ).rejects.toMatchObject({ code: "deleted-content" });
  });

  it("keeps same-root provenance and revision collisions fatal even under explicit opt-in", async () => {
    const migrated = await reconcileRecordLedger(data());
    const original = structuredClone(migrated);
    const bad = structuredClone(migrated);
    bad.records["$"].createdAtSource = "record";
    expect(normalizeRecordLedger(bad)).toEqual(bad);
    await expect(
      reconcileMergedRecordLedgers(data(), migrated, bad, repair),
    ).rejects.toMatchObject({ code: "creation-provenance" });
    const independent = await initial();
    const repaired = await reconcileMergedRecordLedgers(
      data(),
      migrated,
      independent,
      repair,
    );
    await expect(
      reconcileMergedRecordLedgers(data(), repaired, bad, repair),
    ).rejects.toMatchObject({ code: "creation-provenance" });
    const colliding = structuredClone(migrated);
    colliding.journal.find((event) => event.record === "$")!.timestamp =
      "1970-01-01T00:00:00.001Z";
    colliding.records["$"].updatedAt = "1970-01-01T00:00:00.001Z";
    await expect(
      reconcileMergedRecordLedgers(data(), migrated, colliding, repair),
    ).rejects.toMatchObject({ code: "revision-identity-collision" });
    const badStamp = structuredClone(migrated);
    badStamp.records["$"].contentHash = "f".repeat(64);
    await expect(
      reconcileMergedRecordLedgers(data(), migrated, badStamp, repair),
    ).rejects.toMatchObject({ code: "revision-stamp-collision" });
    expect(migrated).toEqual(original);
  });

  it("combines overlapping reconciled root sets normally but requires opt-in for disjoint sets", async () => {
    const a = await initial("2026-01-01T00:00:00.000Z");
    const b = await initial("2026-01-02T00:00:00.000Z");
    const c = await initial("2026-01-03T00:00:00.000Z");
    const d = await initial("2026-01-04T00:00:00.000Z");
    const ab = await reconcileMergedRecordLedgers(data(), a, b, repair);
    const bc = await reconcileMergedRecordLedgers(data(), b, c, repair);
    const abc = await reconcileMergedRecordLedgers(data(), ab, bc);
    expect(abc.journal[abc.journal.length - 1]?.kind).toBe("merge");
    expect(await reconcileMergedRecordLedgers(data(), bc, ab)).toEqual(abc);
    const cd = await reconcileMergedRecordLedgers(data(), c, d, repair);
    await expect(
      reconcileMergedRecordLedgers(data(), ab, cd),
    ).rejects.toMatchObject({ code: "unrelated-histories" });
    const all = await reconcileMergedRecordLedgers(data(), ab, cd, repair);
    expect(Object.keys(all.origins!)).toHaveLength(16);
    expect(all.journal[all.journal.length - 1]?.kind).toBe("reconcile");
  });

  it("does not upgrade v1/v2 unnecessarily and cannot produce v3 by version bump", async () => {
    const base = await initial();
    const a = await reconcileRecordLedger(
      data("left"),
      base,
      write("2026-02-01T00:00:00.000Z"),
    );
    const b = await reconcileRecordLedger(
      data("a", "right"),
      base,
      write("2026-02-01T00:00:00.000Z"),
    );
    const merged = await reconcileMergedRecordLedgers(
      data("left", "right"),
      a,
      b,
      repair,
    );
    expect(merged.version).toBe(2);
    expect(merged.origins).toBeUndefined();
    expect(
      await reconcileMergedRecordLedgers(data(), base, base, repair),
    ).toEqual(base);
    const origins = Object.fromEntries(
      roots(merged).map((event) => [
        event.revision,
        {
          createdAt: merged.records[event.record].createdAt,
          createdAtSource: merged.records[event.record].createdAtSource,
        },
      ]),
    );
    expect(() =>
      normalizeRecordLedger({ ...merged, version: 3, origins }),
    ).toThrow(/explicit reconciliation/);
  });
});

describe("strict v3 validation and bounds", () => {
  const mutations: [string, (ledger: RecordLedger) => void][] = [
    [
      "missing origins",
      (value) => {
        delete value.origins;
      },
    ],
    [
      "missing root provenance",
      (value) => {
        delete value.origins![roots(value)[0].revision];
      },
    ],
    [
      "extra provenance",
      (value) => {
        value.origins!.fake = {
          createdAt: "2026-01-01T00:00:00.000Z",
          createdAtSource: "inferred",
        };
      },
    ],
    [
      "root date mismatch",
      (value) => {
        value.origins![roots(value)[0].revision].createdAt =
          "2026-01-03T00:00:00.000Z";
      },
    ],
    [
      "root source mismatch",
      (value) => {
        value.origins![roots(value)[0].revision].createdAtSource = "inferred";
      },
    ],
    [
      "untrue summary",
      (value) => {
        value.records["$"].createdAt = "2026-01-02T00:00:00.000Z";
      },
    ],
    [
      "source summary mismatch",
      (value) => {
        value.records["$"].createdAtSource = "observed";
      },
    ],
    [
      "origins with content",
      (value) => {
        Object.assign(value.origins![roots(value)[0].revision], {
          content: "PRIVATE",
        });
      },
    ],
    [
      "ordinary merge disguises independent origins",
      (value) => {
        value.journal.find(
          (event) => event.record === "$" && event.kind === "reconcile",
        )!.kind = "merge";
      },
    ],
    [
      "duplicate parent",
      (value) => {
        const event = value.journal.find(
          (event) => event.kind === "reconcile",
        )!;
        event.parentRevisions![1] = event.parentRevisions![0];
      },
    ],
    [
      "self parent",
      (value) => {
        const event = value.journal.find(
          (event) => event.kind === "reconcile",
        )!;
        event.parentRevisions![0] = event.revision;
        event.parentRevisions!.sort();
      },
    ],
    [
      "cross-record parent",
      (value) => {
        const event = value.journal.find(
          (event) => event.kind === "reconcile",
        )!;
        event.parentRevisions![0] = roots(value).find(
          (root) => root.record !== event.record,
        )!.revision;
        event.parentRevisions!.sort();
      },
    ],
    [
      "too many parents",
      (value) => {
        value.journal.find(
          (event) => event.kind === "reconcile",
        )!.parentRevisions = Array.from({ length: 65 }, (_, i) =>
          String(i).padStart(3, "0"),
        );
      },
    ],
    [
      "old version with origins",
      (value) => {
        value.version = 2;
      },
    ],
    [
      "reconciliation timestamp not causal",
      (value) => {
        value.journal.find((event) => event.kind === "reconcile")!.timestamp =
          "1970-01-01T00:00:00.000Z";
      },
    ],
    [
      "unresolved roots",
      (value) => {
        const event = value.journal.find(
          (event) => event.record === "$" && event.kind === "reconcile",
        )!;
        value.journal.splice(value.journal.indexOf(event), 1);
      },
    ],
  ];
  it.each(mutations)(
    "rejects %s without mutating or exposing private identities",
    async (_, mutate) => {
      const { merged } = await fixture();
      mutate(merged);
      const before = structuredClone(merged);
      expect(() => normalizeRecordLedger(freeze(merged))).toThrow(
        RecordLedgerError,
      );
      try {
        normalizeRecordLedger(merged);
      } catch (error) {
        expect(String(error)).not.toMatch(/PRIVATE|\$\/scripts/);
      }
      expect(merged).toEqual(before);
    },
  );

  it("requires reconciliation in the actual parent ancestry, not elsewhere in the journal", async () => {
    const { merged } = await fixture();
    const joined = merged.journal.find(
      (event) => event.record === "$" && event.kind === "reconcile",
    )!;
    merged.journal.push({
      ...joined,
      kind: "merge",
      revision: "illegal-independent-merge",
      timestamp: "2026-01-02T00:00:00.002Z",
    });
    merged.journal.push({
      ...joined,
      kind: "merge",
      revision: "final",
      parentRevisions: [joined.revision, "illegal-independent-merge"].sort(),
      timestamp: "2026-01-02T00:00:00.003Z",
    });
    Object.assign(merged.records["$"], {
      revision: "final",
      updatedAt: "2026-01-02T00:00:00.003Z",
    });
    expect(() => normalizeRecordLedger(merged)).toThrow(
      /explicit reconciliation/,
    );
  });

  it("rejects fake reconciliation between already connected origins", async () => {
    const { merged } = await fixture();
    const a = await reconcileRecordLedger(
      data("a1"),
      merged,
      write("2026-02-01T00:00:00.000Z"),
    );
    const b = await reconcileRecordLedger(
      data("a", "b1"),
      merged,
      write("2026-02-01T00:00:00.000Z"),
    );
    const joined = await reconcileMergedRecordLedgers(data("a1", "b1"), a, b);
    joined.journal.find((event) => event.kind === "merge")!.kind = "reconcile";
    expect(() => normalizeRecordLedger(joined)).toThrow(/independent origins/);
  });

  it("bounds original roots without pruning, and retains aggregate byte limits", async () => {
    let merged = await reconcileRecordLedger(
      {},
      undefined,
      write("2026-01-01T00:00:00.000Z"),
    );
    for (let index = 1; index < 64; index++) {
      const next = await reconcileRecordLedger(
        {},
        undefined,
        write(`2026-01-01T00:00:00.${String(index).padStart(3, "0")}Z`),
      );
      merged = await reconcileMergedRecordLedgers({}, merged, next, repair);
    }
    expect(Object.keys(merged.origins!)).toHaveLength(64);
    expect(roots(merged)).toHaveLength(64);
    const extra = await reconcileRecordLedger(
      {},
      undefined,
      write("2026-01-01T00:00:00.064Z"),
    );
    const before = structuredClone(merged);
    await expect(
      reconcileMergedRecordLedgers({}, freeze(merged), extra, repair),
    ).rejects.toMatchObject({ code: "safety-limit" });
    expect(merged).toEqual(before);
    expect(() => normalizeRecordLedger(merged, { maxBytes: 128 })).toThrow(
      /limit/,
    );
  });

  it("keeps timestamp overflow fatal and accepts only boolean opt-in", async () => {
    const a = await initial("9999-12-31T23:59:59.998Z");
    const b = await initial("9999-12-31T23:59:59.999Z");
    await expect(
      reconcileMergedRecordLedgers(data(), a, b, repair),
    ).rejects.toMatchObject({ code: "timestamp-overflow" });
    await expect(
      reconcileMergedRecordLedgers(data(), a, b, {
        reconcileOrigins: "true" as never,
      }),
    ).rejects.toMatchObject({ code: "invalid-ledger" });
    expect(parents(roots(a)[0])).toEqual([]);
  });
});
