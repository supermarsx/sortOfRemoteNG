import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockMgr = {
  listOpenVPNConnections: vi.fn(),
  listWireGuardConnections: vi.fn(),
  listTailscaleConnections: vi.fn(),
  listZeroTierConnections: vi.fn(),
  listPPTPConnections: vi.fn(),
  listL2TPConnections: vi.fn(),
  listIKEv2Connections: vi.fn(),
  listIPsecConnections: vi.fn(),
  listSSTPConnections: vi.fn(),
  connectOpenVPN: vi.fn(),
  disconnectOpenVPN: vi.fn(),
  deleteOpenVPNConnection: vi.fn(),
  connectWireGuard: vi.fn(),
  disconnectWireGuard: vi.fn(),
  deleteWireGuardConnection: vi.fn(),
  connectTailscale: vi.fn(),
  disconnectTailscale: vi.fn(),
  deleteTailscaleConnection: vi.fn(),
  connectZeroTier: vi.fn(),
  disconnectZeroTier: vi.fn(),
  deleteZeroTierConnection: vi.fn(),
  connectPPTP: vi.fn(),
  disconnectPPTP: vi.fn(),
  deletePPTPConnection: vi.fn(),
  connectL2TP: vi.fn(),
  disconnectL2TP: vi.fn(),
  deleteL2TPConnection: vi.fn(),
  connectIKEv2: vi.fn(),
  disconnectIKEv2: vi.fn(),
  deleteIKEv2Connection: vi.fn(),
  connectIPsec: vi.fn(),
  disconnectIPsec: vi.fn(),
  deleteIPsecConnection: vi.fn(),
  connectSSTP: vi.fn(),
  disconnectSSTP: vi.fn(),
  deleteSSTPConnection: vi.fn(),
  createOpenVPNConnection: vi.fn(),
  createOpenVPNConnectionFromOvpn: vi.fn(),
  createWireGuardConnection: vi.fn(),
  createWireGuardConnectionFromConf: vi.fn(),
  createTailscaleConnection: vi.fn(),
  createZeroTierConnection: vi.fn(),
  createPPTPConnection: vi.fn(),
  createL2TPConnection: vi.fn(),
  createIKEv2Connection: vi.fn(),
  createIPsecConnection: vi.fn(),
  createSSTPConnection: vi.fn(),
  updateOpenVPNConnection: vi.fn(),
  updateWireGuardConnection: vi.fn(),
  updateTailscaleConnection: vi.fn(),
  updateZeroTierConnection: vi.fn(),
  updatePPTPConnection: vi.fn(),
  updateL2TPConnection: vi.fn(),
  updateIKEv2Connection: vi.fn(),
  updateIPsecConnection: vi.fn(),
  updateSSTPConnection: vi.fn(),
};

const capabilityMocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../../src/utils/network/proxyOpenVPNManager", () => ({
  ProxyOpenVPNManager: {
    getInstance: () => mockMgr,
  },
}));

// Mock tauri event listener
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("../../src/utils/network/vpnRuntimeCapabilities", () => ({
  loadVpnRuntimeCapabilities: capabilityMocks.load,
}));

import { useVpnManager } from "../../src/hooks/network/useVpnManager";

