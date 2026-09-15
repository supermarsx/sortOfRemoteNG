import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialVault,
  DatabaseCredentialVaultApi,
  VaultDeviceTrustFacet,
} from "../../src/types/security/databaseCredentialVault";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import {
  applyDatabaseCredentialChanges,
  databaseCredentialMetadata,
  normalizeDatabaseCredentialEntry,
  normalizeDatabaseCredentialVault,
  selectDatabaseCredentialFacets,
} from "../../src/utils/security/databaseCredentialVault";
import {
  DEVICE_TRUST_LIMIT_MESSAGE,
  DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
  DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
  DEVICE_TRUST_VAULT_REQUIRED_MESSAGE,
  forgetDeviceTrust,
  resolveDeviceTrust,
  resolveRuntimeVaultCredential,
  storeDeviceTrust,
  synologyDeviceTrustTarget,
} from "../../src/utils/security/runtimeCredentialVault";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const rowId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = "2026-09-15T00:00:00.000Z";
const DEVICE_ID = "PRIVATE_DEVICE_TOKEN_did_0123456789";
const OTHER_DEVICE_ID = "PRIVATE_OTHER_ENTRY_DEVICE_TOKEN";
const TARGET = "https://nas.example.test:5001";
const DEVICE_NAME = "SortOfRemoteNG · DESKTOP-ONE";

const trustRow = (
  patch: Partial<VaultDeviceTrustFacet> = {},
): VaultDeviceTrustFacet => ({
  id: rowId,
  surface: "synology-api",
  target: TARGET,
  account: "admin",
  deviceName: DEVICE_NAME,
  deviceId: DEVICE_ID,
  createdAt: now,
  portable: false,
  ...patch,
});
const uuid = (index: number) =>
  `${index.toString(16).padStart(8, "0")}-dddd-4ddd-8ddd-dddddddddddd`;
const entry = (
  facets: DatabaseCredentialEntry["facets"] = {
    username: "admin",
    password: "PRIVATE_PASSWORD",
    totp: [
      {
        id: rowId,
        label: "DSM",
        secret: "JBSWY3DPEHPK3PXP",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ],
    deviceTrust: [trustRow()],
  },
  entryId = id,
): DatabaseCredentialEntry => ({
  id: entryId,
  name: "NAS admin",
  createdAt: now,
  updatedAt: now,
  facets,
});

function fakeVault(entries: DatabaseCredentialEntry[]) {
  let data: DatabaseCredentialVault = normalizeDatabaseCredentialVault({
    version: 1,
    revision: 0,
    entries,
  });
  const scope = { databaseId: "database-a", generation: 1 };
  const api: DatabaseCredentialVaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { ...scope },
      revision: data.revision,
      receipt: `review-${data.revision}`,
      entries: data.entries.map(databaseCredentialMetadata),
    })),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (snapshot, entryId, facets) => {
        if (snapshot.revision !== data.revision)
          throw new Error("The credential vault review expired.");
        const found = data.entries.find((row) => row.id === entryId);
        if (!found) throw new Error("unavailable");
        return selectDatabaseCredentialFacets(found, facets);
      },
    ),
    compareAndSwap: vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (snapshot, changes) => {
        if (snapshot.revision !== data.revision)
          throw new Error("The credential vault changed since this review.");
        data = applyDatabaseCredentialChanges(data, changes);
        api.changeRevision += 1;
      },
    ),
  };
  return {
    api,
    read: () => data,
    /** Another window saves the vault between review and write. */
    concurrentEdit: () => {
      data = applyDatabaseCredentialChanges(data, [
        {
          operation: "put",
          entry: { ...data.entries[0], name: "Renamed elsewhere" },
        },
      ]);
    },
  };
}

