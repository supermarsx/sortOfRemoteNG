import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RDPClient from "../../src/components/rdp/RDPClient";
import { ConnectionSession } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";

// Mock Tauri invoke + Channel
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  SERIALIZE_TO_IPC_FN: "__TAURI_TO_IPC_KEY__",
  Channel: class {
    id = 0;
    onmessage: ((data: unknown) => void) | null = null;
    constructor(handler?: (data: unknown) => void) {
      if (handler) this.onmessage = handler;
    }
    toJSON() {
      return `__CHANNEL__:${this.id}`;
    }
  },
}));

// Mock Tauri event API
const mockListeners: Record<string, (event: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (eventName: string, handler: (event: { payload: unknown }) => void) => {
      mockListeners[eventName] = handler;
      return Promise.resolve(() => {
        delete mockListeners[eventName];
      });
    },
  ),
}));

// Mock Tauri window API (getCurrentWindow)
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// Mock rdpCanvas (FrameBuffer class used by the live frame listener)
vi.mock("../../src/components/rdp/rdpCanvas", () => ({
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
    paintDirect() {
      this.hasPainted = true;
    }
    syncFromVisible() {}
    applyRegion() {
      this.hasPainted = true;
    }
    resize() {}
    blitTo() {}
    blitFull() {}
  },
}));

// Mock useConnections hook
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [mockConnection],
    },
    dispatch: vi.fn(),
  }),
}));

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(tauriInvoke);

const mockConnection = {
  id: "test-connection",
  name: "Test RDP Server",
  protocol: "rdp" as const,
  hostname: "192.168.1.100",
  port: 3389,
  username: "testuser",
  password: "testpass",
  privateKey: null,
  passphrase: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isGroup: false,
};

const mockSession: ConnectionSession = {
  id: "test-rdp-session",
  connectionId: "test-connection",
  name: "Test RDP Session",
  protocol: "rdp",
  hostname: "192.168.1.100",
  status: "connecting",
  startTime: new Date(),
};

/** Simulate the backend emitting a status event */
function emitStatus(
  status: string,
  message: string,
  sessionId = "rdp-session-123",
  desktopWidth?: number,
  desktopHeight?: number,
) {
  const handler = mockListeners["rdp://status"];
  if (handler) {
    handler({
      payload: {
        session_id: sessionId,
        status,
        message,
        desktop_width: desktopWidth,
        desktop_height: desktopHeight,
      },
    });
  }
}

const renderWithProviders = (session: ConnectionSession) => {
  return render(
    <ToastProvider>
      <ConnectionProvider>
        <RDPClient session={session} />
      </ConnectionProvider>
    </ToastProvider>,
  );
};

describe("RDPClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockListeners).forEach((k) => delete mockListeners[k]);
    // Default mock: list_rdp_sessions returns empty array (no existing session),
    // then connect_rdp returns a session ID.
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_rdp_sessions") return [];
      if (cmd === "detect_keyboard_layout") return 0x0409;
      return "rdp-session-123";
    });

    // Mock canvas getContext to return a mock context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      font: "",
      textAlign: "",
    })) as any;
  });

  describe("RDP Connection", () => {
    it("should call connect_rdp with new parameters", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.objectContaining({
            connectionId: "test-connection",
            host: "192.168.1.100",
            port: 3389,
            username: "testuser",
            password: "testpass",
            width: 1920,
            height: 1080,
          }),
        );
      });
    });

    it("should display connecting status initially", () => {
      renderWithProviders(mockSession);
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });

    it("should display connected status when backend emits connected event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      // Simulate backend connected event
      emitStatus(
        "connected",
        "Connected (1920x1080)",
        "rdp-session-123",
        1920,
        1080,
      );

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });
    });

    it("should display error status when backend emits error event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("error", "Authentication failed", "rdp-session-123");

      await waitFor(() => {
        expect(screen.getByText("error")).toBeInTheDocument();
      });
    });

    it("should display error when connect_rdp command fails", async () => {
      // list_rdp_sessions returns empty (no existing session),
      // detect_keyboard_layout succeeds, then connect_rdp rejects.
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_rdp_sessions") return [];
        if (cmd === "detect_keyboard_layout") return 0x0409;
        if (cmd === "connect_rdp") throw new Error("RDP connection failed");
        return "rdp-session-123";
      });

      renderWithProviders(mockSession);

      await waitFor(
        () => {
          expect(screen.getByText("Connection Failed")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
    });
  });

  describe("Canvas Rendering", () => {
    it("should render canvas element", () => {
      renderWithProviders(mockSession);
      const canvas = document.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("should set canvas dimensions from desktop size event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      await waitFor(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.width).toBe(1920);
        expect(canvas.height).toBe(1080);
      });
    });
  });

  describe("UI Controls", () => {
    it("should render control buttons", () => {
      renderWithProviders(mockSession);
      expect(
        document.querySelector('[data-tooltip="Fullscreen"]'),
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-tooltip="RDP Settings"]'),
      ).toBeInTheDocument();
    });

    it("should toggle fullscreen mode", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const fullscreenButton = document.querySelector('[data-tooltip="Fullscreen"]') as HTMLElement;
      fullscreenButton.click();

      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("Settings", () => {
    it("should toggle settings panel", async () => {
      renderWithProviders(mockSession);

      const settingsButton = document.querySelector('[data-tooltip="RDP Settings"]') as HTMLElement;
      settingsButton.click();

      await waitFor(() => {
        expect(screen.getByText("Resolution")).toBeInTheDocument();
      });
    });
  });

  describe("RDP Internals", () => {
    it("should toggle internals panel", async () => {
      renderWithProviders(mockSession);

      const internalsButton = document.querySelector('[data-tooltip="RDP Internals"]') as HTMLElement;
      internalsButton.click();

      await waitFor(() => {
        expect(screen.getByText("RDP Session Internals")).toBeInTheDocument();
        expect(
          screen.getByText("Waiting for session statistics..."),
        ).toBeInTheDocument();
      });
    });

    it("should display stats when rdp://stats event is received", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      // Open internals panel
      const internalsButton = document.querySelector('[data-tooltip="RDP Internals"]') as HTMLElement;
      internalsButton.click();

      // Simulate stats event
      const statsHandler = mockListeners["rdp://stats"];
      if (statsHandler) {
        statsHandler({
          payload: {
            session_id: "rdp-session-123",
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
            phase: "active",
            last_error: null,
          },
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

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const statusIcon = document.querySelector("svg");
      expect(statusIcon).toBeInTheDocument();
    });

    it("should show correct icon for connecting status", () => {
      mockInvoke.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve("session-id"), 100),
          ),
      );

      renderWithProviders(mockSession);
      expect(screen.getByText("connecting")).toBeInTheDocument();
    });
  });

  describe("Input Handling", () => {
    it("should send input events when connected", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeInTheDocument();
      });

      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      canvas.click();

      // Canvas should still be in the document after interaction
      expect(canvas).toBeInTheDocument();
    });
  });

  describe("Cleanup", () => {
    it("should cleanup on unmount", async () => {
      const { unmount } = renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      unmount();

      // Cleanup does NOT call detach_rdp_session — session stays alive
      // for reattachment via useSessionDetach.
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "detach_rdp_session",
        expect.any(Object),
      );
    });
  });
});
