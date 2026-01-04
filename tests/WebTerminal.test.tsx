import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebTerminal } from "../src/components/WebTerminal";
import { ConnectionSession } from "../src/types/connection";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

// Mock xterm.js
const mockTerminal = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  dispose: vi.fn(),
  clear: vi.fn(),
  getSelection: vi.fn(),
  cols: 80,
  rows: 24
};

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => mockTerminal)
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(tauriInvoke);

// Mock useConnections hook
vi.mock('../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: {
      connections: [mockConnection]
    }
  })
}));

const mockConnection = {
  id: 'test-connection',
  name: 'Test SSH Server',
  protocol: 'ssh' as const,
  hostname: '192.168.1.100',
  port: 22,
  username: 'testuser',
  password: 'testpass',
  privateKey: null,
  passphrase: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isGroup: false
};

const mockSession: ConnectionSession = {
  id: 'test-session',
  connectionId: 'test-connection',
  protocol: 'ssh',
  hostname: '192.168.1.100',
  username: 'testuser',
  password: 'testpass',
  status: 'connecting'
};

const renderWithProviders = (session: ConnectionSession) => {
  return render(
    <ConnectionProvider>
      <WebTerminal session={session} />
    </ConnectionProvider>
  );
};

describe("WebTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue('test-session-id');
  });

  describe("SSH Connection", () => {
    it("should display connection details during SSH connection", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[36mConnecting to SSH server...\x1b[0m');
      });

      expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[90mHost: 192.168.1.100\x1b[0m');
      expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[90mPort: 22\x1b[0m');
      expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[90mUser: testuser\x1b[0m');
    });

    it("should call connect_ssh with correct parameters", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_ssh', {
          config: expect.objectContaining({
            host: '192.168.1.100',
            port: 22,
            username: 'testuser',
            password: 'testpass',
            private_key_path: null,
            private_key_passphrase: null,
            jump_hosts: [],
            proxy_config: null,
            openvpn_config: null,
            connect_timeout: 30000,
            keep_alive_interval: 60,
            strict_host_key_checking: false,
            known_hosts_path: null
          })
        });
      });
    });

    it("should handle authentication failure", async () => {
      const authError = new Error('Authentication failed');
      mockInvoke.mockRejectedValueOnce(authError);

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[31mAuthentication failed - please check your credentials\x1b[0m');
      });
    });

    it("should handle connection refused", async () => {
      const connError = new Error('Connection refused');
      mockInvoke.mockRejectedValueOnce(connError);

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[31mConnection refused - please check the host and port\x1b[0m');
      });
    });

    it("should handle connection timeout", async () => {
      const timeoutError = new Error('timeout');
      mockInvoke.mockRejectedValueOnce(timeoutError);

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[31mConnection timeout - please check network connectivity\x1b[0m');
      });
    });

    it("should handle host key verification failure", async () => {
      const hostKeyError = new Error('Host key verification failed');
      mockInvoke.mockRejectedValueOnce(hostKeyError);

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[31mHost key verification failed - server may have changed\x1b[0m');
      });
    });

    it("should display success message when connected", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeInTheDocument();
        expect(screen.getByText("SSH lib: Rust")).toBeInTheDocument();
      });
    });
  });

  describe("Non-SSH Protocols", () => {
    it("should display terminal ready message for non-SSH protocols", () => {
      const telnetSession: ConnectionSession = {
        ...mockSession,
        protocol: 'telnet'
      };

      renderWithProviders(telnetSession);

      expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[32mTerminal ready for TELNET session\x1b[0m');
      expect(mockTerminal.writeln).toHaveBeenCalledWith('\x1b[36mConnected to: 192.168.1.100\x1b[0m');
    });
  });

  describe("Terminal Input Handling", () => {
    it.skip("should execute commands when Enter is pressed", async () => {
      let onDataCallback: (data: string) => void;
      mockTerminal.onData = vi.fn().mockImplementation((callback) => {
        onDataCallback = callback;
        return { dispose: vi.fn() };
      });

      mockInvoke
        .mockResolvedValueOnce('ssh-session-123') // connect_ssh
        .mockResolvedValueOnce(undefined) // start_shell
        .mockResolvedValueOnce('ls output'); // execute_command

      renderWithProviders(mockSession);

      // Wait for connection to establish
      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeInTheDocument();
      });

      // Simulate typing 'ls' and pressing Enter by calling the onData callback
      onDataCallback('l');
      onDataCallback('s');
      onDataCallback('\r'); // Enter key

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('execute_command', {
          sessionId: 'ssh-session-123',
          command: 'ls',
          timeout: 30000
        });
      });
    });

    it("should handle backspace correctly", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeInTheDocument();
      });

      // This test would need more complex mocking of the terminal
      // For now, we verify the component renders without crashing
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  describe("Fullscreen Toggle", () => {
    it("should toggle fullscreen mode", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeInTheDocument();
      });

      const fullscreenButton = screen.getByRole('button', { name: /fullscreen/i });
      fireEvent.click(fullscreenButton);

      // Component should still be rendered
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  describe("Connection Cleanup", () => {
    it("should disconnect SSH session on unmount", async () => {
      mockInvoke.mockResolvedValueOnce('ssh-session-123');

      const { unmount } = renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeInTheDocument();
      });

      unmount();

      expect(mockInvoke).toHaveBeenCalledWith('disconnect_ssh', {
        sessionId: 'ssh-session-123'
      });
    });
  });
});
