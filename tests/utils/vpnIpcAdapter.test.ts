import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { ProxyOpenVPNManager } from "../../src/utils/network/proxyOpenVPNManager";
import {
  fromOpenVpnIpcConnection,
  fromTailscaleIpcConnection,
  fromWireGuardIpcConnection,
  fromZeroTierIpcConnection,
  isMaskedSecretPlaceholder,
  normalizeVpnStatus,
  toOpenVpnIpcConfig,
  toTailscaleIpcConfig,
  toWireGuardIpcConfig,
  toZeroTierIpcConfig,
} from "../../src/utils/network/vpnIpcAdapter";
import {
  getUnsupportedVpnEditorSettings,
  getVpnEditorValidationError,
  toVpnEditorFormConfig,
  useVpnEditor,
} from "../../src/hooks/network/useVpnEditor";

const createdAt = "2026-07-19T12:00:00Z";

const openVpnConfig = {
  enabled: true,
  configFile: "C:/vpn/office.ovpn",
  username: "alice",
  password: "openvpn-secret",
  remoteHost: "vpn.example.com",
  remotePort: 1194,
  protocol: "udp" as const,
  route: [{ network: "10.0.0.0", netmask: "255.0.0.0" }],
  dns: [{ server: "10.0.0.53", domain: "corp.example" }],
  customOptions: ["--persist-tun"],
};

const wireGuardConfig = {
  enabled: true,
  interface: {
    privateKey: "wg-private",
    address: ["10.8.0.2/32"],
    dns: ["10.8.0.1"],
    mtu: 1420,
  },
  peer: {
    publicKey: "wg-public",
    presharedKey: "wg-preshared",
    endpoint: "vpn.example.com:51820",
    allowedIPs: ["10.20.0.0/16"],
    persistentKeepalive: 25,
  },
  listenPort: 51820,
  fwmark: 42,
  interfaceName: "sorng-wg-office",
};

const tailscaleConfig = {
  enabled: true,
  authKey: "tskey-secret",
  loginServer: "https://controlplane.tailscale.com",
  advertiseRoutes: ["10.30.0.0/16"],
  acceptRoutes: true,
  acceptDNS: true,
  advertiseTags: ["tag:office"],
  hostname: "office-node",
  exitNode: "100.64.0.9",
  exitNodeAllowLanAccess: false,
  ssh: true,
  funnel: false,
  stateDir: "C:/tailscale/state",
  socket: "C:/tailscale/tailscaled.sock",
};

const zeroTierConfig = {
  enabled: true,
  networkId: "8056c2e21c000001",
  identity: { public: "zt-public", secret: "zt-secret" },
  allowManaged: true,
  allowGlobal: false,
  allowDefault: false,
  allowDNS: true,
  zerotierHome: "C:/ZeroTier",
  authtokenSecret: "zt-authtoken",
};

