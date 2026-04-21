import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { SynologyPanel } from "../../src/components/synology/SynologyPanel";

describe("SynologyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null when not open", () => {
    const { container } = render(
      <SynologyPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders connection form when not connected", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByText("Connect to Synology NAS"),
    ).toBeInTheDocument();
  });

  it("shows host, port, username, password fields", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByPlaceholderText("192.168.1.1"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("admin")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("••••••••"),
    ).toBeInTheDocument();
  });

  it("shows 2FA and access token fields", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("token..."),
    ).toBeInTheDocument();
  });

  it("connect button is disabled when host is empty", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    const hostInput = screen.getByPlaceholderText("192.168.1.1");
    fireEvent.change(hostInput, { target: { value: "" } });
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).toBeDisabled();
  });

  it("calls syn_connect on connect click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "syn_connect") return "Connected";
      if (cmd === "syn_get_dashboard")
        return {
          system_info: { model: "DS920+", version: "7.2" },
          utilization: null,
          storage: null,
          network: null,
          hardware: null,
        };
      return null;
    });
    render(<SynologyPanel isOpen onClose={() => {}} />);
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "syn_connect",
        expect.objectContaining({ host: "192.168.1.1" }),
      );
    });
  });

  it("displays connection error on failure", async () => {
    vi.mocked(invoke).mockRejectedValue("Connection refused");
    render(<SynologyPanel isOpen onClose={() => {}} />);
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(
        screen.getByText("Connection refused"),
      ).toBeInTheDocument();
    });
  });

  it("shows HTTPS and allow self-signed checkboxes", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    const httpsCheckbox = screen.getByLabelText("HTTPS");
    expect(httpsCheckbox).toBeChecked();
    const selfSignedCheckbox = screen.getByLabelText("Allow self-signed");
    expect(selfSignedCheckbox).toBeChecked();
  });

  it("renders header with Synology NAS Manager title", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByText("Synology NAS Manager"),
    ).toBeInTheDocument();
  });

  it("shows disconnected status in header when not connected", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("shows dashboard view after successful connection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "syn_connect") return "Connected";
      if (cmd === "syn_get_dashboard")
        return {
          system_info: {
            model: "DS920+",
            version: "7.2",
            serial: "ABC123",
          },
          utilization: {
            cpu: { system_load: 25, user_load: 10 },
            memory: {
              physical_memory: {
                total_real: 4096000,
                avail_real: 2048000,
              },
            },
            network: [],
            disk: [],
          },
          storage: { volumes: [], disks: [], pools: [] },
          network: null,
          hardware: null,
        };
      return null;
    });
    render(<SynologyPanel isOpen onClose={() => {}} />);
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(screen.getByText("DS920+")).toBeInTheDocument();
    });
  });
});

describe("SynologyPanel - TypeScript types", () => {
  it("exports SynologyPanelProps interface", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/types"
    );
    expect(mod).toBeDefined();
  });
});

describe("SynologyPanel - useSynologyManager hook", () => {
  it("exports useSynologyManager function", async () => {
    const mod = await import("../../src/hooks/synology/useSynologyManager"
    );
    expect(mod.useSynologyManager).toBeDefined();
    expect(typeof mod.useSynologyManager).toBe("function");
  });
});

describe("SynologyPanel - useSynology hook", () => {
  it("exports useSynology function", async () => {
    const mod = await import("../../src/hooks/synology/useSynology"
    );
    expect(mod.useSynology).toBeDefined();
    expect(typeof mod.useSynology).toBe("function");
  });
});

describe("Synology TypeScript types", () => {
  it("exports all required interfaces", async () => {
    const types = await import("../../src/types/hardware/synology");
    expect(types).toBeDefined();
  });
});

describe("SynologyPanel - Secondary Views", () => {
  it("exports all secondary view components", async () => {
    const views = await import("../../src/components/synology/synologyPanel/SecondaryViews"
    );
    expect(views.SharesView).toBeDefined();
    expect(views.NetworkView).toBeDefined();
    expect(views.UsersView).toBeDefined();
    expect(views.PackagesView).toBeDefined();
    expect(views.ServicesView).toBeDefined();
    expect(views.DockerView).toBeDefined();
    expect(views.VmsView).toBeDefined();
    expect(views.DownloadsView).toBeDefined();
    expect(views.SurveillanceView).toBeDefined();
    expect(views.BackupView).toBeDefined();
    expect(views.SecurityView).toBeDefined();
    expect(views.HardwareView).toBeDefined();
    expect(views.LogsView).toBeDefined();
    expect(views.NotificationsView).toBeDefined();
  });
});