describe("useVpnManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockMgr.listOpenVPNConnections.mockResolvedValue([]);
    mockMgr.listWireGuardConnections.mockResolvedValue([]);
    mockMgr.listTailscaleConnections.mockResolvedValue([]);
    mockMgr.listZeroTierConnections.mockResolvedValue([]);
    mockMgr.listPPTPConnections.mockResolvedValue([]);
    mockMgr.listL2TPConnections.mockResolvedValue([]);
    mockMgr.listIKEv2Connections.mockResolvedValue([]);
    mockMgr.listIPsecConnections.mockResolvedValue([]);
    mockMgr.listSSTPConnections.mockResolvedValue([]);
    capabilityMocks.load.mockResolvedValue([
      { vpnType: "openvpn", executable: true },
      { vpnType: "wireguard", executable: true },
      { vpnType: "tailscale", executable: true },
      { vpnType: "zerotier", executable: true },
      {
        vpnType: "pptp",
        executable: false,
        reason: "Encrypted persistent profiles are unavailable.",
      },
      {
        vpnType: "l2tp",
        executable: false,
        reason: "Encrypted persistent profiles are unavailable.",
      },
      {
        vpnType: "ikev2",
        executable: false,
        reason: "Encrypted persistent profiles are unavailable.",
      },
      {
        vpnType: "ipsec",
        executable: false,
        reason: "Encrypted persistent profiles are unavailable.",
      },
      {
        vpnType: "sstp",
        executable: false,
        reason: "Encrypted persistent profiles are unavailable.",
      },
      {
        vpnType: "softether",
        executable: false,
        reason: "No persisted lease runtime is available.",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads all connection types on mount when isOpen", async () => {
    renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(mockMgr.listOpenVPNConnections).toHaveBeenCalled();
      expect(mockMgr.listWireGuardConnections).toHaveBeenCalled();
      expect(mockMgr.listTailscaleConnections).toHaveBeenCalled();
      expect(mockMgr.listZeroTierConnections).toHaveBeenCalled();
      expect(mockMgr.listPPTPConnections).toHaveBeenCalled();
      expect(mockMgr.listL2TPConnections).toHaveBeenCalled();
      expect(mockMgr.listIKEv2Connections).toHaveBeenCalled();
      expect(mockMgr.listIPsecConnections).toHaveBeenCalled();
      expect(mockMgr.listSSTPConnections).toHaveBeenCalled();
    });
  });

  it("does not load when isOpen is false", async () => {
    renderHook(() => useVpnManager(false));

    // Wait a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMgr.listOpenVPNConnections).not.toHaveBeenCalled();
    expect(mockMgr.listWireGuardConnections).not.toHaveBeenCalled();
    expect(mockMgr.listTailscaleConnections).not.toHaveBeenCalled();
    expect(mockMgr.listZeroTierConnections).not.toHaveBeenCalled();
  });

  it("normalizes OpenVPN connections with host and port", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "ovpn-1",
        name: "Office VPN",
        status: "connected",
        config: { remoteHost: "vpn.office.com", remotePort: 1194 },
        localIp: "10.0.0.5",
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(1);
    });

    const conn = result.current.connections[0];
    expect(conn.vpnType).toBe("openvpn");
    expect(conn.name).toBe("Office VPN");
    expect(conn.host).toBe("vpn.office.com");
    expect(conn.port).toBe(1194);
    expect(conn.localIp).toBe("10.0.0.5");
    expect(conn.status).toBe("connected");
    expect(conn.id).toBe("ovpn-1");
  });

  it("normalizes WireGuard connections with endpoint parsing", async () => {
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "wg-1",
        name: "WG Tunnel",
        status: "connected",
        config: { peer: { endpoint: "192.168.1.1:51820" } },
        localIp: "10.0.0.2",
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(1);
    });

    const conn = result.current.connections[0];
    expect(conn.vpnType).toBe("wireguard");
    expect(conn.host).toBe("192.168.1.1");
    expect(conn.port).toBe(51820);
  });

  it("exposes deliberately keyless WireGuard state and refuses to connect it", async () => {
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "wg-keyless",
        name: "Keyless WG",
        status: "disconnected",
        config: {
          interface: { privateKey: "", address: [] },
          peer: { publicKey: "peer-public", allowedIPs: ["0.0.0.0/0"] },
        },
        secretPresence: { privateKey: false, presharedKey: false },
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.connections).toHaveLength(1));

    expect(result.current.connections[0].connectDisabledReason).toMatch(
      /private key is not stored/i,
    );
    await act(async () => {
      await result.current.connectVpn("wg-keyless", "wireguard");
    });
    expect(mockMgr.connectWireGuard).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/private key is not stored/i);
  });

  it("lists a gated legacy profile but never invokes its direct connect action", async () => {
    mockMgr.listPPTPConnections.mockResolvedValue([
      {
        id: "pptp-legacy",
        name: "Legacy Office",
        status: "disconnected",
        config: {
          enabled: true,
          server: "legacy.example.test",
          username: "operator",
          password: "",
        },
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() =>
      expect(result.current.connections).toContainEqual(
        expect.objectContaining({ id: "pptp-legacy", vpnType: "pptp" }),
      ),
    );

    expect(
      result.current.connections.find(({ id }) => id === "pptp-legacy")
        ?.connectDisabledReason,
    ).toMatch(/persistent profiles are unavailable/i);
    await act(async () => {
      await result.current.connectVpn("pptp-legacy", "pptp");
    });
    expect(mockMgr.connectPPTP).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(
      /persistent profiles are unavailable/i,
    );
  });

  it("normalizes Tailscale connections with loginServer", async () => {
    mockMgr.listTailscaleConnections.mockResolvedValue([
      {
        id: "ts-1",
        name: "My Tailscale",
        status: "connected",
        config: { loginServer: "https://login.tailscale.com" },
        tailnetIp: "100.64.0.1",
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(1);
    });

    const conn = result.current.connections[0];
    expect(conn.vpnType).toBe("tailscale");
    expect(conn.host).toBe("https://login.tailscale.com");
    expect(conn.localIp).toBe("100.64.0.1");
  });

  it("normalizes ZeroTier connections with networkId", async () => {
    mockMgr.listZeroTierConnections.mockResolvedValue([
      {
        id: "zt-1",
        name: "ZT Network",
        status: "connected",
        config: { networkId: "abcdef1234567890" },
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(1);
    });

    const conn = result.current.connections[0];
    expect(conn.vpnType).toBe("zerotier");
    expect(conn.host).toBe("abcdef1234567890");
    expect(conn.localIp).toBeUndefined();
  });

  it("combines all connection types into a single list", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "OVPN",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "2",
        name: "WG",
        status: "connected",
        config: { peer: {} },
        createdAt: new Date(),
      },
    ]);
    mockMgr.listTailscaleConnections.mockResolvedValue([
      {
        id: "3",
        name: "TS",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listZeroTierConnections.mockResolvedValue([
      {
        id: "4",
        name: "ZT",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(4);
    });

    const types = result.current.connections.map((c) => c.vpnType);
    expect(types).toContain("openvpn");
    expect(types).toContain("wireguard");
    expect(types).toContain("tailscale");
    expect(types).toContain("zerotier");
  });

  it("filters by VPN type", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "OpenVPN 1",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "2",
        name: "WG 1",
        status: "connected",
        config: { peer: {} },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(2);
    });

    act(() => {
      result.current.setTypeFilter("wireguard");
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].vpnType).toBe("wireguard");
    expect(result.current.connections[0].name).toBe("WG 1");
  });

  it('shows all connections when type filter is "all"', async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "OVPN",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "2",
        name: "WG",
        status: "disconnected",
        config: { peer: {} },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(2);
    });

    // Filter then reset
    act(() => {
      result.current.setTypeFilter("openvpn");
    });
    expect(result.current.connections).toHaveLength(1);

    act(() => {
      result.current.setTypeFilter("all");
    });
    expect(result.current.connections).toHaveLength(2);
  });

  it("filters by search term matching name", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "Office VPN",
        status: "disconnected",
        config: { remoteHost: "vpn.office.com" },
        createdAt: new Date(),
      },
      {
        id: "2",
        name: "Home VPN",
        status: "disconnected",
        config: { remoteHost: "vpn.home.com" },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(2);
    });

    act(() => {
      result.current.setSearchTerm("office");
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].name).toBe("Office VPN");
  });

  it("filters by search term matching host", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "VPN A",
        status: "disconnected",
        config: { remoteHost: "vpn.alpha.com" },
        createdAt: new Date(),
      },
      {
        id: "2",
        name: "VPN B",
        status: "disconnected",
        config: { remoteHost: "vpn.beta.com" },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(2);
    });

    act(() => {
      result.current.setSearchTerm("beta");
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].name).toBe("VPN B");
  });

  it("filters by search term matching vpnType", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "My Connection",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "2",
        name: "Another Connection",
        status: "disconnected",
        config: { peer: {} },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(2);
    });

    act(() => {
      result.current.setSearchTerm("wireguard");
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].vpnType).toBe("wireguard");
  });

  it("combines type filter and search term", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "Office OVPN",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
      {
        id: "2",
        name: "Home OVPN",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockResolvedValue([
      {
        id: "3",
        name: "Office WG",
        status: "disconnected",
        config: { peer: {} },
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.connections).toHaveLength(3);
    });

    act(() => {
      result.current.setTypeFilter("openvpn");
      result.current.setSearchTerm("office");
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].name).toBe("Office OVPN");
  });

  it("connects an OpenVPN connection", async () => {
    mockMgr.connectOpenVPN.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });

    expect(mockMgr.connectOpenVPN).toHaveBeenCalledWith("ovpn-1");
  });

  it("connects a WireGuard connection", async () => {
    mockMgr.connectWireGuard.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("wg-1", "wireguard");
    });

    expect(mockMgr.connectWireGuard).toHaveBeenCalledWith("wg-1");
  });

  it("connects a Tailscale connection", async () => {
    mockMgr.connectTailscale.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("ts-1", "tailscale");
    });

    expect(mockMgr.connectTailscale).toHaveBeenCalledWith("ts-1");
  });

  it("connects a ZeroTier connection", async () => {
    mockMgr.connectZeroTier.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("zt-1", "zerotier");
    });

    expect(mockMgr.connectZeroTier).toHaveBeenCalledWith("zt-1");
  });

  it("reloads connections after connect", async () => {
    mockMgr.connectOpenVPN.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callCountBefore = mockMgr.listOpenVPNConnections.mock.calls.length;

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });

    expect(mockMgr.listOpenVPNConnections.mock.calls.length).toBeGreaterThan(
      callCountBefore,
    );
  });

  it("disconnects an OpenVPN connection", async () => {
    mockMgr.disconnectOpenVPN.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.disconnectVpn("ovpn-1", "openvpn");
    });

    expect(mockMgr.disconnectOpenVPN).toHaveBeenCalledWith("ovpn-1");
  });

  it("disconnects a WireGuard connection", async () => {
    mockMgr.disconnectWireGuard.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.disconnectVpn("wg-1", "wireguard");
    });

    expect(mockMgr.disconnectWireGuard).toHaveBeenCalledWith("wg-1");
  });

  it("deletes an OpenVPN connection", async () => {
    mockMgr.deleteOpenVPNConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteVpn("ovpn-1", "openvpn");
    });

    expect(mockMgr.deleteOpenVPNConnection).toHaveBeenCalledWith("ovpn-1");
  });

  it("deletes a Tailscale connection", async () => {
    mockMgr.deleteTailscaleConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteVpn("ts-1", "tailscale");
    });

    expect(mockMgr.deleteTailscaleConnection).toHaveBeenCalledWith("ts-1");
  });

  it("deletes a ZeroTier connection", async () => {
    mockMgr.deleteZeroTierConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteVpn("zt-1", "zerotier");
    });

    expect(mockMgr.deleteZeroTierConnection).toHaveBeenCalledWith("zt-1");
  });

  it("creates an OpenVPN connection", async () => {
    mockMgr.createOpenVPNConnection.mockResolvedValue("new-id");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createVpn("New VPN", "openvpn", {
        remoteHost: "vpn.test",
      });
    });

    expect(mockMgr.createOpenVPNConnection).toHaveBeenCalledWith("New VPN", {
      remoteHost: "vpn.test",
    });
  });

  it("creates a WireGuard connection", async () => {
    mockMgr.createWireGuardConnection.mockResolvedValue("new-wg-id");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createVpn("New WG", "wireguard", {
        privateKey: "key123",
      });
    });

    expect(mockMgr.createWireGuardConnection).toHaveBeenCalledWith("New WG", {
      privateKey: "key123",
    });
  });

  it("creates a Tailscale connection", async () => {
    mockMgr.createTailscaleConnection.mockResolvedValue("new-ts-id");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createVpn("New TS", "tailscale", {
        authKey: "tskey-abc",
      });
    });

    expect(mockMgr.createTailscaleConnection).toHaveBeenCalledWith("New TS", {
      authKey: "tskey-abc",
    });
  });

  it("creates a ZeroTier connection", async () => {
    mockMgr.createZeroTierConnection.mockResolvedValue("new-zt-id");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createVpn("New ZT", "zerotier", {
        networkId: "abc123",
      });
    });

    expect(mockMgr.createZeroTierConnection).toHaveBeenCalledWith("New ZT", {
      networkId: "abc123",
    });
  });

  it("throws on create with unsupported VPN type", async () => {
    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.createVpn("Bad", "unknowntype", {});
      }),
    ).rejects.toThrow("Unsupported VPN type: unknowntype");
  });

  it("updates an OpenVPN connection", async () => {
    mockMgr.updateOpenVPNConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateVpn("ovpn-1", "openvpn", "Renamed OVPN", {
        remoteHost: "new.host",
      });
    });

    expect(mockMgr.updateOpenVPNConnection).toHaveBeenCalledWith(
      "ovpn-1",
      "Renamed OVPN",
      { remoteHost: "new.host" },
    );
  });

  it("updates a WireGuard connection", async () => {
    mockMgr.updateWireGuardConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateVpn("wg-1", "wireguard", "Renamed WG", {
        privateKey: "newkey",
      });
    });

    expect(mockMgr.updateWireGuardConnection).toHaveBeenCalledWith(
      "wg-1",
      "Renamed WG",
      { privateKey: "newkey" },
    );
  });

  it("throws on update with unsupported VPN type", async () => {
    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateVpn("x", "badtype", "name", {});
      }),
    ).rejects.toThrow("Unsupported VPN type: badtype");
  });

  it("imports an OpenVPN config", async () => {
    mockMgr.createOpenVPNConnectionFromOvpn.mockResolvedValue("imported-id");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.importOvpn(
        "My Config",
        "client\nremote vpn.example.com\n",
      );
    });

    expect(mockMgr.createOpenVPNConnectionFromOvpn).toHaveBeenCalledWith(
      "My Config",
      "client\nremote vpn.example.com\n",
    );
  });

  it("imports a WireGuard config through the Rust-authoritative parser", async () => {
    mockMgr.createWireGuardConnectionFromConf.mockResolvedValue(
      "imported-wg-id",
    );

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.importWireGuard(
        "Office WG",
        "[Interface]\nPrivateKey = private\n[Peer]\nPublicKey = public\n",
      );
    });

    expect(mockMgr.createWireGuardConnectionFromConf).toHaveBeenCalledWith(
      "Office WG",
      "[Interface]\nPrivateKey = private\n[Peer]\nPublicKey = public\n",
    );
  });

  it("sets error on failed connection", async () => {
    mockMgr.connectOpenVPN.mockRejectedValue(new Error("Connection refused"));

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });

    expect(result.current.error).toBe("Connection refused");
  });

  it("sets error on failed disconnect", async () => {
    mockMgr.disconnectWireGuard.mockRejectedValue(new Error("Timeout"));

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.disconnectVpn("wg-1", "wireguard");
    });

    expect(result.current.error).toBe("Timeout");
  });

  it("sets error on failed delete", async () => {
    mockMgr.deleteOpenVPNConnection.mockRejectedValue(new Error("Not found"));

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteVpn("ovpn-1", "openvpn");
    });

    expect(result.current.error).toBe("Not found");
  });

  it("sets fallback error message for non-Error rejections", async () => {
    mockMgr.connectOpenVPN.mockRejectedValue("string-error");

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });

    expect(result.current.error).toBe("Failed to connect openvpn");
  });

  it("clears error before new action", async () => {
    mockMgr.connectOpenVPN.mockRejectedValueOnce(new Error("First failure"));
    mockMgr.connectOpenVPN.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });
    expect(result.current.error).toBe("First failure");

    await act(async () => {
      await result.current.connectVpn("ovpn-1", "openvpn");
    });
    expect(result.current.error).toBeNull();
  });

  it("handles partial load failure gracefully", async () => {
    mockMgr.listOpenVPNConnections.mockResolvedValue([
      {
        id: "1",
        name: "Works",
        status: "disconnected",
        config: {},
        createdAt: new Date(),
      },
    ]);
    mockMgr.listWireGuardConnections.mockRejectedValue(
      new Error("Service unavailable"),
    );

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      // Should still have the OpenVPN connection despite WireGuard failure
      expect(result.current.connections.length).toBeGreaterThanOrEqual(1);
    });

    // The OpenVPN connection should be present
    expect(result.current.connections[0].name).toBe("Works");
    expect(result.current.connections[0].vpnType).toBe("openvpn");
    expect(result.current.profileCatalog?.providerStatus.wireguard).toBe(
      "error",
    );
    expect(result.current.error).toMatch(
      /associations cannot be verified yet/i,
    );
  });

  it("handles all list calls failing gracefully", async () => {
    mockMgr.listOpenVPNConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listWireGuardConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listTailscaleConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listZeroTierConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listPPTPConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listL2TPConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listIKEv2Connections.mockRejectedValue(new Error("fail"));
    mockMgr.listIPsecConnections.mockRejectedValue(new Error("fail"));
    mockMgr.listSSTPConnections.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useVpnManager(true));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.connections).toHaveLength(0);
    expect(result.current.profileCatalog?.providerStatus).toEqual({
      openvpn: "error",
      wireguard: "error",
      tailscale: "error",
      zerotier: "error",
      pptp: "error",
      l2tp: "error",
      ikev2: "error",
      ipsec: "error",
      sstp: "error",
    });
  });

  it("exposes isLoading while loading", async () => {
    // Make the list calls take a while
    let resolveOvpn!: (v: any[]) => void;
    mockMgr.listOpenVPNConnections.mockImplementation(
      () =>
        new Promise((r) => {
          resolveOvpn = r;
        }),
    );

    const { result } = renderHook(() => useVpnManager(true));

    // Should be loading
    expect(result.current.isLoading).toBe(true);

    // Resolve the pending call
    await act(async () => {
      resolveOvpn([]);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("initial state has empty search and all filter", () => {
    const { result } = renderHook(() => useVpnManager(false));

    expect(result.current.searchTerm).toBe("");
    expect(result.current.typeFilter).toBe("all");
    expect(result.current.connections).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("can manually reload connections via loadConnections", async () => {
    const { result } = renderHook(() => useVpnManager(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callCount = mockMgr.listOpenVPNConnections.mock.calls.length;

    await act(async () => {
      await result.current.loadConnections();
    });

    expect(mockMgr.listOpenVPNConnections.mock.calls.length).toBeGreaterThan(
      callCount,
    );
  });
});