describe("VPN IPC provider boundary", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("translates each executable provider to the exact Rust config shape", () => {
    expect(toOpenVpnIpcConfig(openVpnConfig)).toMatchObject({
      config_file: "C:/vpn/office.ovpn",
      username: "alice",
      password: "openvpn-secret",
      remote_host: "vpn.example.com",
      remote_port: 1194,
      routes: [{ network: "10.0.0.0", netmask: "255.0.0.0" }],
      dns_servers: [{ server: "10.0.0.53", domain: "corp.example" }],
      custom_options: ["--persist-tun"],
    });
    expect(toOpenVpnIpcConfig({ enabled: true })).toMatchObject({
      routes: [],
      dns_servers: [],
      custom_options: [],
    });

    const wireGuard = toWireGuardIpcConfig(wireGuardConfig);
    expect(wireGuard).toMatchObject({
      private_key: "wg-private",
      public_key: "wg-public",
      addresses: ["10.8.0.2/32"],
      allowed_ips: ["10.20.0.0/16"],
      dns_servers: ["10.8.0.1"],
      endpoint: "vpn.example.com:51820",
      listen_port: 51820,
      fwmark: 42,
      interface_name: "sorng-wg-office",
    });
    expect(wireGuard.addresses).not.toEqual(wireGuard.allowed_ips);
    expect(
      toWireGuardIpcConfig({
        enabled: true,
        configFile: "C:/vpn/office.conf",
        interface: { privateKey: "", address: [] },
        peer: { publicKey: "", allowedIPs: [] },
      }),
    ).toEqual({
      addresses: [],
      allowed_ips: [],
      dns_servers: [],
      config_file: "C:/vpn/office.conf",
    });

    expect(toTailscaleIpcConfig(tailscaleConfig)).toMatchObject({
      auth_key: "tskey-secret",
      login_server: "https://controlplane.tailscale.com",
      advertise_routes: ["10.30.0.0/16"],
      advertise_tags: ["tag:office"],
      accept_routes: true,
      exit_node: "100.64.0.9",
      ssh: true,
    });

    expect(toZeroTierIpcConfig(zeroTierConfig)).toEqual({
      network_id: "8056c2e21c000001",
      identity_public: "zt-public",
      identity_secret: "zt-secret",
      allow_managed: true,
      allow_global: false,
      allow_default: false,
      allow_dns: true,
      zerotier_home: "C:/ZeroTier",
      authtoken_secret: "zt-authtoken",
    });
  });

  it("uses provider-specific create/update command payloads and the real ovpn import command", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command.startsWith("create_") ? `${command}-id` : undefined,
    );
    const manager = ProxyOpenVPNManager.getInstance();

    await expect(
      manager.createOpenVPNConnection("Office", openVpnConfig),
    ).resolves.toBe("create_openvpn_connection-id");
    await manager.updateWireGuardConnection(
      "wg-id",
      "WireGuard",
      wireGuardConfig,
    );
    await manager.createTailscaleConnection("Tailnet", tailscaleConfig);
    await manager.updateZeroTierConnection("zt-id", "ZeroTier", zeroTierConfig);
    await expect(
      manager.createOpenVPNConnectionFromOvpn(
        "Imported",
        "client\nremote vpn.example.com 1194\n",
      ),
    ).resolves.toBe("create_openvpn_connection_from_ovpn-id");
    await expect(
      manager.createWireGuardConnectionFromConf(
        "Imported WG",
        "[Interface]\nPrivateKey=private\n[Peer]\nPublicKey=public\n",
      ),
    ).resolves.toBe("create_wireguard_connection_from_conf-id");

    expect(invokeMock).toHaveBeenCalledWith("create_openvpn_connection", {
      name: "Office",
      config: expect.objectContaining({
        remote_host: "vpn.example.com",
        routes: expect.any(Array),
        dns_servers: expect.any(Array),
      }),
    });
    expect(invokeMock).toHaveBeenCalledWith("update_wireguard_connection", {
      connectionId: "wg-id",
      name: "WireGuard",
      config: expect.objectContaining({
        addresses: ["10.8.0.2/32"],
        allowed_ips: ["10.20.0.0/16"],
      }),
    });
    expect(invokeMock).toHaveBeenCalledWith("create_tailscale_connection", {
      name: "Tailnet",
      config: expect.objectContaining({ auth_key: "tskey-secret" }),
    });
    expect(invokeMock).toHaveBeenCalledWith("update_zerotier_connection", {
      connectionId: "zt-id",
      name: "ZeroTier",
      config: expect.objectContaining({ network_id: "8056c2e21c000001" }),
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "create_openvpn_connection_from_ovpn",
      {
        name: "Imported",
        ovpnContent: "client\nremote vpn.example.com 1194\n",
      },
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "create_wireguard_connection_from_conf",
      {
        name: "Imported WG",
        content: "[Interface]\nPrivateKey=private\n[Peer]\nPublicKey=public\n",
      },
    );
  });

  it("keeps connect/disconnect payloads ID-only and validates returned IDs", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    invokeMock.mockResolvedValue(undefined);
    await manager.connectOpenVPN("ovpn-id");
    await manager.disconnectWireGuard("wg-id");
    await manager.connectTailscale("ts-id");
    await manager.disconnectZeroTier("zt-id");

    expect(invokeMock).toHaveBeenCalledWith("connect_openvpn", {
      connectionId: "ovpn-id",
    });
    expect(invokeMock).toHaveBeenCalledWith("disconnect_wireguard", {
      connectionId: "wg-id",
    });
    expect(invokeMock).toHaveBeenCalledWith("connect_tailscale", {
      connectionId: "ts-id",
    });
    expect(invokeMock).toHaveBeenCalledWith("disconnect_zerotier", {
      connectionId: "zt-id",
    });

    invokeMock.mockResolvedValueOnce("");
    await expect(
      manager.createZeroTierConnection("Broken", zeroTierConfig),
    ).rejects.toThrow("ZeroTier connection id response is malformed");
  });

  it("normalizes representative Rust list/get/status responses for all four providers", async () => {
    const responses: Record<string, unknown> = {
      list_openvpn_connections: [rustOpenVpn()],
      get_openvpn_connection: rustOpenVpn(),
      list_wireguard_connections: [rustWireGuard()],
      list_tailscale_connections: [rustTailscale()],
      list_zerotier_connections: [rustZeroTier()],
      get_openvpn_status: "Connected",
      get_wireguard_status: { Error: "wg runtime detail" },
      get_tailscale_status: "FutureState",
      get_zerotier_status: "Disconnected",
    };
    invokeMock.mockImplementation(
      async (command: string) => responses[command],
    );
    const manager = ProxyOpenVPNManager.getInstance();

    const openvpn = await manager.listOpenVPNConnections();
    expect(openvpn[0]).toMatchObject({
      id: "ovpn-id",
      status: "connected",
      config: {
        remoteHost: "vpn.example.com",
        inlineConfig: undefined,
      },
      secretPresence: {
        password: true,
        inlineConfig: true,
        clientKey: false,
      },
      localIp: "10.9.0.2",
    });
    expect(openvpn[0].createdAt).toBeInstanceOf(Date);
    await expect(
      manager.getOpenVPNConnection("ovpn-id"),
    ).resolves.toMatchObject({
      id: "ovpn-id",
    });

    await expect(manager.listWireGuardConnections()).resolves.toEqual([
      expect.objectContaining({
        id: "wg-id",
        status: "disconnected",
        config: expect.objectContaining({
          interface: expect.objectContaining({ address: ["10.8.0.2/32"] }),
          peer: expect.objectContaining({ allowedIPs: ["10.20.0.0/16"] }),
          listenPort: 51820,
          fwmark: 42,
          interfaceName: "sorng-wg-office",
        }),
        secretPresence: { privateKey: true, presharedKey: false },
      }),
    ]);
    await expect(manager.listTailscaleConnections()).resolves.toEqual([
      expect.objectContaining({
        id: "ts-id",
        status: "connecting",
        config: expect.objectContaining({
          authKey: undefined,
          acceptDNS: true,
          hostname: "office-node",
          exitNodeAllowLanAccess: false,
        }),
        secretPresence: { authKey: true },
      }),
    ]);
    await expect(manager.listZeroTierConnections()).resolves.toEqual([
      expect.objectContaining({
        id: "zt-id",
        status: "error",
        config: expect.objectContaining({
          networkId: "8056c2e21c000001",
          zerotierHome: "C:/ZeroTier",
          authtokenSecret: undefined,
        }),
        secretPresence: { identitySecret: true, authtokenSecret: true },
      }),
    ]);

    await expect(manager.getOpenVPNStatus("ovpn-id")).resolves.toBe(
      "connected",
    );
    await expect(manager.getWireGuardStatus("wg-id")).resolves.toBe("error");
    await expect(manager.getTailscaleStatus("ts-id")).resolves.toBe("error");
    await expect(manager.getZeroTierStatus("zt-id")).resolves.toBe(
      "disconnected",
    );
  });

  it("fails malformed provider snapshots without echoing secret-bearing payloads", async () => {
    const secret = "do-not-echo-this-secret";
    expect(() =>
      fromOpenVpnIpcConnection({
        id: "",
        name: "Broken",
        status: "Disconnected",
        created_at: createdAt,
        config: { password: secret },
      }),
    ).toThrow("OpenVPN connection id response is malformed");

    try {
      fromOpenVpnIpcConnection({
        id: "",
        name: "Broken",
        status: "Disconnected",
        created_at: createdAt,
        config: { password: secret },
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
    expect(normalizeVpnStatus({ FutureState: secret })).toBe("error");
  });

  it("accepts flat and wrapped redacted DTOs while never exposing returned secret values", () => {
    const openvpn = fromOpenVpnIpcConnection({
      ...rustOpenVpn(),
      secret_presence: {
        password: true,
        inline_config: true,
        client_key: true,
      },
    });
    const wireguard = fromWireGuardIpcConnection({
      connection: rustWireGuard(),
      secret_presence: { private_key: true, preshared_key: true },
    });
    const tailscale = fromTailscaleIpcConnection({
      ...rustTailscale(),
      secret_presence: { auth_key: true },
    });
    const zerotier = fromZeroTierIpcConnection({
      connection: rustZeroTier(),
      secretPresence: { identitySecret: true, authtokenSecret: true },
    });

    expect(openvpn.config).toMatchObject({
      password: undefined,
      inlineConfig: undefined,
      clientKey: undefined,
    });
    expect(openvpn.secretPresence).toEqual({
      password: true,
      inlineConfig: true,
      clientKey: true,
    });
    expect(wireguard.config.interface.privateKey).toBe("");
    expect(wireguard.config.peer.presharedKey).toBeUndefined();
    expect(wireguard.secretPresence).toEqual({
      privateKey: true,
      presharedKey: true,
    });
    expect(tailscale.config.authKey).toBeUndefined();
    expect(tailscale.secretPresence.authKey).toBe(true);
    expect(zerotier.config.identity?.secret).toBe("");
    expect(zerotier.config.authtokenSecret).toBeUndefined();
    expect(zerotier.secretPresence).toEqual({
      identitySecret: true,
      authtokenSecret: true,
    });
  });

  it("preserves blank secrets, replaces explicit values, clears only through typed top-level mutations, and rejects conflicts", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    invokeMock.mockResolvedValue(undefined);

    const cases = [
      {
        update: (config: Record<string, unknown>, mutation?: any) =>
          manager.updateOpenVPNConnection("ovpn", undefined, config, mutation),
        command: "update_openvpn_connection",
        blank: { enabled: true, password: "   " },
        replace: { enabled: true, password: "new-openvpn" },
        ipcField: "password",
        clear: { clearPassword: true },
        ipcClear: "clear_password",
      },
      {
        update: (config: Record<string, unknown>, mutation?: any) =>
          manager.updateWireGuardConnection("wg", undefined, config, mutation),
        command: "update_wireguard_connection",
        blank: {
          enabled: true,
          interface: { privateKey: " ", address: [] },
          peer: { publicKey: "public", allowedIPs: [] },
        },
        replace: {
          enabled: true,
          interface: { privateKey: "new-wireguard", address: [] },
          peer: { publicKey: "public", allowedIPs: [] },
        },
        ipcField: "private_key",
        clear: { clearPrivateKey: true },
        ipcClear: "clear_private_key",
      },
      {
        update: (config: Record<string, unknown>, mutation?: any) =>
          manager.updateTailscaleConnection("ts", undefined, config, mutation),
        command: "update_tailscale_connection",
        blank: { enabled: true, authKey: "" },
        replace: { enabled: true, authKey: "new-tail-key" },
        ipcField: "auth_key",
        clear: { clearAuthKey: true },
        ipcClear: "clear_auth_key",
      },
      {
        update: (config: Record<string, unknown>, mutation?: any) =>
          manager.updateZeroTierConnection("zt", undefined, config, mutation),
        command: "update_zerotier_connection",
        blank: {
          enabled: true,
          networkId: "8056c2e21c000001",
          authtokenSecret: " ",
        },
        replace: {
          enabled: true,
          networkId: "8056c2e21c000001",
          authtokenSecret: "new-zt-token",
        },
        ipcField: "authtoken_secret",
        clear: { clearAuthtokenSecret: true },
        ipcClear: "clear_authtoken_secret",
      },
    ] as const;

    for (const item of cases) {
      invokeMock.mockClear();
      await item.update(item.blank);
      let payload = invokeMock.mock.calls[0][1] as Record<string, any>;
      expect(payload.config).not.toHaveProperty(item.ipcField);
      expect(payload).not.toHaveProperty("secretMutation");

      invokeMock.mockClear();
      await item.update(item.replace);
      payload = invokeMock.mock.calls[0][1] as Record<string, any>;
      expect(payload.config[item.ipcField]).toBeTruthy();
      expect(payload).not.toHaveProperty("secretMutation");

      invokeMock.mockClear();
      await item.update(item.blank, item.clear);
      payload = invokeMock.mock.calls[0][1] as Record<string, any>;
      expect(invokeMock.mock.calls[0][0]).toBe(item.command);
      expect(payload.config).not.toHaveProperty(item.ipcField);
      expect(payload.secretMutation[item.ipcClear]).toBe(true);

      invokeMock.mockClear();
      await expect(item.update(item.replace, item.clear)).rejects.toThrow(
        "cannot be replaced and cleared",
      );
      expect(invokeMock).not.toHaveBeenCalled();
    }
  });

  it("rejects masked secret sentinels for every executable provider", () => {
    expect(isMaskedSecretPlaceholder("••••••••")).toBe(true);
    expect(isMaskedSecretPlaceholder("******** (stored)")).toBe(true);
    expect(isMaskedSecretPlaceholder("[REDACTED]")).toBe(true);
    const calls = [
      () => toOpenVpnIpcConfig({ enabled: true, password: "********" }),
      () =>
        toWireGuardIpcConfig({
          enabled: true,
          interface: { privateKey: "••••••••", address: [] },
          peer: { publicKey: "public", allowedIPs: [] },
        }),
      () => toTailscaleIpcConfig({ enabled: true, authKey: "<redacted>" }),
      () =>
        toZeroTierIpcConfig({
          enabled: true,
          networkId: "8056c2e21c000001",
          authtokenSecret: "stored secret",
        }),
    ];
    calls.forEach((call) =>
      expect(call).toThrow("masked values cannot be saved"),
    );
  });

  it("applies the same preserve, replace, and clear contract to secondary provider secrets", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    invokeMock.mockResolvedValue(undefined);

    await manager.updateOpenVPNConnection(
      "ovpn-secondary",
      undefined,
      { enabled: true, inlineConfig: " ", clientKey: "" },
      { clearInlineConfig: true, clearClientKey: true },
    );
    expect(invokeMock).toHaveBeenLastCalledWith("update_openvpn_connection", {
      connectionId: "ovpn-secondary",
      name: undefined,
      config: expect.not.objectContaining({
        inline_config: expect.anything(),
        client_key: expect.anything(),
      }),
      secretMutation: {
        clear_password: false,
        clear_inline_config: true,
        clear_client_key: true,
      },
    });

    await manager.updateWireGuardConnection("wg-secondary", undefined, {
      enabled: true,
      interface: { privateKey: "", address: [] },
      peer: {
        publicKey: "peer-public",
        presharedKey: "new-preshared",
        allowedIPs: [],
      },
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "update_wireguard_connection",
      expect.objectContaining({
        config: expect.objectContaining({ preshared_key: "new-preshared" }),
      }),
    );

    await manager.updateZeroTierConnection("zt-secondary", undefined, {
      enabled: true,
      networkId: "8056c2e21c000001",
      identity: { public: "public-id", secret: "new-identity-secret" },
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "update_zerotier_connection",
      expect.objectContaining({
        config: expect.objectContaining({
          identity_public: "public-id",
          identity_secret: "new-identity-secret",
        }),
      }),
    );

    await manager.updateZeroTierConnection(
      "zt-secondary",
      undefined,
      {
        enabled: true,
        networkId: "8056c2e21c000001",
        identity: { public: "public-id", secret: "" },
      },
      { clearIdentitySecret: true },
    );
    expect(invokeMock).toHaveBeenLastCalledWith(
      "update_zerotier_connection",
      expect.objectContaining({
        config: expect.not.objectContaining({
          identity_secret: expect.anything(),
        }),
        secretMutation: expect.objectContaining({
          clear_identity_secret: true,
        }),
      }),
    );
  });

  it("flattens normalized persisted configs back into editable form state", () => {
    expect(toVpnEditorFormConfig("wireguard", wireGuardConfig)).toMatchObject({
      privateKey: undefined,
      address: "10.8.0.2/32",
      allowedIPs: "10.20.0.0/16",
      endpoint: "vpn.example.com:51820",
      listenPort: 51820,
      fwmark: 42,
      interfaceName: "sorng-wg-office",
    });
    expect(
      toVpnEditorFormConfig("openvpn", {
        ...openVpnConfig,
        inlineConfig: "client\nremote vpn.example.com\n",
        keepAlive: { interval: 10, timeout: 60 },
      }),
    ).toMatchObject({
      inlineConfig: undefined,
      keepAliveInterval: 10,
      keepAliveTimeout: 60,
      customOptions: "--persist-tun",
    });
  });

  it("preserves supported hidden provider settings through an unrelated editor save", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    const updateWireGuard = vi
      .spyOn(manager, "updateWireGuardConnection")
      .mockResolvedValue(undefined);
    const onSave = vi.fn();
    const editingConnection = {
      id: "wg-id",
      vpnType: "wireguard" as const,
      name: "Office WireGuard",
      config: {
        enabled: true,
        configFile: "C:/vpn/office.conf",
        interface: {
          privateKey: "",
          address: [],
          table: "auto",
        },
        peer: { publicKey: "", allowedIPs: [] },
        listenPort: 51820,
        interfaceName: "sorng-wg-office",
      },
    };
    const { result } = renderHook(() =>
      useVpnEditor(true, editingConnection, onSave),
    );

    await waitFor(() => expect(result.current.editingId).toBe("wg-id"));
    await act(async () => result.current.handleSave());

    expect(updateWireGuard).toHaveBeenCalledWith(
      "wg-id",
      "Office WireGuard",
      expect.objectContaining({
        configFile: "C:/vpn/office.conf",
        interface: expect.objectContaining({
          privateKey: undefined,
          table: "auto",
        }),
        peer: expect.objectContaining({ publicKey: undefined }),
        listenPort: 51820,
        interfaceName: "sorng-wg-office",
      }),
    );
    expect(onSave).toHaveBeenCalledOnce();
    updateWireGuard.mockRestore();
  });

  it("preserves unsupported legacy settings until explicit removal", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    const updateTailscale = vi
      .spyOn(manager, "updateTailscaleConnection")
      .mockResolvedValue(undefined);
    const onSave = vi.fn();
    const editingConnection = {
      id: "ts-id",
      vpnType: "tailscale" as const,
      name: "Legacy Tailnet",
      config: {
        enabled: true,
        authKey: "secret-auth-key",
        stateDir: "C:/legacy-state",
        socket: "C:/legacy.sock",
        funnel: true,
      },
    };
    const { result } = renderHook(() =>
      useVpnEditor(true, editingConnection, onSave),
    );

    await waitFor(() => expect(result.current.editingId).toBe("ts-id"));
    expect(result.current.unsupportedSettings).toEqual([
      "Funnel",
      "custom daemon state directory",
      "custom daemon socket",
    ]);
    expect(result.current.canSave).toBe(false);

    act(() => result.current.updateConfig({ hostname: "renamed-node" }));
    expect(result.current.config).toMatchObject({
      stateDir: "C:/legacy-state",
      socket: "C:/legacy.sock",
      funnel: true,
      hostname: "renamed-node",
    });
    await act(async () => result.current.handleSave());
    expect(updateTailscale).not.toHaveBeenCalled();
    expect(result.current.error).not.toContain("secret-auth-key");
    expect(result.current.error).not.toContain("C:/legacy.sock");

    act(() => result.current.removeUnsupportedSettings());
    expect(result.current.unsupportedSettings).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.config).toMatchObject({
      hostname: "renamed-node",
      stateDir: undefined,
      socket: undefined,
      funnel: undefined,
    });
    expect(result.current.canSave).toBe(true);

    await act(async () => result.current.handleSave());
    expect(updateTailscale).toHaveBeenCalledWith(
      "ts-id",
      "Legacy Tailnet",
      expect.not.objectContaining({
        stateDir: expect.anything(),
        socket: expect.anything(),
        funnel: expect.anything(),
      }),
    );
    expect(onSave).toHaveBeenCalledOnce();
    updateTailscale.mockRestore();
  });

  it("round-trips a manual OpenVPN TLS mode switch without retaining the old mode", async () => {
    const manager = ProxyOpenVPNManager.getInstance();
    const updateOpenVpn = vi
      .spyOn(manager, "updateOpenVPNConnection")
      .mockResolvedValue(undefined);
    const onSave = vi.fn();
    const editingConnection = {
      id: "ovpn-id",
      vpnType: "openvpn" as const,
      name: "Office OpenVPN",
      config: {
        enabled: true,
        remoteHost: "vpn.example.com",
        tlsAuth: true,
        tlsAuthFile: "C:/vpn/old-auth.key",
      },
    };
    const { result } = renderHook(() =>
      useVpnEditor(true, editingConnection, onSave),
    );

    await waitFor(() => expect(result.current.editingId).toBe("ovpn-id"));
    act(() =>
      result.current.updateConfig({
        tlsAuth: false,
        tlsCrypt: true,
        tlsCryptFile: "C:/vpn/tls-crypt.key",
      }),
    );
    await act(async () => result.current.handleSave());

    expect(updateOpenVpn).toHaveBeenCalledWith(
      "ovpn-id",
      "Office OpenVPN",
      expect.objectContaining({
        tlsCrypt: true,
        tlsCryptFile: "C:/vpn/tls-crypt.key",
      }),
    );
    expect(updateOpenVpn.mock.calls[0][2]).not.toHaveProperty("tlsAuth");
    expect(updateOpenVpn.mock.calls[0][2]).not.toHaveProperty("tlsAuthFile");
    expect(onSave).toHaveBeenCalledOnce();
    updateOpenVpn.mockRestore();
  });

  it("labels unsupported settings without exposing their values", () => {
    expect(
      getUnsupportedVpnEditorSettings("wireguard", {
        table: "secret-table-name",
        fwmark: 42,
      }),
    ).toEqual(["custom routing table", "FwMark"]);
    expect(
      getUnsupportedVpnEditorSettings("zerotier", {
        identity: { public: "public-id", secret: "secret-node-id" },
      }),
    ).toEqual([]);
  });

  it("requires separate TLS key files only for manual OpenVPN profiles", () => {
    expect(
      getVpnEditorValidationError("openvpn", {
        tlsAuth: true,
        tlsCrypt: true,
      }),
    ).toBe(
      "TLS Auth and TLS Crypt are mutually exclusive for an OpenVPN client profile.",
    );
    expect(
      getVpnEditorValidationError("openvpn", {
        tlsAuth: true,
      }),
    ).toBe("Select a TLS Auth key file before saving this OpenVPN profile.");
    expect(
      getVpnEditorValidationError("openvpn", {
        tlsCrypt: true,
      }),
    ).toBe("Select a TLS Crypt key file before saving this OpenVPN profile.");
    expect(
      getVpnEditorValidationError("openvpn", {
        tlsAuth: true,
        tlsAuthFile: "C:/vpn/tls-auth.key",
      }),
    ).toBeNull();
    expect(
      getVpnEditorValidationError("openvpn", {
        tlsCrypt: true,
        tlsCryptFile: "C:/vpn/tls-crypt.key",
      }),
    ).toBeNull();

    for (const source of [
      { configFile: "C:/vpn/office.ovpn" },
      { inlineConfig: "client\n<tls-auth>\ninline-key\n</tls-auth>\n" },
    ]) {
      expect(
        getVpnEditorValidationError("openvpn", {
          ...source,
          tlsAuth: true,
          tlsCrypt: true,
        }),
      ).toBeNull();
    }
  });
});

