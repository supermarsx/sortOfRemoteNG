import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProxmoxPanel } from "../../src/components/proxmox/ProxmoxPanel";

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
  const wireConnectedMocks = () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_connect") return "Connected";
      if (cmd === "proxmox_get_config") return null;
      if (cmd === "proxmox_get_version") return { version: "8.0", release: "8.0-1", repoid: "abc" };
      if (cmd === "proxmox_list_nodes") {
        return [
          { node: "pve1", status: "online" },
          { node: "pve2", status: "online" },
        ];
      }
      if (cmd === "proxmox_get_cluster_status") return [];
      if (cmd === "proxmox_list_cluster_resources") return [];
      if (cmd === "proxmox_list_qemu_vms") {
        return [
          { vmid: 101, name: "web-01", status: "running", cpus: 2, maxmem: 2147483648, maxdisk: 4294967296 },
        ];
      }
      if (cmd === "proxmox_list_lxc_containers") {
        return [
          { vmid: 201, name: "ct-01", status: "running", cpus: 2, maxmem: 1073741824, maxdisk: 2147483648 },
        ];
      }
      if (cmd === "proxmox_list_storage") {
        return [
          { storage: "local-lvm", type: "lvmthin" },
        ];
      }
      if (cmd === "proxmox_get_qemu_config") return {};
      if (cmd === "proxmox_get_lxc_config") return {};
      if (cmd === "proxmox_create_qemu_vm") return "UPID:qemu-create";
      if (cmd === "proxmox_create_lxc_container") return "UPID:lxc-create";
      if (cmd === "proxmox_migrate_qemu_vm") return "UPID:qemu-migrate";
      if (cmd === "proxmox_list_tasks") return [];
      return null;
    });
  };

  const connectPanel = async () => {
    render(<ProxmoxPanel isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("192.168.1.100"), { target: { value: "10.0.0.1" } });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "proxmox_connect",
        expect.objectContaining({ host: "10.0.0.1" }),
      );
    });
  };

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

  it("opens the LXC create dialog and submits a container create request", async () => {
    wireConnectedMocks();
    await connectPanel();

    fireEvent.click(screen.getByText("lxc"));
    fireEvent.click(screen.getByRole("button", { name: /create container/i }));

    expect(screen.getByText("OS Template")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"), {
      target: { value: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /create container/i })[1]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "proxmox_create_lxc_container",
        expect.objectContaining({
          node: "pve1",
          params: expect.objectContaining({
            ostemplate: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
          }),
        }),
      );
    });
  });

  it("opens the QEMU migrate dialog and submits a migration request", async () => {
    wireConnectedMocks();
    await connectPanel();

    fireEvent.click(screen.getByText("qemu"));
    fireEvent.click(screen.getByText("web-01"));
    fireEvent.click(screen.getByText("Migrate"));

    fireEvent.change(screen.getByLabelText("Target Node"), { target: { value: "pve2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Migration" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "proxmox_migrate_qemu_vm",
        expect.objectContaining({
          node: "pve1",
          vmid: 101,
          params: expect.objectContaining({
            target: "pve2",
          }),
        }),
      );
    });
  });
});

describe("ProxmoxPanel - TypeScript types", () => {
  it("exports ProxmoxPanelProps interface", async () => {
    const mod = await import("../../src/components/proxmox/proxmoxPanel/types"
    );
    expect(mod).toBeDefined();
  });
});

describe("ProxmoxPanel - useProxmoxManager hook", () => {
  it("exports useProxmoxManager function", async () => {
    const mod = await import("../../src/hooks/proxmox/useProxmoxManager"
    );
    expect(mod.useProxmoxManager).toBeDefined();
    expect(typeof mod.useProxmoxManager).toBe("function");
  });
});

describe("ProxmoxPanel - useProxmox hook", () => {
  it("exports useProxmox function", async () => {
    const mod = await import("../../src/hooks/proxmox/useProxmox"
    );
    expect(mod.useProxmox).toBeDefined();
    expect(typeof mod.useProxmox).toBe("function");
  });
});

describe("Proxmox TypeScript types", () => {
  it("exports all required interfaces", async () => {
    const types = await import("../../src/types/hardware/proxmox");
    // Verify key type exports exist (TypeScript interfaces are erased,
    // but we can verify the module loads without errors)
    expect(types).toBeDefined();
  });
});
