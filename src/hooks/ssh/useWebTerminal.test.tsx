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
  resolveRuntimeNetworkPath: vi.fn(async () => ({
    transport: {
      vpnPreSteps: [],
      jump_hosts: [],
      proxy_config: null,
      proxy_chain: null,
      mixed_chain: null,
      openvpn_config: null,
    },
    snapshot: { source: "direct" },
    redactionSecrets: [],
  })),
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
  mocks.invoke.mockImplementation((command: string) => {
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
});
