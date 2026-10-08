import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveQuickConnectTarget } from "../../src/hooks/connection/useQuickConnect";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { createQuickConnectConnection } from "../../src/utils/session/quickConnectConnection";
import {
  clearRuntimeConnectionsForTests,
  getQuickConnectConnection,
  registerQuickConnectConnection,
  registerRuntimeConnection,
  releaseRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { serializePersistedConnectionSession } from "../../src/utils/session/sessionPersistence";
import * as runtimeRegistry from "../../src/utils/session/runtimeConnectionRegistry";
import { useSessionManager } from "../../src/hooks/session/useSessionManager";
import type { SessionReconnectRequest } from "../../src/hooks/session/useSessionLifecycleEvents";

const sessionMocks = vi.hoisted(() => ({
  state: {
    connections: [] as Connection[],
    sessions: [] as ConnectionSession[],
  },
  settings: { maxConcurrentConnections: 10, retryAttempts: 2, retryDelay: 0 },
  dispatch: vi.fn(),
  emitStarted: vi.fn(),
  prepareEvent: vi.fn(),
  executeScripts: vi.fn(),
  capabilities: vi.fn(),
  requestReconnect: undefined as
    ((request: SessionReconnectRequest) => Promise<boolean>) | undefined,
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: sessionMocks.state,
    dispatch: sessionMocks.dispatch,
  }),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () => sessionMocks.settings,
      logAction: vi.fn(),
    }),
  },
}));
vi.mock("../../src/utils/connection/statusChecker", () => ({
  StatusChecker: {
    getInstance: () => ({ startChecking: vi.fn(), stopChecking: vi.fn() }),
  },
}));
vi.mock("../../src/utils/recording/scriptEngine", () => ({
  ScriptEngine: {
    getInstance: () => ({
      executeScriptsForTrigger: sessionMocks.executeScripts,
    }),
  },
}));
vi.mock("../../src/utils/runtime/runtimeCapabilities", () => ({
  loadRuntimeCapabilities: sessionMocks.capabilities,
  getRuntimeProtocolUnavailableMessage: () => null,
}));
vi.mock("../../src/utils/behavior/windowActions", () => ({
  BehaviorWindowActionRuntime: class {},
}));
vi.mock("../../src/hooks/session/useSessionLifecycleEvents", () => ({
  useSessionLifecycleEvents: (options: {
    requestReconnect: typeof sessionMocks.requestReconnect;
  }) => {
    sessionMocks.requestReconnect = options.requestReconnect;
    return {
      emitStarted: sessionMocks.emitStarted,
      prepareEvent: sessionMocks.prepareEvent,
      emitInitialStatus: vi.fn(),
      emitWindowSignal: vi.fn(),
    };
  },
}));

const protocols = [
  ["ssh", 22, 2222],
  ["rdp", 3389, 3390],
  ["vnc", 5900, 5901],
  ["telnet", 23, 2323],
  ["http", 80, 8080],
  ["https", 443, 8443],
] as const;

