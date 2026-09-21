import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  DatabaseCredentialVaultApi,
  VaultTotpFacet,
} from "../../src/types/security/databaseCredentialVault";
import { useHttpRedirectTrust } from "../../src/hooks/protocol/useHttpRedirectTrust";
import {
  anonymousRedirectConnection,
  type HttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  releaseRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { withSynologyRedirectDefaults } from "../../src/utils/protocol/synologyRedirectDefaults";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";

const mocks = vi.hoisted(() => ({
  context: null as unknown,
  manager: null as unknown,
  invoke: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.context,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => mocks.manager },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(vault = false, legacy = false) {
  const saved: Connection = {
    id: "original-saved-nas",
    name: "NAS",
    protocol: "https",
    hostname: "nas.fr3.quickconnect.to",
    port: 443,
    isGroup: false,
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
    basicAuthUsername: "FORM-USER",
    basicAuthPassword: "FORM-PASSWORD",
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "form" },
    httpAutoMfa: { version: 1, enabled: false },
    totpConfigs: [
      {
        id: "local-id",
        issuer: "DSM",
        account: "Manual",
        secret: "LOCAL-SEED",
        digits: 6,
        algorithm: "sha1",
        period: 30,
        backupCodes: ["BACKUP-SECRET"],
      },
    ],
    ...(vault
      ? {
          credentialSource: {
            kind: "vault" as const,
            credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            totpId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        }
      : {}),
  };
  if (legacy) delete saved.totpConfigs![0].id;
  const originalSession: ConnectionSession = {
    id: "original-tab",
    connectionId: saved.id,
    name: saved.name,
    hostname: saved.hostname,
    protocol: saved.protocol,
    status: "connected",
    startTime: new Date(),
    ownerDatabaseId: "db",
  };
  const selected: VaultTotpFacet = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    label: "Vault DSM",
    secret: "VAULT-SEED",
    digits: 6,
    algorithm: "sha256",
    period: 30,
  };
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "db", generation: 1 },
    changeRevision: 4,
    list: vi.fn(async () => ({
      scope: { databaseId: "db", generation: 1 },
      revision: 7,
      receipt: "PRIVATE-RECEIPT",
      entries: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Login",
          createdAt: "",
          updatedAt: "",
          availableFacets: ["totp" as const],
        },
      ],
    })),
    resolve: vi.fn(async () => ({
      // Even an over-returning backend must not leak fields or grant form login.
      username: "VAULT-USER",
      password: "VAULT-PASSWORD",
      totp: [
        { ...selected, extraSecret: "EXTRA-SECRET" },
        { ...selected, id: "unselected", secret: "UNSELECTED-SEED" },
      ],
    })),
    compareAndSwap: vi.fn(),
  };
  let databaseId = "db",
    epoch = 1;
  const persisted = { connections: [structuredClone(saved)] };
  const readCurrent = vi.fn(async () => structuredClone(persisted));
  const verifyCurrent = vi.fn(async () => {});
  const context = {
    state: { connections: [saved] },
    databaseAvailability: { status: "ready", databaseId: "db", generation: 1 },
    credentialVault: vault ? api : undefined,
  };
  mocks.context = context;
  mocks.manager = {
    getCurrentDatabase: () => ({ id: databaseId }),
    captureCurrentDatabaseDataTarget: () => {
      const captured = epoch;
      return {
        databaseId: "db",
        readCurrent,
        verifyCurrent,
        assertAccessible: () => {
          if (databaseId !== "db" || epoch !== captured)
            throw new Error("PRIVATE-LOCK-DETAILS");
        },
      };
    },
  };
  const initialProps = { connection: saved, session: originalSession };
  const hook = renderHook(
    ({ session, connection }) => useHttpRedirectTrust(session, connection),
    { initialProps },
  );
  const source = hook.result.current.defaultSource!;
  let props = initialProps;
  let depth = 0;
  function redirect(
    destinationUrl = "https://nas.de2.quickconnect.to/webman/index.cgi",
    tabId = originalSession.id,
  ) {
    const review: HttpRedirectReview = {
      receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sessionId: "proxy",
      sourceOrigin: `https://${props.connection.hostname}`,
      destinationUrl,
      navigationToken: null,
      documentSequence: 1,
      removedQuery: false,
    };
    const connection = anonymousRedirectConnection(
      props.connection,
      review,
      withSynologyRedirectDefaults(DEFAULT_HTTP_PROXY_POLICY, {
        version: 1,
        originalOrigin: source.originalOrigin,
      }),
    );
    registerRuntimeConnection(connection, {
      initialUrl: destinationUrl,
      redirectHops: ++depth,
      assertCurrent: vi.fn(),
      synologyRedirectSource: source,
    });
    props = {
      connection,
      session: {
        ...originalSession,
        id: tabId,
        connectionId: connection.id,
        hostname: connection.hostname,
        protocol: connection.protocol,
      },
    };
    hook.rerender(props);
    return connection;
  }
  return {
    ...hook,
    context,
    persisted,
    saved,
    source,
    api,
    selected,
    readCurrent,
    verifyCurrent,
    redirect,
    get props() {
      return props;
    },
    refresh: () => hook.rerender(props),
    lock: () => {
      epoch++;
    },
    switchDatabase: () => {
      databaseId = "other-db";
    },
    get controller() {
      return hook.result.current.synologyManualTotp!;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T12:00:05Z"));
  mocks.invoke.mockReset().mockResolvedValue("123456");
});
afterEach(() => {
  cleanup();
  clearRuntimeConnectionsForTests();
  vi.useRealTimers();
});

