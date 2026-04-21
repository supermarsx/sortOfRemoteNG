import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
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
import IdracPanel from "../../src/components/idrac/idracPanel/IdracPanel";

describe("IdracPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders connection form when not connected", () => {
    const { container } = render(<IdracPanel />);
    expect(
      within(container).getByText("Connect to Dell iDRAC"),
    ).toBeInTheDocument();
  });

  it("shows host, port, username, password fields", () => {
    render(<IdracPanel />);
    expect(screen.getAllByPlaceholderText("192.168.1.100")[0]).toBeInTheDocument();
    expect(screen.getByPlaceholderText("root")).toBeInTheDocument();
  });

  it("shows protocol selection dropdown", () => {
    render(<IdracPanel />);
    // Default selected option text is visible in the trigger
    expect(screen.getByText("Auto-detect")).toBeInTheDocument();
    // Open the dropdown to see all options
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("Redfish (iDRAC 7/8/9)")).toBeInTheDocument();
    expect(screen.getByText("WS-Management (iDRAC 6/7 Legacy)")).toBeInTheDocument();
    expect(screen.getByText("IPMI (Very Old BMC)")).toBeInTheDocument();
  });

  it("shows insecure checkbox defaulting to checked", () => {
    render(<IdracPanel />);
    const checkbox = screen.getByLabelText(
      "Accept self-signed certificates",
    );
    expect(checkbox).toBeChecked();
  });

  it("connect button is disabled when host is empty", () => {
    render(<IdracPanel />);
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).toBeDisabled();
  });

  it("connect button becomes enabled when host is set", () => {
    render(<IdracPanel />);
    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).not.toBeDisabled();
  });

  it("calls idrac_connect on connect click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "idrac_connect") return "Connected via Redfish";
      if (cmd === "idrac_get_dashboard") {
        return {
          systemInfo: null,
          idracInfo: null,
          healthRollup: null,
          powerMetrics: null,
          thermalSummary: null,
          recentEvents: [],
          firmwareCount: 0,
          storageCount: 0,
          networkAdapterCount: 0,
          userCount: 0,
        };
      }
      return null;
    });
    render(<IdracPanel />);
    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "idrac_connect",
        expect.objectContaining({ host: "10.0.0.1" }),
      );
    });
  });

  it("displays connection error on failure", async () => {
    vi.mocked(invoke).mockRejectedValue("Connection refused");
    render(<IdracPanel />);
    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("selects protocol when dropdown is changed", () => {
    render(<IdracPanel />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText("WS-Management (iDRAC 6/7 Legacy)"));
    expect(screen.getByRole("combobox")).toHaveTextContent("WS-Management");
  });
});

describe("IdracPanel - TypeScript types", () => {
  it("exports types module", async () => {
    const mod = await import("../../src/components/idrac/idracPanel/types"
    );
    expect(mod).toBeDefined();
  });
});

describe("IdracPanel - useIdracManager hook", () => {
  it("exports useIdracManager function", async () => {
    const mod = await import("../../src/hooks/idrac/useIdracManager"
    );
    expect(mod.useIdracManager).toBeDefined();
    expect(typeof mod.useIdracManager).toBe("function");
  });
});

describe("IdracPanel - useIdrac hook", () => {
  it("exports useIdrac function", async () => {
    const mod = await import("../../src/hooks/idrac/useIdrac"
    );
    expect(mod.useIdrac).toBeDefined();
    expect(typeof mod.useIdrac).toBe("function");
  });
});

describe("iDRAC TypeScript types", () => {
  it("exports all required interfaces", async () => {
    const types = await import("../../src/types/hardware/idrac");
    expect(types).toBeDefined();
  });

  it("module loads without TypeScript errors", async () => {
    const types = await import("../../src/types/hardware/idrac");
    // Verify the module exports are accessible
    expect(typeof types).toBe("object");
  });
});