afterEach(() => {
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Quick Connect endpoint construction", () => {
  it.each(protocols)(
    "uses the %s default only when no port is supplied",
    (protocol, port) => {
      expect(
        createQuickConnectConnection(
          { hostname: "  server.example.test  ", protocol },
          "Quick Connect",
        ),
      ).toMatchObject({
        hostname: "server.example.test",
        port,
        protocol,
        isGroup: false,
      });
    },
  );

  it.each(protocols)(
    "separates explicit %s ports before native launch",
    (protocol, _defaultPort, port) => {
      for (const hostname of ["server.example.test", "192.0.2.10"]) {
        expect(
          createQuickConnectConnection(
            { hostname: `${hostname}:${port}`, protocol },
            "Quick Connect",
          ),
        ).toMatchObject({
          hostname,
          port,
          name: `Quick Connect - ${hostname}:${port}`,
        });
      }
    },
  );

  it.each(protocols)(
    "preserves the %s port kept by URL normalization",
    (protocol, _defaultPort, port) => {
      const target = deriveQuickConnectTarget(
        `${protocol}://server.example.test:${port}`,
        "https",
      );
      expect(target).toBeDefined();
      expect(
        createQuickConnectConnection(
          { hostname: target!.hostname, protocol: target!.protocol ?? "https" },
          "Quick Connect",
        ),
      ).toMatchObject({ hostname: "server.example.test", port, protocol });
    },
  );

  it.each([
    ["[2001:db8::1]:2222", "2001:db8::1", 2222],
    ["[2001:db8::1]", "2001:db8::1", 22],
    ["2001:db8::2222", "2001:db8::2222", 22],
    ["::1", "::1", 22],
    ["[::ffff:192.0.2.10]:2222", "::ffff:192.0.2.10", 2222],
    ["[fe80::1%12]:2222", "fe80::1%12", 2222],
    ["fe80::1%12", "fe80::1%12", 22],
    ["server:1", "server", 1],
    ["server:65535", "server", 65535],
    ["server:002222", "server", 2222],
  ])(
    "parses %s without confusing IPv6 and port syntax",
    (address, hostname, port) => {
      expect(
        createQuickConnectConnection(
          { hostname: address, protocol: "ssh" },
          "Quick Connect",
        ),
      ).toMatchObject({ hostname, port });
    },
  );

  it.each([
    "",
    "0",
    "65536",
    "-1",
    "+22",
    "1.5",
    "2e3",
    "abc",
    "22junk",
    "0x16",
  ])(
    "rejects an explicit invalid port %j instead of using a default",
    (port) => {
      for (const hostname of ["server", "[::1]"]) {
        expect(() =>
          createQuickConnectConnection(
            { hostname: `${hostname}:${port}`, protocol: "ssh" },
            "Quick Connect",
          ),
        ).toThrow("Quick Connect port must be an integer from 1 to 65535.");
      }
    },
  );

  it.each([
    "",
    "  ",
    ":2222",
    "[::1",
    "::1]",
    "[]:22",
    "[server]:22",
    "[::1]extra",
    "server:22:33",
    "server name",
    "server\nname",
    "user:secret@server:22",
    "server/path",
    "server?query",
    "server#fragment",
    "server\\path",
  ])("rejects malformed endpoint %j before registration", (hostname) => {
    expect(() =>
      createQuickConnectConnection(
        { hostname, protocol: "ssh" },
        "Quick Connect",
      ),
    ).toThrow();
  });

  it.each(["ftp", "unknown", ""])(
    "rejects unsupported protocol %s",
    (protocol) => {
      expect(() =>
        createQuickConnectConnection(
          { hostname: "server", protocol },
          "Quick Connect",
        ),
      ).toThrow("only supports SSH, RDP, VNC, Telnet, HTTP, and HTTPS");
    },
  );
});

