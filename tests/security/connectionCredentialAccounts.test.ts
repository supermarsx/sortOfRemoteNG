import { describe, expect, it } from "vitest";
import {
  connectionCredentialAccounts,
  credentialAccountSelection,
  normalizeConnectionCredentialAccounts,
} from "../../src/utils/security/connectionCredentialAccounts";
import {
  credentialVaultUsage,
  credentialVaultAssignments,
} from "../../src/utils/security/credentialVaultUsage";
import { assertPortableCredentialSources } from "../../src/utils/security/vaultPortability";
import type { Connection } from "../../src/types/connection/connection";

const one = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const two = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otp = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
describe("connection account associations", () => {
  it("keeps distinct accounts and each authenticator when changing the default", () => {
    const original = {
      credentialSource: {
        kind: "vault" as const,
        credentialId: one,
        totpId: otp,
      },
      credentialAccounts: [{ credentialId: two }],
      httpAutoMfa: { version: 1 as const, enabled: true },
    };
    const next = {
      ...original,
      ...credentialAccountSelection(original, {
        kind: "vault",
        credentialId: two,
      }),
    };
    expect(connectionCredentialAccounts(next)).toEqual([
      { credentialId: two },
      { credentialId: one, totpId: otp },
    ]);
    const restored = credentialAccountSelection(next, {
      kind: "vault",
      ...connectionCredentialAccounts(next)[1],
    });
    expect(restored.credentialSource).toEqual({
      kind: "vault",
      credentialId: one,
      totpId: otp,
    });
    expect(restored.httpAutoMfa).toEqual({ version: 1, enabled: false });
    expect(original.credentialAccounts).toEqual([{ credentialId: two }]);
  });
  it("counts alternate accounts as references, including a local default, without duplicates", () => {
    const rows = [
      {
        id: "connection",
        name: "Server",
        protocol: "ssh",
        credentialSource: { kind: "vault", credentialId: one },
        credentialAccounts: [{ credentialId: one }, { credentialId: two }],
      },
      {
        id: "local",
        name: "Local",
        protocol: "rdp",
        credentialAccounts: [{ credentialId: two }],
      },
    ] as Connection[];
    expect(credentialVaultUsage(rows)).toEqual(
      new Map([
        [one, 1],
        [two, 2],
      ]),
    );
    expect(
      credentialVaultAssignments(rows, [])
        .get(two)
        ?.map((row) => row.connectionId),
    ).toEqual(["connection", "local"]);
  });
  it("rejects embedded secrets, duplicate accounts and malformed IDs", () => {
    for (const value of [
      [{ credentialId: one, password: "never-copy" }],
      [{ credentialId: one }, { credentialId: one }],
      [{ credentialId: "not-an-id" }],
      null,
    ])
      expect(() => normalizeConnectionCredentialAccounts(value)).toThrow();
  });
  it("does not permit bare account references through generic cross-database export", () => {
    expect(() =>
      assertPortableCredentialSources([
        {
          credentialSource: { kind: "local" },
          credentialAccounts: [{ credentialId: one }],
        },
      ]),
    ).toThrow();
    expect(() =>
      assertPortableCredentialSources([
        { credentialAccounts: [{ credentialId: one }] },
      ]),
    ).toThrow();
  });
});
