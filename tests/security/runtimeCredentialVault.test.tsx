import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import {
  getVaultRuntimeUnsupportedMessage,
  resolveRuntimeVaultCredential,
  runtimeCredentialTargetKey,
  withoutConnectionLocalCredentials,
} from "../../src/utils/security/runtimeCredentialVault";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { resolveHttpBasicCredentials } from "../../src/utils/auth/httpCredentials";
import { resolveRuntimeConnection } from "../../src/utils/session/runtimeConnectionRegistry";
import { useRuntimeCredentialVault } from "../../src/hooks/security/useRuntimeCredentialVault";

const state = vi.hoisted(() => ({
  api: undefined as DatabaseCredentialVaultApi | undefined,
  target: undefined as DatabaseDataTarget | undefined,
  connections: [] as Connection[],
  availability: {
    status: "ready" as const,
    databaseId: "database-a",
    generation: 1,
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    credentialVault: state.api,
    state: { connections: state.connections },
    databaseAvailability: state.availability,
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      captureCurrentDatabaseDataTarget: () => state.target,
    }),
  },
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture(overrides: Partial<Connection> = {}) {
  const connection: Connection = {
    id: "saved",
    name: "Host",
    hostname: "example.test",
    port: 22,
    protocol: "ssh",
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    credentialSource: { kind: "vault", credentialId: id },
    username: "IGNORED_USER",
    password: "IGNORED_PASSWORD",
    ...overrides,
  };
  const session: ConnectionSession = {
    id: "session",
    connectionId: connection.id,
    ownerDatabaseId: "database-a",
    hostname: connection.hostname,
    protocol: connection.protocol,
    name: "Host",
    status: "connecting",
    startTime: new Date(),
  };
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "database-a", generation: 1 },
    changeRevision: 1,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { databaseId: "database-a", generation: 1 },
      revision: 1,
      receipt: "receipt",
      entries: [
        {
          id,
          name: "Reusable",
          createdAt: "2026-09-10T00:00:00Z",
          updatedAt: "2026-09-10T00:00:00Z",
          availableFacets: [
            "username",
            "password",
            "domain",
            "totp",
            "privateKey",
          ],
        },
      ],
    })),
    resolve: vi.fn(async () => ({
      username: "VAULT_USER",
      password: "VAULT_PASSWORD",
      domain: "VAULT_DOMAIN",
    })),
    compareAndSwap: vi.fn(),
  };
  const target = {
    databaseId: "database-a",
    assertAccessible: vi.fn(),
    readCurrent: vi.fn(async () => ({ connections: [connection] })),
  } as unknown as DatabaseDataTarget;
  state.api = api;
  state.target = target;
  state.connections = [connection];
  return { api, connection, session, target, assertCurrent: vi.fn() };
}
afterEach(cleanup);
beforeEach(() => {
  state.api = undefined;
  state.target = undefined;
  state.connections = [];
  state.availability = {
    status: "ready",
    databaseId: "database-a",
    generation: 1,
  };
});
describe("runtime database vault boundary", () => {
  it("compares nested target settings semantically while retaining sensitive values and array order", () => {
    const input = fixture({
      protocol: "https",
      port: 443,
      httpApplication: { version: 1, id: "generic-form", loginMode: "form" },
      httpHeaders: { "X-Tenant": "a", "X-Context": "b" },
      httpFormAutomation: {
        version: 1,
        fillDelayMs: 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 1000,
        submit: false,
        fields: [
          { selector: "#one", value: "one" },
          { selector: "#two", value: "two" },
        ],
      },
    });
    const original = runtimeCredentialTargetKey(input.connection);
    const reordered = {
      ...input.connection,
      httpApplication: {
        loginMode: "form" as const,
        id: "generic-form",
        version: 1 as const,
      },
      httpHeaders: { "X-Context": "b", "X-Tenant": "a" },
    };
    expect(runtimeCredentialTargetKey(reordered)).toBe(original);
    expect(
      runtimeCredentialTargetKey({
        ...reordered,
        httpHeaders: { ...reordered.httpHeaders, "X-Tenant": "changed" },
      }),
    ).not.toBe(original);
    expect(
      runtimeCredentialTargetKey({ ...reordered, hostname: "other.invalid" }),
    ).not.toBe(original);
    expect(
      runtimeCredentialTargetKey({
        ...reordered,
        credentialSource: { kind: "local" },
      }),
    ).not.toBe(original);
    expect(
      runtimeCredentialTargetKey({
        ...reordered,
        httpFormAutomation: {
          ...input.connection.httpFormAutomation!,
          fields: [...input.connection.httpFormAutomation!.fields].reverse(),
        },
      }),
    ).not.toBe(original);
  });
  it("rejects a local-mode ID collision from another database before returning a local fallback", async () => {
    const input = fixture({ credentialSource: { kind: "local" } });
    state.availability = {
      status: "ready",
      databaseId: "database-b",
      generation: 1,
    };
    const view = renderHook(() =>
      useRuntimeCredentialVault(input.session, input.connection),
    );
    await expect(view.result.current(() => undefined)).rejects.toThrow(
      /owning database/,
    );
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it("resolves only requested password facets and never stores them on connections, sessions or registry", async () => {
    const input = fixture();
    const before = JSON.stringify([input.connection, input.session]);
    const result = await resolveRuntimeVaultCredential(input);
    expect(input.api.resolve).toHaveBeenCalledWith(expect.anything(), id, [
      "username",
      "password",
    ]);
    expect(result.facets.password).toBe("VAULT_PASSWORD");
    result.assertCurrent();
    expect(JSON.stringify([input.connection, input.session])).toBe(before);
    expect(resolveRuntimeConnection([], input.connection.id)).toBeUndefined();
  });
  it("validates metadata before automation without disclosing secrets", async () => {
    const input = fixture();
    expect(
      (await resolveRuntimeVaultCredential({ ...input, validateOnly: true }))
        .facets,
    ).toEqual({});
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it("selects domain only for RDP, never substitutes a key or first authenticator", async () => {
    const input = fixture({ protocol: "rdp", port: 3389 });
    await resolveRuntimeVaultCredential(input);
    expect(input.api.resolve).toHaveBeenCalledWith(expect.anything(), id, [
      "username",
      "password",
      "domain",
    ]);
    vi.mocked(input.api.list).mockResolvedValueOnce({
      scope: input.api.scope!,
      revision: 1,
      receipt: "other",
      entries: [
        {
          id,
          name: "Key only",
          createdAt: "",
          updatedAt: "",
          availableFacets: ["privateKey", "totp", "passkey"],
        },
      ],
    });
    await expect(resolveRuntimeVaultCredential(input)).rejects.toThrow(
      /requires a vault username and password/,
    );
  });
  it.each(["owner", "target", "reference", "missing"])(
    "refuses %s mismatch with no local fallback",
    async (reason) => {
      const input = fixture();
      if (reason === "owner") input.session.ownerDatabaseId = "database-b";
      if (reason === "target") input.session.hostname = "other.test";
      if (reason === "reference")
        vi.mocked(input.target.readCurrent!).mockResolvedValue({
          connections: [
            { ...input.connection, credentialSource: { kind: "local" } },
          ],
        } as never);
      if (reason === "missing")
        vi.mocked(input.api.list).mockResolvedValue({
          scope: input.api.scope!,
          revision: 1,
          receipt: "r",
          entries: [],
        });
      await expect(resolveRuntimeVaultCredential(input)).rejects.toThrow();
      expect(input.api.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    { protocol: "ftp" },
    { protocol: "ssh", authType: "key" },
    { protocol: "ssh", authType: "totp" },
    { protocol: "https", authType: "header" },
    {
      protocol: "https",
      httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
      synologySettings: { version: 1, useHttps: true, accessMode: "native" },
    },
  ] as Partial<Connection>[])("rejects unwired modes %#", async (overrides) => {
    const input = fixture(overrides);
    expect(getVaultRuntimeUnsupportedMessage(input.connection)).toContain(
      "not supported",
    );
    await expect(resolveRuntimeVaultCredential(input)).rejects.toThrow();
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it("refuses local header/cookie/literal field side channels and invalid application modes", () => {
    for (const overrides of [
      { httpHeaders: { Authorization: "local" } },
      { httpHeaders: { Cookie: "local" } },
      { httpHeaders: { "X-Api-Key": "local" } },
      {
        httpFormAutomation: {
          fields: [{ selector: "#token", value: "local" }],
        },
      },
      { httpApplication: { version: 1, id: "generic", loginMode: "header" } },
    ])
      expect(
        getVaultRuntimeUnsupportedMessage(
          fixture({ protocol: "https", ...overrides } as Partial<Connection>)
            .connection,
        ),
      ).toContain("cannot be combined");
  });
  it("defers HTTP credentials until explicit resolution, including legacy dedicated Basic values", () => {
    const input = fixture({
      protocol: "https",
      authType: "digest",
      basicAuthUsername: "OLD",
      basicAuthPassword: "OLD_SECRET",
    });
    expect(resolveHttpBasicCredentials(input.connection)).toBeNull();
    expect(resolveHttpApplicationLogin(input.connection)).toMatchObject({
      credentials: null,
      upstreamAuthMode: "digest",
    });
    expect(
      resolveHttpApplicationLogin(input.connection, {
        username: "VAULT",
        password: "SECRET",
      }),
    ).toMatchObject({
      credentials: { username: "VAULT", password: "SECRET" },
      upstreamAuthMode: "digest",
    });
    input.connection.httpApplication = {
      version: 1,
      id: "wordpress",
      loginMode: "form",
    };
    expect(resolveHttpApplicationLogin(input.connection)).toMatchObject({
      credentials: null,
      autoLogin: true,
    });
    expect(
      resolveHttpApplicationLogin(input.connection, {
        username: "VAULT",
        password: "SECRET",
      }),
    ).toMatchObject({
      credentials: { username: "VAULT", password: "SECRET" },
      autoLogin: true,
    });
  });
  it("manual website mode discloses no facets", async () => {
    const input = fixture({
      protocol: "https",
      httpApplication: { version: 1, id: "wordpress", loginMode: "manual" },
    });
    await resolveRuntimeVaultCredential(input);
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it("preserves an explicitly present empty RDP password for the existing adapter", async () => {
    const input = fixture({ protocol: "rdp", port: 3389 });
    vi.mocked(input.api.resolve).mockResolvedValue({
      username: "user",
      password: "",
    });
    expect((await resolveRuntimeVaultCredential(input)).facets.password).toBe(
      "",
    );
  });
  it("removes ignored local secrets from automation and redirect context without changing the saved row", () => {
    const input = fixture({
      basicAuthPassword: "BASIC",
      httpHeaders: { Authorization: "HEADER" },
      totpSecret: "TOTP",
      privateKey: "KEY",
      passphrase: "PHRASE",
      httpFormAutomation: {
        version: 1,
        fillDelayMs: 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 1000,
        submit: false,
        fields: [{ selector: "#x", value: "LITERAL" }],
      },
    });
    const scrubbed = withoutConnectionLocalCredentials(input.connection);
    for (const value of [
      "IGNORED_PASSWORD",
      "BASIC",
      "HEADER",
      "TOTP",
      "KEY",
      "PHRASE",
      "LITERAL",
    ])
      expect(JSON.stringify(scrubbed)).not.toContain(value);
    expect(input.connection.password).toBe("IGNORED_PASSWORD");
  });
  it.each([
    "unmount",
    "scope",
    "target",
    "revision",
    "cancel",
    "headers",
    "form",
    "mfa",
    "policy",
  ])("fences deferred resolution on %s", async (reason) => {
    const input = fixture();
    let finish!: (value: { username: string; password: string }) => void;
    vi.mocked(input.api.resolve).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let cancelled = false;
    const guard = () => {
      if (cancelled) throw new Error("cancelled");
    };
    const view = renderHook(
      ({ session, connection }) =>
        useRuntimeCredentialVault(session, connection),
      { initialProps: input },
    );
    const result = view.result.current(guard);
    const rejected = expect(result).rejects.toThrow();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    if (reason === "unmount") view.unmount();
    if (reason === "scope") {
      state.api = {
        ...input.api,
        scope: { databaseId: "database-b", generation: 2 },
      };
      view.rerender(input);
    }
    if (reason === "target")
      view.rerender({
        ...input,
        connection: { ...input.connection, hostname: "other.test" },
      });
    if (reason === "revision") {
      state.api = { ...input.api, changeRevision: 2 };
      view.rerender(input);
    }
    if (reason === "cancel") cancelled = true;
    if (reason === "headers")
      view.rerender({
        ...input,
        connection: {
          ...input.connection,
          httpHeaders: { Authorization: "added" },
        },
      });
    if (reason === "form")
      view.rerender({
        ...input,
        connection: {
          ...input.connection,
          httpFormAutomation: {
            version: 1,
            fillDelayMs: 0,
            submitDelayMs: 0,
            detectionTimeoutMs: 1000,
            submit: false,
            fields: [{ selector: "#token", value: "added" }],
          },
        },
      });
    if (reason === "mfa")
      view.rerender({
        ...input,
        connection: {
          ...input.connection,
          httpAutoMfa: { version: 1, enabled: false },
        },
      });
    if (reason === "policy")
      view.rerender({
        ...input,
        connection: { ...input.connection, httpVerifySsl: false },
      });
    await act(async () =>
      finish({ username: "SECRET_USER", password: "SECRET" }),
    );
    await rejected;
  });
});