describe("Quick Connect runtime credentials", () => {
  it.each([undefined, true, false])(
    "preserves the HTTPS verify choice %s without granting trust",
    (verify) => {
      const connection = createQuickConnectConnection(
        {
          hostname: "[2001:db8::1]:8443",
          protocol: "https",
          httpVerifySsl: verify,
        },
        "Quick Connect",
      );
      expect(connection).toMatchObject({
        hostname: "2001:db8::1",
        port: 8443,
        httpVerifySsl: verify ?? true,
      });
      expect(connection).not.toHaveProperty("httpsTrustPolicy");
      expect(connection).not.toHaveProperty("authType");
      expect(
        createQuickConnectConnection(
          { hostname: "server", protocol: "http", httpVerifySsl: false },
          "Quick Connect",
        ),
      ).not.toHaveProperty("httpVerifySsl");
    },
  );

  it.each(protocols)(
    "preserves bracketed IPv6 and its explicit %s URL port through the builder",
    (protocol, _defaultPort, port) => {
      const target = deriveQuickConnectTarget(
        `${protocol}://[2001:db8::1]:${port}/path`,
        "rdp",
      )!;
      expect(
        createQuickConnectConnection(
          { hostname: target.hostname, protocol: target.protocol ?? "rdp" },
          "Quick Connect",
        ),
      ).toMatchObject({ hostname: "2001:db8::1", port, protocol });
    },
  );

  it.each(["", "0", "65536", "abc"])(
    "does not lose invalid IPv6 URL port %j during normalisation",
    (port) => {
      const target = deriveQuickConnectTarget(
        `https://[::1]:${port}/path`,
        "rdp",
      )!;
      expect(() =>
        createQuickConnectConnection(
          { hostname: target.hostname, protocol: target.protocol! },
          "Quick Connect",
        ),
      ).toThrow("port must be an integer");
    },
  );

  it.each([
    [
      "ssh",
      {
        username: "operator",
        password: " password ",
        authType: "key",
        privateKey: "PRIVATE KEY\n",
        passphrase: " passphrase ",
      },
    ],
    [
      "rdp",
      { username: "operator", password: " password ", domain: "EXAMPLE" },
    ],
    ["vnc", { password: " password " }],
    ["telnet", { username: "operator", password: " password " }],
    [
      "http",
      {
        authType: "basic",
        basicAuthUsername: "web-operator",
        basicAuthPassword: "web-secret",
      },
    ],
    [
      "https",
      {
        authType: "basic",
        basicAuthUsername: "web-operator",
        basicAuthPassword: "web-secret",
        httpVerifySsl: true,
      },
    ],
  ])("retains only the credential fields used by %s", (protocol, expected) => {
    const payload = Object.freeze({
      hostname: "server:2222",
      protocol,
      username: "operator",
      password: " password ",
      domain: "EXAMPLE",
      authType: "key" as const,
      privateKey: "PRIVATE KEY\n",
      passphrase: " passphrase ",
      basicAuthUsername: "web-operator",
      basicAuthPassword: "web-secret",
      credentialSource: { kind: "vault" },
    });
    const connection = createQuickConnectConnection(
      payload,
      "Connexion rapide",
    );
    const {
      id,
      name,
      hostname,
      port,
      isGroup,
      createdAt,
      updatedAt,
      protocol: actualProtocol,
      ...credentials
    } = connection;
    expect(credentials).toEqual(expected);
    expect({ name, hostname, port, isGroup, protocol: actualProtocol }).toEqual(
      {
        name: "Connexion rapide - server:2222",
        hostname: "server",
        port: 2222,
        isGroup: false,
        protocol,
      },
    );
    expect(createdAt).toBe(updatedAt);
    expect(Number.isFinite(Date.parse(createdAt))).toBe(true);
    expect(id).toBeTruthy();
    expect(
      createQuickConnectConnection(payload, "Connexion rapide").id,
    ).not.toBe(id);
    expect(payload.hostname).toBe("server:2222");
    expect(resolveRuntimeConnection([], id)).toBeUndefined();
  });

  it.each(protocols)(
    "keeps %s credentials in runtime lookup until explicit release, without storage writes",
    (protocol) => {
      const localWrite = vi.spyOn(localStorage, "setItem");
      const sessionWrite = vi.spyOn(sessionStorage, "setItem");
      const connection = createQuickConnectConnection(
        {
          hostname: "server:2222",
          protocol,
          username: "operator",
          password: "runtime-secret",
          authType: "key",
          privateKey: "runtime-private-key",
          passphrase: "runtime-passphrase",
          basicAuthUsername: "web-operator",
          basicAuthPassword: "runtime-web-secret",
        },
        "Quick Connect",
      );
      registerQuickConnectConnection(connection);
      const session: ConnectionSession = {
        id: "quick-session",
        connectionId: connection.id,
        name: connection.name,
        hostname: connection.hostname,
        protocol,
        status: "connecting",
        startTime: new Date(),
      };

      expect(resolveRuntimeConnection([], session.connectionId)).toBe(
        connection,
      );
      session.status = "disconnected";
      expect(getQuickConnectConnection(session.connectionId)).toBe(connection);
      const credentialField =
        protocol === "http" || protocol === "https"
          ? "basicAuthPassword"
          : "password";
      expect(
        resolveRuntimeConnection([], session.connectionId)?.[credentialField],
      ).toBe(
        credentialField === "password"
          ? "runtime-secret"
          : "runtime-web-secret",
      );
      const persisted = serializePersistedConnectionSession(session);
      expect(persisted).not.toHaveProperty("password");
      expect(persisted).not.toHaveProperty("username");
      expect(persisted).not.toHaveProperty("privateKey");
      expect(persisted).not.toHaveProperty("passphrase");
      expect(JSON.stringify(persisted)).not.toContain("runtime-secret");
      expect(JSON.stringify(persisted)).not.toContain("runtime-private-key");
      expect(JSON.stringify(persisted)).not.toContain("runtime-passphrase");
      expect(JSON.stringify(persisted)).not.toContain("runtime-web-secret");
      releaseRuntimeConnection(session.connectionId);
      expect(
        resolveRuntimeConnection([], session.connectionId),
      ).toBeUndefined();
      expect(getQuickConnectConnection(session.connectionId)).toBeUndefined();
      expect(localWrite).not.toHaveBeenCalled();
      expect(sessionWrite).not.toHaveBeenCalled();
    },
  );
});

