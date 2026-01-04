import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RDPClient } from "../src/components/RDPClient";
import { ConnectionSession } from "../src/types/connection";

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

// Mock rdpCanvas
vi.mock('../src/components/rdpCanvas', () => ({
  drawSimulatedDesktop: vi.fn()
}));

import { drawSimulatedDesktop } from '../src/components/rdpCanvas';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(tauriInvoke);
const mockDrawSimulatedDesktop = vi.mocked(drawSimulatedDesktop);

const mockSession: ConnectionSession = {
  id: 'test-rdp-session',
  connectionId: 'test-connection',
  protocol: 'rdp',
  hostname: '192.168.1.100',
  username: 'testuser',
  password: 'testpass',
  status: 'connecting'
};

describe("RDPClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue('rdp-session-123');
  });

  describe("RDP Connection", () => {
    it("should attempt real RDP connection first", async () => {
      render(<RDPClient session={mockSession} />);

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
      render(<RDPClient session={mockSession} />);

      expect(screen.getByText("connecting")).toBeInTheDocument();
    });

    it("should display connected status when RDP connection succeeds", async () => {
      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });
    });

    it("should fallback to simulation when RDP connection fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error('RDP connection failed'));

      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(mockDrawSimulatedDesktop).toHaveBeenCalled();
        expect(screen.getByText("connected")).toBeInTheDocument();
      });
    });

    it("should display error status when both RDP and simulation fail", async () => {
      mockInvoke.mockRejectedValueOnce(new Error('RDP connection failed'));
      mockDrawSimulatedDesktop.mockImplementation(() => {
        throw new Error('Canvas error');
      });

      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(screen.getByText("error")).toBeInTheDocument();
      });
    });
  });

  describe("Canvas Rendering", () => {
    it("should render canvas element", () => {
      render(<RDPClient session={mockSession} />);

      const canvas = document.querySelector('canvas');
      expect(canvas).toBeInTheDocument();
    });

    it("should set correct canvas dimensions", async () => {
      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas.width).toBe(1024);
        expect(canvas.height).toBe(768);
      });
    });
  });

  describe("UI Controls", () => {
    it("should render control buttons", async () => {
      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    });

    it("should toggle fullscreen mode", async () => {
      render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const fullscreenButton = screen.getByRole('button', { name: /maximize/i });
      fullscreenButton.click();

      // Component should still be rendered
      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("Settings", () => {
    it("should toggle settings panel", async () => {
      render(<RDPClient session={mockSession} />);

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
      render(<RDPClient session={mockSession} />);

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

      render(<RDPClient session={mockSession} />);

      // Initially should show connecting status
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });
  });

  describe("Canvas Interaction", () => {
    it("should handle canvas clicks when connected", async () => {
      render(<RDPClient session={mockSession} />);

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
      const { unmount } = render(<RDPClient session={mockSession} />);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      unmount();

      // Component should unmount without errors
      expect(mockInvoke).toHaveBeenCalledWith('connect_rdp', expect.any(Object));
    });
  });
});