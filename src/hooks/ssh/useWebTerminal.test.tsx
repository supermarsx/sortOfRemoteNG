import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

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
    reset(): void {}
    clear(): void {}
    write(): void {}
    writeln(): void {}
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
    settings: {},
  };
  const runtimePath = {
    transport: {
      vpnPreSteps: [] as Array<{
        vpnType: "openvpn" | "wireguard" | "tailscale" | "zerotier";
        connectionId: string;
      }>,
      jump_hosts: [],
      proxy_config: null,
      proxy_chain: null,
      mixed_chain: null,
      openvpn_config: null,
    },
    snapshot: { version: 1 as const, transports: [], connectionIds: [] },
    redactionSecrets: [],
  };

  return {
    MockTerminal,
    connection,
    context,
    settingsContext,
    invoke: vi.fn(),
    listen: vi.fn(async (..._args: unknown[]) => vi.fn()),
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
  useToastContext: () => ({ toast: vi.fn() }),
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
vi.mock("../../types/settings/settings", () => ({
  mergeSSHTerminalConfig: () => mocks.terminalConfig,
  mergeSSHConnectionConfig: () => mocks.connectionConfig,
  defaultSSHConnectionConfig: mocks.connectionConfig,
}));
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
  useSSHCommandHistory: () => ({}),
}));

import { useWebTerminal, type WebTerminalMgr } from "./useWebTerminal";

const session: ConnectionSession = {
  id: "frontend-ssh-1",
  connectionId: mocks.connection.id,
  name: mocks.connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: mocks.connection.hostname,
};

beforeEach(() => {
  mocks.MockTerminal.instances.length = 0;
  mocks.context.dispatch.mockReset();
  mocks.invoke.mockReset();
  mocks.listen.mockClear();
  mocks.idleMacroRecorder.recordInput.mockReset();
  mocks.macroRecorder = mocks.idleMacroRecorder;
  mocks.runtimePath.transport.vpnPreSteps = [];
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

describe("useWebTerminal input lifecycle", () => {
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
  });

  it("acquires the VPN path before SSH and releases it after target disconnect", async () => {
    mocks.runtimePath.transport.vpnPreSteps = [
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
        ownerId: expect.stringMatching(/^frontend-ssh-1:ssh:\d+$/),
        requests: [
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
});
