import { describe, expect, it } from "vitest";
import {
  applyDatabaseCredentialChanges,
  databaseCredentialMetadata,
  emptyDatabaseCredentialVault,
  normalizeConnectionCredentialSource,
  normalizeDatabaseCredentialEntry,
  normalizeDatabaseCredentialVault,
  selectDatabaseCredentialFacets,
} from "../../src/utils/security/databaseCredentialVault";
import type { DatabaseCredentialEntry } from "../../src/types/security/databaseCredentialVault";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entry = (): DatabaseCredentialEntry => ({
  id,
  name: "NAS operator",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  facets: {
    username: "PRIVATE_ACCOUNT",
    password: "PRIVATE_PASSWORD",
    domain: "PRIVATE_DOMAIN",
    privateKey: "PRIVATE_KEY\nKEY_BODY",
    passphrase: "PRIVATE_PASSPHRASE",
    totp: [
      {
        id,
        label: "Authenticator",
        secret: "JBSWY3DPEHPK3PXP",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ],
    social: [
      {
        id,
        provider: "Microsoft",
        origin: "https://login.microsoftonline.com",
        portable: false,
        accountHint: "PRIVATE_HINT",
      },
    ],
    passkey: [
      { id, provider: "Security key", rpId: "example.com", portable: false },
    ],
  },
});

describe("database credential vault validation", () => {
  it("defaults only absence to empty, with no global or local credential migration", () => {
    expect(normalizeDatabaseCredentialVault(undefined)).toEqual(
      emptyDatabaseCredentialVault(),
    );
    for (const value of [null, {}, { version: 2, revision: 0, entries: [] }])
      expect(() => normalizeDatabaseCredentialVault(value)).toThrow(
        /Invalid database credential vault/,
      );
  });
  it("round-trips independent and combined facets without secrets in metadata", () => {
    const parsed = normalizeDatabaseCredentialEntry(entry());
    expect(parsed).toEqual(entry());
    expect(parsed).not.toBe(entry());
    const metadata = databaseCredentialMetadata(parsed);
    expect(metadata.availableFacets).toEqual([
      "username",
      "password",
      "domain",
      "privateKey",
      "passphrase",
      "totp",
      "social",
      "passkey",
    ]);
    expect(JSON.stringify(metadata)).not.toMatch(
      /PRIVATE_|JBSW|example.com|microsoftonline/,
    );
    expect(selectDatabaseCredentialFacets(parsed, ["password"])).toEqual({
      password: "PRIVATE_PASSWORD",
    });
    const selected = selectDatabaseCredentialFacets(parsed, ["totp"]);
    selected.totp![0].secret = "MODIFIED";
    expect(parsed.facets.totp![0].secret).toBe("JBSWY3DPEHPK3PXP");
    expect(
      normalizeDatabaseCredentialEntry({ ...entry(), facets: { password: "" } })
        .facets,
    ).toEqual({ password: "" });
  });
  it.each([
    { facets: {} },
    { facets: { token: "PRIVATE_BAD_VALUE" } },
    { facets: { password: null } },
    { facets: { password: "a\0b" } },
    { facets: { privateKey: "x".repeat(65537) } },
    { facets: { username: "x".repeat(513) } },
    { id: "not-a-uuid" },
    { name: "" },
    { updatedAt: "2026-09-09T00:00:00.000Z" },
    { createdAt: "2026-09-10" },
  ])(
    "rejects malformed or unbounded entries with secret-safe diagnostics %#",
    (patch) => {
      expect(() =>
        normalizeDatabaseCredentialEntry({ ...entry(), ...patch }),
      ).toThrow(/Invalid database credential vault/);
      try {
        normalizeDatabaseCredentialEntry({ ...entry(), ...patch });
      } catch (error) {
        expect(String(error)).not.toContain("PRIVATE_BAD_VALUE");
      }
    },
  );
  it("rejects accessors, prototypes, duplicate IDs and unsafe provider bindings", () => {
    let read = false;
    const bad = {
      ...entry(),
      get facets() {
        read = true;
        return {};
      },
    };
    expect(() => normalizeDatabaseCredentialEntry(bad)).toThrow();
    expect(read).toBe(false);
    expect(() =>
      normalizeDatabaseCredentialEntry(Object.create(entry())),
    ).toThrow();
    expect(() =>
      normalizeDatabaseCredentialVault({
        version: 1,
        revision: 0,
        entries: [entry(), entry()],
      }),
    ).toThrow();
    for (const origin of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/",
      "https://example.com/path",
      "https://example.com?token=secret",
    ])
      expect(() =>
        normalizeDatabaseCredentialEntry({
          ...entry(),
          facets: { social: [{ ...entry().facets.social![0], origin }] },
        }),
      ).toThrow();
    for (const patch of [
      { portable: true },
      { accessToken: "secret" },
      { privateKey: "secret" },
    ])
      expect(() =>
        normalizeDatabaseCredentialEntry({
          ...entry(),
          facets: { passkey: [{ ...entry().facets.passkey![0], ...patch }] },
        }),
      ).toThrow();
    for (const rpId of [
      "example.com:443",
      "example.com/path",
      "EXAMPLE.com",
      "user@example.com",
    ])
      expect(() =>
        normalizeDatabaseCredentialEntry({
          ...entry(),
          facets: { passkey: [{ ...entry().facets.passkey![0], rpId }] },
        }),
      ).toThrow();
  });
  it("validates TOTP parameters and never accepts captured one-use codes or backup tokens", () => {
    for (const patch of [
      { secret: "123456" },
      { digits: 7 },
      { period: 0 },
      { algorithm: "md5" },
      { code: "123456" },
      { backupCodes: ["secret"] },
    ])
      expect(() =>
        normalizeDatabaseCredentialEntry({
          ...entry(),
          facets: { totp: [{ ...entry().facets.totp![0], ...patch }] },
        }),
      ).toThrow();
    expect(() =>
      normalizeDatabaseCredentialEntry({
        ...entry(),
        facets: { totp: [entry().facets.totp![0], entry().facets.totp![0]] },
      }),
    ).toThrow();
  });
  it("applies atomic changes and rejects repeated operations, missing deletes and invalid revisions", () => {
    const added = applyDatabaseCredentialChanges(
      emptyDatabaseCredentialVault(),
      [{ operation: "put", entry: entry() }],
    );
    expect(added.revision).toBe(1);
    expect(
      applyDatabaseCredentialChanges(added, [{ operation: "delete", id }])
        .entries,
    ).toEqual([]);
    expect(added.entries).toHaveLength(1);
    expect(() =>
      applyDatabaseCredentialChanges(added, [
        { operation: "delete", id },
        { operation: "delete", id },
      ]),
    ).toThrow();
    expect(() =>
      applyDatabaseCredentialChanges(emptyDatabaseCredentialVault(), [
        { operation: "delete", id },
      ]),
    ).toThrow(/no longer exists/);
    expect(() =>
      applyDatabaseCredentialChanges(
        { ...added, revision: Number.MAX_SAFE_INTEGER },
        [{ operation: "delete", id }],
      ),
    ).toThrow();
  });
  it("bounds total serialized bytes and row counts", () => {
    const many = Array.from({ length: 129 }, (_, i) => ({
      ...entry(),
      id: `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      facets: { privateKey: "x".repeat(65536) },
    }));
    expect(() =>
      normalizeDatabaseCredentialVault({
        version: 1,
        revision: 0,
        entries: many,
      }),
    ).toThrow();
    expect(() =>
      normalizeDatabaseCredentialVault({
        version: 1,
        revision: 0,
        entries: Array(1001).fill(entry()),
      }),
    ).toThrow();
  });
  it("never falls back from an invalid reference or an unavailable requested facet", () => {
    expect(normalizeConnectionCredentialSource(undefined)).toBeUndefined();
    expect(normalizeConnectionCredentialSource({ kind: "local" })).toEqual({
      kind: "local",
    });
    expect(
      normalizeConnectionCredentialSource({ kind: "vault", credentialId: id }),
    ).toEqual({ kind: "vault", credentialId: id });
    for (const value of [
      { kind: "global", credentialId: id },
      { kind: "vault" },
      { kind: "local", credentialId: id },
      { kind: "vault", credentialId: id, databaseId: "other" },
    ])
      expect(() => normalizeConnectionCredentialSource(value)).toThrow();
    expect(() =>
      selectDatabaseCredentialFacets(
        { ...entry(), facets: { username: "only" } },
        ["password"],
      ),
    ).toThrow(/unavailable/);
    expect(() =>
      selectDatabaseCredentialFacets(entry(), ["password", "password"]),
    ).toThrow();
  });
});
