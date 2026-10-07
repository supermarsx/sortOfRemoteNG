import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
} from "../../src/utils/services/cloudSyncSmartMerge";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

const data = () => ({
  connections: Array.from({ length: 114 }, (_, index) => ({
    id: `PRIVATE_${index}`,
    name: `Connection ${index}`,
  })),
});
async function tracked(
  body: ReturnType<typeof data>,
  prior?: RecordLedger,
  now = "2026-10-05T12:00:00.000Z",
) {
  return {
    ...body,
    recordMetadata: await reconcileRecordLedger(body, prior, {
      mode: "write",
      now,
    }),
  };
}
async function fixture() {
  const base = await tracked(data());
  const a = data(),
    b = data();
  a.connections[1].name = "Local edit";
  a.connections[2].name = "Another local edit";
  b.connections[3].name = "Remote edit";
  return {
    base,
    baseline: await buildSmartSyncBaseline(base),
    local: await tracked(a, base.recordMetadata),
    remote: await tracked(b, undefined, "2026-10-05T11:00:00.000Z"),
  };
}
const repair = { reconcileOrigins: true };

describe("reviewed reconciliation of separately initialized sync histories", () => {
  it("repairs the 114-record / three-difference case without discarding either history or mutating sources", async () => {
    const { local, remote, baseline } = await fixture();
    const before = JSON.stringify([local, remote, baseline]);
    expect(await smartMergeSyncSection(local, remote, baseline)).toMatchObject({
      conflicts: [{ code: "history-unrelated" }],
    });
    const result = await smartMergeSyncSection(local, remote, baseline, repair);
    expect(result.conflictCount).toBe(0);
    const merged = result.value as typeof local;
    expect(merged.connections).toHaveLength(114);
    expect(merged.connections[1].name).toBe("Local edit");
    expect(merged.connections[2].name).toBe("Another local edit");
    expect(merged.connections[3].name).toBe("Remote edit");
    expect(merged.recordMetadata.version).toBe(3);
    for (const source of [local, remote])
      expect(merged.recordMetadata.journal).toEqual(
        expect.arrayContaining(source.recordMetadata.journal),
      );
    expect(normalizeRecordLedger(merged.recordMetadata)).toEqual(
      merged.recordMetadata,
    );
    expect(await reconcileRecordLedger(merged, merged.recordMetadata)).toEqual(
      merged.recordMetadata,
    );
    expect(
      await smartMergeSyncSection(remote, local, baseline, repair),
    ).toEqual(result);
    expect(JSON.stringify([local, remote, baseline])).toBe(before);
    // Persist/reload the result and its successful baseline: future syncs need
    // no new repair authorization and must not keep appending metadata.
    const persisted = JSON.parse(JSON.stringify(merged));
    const checkpoint = await buildSmartSyncBaseline(persisted);
    expect(await smartMergeSyncSection(persisted, merged, checkpoint)).toEqual({
      value: merged,
      conflictCount: 0,
    });
  });

  it.each(["edit", "delete"])(
    "never hides a true concurrent %s conflict behind a history repair",
    async (change) => {
      const { base, local, baseline } = await fixture();
      const body = data();
      if (change === "edit")
        body.connections[1].name = "Conflicting remote edit";
      else body.connections.splice(1, 1);
      const remote = await tracked(body, undefined, "2026-10-05T11:00:00.000Z");
      const before = JSON.stringify([base, local, remote]);
      const result = await smartMergeSyncSection(
        local,
        remote,
        baseline,
        repair,
      );
      expect(result).not.toHaveProperty("value");
      expect(result.conflicts).toContainEqual({
        code: change === "edit" ? "concurrent-edit" : "delete-versus-edit",
        kind: "connections",
        count: 1,
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      expect(JSON.stringify([base, local, remote])).toBe(before);
    },
  );

  it("requires a bounded shared baseline even when both current bodies match", async () => {
    const local = await tracked(data());
    const remote = await tracked(data(), undefined, "2026-10-05T11:00:00.000Z");
    for (const baseline of [
      undefined,
      { ...(await buildSmartSyncBaseline(local)), disabled: true as const },
    ]) {
      const result = await smartMergeSyncSection(
        local,
        remote,
        baseline,
        repair,
      );
      expect(result).not.toHaveProperty("value");
      expect(result.conflicts?.[0].code).toBe(
        baseline ? "unavailable-baseline" : "missing-baseline",
      );
    }
    const disabled = {
      ...(await buildSmartSyncBaseline(local)),
      disabled: true as const,
    };
    expect(
      await smartMergeSyncSection(local, local, disabled, repair),
    ).toMatchObject({
      conflicts: [{ code: "unavailable-baseline" }],
    });
  });

  it("refuses to manufacture missing history or bless untracked edits", async () => {
    const { local, remote, baseline } = await fixture();
    const missing = { connections: remote.connections };
    expect(
      await smartMergeSyncSection(local, missing, baseline, repair),
    ).toMatchObject({
      conflicts: [{ code: "history-removed" }],
    });
    remote.connections[0].name = "Untracked";
    expect(
      await smartMergeSyncSection(local, remote, baseline, repair),
    ).toMatchObject({
      conflicts: [{ code: "history-mismatch" }],
    });
  });

  it("merges a returning pre-repair branch normally once its origin is recorded", async () => {
    const { local, remote, baseline } = await fixture();
    const result = await smartMergeSyncSection(local, remote, baseline, repair);
    expect(result.conflictCount).toBe(0);
    const merged = result.value as typeof local;
    const changed = { connections: structuredClone(remote.connections) };
    changed.connections[4].name = "Later offline edit";
    const returning = await tracked(changed, remote.recordMetadata);
    const normal = await smartMergeSyncSection(merged, returning, baseline);
    expect(normal.conflictCount).toBe(0);
    const next = normal.value as typeof local;
    expect(next.connections[1].name).toBe("Local edit");
    expect(next.connections[3].name).toBe("Remote edit");
    expect(next.connections[4].name).toBe("Later offline edit");
    expect(next.recordMetadata.journal).toEqual(
      expect.arrayContaining(merged.recordMetadata.journal),
    );
    expect(next.recordMetadata.journal).toEqual(
      expect.arrayContaining(returning.recordMetadata.journal),
    );
  });
});
