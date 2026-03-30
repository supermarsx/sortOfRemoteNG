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
