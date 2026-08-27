import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// The real VNC client needs the app's connection/session contexts and a native
// backend; here it is a probe that reports the props it would connect with.
vi.mock("../../src/components/protocol/VNCClient", () => ({
  VNCClient: ({
    session,
  }: {
    session: { id: string; connectionId: string };
  }) => (
    <div data-testid="vnc-client">
      <span data-testid="vnc-client-session">{session.id}</span>
      <span data-testid="vnc-client-connection">{session.connectionId}</span>
    </div>
  ),
}));

const registry = vi.hoisted(() => ({
  registered: [] as Array<Record<string, unknown>>,
  released: [] as string[],
}));

vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  registerRuntimeConnection: (connection: Record<string, unknown>) => {
    registry.registered.push(connection);
  },
  releaseRuntimeConnection: (id: string) => {
    registry.released.push(id);
  },
  resolveRuntimeConnection: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ProxmoxVncConsole, {
  buildProxmoxVncConnection,
  buildProxmoxVncSession,
  type ProxmoxVncBridgeHandle,
} from "../../src/components/proxmox/ProxmoxVncConsole";
import type { ProxmoxVncTarget } from "../../src/hooks/proxmox/useProxmoxConsole";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();

const emit = (event: string, payload: unknown) => {
  for (const handler of handlers.get(event) ?? []) handler({ payload });
};

const BRIDGE: ProxmoxVncBridgeHandle = {
  bridgeId: "bridge-1",
  localPort: 49871,
  ticket: "PVEVNC:ticket",
  user: "root@pam",
  node: "pve1",
  vmid: 100,
  vmType: "qemu",
};

const TARGET: ProxmoxVncTarget = {
  node: "pve1",
  vmid: 100,
  vmType: "qemu",
  label: "web-01",
};

