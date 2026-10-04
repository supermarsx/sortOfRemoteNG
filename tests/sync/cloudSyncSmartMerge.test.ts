import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
  type SmartSyncBaseline,
} from "../../src/utils/services/cloudSyncSmartMerge";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import {
  buildFullDatabaseArchive,
  fullDatabaseArchiveData,
} from "../../src/utils/connection/fullDatabaseArchive";
import { upgradeCloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";
import {
  collection,
  connection,
  fullData,
  trust,
} from "../fixtures/fullDatabaseArchive";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const clone = <T>(value: T): T => structuredClone(value);
const row = (id: string, name = id) => ({ id, name });
async function merge(base: unknown, local: unknown, remote: unknown) {
  return smartMergeSyncSection(
    local,
    remote,
    await buildSmartSyncBaseline(base),
  );
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function history<T extends object>(
  body: T,
  previous?: RecordLedger,
  now = "2026-01-02T00:00:00.000Z",
) {
  return {
    ...body,
    recordMetadata: await reconcileRecordLedger(body, previous, {
      mode: "write",
      now,
    }),
  };
}

describe("conservative smart sync", () => {
  it("requires a shared baseline except for equal copies, including differently ordered object keys", async () => {
    expect(
      await smartMergeSyncSection({ theme: "dark" }, { theme: "light" }),
    ).toMatchObject({
      conflictCount: 1,
      reason: expect.stringContaining("baseline"),
    });
    expect(
      await smartMergeSyncSection(
        { theme: "dark", language: "en" },
        { language: "en", theme: "dark" },
      ),
    ).toEqual({ conflictCount: 0, value: { theme: "dark", language: "en" } });
  });

  it("combines independent settings properties without using timestamps as winners", async () => {
    const base = { theme: "dark", language: "en", fontSize: 12 };
    expect(
      await merge(
        base,
        { ...base, theme: "light" },
        { ...base, language: "pt" },
      ),
    ).toEqual({
      conflictCount: 0,
      value: { ...base, theme: "light", language: "pt" },
    });
    const conflict = await merge(
      { theme: "dark" },
      { theme: "light", modifiedAt: 9999999 },
      { theme: "system", modifiedAt: 1 },
    );
    expect(conflict.conflictCount).toBeGreaterThan(0);
    expect(conflict).not.toHaveProperty("value");
  });

  it("distinguishes property addition, intentional deletion, null and delete-versus-edit", async () => {
    expect(await merge({ a: 1, b: 2 }, { b: 2 }, { a: 1, b: 3 })).toEqual({
      conflictCount: 0,
      value: { b: 3 },
    });
    expect(await merge({}, { a: null }, { b: false })).toEqual({
      conflictCount: 0,
      value: { a: null, b: false },
    });
    expect(await merge({ a: 1 }, {}, { a: null })).toMatchObject({
      conflictCount: 1,
    });
    expect(await merge({}, { a: 1 }, { a: 2 })).toMatchObject({
      conflictCount: 1,
    });
  });

  it("merges independent records, additions and deletions without mutating sources or checkpoint", async () => {
    const base = { connections: [row("a"), row("b")] };
    const local = freeze({ connections: [row("a", "edited"), row("b")] });
    const remote = freeze({
      connections: [row("a"), row("b", "remote"), row("c")],
    });
    const baseline = freeze(await buildSmartSyncBaseline(base));
    const before = JSON.stringify([local, remote, baseline]);
    expect(await smartMergeSyncSection(local, remote, baseline)).toEqual({
      conflictCount: 0,
      value: {
        connections: [row("a", "edited"), row("b", "remote"), row("c")],
      },
    });
    expect(JSON.stringify([local, remote, baseline])).toBe(before);
    expect(
      await merge(
        base,
        { connections: [row("b")] },
        { connections: [row("a"), row("b", "edited")] },
      ),
    ).toEqual({
      conflictCount: 0,
      value: { connections: [row("b", "edited")] },
    });
    expect(
      await merge(
        base,
        { connections: [row("b")] },
        { connections: [row("a", "edited"), row("b")] },
      ),
    ).toMatchObject({ conflictCount: 1 });
  });

  it.each(["connections", "scripts", "macros"])(
    "keeps each %s record atomic even when different fields changed",
    async (field) => {
      const base = {
        [field]: [
          {
            id: "private-id",
            name: "original",
            password: "PRIVATE_PASSWORD",
            security: { mode: "strict" },
          },
        ],
      };
      const local = clone(base),
        remote = clone(base);
      local[field][0].name = "local";
      remote[field][0].password = "PRIVATE_REMOTE_PASSWORD";
      const result = await merge(base, local, remote);
      expect(result.conflictCount).toBe(1);
      expect(result).not.toHaveProperty("value");
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|private-id/);
    },
  );

  it("never synthesizes credential facets or an unknown nested security object", async () => {
    const base = {
      credentialVault: {
        entries: [{ id: "c", facets: { username: "u", password: "p" } }],
      },
    };
    const local = clone(base),
      remote = clone(base);
    local.credentialVault.entries[0].facets.username = "other";
    remote.credentialVault.entries[0].facets.password = "other";
    expect(await merge(base, local, remote)).toMatchObject({
      conflictCount: 1,
    });
    expect(
      await merge(
        { auth: { username: "a", password: "p" } },
        { auth: { username: "b", password: "p" } },
        { auth: { username: "a", password: "q" } },
      ),
    ).toMatchObject({ conflictCount: 1 });
  });

  it("preserves a unilateral reorder with an independent record edit", async () => {
    const base = { connections: [row("a"), row("b"), row("c")] };
    expect(
      await merge(
        base,
        { connections: [row("c"), row("b"), row("a")] },
        { connections: [row("a", "edited"), row("b"), row("c")] },
      ),
    ).toEqual({
      conflictCount: 0,
      value: { connections: [row("c"), row("b"), row("a", "edited")] },
    });
  });

  it("accepts unambiguous insertions into different gaps but reviews same-gap insertions", async () => {
    const base = { connections: [row("a"), row("b")] };
    expect(
      await merge(
        base,
        { connections: [row("x"), row("a"), row("b")] },
        { connections: [row("a"), row("b"), row("y")] },
      ),
    ).toEqual({
      conflictCount: 0,
      value: { connections: [row("x"), row("a"), row("b"), row("y")] },
    });
    expect(
      await merge(
        base,
        { connections: [row("a"), row("b"), row("x")] },
        { connections: [row("a"), row("b"), row("y")] },
      ),
    ).toMatchObject({ conflictCount: 1 });
  });

  it("reviews contradictory reordering and anonymous-array edits", async () => {
    const base = { connections: [row("a"), row("b"), row("c")] };
    expect(
      await merge(
        base,
        { connections: [row("b"), row("a"), row("c")] },
        { connections: [row("a"), row("c"), row("b")] },
      ),
    ).toMatchObject({ conflictCount: 1 });
    expect(
      await merge(
        { tags: ["a", "b"] },
        { tags: ["b", "a"] },
        { tags: ["a", "b", "c"] },
      ),
    ).toMatchObject({ conflictCount: 1 });
  });

  it("reports each independent property conflict without returning a partial payload", async () => {
    const result = await merge(
      { theme: "dark", language: "en", fontSize: 12 },
      { theme: "light", language: "pt", fontSize: 14 },
      { theme: "system", language: "fr", fontSize: 12 },
    );
    expect(result.conflictCount).toBe(2);
    expect(result).not.toHaveProperty("value");
  });

  it("never deduplicates ambiguous record IDs or merges inside unsupported arrays", async () => {
    expect(
      await merge(
        { scripts: [row("a")] },
        { scripts: [row("a", "edited"), row("a", "duplicate")] },
        { scripts: [row("a", "remote")] },
      ),
    ).toMatchObject({ conflictCount: 1 });
    expect(
      await merge(
        { unknownRecords: [row("a"), row("b")] },
        { unknownRecords: [row("a", "local"), row("b")] },
        { unknownRecords: [row("a"), row("b", "remote")] },
      ),
    ).toMatchObject({ conflictCount: 1 });
  });

  it("stores only salted hashes and structural tags, never private keys/IDs or values", async () => {
    const section = {
      theme: "dark",
      SECRET_PROPERTY: "SECRET_CONTENT",
      connections: [{ id: "SECRET_ID", password: "SECRET_PASSWORD" }],
    };
    const a = await buildSmartSyncBaseline(section),
      b = await buildSmartSyncBaseline(section);
    const persisted = JSON.stringify(a);
    expect(persisted).not.toMatch(/theme|dark|SECRET_|connections|password/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.root.hash).not.toBe(b.root.hash);
    expect(
      await smartMergeSyncSection(
        section,
        { ...section, theme: "light" },
        JSON.parse(persisted),
      ),
    ).toEqual({ conflictCount: 0, value: { ...section, theme: "light" } });
  });

  it("collapses oversized indexes safely and does not fail normal sync on unsupported inputs", async () => {
    const section = Object.fromEntries(
      Array.from({ length: 4100 }, (_, index) => [`private-${index}`, index]),
    );
    const baseline = await buildSmartSyncBaseline(section);
    expect(baseline.root.kind).toBe("atomic");
    expect(JSON.stringify(baseline).length).toBeLessThan(400);
    expect(
      await smartMergeSyncSection(
        { ...section, x: 1 },
        { ...section, y: 2 },
        baseline,
      ),
    ).toMatchObject({ conflictCount: 1 });
    let deep: unknown = {};
    for (let index = 0; index < 60; index++) deep = { next: deep };
    expect(await buildSmartSyncBaseline(deep)).toMatchObject({
      disabled: true,
    });
    const disabled = await buildSmartSyncBaseline(new Date());
    expect(disabled.disabled).toBe(true);
    expect(
      await smartMergeSyncSection({ a: 1 }, { a: 2 }, disabled),
    ).toMatchObject({ conflictCount: 1 });
  });

  it("rejects unsafe data and malformed checkpoints without evaluating getters or leaking values", async () => {
    const get = vi.fn(() => "PRIVATE_SECRET");
    const malicious = Object.defineProperty({}, "secret", {
      enumerable: true,
      get,
    });
    expect(await buildSmartSyncBaseline(malicious)).toMatchObject({
      disabled: true,
    });
    expect(await smartMergeSyncSection(malicious, {})).toMatchObject({
      conflictCount: 1,
    });
    expect(get).not.toHaveBeenCalled();
    for (const value of [
      JSON.parse('{"__proto__":{"private":"SECRET"}}'),
      [undefined],
      { bad: Infinity },
      new Map(),
    ])
      expect(await smartMergeSyncSection(value, {})).toMatchObject({
        conflictCount: 1,
      });
    const baseline = await buildSmartSyncBaseline({ a: 1 });
    (baseline.root as unknown as { children: unknown }).children = {
      PRIVATE_KEY: { hash: "x", kind: "atomic" },
    };
    const result = await smartMergeSyncSection({ a: 2 }, { a: 3 }, baseline);
    expect(result.conflictCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
  });
});

describe("smart sync history preservation", () => {
  it("preserves a compatible descendant journal and every prior revision", async () => {
    const base = await history({ scripts: [row("a"), row("b")] });
    const local = await history(
      { scripts: [row("a", "edited"), row("b")] },
      base.recordMetadata,
    );
    const result = await merge(base, local, base);
    expect(result.conflictCount).toBe(0);
    const value = result.value as typeof local;
    expect(value.recordMetadata).toEqual(local.recordMetadata);
    expect(value.recordMetadata.journal).toEqual(
      expect.arrayContaining(base.recordMetadata.journal),
    );
    expect(
      await reconcileRecordLedger(value, value.recordMetadata, {
        mode: "migrate",
      }),
    ).toEqual(value.recordMetadata);
  });

  it("merges independently edited records while retaining both root/container history branches", async () => {
    const base = await history({ scripts: [row("a"), row("b")] });
    const local = await history(
      { scripts: [row("a", "local"), row("b")] },
      base.recordMetadata,
    );
    const remote = await history(
      { scripts: [row("a"), row("b", "remote")] },
      base.recordMetadata,
    );
    const before = clone([local, remote]);
    const result = await merge(base, local, remote);
    expect(result.conflictCount).toBe(0);
    const value = result.value as typeof local;
    expect(value.scripts).toEqual([row("a", "local"), row("b", "remote")]);
    expect(value.recordMetadata.journal).toEqual(
      expect.arrayContaining(local.recordMetadata.journal),
    );
    expect(value.recordMetadata.journal).toEqual(
      expect.arrayContaining(remote.recordMetadata.journal),
    );
    expect(
      await reconcileRecordLedger(value, value.recordMetadata, {
        mode: "migrate",
      }),
    ).toEqual(value.recordMetadata);
    expect([local, remote]).toEqual(before);
  });

  it("never discards existing history when metadata is removed or malformed", async () => {
    const base = await history({ scripts: [row("a")] });
    const removed = { scripts: [row("a")] };
    expect(await merge(base, removed, base)).toMatchObject({
      conflictCount: 1,
      reason: expect.stringContaining("history was removed"),
    });
    const corrupt = clone(base);
    corrupt.recordMetadata.journal = [];
    expect(await smartMergeSyncSection(corrupt, corrupt)).toMatchObject({
      conflictCount: 1,
    });
    const untracked = clone(base);
    untracked.scripts[0].name = "untracked";
    expect(await merge(base, untracked, base)).toMatchObject({
      conflictCount: 1,
      reason: expect.stringContaining("does not match"),
    });
  });

  it("retains tombstones and revisions across a delete followed by restoration", async () => {
    const base = await history({ scripts: [row("a"), row("b")] });
    const deleted = await history({ scripts: [row("b")] }, base.recordMetadata);
    const restored = await history(
      { scripts: [row("a"), row("b")] },
      deleted.recordMetadata,
    );
    const result = await merge(base, restored, base);
    expect(result.conflictCount).toBe(0);
    const ledger = (result.value as typeof restored).recordMetadata;
    expect(ledger.journal).toEqual(
      expect.arrayContaining(deleted.recordMetadata.journal),
    );
    expect(ledger.records["$/scripts/@a"].revision).toBe(
      restored.recordMetadata.records["$/scripts/@a"].revision,
    );
    expect(normalizeRecordLedger(ledger)).toEqual(ledger);
  });

  it("reconciles a full archive against its storage body so the real upgrade validator accepts it", async () => {
    const payload = await upgradeCloudSyncPayload({
      version: 1,
      sections: {
        "database:source-db": await buildFullDatabaseArchive(
          collection,
          await fullData(),
          trust,
        ),
      },
    });
    const base = payload.sections["database:source-db"] as Awaited<
      ReturnType<typeof buildFullDatabaseArchive>
    >;
    const local = clone(base);
    local.connections[2].name = "local edit";
    local.recordMetadata = await reconcileRecordLedger(
      fullDatabaseArchiveData(local),
      local.recordMetadata,
      { mode: "write", now: "2026-10-02T00:00:00.000Z" },
    );
    const result = await merge(base, local, base);
    expect(result.conflictCount).toBe(0);
    const upgraded = await upgradeCloudSyncPayload({
      version: 1,
      sections: { "database:source-db": result.value },
    });
    expect(upgraded.sections["database:source-db"]).toEqual(result.value);
    expect(
      (result.value as typeof local).recordMetadata?.records,
    ).not.toHaveProperty("$/collection");
    expect((result.value as typeof local).recordMetadata).toEqual(
      local.recordMetadata,
    );
  });

  it("merges real database records on both sides and retains all history through archive validation", async () => {
    const payload = await upgradeCloudSyncPayload({
      version: 1,
      sections: {
        "database:source-db": await buildFullDatabaseArchive(
          collection,
          await fullData(),
          trust,
        ),
      },
    });
    const base = payload.sections["database:source-db"] as Awaited<
      ReturnType<typeof buildFullDatabaseArchive>
    >;
    const local = clone(base),
      remote = clone(base);
    local.connections[2].name = "local edit";
    remote.connections[1].name = "remote edit";
    for (const section of [local, remote])
      section.recordMetadata = await reconcileRecordLedger(
        fullDatabaseArchiveData(section),
        section.recordMetadata,
        { mode: "write", now: "2026-10-02T00:00:00.000Z" },
      );
    const original = clone([local, remote]);
    const result = await merge(base, local, remote);
    expect(result.conflictCount).toBe(0);
    const value = result.value as typeof local;
    expect(value.connections[2].name).toBe("local edit");
    expect(value.connections[1].name).toBe("remote edit");
    for (const section of [local, remote])
      expect(value.recordMetadata!.journal).toEqual(
        expect.arrayContaining(section.recordMetadata!.journal),
      );
    expect(
      await upgradeCloudSyncPayload({
        version: 1,
        sections: { "database:source-db": value },
      }),
    ).toEqual({ version: 1, sections: { "database:source-db": value } });
    expect([local, remote]).toEqual(original);
  });

  it("leaves dependency validation to the caller when independently valid edits combine into a dangling reference", async () => {
    const data = await fullData();
    data.connections.push(connection("new-source"));
    const payload = await upgradeCloudSyncPayload({
      version: 1,
      sections: {
        "database:source-db": await buildFullDatabaseArchive(
          collection,
          data,
          trust,
        ),
      },
    });
    const base = payload.sections["database:source-db"] as Awaited<
      ReturnType<typeof buildFullDatabaseArchive>
    >;
    const local = clone(base),
      remote = clone(base);
    local.connections = local.connections.filter(
      (row) => row.id !== "new-source",
    );
    remote.connections[2].security = {
      tunnelChain: [
        {
          id: "ssh-route",
          type: "ssh-tunnel",
          enabled: true,
          sshTunnel: {
            connectionId: "new-source",
            ownerDatabaseId: collection.id,
            forwardType: "local",
          },
        },
      ],
    };
    for (const section of [local, remote]) {
      section.recordMetadata = await reconcileRecordLedger(
        fullDatabaseArchiveData(section),
        section.recordMetadata,
        { mode: "write", now: "2026-10-02T00:00:00.000Z" },
      );
      await expect(
        upgradeCloudSyncPayload({
          version: 1,
          sections: { "database:source-db": section },
        }),
      ).resolves.toBeDefined();
    }
    const result = await merge(base, local, remote);
    expect(result.conflictCount).toBe(0);
    await expect(
      upgradeCloudSyncPayload({
        version: 1,
        sections: { "database:source-db": result.value },
      }),
    ).rejects.toMatchObject({ code: "dependencies" });
  });
});
