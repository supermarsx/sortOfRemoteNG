import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RDPClient from "../src/components/RDPClient";
import { ConnectionSession } from "../src/types/connection";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

// Mock Tauri event API
const mockListeners: Record<string, (event: { payload: unknown }) => void> = {};
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    mockListeners[eventName] = handler;
    return Promise.resolve(() => { delete mockListeners[eventName]; });
  })
}));

// Mock rdpCanvas (FrameBuffer class used by the live frame listener)
vi.mock('../src/components/rdpCanvas', () => ({
  drawSimulatedDesktop: vi.fn(),
  drawDesktopIcon: vi.fn(),
  drawWindow: vi.fn(),
  paintFrame: vi.fn(),
  decodeBase64Rgba: vi.fn(() => new Uint8ClampedArray(0)),
  clearCanvas: vi.fn(),
  FrameBuffer: class {
    offscreen = { width: 1920, height: 1080 };
    ctx = {};
    hasPainted = false;
    applyRegion() { this.hasPainted = true; }
    resize() {}
    blitTo() {}
  },
}));

// Mock useConnections hook
vi.mock('../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: {
      connections: [mockConnection]
    }
  })
}));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(tauriInvoke);

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

/** Simulate the backend emitting a status event */
function emitStatus(status: string, message: string, sessionId = 'rdp-session-123', desktopWidth?: number, desktopHeight?: number) {
  const handler = mockListeners['rdp://status'];
  if (handler) {
    handler({
      payload: {
        session_id: sessionId,
        status,
        message,
        desktop_width: desktopWidth,
        desktop_height: desktopHeight
      }
    });
  }
}

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
    Object.keys(mockListeners).forEach(k => delete mockListeners[k]);
    mockInvoke.mockResolvedValue('rdp-session-123');
    
    // Mock canvas getContext to return a mock context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      fillText: vi.fn(),
      putImageData: vi.fn(),
      font: '',
      textAlign: '',
    }));
  });

  describe("RDP Connection", () => {
    it("should call connect_rdp with new parameters", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.objectContaining({
          connectionId: 'test-connection',
          host: '192.168.1.100',
          port: 3389,
          username: 'testuser',
          password: 'testpass',
          width: 1920,
          height: 1080,
        }));
      });
    });

    it("should display connecting status initially", () => {
      renderWithProviders(mockSession);
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });

    it("should display connected status when backend emits connected event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      // Simulate backend connected event
      emitStatus('connected', 'Connected (1920x1080)', 'rdp-session-123', 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });
    });

    it("should display error status when backend emits error event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      emitStatus('error', 'Authentication failed', 'rdp-session-123');

      await waitFor(() => {
        expect(screen.getByText("error")).toBeInTheDocument();
      });
    });

    it("should display error when connect_rdp command fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error('RDP connection failed'));

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

    it("should set canvas dimensions from desktop size event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      emitStatus('connected', 'Connected', 'rdp-session-123', 1920, 1080);

      await waitFor(() => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas.width).toBe(1920);
        expect(canvas.height).toBe(1080);
      });
    });
  });

  describe("UI Controls", () => {
    it("should render control buttons", () => {
      renderWithProviders(mockSession);
      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rdp settings/i })).toBeInTheDocument();
    });

    it("should toggle fullscreen mode", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      emitStatus('connected', 'Connected', 'rdp-session-123', 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const fullscreenButton = screen.getByRole('button', { name: /fullscreen/i });
      fullscreenButton.click();

      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("Settings", () => {
    it("should toggle settings panel", async () => {
      renderWithProviders(mockSession);

      const settingsButton = screen.getByRole('button', { name: /settings/i });
      settingsButton.click();

      await waitFor(() => {
        expect(screen.getByText("Resolution")).toBeInTheDocument();
      });
    });
  });

  describe("RDP Internals", () => {
    it("should toggle internals panel", async () => {
      renderWithProviders(mockSession);

      const internalsButton = screen.getByRole('button', { name: /rdp internals/i });
      internalsButton.click();

      await waitFor(() => {
        expect(screen.getByText("RDP Session Internals")).toBeInTheDocument();
        expect(screen.getByText("Waiting for session statistics...")).toBeInTheDocument();
      });
    });

    it("should display stats when rdp://stats event is received", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      emitStatus('connected', 'Connected', 'rdp-session-123', 1920, 1080);

      // Open internals panel
      const internalsButton = screen.getByRole('button', { name: /rdp internals/i });
      internalsButton.click();

      // Simulate stats event
      const statsHandler = mockListeners['rdp://stats'];
      if (statsHandler) {
        statsHandler({
          payload: {
            session_id: 'rdp-session-123',
            uptime_secs: 42,
            bytes_received: 1048576, // 1MB
            bytes_sent: 65536, // 64KB
            pdus_received: 500,
            pdus_sent: 100,
            frame_count: 300,
            fps: 25.0,
            input_events: 150,
            errors_recovered: 2,
            reactivations: 1,
            phase: 'active',
            last_error: null,
          }
        });
      }

      await waitFor(() => {
        expect(screen.getByText("active")).toBeInTheDocument();
        expect(screen.getByText("25.0")).toBeInTheDocument();
        expect(screen.getByText("300")).toBeInTheDocument();
      });
    });
  });

  describe("Connection Status Icons", () => {
    it("should show correct icon for connected status", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalled();
      });

      emitStatus('connected', 'Connected', 'rdp-session-123', 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const statusIcon = document.querySelector('svg');
      expect(statusIcon).toBeInTheDocument();
    });

    it("should show correct icon for connecting status", () => {
      mockInvoke.mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve('session-id'), 100)
      ));

      renderWithProviders(mockSession);
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });
  });

  describe("Input Handling", () => {
    it("should send input events when connected", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      emitStatus('connected', 'Connected', 'rdp-session-123', 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      canvas.click();

      // Canvas should still be in the document after interaction
      expect(canvas).toBeInTheDocument();
    });
  });

  describe("Cleanup", () => {
    it("should call disconnect_rdp on unmount", async () => {
      const { unmount } = renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
      });

      unmount();

      // Should try to disconnect the session by connectionId
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('disconnect_rdp', { connectionId: 'test-connection' });
      });
    });
  });
});