describe("ProxmoxVncConsole", () => {
  beforeEach(() => {
    handlers.clear();
    registry.registered = [];
    registry.released = [];
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockListen.mockImplementation((async (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return vi.fn(() => set.delete(handler));
    }) as unknown as typeof listen);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_vnc_bridge_open") return BRIDGE;
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the loopback bridge for the target", async () => {
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    expect(await screen.findByTestId("proxmox-vnc-overlay")).toBeTruthy();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_vnc_bridge_open", {
        node: "pve1",
        vmid: 100,
        vmType: "qemu",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-vnc-status").textContent).toBe(
        "Connected",
      ),
    );
    expect(screen.getByTestId("proxmox-vnc-endpoint").textContent).toBe(
      "127.0.0.1:49871",
    );
  });

  it("mounts the VNC client against loopback with the ticket as the password", async () => {
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    await screen.findByTestId("vnc-client");

    expect(registry.registered).toHaveLength(1);
    const connection = registry.registered[0];
    expect(connection).toMatchObject({
      id: "proxmox-vnc-bridge-1",
      protocol: "vnc",
      hostname: "127.0.0.1",
      port: 49871,
      password: "PVEVNC:ticket",
      vncAllowUnencryptedTransport: true,
    });
    expect(screen.getByTestId("vnc-client-connection").textContent).toBe(
      "proxmox-vnc-bridge-1",
    );
  });

  it("shows a placeholder until the bridge is up", async () => {
    let releaseOpen: (() => void) | null = null;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_vnc_bridge_open") {
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
        return BRIDGE;
      }
      return undefined;
    });
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    expect(screen.getByTestId("proxmox-vnc-status").textContent).toBe(
      "Opening…",
    );
    expect(screen.queryByTestId("vnc-client")).toBeNull();
    await waitFor(() => expect(releaseOpen).not.toBeNull());
    await act(async () => {
      releaseOpen?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await screen.findByTestId("vnc-client");
  });

  it("reports a bridge that PVE tears down", async () => {
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    await screen.findByTestId("vnc-client");
    act(() => {
      emit("proxmox-vnc-bridge-closed", {
        bridgeId: "bridge-1",
        reason: "Proxmox VE closed the VNC connection",
      });
    });
    expect(
      (await screen.findByTestId("proxmox-vnc-close-reason")).textContent,
    ).toContain("Proxmox VE closed the VNC connection");
    expect(screen.getByTestId("proxmox-vnc-reconnect-btn")).toBeTruthy();
  });

  it("ignores a closed event for another bridge", async () => {
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    await screen.findByTestId("vnc-client");
    act(() => {
      emit("proxmox-vnc-bridge-closed", {
        bridgeId: "bridge-other",
        reason: "not mine",
      });
    });
    expect(screen.getByTestId("proxmox-vnc-status").textContent).toBe(
      "Connected",
    );
  });

  it("reconnect opens a second bridge", async () => {
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    await screen.findByTestId("vnc-client");
    act(() => {
      emit("proxmox-vnc-bridge-closed", { bridgeId: "bridge-1", reason: "x" });
    });
    await screen.findByTestId("proxmox-vnc-reconnect-btn");

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_vnc_bridge_open")
        return { ...BRIDGE, bridgeId: "bridge-2", localPort: 49999 };
      return undefined;
    });
    fireEvent.click(screen.getByTestId("proxmox-vnc-reconnect-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-vnc-endpoint").textContent).toBe(
        "127.0.0.1:49999",
      ),
    );
    // The first bridge's runtime connection is released before the second one.
    expect(registry.released).toContain("proxmox-vnc-bridge-1");
  });

  it("surfaces an open failure", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_vnc_bridge_open")
        throw "Too many open Proxmox VNC bridges";
      return undefined;
    });
    render(<ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />);
    expect(
      (await screen.findByTestId("proxmox-vnc-error")).textContent,
    ).toContain("Too many open Proxmox VNC bridges");
    expect(screen.queryByTestId("vnc-client")).toBeNull();
  });

  it("closes the bridge from the close button", async () => {
    const onClose = vi.fn();
    render(<ProxmoxVncConsole target={TARGET} onClose={onClose} />);
    await screen.findByTestId("vnc-client");
    fireEvent.click(screen.getByTestId("proxmox-vnc-close-btn"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_vnc_bridge_close", {
        bridgeId: "bridge-1",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("closes the bridge and releases the runtime connection on unmount", async () => {
    const { unmount } = render(
      <ProxmoxVncConsole target={TARGET} onClose={vi.fn()} />,
    );
    await screen.findByTestId("vnc-client");
    unmount();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_vnc_bridge_close", {
        bridgeId: "bridge-1",
      }),
    );
    expect(registry.released).toContain("proxmox-vnc-bridge-1");
  });
});

describe("proxmox VNC session builders", () => {
  it("builds a loopback connection that allows unencrypted transport", () => {
    const connection = buildProxmoxVncConnection(BRIDGE, TARGET, () => "T0");
    expect(connection).toMatchObject({
      id: "proxmox-vnc-bridge-1",
      name: "web-01",
      protocol: "vnc",
      hostname: "127.0.0.1",
      port: 49871,
      password: "PVEVNC:ticket",
      vncAllowUnencryptedTransport: true,
      createdAt: "T0",
      updatedAt: "T0",
    });
  });

  it("names an unlabelled target from node and vmid", () => {
    const connection = buildProxmoxVncConnection(
      BRIDGE,
      { node: "pve1", vmid: 100, vmType: "qemu" },
      () => "T0",
    );
    expect(connection.name).toBe("pve1 · 100");
  });

  it("builds a session pointing at the runtime connection", () => {
    const connection = buildProxmoxVncConnection(BRIDGE, TARGET, () => "T0");
    const session = buildProxmoxVncSession(connection, new Date(0));
    expect(session).toMatchObject({
      id: "session-proxmox-vnc-bridge-1",
      connectionId: "proxmox-vnc-bridge-1",
      protocol: "vnc",
      hostname: "127.0.0.1",
      status: "connecting",
    });
  });
});
