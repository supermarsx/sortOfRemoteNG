import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RDPClient from "../../src/components/rdp/RDPClient";
import {
  ConnectionSession,
  MAX_SESSION_VPN_LEASE_BINDINGS,
} from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { getStoredIdentity } from "../../src/utils/auth/trustStore";
import { useRDPClient } from "../../src/hooks/rdp/useRDPClient";
import {
  hasSessionLifecycleActorAttempt,
  resetSessionLifecycleAllocatorForTests,
} from "../../src/utils/session/sessionLifecycle";

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

globalThis.ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

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

const connectionContextMocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

// Mock useConnections hook
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [mockConnection],
    },
    dispatch: connectionContextMocks.dispatch,
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

const hookWrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <ConnectionProvider>{children}</ConnectionProvider>
  </ToastProvider>
);

const installOpenVpnLeaseRuntime = (
  options: {
    connectError?: Error;
    disconnectError?: Error;
    releaseErrors?: (ownerId: string, attempt: number) => string[];
  } = {},
) => {
  const acquiredOwners: string[] = [];
  const releaseCalls: string[] = [];
  const releaseAttempts = new Map<string, number>();

  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const ownerId = String((args as { ownerId?: string } | undefined)?.ownerId);
    if (cmd === "list_rdp_sessions") return [];
    if (cmd === "list_openvpn_connections") {
      return [
        {
          id: "vpn-office",
          name: "Office VPN",
          config: {},
          status: "disconnected",
          created_at: "2026-07-19T00:00:00.000Z",
        },
      ];
    }
    if (
      cmd === "list_wireguard_connections" ||
      cmd === "list_tailscale_connections" ||
      cmd === "list_zerotier_connections"
    ) {
      return [];
    }
    if (cmd === "acquire_vpn_leases") {
      acquiredOwners.push(ownerId);
      return {
        owner_id: ownerId,
        leases: [
          {
            vpn_type: "openvpn",
            connection_id: "vpn-office",
            was_already_connected: false,
            already_owned: false,
            started_by_lifecycle: true,
            lease_count: 1,
          },
        ],
      };
    }
    if (cmd === "release_vpn_leases") {
      releaseCalls.push(ownerId);
      const attempt = (releaseAttempts.get(ownerId) ?? 0) + 1;
      releaseAttempts.set(ownerId, attempt);
      return {
        owner_id: ownerId,
        released: [],
        errors: options.releaseErrors?.(ownerId, attempt) ?? [],
      };
    }
    if (cmd === "detect_keyboard_layout") return 0x0409;
    if (cmd === "connect_rdp") {
      if (options.connectError) throw options.connectError;
      return "rdp-session-123";
    }
    if (cmd === "disconnect_rdp") {
      if (options.disconnectError) throw options.disconnectError;
      return undefined;
    }
    return undefined;
  });

  return { acquiredOwners, releaseCalls, releaseAttempts };
};

