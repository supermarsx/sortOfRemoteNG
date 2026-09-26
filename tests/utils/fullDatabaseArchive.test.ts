import { describe, expect, it, vi } from "vitest";
import {
  buildFullDatabaseArchive,
  encryptFullDatabaseArchive,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { decryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import {
  collection,
  fullData,
  trust,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";
vi.mock("../../src/utils/security/passwordPolicy", () => ({
  validateNewPassword: vi.fn(async () => {}),
}));

describe("full database portable archive", () => {
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
