import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProxyChainEditor } from "../../src/components/network/ProxyChainEditor";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  listOpenVPNConnections: vi.fn(),
  listWireGuardConnections: vi.fn(),
}));

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getProfiles: mocks.getProfiles,
  },
}));

vi.mock("../../src/utils/network/proxyOpenVPNManager", () => ({
  ProxyOpenVPNManager: {
    getInstance: () => ({
      listOpenVPNConnections: mocks.listOpenVPNConnections,
      listWireGuardConnections: mocks.listWireGuardConnections,
    }),
  },
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

describe("ProxyChainEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockReturnValue([
      {
        id: "profile-1",
        name: "SOCKS Gateway",
        config: {
          type: "socks5",
          host: "127.0.0.1",
          port: 1080,
          enabled: true,
        },
      },
    ]);
    mocks.listOpenVPNConnections.mockResolvedValue([
      {
        id: "ovpn-1",
        name: "Corp VPN",
        status: "connected",
        config: {},
      },
    ]);
    mocks.listWireGuardConnections.mockResolvedValue([
      {
        id: "wg-1",
        name: "WireGuard Edge",
        status: "disconnected",
        config: {},
      },
    ]);
  });

  it("does not render when closed", () => {
    render(
      <ProxyChainEditor
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        editingChain={null}
      />,
    );

    expect(screen.queryByText("New Proxy Chain")).not.toBeInTheDocument();
  });

  it("shows validation error when saving empty", () => {
    render(
      <ProxyChainEditor
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        editingChain={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Chain" }));
    expect(screen.getByText("Chain name is required")).toBeInTheDocument();
  });

  it("creates chain with selected proxy layer", async () => {
    const onSave = vi.fn();

    render(
      <ProxyChainEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingChain={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("My Proxy Chain"), {
      target: { value: "Office Chain" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Layer/i }));

    // Open the profile dropdown and select the profile
    const profileTrigger = screen.getByText("Select profile...");
    fireEvent.click(profileTrigger);
    fireEvent.mouseDown(screen.getByText("SOCKS Gateway (socks5)"));

    fireEvent.click(screen.getByRole("button", { name: "Create Chain" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Office Chain",
          layers: [
            expect.objectContaining({
              type: "proxy",
              proxyProfileId: "profile-1",
              position: 0,
            }),
          ],
        }),
      );
    });
  });

  it("allows selecting a saved OpenVPN profile for VPN layers", async () => {
    const onSave = vi.fn();

    render(
      <ProxyChainEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingChain={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("My Proxy Chain"), {
      target: { value: "VPN Chain" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Layer/i }));

    const layerTypeTrigger = screen.getByText("Proxy");
    fireEvent.click(layerTypeTrigger);
    fireEvent.mouseDown(screen.getByText("OpenVPN"));

    fireEvent.click(screen.getByText("Select VPN profile..."));

    await waitFor(() => {
      expect(screen.getByText("Corp VPN (connected)")).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByText("Corp VPN (connected)"));
    fireEvent.click(screen.getByRole("button", { name: "Create Chain" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "VPN Chain",
          layers: [
            expect.objectContaining({
              type: "openvpn",
              vpnProfileId: "ovpn-1",
            }),
          ],
        }),
      );
    });
  });
});
