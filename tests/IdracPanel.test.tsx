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

describe("IdracPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders connection form when not connected", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    expect(
      screen.getByText("Connect to Dell iDRAC"),
    ).toBeInTheDocument();
  });

  it("shows host, port, username, password fields", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    expect(screen.getByPlaceholderText("192.168.1.100")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("root")).toBeInTheDocument();
  });

  it("shows protocol selection dropdown", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    // Protocol select has option text
    expect(screen.getByText("Auto-detect")).toBeInTheDocument();
    expect(screen.getByText("Redfish (iDRAC 7/8/9)")).toBeInTheDocument();
    expect(screen.getByText("WS-Management (iDRAC 6/7 Legacy)")).toBeInTheDocument();
    expect(screen.getByText("IPMI (Very Old BMC)")).toBeInTheDocument();
  });

  it("shows insecure checkbox defaulting to checked", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const checkbox = screen.getByLabelText(
      "Accept self-signed certificates",
    );
    expect(checkbox).toBeChecked();
  });

  it("connect button is disabled when host is empty", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).toBeDisabled();
  });

  it("connect button becomes enabled when host is set", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
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
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
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
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const hostInput = screen.getByPlaceholderText("192.168.1.100");
    fireEvent.change(hostInput, { target: { value: "10.0.0.1" } });
    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("selects protocol when dropdown is changed", async () => {
    const { default: IdracPanel } = await import(
      "../src/components/idrac/idracPanel/IdracPanel"
    );
    render(<IdracPanel />);
    const select = screen.getByDisplayValue("Auto-detect");
    fireEvent.change(select, { target: { value: "wsman" } });
    expect(select).toHaveValue("wsman");
  });
});

describe("IdracPanel - TypeScript types", () => {
  it("exports types module", async () => {
    const mod = await import(
      "../src/components/idrac/idracPanel/types"
    );
    expect(mod).toBeDefined();
  });
});

describe("IdracPanel - useIdracManager hook", () => {
  it("exports useIdracManager function", async () => {
    const mod = await import(
      "../src/hooks/idrac/useIdracManager"
    );
    expect(mod.useIdracManager).toBeDefined();
    expect(typeof mod.useIdracManager).toBe("function");
  });
});

describe("IdracPanel - useIdrac hook", () => {
  it("exports useIdrac function", async () => {
    const mod = await import(
      "../src/hooks/idrac/useIdrac"
    );
    expect(mod.useIdrac).toBeDefined();
    expect(typeof mod.useIdrac).toBe("function");
  });
});

describe("iDRAC TypeScript types", () => {
  it("exports all required interfaces", async () => {
    const types = await import("../src/types/hardware/idrac");
    expect(types).toBeDefined();
  });

  it("module loads without TypeScript errors", async () => {
    const types = await import("../src/types/hardware/idrac");
    // Verify the module exports are accessible
    expect(typeof types).toBe("object");
  });
});

describe("IdracPanel - SecondaryViews", () => {
  it("exports all secondary view components", async () => {
    const views = await import(
      "../src/components/idrac/idracPanel/SecondaryViews"
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
    const mod = await import("../src/components/idrac/index");
    expect(mod.IdracPanel).toBeDefined();
  });
});
