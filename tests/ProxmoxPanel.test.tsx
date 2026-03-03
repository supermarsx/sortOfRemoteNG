import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProxmoxPanel } from "../src/components/proxmox/ProxmoxPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";

describe("ProxmoxPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null when not open", () => {
    const { container } = render(
      <ProxmoxPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders connection form when not connected", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByText("Connect to Proxmox VE"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("192.168.1.100")).toBeInTheDocument();
  });

  it("shows host, port, username fields", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    expect(screen.getByPlaceholderText("192.168.1.100")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("root@pam")).toBeInTheDocument();
  });

  it("toggles between password and API token auth", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const apiTokenBtn = screen.getByText("API Token");
    fireEvent.click(apiTokenBtn);
    expect(screen.getByPlaceholderText("user@pam!tokenname")).toBeInTheDocument();
  });

  it("connect button is disabled when host is empty", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).toBeDisabled();
  });

  it("connect button becomes enabled when host and username set", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    // username already has default "root@pam"
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).not.toBeDisabled();
  });

  it("calls proxmox_connect on connect click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_connect") return "Connected";
      if (cmd === "proxmox_get_config") return null;
      if (cmd === "proxmox_get_version") return { version: "8.0", release: "8.0-1", repoid: "abc" };
      if (cmd === "proxmox_list_nodes") return [];
      if (cmd === "proxmox_get_cluster_status") return [];
      if (cmd === "proxmox_list_cluster_resources") return [];
      if (cmd === "proxmox_list_qemu_vms") return [];
      if (cmd === "proxmox_list_lxc_containers") return [];
      if (cmd === "proxmox_list_storage") return [];
      return null;
    });
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "proxmox_connect",
        expect.objectContaining({ host: "10.0.0.1" }),
      );
    });
  });

  it("displays connection error on failure", async () => {
    vi.mocked(invoke).mockRejectedValue("Connection refused");
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("shows insecure checkbox defaulting to checked", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    const checkbox = screen.getByLabelText("Accept self-signed certificates");
    expect(checkbox).toBeChecked();
  });

  it("renders header with Proxmox VE Manager title", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    expect(screen.getByText("Proxmox VE Manager")).toBeInTheDocument();
  });

  it("shows disconnected status in header when not connected", () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });
});

describe("ProxmoxPanel - TypeScript types", () => {
  it("exports ProxmoxPanelProps interface", async () => {
    const mod = await import(
      "../src/components/proxmox/proxmoxPanel/types"
    );
    expect(mod).toBeDefined();
  });
});

describe("ProxmoxPanel - useProxmoxManager hook", () => {
  it("exports useProxmoxManager function", async () => {
    const mod = await import(
      "../src/hooks/proxmox/useProxmoxManager"
    );
    expect(mod.useProxmoxManager).toBeDefined();
    expect(typeof mod.useProxmoxManager).toBe("function");
  });
});

describe("ProxmoxPanel - useProxmox hook", () => {
  it("exports useProxmox function", async () => {
    const mod = await import(
      "../src/hooks/monitoring/useProxmox"
    );
    expect(mod.useProxmox).toBeDefined();
    expect(typeof mod.useProxmox).toBe("function");
  });
});

describe("Proxmox TypeScript types", () => {
  it("exports all required interfaces", async () => {
    const types = await import("../src/types/proxmox");
    // Verify key type exports exist (TypeScript interfaces are erased,
    // but we can verify the module loads without errors)
    expect(types).toBeDefined();
  });
});
