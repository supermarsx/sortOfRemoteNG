import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { useHttpRedirectTrust } from "../../src/hooks/protocol/useHttpRedirectTrust";
import {
  anonymousRedirectConnection,
  type HttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";
import {
  httpRedirectConnectionOrigin,
  httpRedirectTrustIdentity,
} from "../../src/utils/protocol/httpRedirectTrustIdentity";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
  activateSynologyMfaProof,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { withSynologyRedirectDefaults } from "../../src/utils/protocol/synologyRedirectDefaults";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";

const h = vi.hoisted(() => ({
  context: null as unknown,
  manager: null as unknown,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => h.context,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
}));

const source: Connection = {
  id: "saved-source",
  name: "Original NAS",
  protocol: "https",
  hostname: "source.invalid",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  basicAuthUsername: "private-user",
  basicAuthPassword: "private-password",
};
const session: ConnectionSession = {
  id: "tab",
  connectionId: source.id,
  name: source.name,
  protocol: "https",
  hostname: source.hostname,
  status: "connected",
  startTime: new Date("2026-09-10"),
  ownerDatabaseId: "db-a",
};
const review: HttpRedirectReview = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "proxy",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://destination.invalid/login/",
  navigationToken: "a".repeat(32),
  documentSequence: 1,
  removedQuery: true,
};
const grant = (
  origins = ["https://destination.invalid"],
  autoContinue?: boolean,
) => ({
  version: 1 as const,
  origins,
  ...(autoContinue === undefined ? {} : { autoContinue }),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  saved: Connection = structuredClone(source),
  isSaved = true,
  credentialVault?: DatabaseCredentialVaultApi,
) {
  let databaseId = "db-a",
    epoch = 1;
  let persisted = { connections: isSaved ? [structuredClone(saved)] : [] };
  const readCurrent = vi.fn(async () => structuredClone(persisted));
  const flush = vi.fn(async (): Promise<void> => undefined);
  const context = {
    credentialVault,
    state: { connections: isSaved ? [saved] : [] },
    databaseAvailability: { status: "ready", databaseId, generation: 1 },
    flushPendingSave: flush,
    dispatchAndFlush: vi.fn(
      async (action: { type: string; payload: Connection }) => {
        context.state.connections = context.state.connections.map((item) =>
          item.id === action.payload.id ? action.payload : item,
        );
        persisted = { connections: structuredClone(context.state.connections) };
      },
    ),
  };
  const manager = {
    getCurrentDatabase: () => ({ id: databaseId }),
    captureCurrentDatabaseDataTarget: vi.fn(() => {
      const capturedId = databaseId,
        capturedEpoch = epoch;
      return {
        databaseId: capturedId,
        assertAccessible: () => {
          if (capturedId !== databaseId || capturedEpoch !== epoch)
            throw new Error("private backend lock diagnostic");
        },
        readCurrent,
        verifyCurrent: async () => {},
      };
    }),
  };
  h.context = context;
  h.manager = manager;
  const initialProps = { connection: saved, session };
  const hook = renderHook(
    (props = initialProps) =>
      useHttpRedirectTrust(props.session, props.connection),
    { initialProps },
  );
  return {
    ...hook,
    context,
    manager,
    readCurrent,
    flush,
    get persisted() {
      return persisted;
    },
    set persisted(next) {
      persisted = next;
    },
    changeLease: (nextId = databaseId) => {
      databaseId = nextId;
      epoch++;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  clearRuntimeConnectionsForTests();
});
afterEach(cleanup);

describe("database-owned trusted HTTP redirect preferences", () => {
  const qc = (): Connection => ({
    ...source,
    hostname: "example-nas.fr3.quickconnect.to",
    httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, queryParameters: [] },
  });
  const qcReview = (
    origin = "https://example-nas.fr3.quickconnect.to",
    destinationUrl = "http://example-nas.quickconnect.to/",
  ): HttpRedirectReview => ({
    ...review,
    sourceOrigin: origin,
    destinationUrl,
  });
  const formSource = (): Connection => ({
    ...qc(),
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "form" },
  });
  function inheritForm(view: ReturnType<typeof fixture>, redeem = false) {
    const original = view.result.current.defaultSource!;
    const target = anonymousRedirectConnection(
      view.context.state.connections[0],
      qcReview(undefined, "https://example-nas.de2.quickconnect.to/"),
      withSynologyRedirectDefaults(
        DEFAULT_HTTP_PROXY_POLICY,
        view.result.current.defaults,
      ),
    );
    const continuation = { id: "continuation", cancel: vi.fn() };
    registerRuntimeConnection(target, {
      initialUrl: "https://example-nas.de2.quickconnect.to/",
      redirectHops: 1,
      assertCurrent: () => {},
      synologyRedirectSource: original,
      ...(redeem ? { nativeContinuation: continuation } : {}),
    });
    if (redeem)
      activateSynologyMfaProof(
        target.id,
        continuation,
        "proxy",
        "http://127.0.0.1:41000",
        () => {},
      );
    view.rerender({
      connection: target,
      session: { ...session, connectionId: target.id },
    });
    return target;
  }
  it("retains only a form-login revocation lease across anonymous handoffs", () => {
    const view = fixture(formSource());
    expect(view.result.current.formLoginCurrent).toBe(true);
    const target = inheritForm(view);
    expect(target).not.toHaveProperty("httpApplication");
    expect(target).not.toHaveProperty("basicAuthPassword");
    expect(target.httpAutoLogin).toBe(false);
    expect(view.result.current.formLoginCurrent).toBe(true);
    expect(() => view.result.current.assertFormLoginCurrent()).not.toThrow();
    expect(JSON.stringify(view.result.current.defaultSource)).not.toContain(
      "private",
    );
  });
  const mfaSource = (): Connection => ({
    ...formSource(),
    httpAutoMfa: {
      version: 1,
      enabled: true,
      origin: "https://example-nas.fr3.quickconnect.to",
      challengeId: "synology-dsm-otp",
      totpConfigId: "otp",
    },
    totpConfigs: [
      {
        id: "otp",
        secret: "LOCAL-SEED",
        issuer: "DSM",
        account: "user",
        algorithm: "sha1",
        digits: 6,
        period: 30,
      },
    ],
  });
  const mfaContext = (target: Connection) => ({
    runtimeConnectionId: target.id,
    currentUrl: "https://example-nas.de2.quickconnect.to/webman/index.cgi",
    document: {
      sessionId: "proxy",
      url: "http://127.0.0.1:41000/webman/index.cgi",
    },
  });
  it("has no MFA capability before native continuation redemption", () => {
    const view = fixture(mfaSource());
    expect(view.result.current.synologyMfa).toBeUndefined();
    inheritForm(view);
    expect(view.result.current.synologyMfa).toBeUndefined();
  });
  it("exposes only a proof-bound MFA capability, never the saved source or its secrets", () => {
    const view = fixture(mfaSource());
    const target = inheritForm(view, true);
    const capability = view.result.current.synologyMfa!;
    capability.assertCurrent(mfaContext(target));
    expect(capability.runtimeConnectionId).toBe(target.id);
    expect(capability.proxySessionId).toBe("proxy");
    expect(JSON.stringify([capability, target])).not.toMatch(
      /LOCAL-SEED|private-password|totpConfigs|httpAutoMfa|credentialSource/,
    );
    expect(view.result.current).not.toHaveProperty("credentialConnection");
    capability.claim(mfaContext(target));
    view.rerender({
      connection: target,
      session: { ...session, connectionId: target.id },
    });
    expect(view.result.current.synologyMfa!.attempted()).toBe(true);
    expect(() =>
      view.result.current.synologyMfa!.claim(mfaContext(target)),
    ).toThrow();
  });
  it.each([
    "deleted",
    "duplicate",
    "db-generation",
    "locked",
    "seed",
    "mfa",
    "credential-source",
  ])(
    "permanently revokes a redeemed capability after %s, without fallback",
    (change) => {
      const original = mfaSource();
      const view = fixture(original);
      const target = inheritForm(view, true);
      const capability = view.result.current.synologyMfa!;
      if (change === "deleted") view.context.state.connections = [];
      if (change === "duplicate") view.context.state.connections.push(original);
      if (change === "db-generation")
        view.context.databaseAvailability.generation++;
      if (change === "locked")
        view.context.databaseAvailability.status = "locked";
      if (change === "seed")
        view.context.state.connections = [
          {
            ...original,
            totpConfigs: [{ ...original.totpConfigs![0], secret: "CHANGED" }],
          },
        ];
      if (change === "mfa")
        view.context.state.connections = [
          { ...original, httpAutoMfa: { version: 1, enabled: false } },
        ];
      if (change === "credential-source")
        view.context.state.connections = [
          {
            ...original,
            credentialSource: {
              kind: "vault",
              credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
          },
        ];
      expect(() => capability.assertCurrent(mfaContext(target))).toThrow();
      view.context.state.connections = [original];
      view.context.databaseAvailability.status = "ready";
      view.context.databaseAvailability.generation = 1;
      view.rerender({
        connection: target,
        session: { ...session, connectionId: target.id },
      });
      expect(view.result.current.synologyMfa).toBeUndefined();
    },
  );
  it("does not turn a Synology budget into an OTP grant for an unrelated origin", () => {
    const view = fixture(mfaSource());
    const source = view.result.current.defaultSource!;
    const target = anonymousRedirectConnection(
      view.context.state.connections[0],
      { ...review, sourceOrigin: source.originalOrigin },
    );
    const continuation = { id: "continuation", cancel: vi.fn() };
    registerRuntimeConnection(target, {
      initialUrl: review.destinationUrl,
      redirectHops: 1,
      assertCurrent: () => {},
      synologyRedirectSource: source,
      nativeContinuation: continuation,
    });
    activateSynologyMfaProof(
      target.id,
      continuation,
      "proxy",
      "http://127.0.0.1:41000",
      () => {},
    );
    view.rerender({
      connection: target,
      session: { ...session, connectionId: target.id },
    });
    expect(view.result.current.synologyMfa).toBeUndefined();
  });
  it.each(["password", "mode", "allowlist"])(
    "revokes original %s edits and cannot re-arm via ABA",
    (field) => {
      const original = formSource();
      const view = fixture(original);
      const target = inheritForm(view);
      view.context.state.connections = [
        {
          ...original,
          ...(field === "password"
            ? { basicAuthPassword: "changed" }
            : field === "mode"
              ? {
                  httpApplication: {
                    version: 1 as const,
                    id: "synology-dsm" as const,
                    loginMode: "manual" as const,
                  },
                }
              : { httpTrustedRedirectDestinations: grant() }),
        },
      ];
      view.rerender({
        connection: target,
        session: { ...session, connectionId: target.id },
      });
      expect(view.result.current.formLoginCurrent).toBe(false);
      expect(() => view.result.current.assertFormLoginCurrent()).toThrow();
      view.context.state.connections = [original];
      view.rerender({
        connection: target,
        session: { ...session, connectionId: target.id },
      });
      expect(() => view.result.current.assertFormLoginCurrent()).toThrow();
    },
  );
  it.each(["revision", "scope", "locked"])(
    "revokes inherited vault %s without resolving destination credentials",
    (change) => {
      const vault: DatabaseCredentialVaultApi = {
        scope: { databaseId: "db-a", generation: 8 },
        changeRevision: 3,
        list: vi.fn(),
        resolve: vi.fn(),
        compareAndSwap: vi.fn(),
      };
      const original = {
        ...formSource(),
        credentialSource: {
          kind: "vault" as const,
          credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      };
      const view = fixture(original, true, vault);
      const target = inheritForm(view);
      expect(view.result.current.formLoginCurrent).toBe(true);
      view.context.credentialVault = {
        ...vault,
        ...(change === "revision"
          ? { changeRevision: 4 }
          : {
              scope:
                change === "locked"
                  ? null
                  : { databaseId: "db-a", generation: 9 },
            }),
      };
      view.rerender({
        connection: target,
        session: { ...session, connectionId: target.id },
      });
      expect(() => view.result.current.assertFormLoginCurrent()).toThrow();
      expect(view.result.current.formLoginCurrent).toBe(false);
      expect(vault.resolve).not.toHaveBeenCalled();
      expect(vault.list).not.toHaveBeenCalled();
    },
  );
  it("keeps the credential lease fail-closed while database availability is absent", () => {
    const view = fixture(formSource());
    const target = inheritForm(view);
    view.context.databaseAvailability.status = "locked";
    view.rerender({
      connection: target,
      session: { ...session, connectionId: target.id },
    });
    expect(view.result.current.defaultSource?.formLogin).toBeDefined();
    expect(() => view.result.current.assertFormLoginCurrent()).toThrow();
  });
  it("does not create deferred login intent for unsaved or manual sources", () => {
    const unsaved = fixture(formSource(), false);
    expect(unsaved.result.current.defaultSource?.formLogin).toBeUndefined();
    unsaved.unmount();
    const manual = fixture({
      ...formSource(),
      httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    });
    expect(manual.result.current.defaultSource?.formLogin).toBeUndefined();
  });
  it.each([true, false])(
    "keeps the Synology budget with defaults off through an unrelated manual hop (saved=%s)",
    (isSaved) => {
      const initial: Connection = {
        ...qc(),
        synologySettings: {
          version: 1,
          useHttps: true,
          useDefaultRedirectDestinations: false,
        },
      };
      const view = fixture(initial, isSaved);
      expect(view.result.current.defaults).toBeUndefined();
      expect(view.result.current.redirectBudget?.profile).toBe("synology");
      const original = view.result.current.defaultSource;
      const target = {
        ...source,
        id: "ephemeral",
        hostname: "foreign.invalid",
      };
      registerRuntimeConnection(target, {
        initialUrl: "https://foreign.invalid/",
        redirectHops: 7,
        assertCurrent: vi.fn(),
        synologyRedirectSource: original,
      });
      view.rerender({
        connection: target,
        session: { ...session, connectionId: target.id },
      });
      expect(view.result.current.defaults).toBeUndefined();
      expect(view.result.current.redirectBudget?.profile).toBe("synology");
      const budget = view.result.current.redirectBudget!;
      expect(() => budget.assertCurrent()).not.toThrow();
      if (isSaved) {
        view.context.state.connections = [
          { ...initial, hostname: "changed.invalid" },
        ];
        expect(() => budget.assertCurrent()).toThrow();
      }
      view.changeLease();
      expect(() => budget.assertCurrent()).toThrow();
    },
  );
  it("does not learn a Synology budget from a later destination without original provenance", () => {
    const view = fixture(source);
    expect(view.result.current.redirectBudget).toBeUndefined();
    const target = { ...qc(), id: "later" };
    registerRuntimeConnection(target, {
      initialUrl: "https://example-nas.fr3.quickconnect.to/",
      redirectHops: 1,
      assertCurrent: vi.fn(),
    });
    view.rerender({
      connection: target,
      session: { ...session, connectionId: target.id },
    });
    expect(view.result.current.redirectBudget).toBeUndefined();
  });
  it.each([true, false])(
    "uses exact defaults from the original source across a %s saved chain",
    async (isSaved) => {
      const initial = qc();
      const view = fixture(initial, isSaved);
      const receipt = qcReview();
      const first = await view.result.current.inspect(receipt, vi.fn());
      expect(first).toMatchObject({
        trusted: true,
        defaultTrusted: true,
        synologySource: { originalOrigin: receipt.sourceOrigin, enabled: true },
      });
      expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
      const target = anonymousRedirectConnection(
        initial,
        receipt,
        withSynologyRedirectDefaults(
          initial.httpProxyPolicy!,
          view.result.current.defaults,
        ),
      );
      registerRuntimeConnection(target, {
        initialUrl: receipt.destinationUrl,
        redirectHops: 1,
        assertCurrent: first.assertLaunchCurrent!,
        trustedRedirectSource: first.provenance ?? undefined,
        synologyRedirectSource: first.synologySource,
      });
      view.rerender({
        connection: target,
        session: {
          ...session,
          connectionId: target.id,
          hostname: target.hostname,
          protocol: "http",
        },
      });
      const second = await view.result.current.inspect(
        qcReview(
          "http://example-nas.quickconnect.to",
          "https://global.quickconnect.to/",
        ),
        vi.fn(),
      );
      expect(second).toMatchObject({ trusted: true, defaultTrusted: true });
      expect(view.result.current.defaults?.originalOrigin).toBe(
        receipt.sourceOrigin,
      );
      expect(target.httpProxyPolicy?.allowCrossOriginRedirects).toBe(false);
      expect(target.httpProxyPolicy).not.toHaveProperty(
        "synologyQuickConnectDefaults",
      );
      expect(JSON.stringify(first.synologySource)).not.toContain("private");
    },
  );
  it("does not revive unsaved default opt-out after a manual portal handoff", async () => {
    const initial = {
      ...qc(),
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        useDefaultRedirectDestinations: false,
      },
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        allowCrossOriginRedirects: true,
      },
    };
    const view = fixture(initial, false);
    const receipt = qcReview(undefined, "https://global.quickconnect.to/");
    const first = await view.result.current.inspect(receipt, vi.fn());
    expect(first.trusted).toBe(false);
    expect(first.synologySource?.enabled).toBe(false);
    const target = anonymousRedirectConnection(initial, receipt);
    registerRuntimeConnection(target, {
      initialUrl: receipt.destinationUrl,
      redirectHops: 1,
      assertCurrent: vi.fn(),
      synologyRedirectSource: first.synologySource,
    });
    view.rerender({
      connection: target,
      session: {
        ...session,
        connectionId: target.id,
        hostname: target.hostname,
      },
    });
    expect(view.result.current.defaults).toBeUndefined();
    expect(
      (
        await view.result.current.inspect(
          qcReview(
            "https://global.quickconnect.to",
            "https://www.quickconnect.to/",
          ),
          vi.fn(),
        )
      ).trusted,
    ).toBe(false);
  });
  it("checks persisted defaults and rejects opt-out during a delayed inspection", async () => {
    const initial = qc();
    const view = fixture(initial);
    const pending = deferred<{ connections: Connection[] }>();
    view.readCurrent.mockImplementationOnce(() => pending.promise);
    const result = view.result.current.inspect(qcReview(), vi.fn());
    const disabled = {
      ...initial,
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        useDefaultRedirectDestinations: false,
      },
    };
    view.context.state.connections = [disabled];
    view.rerender({ connection: disabled, session });
    pending.resolve({ connections: [initial] });
    await expect(result).rejects.toThrow(/unavailable/);
    expect(view.result.current.defaults).toBeUndefined();
    view.persisted = { connections: [disabled] };
    const explicit = {
      ...disabled,
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        allowCrossOriginRedirects: true,
      },
      httpTrustedRedirectDestinations: grant([
        "https://global.quickconnect.to",
      ]),
    };
    view.context.state.connections = [explicit];
    view.persisted = { connections: [explicit] };
    view.rerender({ connection: explicit, session });
    expect(
      await view.result.current.inspect(
        qcReview(undefined, "https://global.quickconnect.to/"),
        vi.fn(),
      ),
    ).toMatchObject({ trusted: true, defaultTrusted: false });
  });
  it("establishes fresh direct-source authority after saved opt-out without reviving the old inspection", async () => {
    const initial = qc();
    const view = fixture(initial);
    const previous = await view.result.current.inspect(qcReview(), vi.fn());
    const disabled = {
      ...initial,
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        useDefaultRedirectDestinations: false,
      },
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        allowCrossOriginRedirects: true,
      },
      httpTrustedRedirectDestinations: grant([
        "https://global.quickconnect.to",
      ]),
    };
    view.context.state.connections = [disabled];
    view.persisted = { connections: [disabled] };
    view.rerender({ connection: disabled, session });
    expect(previous.assertCurrent).toThrow(/unavailable/);
    expect(
      await view.result.current.inspect(
        qcReview(undefined, "https://global.quickconnect.to/"),
        vi.fn(),
      ),
    ).toMatchObject({ trusted: true, defaultTrusted: false });
  });
  it("matches hydrated creation timestamps without dropping creation identity or invalid distinctions", () => {
    const original = httpRedirectTrustIdentity(source);
    for (const createdAt of [
      "2026-09-10T00:00:00.000Z",
      "2026-09-10T01:00:00+01:00",
      new Date("2026-09-10"),
    ]) {
      expect(
        httpRedirectTrustIdentity({ ...source, createdAt } as Connection),
      ).toBe(original);
    }
    const distinct = [
      "2026-09-11",
      "invalid-creation-one",
      "invalid-creation-two",
      undefined,
      null,
    ].map((createdAt) =>
      httpRedirectTrustIdentity({ ...source, createdAt } as Connection),
    );
    expect(new Set([original, ...distinct]).size).toBe(distinct.length + 1);
  });
  it("establishes reference-only original provenance even with no trusted destinations", async () => {
    const view = fixture();
    const result = await view.result.current.inspect(review, vi.fn());
    expect(result).toMatchObject({
      trusted: false,
      provenance: {
        databaseId: "db-a",
        savedConnectionId: source.id,
        originalOrigin: "https://source.invalid",
      },
    });
    expect(result.assertCurrent).not.toThrow();
    expect(JSON.stringify(result.provenance)).not.toContain("private-");
    expect(view.result.current.revision).toMatch(/^\d+$/);
    expect(view.result.current.canRemember).toBe(true);
    expect(view.readCurrent).toHaveBeenCalledOnce();
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])(
    "requires exact persisted membership and ignores legacy automatic setting %s",
    async (autoContinue) => {
      const view = fixture({
        ...source,
        httpTrustedRedirectDestinations: grant(undefined, autoContinue),
      });
      expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
        trusted: true,
      });
      expect(
        await view.result.current.inspect(
          { ...review, destinationUrl: "https://other.invalid/" },
          vi.fn(),
        ),
      ).toMatchObject({ trusted: false });
      view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
        undefined,
        false,
      );
      view.context.state.connections[0] = {
        ...source,
        httpTrustedRedirectDestinations: grant(undefined, false),
      };
      expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
        trusted: true,
      });
    },
  );

  it("does not approve optimistic additions or pending revocations that disagree with durable storage", async () => {
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(),
    });
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
      [],
      false,
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant();
    view.context.state.connections[0] = {
      ...source,
      httpTrustedRedirectDestinations: grant([], false),
    };
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
  });

  it("revokes a captured inspection synchronously when the grant list changes", async () => {
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(),
    });
    const inspection = await view.result.current.inspect(review, vi.fn());
    const revision = view.result.current.revision;
    view.context.state.connections[0] = {
      ...source,
      httpTrustedRedirectDestinations: grant([], false),
    };
    expect(inspection.assertCurrent).toThrow(
      "Trusted redirect preferences are unavailable",
    );
    view.rerender({ connection: view.context.state.connections[0], session });
    expect(view.result.current.revision).not.toBe(revision);
  });

  it.each(["lease", "grant", "credential", "runtime", "database-generation"])(
    "allows an intentional transport stop but rejects later %s changes before launch",
    async (change) => {
      const saved = { ...source, httpTrustedRedirectDestinations: grant() };
      const view = fixture(saved);
      let stopped = false;
      const transport = () => {
        if (stopped) throw new Error("proxy stopped");
      };
      const inspection = await view.result.current.inspect(review, transport);
      stopped = true;
      expect(inspection.assertCurrent).toThrow("proxy stopped");
      expect(inspection.assertLaunchCurrent).toBeTypeOf("function");
      expect(inspection.assertLaunchCurrent).not.toThrow();
      if (change === "lease") view.changeLease();
      if (change === "grant")
        view.context.state.connections[0] = {
          ...source,
          httpTrustedRedirectDestinations: grant([], false),
        };
      if (change === "credential")
        view.context.state.connections[0] = {
          ...saved,
          basicAuthPassword: "changed",
        };
      if (change === "runtime")
        view.rerender({
          connection: { ...saved, id: "another-runtime" },
          session,
        });
      if (change === "database-generation") {
        view.context.databaseAvailability = {
          ...view.context.databaseAvailability,
          generation: 2,
        };
        view.rerender({ connection: saved, session });
      }
      expect(inspection.assertLaunchCurrent).toThrow();
    },
  );

  it.each([false, true])(
    "flushes, appends only to the original saved source, and discards legacy autoContinue=%s in both stores",
    async (autoContinue) => {
      const view = fixture({
        ...source,
        httpTrustedRedirectDestinations: grant(
          ["https://existing.invalid"],
          autoContinue,
        ),
      });
      await act(() => view.result.current.remember(review, vi.fn()));
      expect(view.flush).toHaveBeenCalledOnce();
      expect(view.flush.mock.invocationCallOrder[0]).toBeLessThan(
        view.context.dispatchAndFlush.mock.invocationCallOrder[0],
      );
      expect(view.context.dispatchAndFlush).toHaveBeenCalledWith({
        type: "UPDATE_CONNECTION",
        payload: {
          ...source,
          httpTrustedRedirectDestinations: grant([
            "https://existing.invalid",
            "https://destination.invalid",
          ]),
        },
      });
      expect(view.persisted.connections[0].basicAuthPassword).toBe(
        source.basicAuthPassword,
      );
      expect(view.readCurrent).toHaveBeenCalledTimes(3);
    },
  );

  it("denies automatic launch after unmount even if the old immutable Context snapshot survives", async () => {
    const saved = { ...source, httpTrustedRedirectDestinations: grant() };
    const view = fixture(saved);
    const inspection = await view.result.current.inspect(review, vi.fn());
    expect(inspection.assertLaunchCurrent).not.toThrow();
    view.unmount();
    h.context = {
      ...view.context,
      state: {
        connections: [
          { ...source, httpTrustedRedirectDestinations: grant([], false) },
        ],
      },
    };
    expect(
      view.context.state.connections[0].httpTrustedRedirectDestinations
        ?.origins,
    ).toEqual(["https://destination.invalid"]);
    expect(inspection.assertLaunchCurrent).toThrow(
      "Trusted redirect preferences are unavailable",
    );
    // Later legitimate hops must re-read this source through their own adapter;
    // source unmount is not a database lease revocation.
    expect(inspection.provenance?.assertOwner).not.toThrow();
    expect(() => inspection.provenance?.assertIdentity(saved)).not.toThrow();
  });

  it("reports failed durable saves without granting from the retained optimistic state", async () => {
    const view = fixture();
    view.context.dispatchAndFlush.mockImplementationOnce(async (action) => {
      view.context.state.connections = [action.payload];
      throw new Error("private password-bearing storage diagnostic");
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "could not be verified as saved",
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations,
    ).toBeUndefined();
  });

  it("requires authoritative readback even when the write reports success", async () => {
    const view = fixture();
    view.context.dispatchAndFlush.mockImplementationOnce(async (action) => {
      view.context.state.connections = [action.payload];
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "could not be verified as saved",
    );
  });

  it("offers actionable full-list guidance without changing automatic continuation", async () => {
    const origins = Array.from(
      { length: 32 },
      (_, index) => `https://destination${index}.invalid`,
    );
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(origins, false),
    });
    expect(view.result.current.canRemember).toBe(false);
    expect(view.result.current.unavailableReason).toContain(
      "Remove an unused destination",
    );
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "32 trusted redirect destinations",
    );
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations
        ?.autoContinue,
    ).toBe(false);
  });

  it.each(["remove", "add"])(
    "does not acknowledge a concurrent renderer grant %s during readback",
    async (change) => {
      const view = fixture();
      const originalRead = view.readCurrent.getMockImplementation()!;
      view.readCurrent.mockImplementation(async () => {
        const data = await originalRead();
        if (view.context.dispatchAndFlush.mock.calls.length) {
          view.context.state.connections = [
            {
              ...source,
              httpTrustedRedirectDestinations: grant(
                change === "remove"
                  ? []
                  : [
                      "https://destination.invalid",
                      "https://concurrent.invalid",
                    ],
                false,
              ),
            },
          ];
        }
        return data;
      });
      await expect(
        view.result.current.remember(review, vi.fn()),
      ).rejects.toThrow("could not be verified as saved");
    },
  );

  it("single-flights a separate Remember action and cancels on the original lease ABA", async () => {
    const view = fixture();
    const flush = deferred<void>();
    view.flush.mockImplementationOnce(() => flush.promise);
    const pending = view.result.current.remember(review, vi.fn());
    await vi.waitFor(() => expect(view.flush).toHaveBeenCalledOnce());
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "already in progress",
    );
    view.changeLease("db-b");
    view.changeLease("db-a");
    flush.resolve();
    await expect(pending).rejects.toThrow("could not be verified as saved");
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it.each(["lease", "credential", "navigation"])(
    "refuses stale %s after an awaited persisted read",
    async (change) => {
      const view = fixture();
      let navigated = false;
      const assertCurrent = () => {
        if (navigated) throw new Error("stale receipt");
      };
      const read = deferred<{ connections: Connection[] }>();
      view.readCurrent.mockImplementationOnce(() => read.promise);
      const pending = view.result.current.inspect(review, assertCurrent);
      if (change === "lease") view.changeLease();
      if (change === "credential")
        view.context.state.connections[0] = {
          ...source,
          basicAuthPassword: "replacement-secret",
        };
      if (change === "navigation") navigated = true;
      read.resolve(view.persisted);
      await expect(pending).rejects.toThrow(
        "Trusted redirect preferences are unavailable",
      );
      expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );

  it("retains the first saved source across later anonymous hops without freezing its old grant list", async () => {
    const view = fixture();
    const first = await view.result.current.inspect(review, vi.fn());
    const middle = anonymousRedirectConnection(source, review);
    registerRuntimeConnection(middle, {
      initialUrl: review.destinationUrl,
      redirectHops: 1,
      assertCurrent: vi.fn(),
      trustedRedirectSource: first.provenance!,
    });
    const laterReview = {
      ...review,
      sourceOrigin: "https://destination.invalid",
      destinationUrl: "https://last.invalid/ui/",
    };
    const middleSession = {
      ...session,
      connectionId: middle.id,
      hostname: middle.hostname,
    };
    view.unmount();
    const later = renderHook(() => useHttpRedirectTrust(middleSession, middle));
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
      ["https://last.invalid"],
      false,
    );
    view.context.state.connections[0] = structuredClone(
      view.persisted.connections[0],
    );
    expect(
      await later.result.current.inspect(laterReview, vi.fn()),
    ).toMatchObject({
      trusted: true,
      provenance: first.provenance,
    });
    await later.result.current.remember(
      { ...laterReview, destinationUrl: "https://new.invalid/" },
      vi.fn(),
    );
    expect(view.context.dispatchAndFlush.mock.calls[0][0].payload.id).toBe(
      source.id,
    );
    expect(view.persisted.connections).toHaveLength(1);
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations?.origins,
    ).toEqual(["https://last.invalid", "https://new.invalid"]);
    view.changeLease();
    await expect(
      later.result.current.inspect(laterReview, vi.fn()),
    ).rejects.toThrow("Trusted redirect preferences are unavailable");
  });

  it("does not infer a saved source for Quick Connect by matching hostname or active database", async () => {
    const view = fixture();
    const quick = { ...source, id: "runtime-quick" };
    registerRuntimeConnection(quick);
    view.rerender({
      connection: quick,
      session: { ...session, connectionId: quick.id },
    });
    expect(view.result.current.canRemember).toBe(false);
    expect(view.result.current.unavailableReason).toContain(
      "Save this connection",
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
      provenance: null,
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "Save this connection",
    );
    expect(view.readCurrent).not.toHaveBeenCalled();
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it("rejects a same-ID source from a different owner and malformed persisted preferences", async () => {
    const view = fixture();
    view.changeLease("db-b");
    await expect(view.result.current.inspect(review, vi.fn())).rejects.toThrow(
      "Trusted redirect preferences are unavailable",
    );
    view.changeLease("db-a");
    view.persisted.connections[0].httpTrustedRedirectDestinations = {
      ...grant(),
      untrusted: "private-secret",
    } as ReturnType<typeof grant>;
    await expect(view.result.current.inspect(review, vi.fn())).rejects.toThrow(
      /^Trusted redirect preferences are unavailable/,
    );
  });

  it("compares canonical persisted identities without exposing secrets or reacting to bookkeeping", async () => {
    const view = fixture();
    const inspection = await view.result.current.inspect(review, vi.fn());
    const revision = view.result.current.revision;
    const reordered = {
      ...source,
      hostname: "https://SOURCE.invalid:443",
      lastConnected: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11",
      connectionCount: 7,
    };
    expect(httpRedirectTrustIdentity(reordered)).toBe(
      httpRedirectTrustIdentity(source),
    );
    view.context.state.connections[0] = reordered;
    view.rerender({ connection: reordered, session });
    expect(inspection.assertCurrent).not.toThrow();
    expect(view.result.current.revision).toBe(revision);
    expect(() => httpRedirectConnectionOrigin({ ...source, port: 0 })).toThrow(
      "port",
    );
    expect(() =>
      httpRedirectConnectionOrigin({
        ...source,
        hostname: "http://source.invalid",
      }),
    ).toThrow("origin");
  });
});
