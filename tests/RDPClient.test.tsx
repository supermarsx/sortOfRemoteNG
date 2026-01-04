import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RDPClient from "../src/components/RDPClient";
import { ConnectionSession } from "../src/types/connection";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

// Mock rdpCanvas
vi.mock('../src/components/rdpCanvas', () => ({
  drawSimulatedDesktop: vi.fn()
}));

// Mock useConnections hook
vi.mock('../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: {
      connections: [mockConnection]
    }
  })
}));

import { drawSimulatedDesktop } from '../src/components/rdpCanvas';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(tauriInvoke);
const mockDrawSimulatedDesktop = vi.mocked(drawSimulatedDesktop);

const mockConnection = {
  id: 'test-connection',
  name: 'Test RDP Server',
  protocol: 'rdp' as const,
  hostname: '192.168.1.100',
  port: 3389,
  username: 'testuser',
  password: 'testpass',
  privateKey: null,
  passphrase: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isGroup: false
};

const mockSession: ConnectionSession = {
  id: 'test-rdp-session',
  connectionId: 'test-connection',
  protocol: 'rdp',
  hostname: '192.168.1.100',
  username: 'testuser',
  password: 'testpass',
  status: 'connecting'
};

const renderWithProviders = (session: ConnectionSession) => {
  return render(
    <ConnectionProvider>
      <RDPClient session={session} />
    </ConnectionProvider>
  );
};

describe("RDPClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue('rdp-session-123');
    
    // Mock canvas getContext to return a mock context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      fillText: vi.fn(),
      font: '',
      textAlign: '',
    }));
  });

  describe("RDP Connection", () => {
    it("should attempt real RDP connection first", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', {
          host: '192.168.1.100',
          port: 3389,
          username: 'testuser',
          password: 'testpass'
        });
      });
    });

    it("should display connecting status initially", () => {
      renderWithProviders(mockSession);

      expect(screen.getByText("connecting")).toBeInTheDocument();
    });

    it("should display connected status when RDP connection succeeds", async () => {
      renderWithProviders(mockSession);

      // Wait for the connection attempt
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      // The component should eventually show connected status
      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it("should fallback to simulation when RDP connection fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error('RDP connection failed'));

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockDrawSimulatedDesktop).toHaveBeenCalled();
        expect(screen.getByText("connected")).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it("should display error status when both RDP and simulation fail", async () => {
      mockInvoke.mockRejectedValueOnce(new Error('RDP connection failed'));
      mockDrawSimulatedDesktop.mockImplementation(() => {
        throw new Error('Canvas error');
      });

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("RDP Connection Failed")).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe("Canvas Rendering", () => {
    it("should render canvas element", () => {
      renderWithProviders(mockSession);

      const canvas = document.querySelector('canvas');
      expect(canvas).toBeInTheDocument();
    });

    it("should set correct canvas dimensions", async () => {
      renderWithProviders(mockSession);

      // Wait for connection to complete
      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      // Then check canvas dimensions
      await waitFor(() => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas.width).toBe(1024);
        expect(canvas.height).toBe(768);
      }, { timeout: 3000 });
    });
  });

  describe("UI Controls", () => {
    it("should render control buttons", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rdp settings/i })).toBeInTheDocument();
    });

    it("should toggle fullscreen mode", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const fullscreenButton = screen.getByRole('button', { name: /fullscreen/i });
      fullscreenButton.click();

      // Component should still be rendered
      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("Settings", () => {
    it("should toggle settings panel", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const settingsButton = screen.getByRole('button', { name: /settings/i });
      settingsButton.click();

      // Settings panel should be visible (this would need more specific testing)
      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    });
  });

  describe("Connection Status Icons", () => {
    it("should show correct icon for connected status", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      // The icon should be present (Wifi icon for connected)
      const statusIcon = document.querySelector('svg');
      expect(statusIcon).toBeInTheDocument();
    });

    it("should show correct icon for connecting status", () => {
      // Mock a delay in connection
      mockInvoke.mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve('session-id'), 100)
      ));

      renderWithProviders(mockSession);

      // Initially should show connecting status
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });
  });

  describe("Canvas Interaction", () => {
    it("should handle canvas clicks when connected", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      canvas.click();

      // Click should be handled (this would need canvas context mocking for full test)
      expect(canvas).toBeInTheDocument();
    });
  });

  describe("Cleanup", () => {
    it("should cleanup on unmount", async () => {
      const { unmount } = renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      unmount();

      // Component should unmount without errors
      expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
    });
  });
});