describe("redirected Synology manual authenticators", () => {
  it.each([false, true])(
    "discloses only metadata and requested codes with auto-MFA disabled (vault=%s)",
    async (vault) => {
      const view = fixture(vault);
      expect(view.result.current.synologyManualTotp).toBeUndefined();
      const runtime = view.redirect();
      const controller = view.controller;
      expect(controller.available).toBe(true);
      expect(view.result.current.synologyMfa).toBeUndefined();
      const entries = await controller.load();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        id: expect.any(String),
        label: vault ? "Vault DSM" : "DSM — Manual",
        digits: 6,
        algorithm: vault ? "sha256" : "sha1",
        period: 30,
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      view.refresh();
      expect(view.controller).toBe(controller);
      const code = await controller.generate(entries[0].id);
      expect(code.code).toBe("123456");
      expect(code.expires).toBe(new Date("2026-09-21T12:00:30Z").getTime());
      expect(code.assertCurrent).not.toThrow();
      expect(mocks.invoke).toHaveBeenCalledWith("totp_compute_code", {
        secret: vault ? "VAULT-SEED" : "LOCAL-SEED",
        algorithm: vault ? "SHA256" : "SHA1",
        digits: 6,
        period: 30,
      });
      if (vault)
        expect(view.api.resolve).toHaveBeenCalledWith(
          expect.any(Object),
          view.saved.credentialSource!.kind === "vault"
            ? view.saved.credentialSource!.credentialId
            : "",
          ["totp"],
        );
      const serialized = JSON.stringify({
        controller,
        entries,
        code,
        runtime,
        session: view.props.session,
        navigation: getRuntimeWebNavigation(runtime.id),
      });
      expect(serialized).not.toMatch(
        /LOCAL-SEED|VAULT-SEED|UNSELECTED-SEED|BACKUP-SECRET|EXTRA-SECRET|FORM-PASSWORD|VAULT-PASSWORD|PRIVATE-RECEIPT|credentialSource|totpConfigs|aaaaaaaa-aaaa-4aaa|cccccccc-cccc-4ccc/,
      );
      expect(view.source.formLogin!.autoMfaAttempted()).toBe(false);
      expect(view.source.formLogin!.assertAutoMfaCurrent).not.toThrow();
      controller.revoke();
      expect(controller.available).toBe(false);
      expect(code.assertCurrent).toThrow();
      expect(view.source.formLogin!.assertAutoMfaCurrent).not.toThrow();
      expect(() =>
        view.source.formLogin!.assertCurrent(
          view.saved,
          vault ? view.api : undefined,
        ),
      ).not.toThrow();
    },
  );

  it("allows manual generation after the automatic one-shot attempt is consumed or revoked", async () => {
    const view = fixture();
    view.redirect();
    view.source.formLogin!.claimAutoMfaAttempt();
    view.source.formLogin!.revokeAutoMfa();
    const [entry] = await view.controller.load();
    await expect(view.controller.generate(entry.id)).resolves.toMatchObject({
      code: "123456",
    });
    await expect(view.controller.generate(entry.id)).resolves.toMatchObject({
      code: "123456",
    });
    expect(view.source.formLogin!.autoMfaAttempted()).toBe(true);
  });

  it("keeps legacy local entries without IDs usable without editing the saved connection", async () => {
    const view = fixture(false, true);
    view.redirect();
    const [entry] = await view.controller.load();
    await expect(view.controller.generate(entry.id)).resolves.toMatchObject({
      code: "123456",
    });
    expect(view.saved.totpConfigs![0].id).toBeUndefined();
    expect(view.persisted.connections[0].totpConfigs![0].id).toBeUndefined();
  });

  it("retains the original source across portal and HTTPS hops while revoking earlier controllers", async () => {
    const view = fixture();
    view.redirect("http://nas.quickconnect.to/");
    const portal = view.controller;
    const [entry] = await portal.load();
    const oldCode = await portal.generate(entry.id);
    view.redirect();
    expect(portal.available).toBe(false);
    expect(oldCode.assertCurrent).toThrow();
    expect(view.controller).not.toBe(portal);
    const [next] = await view.controller.load();
    await expect(view.controller.generate(next.id)).resolves.toMatchObject({
      code: "123456",
    });
    expect(view.source.formLogin!.assertAutoMfaCurrent).not.toThrow();
  });

  it("remains usable when a remounted destination reads availability during its first render", async () => {
    const view = fixture();
    view.redirect();
    const old = view.controller;
    view.unmount();
    const next = renderHook(() => {
      const trust = useHttpRedirectTrust(
        view.props.session,
        view.props.connection,
      );
      return {
        controller: trust.synologyManualTotp!,
        available: trust.synologyManualTotp?.available,
      };
    });
    expect(next.result.current.available).toBe(true);
    expect(old.available).toBe(false);
    await expect(next.result.current.controller.load()).resolves.toHaveLength(
      1,
    );
  });

  it("does not re-arm a revoked facade on unchanged navigation rerenders", async () => {
    const view = fixture();
    view.redirect();
    const controller = view.controller;
    controller.revoke();
    view.refresh();
    expect(view.controller).toBe(controller);
    expect(controller.available).toBe(false);
    await expect(controller.load()).rejects.toThrow();
  });

  it("remembers a navigation mutation observed on render even if the URL is later restored", async () => {
    const view = fixture();
    const runtime = view.redirect();
    const controller = view.controller;
    const navigation = getRuntimeWebNavigation(runtime.id)!;
    const originalUrl = navigation.initialUrl;
    navigation.initialUrl += "?changed";
    view.refresh();
    navigation.initialUrl = originalUrl;
    view.refresh();
    expect(controller.available).toBe(false);
    await expect(controller.load()).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "new-tab",
    "unrelated-origin",
    "missing-provenance",
    "zero-hops",
    "too-many-hops",
  ])("does not grant a facade for %s", async (change) => {
    const view = fixture();
    const runtime = view.redirect(
      change === "unrelated-origin"
        ? "https://other-nas.de2.quickconnect.to/"
        : undefined,
      change === "new-tab" ? "other-tab" : undefined,
    );
    const navigation = getRuntimeWebNavigation(runtime.id)!;
    if (change === "missing-provenance")
      delete navigation.synologyRedirectSource;
    if (change === "zero-hops") navigation.redirectHops = 0;
    if (change === "too-many-hops") navigation.redirectHops = 21;
    view.refresh();
    expect(view.result.current.synologyManualTotp).toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "local-seed",
    "password",
    "credential-selection",
    "source-delete",
    "source-duplicate",
    "database-generation",
    "database-unavailable",
    "database-switch",
    "database-lock",
    "navigation-url",
    "navigation-depth",
    "navigation-release",
    "tab-id",
    "session-target",
    "unmount",
  ])(
    "revokes issued codes on %s without resurrecting after restoration",
    async (change) => {
      const view = fixture();
      const runtime = view.redirect();
      const controller = view.controller;
      const [entry] = await controller.load();
      const code = await controller.generate(entry.id);
      const original = structuredClone(view.saved);
      if (change === "local-seed")
        view.saved.totpConfigs![0].secret = "ROTATED";
      if (change === "password") view.saved.basicAuthPassword = "ROTATED";
      if (change === "credential-selection")
        view.saved.credentialSource = {
          kind: "vault",
          credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
      if (change === "source-delete") view.context.state.connections = [];
      if (change === "source-duplicate")
        view.context.state.connections.push(structuredClone(view.saved));
      if (change === "database-generation")
        view.context.databaseAvailability.generation++;
      if (change === "database-unavailable")
        view.context.databaseAvailability.status = "locked";
      if (change === "database-switch") view.switchDatabase();
      if (change === "database-lock") view.lock();
      if (change === "navigation-url")
        getRuntimeWebNavigation(runtime.id)!.initialUrl += "?changed";
      if (change === "navigation-depth")
        getRuntimeWebNavigation(runtime.id)!.redirectHops++;
      if (change === "navigation-release") releaseRuntimeConnection(runtime.id);
      if (change === "tab-id") view.props.session.id = "other-tab";
      if (change === "session-target")
        view.props.session.hostname = "other.invalid";
      if (change === "unmount") view.unmount();
      expect(code.assertCurrent).toThrow();
      view.context.state.connections = [original];
      await expect(controller.load()).rejects.toThrow("original Synology");
      await expect(controller.generate(entry.id)).rejects.toThrow(
        "original Synology",
      );
      expect(controller.available).toBe(false);
      expect(mocks.invoke).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "lock",
    "generation",
    "revision",
    "database",
    "selected-totp",
    "missing-api",
  ])("revokes vault codes for %s with no local fallback", async (change) => {
    const view = fixture(true);
    view.redirect();
    const controller = view.controller;
    const [entry] = await controller.load();
    const code = await controller.generate(entry.id);
    if (change === "lock") view.api.scope = null;
    if (change === "generation") view.api.scope!.generation++;
    if (change === "revision") view.api.changeRevision++;
    if (change === "database") view.api.scope!.databaseId = "other-db";
    if (
      change === "selected-totp" &&
      view.saved.credentialSource?.kind === "vault"
    )
      view.saved.credentialSource.totpId = "unselected";
    if (change === "missing-api") view.context.credentialVault = undefined;
    expect(code.assertCurrent).toThrow();
    view.api.scope = { databaseId: "db", generation: 1 };
    view.api.changeRevision = 4;
    view.context.credentialVault = view.api;
    await expect(controller.generate(entry.id)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it.each(["verify", "read", "vault-list", "vault-resolve", "compute"])(
    "discards work revoked while awaiting %s",
    async (step) => {
      const view = fixture(true);
      view.redirect();
      const controller = view.controller;
      const [entry] = await controller.load();
      const gate = deferred<void>();
      const started = deferred<void>();
      if (step === "verify")
        view.verifyCurrent.mockImplementationOnce(async () => {
          started.resolve();
          await gate.promise;
        });
      if (step === "read")
        view.readCurrent.mockImplementationOnce(async () => {
          started.resolve();
          await gate.promise;
          return structuredClone(view.persisted);
        });
      if (step === "vault-list") {
        const value = await view.api.list(view.api.scope!);
        vi.mocked(view.api.list).mockImplementationOnce(async () => {
          started.resolve();
          await gate.promise;
          return value;
        });
      }
      if (step === "vault-resolve")
        vi.mocked(view.api.resolve).mockImplementationOnce(async () => {
          started.resolve();
          await gate.promise;
          return { totp: [view.selected] };
        });
      if (step === "compute")
        mocks.invoke.mockImplementationOnce(async () => {
          started.resolve();
          await gate.promise;
          return "123456";
        });
      const pending = controller.generate(entry.id);
      await started.promise;
      view.api.changeRevision++;
      gate.resolve();
      await expect(pending).rejects.toThrow("original Synology");
      expect(controller.available).toBe(false);
      expect(mocks.invoke).toHaveBeenCalledTimes(step === "compute" ? 1 : 0);
    },
  );

  it.each(["seed", "selection", "missing", "duplicate"])(
    "rechecks durable source %s before disclosure",
    async (change) => {
      const view = fixture(true);
      view.redirect();
      if (change === "seed")
        view.persisted.connections[0].totpConfigs![0].secret = "ROTATED";
      if (change === "selection")
        view.persisted.connections[0].credentialSource = { kind: "local" };
      if (change === "missing") view.persisted.connections = [];
      if (change === "duplicate")
        view.persisted.connections.push(structuredClone(view.saved));
      await expect(view.controller.load()).rejects.toThrow("original Synology");
      expect(view.api.resolve).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it("rechecks persisted state after computation", async () => {
    const view = fixture();
    view.redirect();
    const controller = view.controller;
    const [entry] = await controller.load();
    mocks.invoke.mockImplementationOnce(async () => {
      view.persisted.connections[0].totpConfigs![0].secret = "ROTATED";
      return "123456";
    });
    await expect(controller.generate(entry.id)).rejects.toThrow(
      "original Synology",
    );
    expect(controller.available).toBe(false);
  });

  it.each([
    "snapshot-scope",
    "snapshot-revision",
    "missing-selected",
    "duplicate-selected",
    "missing-facet",
    "resolve-error",
  ])(
    "rejects vault %s without falling back to local authenticators",
    async (change) => {
      const view = fixture(true);
      view.redirect();
      const controller = view.controller;
      const [entry] = await controller.load();
      if (change === "snapshot-scope" || change === "snapshot-revision") {
        const snapshot = await view.api.list(view.api.scope!);
        if (change === "snapshot-scope") snapshot.scope.generation++;
        else snapshot.revision++;
        vi.mocked(view.api.list).mockResolvedValue(snapshot);
      }
      if (change === "missing-selected")
        vi.mocked(view.api.resolve).mockResolvedValue({ totp: [] });
      if (change === "duplicate-selected")
        vi.mocked(view.api.resolve).mockResolvedValue({
          totp: [view.selected, view.selected],
        });
      if (change === "missing-facet")
        vi.mocked(view.api.resolve).mockResolvedValue({
          password: "PRIVATE-BACKEND-SECRET",
        });
      if (change === "resolve-error")
        vi.mocked(view.api.resolve).mockRejectedValue(
          new Error("PRIVATE-BACKEND-SECRET"),
        );
      await expect(controller.generate(entry.id)).rejects.toThrow(
        /^The original Synology login or credential access changed\./,
      );
      expect(controller.available).toBe(false);
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it("does not return native error details or malformed codes", async () => {
    const view = fixture();
    view.redirect();
    const [entry] = await view.controller.load();
    mocks.invoke.mockResolvedValueOnce("not-a-code");
    await expect(view.controller.generate(entry.id)).rejects.toThrow("invalid");
    mocks.invoke.mockRejectedValueOnce(new Error("PRIVATE-BACKEND-SECRET"));
    await expect(view.controller.generate(entry.id)).rejects.toThrow(
      /^The original Synology login or credential access changed\./,
    );
  });

  it("expires individual codes without consuming the manual controller", async () => {
    const view = fixture();
    view.redirect();
    const [entry] = await view.controller.load();
    const code = await view.controller.generate(entry.id);
    vi.setSystemTime(code.expires - 2000);
    await expect(view.controller.generate(entry.id)).rejects.toThrow(
      "next authenticator time window",
    );
    vi.setSystemTime(code.expires);
    expect(code.assertCurrent).toThrow("expired");
    expect(view.controller.available).toBe(true);
    await expect(view.controller.generate(entry.id)).resolves.toMatchObject({
      code: "123456",
    });
  });
});
