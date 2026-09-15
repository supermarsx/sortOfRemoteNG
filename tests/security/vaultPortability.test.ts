import { describe, expect, it } from "vitest";
import {
  assertNoVaultImport,
  assertPortableCredentialSources,
  VAULT_PORTABILITY_MESSAGE,
} from "../../src/utils/security/vaultPortability";

const connection = {
  name: "Source host",
  password: "ignored-local-secret",
  credentialSource: { kind: "vault", credentialId: "private-entry-id" },
};

describe("vault portability guard", () => {
  it("accepts legacy and explicitly local connections without changing them", () => {
    const connections = [
      { password: "local" },
      { credentialSource: { kind: "local" } },
    ];
    const before = structuredClone(connections);
    expect(() => assertPortableCredentialSources(connections)).not.toThrow();
    expect(connections).toEqual(before);
  });
  it("directs vault archives to the dedicated encrypted import instead of accepting an empty generic import", () => {
    for (const format of ["sorng-vault-encrypted", "sorng-vault-archive"])
      expect(() =>
        assertNoVaultImport({ format, version: 1, payload: "ciphertext" }),
      ).toThrow(VAULT_PORTABILITY_MESSAGE);
    expect(VAULT_PORTABILITY_MESSAGE).toContain("password-encrypted archive");
  });

  it.each([
    connection.credentialSource,
    { kind: "vault" },
    { kind: "local", credentialId: "unreviewed" },
    { kind: "unknown" },
    null,
    "local",
    {},
  ])(
    "refuses nonlocal or malformed sources without activating ignored local fields: %j",
    (source) => {
      const value = { ...connection, credentialSource: source };
      const before = structuredClone(value);
      expect(() => assertPortableCredentialSources([value])).toThrow(
        VAULT_PORTABILITY_MESSAGE,
      );
      expect(value).toEqual(before);
      expect(VAULT_PORTABILITY_MESSAGE).not.toContain("private-entry-id");
      expect(VAULT_PORTABILITY_MESSAGE).not.toContain(connection.password);
    },
  );

  it.each([
    { connections: [connection] },
    [connection],
    { databases: [{ connections: [connection] }] },
    { recycleBin: { entries: [{ connection }] } },
    { databases: [{ recycleBin: { entries: [{ connection }] } }] },
    { credentialVault: null },
    { credentialVault: { version: 1, entries: [] } },
    { databases: [{ credentialVault: {} }] },
  ])(
    "rejects unsupported native JSON vault data before it can be dropped: %j",
    (payload) => {
      expect(() => assertNoVaultImport(payload)).toThrow(
        VAULT_PORTABILITY_MESSAGE,
      );
    },
  );

  it("refuses generic database exports and imports that carry trusted NAS device tokens", () => {
    const deviceId = "PRIVATE_DEVICE_TOKEN_did";
    const credentialVault = {
      version: 1,
      revision: 3,
      entries: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "NAS admin",
          createdAt: "2026-09-15T00:00:00.000Z",
          updatedAt: "2026-09-15T00:00:00.000Z",
          facets: {
            username: "admin",
            deviceTrust: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                surface: "synology-api",
                target: "https://nas.example.test:5001",
                account: "admin",
                deviceName: "SortOfRemoteNG · DESKTOP-ONE",
                deviceId,
                createdAt: "2026-09-15T00:00:00.000Z",
                portable: false,
              },
            ],
          },
        },
      ],
    };
    for (const payload of [
      { connections: [], credentialVault },
      { databases: [{ connections: [], credentialVault }] },
    ]) {
      let message = "";
      try {
        assertNoVaultImport(payload);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain(VAULT_PORTABILITY_MESSAGE);
      expect(message).not.toContain(deviceId);
      expect(message).not.toContain("nas.example.test");
    }
  });

  it("does not mistake unrelated settings for connection sources", () => {
    expect(() =>
      assertNoVaultImport({
        connections: [{ credentialSource: { kind: "local" } }],
        settings: { gateway: { credentialSource: "same-as-connection" } },
      }),
    ).not.toThrow();
  });
});
