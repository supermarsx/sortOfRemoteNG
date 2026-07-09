import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebTerminal } from "../../src/components/ssh/WebTerminal";
import { ConnectionSession } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";

// Connection carries an UNCONFIRMED ProxyCommand (mirrors an imported config:
// proxyCommandConfirmed is left false so the backend gate fires).
const mockConnection = {
  id: "test-connection",
  name: "Test SSH Server",
  protocol: "ssh" as const,
  hostname: "192.168.1.100",
  port: 22,
  username: "testuser",
  password: "testpass",
  privateKey: null,
  passphrase: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isGroup: false,
  sshConnectionConfigOverride: {
    proxyCommand: "nc -X 5 -x proxy:1080 %h %p",
    proxyCommandConfirmed: false,
  },
};

const mockDispatch = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

const mockTerminal = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onBell: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  dispose: vi.fn(),
  clear: vi.fn(),
  getSelection: vi.fn(),
  cols: 80,
  rows: 24,
  element: { isConnected: true },
  _core: {
    renderService: { dimensions: { css: { cell: { width: 9, height: 17 } } } },
  },
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return mockTerminal;
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: vi.fn() }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [mockConnection], sessions: [] },
    dispatch: mockDispatch,
  }),
}));

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(tauriInvoke);

const REDACTED_CMD = "nc -X 5 -x proxy:1080 192.168.1.100 22";

const mockSession: ConnectionSession = {
  id: "test-session",
  connectionId: "test-connection",
  name: "Test Session",
  protocol: "ssh",
  hostname: "192.168.1.100",
  status: "connecting",
  startTime: new Date(),
};

const renderWithProviders = (session: ConnectionSession) =>
  render(
    <ConnectionProvider>
      <WebTerminal session={session} />
    </ConnectionProvider>,
  );

describe("ProxyCommand import-confirmation gate (frontend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch.mockClear();
    localStorage.clear();
  });

  it("shows the confirm dialog on the gate error, confirms + retries on accept", async () => {
    let connectAttempts = 0;
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "connect_ssh":
          connectAttempts += 1;
          if (connectAttempts === 1) {
            return Promise.reject(
              "PROXY_COMMAND_CONFIRMATION_REQUIRED: ProxyCommand has not been confirmed.",
            );
          }
          return Promise.resolve("ssh-session-123");
        case "expand_proxy_command":
          return Promise.resolve(REDACTED_CMD);
        case "confirm_proxy_command":
          return Promise.resolve(REDACTED_CMD);
        case "start_shell":
          return Promise.resolve("shell-123");
        default:
          return Promise.resolve(undefined);
      }
    });

    renderWithProviders(mockSession);

    // Dialog appears showing the exact redacted command.
    const dialogCmd = await screen.findByTestId(
      "proxy-command-confirm-command",
    );
    expect(dialogCmd).toHaveTextContent(REDACTED_CMD);
    expect(mockInvoke).toHaveBeenCalledWith(
      "expand_proxy_command",
      expect.objectContaining({
        host: "192.168.1.100",
        port: 22,
        username: "testuser",
      }),
    );

    // Accept → confirm_proxy_command called, connection retried without persisting a reusable flag.
    fireEvent.click(screen.getByTestId("proxy-command-confirm-accept"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "confirm_proxy_command",
        expect.objectContaining({
          host: "192.168.1.100",
          port: 22,
          username: "testuser",
        }),
      );
    });

    // Confirmation is runtime/fingerprint-scoped and is not persisted as a
    // reusable boolean that could bless later command contents.
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_CONNECTION",
        payload: expect.objectContaining({
          sshConnectionConfigOverride: expect.objectContaining({
            proxyCommandConfirmed: true,
          }),
        }),
      }),
    );

    // Retry happened (connect_ssh called a second time) and succeeded.
    await waitFor(() => {
      expect(connectAttempts).toBe(2);
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  it("aborts without executing on decline (no confirm_proxy_command, no retry)", async () => {
    let connectAttempts = 0;
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "connect_ssh":
          connectAttempts += 1;
          return Promise.reject(
            "PROXY_COMMAND_CONFIRMATION_REQUIRED: ProxyCommand has not been confirmed.",
          );
        case "expand_proxy_command":
          return Promise.resolve(REDACTED_CMD);
        case "confirm_proxy_command":
          return Promise.resolve(REDACTED_CMD);
        case "start_shell":
          return Promise.resolve("shell-123");
        default:
          return Promise.resolve(undefined);
      }
    });

    renderWithProviders(mockSession);

    await screen.findByTestId("proxy-command-confirm-command");

    fireEvent.click(screen.getByTestId("proxy-command-confirm-decline"));

    await waitFor(() => {
      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    // Never confirmed, never retried, never persisted.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "confirm_proxy_command",
      expect.anything(),
    );
    expect(connectAttempts).toBe(1);
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          sshConnectionConfigOverride: expect.objectContaining({
            proxyCommandConfirmed: true,
          }),
        }),
      }),
    );
  });
});