function rustOpenVpn() {
  return {
    id: "ovpn-id",
    name: "Office OpenVPN",
    config: {
      config_file: null,
      inline_config: "client\nremote vpn.example.com\n",
      auth_file: null,
      ca_cert: null,
      client_cert: null,
      client_key: null,
      username: "alice",
      password: "openvpn-secret",
      remote_host: "vpn.example.com",
      remote_port: 1194,
      protocol: "udp",
      cipher: null,
      auth: null,
      tls_auth: null,
      tls_auth_file: null,
      tls_crypt: null,
      tls_crypt_file: null,
      compression: null,
      mss_fix: null,
      tun_mtu: null,
      fragment: null,
      mtu_discover: null,
      keep_alive: { interval: 10, timeout: 60 },
      route_no_pull: false,
      routes: [],
      dns_servers: [],
      custom_options: [],
    },
    status: "Connected",
    created_at: createdAt,
    connected_at: createdAt,
    process_id: 42,
    local_ip: "10.9.0.2",
    remote_ip: "203.0.113.8",
  };
}

function rustWireGuard() {
  return {
    id: "wg-id",
    name: "Office WireGuard",
    config: {
      private_key: "wg-private",
      public_key: "wg-public",
      preshared_key: null,
      endpoint: "vpn.example.com:51820",
      addresses: ["10.8.0.2/32"],
      allowed_ips: ["10.20.0.0/16"],
      persistent_keepalive: 25,
      listen_port: 51820,
      dns_servers: ["10.8.0.1"],
      mtu: 1420,
      table: null,
      fwmark: 42,
      config_file: null,
      interface_name: "sorng-wg-office",
    },
    status: "Disconnected",
    created_at: createdAt,
    connected_at: null,
    interface_name: null,
    local_ip: null,
    peer_ip: null,
    process_id: null,
  };
}

