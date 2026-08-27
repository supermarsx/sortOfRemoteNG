/**
 * The "Console"/"xterm" buttons in the Proxmox panel used to fetch a ticket and
 * drop it on the floor. These tests pin that each one now opens the relay-backed
 * overlay for the right target.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// The overlay itself is covered by ProxmoxTermConsole.test.tsx; here it is
// reduced to a probe so the assertions are about wiring, not about xterm.
vi.mock("../../src/components/proxmox/ProxmoxTermConsole", () => ({
  __esModule: true,
  default: ({
    target,
    onClose,
  }: {
    target: { node: string; vmid?: number; vmType: string };
    onClose: () => void;
  }) => (
    <div data-testid="proxmox-console-overlay">
      <span data-testid="overlay-target">
        {`${target.node}/${target.vmid ?? "-"}/${target.vmType}`}
      </span>
      <button data-testid="overlay-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("../../src/components/proxmox/ProxmoxVncConsole", () => ({
  __esModule: true,
  default: ({
    target,
    onClose,
  }: {
    target: { node: string; vmid: number; vmType: string };
    onClose: () => void;
  }) => (
    <div data-testid="proxmox-vnc-overlay">
      <span data-testid="vnc-overlay-target">
        {`${target.node}/${target.vmid}/${target.vmType}`}
      </span>
      <button data-testid="vnc-overlay-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import { ConsoleView } from "../../src/components/proxmox/proxmoxPanel/SecondaryViews";
import NodesView from "../../src/components/proxmox/proxmoxPanel/NodesView";
import QemuView from "../../src/components/proxmox/proxmoxPanel/QemuView";
import LxcView from "../../src/components/proxmox/proxmoxPanel/LxcView";
import type { Mgr } from "../../src/components/proxmox/proxmoxPanel/types";

const qemuVms = [
  { vmid: 100, name: "web-01", status: "running", node: "pve1" },
];
const lxcContainers = [
  { vmid: 200, name: "dns-01", status: "running", node: "pve1" },
];

const makeMgr = (overrides: Record<string, unknown> = {}) =>
  ({
    selectedNode: "pve1",
    nodes: [{ node: "pve1", status: "online" }],
    qemuVms,
    lxcContainers,
    filteredVms: qemuVms,
    filteredContainers: lxcContainers,
    loading: false,
    refreshing: false,
    requestConfirm: vi.fn(),
    refreshDashboard: vi.fn(),
    refreshSnapshots: vi.fn(),
    selectVm: vi.fn(),
    switchTab: vi.fn(),
    openCloneDialog: vi.fn(),
    openMigrateDialog: vi.fn(),
    vmAction: vi.fn(),
    lxcAction: vi.fn(),
    openVncConsole: vi.fn(),
    openTermConsole: vi.fn(),
    openNodeConsole: vi.fn(),
    ...overrides,
  }) as unknown as Mgr;

const expectOverlayTarget = async (expected: string) => {
  expect(await screen.findByTestId("proxmox-console-overlay")).toBeTruthy();
  expect(screen.getByTestId("overlay-target").textContent).toBe(expected);
};

const expectVncOverlayTarget = async (expected: string) => {
  expect(await screen.findByTestId("proxmox-vnc-overlay")).toBeTruthy();
  expect(screen.getByTestId("vnc-overlay-target").textContent).toBe(expected);
};

describe("Proxmox console button wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("ConsoleView opens a node shell", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    expect(screen.queryByTestId("proxmox-console-overlay")).toBeNull();
    fireEvent.click(screen.getByTestId("proxmox-open-node-console-btn"));
    await expectOverlayTarget("pve1/-/node");
  });

  it("ConsoleView opens a QEMU xterm console", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-xterm-qemu-100"));
    await expectOverlayTarget("pve1/100/qemu");
  });

  it("ConsoleView opens an LXC xterm console", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-xterm-lxc-200"));
    await expectOverlayTarget("pve1/200/lxc");
  });

  it("ConsoleView closes the overlay again", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-xterm-qemu-100"));
    await screen.findByTestId("proxmox-console-overlay");
    fireEvent.click(screen.getByTestId("overlay-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("proxmox-console-overlay")).toBeNull(),
    );
  });

  it("ConsoleView opens a QEMU VNC console", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-vnc-qemu-100"));
    await expectVncOverlayTarget("pve1/100/qemu");
  });

  it("ConsoleView opens an LXC VNC console", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-vnc-lxc-200"));
    await expectVncOverlayTarget("pve1/200/lxc");
  });

  it("ConsoleView shows only one overlay at a time", async () => {
    render(<ConsoleView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-console-xterm-qemu-100"));
    await screen.findByTestId("proxmox-console-overlay");
    fireEvent.click(screen.getByTestId("proxmox-console-vnc-qemu-100"));
    await screen.findByTestId("proxmox-vnc-overlay");
    expect(screen.queryByTestId("proxmox-console-overlay")).toBeNull();
  });

  it("NodesView opens the node shell for the clicked node", async () => {
    render(<NodesView mgr={makeMgr()} />);
    fireEvent.click(screen.getByTestId("proxmox-node-console-btn-pve1"));
    await expectOverlayTarget("pve1/-/node");
  });

  it("QemuView Console opens the graphical (VNC) console", async () => {
    render(<QemuView mgr={makeMgr()} />);
    fireEvent.click(screen.getByText("web-01"));
    fireEvent.click(await screen.findByTestId("proxmox-qemu-console-btn-100"));
    await expectVncOverlayTarget("pve1/100/qemu");
  });

  it("QemuView Shell opens the xterm console", async () => {
    render(<QemuView mgr={makeMgr()} />);
    fireEvent.click(screen.getByText("web-01"));
    fireEvent.click(await screen.findByTestId("proxmox-qemu-shell-btn-100"));
    await expectOverlayTarget("pve1/100/qemu");
  });

  it("LxcView Console opens the xterm console", async () => {
    render(<LxcView mgr={makeMgr()} />);
    fireEvent.click(screen.getByText("dns-01"));
    fireEvent.click(await screen.findByTestId("proxmox-lxc-console-btn-200"));
    await expectOverlayTarget("pve1/200/lxc");
  });

  it("LxcView VNC opens the graphical console", async () => {
    render(<LxcView mgr={makeMgr()} />);
    fireEvent.click(screen.getByText("dns-01"));
    fireEvent.click(await screen.findByTestId("proxmox-lxc-vnc-btn-200"));
    await expectVncOverlayTarget("pve1/200/lxc");
  });
});