describe("Quick Connect session launch and reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.state = { connections: [], sessions: [] };
    sessionMocks.settings.maxConcurrentConnections = 10;
    sessionMocks.capabilities.mockReset().mockResolvedValue(undefined);
    sessionMocks.emitStarted.mockReset().mockResolvedValue(undefined);
    sessionMocks.executeScripts.mockReset().mockResolvedValue(undefined);
    sessionMocks.dispatch.mockImplementation(
      (action: { type: string; payload: ConnectionSession }) => {
        if (action.type === "ADD_SESSION")
          sessionMocks.state.sessions.push(action.payload);
        if (action.type === "UPDATE_SESSION") {
          sessionMocks.state.sessions = sessionMocks.state.sessions.map(
            (session) =>
              session.id === action.payload.id
                ? { ...session, ...action.payload }
                : session,
          );
        }
      },
    );
  });

  const payload = {
    hostname: "[2001:db8::1]:8443",
    protocol: "https",
    basicAuthUsername: "operator",
    basicAuthPassword: "runtime-secret",
    httpVerifySsl: false,
  };

  it.each(protocols)(
    "registers %s Quick Connect provenance before session creation without persisting credentials",
    async (protocol, _defaultPort, port) => {
      const register = vi.spyOn(
        runtimeRegistry,
        "registerQuickConnectConnection",
      );
      const localWrite = vi.spyOn(localStorage, "setItem");
      const sessionWrite = vi.spyOn(sessionStorage, "setItem");
      sessionMocks.emitStarted.mockImplementation(
        async (session: ConnectionSession) => {
          expect(getQuickConnectConnection(session.connectionId)).toBeDefined();
        },
      );
      const { result } = renderHook(() => useSessionManager());
      await act(async () => {
        await result.current.handleQuickConnect({
          ...payload,
          protocol,
          hostname: `[2001:db8::1]:${port}`,
        });
      });
      const connection = register.mock.calls[0][0];
      expect(connection).toMatchObject({
        protocol,
        hostname: "2001:db8::1",
        port,
      });
      expect(getQuickConnectConnection(connection.id)).toBe(connection);
      expect(sessionMocks.state.sessions).toHaveLength(1);
      expect(JSON.stringify(sessionMocks.state.sessions)).not.toContain(
        "runtime-secret",
      );
      expect(sessionMocks.state.connections).toEqual([]);
      expect(localWrite).not.toHaveBeenCalled();
      expect(sessionWrite).not.toHaveBeenCalled();
    },
  );

  it("releases a registration when connection limits cancel launch without creating a session", async () => {
    sessionMocks.settings.maxConcurrentConnections = 0;
    const register = vi.spyOn(
      runtimeRegistry,
      "registerQuickConnectConnection",
    );
    const { result } = renderHook(() => useSessionManager());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleQuickConnect(payload);
    });
    const connection = register.mock.calls[0][0];
    expect(getQuickConnectConnection(connection.id)).toBe(connection);
    await act(async () => {
      result.current.confirmDialog!.props.onConfirm();
      await pending;
    });
    expect(sessionMocks.state.sessions).toEqual([]);
    expect(resolveRuntimeConnection([], connection.id)).toBeUndefined();
    expect(getQuickConnectConnection(connection.id)).toBeUndefined();
  });

  it("releases a registration when launch throws before a session exists", async () => {
    sessionMocks.capabilities.mockRejectedValueOnce(
      new Error("private-runtime-secret"),
    );
    const register = vi.spyOn(
      runtimeRegistry,
      "registerQuickConnectConnection",
    );
    const { result } = renderHook(() => useSessionManager());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleQuickConnect(payload);
    });
    expect(
      getQuickConnectConnection(register.mock.calls[0][0].id),
    ).toBeUndefined();
    expect(result.current.confirmDialog!.props.message).not.toContain(
      "private-runtime-secret",
    );
    await act(async () => {
      result.current.confirmDialog!.props.onConfirm();
      await pending;
    });
  });

  it("retains a created session's definition when lifecycle throws before React publishes the session", async () => {
    // Dispatch has accepted ADD_SESSION but a React render has not exposed it.
    sessionMocks.dispatch.mockImplementation(() => undefined);
    sessionMocks.emitStarted.mockRejectedValueOnce(
      new Error("lifecycle failed"),
    );
    const register = vi.spyOn(
      runtimeRegistry,
      "registerQuickConnectConnection",
    );
    const { result } = renderHook(() => useSessionManager());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleQuickConnect(payload);
    });
    const connection = register.mock.calls[0][0];
    expect(sessionMocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_SESSION" }),
    );
    expect(sessionMocks.state.sessions).toEqual([]);
    expect(getQuickConnectConnection(connection.id)).toBe(connection);
    await act(async () => {
      result.current.confirmDialog!.props.onConfirm();
      await pending;
    });
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
  });

  it("rejects malformed endpoints before registering any runtime authority", async () => {
    const register = vi.spyOn(
      runtimeRegistry,
      "registerQuickConnectConnection",
    );
    const { result } = renderHook(() => useSessionManager());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleQuickConnect({
        ...payload,
        hostname: "[::1]:0",
      });
    });
    expect(register).not.toHaveBeenCalled();
    expect(sessionMocks.state.sessions).toEqual([]);
    await act(async () => {
      result.current.confirmDialog!.props.onConfirm();
      await pending;
    });
  });

  function disconnected(connection: Connection): ConnectionSession {
    return {
      id: "quick-session",
      connectionId: connection.id,
      protocol: connection.protocol,
      hostname: connection.hostname,
      name: connection.name,
      status: "disconnected",
      startTime: new Date(),
      maxReconnectAttempts: 2,
    };
  }

  it.each(["runtime", "saved"] as const)(
    "reconnects using the latest %s definition with saved precedence",
    async (source) => {
      vi.useFakeTimers();
      const original = createQuickConnectConnection(payload, "Quick Connect");
      registerQuickConnectConnection(original);
      const session = disconnected(original);
      sessionMocks.state.sessions = [session];
      const { result } = renderHook(() => useSessionManager());
      await act(async () => {
        await result.current.handleReconnect(session);
      });
      expect(sessionMocks.prepareEvent).toHaveBeenCalled();
      const current = { ...original, hostname: `${source}.example.test` };
      if (source === "saved") sessionMocks.state.connections = [current];
      else registerQuickConnectConnection(current);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(sessionMocks.state.sessions[0].status).toBe("reconnecting");
      expect(sessionMocks.executeScripts).toHaveBeenCalledWith(
        "onConnect",
        expect.objectContaining({
          connection: expect.objectContaining({ hostname: current.hostname }),
        }),
      );
    },
  );

  it("resolves runtime definitions for behavior reconnect requests and never revives a released definition", async () => {
    vi.useFakeTimers();
    const connection = createQuickConnectConnection(payload, "Quick Connect");
    registerQuickConnectConnection(connection);
    const session = disconnected(connection);
    sessionMocks.state.sessions = [session];
    renderHook(() => useSessionManager());
    const request: SessionReconnectRequest = {
      session,
      connection,
      action: { type: "reconnect", delayMs: 50, maxAttempts: 2 },
    };
    await act(async () => {
      expect(await sessionMocks.requestReconnect!(request)).toBe(true);
    });
    releaseRuntimeConnection(connection.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(sessionMocks.executeScripts).not.toHaveBeenCalled();
    expect(sessionMocks.state.sessions[0].status).toBe("disconnected");
    expect(await sessionMocks.requestReconnect!(request)).toBe(false);
  });

  it("keeps generic runtime redirects separate from explicit Quick Connect provenance", () => {
    const connection = createQuickConnectConnection(payload, "Quick Connect");
    registerRuntimeConnection(connection);
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
    expect(getQuickConnectConnection(connection.id)).toBeUndefined();
    registerQuickConnectConnection(connection);
    expect(getQuickConnectConnection(connection.id)).toBe(connection);
  });
});
