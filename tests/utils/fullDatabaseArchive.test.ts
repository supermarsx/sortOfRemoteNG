import { describe, expect, it, vi } from "vitest";
import {
  buildFullDatabaseArchive,
  encryptFullDatabaseArchive,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { decryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
} from "../../src/utils/storage/recordLedger";
import type { StorageData } from "../../src/utils/storage/storage";
import {
  collection,
  connection,
  fullData,
  trust,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";
vi.mock("../../src/utils/security/passwordPolicy", () => ({
  validateNewPassword: vi.fn(async () => {}),
}));

describe("full database portable archive", () => {
  it("keeps sparse projection history stable across timestamp-only writes without redating existing children", async () => {
    const data: StorageData = {
      connections: [connection("future-child")],
      settings: {},
      timestamp: Date.parse("2025-01-01T00:00:00Z"),
    };
    data.recordMetadata = await reconcileRecordLedger(data);
    const original = structuredClone(data);
    const first = await buildFullDatabaseArchive(collection, data, trust);
    const ledger = first.recordMetadata!;
    expect(ledger.records["$/documents"].createdAt).toBe(
      original.recordMetadata!.records["$"].updatedAt,
    );
    expect(ledger.records["$/connections/@future-child"]).toEqual(
      original.recordMetadata!.records["$/connections/@future-child"],
    );
    expect(ledger.journal).toEqual(
      expect.arrayContaining(original.recordMetadata!.journal),
    );
    expect(normalizeRecordLedger(ledger)).toEqual(ledger);
    expect((await normalizeFullDatabaseArchive(first)).recordMetadata).toEqual(
      ledger,
    );
    expect(data).toEqual(original);
    for (const timestamp of ["2027-01-01", "2024-01-01", "2028-01-01"]) {
      data.timestamp = Date.parse(timestamp);
      data.recordMetadata = await reconcileRecordLedger(
        data,
        data.recordMetadata,
        { mode: "write", now: new Date(data.timestamp).toISOString() },
      );
      expect(data.recordMetadata).toEqual(original.recordMetadata);
      expect(
        (await buildFullDatabaseArchive(collection, data, trust))
          .recordMetadata,
      ).toEqual(ledger);
    }
  });

  it("projects device fields causally from each record even when their dates are newer than the root clock", async () => {
    const data = await fullData();
    data.timestamp = Date.parse("2025-01-01T00:00:00Z");
    const device = data.credentialVault!.entries[0].facets.deviceTrust![0];
    device.createdAt = "2029-01-01T00:00:00.000Z";
    data.recordMetadata = await reconcileRecordLedger(data);
    const original = structuredClone(data);
    const deviceKey = `$/credentialVault/entries/@${VAULT_ID}/facets/deviceTrust/@${device.id}`;
    const before = data.recordMetadata.records[deviceKey];
    expect(Date.parse(before.updatedAt)).toBeGreaterThan(
      Date.parse(data.recordMetadata.records["$"].updatedAt),
    );
    const first = await buildFullDatabaseArchive(collection, data, trust);
    const ledger = first.recordMetadata!;
    expect(first.credentialVault.entries[0].facets.deviceTrust).toBeUndefined();
    expect(ledger.records[deviceKey]).toMatchObject({
      createdAt: before.createdAt,
      updatedAt: "2029-01-01T00:00:00.001Z",
      deletedAt: "2029-01-01T00:00:00.001Z",
      updatedAtSource: "inferred",
    });
    const projectedEvents = ledger.journal.slice(
      original.recordMetadata!.journal.length,
    );
    expect(projectedEvents.some((event) => event.record === deviceKey)).toBe(
      true,
    );
    for (const event of projectedEvents) {
      const prior = original.recordMetadata!.records[event.record];
      if (prior) {
        expect(event.parentRevision).toBe(prior.revision);
        expect(Date.parse(event.timestamp)).toBeGreaterThan(
          Date.parse(prior.updatedAt),
        );
        expect(Date.parse(event.timestamp)).toBeGreaterThanOrEqual(
          Date.parse(prior.createdAt),
        );
      }
    }
    expect(normalizeRecordLedger(ledger)).toEqual(ledger);
    expect((await normalizeFullDatabaseArchive(first)).recordMetadata).toEqual(
      ledger,
    );
    expect(data).toEqual(original);
    for (const timestamp of ["2030-01-01", "2024-01-01", "2031-01-01"]) {
      data.timestamp = Date.parse(timestamp);
      data.recordMetadata = await reconcileRecordLedger(
        data,
        data.recordMetadata,
        { mode: "write", now: new Date(data.timestamp).toISOString() },
      );
      expect(data.recordMetadata).toEqual(original.recordMetadata);
      expect(
        (await buildFullDatabaseArchive(collection, data, trust))
          .recordMetadata,
      ).toEqual(ledger);
    }
  });

  it("upgrades legacy trust dates deterministically without changing the source", async () => {
    const legacyTrust = structuredClone(trust);
    delete legacyTrust.records[0].timestamps;
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      legacyTrust,
    );
    expect(archive.trustRecords).toEqual(trust);
    expect(legacyTrust.records[0]).not.toHaveProperty("timestamps");
    expect((await normalizeFullDatabaseArchive(archive)).trustRecords).toEqual(
      trust,
    );
  });
  it("preserves trust dates and rejects unsupported or inconsistent metadata", async () => {
    const records = structuredClone(trust);
    const dates = {
      version: 1 as const,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      created_at_source: "inferred" as const,
      updated_at_source: "recorded" as const,
    };
    records.records[0].timestamps = dates;
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      records,
    );
    expect(archive.trustRecords.records[0].timestamps).toEqual(dates);
    expect((await normalizeFullDatabaseArchive(archive)).trustRecords).toEqual(
      records,
    );
    for (const patch of [
      { version: 2 },
      { created_at: "not-a-date" },
      { updated_at: "2024-01-01T00:00:00Z" },
      { created_at_source: "invented" },
      { unexpected: true },
    ]) {
      const invalid = structuredClone(archive);
      Object.assign(invalid.trustRecords.records[0].timestamps!, patch);
      await expect(normalizeFullDatabaseArchive(invalid)).rejects.toMatchObject(
        { code: "format" },
      );
    }
  });
  it.each(["", null, false, 0, [], {}])(
    "rejects malformed direct profile declarations %j",
    async (id) => {
      for (const key of ["proxyProfileId", "tunnelProfileId"]) {
        const data = await fullData();
        Object.assign(data.connections[2], { [key]: id });
        await expect(
          buildFullDatabaseArchive(collection, data, trust),
        ).rejects.toMatchObject({ code: "dependencies" });
      }
    },
  );
  it.each([
    "proxyProfileId",
    "tunnelProfileId",
    "sshConnectionId",
    "sshConnectionDatabaseId",
    "ownerDatabaseId",
  ])("rejects external %s in active and recycled routes", async (key) => {
    for (const recycled of [false, true]) {
      const data = await fullData();
      const row = recycled
        ? data.recycleBin!.entries[0].connection
        : data.connections[2];
      Object.assign(row, { [key]: "outside-owner" });
      await expect(
        buildFullDatabaseArchive(collection, data, trust),
      ).rejects.toMatchObject({ code: "dependencies" });
    }
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    Object.assign(archive.connections[2], { [key]: "outside-owner" });
    await expect(normalizeFullDatabaseArchive(archive)).rejects.toMatchObject({
      code: "dependencies",
    });
  });
  it("round trips all private sections, connections and recycle references without copying device/session trust", async () => {
    const data = await fullData();
    const original = structuredClone(data);
    (
      data.connections[1] as unknown as Record<string, unknown>
    ).backendSessionId = "PRIVATE_SESSION_TOKEN";
    const archive = await buildFullDatabaseArchive(collection, data, trust);
    expect(archive.connections).toHaveLength(3);
    expect(archive.connections[1].credentialSource).toEqual(
      original.connections[1].credentialSource,
    );
    expect(archive.recycleBin.entries[0].connection.credentialSource).toEqual(
      original.connections[1].credentialSource,
    );
    expect(archive.documents).toEqual(original.documents);
    expect(archive.automationLibrary).toEqual(original.automationLibrary);
    expect(archive.trustRecords).toEqual(trust);
    expect(archive.credentialVault.entries[0].facets.password).toBe(
      "PRIVATE_VAULT_PASSWORD",
    );
    expect(archive.connections[2].password).toBe("PRIVATE_LOCAL_PASSWORD");
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toMatch(
      /PRIVATE_DEVICE_TOKEN|PRIVATE_SESSION_TOKEN|httpTrustedRedirectDestinations/,
    );
    expect(data.credentialVault).toEqual(original.credentialVault);
    const encrypted = await encryptFullDatabaseArchive(
      archive,
      "Synthetic-archive-password!",
      { iterations: 10000 },
    );
    expect(encrypted).not.toMatch(/PRIVATE_|Shared login|full-database/);
    expect(
      await normalizeFullDatabaseArchive(
        JSON.parse(
          await decryptWithPassword(encrypted, "Synthetic-archive-password!"),
        ),
      ),
    ).toEqual(archive);
    await expect(
      decryptWithPassword(encrypted, "wrong-password"),
    ).rejects.toThrow();
  });

  it.each([
    "vault",
    "recycle-vault",
    "totp",
    "script",
    "recycle-script",
    "external-script",
    "route",
    "folder",
    "cycle",
    "document",
  ])("refuses missing %s closure before encrypting", async (kind) => {
    const data = await fullData();
    if (kind === "vault") data.credentialVault!.entries = [];
    if (kind === "recycle-vault")
      data.recycleBin!.entries[0].connection.credentialSource = {
        kind: "vault",
        credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      };
    if (kind === "totp") delete data.credentialVault!.entries[0].facets.totp;
    if (kind === "script")
      data.automationLibrary!.terminalScripts.customScripts = [];
    if (kind === "recycle-script")
      data.recycleBin!.entries[0].connection.sshQuickActions!.items[0].id =
        "absent";
    if (kind === "external-script")
      data.connections[1].scripts = { onConnect: ["outside-app-script"] };
    if (kind === "route") data.connections[2].proxyChainId = "outside-proxy";
    if (kind === "folder") data.connections[1].parentId = "missing-folder";
    if (kind === "cycle") data.connections[0].parentId = "folder";
    if (kind === "document")
      data.documents!.documents[0].parentFolderId = "absent";
    await expect(
      buildFullDatabaseArchive(collection, data, trust),
    ).rejects.toMatchObject({ code: "dependencies" });
  });

  it("rejects malformed/omitted sections and verifies attachment bytes on both directions", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    for (const key of [
      "documents",
      "credentialVault",
      "automationLibrary",
      "trustRecords",
    ] as const) {
      const partial = { ...archive } as Record<string, unknown>;
      delete partial[key];
      await expect(normalizeFullDatabaseArchive(partial)).rejects.toMatchObject(
        { code: "format" },
      );
    }
    archive.documents.attachments[0].sha256 = "0".repeat(64);
    await expect(normalizeFullDatabaseArchive(archive)).rejects.toMatchObject({
      code: "format",
    });
    await expect(
      encryptFullDatabaseArchive(archive, "Synthetic-archive-password!"),
    ).rejects.toMatchObject({ code: "format" });
  });

  it("rejects parser gadgets without evaluating accessors or including secrets in errors", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    const getter = vi.fn(() => "PRIVATE_VALUE");
    Object.defineProperty(archive, "unsafe", { get: getter });
    await expect(normalizeFullDatabaseArchive(archive)).rejects.toMatchObject({
      code: "format",
    });
    expect(getter).not.toHaveBeenCalled();
    await expect(
      normalizeFullDatabaseArchive(
        JSON.parse('{"__proto__":{"password":"PRIVATE_VALUE"}}'),
      ),
    ).rejects.toThrow("Invalid");
  });

  it("requires a real archive password and never turns a vault reference into local credentials", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    await expect(encryptFullDatabaseArchive(archive, "")).rejects.toMatchObject(
      { code: "password" },
    );
    archive.connections[1].credentialSource = {
      kind: "vault",
      credentialId: VAULT_ID,
    };
    archive.connections[1].password = "IGNORED_LOCAL_PASSWORD";
    const normalized = await normalizeFullDatabaseArchive(archive);
    expect(normalized.connections[1].credentialSource).toEqual({
      kind: "vault",
      credentialId: VAULT_ID,
    });
    expect(normalized.connections[1].password).toBe("IGNORED_LOCAL_PASSWORD");
  });

  it.each([false, true])(
    "rejects file-backed private keys including recycle entries (recycled=%s)",
    async (recycled) => {
      const data = await fullData();
      const row = recycled
        ? data.recycleBin!.entries[0].connection
        : data.connections[2];
      row.credentialSource = { kind: "local" };
      row.privateKey = "C:/fixture/id_rsa";
      await expect(
        buildFullDatabaseArchive(collection, data, trust),
      ).rejects.toMatchObject({ code: "file-credential" });
      const archive = await buildFullDatabaseArchive(
        collection,
        await fullData(),
        trust,
      );
      archive.connections[2].privateKey = "/fixture/id_rsa";
      await expect(normalizeFullDatabaseArchive(archive)).rejects.toMatchObject(
        { code: "file-credential" },
      );
    },
  );

  it("retains vault key material and exact credential literals while removing only the gateway bearer", async () => {
    const data = await fullData();
    data.credentialVault!.entries[0].facets.privateKey =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nPRIVATE_KEY_MATERIAL\n-----END OPENSSH PRIVATE KEY-----";
    data.credentialVault!.entries[0].facets.password = "***ENCRYPTED***";
    data.connections[2].password = "***ENCRYPTED***";
    data.connections[2].basicAuthPassword = "***ENCRYPTED***";
    data.connections[2].rdpSettings = {
      gateway: {
        enabled: true,
        authMethod: "negotiate",
        credentialSource: "separate",
        username: "fixture",
        password: "***ENCRYPTED***",
        domain: "fixture",
        accessToken: "PRIVATE_GATEWAY_SESSION_TOKEN",
      },
    };
    data.recycleBin!.entries[0].connection.password = "***ENCRYPTED***";
    const archive = await buildFullDatabaseArchive(collection, data, trust);
    const encrypted = await encryptFullDatabaseArchive(
      archive,
      "Synthetic-archive-password!",
      { iterations: 10000 },
    );
    const restored = await normalizeFullDatabaseArchive(
      JSON.parse(
        await decryptWithPassword(encrypted, "Synthetic-archive-password!"),
      ),
    );
    expect(restored.connections[2].password).toBe("***ENCRYPTED***");
    expect(restored.connections[2].basicAuthPassword).toBe("***ENCRYPTED***");
    expect(restored.recycleBin.entries[0].connection.password).toBe(
      "***ENCRYPTED***",
    );
    expect(restored.credentialVault.entries[0].facets).toMatchObject({
      password: "***ENCRYPTED***",
      privateKey: data.credentialVault!.entries[0].facets.privateKey,
    });
    expect(restored.connections[2].rdpSettings!.gateway).toEqual({
      enabled: true,
      authMethod: "negotiate",
      credentialSource: "separate",
      username: "fixture",
      password: "***ENCRYPTED***",
      domain: "fixture",
    });
    expect(data.connections[2].rdpSettings!.gateway!.accessToken).toBe(
      "PRIVATE_GATEWAY_SESSION_TOKEN",
    );
    restored.connections[2].rdpSettings!.gateway!.accessToken =
      "FORGED_SESSION_TOKEN";
    expect(
      JSON.stringify(await normalizeFullDatabaseArchive(restored)),
    ).not.toContain("FORGED_SESSION_TOKEN");
  });
});