function attempt(
  entries: DatabaseCredentialEntry[] = [entry()],
  overrides: Partial<Connection> = {},
) {
  const connection: Connection = {
    id: "nas",
    name: "NAS",
    hostname: "nas.example.test",
    port: 5001,
    protocol: "https",
    isGroup: false,
    createdAt: now,
    updatedAt: now,
    credentialSource: { kind: "vault", credentialId: id },
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    synologySettings: { version: 1, useHttps: true, accessMode: "native" },
    ...overrides,
  };
  const session: ConnectionSession = {
    id: "session",
    connectionId: connection.id,
    ownerDatabaseId: "database-a",
    hostname: connection.hostname,
    protocol: connection.protocol,
    name: "NAS",
    status: "connecting",
    startTime: new Date(),
  };
  const vault = fakeVault(entries);
  const target = {
    databaseId: "database-a",
    assertAccessible: vi.fn(),
    readCurrent: vi.fn(async () => ({ connections: [connection] })),
  } as unknown as DatabaseDataTarget;
  return {
    vault,
    input: {
      api: vault.api,
      connection,
      session,
      target,
      assertCurrent: vi.fn(),
      account: "admin",
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("vault deviceTrust facet normalizer", () => {
  it("round-trips bounded rows as metadata-safe, clone-on-select facets", () => {
    const boundary = trustRow({
      id: uuid(1),
      target: "http://192.168.1.20:5000",
      account: "a".repeat(256),
      deviceName: "n".repeat(64),
      deviceId: "d".repeat(1024),
    });
    const value = entry({
      username: "admin",
      password: "",
      deviceTrust: [
        trustRow(),
        boundary,
        ...Array.from({ length: 14 }, (_, index) =>
          trustRow({ id: uuid(index + 2), account: `user${index}` }),
        ),
      ],
    });
    const parsed = normalizeDatabaseCredentialEntry(value);
    expect(parsed).toEqual(value);
    const metadata = databaseCredentialMetadata(parsed);
    expect(metadata.availableFacets).toEqual([
      "username",
      "password",
      "deviceTrust",
    ]);
    expect(JSON.stringify(metadata)).not.toMatch(
      /PRIVATE_|nas\.example|DESKTOP|192\.168|synology-api/,
    );
    const selected = selectDatabaseCredentialFacets(parsed, ["deviceTrust"]);
    selected.deviceTrust![0].deviceId = "MODIFIED";
    expect(parsed.facets.deviceTrust![0].deviceId).toBe(DEVICE_ID);
  });

  it.each<[string, Record<string, unknown>]>([
    ["portable true", { portable: true }],
    ["portable missing", { portable: undefined }],
    ["web surface", { surface: "synology-web" }],
    ["unknown surface", { surface: "ssh" }],
    ["trailing slash", { target: `${TARGET}/` }],
    ["non-canonical host case", { target: "https://NAS.example.test:5001" }],
    ["explicit default port", { target: "https://nas.example.test:443" }],
    ["non-web scheme", { target: "ftp://nas.example.test" }],
    ["userinfo", { target: "https://admin@nas.example.test" }],
    ["path", { target: "https://nas.example.test/webapi" }],
    ["query", { target: "https://nas.example.test?did=x" }],
    ["empty account", { account: "" }],
    ["blank account", { account: "   " }],
    ["long account", { account: "a".repeat(257) }],
    ["control account", { account: "ad\nmin" }],
    ["long device name", { deviceName: "n".repeat(65) }],
    ["control device name", { deviceName: "Desk\ttop" }],
    ["empty device id", { deviceId: "" }],
    ["long device id", { deviceId: "d".repeat(1025) }],
    ["newline device id", { deviceId: `${DEVICE_ID}\n` }],
    ["NUL device id", { deviceId: `${DEVICE_ID}\u0000` }],
    ["DEL device id", { deviceId: `${DEVICE_ID}\u007f` }],
    ["non-string device id", { deviceId: 42 }],
    ["date-only createdAt", { createdAt: "2026-09-15" }],
    ["invalid id", { id: "row-1" }],
    ["captured OTP", { otpCode: "123456" }],
    ["extra password", { password: "PRIVATE_PASSWORD" }],
  ])("rejects %s with a value-free diagnostic", (_name, patch) => {
    const row: Record<string, unknown> = { ...trustRow(), ...patch };
    for (const [key, value] of Object.entries(patch))
      if (value === undefined) delete row[key];
    let message = "";
    try {
      normalizeDatabaseCredentialEntry(
        entry({ username: "admin", deviceTrust: [row as never] }),
      );
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/Invalid database credential vault/);
    expect(message).not.toContain(DEVICE_ID);
    expect(message).not.toContain("nas.example");
  });

  it.each<[string, DatabaseCredentialEntry["facets"]]>([
    ["an empty list", { username: "admin", deviceTrust: [] }],
    [
      "more than 16 rows",
      {
        username: "admin",
        deviceTrust: Array.from({ length: 17 }, (_, index) =>
          trustRow({ id: uuid(index), account: `user${index}` }),
        ),
      },
    ],
    [
      "duplicate row IDs",
      {
        username: "admin",
        deviceTrust: [trustRow(), trustRow({ account: "other" })],
      },
    ],
    [
      "two tokens for one NAS address and account",
      {
        username: "admin",
        deviceTrust: [
          trustRow(),
          trustRow({ id: uuid(9), deviceId: OTHER_DEVICE_ID }),
        ],
      },
    ],
    ["a device token without a credential", { deviceTrust: [trustRow()] }],
    [
      "a non-array facet",
      { username: "admin", deviceTrust: trustRow() as never },
    ],
  ])("rejects entries with %s", (_name, facets) => {
    expect(() => normalizeDatabaseCredentialEntry(entry(facets))).toThrow(
      /Invalid database credential vault/,
    );
  });
});

describe("Synology trusted-device target", () => {
  it.each<[Partial<Connection>, string]>([
    [{}, TARGET],
    [{ port: 443 }, "https://nas.example.test"],
    [{ hostname: "https://NAS.example.test:5001" }, TARGET],
    [
      {
        protocol: "synology",
        port: 5000,
        synologySettings: { version: 1, useHttps: false },
        httpApplication: undefined,
      },
      "http://nas.example.test:5000",
    ],
  ])("derives the canonical saved NAS origin %#", (overrides, expected) => {
    expect(
      synologyDeviceTrustTarget(attempt([], overrides).input.connection),
    ).toBe(expected);
  });

  it.each<Partial<Connection>>([
    { synologySettings: { version: 1, useHttps: true, accessMode: "website" } },
    { protocol: "ssh" },
    { hostname: "nas.example.test/webapi" },
    { hostname: "http://nas.example.test" },
    { hostname: "nas.example.test:5000" },
  ])("refuses non-NAS-API or ambiguous addresses %#", (overrides) => {
    expect(() =>
      synologyDeviceTrustTarget(attempt([], overrides).input.connection),
    ).toThrow(
      "Trusted devices need a saved Synology NAS API connection with a valid address.",
    );
  });
});

describe("runtime trusted-device helpers", () => {
  it("resolves by target and account from the connection's own entry only", async () => {
    const { input, vault } = attempt([
      entry(),
      entry(
        {
          username: "admin",
          deviceTrust: [
            trustRow({
              id: uuid(3),
              deviceId: OTHER_DEVICE_ID,
              account: "ops",
            }),
          ],
        },
        otherId,
      ),
    ]);
    await expect(resolveDeviceTrust(input)).resolves.toEqual({
      deviceName: DEVICE_NAME,
      deviceId: DEVICE_ID,
    });
    expect(vault.api.resolve).toHaveBeenCalledTimes(1);
    expect(vault.api.resolve).toHaveBeenCalledWith(expect.anything(), id, [
      "deviceTrust",
    ]);
    // The other entry has a token for "ops", but this connection references `id`.
    await expect(
      resolveDeviceTrust({ ...input, account: "ops" }),
    ).resolves.toBeNull();
    await expect(
      resolveDeviceTrust({ ...input, account: "Admin" }),
    ).resolves.toBeNull();
  });

  it("does not reuse a token saved for another NAS address", async () => {
    const moved = attempt([entry()], { port: 5443 });
    await expect(resolveDeviceTrust(moved.input)).resolves.toBeNull();
    const plain = attempt([entry()], {
      protocol: "http",
      synologySettings: { version: 1, useHttps: false, accessMode: "native" },
    });
    await expect(resolveDeviceTrust(plain.input)).resolves.toBeNull();
  });

  it("returns null without disclosure when the entry has no trusted devices", async () => {
    const { input, vault } = attempt([
      entry({ username: "admin", password: "PRIVATE_PASSWORD" }),
    ]);
    await expect(resolveDeviceTrust(input)).resolves.toBeNull();
    expect(vault.api.resolve).not.toHaveBeenCalled();
  });

  it.each(["owner", "session", "saved-target", "local", "website"])(
    "fails closed on %s mismatch before disclosing a token",
    async (reason) => {
      const overrides: Partial<Connection> =
        reason === "local"
          ? { credentialSource: { kind: "local" } }
          : reason === "website"
            ? {
                synologySettings: {
                  version: 1,
                  useHttps: true,
                  accessMode: "website",
                },
              }
            : {};
      const { input, vault } = attempt([entry()], overrides);
      if (reason === "owner") input.session.ownerDatabaseId = "database-b";
      if (reason === "session") input.session.connectionId = "other";
      if (reason === "saved-target")
        vi.mocked(input.target.readCurrent!).mockResolvedValue({
          connections: [{ ...input.connection, port: 5000 }],
        } as never);
      await expect(resolveDeviceTrust(input)).rejects.toThrow(
        reason === "local" ? DEVICE_TRUST_VAULT_REQUIRED_MESSAGE : /./,
      );
      const stored = await storeDeviceTrust({
        ...input,
        device: { deviceName: DEVICE_NAME, deviceId: DEVICE_ID },
      }).catch((error: unknown) => error);
      expect(stored).not.toEqual({ status: "saved" });
      expect(vault.api.resolve).not.toHaveBeenCalled();
      expect(vault.api.compareAndSwap).not.toHaveBeenCalled();
      if (reason === "local" || reason === "website")
        expect(vault.api.list).not.toHaveBeenCalled();
    },
  );

  it("stores one row by reviewed CAS, preserving every other facet and row", async () => {
    const { input, vault } = attempt([
      entry({
        username: "admin",
        password: "PRIVATE_PASSWORD",
        deviceTrust: [trustRow({ account: "ops" })],
      }),
    ]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-16T08:00:00.000Z"));
    try {
      await expect(
        storeDeviceTrust({
          ...input,
          device: { deviceName: DEVICE_NAME, deviceId: DEVICE_ID },
        }),
      ).resolves.toEqual({ status: "saved" });
    } finally {
      vi.useRealTimers();
    }
    expect(vault.api.compareAndSwap).toHaveBeenCalledTimes(1);
    expect(vault.api.compareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: "review-0" }),
      [{ operation: "put", entry: expect.anything() }],
    );
    const saved = vault.read().entries[0];
    expect(saved.facets.password).toBe("PRIVATE_PASSWORD");
    expect(saved.updatedAt).toBe("2026-09-16T08:00:00.000Z");
    expect(saved.facets.deviceTrust).toEqual([
      trustRow({ account: "ops" }),
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        surface: "synology-api",
        target: TARGET,
        account: "admin",
        deviceName: DEVICE_NAME,
        deviceId: DEVICE_ID,
        createdAt: "2026-09-16T08:00:00.000Z",
        portable: false,
      },
    ]);
  });

  it("replaces an older token for the same NAS address and account", async () => {
    const { input, vault } = attempt();
    await expect(
      storeDeviceTrust({
        ...input,
        device: { deviceName: "SortOfRemoteNG · RENAMED", deviceId: "NEW_DID" },
      }),
    ).resolves.toEqual({ status: "saved" });
    const rows = vault.read().entries[0].facets.deviceTrust!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceName: "SortOfRemoteNG · RENAMED",
      deviceId: "NEW_DID",
    });
    expect(vault.read().entries[0].facets.totp).toHaveLength(1);
  });

  it("reports a CAS conflict as a non-fatal notice and writes nothing", async () => {
    const { input, vault } = attempt([
      entry({ username: "admin", password: "PRIVATE_PASSWORD" }),
    ]);
    const original = vi.mocked(vault.api.resolve).getMockImplementation()!;
    vi.mocked(vault.api.resolve).mockImplementationOnce(async (...args) => {
      const facets = await original(...args);
      vault.concurrentEdit();
      return facets;
    });
    await expect(
      storeDeviceTrust({
        ...input,
        device: { deviceName: DEVICE_NAME, deviceId: DEVICE_ID },
      }),
    ).resolves.toEqual({
      status: "not-saved",
      message: DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
    });
    expect(vault.api.compareAndSwap).toHaveBeenCalledTimes(1);
    expect(vault.read().entries[0].name).toBe("Renamed elsewhere");
    expect(vault.read().entries[0].facets.deviceTrust).toBeUndefined();
  });

  it("refuses a 17th device without evicting another NAS's trust", async () => {
    const rows = Array.from({ length: 16 }, (_, index) =>
      trustRow({ id: uuid(index), account: `user${index}` }),
    );
    const { input, vault } = attempt([
      entry({ username: "admin", deviceTrust: rows }),
    ]);
    await expect(
      storeDeviceTrust({
        ...input,
        device: { deviceName: DEVICE_NAME, deviceId: DEVICE_ID },
      }),
    ).resolves.toEqual({
      status: "not-saved",
      message: DEVICE_TRUST_LIMIT_MESSAGE,
    });
    expect(vault.api.compareAndSwap).not.toHaveBeenCalled();
    expect(vault.read().entries[0].facets.deviceTrust).toEqual(rows);
  });

  it.each([
    { deviceName: DEVICE_NAME, deviceId: `${DEVICE_ID}\r\n` },
    { deviceName: DEVICE_NAME, deviceId: "d".repeat(1025) },
    { deviceName: DEVICE_NAME, deviceId: "" },
    { deviceName: "n".repeat(65), deviceId: DEVICE_ID },
  ])(
    "rejects an invalid DSM device before any vault read %#",
    async (device) => {
      const { input, vault } = attempt();
      const error = await storeDeviceTrust({ ...input, device }).catch(
        (reason: unknown) => reason,
      );
      expect(String(error)).toContain("cannot be stored");
      expect(String(error)).not.toContain(DEVICE_ID);
      expect(vault.api.list).not.toHaveBeenCalled();
    },
  );

  it("forgets only the matching row and drops the facet with the last one", async () => {
    const { input, vault } = attempt([
      entry({
        username: "admin",
        password: "PRIVATE_PASSWORD",
        deviceTrust: [trustRow(), trustRow({ id: uuid(4), account: "ops" })],
      }),
    ]);
    await expect(forgetDeviceTrust(input)).resolves.toEqual({
      status: "saved",
    });
    expect(vault.read().entries[0].facets.deviceTrust).toEqual([
      trustRow({ id: uuid(4), account: "ops" }),
    ]);
    await expect(forgetDeviceTrust(input)).resolves.toEqual({
      status: "unchanged",
    });
    await expect(
      forgetDeviceTrust({ ...input, account: "ops" }),
    ).resolves.toEqual({ status: "saved" });
    const [saved] = vault.read().entries;
    expect(saved.facets).toEqual({
      username: "admin",
      password: "PRIVATE_PASSWORD",
    });
    expect(databaseCredentialMetadata(saved).availableFacets).not.toContain(
      "deviceTrust",
    );
    expect(vault.api.compareAndSwap).toHaveBeenCalledTimes(2);
  });

  it("reports a forget conflict without throwing", async () => {
    const { input, vault } = attempt();
    vi.mocked(vault.api.compareAndSwap).mockRejectedValueOnce(
      new Error(`stale review ${DEVICE_ID}`),
    );
    await expect(forgetDeviceTrust(input)).resolves.toEqual({
      status: "not-saved",
      message: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
    });
    expect(vault.read().entries[0].facets.deviceTrust).toHaveLength(1);
  });

  it("exposes a bound controller through the deviceTrust intent without disclosing facets", async () => {
    const { input, vault } = attempt();
    const result = await resolveRuntimeVaultCredential({
      ...input,
      intent: "deviceTrust",
    });
    expect(result.facets).toEqual({});
    expect(vault.api.resolve).not.toHaveBeenCalled();
    await expect(result.deviceTrust!.resolve("admin")).resolves.toEqual({
      deviceName: DEVICE_NAME,
      deviceId: DEVICE_ID,
    });
    await expect(result.deviceTrust!.forget("admin")).resolves.toEqual({
      status: "saved",
    });
    await expect(
      result.deviceTrust!.store("admin", {
        deviceName: DEVICE_NAME,
        deviceId: "REENROLLED",
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(vault.read().entries[0].facets.deviceTrust![0].deviceId).toBe(
      "REENROLLED",
    );
    const login = await resolveRuntimeVaultCredential(input);
    expect(login.deviceTrust).toBeUndefined();
    await expect(
      resolveRuntimeVaultCredential({
        ...attempt([entry()], { protocol: "rdp", port: 3389 }).input,
        intent: "deviceTrust",
      }),
    ).rejects.toThrow("Synology NAS API");
  });

  it("never puts the device token in logs, errors, notices or write results", async () => {
    const consoleSpies = (
      ["log", "info", "warn", "error", "debug"] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const outputs: unknown[] = [];
    const capture = async (work: () => Promise<unknown>) => {
      try {
        outputs.push(await work());
      } catch (error) {
        outputs.push(String(error), (error as Error).stack);
      }
    };
    const device = { deviceName: DEVICE_NAME, deviceId: DEVICE_ID };
    const ok = attempt([
      entry({ username: "admin", password: "PRIVATE_PASSWORD" }),
    ]);
    await capture(() => storeDeviceTrust({ ...ok.input, device }));
    await capture(() => forgetDeviceTrust(ok.input));
    const conflict = attempt();
    vi.mocked(conflict.vault.api.compareAndSwap).mockRejectedValue(
      new Error(`backend echoed ${DEVICE_ID}`),
    );
    await capture(() => storeDeviceTrust({ ...conflict.input, device }));
    await capture(() => forgetDeviceTrust(conflict.input));
    const locked = attempt();
    locked.input.session.ownerDatabaseId = "database-b";
    await capture(() => resolveDeviceTrust(locked.input));
    await capture(() => storeDeviceTrust({ ...locked.input, device }));
    await capture(() =>
      storeDeviceTrust({
        ...ok.input,
        device: { ...device, deviceId: `${DEVICE_ID}\n` },
      }),
    );
    await capture(() =>
      storeDeviceTrust({ ...ok.input, account: `${DEVICE_ID}\n`, device }),
    );
    // Five resolved results (saved or non-fatal notices); the rest are rejections.
    expect(outputs.filter((item) => typeof item !== "string")).toHaveLength(5);
    expect(JSON.stringify(outputs)).not.toContain(DEVICE_ID);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
