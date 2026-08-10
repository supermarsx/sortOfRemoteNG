import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  hasSessionLifecycleActorAttempt,
  resetSessionLifecycleAllocatorForTests,
} from "../../utils/session/sessionLifecycle";
import { resolveRuntimeNetworkPath } from "../../utils/network/resolveRuntimeNetworkPath";
import type { SessionVpnType } from "../../utils/network/vpnProviderCatalog";

const mocks = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = [];

    readonly buffer = {
      active: {
        length: 0,
        getLine: () => undefined,
      },
    };
    readonly _core = {
      renderService: {
        dimensions: { css: { cell: { width: 8 } } },
      },
    };
    readonly options: Record<string, unknown> = {};
    element: HTMLElement | null = null;
    cols = 80;
    rows = 24;
    private inputHandler: ((data: string) => Promise<void> | void) | null =
      null;

    constructor() {
      MockTerminal.instances.push(this);
    }

    loadAddon(): void {}
    onBell(): void {}
    onData(handler: (data: string) => Promise<void> | void) {
      this.inputHandler = handler;
      return { dispose: vi.fn() };
    }
    open(container: HTMLElement): void {
      this.element = container;
    }
    focus(): void {}
    reset = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    dispose(): void {}
    getSelection(): string {
      return "";
    }
    async emitInput(data: string): Promise<void> {
      await this.inputHandler?.(data);
    }
  }

  const idleMacroRecorder = {
    isRecording: false,
    steps: [],
    currentCommand: "",
    startRecording: vi.fn(),
    recordInput: vi.fn(),
    stopRecording: vi.fn(() => []),
  };
  const connection = {
    id: "connection-ssh-1",
    name: "SSH test",
    protocol: "ssh",
    hostname: "ssh.example.test",
    port: 22,
    username: "alice",
    password: "secret",
    authType: "password",
    isGroup: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const context = {
    state: { connections: [connection], sessions: [] },
    dispatch: vi.fn(),
  };
  const settingsContext = {
    settings: {} as Record<string, unknown>,
  };
  const createToast = () =>
    Object.assign(vi.fn(), {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    });
  const toast = createToast();
  const toastContext = { current: toast };
  const clipboard = {
    readText: vi.fn(async () => ""),
    writeText: vi.fn(async (_text: string) => undefined),
  };
  const confirmPaste = vi.fn((_message: string) => true);
  const listeners = new Map<string, (event: { payload: any }) => void>();
  const runtimePath = {
    protocol: "ssh" as const,
    transport: {
      vpnPreSteps: [] as Array<{
        vpnType: SessionVpnType;
        connectionId: string;
      }>,
      jump_hosts: [],
      proxy_config: null,
      proxy_chain: null,
      mixed_chain: null,
      openvpn_config: null,
    },
    rdpTunnel: null,
    snapshot: { version: 1 as const, transports: [], connectionIds: [] },
    redactionSecrets: [],
  };

  return {
    MockTerminal,
    connection,
    context,
    settingsContext,
    createToast,
    toast,
    toastContext,
    clipboard,
    confirmPaste,
    invoke: vi.fn(),
    addHistoryEntry: vi.fn(),
    listen: vi.fn(async (..._args: unknown[]) => vi.fn()),
    listeners,
    loadManagedScripts: vi.fn(async () => ({
      value: [],
      sanitized: false,
    })),
    macroRecorder: idleMacroRecorder,
    idleMacroRecorder,
    terminalConfig: {},
    connectionConfig: {},
    runtimePath,
  };
});

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mocks.listen(...args),
  emit: vi.fn(async () => undefined),
}));
vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.context,
}));
vi.mock("../../contexts/SettingsContext", () => ({
  useSettings: () => mocks.settingsContext,
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toastContext.current }),
}));
vi.mock("../recording/useTerminalRecorder", () => ({
  useTerminalRecorder: () => ({ isRecording: false }),
}));
vi.mock("../recording/useMacroRecorder", () => ({
  useMacroRecorder: () => mocks.macroRecorder,
}));
vi.mock("../../utils/recording/macroService", () => ({
  loadMacros: vi.fn(async () => []),
  saveMacro: vi.fn(async () => undefined),
  saveRecording: vi.fn(async () => undefined),
  replayMacro: vi.fn(async () => undefined),
}));
vi.mock("../../utils/recording/managedScriptPersistence", () => ({
  managedScriptsStore: {
    key: "managed-scripts-test",
    load: () => mocks.loadManagedScripts(),
  },
  resolveManagedScripts: (
    defaults: unknown[],
    persisted: unknown[] | undefined,
  ) => persisted ?? defaults,
}));
vi.mock("../../types/settings/settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../types/settings/settings")>();
  return {
    ...actual,
    mergeSSHTerminalConfig: () => mocks.terminalConfig,
    mergeSSHConnectionConfig: () => mocks.connectionConfig,
    defaultSSHConnectionConfig: mocks.connectionConfig,
  };
});
vi.mock("../../components/recording/ScriptManager", () => ({
  getDefaultScripts: () => [],
}));
vi.mock("../../utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: () => mocks.connection,
}));
vi.mock("../../utils/auth/trustStore", () => ({
  resolveEffectiveTrustPolicy: () => "always-trust",
  verifyIdentity: vi.fn(),
  trustIdentity: vi.fn(),
}));
vi.mock("../../utils/network/resolveRuntimeNetworkPath", () => ({
  resolveRuntimeNetworkPath: vi.fn(async () => mocks.runtimePath),
  formatRuntimeNetworkPathError: (error: unknown) => error,
}));
vi.mock("../../utils/errors/redact", () => ({
  redactSecrets: (value: string) => value,
}));
vi.mock("./useSSHCommandHistory", () => ({
  useSSHCommandHistory: () => ({
    addEntry: mocks.addHistoryEntry,
  }),
}));

import { useWebTerminal, type WebTerminalMgr } from "./useWebTerminal";

const mockedResolveRuntimeNetworkPath = vi.mocked(resolveRuntimeNetworkPath);

const session: ConnectionSession = {
  id: "frontend-ssh-1",
  connectionId: mocks.connection.id,
  name: mocks.connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: mocks.connection.hostname,
};

const emitTauriEvent = (event: string, payload: unknown) => {
  const listener = mocks.listeners.get(event);
  if (!listener) throw new Error(`Missing ${event} listener`);
  listener({ payload });
};