describe("SynologyPanel - standalone views", () => {
  it("exports DashboardView", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/DashboardView"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports SystemView", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/SystemView"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports StorageView", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/StorageView"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports FileStationView", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/FileStationView"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports Sidebar", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/Sidebar"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports ConnectionForm", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/ConnectionForm"
    );
    expect(mod.default).toBeDefined();
  });

  it("exports SynologyHeader", async () => {
    const mod = await import("../../src/components/synology/synologyPanel/SynologyHeader"
    );
    expect(mod.default).toBeDefined();
  });
});

describe("SynologyPanel - connection and post-connect flows", () => {
  const wireDashboardMocks = () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "syn_connect") return "Connected";
      if (cmd === "syn_get_dashboard")
        return {
          system_info: {
            model: "DS920+",
            version: "7.2",
            serial: "ABC123",
          },
          utilization: {
            cpu: { system_load: 25, user_load: 10 },
            memory: {
              physical_memory: {
                total_real: 4096000,
                avail_real: 2048000,
              },
            },
            network: [],
            disk: [],
          },
          storage: { volumes: [], disks: [], pools: [] },
          network: null,
          hardware: null,
        };
      if (cmd === "syn_list_services")
        return [
          { name: "SMB", enabled: true, running: true },
          { name: "NFS", enabled: true, running: false },
          { name: "SSH", enabled: false, running: false },
        ];
      if (cmd === "syn_get_smb_config") return { enabled: true };
      if (cmd === "syn_get_nfs_config") return { enabled: true };
      if (cmd === "syn_get_ssh_config") return { enabled: false };
      if (cmd === "syn_get_system_info")
        return { model: "DS920+", version: "7.2", serial: "ABC123" };
      if (cmd === "syn_get_utilization")
        return {
          cpu: { system_load: 25, user_load: 10 },
          memory: {
            physical_memory: { total_real: 4096000, avail_real: 2048000 },
          },
          network: [],
          disk: [],
        };
      if (cmd === "syn_get_storage_overview") return { volumes: [], disks: [], pools: [] };
      if (cmd === "syn_list_disks") return [];
      if (cmd === "syn_list_volumes") return [];
      return null;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("connects to Synology NAS", async () => {
    wireDashboardMocks();
    render(<SynologyPanel isOpen onClose={() => {}} />);

    const hostInput = screen.getByPlaceholderText("192.168.1.1");
    fireEvent.change(hostInput, { target: { value: "nas.local" } });

    const pwField = screen.getByPlaceholderText("••••••••");
    fireEvent.change(pwField, { target: { value: "naspass" } });

    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "syn_connect",
        expect.objectContaining({
          host: "nas.local",
          username: "admin",
          password: "naspass",
          useHttps: true,
          insecure: true,
        }),
      );
    });

    // Should transition to connected state and show dashboard
    await waitFor(() => {
      expect(screen.getByText("DS920+")).toBeInTheDocument();
    });
  });

  it("lists services after connection", async () => {
    wireDashboardMocks();
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "syn_connect",
        expect.anything(),
      );
    });

    // Switch to services tab
    await waitFor(() => {
      expect(screen.getByText("DS920+")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("services"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("syn_list_services");
    });
  });

  it("handles connection errors", async () => {
    vi.mocked(invoke).mockRejectedValue("Network unreachable: EHOSTUNREACH");
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByText("Network unreachable: EHOSTUNREACH")).toBeInTheDocument();
    });
  });

  it("tab switching between views", async () => {
    wireDashboardMocks();
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByText("DS920+")).toBeInTheDocument();
    });

    // Click system tab
    fireEvent.click(screen.getByText("system"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("syn_get_system_info");
    });

    // Click storage tab
    fireEvent.click(screen.getByText("storage"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("syn_get_storage_overview");
    });
  });
});