describe("RDPClient", () => {
  beforeEach(() => {
    resetSessionLifecycleAllocatorForTests();
    vi.clearAllMocks();
    Object.keys(mockListeners).forEach((k) => delete mockListeners[k]);
    MockResizeObserver.reset();
    connectionContextMocks.dispatch.mockReset();
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

    it("acquires a session VPN before RDP and releases it after target disconnect", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "list_rdp_sessions") return [];
        if (cmd === "list_openvpn_connections") {
          return [
            {
              id: "vpn-office",
              name: "Office VPN",
              config: {},
              status: "disconnected",
              created_at: "2026-07-19T00:00:00.000Z",
            },
          ];
        }
        if (
          cmd === "list_wireguard_connections" ||
          cmd === "list_tailscale_connections" ||
          cmd === "list_zerotier_connections"
        ) {
          return [];
        }
        if (cmd === "acquire_vpn_leases") {
          const ownerId = String((args as { ownerId: string }).ownerId);
          return {
            owner_id: ownerId,
            leases: [
              {
                vpn_type: "openvpn",
                connection_id: "vpn-office",
                was_already_connected: false,
                already_owned: false,
                started_by_lifecycle: true,
                lease_count: 1,
              },
            ],
          };
        }
        if (cmd === "release_vpn_leases") {
          return {
            owner_id: String((args as { ownerId: string }).ownerId),
            released: [],
            errors: [],
          };
        }
        if (cmd === "detect_keyboard_layout") return 0x0409;
        if (cmd === "connect_rdp") return "rdp-session-123";
        return undefined;
      });

      renderWithProviders(mockSession);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "acquire_vpn_leases",
          expect.objectContaining({
            ownerId: expect.stringMatching(
              /^test-rdp-session:rdp:[0-9a-f-]+$/i,
            ),
            requests: [
              {
                vpn_type: "openvpn",
                connection_id: "vpn-office",
                auto_connect: true,
              },
            ],
          }),
        );
        expect(mockInvoke).toHaveBeenCalledWith(
          "connect_rdp",
          expect.any(Object),
        );
      });

      const acquireCallIndex = mockInvoke.mock.calls.findIndex(
        ([command]) => command === "acquire_vpn_leases",
      );
      const acquireOwnerId = (
        mockInvoke.mock.calls[acquireCallIndex]?.[1] as { ownerId: string }
      ).ownerId;
      const ownerSnapshotCallIndex =
        connectionContextMocks.dispatch.mock.calls.findIndex(
          ([action]) =>
            action.type === "UPDATE_SESSION" &&
            action.payload.vpnLeaseOwnerIds?.includes(acquireOwnerId),
        );
      expect(ownerSnapshotCallIndex).toBeGreaterThanOrEqual(0);
      expect(
        connectionContextMocks.dispatch.mock.invocationCallOrder[
          ownerSnapshotCallIndex
        ],
      ).toBeLessThan(mockInvoke.mock.invocationCallOrder[acquireCallIndex]);

      let commands = mockInvoke.mock.calls.map(([command]) => command);
      expect(commands.indexOf("acquire_vpn_leases")).toBeLessThan(
        commands.indexOf("connect_rdp"),
      );

      emitStatus(
        "connected",
        "Connected (1920x1080)",
        "rdp-session-123",
        1920,
        1080,
      );
      const disconnectButton = document.querySelector<HTMLButtonElement>(
        'button[data-tooltip="Disconnect"]',
      );
      expect(disconnectButton).not.toBeNull();
      fireEvent.click(disconnectButton!);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("release_vpn_leases", {
          ownerId: expect.stringMatching(/^test-rdp-session:rdp:[0-9a-f-]+$/i),
        });
      });
      commands = mockInvoke.mock.calls.map(([command]) => command);
      expect(commands.lastIndexOf("disconnect_rdp")).toBeLessThan(
        commands.lastIndexOf("release_vpn_leases"),
      );
    });

    it("clears a persisted VPN owner without releasing it again on a stale rerender", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime();
      const { result, rerender } = renderHook(
        ({ activeSession }: { activeSession: ConnectionSession }) =>
          useRDPClient(activeSession),
        {
          initialProps: { activeSession: mockSession },
          wrapper: hookWrapper,
        },
      );

      await waitFor(() => expect(acquiredOwners).toHaveLength(1));
      const ownerId = acquiredOwners[0];
      rerender({
        activeSession: { ...mockSession, vpnLeaseOwnerId: ownerId },
      });

      await act(async () => {
        await result.current.handleDisconnect();
      });
      expect(releaseCalls).toEqual([ownerId]);
      expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ vpnLeaseOwnerId: undefined }),
      });

      // Simulate a stale parent render that still carries the released token.
      rerender({
        activeSession: { ...mockSession, vpnLeaseOwnerId: ownerId },
      });
      await act(async () => {
        await result.current.handleDisconnect();
      });
      expect(releaseCalls).toEqual([ownerId]);
    });

    it("retains a failed attempt owner and releases it after a later retry", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime({
        connectError: new Error("RDP target refused the connection"),
        releaseErrors: (_ownerId, attempt) =>
          attempt === 1 ? ["OpenVPN remained active after disconnect"] : [],
      });
      const { result } = renderHook(() => useRDPClient(mockSession), {
        wrapper: hookWrapper,
      });

      await waitFor(() =>
        expect(result.current.connectionStatus).toBe("error"),
      );
      expect(acquiredOwners).toHaveLength(1);
      expect(releaseCalls).toEqual([acquiredOwners[0]]);

      await act(async () => {
        await result.current.handleDisconnect();
      });
      expect(releaseCalls).toEqual([acquiredOwners[0], acquiredOwners[0]]);

      await act(async () => {
        await result.current.handleDisconnect();
      });
      expect(releaseCalls).toHaveLength(2);
    });

    it("closes a post-create RDP actor before releasing its VPN when binding throws", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const invalidOwnershipSession: ConnectionSession = {
        ...mockSession,
        vpnLeaseBindings: [
          {
            ownerId: "",
            backendSessionId: "invalid-existing-actor",
            protocol: "rdp",
            status: "active",
          },
        ],
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime();
      const { result } = renderHook(
        () => useRDPClient(invalidOwnershipSession),
        { wrapper: hookWrapper },
      );

      await waitFor(() =>
        expect(result.current.connectionStatus).toBe("error"),
      );
      expect(acquiredOwners).toHaveLength(1);
      expect(releaseCalls).toEqual([acquiredOwners[0]]);
      const commands = mockInvoke.mock.calls.map(([command]) => command);
      expect(commands.indexOf("connect_rdp")).toBeGreaterThanOrEqual(0);
      expect(commands.indexOf("connect_rdp")).toBeLessThan(
        commands.indexOf("disconnect_rdp"),
      );
      expect(commands.indexOf("disconnect_rdp")).toBeLessThan(
        commands.indexOf("release_vpn_leases"),
      );
      expect(mockInvoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-session-123",
      });
    });

    it("fails before VPN acquisition or RDP creation at the binding safety cap", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const cappedSession: ConnectionSession = {
        ...mockSession,
        vpnLeaseBindings: Array.from(
          { length: MAX_SESSION_VPN_LEASE_BINDINGS },
          (_, index) => ({
            ownerId: `capped-owner-${index}`,
            backendSessionId: `capped-backend-${index}`,
            protocol: "rdp" as const,
            status: "cleanup-pending" as const,
          }),
        ),
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime();
      const { result } = renderHook(() => useRDPClient(cappedSession), {
        wrapper: hookWrapper,
      });

      await waitFor(() =>
        expect(result.current.connectionStatus).toBe("error"),
      );
      expect(acquiredOwners).toEqual([]);
      expect(releaseCalls).toEqual([]);
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "connect_rdp",
        expect.anything(),
      );
    });

    it("does not release the RDP owner when native disconnect fails", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime({
        disconnectError: new Error("native session still active"),
      });
      const { result } = renderHook(() => useRDPClient(mockSession), {
        wrapper: hookWrapper,
      });
      await waitFor(() => {
        expect(acquiredOwners).toHaveLength(1);
        expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
          type: "UPDATE_SESSION",
          payload: expect.objectContaining({
            backendSessionId: "rdp-session-123",
          }),
        });
      });

      let disconnected = true;
      await act(async () => {
        disconnected = await result.current.handleDisconnect();
      });
      expect(disconnected).toBe(false);
      expect(releaseCalls).toEqual([]);
      expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          status: "error",
          errorMessage: expect.stringMatching(/RDP disconnect failed/i),
          vpnLeaseOwnerIds: [acquiredOwners[0]],
        }),
      });
    });

    it("keeps a failed post-disconnect owner visible and clears it on retry", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime({
        releaseErrors: (_ownerId, attempt) =>
          attempt === 1 ? ["provider still stopping"] : [],
      });
      const { result } = renderHook(() => useRDPClient(mockSession), {
        wrapper: hookWrapper,
      });
      await waitFor(() => expect(acquiredOwners).toHaveLength(1));

      let disconnected = true;
      await act(async () => {
        disconnected = await result.current.handleDisconnect();
      });
      expect(disconnected).toBe(false);
      expect(releaseCalls).toEqual([acquiredOwners[0]]);
      expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          backendSessionId: undefined,
          status: "error",
          errorMessage: expect.stringMatching(/VPN cleanup needs attention/i),
          vpnLeaseOwnerIds: [acquiredOwners[0]],
        }),
      });

      await act(async () => {
        disconnected = await result.current.handleDisconnect();
      });
      expect(disconnected).toBe(true);
      expect(releaseCalls).toEqual([acquiredOwners[0], acquiredOwners[0]]);
      expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          status: "disconnected",
          vpnLeaseOwnerId: undefined,
          vpnLeaseOwnerIds: undefined,
        }),
      });
    });

    it("keeps a new current owner while a prior handoff cleanup remains pending", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const oldOwnerId = "rdp-old-owner";
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime({
        releaseErrors: (ownerId, attempt) =>
          ownerId === oldOwnerId && attempt === 1
            ? ["OpenVPN remained active after disconnect"]
            : [],
      });
      const sessionWithOldOwner = {
        ...mockSession,
        vpnLeaseOwnerId: oldOwnerId,
      };
      const { result } = renderHook(() => useRDPClient(sessionWithOldOwner), {
        wrapper: hookWrapper,
      });

      await waitFor(() => {
        expect(acquiredOwners).toHaveLength(1);
        expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
          type: "UPDATE_SESSION",
          payload: expect.objectContaining({
            vpnLeaseOwnerId: acquiredOwners[0],
            vpnLeaseOwnerIds: expect.arrayContaining([
              oldOwnerId,
              acquiredOwners[0],
            ]),
          }),
        });
      });
      const currentOwnerId = acquiredOwners[0];
      expect(releaseCalls).toEqual([oldOwnerId]);

      emitStatus("disconnected", "Remote session closed", "rdp-session-123");
      await waitFor(() => {
        expect(releaseCalls).toHaveLength(3);
      });
      expect(
        releaseCalls.filter((ownerId) => ownerId === oldOwnerId),
      ).toHaveLength(2);
      expect(
        releaseCalls.filter((ownerId) => ownerId === currentOwnerId),
      ).toHaveLength(1);

      // Pending/current/persisted sources are deduplicated, and successful
      // cleanup removes both tokens from every source.
      await act(async () => {
        await result.current.handleDisconnect();
      });
      expect(releaseCalls).toHaveLength(3);
    });

    it("persists a failed prior owner with its replacement across a view-only unmount", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const oldOwnerId = "rdp-old-owner-for-detach";
      const { acquiredOwners, releaseCalls } = installOpenVpnLeaseRuntime({
        releaseErrors: (ownerId) =>
          ownerId === oldOwnerId ? ["provider still stopping"] : [],
      });
      const sessionWithOldOwner = {
        ...mockSession,
        vpnLeaseOwnerId: oldOwnerId,
        vpnLeaseOwnerIds: [oldOwnerId],
      };
      const view = renderHook(() => useRDPClient(sessionWithOldOwner), {
        wrapper: hookWrapper,
      });

      await waitFor(() => {
        expect(acquiredOwners).toHaveLength(1);
        expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
          type: "UPDATE_SESSION",
          payload: expect.objectContaining({
            vpnLeaseOwnerId: acquiredOwners[0],
            vpnLeaseOwnerIds: expect.arrayContaining([
              oldOwnerId,
              acquiredOwners[0],
            ]),
          }),
        });
      });

      view.unmount();
      await act(async () => Promise.resolve());
      expect(releaseCalls).toEqual([oldOwnerId]);
      expect(releaseCalls).not.toContain(acquiredOwners[0]);
    });

    it("releases a stale handed-off VPN owner without touching its replacement", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const overlapSession = {
        ...mockSession,
        vpnLeaseOwnerId: "rdp-old-owner",
      };
      const liveOwners = new Set<string>(["rdp-old-owner"]);
      const acquiredOwners: string[] = [];
      const releaseCalls: string[] = [];
      let allowOldOwnerRelease!: () => void;
      const oldOwnerReleaseGate = new Promise<void>((resolve) => {
        allowOldOwnerRelease = resolve;
      });
      let connectCount = 0;

      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        const invokeArgs = args as
          | { ownerId?: string; sessionId?: string }
          | undefined;
        const ownerId = String(invokeArgs?.ownerId);
        if (cmd === "list_rdp_sessions") return [];
        if (cmd === "list_openvpn_connections") {
          return [
            {
              id: "vpn-office",
              name: "Office VPN",
              config: {},
              status: "disconnected",
              created_at: "2026-07-19T00:00:00.000Z",
            },
          ];
        }
        if (
          cmd === "list_wireguard_connections" ||
          cmd === "list_tailscale_connections" ||
          cmd === "list_zerotier_connections"
        ) {
          return [];
        }
        if (cmd === "acquire_vpn_leases") {
          acquiredOwners.push(ownerId);
          liveOwners.add(ownerId);
          return {
            owner_id: ownerId,
            leases: [
              {
                vpn_type: "openvpn",
                connection_id: "vpn-office",
                was_already_connected: true,
                already_owned: false,
                started_by_lifecycle: true,
                lease_count: liveOwners.size,
              },
            ],
          };
        }
        if (cmd === "release_vpn_leases") {
          releaseCalls.push(ownerId);
          if (ownerId === "rdp-old-owner") await oldOwnerReleaseGate;
          liveOwners.delete(ownerId);
          return { owner_id: ownerId, released: [], errors: [] };
        }
        if (cmd === "detect_keyboard_layout") return 0x0409;
        if (cmd === "connect_rdp") {
          connectCount += 1;
          return `rdp-overlap-${connectCount}`;
        }
        return undefined;
      });

      let model: ReturnType<typeof useRDPClient> | null = null;
      const HookHarness = () => {
        model = useRDPClient(overlapSession);
        return null;
      };
      render(
        <ToastProvider>
          <ConnectionProvider>
            <HookHarness />
          </ConnectionProvider>
        </ToastProvider>,
      );

      await waitFor(() => {
        expect(connectCount).toBe(1);
        expect(releaseCalls).toContain("rdp-old-owner");
      });

      let replacementInit!: Promise<void>;
      act(() => {
        replacementInit = model!.initializeRDPConnection();
      });
      await waitFor(() => expect(connectCount).toBe(2));

      await act(async () => {
        allowOldOwnerRelease();
        await oldOwnerReleaseGate;
        await replacementInit;
      });
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("disconnect_rdp", {
          sessionId: "rdp-overlap-1",
        });
      });

      expect(acquiredOwners).toHaveLength(2);
      expect(acquiredOwners[0]).not.toBe(acquiredOwners[1]);
      expect(liveOwners).toEqual(new Set([acquiredOwners[1]]));
      expect(
        releaseCalls.filter((ownerId) => ownerId === "rdp-old-owner"),
      ).toHaveLength(1);
      expect(
        releaseCalls.filter((ownerId) => ownerId === acquiredOwners[0]),
      ).toHaveLength(1);
      expect(releaseCalls).not.toContain(acquiredOwners[1]);
    });

    it("retains a stale RDP backend and its owner until native cleanup retry succeeds", async () => {
      (mockConnection as any).security = {
        openvpn: { enabled: true, configId: "vpn-office" },
      };
      const acquiredOwners: string[] = [];
      const liveOwners = new Set<string>();
      const releaseCalls: string[] = [];
      let finishStaleConnect!: (sessionId: string) => void;
      const staleConnect = new Promise<string>((resolve) => {
        finishStaleConnect = resolve;
      });
      let connectCount = 0;
      let staleDisconnectAttempts = 0;

      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        const invokeArgs = args as
          | { ownerId?: string; sessionId?: string }
          | undefined;
        const ownerId = String(invokeArgs?.ownerId);
        if (cmd === "list_rdp_sessions") return [];
        if (cmd === "list_openvpn_connections") {
          return [
            {
              id: "vpn-office",
              name: "Office VPN",
              config: {},
              status: "disconnected",
              created_at: "2026-07-19T00:00:00.000Z",
            },
          ];
        }
        if (
          cmd === "list_wireguard_connections" ||
          cmd === "list_tailscale_connections" ||
          cmd === "list_zerotier_connections"
        ) {
          return [];
        }
        if (cmd === "acquire_vpn_leases") {
          acquiredOwners.push(ownerId);
          liveOwners.add(ownerId);
          return { owner_id: ownerId, leases: [] };
        }
        if (cmd === "release_vpn_leases") {
          releaseCalls.push(ownerId);
          liveOwners.delete(ownerId);
          return { owner_id: ownerId, released: [], errors: [] };
        }
        if (cmd === "detect_keyboard_layout") return 0x0409;
        if (cmd === "connect_rdp") {
          connectCount += 1;
          return connectCount === 1 ? staleConnect : "rdp-replacement";
        }
        if (cmd === "disconnect_rdp") {
          if (invokeArgs?.sessionId === "rdp-stale") {
            staleDisconnectAttempts += 1;
            if (staleDisconnectAttempts === 1) {
              throw new Error("stale RDP backend still active");
            }
          }
          return undefined;
        }
        return undefined;
      });

      const { result } = renderHook(() => useRDPClient(mockSession), {
        wrapper: hookWrapper,
      });
      await waitFor(() => expect(connectCount).toBe(1));

      let replacementInit!: Promise<void>;
      act(() => {
        replacementInit = result.current.initializeRDPConnection();
      });
      await waitFor(() => expect(connectCount).toBe(2));
      await act(async () => replacementInit);
      expect(liveOwners).toEqual(new Set(acquiredOwners));

      await act(async () => {
        finishStaleConnect("rdp-stale");
        await staleConnect;
      });
      await waitFor(() => expect(staleDisconnectAttempts).toBe(1));
      expect(releaseCalls).not.toContain(acquiredOwners[0]);
      expect(liveOwners).toEqual(new Set(acquiredOwners));
      expect(connectionContextMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          backendSessionId: "rdp-stale",
          status: "error",
          errorMessage: expect.stringMatching(/cleanup failed/i),
          vpnLeaseOwnerIds: expect.arrayContaining(acquiredOwners),
        }),
      });

      let disconnected = false;
      await act(async () => {
        disconnected = await result.current.handleDisconnect();
      });
      expect(disconnected).toBe(true);
      expect(staleDisconnectAttempts).toBe(2);
      expect(liveOwners).toEqual(new Set());
      expect(releaseCalls).toEqual(expect.arrayContaining(acquiredOwners));
      const staleDisconnectCallOrders = mockInvoke.mock.calls
        .map(([command, args], index) => ({ command, args, index }))
        .filter(
          ({ command, args }) =>
            command === "disconnect_rdp" &&
            (args as { sessionId?: string })?.sessionId === "rdp-stale",
        )
        .map(({ index }) => index);
      const staleOwnerReleaseIndex = mockInvoke.mock.calls.findIndex(
        ([command, args]) =>
          command === "release_vpn_leases" &&
          (args as { ownerId?: string })?.ownerId === acquiredOwners[0],
      );
      expect(staleOwnerReleaseIndex).toBeGreaterThan(
        staleDisconnectCallOrders[1],
      );
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
        expect(mockInvoke).toHaveBeenCalledWith("rdp_set_desktop_size", {
          sessionId: "rdp-session-123",
          width: 1280,
          height: 720,
        });
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

      const fullscreenButton = document.querySelector(
        '[data-tooltip="Fullscreen"]',
      ) as HTMLElement;
      fullscreenButton.click();

      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("Settings", () => {
    it("should toggle settings panel", async () => {
      renderWithProviders(mockSession);

      const settingsButton = document.querySelector(
        '[data-tooltip="RDP Settings"]',
      ) as HTMLElement;
      settingsButton.click();

      await waitFor(() => {
        expect(screen.getByText("Resolution")).toBeInTheDocument();
      });
    });
  });

  describe("RDP Internals", () => {
    it("should toggle internals panel", async () => {
      renderWithProviders(mockSession);

      const internalsButton = document.querySelector(
        '[data-tooltip="RDP Internals"]',
      ) as HTMLElement;
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
      const internalsButton = document.querySelector(
        '[data-tooltip="RDP Internals"]',
      ) as HTMLElement;
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

      const internalsButton = document.querySelector(
        '[data-tooltip="RDP Internals"]',
      ) as HTMLElement;
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

      const internalsButton = document.querySelector(
        '[data-tooltip="RDP Internals"]',
      ) as HTMLElement;
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

      const internalsButton = document.querySelector(
        '[data-tooltip="RDP Internals"]',
      ) as HTMLElement;
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
          getStoredIdentity("192.168.1.100", 3389, "rdp", "test-connection")
            ?.identity.fingerprint,
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
    it("aborts after deferred discovery when quarantine lands mid-init", async () => {
      let resumeDiscovery!: () => void;
      mockInvoke.mockImplementation((command: string) => {
        if (command === "list_rdp_sessions") {
          return new Promise((resolve) => {
            resumeDiscovery = () => resolve([]);
          });
        }
        return Promise.resolve(undefined);
      });
      const view = renderHook(
        ({ activeSession }: { activeSession: ConnectionSession }) =>
          useRDPClient(activeSession),
        {
          initialProps: { activeSession: mockSession },
          wrapper: hookWrapper,
        },
      );
      await waitFor(() => {
        expect(hasSessionLifecycleActorAttempt(mockSession.id)).toBe(true);
        expect(mockInvoke).toHaveBeenCalledWith("list_rdp_sessions");
      });

      const quarantined: ConnectionSession = {
        ...mockSession,
        status: "error",
        vpnLeaseCleanupQuarantine: {
          proofs: [
            {
              kind: "binding",
              ownerId: "owner-quarantined",
              backendSessionId: "backend-quarantined",
              protocol: "rdp",
              status: "cleanup-pending",
            },
          ],
          proofIncomplete: false,
        },
      };
      await act(async () => {
        view.rerender({ activeSession: quarantined });
        await Promise.resolve();
        resumeDiscovery();
      });

      await waitFor(() =>
        expect(hasSessionLifecycleActorAttempt(mockSession.id)).toBe(false),
      );
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "acquire_vpn_leases",
        expect.anything(),
      );
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "connect_rdp",
        expect.anything(),
      );
      view.unmount();
    });

    it("cancels the exact hung RDP reservation when props move from A to B", async () => {
      const fallbackInvoke = mockInvoke.getMockImplementation();
      mockInvoke.mockImplementation((command, args) => {
        if (command === "list_rdp_sessions") {
          return new Promise<never>(() => undefined);
        }
        return fallbackInvoke
          ? fallbackInvoke(command, args)
          : Promise.resolve(undefined);
      });
      const sessionB: ConnectionSession = {
        ...mockSession,
        id: "test-rdp-session-b",
      };
      const view = renderHook(
        ({ activeSession }: { activeSession: ConnectionSession }) =>
          useRDPClient(activeSession),
        {
          initialProps: { activeSession: mockSession },
          wrapper: hookWrapper,
        },
      );
      await waitFor(() =>
        expect(hasSessionLifecycleActorAttempt(mockSession.id)).toBe(true),
      );
      const reservationDispatchIndex =
        connectionContextMocks.dispatch.mock.calls.findIndex(
          ([action]) =>
            typeof action.payload?.lifecycleActorReservationId === "number",
        );
      expect(reservationDispatchIndex).toBeGreaterThanOrEqual(0);
      expect(
        connectionContextMocks.dispatch.mock.invocationCallOrder[
          reservationDispatchIndex
        ],
      ).toBeLessThan(mockInvoke.mock.invocationCallOrder[0]);

      view.rerender({ activeSession: sessionB });
      await waitFor(() => {
        expect(hasSessionLifecycleActorAttempt(mockSession.id)).toBe(false);
        expect(hasSessionLifecycleActorAttempt(sessionB.id)).toBe(true);
      });

      view.unmount();
      expect(hasSessionLifecycleActorAttempt(sessionB.id)).toBe(false);
    });

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