beforeEach(() => {
  resetSessionLifecycleAllocatorForTests();
  mocks.MockTerminal.instances.length = 0;
  mocks.context.dispatch.mockReset();
  mocks.invoke.mockReset();
  mocks.addHistoryEntry.mockReset();
  mocks.loadManagedScripts.mockClear();
  mocks.toast.mockClear();
  mocks.toast.error.mockClear();
  mocks.toast.info.mockClear();
  mocks.toast.success.mockClear();
  mocks.toast.warning.mockClear();
  mocks.toastContext.current = mocks.toast;
  mocks.clipboard.readText.mockReset();
  mocks.clipboard.readText.mockResolvedValue("");
  mocks.clipboard.writeText.mockReset();
  mocks.clipboard.writeText.mockResolvedValue(undefined);
  mocks.confirmPaste.mockReset();
  mocks.confirmPaste.mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: mocks.clipboard,
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: mocks.confirmPaste,
  });
  mocks.listeners.clear();
  mocks.listen.mockReset();
  mocks.listen.mockImplementation(async (...args: unknown[]) => {
    const [event, callback] = args as [
      string,
      (event: { payload: any }) => void,
    ];
    mocks.listeners.set(event, callback);
    return vi.fn(() => {
      if (mocks.listeners.get(event) === callback) {
        mocks.listeners.delete(event);
      }
    });
  });
  mocks.settingsContext.settings = {};
  delete (
    mocks.connection as typeof mocks.connection & { retryAttempts?: number }
  ).retryAttempts;
  delete (mocks.connection as typeof mocks.connection & { retryDelay?: number })
    .retryDelay;
  mocks.terminalConfig = {};
  mocks.idleMacroRecorder.recordInput.mockReset();
  mocks.macroRecorder = mocks.idleMacroRecorder;
  mocks.runtimePath.transport.vpnPreSteps = [];
  mockedResolveRuntimeNetworkPath.mockReset();
  mockedResolveRuntimeNetworkPath.mockResolvedValue(mocks.runtimePath);
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    const ownerId = String((args as { ownerId?: string } | undefined)?.ownerId);
    if (command === "acquire_vpn_leases") {
      return Promise.resolve({
        owner_id: ownerId,
        leases: [
          {
            vpn_type: "wireguard",
            connection_id: "wg-office",
            was_already_connected: false,
            already_owned: false,
            started_by_lifecycle: true,
            lease_count: 1,
          },
        ],
      });
    }
    if (command === "release_vpn_leases") {
      return Promise.resolve({
        owner_id: ownerId,
        released: [],
        errors: [],
      });
    }
    if (command === "connect_ssh") return Promise.resolve("backend-ssh-1");
    if (command === "start_shell") return Promise.resolve("shell-ssh-1");
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWebTerminal input lifecycle", () => {
  it("shows a persisted connected SSH session immediately while validating its backend actor", async () => {
    const fallbackInvoke = mocks.invoke.getMockImplementation();
    const pendingValidation = new Promise<boolean>(() => undefined);
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "is_session_alive") return pendingValidation;
      return fallbackInvoke?.(command, args);
    });
    const persistedSession: ConnectionSession = {
      ...session,
      status: "connected",
      backendSessionId: "backend-persisted-1",
      shellId: "shell-persisted-1",
    };
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(persistedSession);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);

    expect((model as WebTerminalMgr | null)?.status).toBe("connected");
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("is_session_alive", {
        sessionId: "backend-persisted-1",
      }),
    );
    expect((model as WebTerminalMgr | null)?.status).toBe("connected");
    expect(hasSessionLifecycleActorAttempt(persistedSession.id)).toBe(true);

    view.unmount();
    await waitFor(() =>
      expect(hasSessionLifecycleActorAttempt(persistedSession.id)).toBe(false),
    );
  });

  it("shows connecting from the first render until a deferred SSH attempt settles", async () => {
    let resolveConnect!: (sessionId: string) => void;
    const deferredConnect = new Promise<string>((resolve) => {
      resolveConnect = resolve;
    });
    const fallbackInvoke = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "connect_ssh") return deferredConnect;
      return fallbackInvoke?.(command, args);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "connect_ssh",
        expect.anything(),
      ),
    );
    expect((model as WebTerminalMgr | null)?.status).toBe("connecting");

    await act(async () => {
      resolveConnect("backend-ssh-1");
      await deferredConnect;
    });
    await waitFor(() => expect(model?.status).toBe("connected"));
  });

  it("restarts a superseded StrictMode SSH setup without stranding prompt waiters", async () => {
    const firstConnect = new Promise<string>(() => undefined);
    const fallbackInvoke = mocks.invoke.getMockImplementation();
    let connectCalls = 0;
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return connectCalls === 1
          ? firstConnect
          : Promise.resolve("backend-ssh-strict-replacement");
      }
      if (command === "start_shell") {
        return Promise.resolve("shell-ssh-strict-replacement");
      }
      return fallbackInvoke?.(command, args);
    });
    const rejectTrustPrompt = vi.fn();
    const rejectProxyCommand = vi.fn();
    let model: WebTerminalMgr | null = null;
    const Harness = ({ onResize }: { onResize: () => void }) => {
      model = useWebTerminal(session, onResize);
      return <div ref={model.containerRef} />;
    };
    const firstResize = vi.fn();
    const replacementResize = vi.fn();
    const view = render(
      <StrictMode>
        <Harness onResize={firstResize} />
      </StrictMode>,
    );

    await waitFor(() => expect(connectCalls).toBe(1));
    model!.sshTrustResolveRef.current = rejectTrustPrompt;
    model!.proxyCommandResolveRef.current = rejectProxyCommand;

    view.rerender(
      <StrictMode>
        <Harness onResize={replacementResize} />
      </StrictMode>,
    );

    await waitFor(() => expect(connectCalls).toBe(2));
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(rejectTrustPrompt).toHaveBeenCalledWith("reject");
    expect(rejectProxyCommand).toHaveBeenCalledWith(false);
    expect(model!.sshTrustResolveRef.current).toBeNull();
    expect(model!.proxyCommandResolveRef.current).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("start_shell", {
      sessionId: "backend-ssh-strict-replacement",
    });
  });

  it.each(["connect_ssh", "start_shell"] as const)(
    "moves a never-resolving %s attempt to a redacted timeout error",
    async (hungCommand) => {
      const fallbackInvoke = mocks.invoke.getMockImplementation();
      const neverSettles = new Promise<string>(() => undefined);
      mocks.invoke.mockImplementation((command: string, args?: unknown) => {
        if (command === hungCommand) return neverSettles;
        return fallbackInvoke?.(command, args);
      });
      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      let model: WebTerminalMgr | null = null;
      const Harness = () => {
        model = useWebTerminal(session);
        return <div ref={model.containerRef} />;
      };

      const view = render(<Harness />);
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith(
          hungCommand,
          expect.anything(),
        ),
      );
      const watchdogIndex = timeoutSpy.mock.calls.findIndex(
        ([, delay]) => typeof delay === "number" && delay >= 30_000,
      );
      expect(watchdogIndex).toBeGreaterThanOrEqual(0);
      const watchdogCallback = timeoutSpy.mock.calls[
        watchdogIndex
      ][0] as () => void;
      const watchdogTimer = timeoutSpy.mock.results[watchdogIndex]
        .value as ReturnType<typeof setTimeout>;

      await act(async () => {
        watchdogCallback();
        await Promise.resolve();
      });
      clearTimeout(watchdogTimer);

      expect((model as WebTerminalMgr | null)?.status).toBe("error");
      expect((model as WebTerminalMgr | null)?.sshFailure).toEqual(
        expect.objectContaining({
          kind: "timeout",
          summary:
            "SSH connection attempt timed out before the remote shell became ready.",
          technicalDetails:
            "SSH connection attempt timed out before the remote shell became ready.",
        }),
      );
      expect(
        (model as WebTerminalMgr | null)?.sshFailure?.technicalDetails,
      ).not.toContain("secret");
      expect(hasSessionLifecycleActorAttempt(session.id)).toBe(false);
      expect(mocks.context.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          lifecycleActorReservationId: undefined,
          status: "error",
          errorMessage:
            "SSH connection attempt timed out before the remote shell became ready.",
        }),
      });

      view.unmount();
      timeoutSpy.mockRestore();
    },
  );

  it("maps TCP socket keepalive independently from SSH keepalive", async () => {
    mocks.terminalConfig = {
      tcpOptions: {
        tcpKeepAlive: true,
        soKeepAlive: false,
      },
    };
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("connect_ssh", {
        config: expect.objectContaining({
          keep_alive_interval: 30,
          tcp_keepalive: false,
        }),
      }),
    );
    await waitFor(() => expect(model?.status).toBe("connected"));
  });

  it("keeps manual reconnect in reconnecting state and ignores the old actor's close", async () => {
    let connectCalls = 0;
    let resolveDisconnect!: () => void;
    const deferredDisconnect = new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return Promise.resolve(
          connectCalls === 1 ? "backend-ssh-old" : "backend-ssh-new",
        );
      }
      if (command === "start_shell") {
        return Promise.resolve(
          connectCalls === 1 ? "shell-ssh-old" : "shell-ssh-new",
        );
      }
      if (command === "disconnect_ssh") return deferredDisconnect;
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await waitFor(() =>
      expect(mocks.listeners.has("ssh-shell-closed")).toBe(true),
    );

    let reconnect!: Promise<void>;
    act(() => {
      reconnect = model!.handleReconnect();
    });
    await waitFor(() => expect(model?.status).toBe("reconnecting"));
    await act(async () => {
      await model!.handleReconnect();
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(1);
    act(() => {
      emitTauriEvent("ssh-shell-closed", {
        session_id: "backend-ssh-old",
        reason: "requested",
        recoverable: false,
        message: null,
      });
    });
    expect((model as WebTerminalMgr | null)?.status).toBe("reconnecting");

    await act(async () => {
      resolveDisconnect();
      await reconnect;
    });
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(connectCalls).toBe(2);
    expect(mocks.MockTerminal.instances).toHaveLength(1);

    act(() => {
      emitTauriEvent("ssh-error", {
        session_id: "backend-ssh-old",
        message: "stale transport read",
      });
      emitTauriEvent("ssh-shell-closed", {
        session_id: "backend-ssh-old",
        reason: "transport_error",
        recoverable: true,
        message: "stale transport read",
      });
    });
    await act(async () => Promise.resolve());
    expect((model as WebTerminalMgr | null)?.status).toBe("connected");
    expect(connectCalls).toBe(2);
    expect(
      mocks.MockTerminal.instances[0].writeln.mock.calls.flat().join("\n"),
    ).not.toContain("Shell closed");
  });

  it("automatically replaces a recoverably closed actor while preserving the frontend session", async () => {
    mocks.settingsContext.settings = {
      autoReconnectOnDisconnect: true,
      autoReconnectMaxAttempts: 3,
      autoReconnectDelaySecs: 0,
    };
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryAttempts = 3;
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryDelay = 0;
    let connectCalls = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return Promise.resolve(
          connectCalls === 1 ? "backend-ssh-old" : "backend-ssh-new",
        );
      }
      if (command === "start_shell") {
        return Promise.resolve(
          connectCalls === 1 ? "shell-ssh-old" : "shell-ssh-new",
        );
      }
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await waitFor(() =>
      expect(mocks.listeners.has("ssh-shell-closed")).toBe(true),
    );

    act(() => {
      emitTauriEvent("ssh-error", {
        session_id: "backend-ssh-old",
        message: "transport read",
      });
      emitTauriEvent("ssh-shell-closed", {
        session_id: "backend-ssh-old",
        reason: "transport_error",
        recoverable: true,
        message: "transport read",
      });
    });

    await waitFor(() => expect(connectCalls).toBe(2));
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(mocks.MockTerminal.instances).toHaveLength(1);
    expect(
      mocks.context.dispatch.mock.calls
        .map(([action]) => action.payload)
        .filter(Boolean)
        .every((payload) => payload.id === session.id),
    ).toBe(true);
    expect(
      mocks.MockTerminal.instances[0].writeln.mock.calls.flat().join("\n"),
    ).not.toContain("Shell closed");
  });

  it("uses per-connection exponential delays and caps runtime reconnect scheduling", async () => {
    mocks.settingsContext.settings = {
      autoReconnectOnDisconnect: true,
      autoReconnectMaxAttempts: 9,
      autoReconnectDelaySecs: 2,
      autoReconnectBackoff: "exponential",
      autoReconnectMaxDelaySecs: 12,
    };
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryAttempts = 3;
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryDelay = 5_000;

    let connectCalls = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return connectCalls === 1
          ? Promise.resolve("backend-ssh-old")
          : Promise.reject(new Error("transport read"));
      }
      if (command === "start_shell") return Promise.resolve("shell-ssh-old");
      return Promise.resolve(undefined);
    });

    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await waitFor(() =>
      expect(mocks.listeners.has("ssh-shell-closed")).toBe(true),
    );

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const runReconnectTimer = async (delayMs: number) => {
      const callIndex = timeoutSpy.mock.calls.findIndex(
        ([, delay]) => delay === delayMs,
      );
      expect(callIndex).toBeGreaterThanOrEqual(0);
      const [callback] = timeoutSpy.mock.calls[callIndex];
      clearTimeout(
        timeoutSpy.mock.results[callIndex].value as ReturnType<
          typeof setTimeout
        >,
      );
      await act(async () => {
        (callback as () => void)();
        await Promise.resolve();
      });
    };

    act(() => {
      emitTauriEvent("ssh-shell-closed", {
        session_id: "backend-ssh-old",
        reason: "transport_error",
        recoverable: true,
        message: "transport read",
      });
    });
    await waitFor(() => {
      expect(model?.sshFailure).toMatchObject({
        retryScheduled: true,
        retryAttempt: 1,
        maxRetryAttempts: 3,
        retryDelaySeconds: 5,
      });
    });

    await runReconnectTimer(5_000);
    await waitFor(() => {
      expect(model?.sshFailure).toMatchObject({
        retryScheduled: true,
        retryAttempt: 2,
        retryDelaySeconds: 10,
      });
    });

    await runReconnectTimer(10_000);
    await waitFor(() => {
      expect(model?.sshFailure).toMatchObject({
        retryScheduled: true,
        retryAttempt: 3,
        retryDelaySeconds: 12,
      });
    });

    view.unmount();
    timeoutSpy.mockRestore();
  });

  it("does not start an automatic loop when manual retry follows an initial failure", async () => {
    mocks.settingsContext.settings = {
      autoReconnectOnDisconnect: true,
      autoReconnectMaxAttempts: 3,
      autoReconnectDelaySecs: 1,
    };
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryAttempts = 3;
    (
      mocks.connection as typeof mocks.connection & {
        retryAttempts?: number;
        retryDelay?: number;
      }
    ).retryDelay = 0;
    let connectCalls = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return Promise.reject(new Error("transport read"));
      }
      return Promise.resolve(undefined);
    });

    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("error"));
    expect(connectCalls).toBe(1);

    await act(async () => {
      await model!.handleReconnect();
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(connectCalls).toBe(2);
    expect((model as WebTerminalMgr | null)?.status).toBe("error");
    expect((model as WebTerminalMgr | null)?.sshFailure?.retryScheduled).toBe(
      false,
    );
  });

  it("never auto-reconnects after an explicit disconnect", async () => {
    mocks.settingsContext.settings = {
      autoReconnectOnDisconnect: true,
      autoReconnectMaxAttempts: 3,
      autoReconnectDelaySecs: 0,
    };
    let connectCalls = 0;
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "connect_ssh") {
        connectCalls += 1;
        return Promise.resolve("backend-ssh-1");
      }
      if (command === "start_shell") return Promise.resolve("shell-ssh-1");
      if (command === "disconnect_ssh") {
        emitTauriEvent("ssh-shell-closed", {
          session_id: (args as { sessionId: string }).sessionId,
          reason: "requested",
          recoverable: false,
          message: null,
        });
      }
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await act(async () => {
      await model?.disconnectSsh();
    });
    await waitFor(() => expect(model?.status).toBe("idle"));
    await act(
      async () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        }),
    );
    expect(connectCalls).toBe(1);
  });

  it("uses the latest macro recorder without rebuilding the terminal", async () => {
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(mocks.MockTerminal.instances).toHaveLength(1);

    const activeRecordInput = vi.fn();
    mocks.macroRecorder = {
      ...mocks.idleMacroRecorder,
      isRecording: true,
      recordInput: activeRecordInput,
    };
    view.rerender(<Harness />);
    await act(async () => Promise.resolve());

    expect(mocks.MockTerminal.instances).toHaveLength(1);
    await act(async () => {
      await mocks.MockTerminal.instances[0].emitInput("whoami");
    });
    expect(activeRecordInput).toHaveBeenCalledWith("whoami");
    expect(mocks.idleMacroRecorder.recordInput).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("send_ssh_input", {
      sessionId: "backend-ssh-1",
      data: "whoami",
    });
    expect(mocks.addHistoryEntry).not.toHaveBeenCalled();
  });

  it("keeps clipboard callbacks stable while reporting through the latest toast", async () => {
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(mocks.MockTerminal.instances).toHaveLength(1);

    const latestToast = mocks.createToast();
    mocks.toastContext.current = latestToast;
    view.rerender(<Harness />);
    await act(async () => Promise.resolve());

    expect(mocks.MockTerminal.instances).toHaveLength(1);
    mocks.clipboard.readText.mockRejectedValueOnce(new Error("read denied"));
    await expect(model!.pasteFromClipboard()).resolves.toBe(false);
    expect(latestToast.error).toHaveBeenCalledWith(
      "Failed to read from the clipboard",
      3000,
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("keeps ordinary xterm input outside clipboard policy", async () => {
    mocks.settingsContext.settings = {
      trimPastedWhitespace: true,
      warnOnMultiLinePaste: true,
      maxPasteLengthChars: 1,
    };
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await act(async () => {
      await mocks.MockTerminal.instances[0].emitInput("  typed\ninput  ");
    });

    expect(mocks.confirmPaste).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("send_ssh_input", {
      sessionId: "backend-ssh-1",
      data: "  typed\ninput  ",
    });
  });

  it("uses the default multiline warning and fails closed when cancelled", async () => {
    mocks.clipboard.readText.mockResolvedValue("first\nsecond");
    mocks.confirmPaste.mockReturnValue(false);
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const pasted = await model!.pasteFromClipboard();

    expect(pasted).toBe(false);
    expect(mocks.confirmPaste).toHaveBeenCalledOnce();
    expect(mocks.confirmPaste).toHaveBeenCalledWith(
      expect.stringContaining("contains multiple lines"),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "send_ssh_input",
      ),
    ).toHaveLength(0);
  });

  it("combines paste risks into one prompt, trims, and sends once", async () => {
    mocks.settingsContext.settings = {
      trimPastedWhitespace: true,
      warnOnMultiLinePaste: true,
      maxPasteLengthChars: 5,
    };
    mocks.clipboard.readText.mockResolvedValue("  one\ntwo  ");
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const pasted = await model!.pasteFromClipboard();

    expect(pasted).toBe(true);
    expect(mocks.confirmPaste).toHaveBeenCalledOnce();
    expect(mocks.confirmPaste.mock.calls[0][0]).toContain(
      "contains multiple lines and contains 7 characters",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "send_ssh_input",
      ),
    ).toEqual([
      ["send_ssh_input", { sessionId: "backend-ssh-1", data: "one\ntwo" }],
    ]);
  });

  it("prompts only when processed text is strictly over the max length", async () => {
    mocks.settingsContext.settings = {
      trimPastedWhitespace: true,
      warnOnMultiLinePaste: false,
      maxPasteLengthChars: 5,
    };
    mocks.clipboard.readText
      .mockResolvedValueOnce("  12345  ")
      .mockResolvedValueOnce("123456");
    mocks.confirmPaste.mockReturnValue(false);
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(await model!.pasteFromClipboard()).toBe(true);
    expect(await model!.pasteFromClipboard()).toBe(false);

    expect(mocks.confirmPaste).toHaveBeenCalledOnce();
    expect(mocks.confirmPaste).toHaveBeenCalledWith(
      expect.stringContaining(
        "contains 6 characters (configured threshold: 5)",
      ),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "send_ssh_input",
      ),
    ).toEqual([
      ["send_ssh_input", { sessionId: "backend-ssh-1", data: "12345" }],
    ]);
  });

  it("bypasses the multiline prompt when the warning is disabled", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      maxPasteLengthChars: 0,
    };
    mocks.clipboard.readText.mockResolvedValue("first\nsecond");
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(await model!.pasteFromClipboard()).toBe(true);

    expect(mocks.confirmPaste).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("send_ssh_input", {
      sessionId: "backend-ssh-1",
      data: "first\nsecond",
    });
  });

  it("captures native xterm paste and routes it through the same policy gate", async () => {
    mocks.confirmPaste.mockReturnValue(false);
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} data-testid="canvas" />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { getData: () => "first\nsecond" },
    });

    await act(async () => {
      view.getByTestId("canvas").dispatchEvent(pasteEvent);
      await Promise.resolve();
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(mocks.confirmPaste).toHaveBeenCalledOnce();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "send_ssh_input",
      ),
    ).toHaveLength(0);
  });

  it.each([
    { sshEnabled: true, globalEnabled: false, shouldPaste: true },
    { sshEnabled: false, globalEnabled: true, shouldPaste: false },
  ])(
    "uses SSH paste-on-right-click=$sshEnabled ahead of global=$globalEnabled",
    async ({ sshEnabled, globalEnabled, shouldPaste }) => {
      mocks.terminalConfig = { pasteOnRightClick: sshEnabled };
      mocks.settingsContext.settings = {
        pasteOnRightClick: globalEnabled,
        warnOnMultiLinePaste: false,
      };
      mocks.clipboard.readText.mockResolvedValue("right-click paste");
      let model: WebTerminalMgr | null = null;
      const Harness = () => {
        model = useWebTerminal(session);
        return <div ref={model.containerRef} data-testid="canvas" />;
      };

      const view = render(<Harness />);
      await waitFor(() => expect(model?.status).toBe("connected"));
      const contextMenuEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      await act(async () => {
        view.getByTestId("canvas").dispatchEvent(contextMenuEvent);
        await Promise.resolve();
      });

      expect(contextMenuEvent.defaultPrevented).toBe(shouldPaste);
      expect(mocks.clipboard.readText).toHaveBeenCalledTimes(
        shouldPaste ? 1 : 0,
      );
      expect(
        mocks.invoke.mock.calls.filter(
          ([command]) => command === "send_ssh_input",
        ),
      ).toHaveLength(shouldPaste ? 1 : 0);
    },
  );

  it("uses the global right-click setting for non-SSH terminal sessions", async () => {
    mocks.terminalConfig = { pasteOnRightClick: false };
    mocks.settingsContext.settings = {
      pasteOnRightClick: true,
      warnOnMultiLinePaste: false,
    };
    mocks.clipboard.readText.mockResolvedValue("global right-click paste");
    const nonSshSession: ConnectionSession = {
      ...session,
      id: "frontend-telnet-1",
      protocol: "telnet",
    };
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(nonSshSession);
      return <div ref={model.containerRef} data-testid="canvas" />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    await act(async () => {
      view.getByTestId("canvas").dispatchEvent(contextMenuEvent);
      await Promise.resolve();
    });

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(mocks.clipboard.readText).toHaveBeenCalledOnce();
    expect(mocks.MockTerminal.instances[0].write).toHaveBeenCalledWith(
      "global right-click paste",
    );
  });

  it("replaces the clear timer and clears only an unchanged clipboard", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      clearClipboardAfterSeconds: 5,
    };
    let clipboardValue = "first paste";
    mocks.clipboard.readText.mockImplementation(async () => clipboardValue);
    mocks.clipboard.writeText.mockImplementation(async (text: string) => {
      clipboardValue = text;
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    vi.useFakeTimers();
    await model!.pasteFromClipboard();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));

    clipboardValue = "second paste";
    await model!.pasteFromClipboard();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.clipboard.writeText).toHaveBeenCalledOnce();
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith("");
  });

  it("preserves clipboard content copied after a configured terminal paste", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      clearClipboardAfterSeconds: 5,
    };
    let clipboardValue = "terminal paste";
    mocks.clipboard.readText.mockImplementation(async () => clipboardValue);
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    vi.useFakeTimers();
    await model!.pasteFromClipboard();
    clipboardValue = "newer unrelated copy";
    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("cancels a scheduled clipboard clear when the terminal unmounts", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      clearClipboardAfterSeconds: 5,
    };
    mocks.clipboard.readText.mockResolvedValue("terminal paste");
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    vi.useFakeTimers();
    await model!.pasteFromClipboard();
    view.unmount();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("never schedules clipboard clearing when the setting is disabled", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      clearClipboardAfterSeconds: 0,
    };
    mocks.clipboard.readText.mockResolvedValue("terminal paste");
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    vi.useFakeTimers();
    await model!.pasteFromClipboard();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));

    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("surfaces clipboard read and guarded-clear failures without rejecting", async () => {
    mocks.settingsContext.settings = {
      warnOnMultiLinePaste: false,
      clearClipboardAfterSeconds: 1,
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    mocks.clipboard.readText.mockRejectedValueOnce(new Error("read denied"));
    await expect(model!.pasteFromClipboard()).resolves.toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Failed to read from the clipboard",
      3000,
    );

    mocks.clipboard.readText.mockResolvedValueOnce("terminal paste");
    vi.useFakeTimers();
    await model!.pasteFromClipboard();
    mocks.clipboard.readText.mockRejectedValueOnce(new Error("verify denied"));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Failed to clear the clipboard",
      3000,
    );
    consoleError.mockRestore();
  });

  it("records one verified connected and disconnected lifecycle even when VPN cleanup later fails", async () => {
    localStorage.clear();
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "connect_ssh") return Promise.resolve("backend-ssh-1");
      if (command === "start_shell") return Promise.resolve("shell-ssh-1");
      if (command === "disconnect_ssh") return Promise.resolve(undefined);
      if (command === "acquire_vpn_leases") {
        return Promise.resolve({
          owner_id: (args as { ownerId: string }).ownerId,
          leases: [],
        });
      }
      if (command === "release_vpn_leases") {
        return Promise.resolve({
          owner_id: (args as { ownerId: string }).ownerId,
          released: [],
          errors: ["provider cleanup failed"],
        });
      }
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    view.rerender(<Harness />);
    await act(async () => Promise.resolve());
    await act(async () => {
      await model?.disconnectSsh();
    });

    const activity = JSON.parse(
      localStorage.getItem("sshSessionActivity") ?? "[]",
    );
    expect(activity.map((record: { kind: string }) => record.kind)).toEqual([
      "connected",
      "disconnected",
    ]);
    expect(
      activity.every(
        (record: { sessionId: string }) =>
          record.sessionId === "frontend-ssh-1",
      ),
    ).toBe(true);
  });

  it("records verified script completion with frontend identity, duration, timestamp, and diagnostic stderr", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") return Promise.resolve("backend-ssh-1");
      if (command === "start_shell") return Promise.resolve("shell-ssh-1");
      if (command === "execute_script") {
        return Promise.resolve({
          stdout: "ok\n",
          stderr: "diagnostic warning",
          exitCode: 0,
        });
      }
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const before = Date.now();
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_125);

    await act(async () => {
      await model?.runScript({
        id: "script-1",
        name: "Inspect",
        description: "",
        script: "echo ok\necho diagnostic >&2",
        language: "bash",
        category: "Test",
        osTags: ["linux"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });
    const after = new Date().getTime();
    dateNow.mockRestore();

    expect(mocks.addHistoryEntry).toHaveBeenCalledWith(
      "echo ok\necho diagnostic >&2",
      [
        expect.objectContaining({
          sessionId: "frontend-ssh-1",
          source: "web-terminal-script",
          evidence: "remote-completion",
          status: "success",
          exitCode: 0,
          durationMs: 125,
          output: "ok\n",
          stderr: "diagnostic warning",
          errorMessage: undefined,
        }),
      ],
    );
    const execution = mocks.addHistoryEntry.mock.calls[0][1][0];
    expect(Date.parse(execution.executedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(execution.executedAt)).toBeLessThanOrEqual(after);
  });

  it("records nonzero script completion as verified failure", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_ssh") return Promise.resolve("backend-ssh-1");
      if (command === "start_shell") return Promise.resolve("shell-ssh-1");
      if (command === "execute_script") {
        return Promise.resolve({
          stdout: "",
          stderr: "script failed",
          exitCode: 7,
        });
      }
      return Promise.resolve(undefined);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    await waitFor(() => {
      expect(mocks.loadManagedScripts).toHaveBeenCalledOnce();
      expect(mocks.listeners.has("request-terminal-buffer")).toBe(true);
      expect(mocks.listeners.has("ssh-output")).toBe(true);
      expect(mocks.listeners.has("ssh-error")).toBe(true);
      expect(mocks.listeners.has("ssh-shell-closed")).toBe(true);
    });

    await act(async () => {
      await model?.runScript({
        id: "script-2",
        name: "Fail",
        description: "",
        script: "echo start\nexit 7",
        language: "sh",
        category: "Test",
        osTags: ["linux"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(mocks.addHistoryEntry).toHaveBeenCalledWith("echo start\nexit 7", [
      expect.objectContaining({
        sessionId: "frontend-ssh-1",
        evidence: "remote-completion",
        status: "error",
        exitCode: 7,
        stderr: "script failed",
        errorMessage: "script failed",
      }),
    ]);

    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(mocks.listeners.size).toBe(0);
  });

  it.each([
    ["accepted", undefined, "pending", "dispatch-accepted"],
    [
      "failed",
      new Error("transport unavailable"),
      "cancelled",
      "dispatch-failed",
    ],
  ])(
    "records fallback script dispatch as %s",
    async (_label, fallbackError, expectedStatus, expectedEvidence) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.invoke.mockImplementation((command: string) => {
        if (command === "connect_ssh") return Promise.resolve("backend-ssh-1");
        if (command === "start_shell") return Promise.resolve("shell-ssh-1");
        if (command === "execute_script")
          return Promise.reject(new Error("unsupported"));
        if (command === "send_ssh_input") {
          return fallbackError
            ? Promise.reject(fallbackError)
            : Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      });
      let model: WebTerminalMgr | null = null;
      const Harness = () => {
        model = useWebTerminal(session);
        return <div ref={model.containerRef} />;
      };
      render(<Harness />);
      await waitFor(() => expect(model?.status).toBe("connected"));

      await act(async () => {
        await model?.runScript({
          id: "script-fallback",
          name: "Fallback",
          description: "",
          script: "echo one\necho two",
          language: "bash",
          category: "Test",
          osTags: ["linux"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      });

      expect(mocks.addHistoryEntry).toHaveBeenCalledWith("echo one\necho two", [
        expect.objectContaining({
          sessionId: "frontend-ssh-1",
          source: "web-terminal-script",
          status: expectedStatus,
          evidence: expectedEvidence,
        }),
      ]);
      expect(warn).toHaveBeenCalledWith(
        "execute_script failed, falling back to shell piping:",
        expect.any(Error),
      );
      if (fallbackError) {
        expect(error).toHaveBeenCalledWith(
          "Failed to run script:",
          fallbackError,
        );
      } else {
        expect(error).not.toHaveBeenCalled();
      }
      warn.mockRestore();
      error.mockRestore();
    },
  );

  it("acquires the VPN path before SSH and releases it after target disconnect", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "ikev2", connectionId: "ike-office" },
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));

    const commandsBeforeDisconnect = mocks.invoke.mock.calls.map(
      ([command]) => command,
    );
    expect(commandsBeforeDisconnect.indexOf("acquire_vpn_leases")).toBeLessThan(
      commandsBeforeDisconnect.indexOf("connect_ssh"),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "acquire_vpn_leases",
      expect.objectContaining({
        ownerId: expect.stringMatching(/^frontend-ssh-1:ssh:[0-9a-f-]+$/i),
        requests: [
          {
            vpn_type: "ikev2",
            connection_id: "ike-office",
            auto_connect: true,
          },
          {
            vpn_type: "wireguard",
            connection_id: "wg-office",
            auto_connect: true,
          },
        ],
      }),
    );
    const acquireCall = mocks.invoke.mock.calls.find(
      ([command]) => command === "acquire_vpn_leases",
    );
    const acquiredOwnerId = (acquireCall?.[1] as { ownerId: string }).ownerId;

    await act(async () => {
      await model?.disconnectSsh();
    });
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.lastIndexOf("disconnect_ssh")).toBeLessThan(
      commands.lastIndexOf("release_vpn_leases"),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: acquiredOwnerId,
    });
  });

  it("keeps the backend and VPN lease on a view-only unmount", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };

    const view = render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    view.unmount();
    await act(async () => Promise.resolve());

    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(0);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "release_vpn_leases",
      ),
    ).toHaveLength(0);
  });

  it("cancels the exact hung SSH reservation when props move from A to B", async () => {
    const fallbackInvoke = mocks.invoke.getMockImplementation();
    const hungConnect = new Promise<string>(() => undefined);
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "connect_ssh") return hungConnect;
      return fallbackInvoke?.(command, args);
    });
    let model: WebTerminalMgr | null = null;
    const Harness = ({
      activeSession,
    }: {
      activeSession: ConnectionSession;
    }) => {
      model = useWebTerminal(activeSession);
      return <div ref={model.containerRef} />;
    };
    const sessionB: ConnectionSession = {
      ...session,
      id: "frontend-terminal-b",
      protocol: "telnet",
    };

    const view = render(<Harness activeSession={session} />);
    await waitFor(() =>
      expect(hasSessionLifecycleActorAttempt(session.id)).toBe(true),
    );
    const reservationDispatchIndex =
      mocks.context.dispatch.mock.calls.findIndex(
        ([action]) =>
          typeof action.payload?.lifecycleActorReservationId === "number",
      );
    expect(reservationDispatchIndex).toBeGreaterThanOrEqual(0);
    expect(
      mocks.context.dispatch.mock.invocationCallOrder[reservationDispatchIndex],
    ).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);

    view.rerender(<Harness activeSession={sessionB} />);
    await waitFor(() => {
      expect(hasSessionLifecycleActorAttempt(session.id)).toBe(false);
      expect(hasSessionLifecycleActorAttempt(sessionB.id)).toBe(false);
    });
    view.unmount();
  });

  it("aborts after a deferred path resolve when quarantine lands mid-init", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    let resumePath!: () => void;
    mockedResolveRuntimeNetworkPath.mockReturnValueOnce(
      new Promise((resolve) => {
        resumePath = () => resolve(mocks.runtimePath);
      }),
    );
    const Harness = ({
      activeSession,
    }: {
      activeSession: ConnectionSession;
    }) => {
      const model = useWebTerminal(activeSession);
      return <div ref={model.containerRef} />;
    };
    const view = render(<Harness activeSession={session} />);
    await waitFor(() => {
      expect(hasSessionLifecycleActorAttempt(session.id)).toBe(true);
      expect(mockedResolveRuntimeNetworkPath).toHaveBeenCalled();
    });

    const quarantined: ConnectionSession = {
      ...session,
      status: "error",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-quarantined",
            backendSessionId: "backend-quarantined",
            protocol: "ssh",
            status: "cleanup-pending",
          },
        ],
        proofIncomplete: false,
      },
    };
    await act(async () => {
      view.rerender(<Harness activeSession={quarantined} />);
    });
    await act(async () => {
      resumePath();
    });

    await waitFor(() =>
      expect(hasSessionLifecycleActorAttempt(session.id)).toBe(false),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "acquire_vpn_leases",
      expect.anything(),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "connect_ssh",
      expect.anything(),
    );
    view.unmount();
  });

  it("keeps a replacement VPN lease when an overlapping SSH attempt goes stale", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    const liveOwners = new Set<string>();
    const acquiredOwners: string[] = [];
    let finishStaleConnect!: (sessionId: string) => void;
    const staleConnect = new Promise<string>((resolve) => {
      finishStaleConnect = resolve;
    });
    let connectCalls = 0;
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      const invokeArgs = args as { ownerId?: string } | undefined;
      const ownerId = String(invokeArgs?.ownerId);
      if (command === "acquire_vpn_leases") {
        acquiredOwners.push(ownerId);
        liveOwners.add(ownerId);
        return {
          owner_id: ownerId,
          leases: [
            {
              vpn_type: "wireguard",
              connection_id: "wg-office",
              was_already_connected: connectCalls > 0,
              already_owned: false,
              started_by_lifecycle: true,
              lease_count: liveOwners.size,
            },
          ],
        };
      }
      if (command === "release_vpn_leases") {
        liveOwners.delete(ownerId);
        return { owner_id: ownerId, released: [], errors: [] };
      }
      if (command === "connect_ssh") {
        connectCalls += 1;
        return connectCalls === 1 ? staleConnect : "backend-ssh-replacement";
      }
      if (command === "start_shell") return "shell-ssh-replacement";
      return undefined;
    });

    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    render(<Harness />);

    await waitFor(() => {
      expect(connectCalls).toBe(1);
      expect(acquiredOwners).toHaveLength(1);
    });

    let reconnectPromise!: Promise<void>;
    act(() => {
      reconnectPromise = model!.handleReconnect();
    });
    await waitFor(() => expect(connectCalls).toBe(2));
    await act(async () => reconnectPromise);
    await waitFor(() => expect(model?.status).toBe("connected"));

    await act(async () => {
      finishStaleConnect("backend-ssh-stale");
      await staleConnect;
    });
    await waitFor(() => expect(liveOwners.size).toBe(1));

    expect(acquiredOwners).toHaveLength(2);
    expect(acquiredOwners[0]).not.toBe(acquiredOwners[1]);
    expect(liveOwners).toEqual(new Set([acquiredOwners[1]]));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "backend-ssh-stale",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: acquiredOwners[0],
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: acquiredOwners[1],
    });
  });

  it("retains a stale SSH backend and its owner until native cleanup retry succeeds", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    const liveOwners = new Set<string>();
    const acquiredOwners: string[] = [];
    const releaseCalls: string[] = [];
    let finishStaleConnect!: (sessionId: string) => void;
    const staleConnect = new Promise<string>((resolve) => {
      finishStaleConnect = resolve;
    });
    let connectCalls = 0;
    let staleDisconnectAttempts = 0;
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      const invokeArgs = args as
        | { ownerId?: string; sessionId?: string }
        | undefined;
      const ownerId = String(invokeArgs?.ownerId);
      if (command === "acquire_vpn_leases") {
        acquiredOwners.push(ownerId);
        liveOwners.add(ownerId);
        return { owner_id: ownerId, leases: [] };
      }
      if (command === "release_vpn_leases") {
        releaseCalls.push(ownerId);
        liveOwners.delete(ownerId);
        return { owner_id: ownerId, released: [], errors: [] };
      }
      if (command === "connect_ssh") {
        connectCalls += 1;
        return connectCalls === 1 ? staleConnect : "backend-ssh-replacement";
      }
      if (command === "start_shell") return "shell-ssh-replacement";
      if (command === "disconnect_ssh") {
        if (invokeArgs?.sessionId === "backend-ssh-stale") {
          staleDisconnectAttempts += 1;
          if (staleDisconnectAttempts === 1) {
            throw new Error("stale backend still active");
          }
        }
        return undefined;
      }
      return undefined;
    });

    let model: WebTerminalMgr | null = null;
    const Harness = () => {
      model = useWebTerminal(session);
      return <div ref={model.containerRef} />;
    };
    render(<Harness />);
    await waitFor(() => expect(connectCalls).toBe(1));

    let replacementInit!: Promise<void>;
    act(() => {
      replacementInit = model!.handleReconnect();
    });
    await waitFor(() => expect(connectCalls).toBe(2));
    await act(async () => replacementInit);
    await waitFor(() => expect(model?.status).toBe("connected"));
    expect(liveOwners).toEqual(new Set(acquiredOwners));

    await act(async () => {
      finishStaleConnect("backend-ssh-stale");
      await staleConnect;
    });
    await waitFor(() => expect(staleDisconnectAttempts).toBe(1));
    expect(releaseCalls).not.toContain(acquiredOwners[0]);
    expect(liveOwners).toEqual(new Set(acquiredOwners));
    expect(mocks.context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          backendSessionId: "backend-ssh-stale",
          status: "error",
          errorMessage: expect.stringMatching(/cleanup failed/i),
          vpnLeaseOwnerIds: expect.arrayContaining(acquiredOwners),
        }),
      }),
    );

    let disconnected = false;
    await act(async () => {
      disconnected = (await model?.disconnectSsh()) ?? false;
    });
    expect(disconnected).toBe(true);
    expect(staleDisconnectAttempts).toBe(2);
    expect(liveOwners).toEqual(new Set());
    expect(releaseCalls).toEqual(expect.arrayContaining(acquiredOwners));
    const staleDisconnectCallOrders = mocks.invoke.mock.calls
      .map(([command, args], index) => ({ command, args, index }))
      .filter(
        ({ command, args }) =>
          command === "disconnect_ssh" &&
          (args as { sessionId?: string })?.sessionId === "backend-ssh-stale",
      )
      .map(({ index }) => index);
    const staleOwnerReleaseIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "release_vpn_leases" &&
        (args as { ownerId?: string })?.ownerId === acquiredOwners[0],
    );
    expect(staleOwnerReleaseIndex).toBeGreaterThan(
      staleDisconnectCallOrders[1],
    );
  });

  it("retains a failed persisted-owner handoff and clears its snapshot only after retry succeeds", async () => {
    const persistedOwner = "frontend-ssh-1:ssh:persisted";
    mocks.runtimePath.transport.vpnPreSteps = [
      { vpnType: "wireguard", connectionId: "wg-office" },
    ];
    const releaseAttempts = new Map<string, number>();
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "is_session_alive") return Promise.resolve(true);
      if (command === "get_terminal_buffer") return Promise.resolve("");
      if (command === "get_shell_info")
        return Promise.resolve("existing-shell-1");
      if (command === "disconnect_ssh") return Promise.resolve(undefined);
      if (command === "acquire_vpn_leases") {
        const ownerId = (args as { ownerId: string }).ownerId;
        return Promise.resolve({ owner_id: ownerId, leases: [] });
      }
      if (command === "release_vpn_leases") {
        const ownerId = (args as { ownerId: string }).ownerId;
        const attempts = (releaseAttempts.get(ownerId) ?? 0) + 1;
        releaseAttempts.set(ownerId, attempts);
        return Promise.resolve({
          owner_id: ownerId,
          released: [],
          errors:
            ownerId === persistedOwner && attempts === 1
              ? ["provider busy"]
              : [],
        });
      }
      return Promise.resolve(undefined);
    });

    let model: WebTerminalMgr | null = null;
    const persistedSession: ConnectionSession = {
      ...session,
      status: "connected",
      backendSessionId: "backend-ssh-persisted",
      shellId: "existing-shell-1",
      vpnLeaseOwnerId: persistedOwner,
    };
    const Harness = () => {
      model = useWebTerminal(persistedSession);
      return <div ref={model.containerRef} />;
    };

    render(<Harness />);
    await waitFor(() => expect(model?.status).toBe("connected"));
    const acquiredOwner = (
      mocks.invoke.mock.calls.find(
        ([command]) => command === "acquire_vpn_leases",
      )?.[1] as { ownerId: string }
    ).ownerId;
    expect(releaseAttempts.get(persistedOwner)).toBe(1);
    expect(mocks.context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          vpnLeaseOwnerId: acquiredOwner,
          vpnLeaseOwnerIds: expect.arrayContaining([
            persistedOwner,
            acquiredOwner,
          ]),
        }),
      }),
    );

    await act(async () => {
      await model?.disconnectSsh();
    });
    expect(releaseAttempts.get(persistedOwner)).toBe(2);
    expect(releaseAttempts.get(acquiredOwner)).toBe(1);
    expect(mocks.context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          vpnLeaseOwnerId: undefined,
          vpnLeaseOwnerIds: undefined,
        }),
      }),
    );
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.lastIndexOf("disconnect_ssh")).toBeLessThan(
      commands.lastIndexOf("release_vpn_leases"),
    );
  });
});