function rustTailscale() {
  return {
    id: "ts-id",
    name: "Office Tailnet",
    config: {
      auth_key: "tskey-secret",
      login_server: "https://controlplane.tailscale.com",
      accept_routes: true,
      accept_dns: true,
      advertise_routes: ["10.30.0.0/16"],
      advertise_tags: ["tag:office"],
      hostname: "office-node",
      exit_node: null,
      exit_node_allow_lan_access: false,
      ssh: true,
      funnel: false,
      state_dir: "C:/tailscale/state",
      socket: "C:/tailscale/tailscaled.sock",
    },
    status: "Connecting",
    created_at: createdAt,
    connected_at: null,
    tailnet_ip: null,
    hostname: null,
    process_id: null,
  };
}

function rustZeroTier() {
  return {
    id: "zt-id",
    name: "Office ZeroTier",
    config: {
      network_id: "8056c2e21c000001",
      identity_secret: "zt-secret",
      identity_public: "zt-public",
      allow_managed: true,
      allow_global: false,
      allow_default: false,
      allow_dns: true,
      zerotier_home: "C:/ZeroTier",
      authtoken_secret: "zt-authtoken",
    },
    status: { Error: "provider failure" },
    created_at: createdAt,
    connected_at: null,
    network_id: null,
    assigned_ips: [],
    process_id: null,
  };
}