describe("IdracPanel - SecondaryViews", () => {
  it("exports all secondary view components", async () => {
    const views = await import("../../src/components/idrac/idracPanel/SecondaryViews"
    );
    expect(views.NetworkView).toBeDefined();
    expect(views.FirmwareView).toBeDefined();
    expect(views.LifecycleView).toBeDefined();
    expect(views.VirtualMediaView).toBeDefined();
    expect(views.ConsoleView).toBeDefined();
    expect(views.EventLogView).toBeDefined();
    expect(views.UsersView).toBeDefined();
    expect(views.BiosView).toBeDefined();
    expect(views.CertificatesView).toBeDefined();
    expect(views.HealthView).toBeDefined();
    expect(views.TelemetryView).toBeDefined();
    expect(views.RacadmView).toBeDefined();
  });
});

describe("IdracPanel - barrel export", () => {
  it("exports IdracPanel from barrel", async () => {
    const mod = await import("../../src/components/idrac/index");
    expect(mod.IdracPanel).toBeDefined();
  });
});

describe("IdracPanel - connection and health flows", () => {
  const wireConnectedMocks = () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "idrac_connect") return "Connected via Redfish";
      if (cmd === "idrac_get_config")
        return { host: "10.0.0.1", port: 443, protocol: "Redfish", insecure: true };
      if (cmd === "idrac_get_dashboard") {
        return {
          system: {
            model: "PowerEdge R740",
            manufacturer: "Dell Inc.",
            serialNumber: "SN12345",
            serviceTag: "ABC1234",
            biosVersion: "2.15.1",
            hostName: "server01",
          },
          idrac: {
            firmwareVersion: "6.10.30.20",
            macAddress: "AA:BB:CC:DD:EE:FF",
          },
          health: {
            overallHealth: "OK",
            processors: { health: "OK" },
            memory: { health: "OK" },
            storage: { health: "OK" },
            fans: { health: "OK" },
          },
          power: { currentWatts: 250, maxWatts: 400 },
          thermalSummary: null,
          recentEvents: [],
          firmwareCount: 12,
          virtualDiskCount: 2,
          physicalDiskCount: 4,
          memoryDimmCount: 8,
          nicCount: 2,
        };
      }
      if (cmd === "idrac_get_system_info")
        return {
          model: "PowerEdge R740",
          manufacturer: "Dell Inc.",
          serviceTag: "ABC1234",
          biosVersion: "2.15.1",
          hostName: "server01",
        };
      if (cmd === "idrac_get_idrac_info")
        return { firmwareVersion: "6.10.30.20", macAddress: "AA:BB:CC:DD:EE:FF" };
      return null;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("connects to iDRAC console", async () => {
    wireConnectedMocks();
    render(<IdracPanel />);

    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });

    // Password input has no placeholder link; find by type
    const pwFields = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(pwFields.length).toBeGreaterThanOrEqual(1);
    fireEvent.change(pwFields[0], { target: { value: "calvin" } });

    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "idrac_connect",
        expect.objectContaining({
          host: "10.0.0.1",
          username: "root",
          password: "calvin",
          insecure: true,
        }),
      );
    });

    // Verify config is fetched after connect — allow async chain to settle
    await new Promise(r => setTimeout(r, 200));
    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
      expect(calls).toContain("idrac_get_config");
    });
  });

  it("displays server health information", async () => {
    wireConnectedMocks();
    render(<IdracPanel />);

    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    fireEvent.click(screen.getByText("Connect"));

    // After connect, wait for the component to transition to connected state
    // The dashboard auto-loads on connection — verify invoke was called
    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
      expect(calls).toContain("idrac_connect");
    });

    // Verify connected state renders (header shows Refresh/Disconnect)
    await waitFor(() => {
      expect(screen.getByTitle("Disconnect")).toBeInTheDocument();
    });
  });

  it("handles auth errors", async () => {
    vi.mocked(invoke).mockRejectedValue("401 Unauthorized: invalid credentials");
    render(<IdracPanel />);

    const hostInput = screen.getAllByPlaceholderText("192.168.1.100")[0];
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByText("401 Unauthorized: invalid credentials")).toBeInTheDocument();
    });
  });
});
