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

  it("does not mistake unrelated settings for connection sources", () => {
    expect(() =>
      assertNoVaultImport({
        connections: [{ credentialSource: { kind: "local" } }],
        settings: { gateway: { credentialSource: "same-as-connection" } },
      }),
    ).not.toThrow();
  });
});
