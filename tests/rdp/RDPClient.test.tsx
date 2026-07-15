import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RDPClient from "../../src/components/rdp/RDPClient";
import { ConnectionSession } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { getStoredIdentity } from "../../src/utils/auth/trustStore";

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

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  private readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static reset() {
    MockResizeObserver.instances = [];
  }

  static emitAll(width: number, height: number) {
    for (const instance of MockResizeObserver.instances) {
      const entries = Array.from(instance.observed).map((target) => ({
        target,
        contentRect: { width, height },
      })) as ResizeObserverEntry[];

      if (entries.length > 0) {
        instance.callback(entries, instance as unknown as ResizeObserver);
      }
    }
  }
}

globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

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
    act(() => {
      handler({
        payload: {
          session_id: sessionId,
          status,
          message,
          desktop_width: desktopWidth,
          desktop_height: desktopHeight,
        },
      });
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
    MockResizeObserver.reset();
    localStorage.clear();
    delete (mockConnection as any).security;
    delete (mockConnection as any).proxyChainId;
    delete (mockConnection as any).tunnelChainId;
    delete (mockConnection as any).connectionChainId;
    // Default mock: list_rdp_sessions returns empty array (no existing session),
    // then connect_rdp returns a session ID.
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_rdp_sessions") return [];
      if (cmd === "detect_keyboard_layout") return 0x0409;
      if (cmd === "rdp_set_desktop_size") return { width: 1280, height: 720 };
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

    it("creates the resolved final SSH bastion before connecting RDP", async () => {
      (mockConnection as any).security = {
        tunnelChain: [
          {
            id: "proxy-hop",
            type: "proxy",
            enabled: true,
            proxy: {
              proxyType: "socks5",
              host: "proxy.example.test",
              port: 1080,
              password: "proxy-secret",
            },
          },
          {
            id: "bastion-hop",
            type: "ssh-tunnel",
            enabled: true,
            sshTunnel: {
              host: "bastion.example.test",
              port: 2200,
              username: "jump-user",
              password: "jump-secret",
              forwardType: "local",
            },
          },
        ],
      };
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_rdp_sessions") return [];
        if (cmd === "detect_keyboard_layout") return 0x0409;
        if (cmd === "connect_ssh") return "ssh-path-session";
        if (cmd === "setup_rdp_tunnel") {
          return { tunnel_id: "rdp-path-tunnel", local_port: 43189 };
        }
        if (cmd === "connect_rdp") return "rdp-session-123";
        return undefined;
      });

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("connect_ssh", {
          config: expect.objectContaining({
            host: "bastion.example.test",
            port: 2200,
            username: "jump-user",
            password: "jump-secret",
            proxy_config: expect.objectContaining({
              proxy_type: "socks5",
              host: "proxy.example.test",
              port: 1080,
              password: "proxy-secret",
            }),
          }),
        });
        expect(mockInvoke).toHaveBeenCalledWith(
          "setup_rdp_tunnel",
          expect.objectContaining({
            sessionId: "ssh-path-session",
            config: expect.objectContaining({
              remote_rdp_host: "192.168.1.100",
              remote_rdp_port: 3389,
            }),
          }),
        );
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.objectContaining({
            host: "127.0.0.1",
            port: 43189,
          }),
        );
      });
    });

    it("blocks proxy-only RDP paths instead of bypassing them", async () => {
      (mockConnection as any).security = {
        tunnelChain: [
          {
            id: "proxy-only",
            type: "proxy",
            enabled: true,
            proxy: {
              proxyType: "socks5",
              host: "proxy.example.test",
              port: 1080,
            },
          },
        ],
      };

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(screen.getByText("Connection Failed")).toBeInTheDocument();
      });
      expect(
        mockInvoke.mock.calls.some(([command]) => command === "connect_rdp"),
      ).toBe(false);
      expect(
        mockInvoke.mock.calls.some(([command]) => command === "connect_ssh"),
      ).toBe(false);
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

    it("should expose an accessible canvas label and release shortcut", () => {
      renderWithProviders(mockSession);

      const canvas = screen.getByTestId("rdp-canvas");
      expect(canvas).toHaveAttribute(
        "aria-label",
        "Remote desktop session to 192.168.1.100. Press Ctrl+Alt+End to release keyboard focus.",
      );
      expect(canvas).toHaveAttribute("aria-keyshortcuts", "Control+Alt+End");
    });

    it("should set canvas dimensions from desktop size event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      await act(async () => {
        emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);
      });

      await waitFor(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.width).toBe(1920);
        expect(canvas.height).toBe(1080);
      });
    });

    it("should request backend desktop resize when the connected container changes size", async () => {
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

      await act(async () => {
        MockResizeObserver.emitAll(1280, 720);
      });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "rdp_set_desktop_size",
          {
            sessionId: "rdp-session-123",
            width: 1280,
            height: 720,
          },
        );
      });
    });

    it("should release canvas focus on Ctrl+Alt+End without sending input", () => {
      renderWithProviders(mockSession);

      const canvas = screen.getByTestId("rdp-canvas") as HTMLCanvasElement;
      canvas.focus();
      expect(document.activeElement).toBe(canvas);

      fireEvent.keyDown(canvas, {
        key: "End",
        code: "End",
        ctrlKey: true,
        altKey: true,
      });

      expect(document.activeElement).not.toBe(canvas);
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "rdp_send_input",
        expect.anything(),
      );
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

    it("should display lifecycle snapshots from rdp://lifecycle", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      const internalsButton = document.querySelector('[data-tooltip="RDP Internals"]') as HTMLElement;
      internalsButton.click();

      await act(async () => {
        mockListeners["rdp://stats"]?.({
          payload: {
            session_id: "rdp-session-123",
            uptime_secs: 42,
            bytes_received: 1048576,
            bytes_sent: 65536,
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
        mockListeners["rdp://lifecycle"]?.({
          payload: {
            sessionId: "rdp-session-123",
            state: "active",
            activeSubstate: "running",
            phaseStartedAtMs: 10,
            transitionCount: 7,
            reconnectAttempt: 0,
            channelSummary: {
              enabledCount: 2,
              readyCount: 2,
              failedCount: 0,
            },
            frameFlowSummary: {
              queuedFrames: 0,
              deliveredFrames: 300,
              droppedFrames: 0,
            },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("Lifecycle")).toBeInTheDocument();
        expect(screen.getByText("running")).toBeInTheDocument();
        expect(screen.getByText("Transitions")).toBeInTheDocument();
        expect(screen.getByText("7")).toBeInTheDocument();
      });
    });

    it("renders channel/frame/failure-class diagnostics rows from a rich rdp://lifecycle event", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      const internalsButton = document.querySelector('[data-tooltip="RDP Internals"]') as HTMLElement;
      internalsButton.click();

      await act(async () => {
        mockListeners["rdp://stats"]?.({
          payload: {
            session_id: "rdp-session-123",
            uptime_secs: 42,
            bytes_received: 1048576,
            bytes_sent: 65536,
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
        mockListeners["rdp://lifecycle"]?.({
          payload: {
            sessionId: "rdp-session-123",
            state: "active",
            activeSubstate: "running",
            phaseStartedAtMs: 10,
            transitionCount: 7,
            reconnectAttempt: 0,
            lastFailureClass: "credssp-auth",
            channelSummary: {
              enabledCount: 4,
              readyCount: 3,
              failedCount: 1,
            },
            frameFlowSummary: {
              queuedFrames: 12,
              deliveredFrames: 287,
              droppedFrames: 5,
              coalescedFrames: 9,
              averageRenderMs: 4.25,
            },
          },
        });
      });

      await waitFor(() => {
        // Channel summary rows
        expect(screen.getByText("Channels Enabled")).toBeInTheDocument();
        expect(screen.getByText("Channels Ready")).toBeInTheDocument();
        // readyCount/enabledCount is rendered as separate text nodes ({x}/{y}),
        // so match the containing cell value rather than a single text node.
        expect(
          screen.getByText(
            (_content, el) =>
              el?.className?.includes?.("font-mono") === true &&
              el.textContent?.replace(/\s+/g, "") === "3/4",
          ),
        ).toBeInTheDocument();
        expect(screen.getByText("Channel Faults")).toBeInTheDocument();

        // Frame-flow rows, including the new coalesced + avg-render fields
        expect(screen.getByText("Frames Queued")).toBeInTheDocument();
        expect(screen.getByText("12")).toBeInTheDocument();
        expect(screen.getByText("Frames Delivered")).toBeInTheDocument();
        expect(screen.getByText("287")).toBeInTheDocument();
        expect(screen.getByText("Frames Dropped")).toBeInTheDocument();
        expect(screen.getByText("Frames Coalesced")).toBeInTheDocument();
        expect(screen.getByText("9")).toBeInTheDocument();
        // Avg Render: when averageRenderMs is a number, the value cell renders
        // the ms-formatted value (not the em-dash placeholder). The label sits
        // in a sibling cell; assert the label row exists and that its value cell
        // is present-and-non-dash.
        const avgRenderLabel = screen.getByText("Avg Render");
        const avgRenderValue =
          avgRenderLabel.parentElement?.querySelector(".font-mono");
        expect(avgRenderValue).toBeTruthy();
        expect(avgRenderValue?.textContent).not.toBe("–");

        // Failure class shows the populated class
        expect(screen.getByText("Failure Class")).toBeInTheDocument();
        expect(screen.getByText("credssp-auth")).toBeInTheDocument();
      });
    });

    it("renders defensively for a pre-L2 lifecycle event (no coalesced/avgRender/failureClass)", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      emitStatus("connected", "Connected", "rdp-session-123", 1920, 1080);

      const internalsButton = document.querySelector('[data-tooltip="RDP Internals"]') as HTMLElement;
      internalsButton.click();

      await act(async () => {
        mockListeners["rdp://stats"]?.({
          payload: {
            session_id: "rdp-session-123",
            uptime_secs: 42,
            bytes_received: 1048576,
            bytes_sent: 65536,
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
        // Pre-L2 shape: no coalescedFrames, no averageRenderMs, no lastFailureClass.
        mockListeners["rdp://lifecycle"]?.({
          payload: {
            sessionId: "rdp-session-123",
            state: "active",
            activeSubstate: "running",
            phaseStartedAtMs: 10,
            transitionCount: 3,
            reconnectAttempt: 0,
            channelSummary: {
              enabledCount: 2,
              readyCount: 2,
              failedCount: 0,
            },
            frameFlowSummary: {
              queuedFrames: 0,
              deliveredFrames: 300,
              droppedFrames: 0,
            },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("Frames Coalesced")).toBeInTheDocument();
        expect(screen.getByText("Avg Render")).toBeInTheDocument();
        expect(screen.getByText("Failure Class")).toBeInTheDocument();
        // Absent optional fields render the em-dash placeholder (U+2013).
        const dashes = screen.getAllByText("–");
        // coalescedFrames, averageRenderMs, and lastFailureClass are all absent here.
        expect(dashes.length).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe("Certificate Trust", () => {
    it("stores first-use RDP certificate fingerprints as rdp records", async () => {
      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });
      await waitFor(() => {
        expect(mockListeners["rdp://cert-fingerprint"]).toBeDefined();
      });

      await act(async () => {
        mockListeners["rdp://cert-fingerprint"]({
          payload: {
            session_id: "rdp-session-123",
            fingerprint: "SHA256:rdp-first-use",
            host: "192.168.1.100",
            port: 3389,
            subject: "CN=192.168.1.100",
            issuer: "CN=Lab CA",
          },
        });
      });

      await waitFor(() => {
        expect(
          getStoredIdentity("192.168.1.100", 3389, "rdp", "test-connection")?.identity.fingerprint,
        ).toBe("SHA256:rdp-first-use");
      });
      expect(
        getStoredIdentity("192.168.1.100", 3389, "tls", "test-connection"),
      ).toBeUndefined();
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
