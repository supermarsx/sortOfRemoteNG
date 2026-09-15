import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptVaultArchive,
  decryptVaultArchive,
  normalizeDatabaseVaultArchive,
  prepareVaultArchiveConnection,
  prepareVaultArchiveImport,
  MAX_VAULT_ARCHIVE_FILE_BYTES,
} from "../../src/utils/security/vaultArchive";
import type { DatabaseVaultArchive } from "../../src/types/security/vaultArchive";
import type { Connection } from "../../src/types/connection/connection";
vi.mock("../../src/utils/security/passwordPolicy", () => ({
  validateNewPassword: vi.fn(async () => {}),
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = "2026-09-11T00:00:00.000Z";
const DEVICE_ID = "PRIVATE_DEVICE_TOKEN_did";
const trustedDevice = (patch: Record<string, unknown> = {}) => ({
  id: tid,
  surface: "synology-api" as const,
  target: "https://nas.example.test:5001",
  account: "admin",
  deviceName: "SortOfRemoteNG · DESKTOP-ONE",
  deviceId: DEVICE_ID,
  createdAt: now,
  portable: false as const,
  ...patch,
});
function archive(): DatabaseVaultArchive {
  return {
    format: "sorng-vault-archive",
    version: 1,
    createdAt: now,
    credentials: [
      {
        id,
        name: "Vault login",
        createdAt: now,
        updatedAt: now,
        facets: {
          password: "PRIVATE_PASSWORD",
          totp: [
            {
              id: tid,
              label: "OTP",
              secret: "JBSWY3DPEHPK3PXP",
              digits: 6,
              period: 30,
              algorithm: "sha1",
            },
          ],
          social: [
            {
              id: tid,
              provider: "Example",
              origin: "https://example.test",
              portable: false,
            },
          ],
          passkey: [
            {
              id: tid,
              provider: "Security key",
              rpId: "example.test",
              portable: false,
            },
          ],
        },
      },
    ],
    connections: [
      {
        id: "source",
        name: "NAS",
        protocol: "https",
        hostname: "example.test",
        port: 443,
        isGroup: false,
        createdAt: now,
        updatedAt: now,
        credentialSource: { kind: "vault", credentialId: id, totpId: tid },
        httpAutoMfa: {
          version: 1,
          enabled: true,
          totpConfigId: tid,
          challengeId: "challenge",
          origin: "https://example.test",
        },
      },
    ],
  };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe("encrypted credential vault archives", () => {
  it.each([
    "tunnelProfileId",
    "credentialRefId",
    "credentialRefIds",
    "defaultTabGroupId",
    "fallbackChainIds",
    "proxyProfileId",
    "vpnProfileId",
  ])("rejects external dependency %s instead of rebinding", (key) => {
    const source = archive();
    Object.assign(source.connections[0], {
      [key]: key === "credentialRefIds" ? { password: "foreign" } : "foreign",
    });
    expect(() => normalizeDatabaseVaultArchive(source)).toThrow(
      "external route",
    );
  });
  it("roundtrips secrets only inside authenticated ciphertext with600k iterations", async () => {
    const source = archive();
    const file = await encryptVaultArchive(source, "separate archive password");
    expect(file).not.toContain("PRIVATE_PASSWORD");
    expect(file).not.toContain("Vault login");
    expect(JSON.parse(JSON.parse(file).payload).kdf.iterations).toBe(600000);
    expect(
      await decryptVaultArchive(file, "separate archive password"),
    ).toEqual(source);
    await expect(decryptVaultArchive(file, "wrong password")).rejects.toThrow(
      "Check the password",
    );
    const outer = JSON.parse(file),
      inner = JSON.parse(outer.payload);
    inner.ciphertext = "A" + inner.ciphertext.slice(1);
    outer.payload = JSON.stringify(inner);
    await expect(
      decryptVaultArchive(JSON.stringify(outer), "separate archive password"),
    ).rejects.toThrow();
  });
  it("refuses plaintext, malformed envelopes, weakKDF andoversizebeforedecrypt", async () => {
    for (const file of [
      JSON.stringify(archive()),
      "x".repeat(MAX_VAULT_ARCHIVE_FILE_BYTES + 1),
      JSON.stringify({
        format: "sorng-vault-encrypted",
        version: 1,
        payload: JSON.stringify({
          version: 2,
          algorithm: "AES-256-GCM",
          kdf: {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: 1,
            salt: "AAAAAAAAAAAAAAAAAAAAAA==",
          },
          iv: "AAAAAAAAAAAAAAAA",
          ciphertext: "AAAA",
        }),
      }),
    ])
      await expect(decryptVaultArchive(file, "password")).rejects.toThrow();
  });
  it("appends both halves atomically in puredata with freshIDs andfacetrefs", () => {
    const source = archive(),
      before = structuredClone(source);
    const existing = { ...source.connections[0] };
    const vault = {
      version: 1 as const,
      revision: 3,
      entries: [source.credentials[0]],
    };
    const next = prepareVaultArchiveImport([existing], vault, source);
    expect(next.credentialVault.revision).toBe(4);
    expect(next.connections).toHaveLength(2);
    expect(next.connections[0]).toEqual(existing);
    const added = next.credentialVault.entries[1],
      connection = next.connections[1];
    expect(added.id).not.toBe(id);
    expect(connection.id).not.toBe(existing.id);
    expect(connection.credentialSource).toEqual({
      kind: "vault",
      credentialId: added.id,
      totpId: added.facets.totp![0].id,
    });
    expect(connection.httpAutoMfa).toMatchObject({
      enabled: false,
      totpConfigId: added.facets.totp![0].id,
    });
    expect(added.facets.passkey![0].portable).toBe(false);
    expect(added.facets.social![0].portable).toBe(false);
    expect(source).toEqual(before);
  });
  it("normalizes real sourceDates and strips ignoredlocalprimarycredentials withoutreadinggetters", () => {
    const source = {
      ...archive().connections[0],
      createdAt: new Date(now),
      updatedAt: new Date(now),
      password: "ignored",
      basicAuthPassword: "ignored2",
      privateKey: "ignored3",
      httpHeaders: { Authorization: "ignored-header" },
      httpFormAutomation: {
        fields: [{ selector: "input", value: "ignored-field" }],
      },
    } as unknown as Connection;
    const exported = prepareVaultArchiveConnection(source);
    expect(exported.createdAt).toBe(now);
    expect(JSON.stringify(exported)).not.toContain("ignored");
    const getter = vi.fn(() => "secret");
    Object.defineProperty(source, "description", {
      get: getter,
      enumerable: true,
    });
    expect(() => prepareVaultArchiveConnection(source)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects orphanvault, selectedOTP, externalroutes andduplicateIDs", () => {
    const orphan = archive();
    orphan.credentials = [];
    expect(() => normalizeDatabaseVaultArchive(orphan)).toThrow();
    const missing = archive();
    missing.connections[0].tunnelChainId = "outside";
    expect(() => normalizeDatabaseVaultArchive(missing)).toThrow(
      "external route",
    );
    const duplicate = archive();
    duplicate.credentials.push(duplicate.credentials[0]);
    expect(() => normalizeDatabaseVaultArchive(duplicate)).toThrow();
    const otp = archive();
    otp.connections[0].credentialSource = {
      kind: "vault",
      credentialId: id,
      totpId: crypto.randomUUID(),
    };
    expect(() =>
      prepareVaultArchiveImport(
        [],
        { version: 1, revision: 0, entries: [] },
        otp,
      ),
    ).toThrow();
  });
  it("remaps selectedinlineconnectionlinks instead ofretargetingexistingIDs", () => {
    const source = archive();
    source.connections.push({
      ...source.connections[0],
      id: "jump",
      protocol: "ssh",
      port: 22,
    });
    source.connections[0].security = {
      sshTunnel: {
        enabled: true,
        connectionId: "jump",
        localPort: 0,
        remoteHost: "example.test",
        remotePort: 443,
      },
    };
    const next = prepareVaultArchiveImport(
      [],
      { version: 1, revision: 0, entries: [] },
      source,
    );
    expect(next.connections[0].security?.sshTunnel?.connectionId).toBe(
      next.connections[1].id,
    );
  });
  it("never exports trusted NAS device tokens, even when handed a vault entry that has them", async () => {
    const source = archive();
    source.credentials[0].facets.deviceTrust = [trustedDevice()];
    const normalized = normalizeDatabaseVaultArchive(source);
    expect(normalized.credentials[0].facets.deviceTrust).toBeUndefined();
    expect(normalized.credentials[0].facets.password).toBe("PRIVATE_PASSWORD");
    expect(JSON.stringify(normalized)).not.toMatch(
      /PRIVATE_DEVICE_TOKEN|DESKTOP-ONE|synology-api/,
    );
    const file = await encryptVaultArchive(source, "separate archive password");
    const opened = await decryptVaultArchive(file, "separate archive password");
    expect(opened.credentials[0].facets).not.toHaveProperty("deviceTrust");
    expect(JSON.stringify(opened)).not.toContain(DEVICE_ID);
    expect(source.credentials[0].facets.deviceTrust).toHaveLength(1);
  });
  it("drops trusted devices from an imported archive, valid or malformed, and keeps local ones", () => {
    const existing = archive().credentials[0];
    existing.facets = { username: "local", deviceTrust: [trustedDevice()] };
    for (const row of [
      trustedDevice({ deviceId: "IMPORTED_DEVICE_TOKEN" }),
      { deviceId: "IMPORTED_DEVICE_TOKEN", portable: true },
    ]) {
      const incoming = archive();
      (incoming.credentials[0].facets as Record<string, unknown>).deviceTrust =
        [row];
      const next = prepareVaultArchiveImport(
        [],
        { version: 1, revision: 2, entries: [existing] },
        incoming,
      );
      const [kept, added] = next.credentialVault.entries;
      expect(kept.facets.deviceTrust).toEqual([trustedDevice()]);
      expect(added.facets).not.toHaveProperty("deviceTrust");
      expect(added.facets.totp).toHaveLength(1);
      expect(JSON.stringify(added)).not.toContain("IMPORTED_DEVICE_TOKEN");
      expect(next.credentialCount).toBe(1);
    }
  });
  it("still rejects an archive entry whose only facet was a trusted device", () => {
    const incoming = archive();
    incoming.connections = [];
    incoming.credentials[0].facets = { deviceTrust: [trustedDevice()] };
    expect(() => normalizeDatabaseVaultArchive(incoming)).toThrow();
  });
  it("rejects activeunknownvalues andkeepsboundedemptyarchivesvalid", () => {
    expect(() =>
      normalizeDatabaseVaultArchive({ ...archive(), extra: true }),
    ).toThrow();
    expect(() =>
      normalizeDatabaseVaultArchive(
        JSON.parse('{"__proto__":{"polluted":true}}'),
      ),
    ).toThrow();
    expect(
      normalizeDatabaseVaultArchive({
        ...archive(),
        credentials: [],
        connections: [],
      }),
    ).toMatchObject({ credentials: [], connections: [] });
  });
});
