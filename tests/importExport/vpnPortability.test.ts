import {
  isVpnProfileExecutable,
  normalizeVpnImportData,
  prepareVpnConnectionForTransfer,
  prepareVpnDataForTransfer,
} from "../../src/components/ImportExport/vpnPortability";
import type { ImportVpnData } from "../../src/components/ImportExport/types";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const vpnData = (): ImportVpnData => ({
  openvpn: [
    {
      id: "ovpn-1",
      name: "Office OpenVPN",
      status: "disconnected",
      createdAt: NOW,
      config: {
        enabled: true,
        configFile: "C:/private/office.ovpn",
        inlineConfig: "<key>INLINE-OPENVPN-PRIVATE-KEY</key>",
        authFile: "C:/private/auth.txt",
        caCert: "C:/private/ca.pem",
        clientCert: "C:/private/client.pem",
        clientKey: "OPENVPN-PRIVATE-KEY",
        username: "private-user",
        password: "OPENVPN-PASSWORD",
        remoteHost: "vpn.example.test",
        remotePort: 1194,
        tlsAuthFile: "C:/private/ta.key",
        tlsCryptFile: "C:/private/tc.key",
        customOptions: ["auth-user-pass C:/private/other.txt"],
      },
    },
  ],
  wireguard: [
    {
      id: "wg-1",
      name: "Office WireGuard",
      status: "disconnected",
      createdAt: NOW,
      config: {
        enabled: true,
        configFile: "C:/private/wg.conf",
        interface: {
          privateKey: "WG-PRIVATE-KEY",
          address: ["10.0.0.2/32"],
          dns: ["10.0.0.53"],
          preUp: ["secret-hook-command"],
          postUp: ["post-secret-hook-command"],
          preDown: ["pre-down-secret"],
          postDown: ["post-down-secret"],
        },
        peer: {
          publicKey: "WG-PUBLIC-KEY",
          presharedKey: "WG-PRESHARED-KEY",
          endpoint: "wg.example.test:51820",
          allowedIPs: ["10.0.0.0/8"],
        },
      },
    },
  ],
  tailscale: [
    {
      id: "ts-1",
      name: "Office Tailscale",
      status: "disconnected",
      createdAt: NOW,
      config: {
        enabled: true,
        authKey: "TS-AUTH-KEY",
        loginServer: "https://login.example.test",
        hostname: "portable-host",
        stateDir: "C:/private/tailscale-state",
        socket: "C:/private/tailscale.sock",
        customOptions: ["--operator=private-user"],
      },
    },
  ],
  zerotier: [
    {
      id: "zt-1",
      name: "Office ZeroTier",
      status: "disconnected",
      createdAt: NOW,
      config: {
        enabled: true,
        networkId: "8056c2e21c000001",
        identity: {
          public: "ZT-PUBLIC-IDENTITY",
          secret: "ZT-SECRET-IDENTITY",
        },
        authtokenSecret: "ZT-AUTH-TOKEN",
        zerotierHome: "C:/private/zerotier",
        customOptions: ["private-option"],
      },
    },
  ],
});

describe("VPN import/export portability", () => {
  it("removes every provider credential and sensitive path when excluded", () => {
    const prepared = prepareVpnDataForTransfer(vpnData(), false);
    const serialized = JSON.stringify(prepared.data);

    for (const secret of [
      "INLINE-OPENVPN-PRIVATE-KEY",
      "OPENVPN-PRIVATE-KEY",
      "OPENVPN-PASSWORD",
      "private-user",
      "C:/private/office.ovpn",
      "C:/private/auth.txt",
      "C:/private/ca.pem",
      "C:/private/client.pem",
      "C:/private/ta.key",
      "C:/private/tc.key",
      "C:/private/other.txt",
      "WG-PRIVATE-KEY",
      "WG-PRESHARED-KEY",
      "C:/private/wg.conf",
      "secret-hook-command",
      "TS-AUTH-KEY",
      "C:/private/tailscale-state",
      "C:/private/tailscale.sock",
      "ZT-SECRET-IDENTITY",
      "ZT-AUTH-TOKEN",
      "C:/private/zerotier",
      "private-option",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(prepared.data.openvpn[0]).toMatchObject({
      config: { enabled: false, remoteHost: "vpn.example.test" },
      portability: { credentials: "redacted", executable: false },
    });
    expect(prepared.data.wireguard[0]).toMatchObject({
      config: {
        enabled: false,
        interface: { privateKey: "", address: ["10.0.0.2/32"] },
        peer: {
          publicKey: "WG-PUBLIC-KEY",
          endpoint: "wg.example.test:51820",
        },
      },
    });
    expect(prepared.data.zerotier[0].config.identity).toEqual({
      public: "ZT-PUBLIC-IDENTITY",
    });
    expect(prepared.warnings).toHaveLength(4);
  });

  it("retains credential material only for an explicitly included transfer", () => {
    const prepared = prepareVpnDataForTransfer(vpnData(), true);
    expect(prepared.data.openvpn[0].config.password).toBe("OPENVPN-PASSWORD");
    expect(prepared.data.wireguard[0].config.interface.privateKey).toBe(
      "WG-PRIVATE-KEY",
    );
    expect(prepared.data.tailscale[0].config.authKey).toBe("TS-AUTH-KEY");
    expect(prepared.data.zerotier[0].config.identity?.secret).toBe(
      "ZT-SECRET-IDENTITY",
    );
    expect(prepared.warnings).toEqual([]);
  });

  it("marks redacted backend secrets unavailable instead of claiming a complete backup", () => {
    const source = vpnData().wireguard[0];
    source.config.interface.privateKey = "";
    source.secretPresence = { privateKey: true, presharedKey: true };
    source.config.peer.presharedKey = undefined;

    const prepared = prepareVpnConnectionForTransfer("wireguard", source, true);

    expect(prepared.connection.config.enabled).toBe(false);
    expect(prepared.connection.portability).toMatchObject({
      credentials: "unavailable",
      executable: false,
    });
    expect(prepared.warnings.join(" ")).toContain("private key");
    expect(prepared.warnings.join(" ")).toContain("preshared key");
  });

  it("never trusts redacted or unavailable portability metadata to claim executability", () => {
    const source = vpnData().wireguard[0];

    expect(
      isVpnProfileExecutable("wireguard", {
        ...source,
        portability: {
          credentials: "redacted",
          executable: true,
        },
      }),
    ).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...source,
        portability: {
          credentials: "unavailable",
        },
      }),
    ).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...source,
        portability: {
          credentials: "included",
        },
      }),
    ).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...source,
        portability: {},
      }),
    ).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...source,
        portability: undefined,
      }),
    ).toBe(false);
  });

  it("preserves present malformed portability metadata as fail-closed", () => {
    const normalized = normalizeVpnImportData({
      wireguard: [
        {
          ...vpnData().wireguard[0],
          portability: { executable: true },
        },
      ],
    });

    expect(normalized?.wireguard[0].portability).toMatchObject({
      credentials: "unavailable",
      executable: false,
    });
    expect(normalized?.wireguard[0].portability?.warnings.join(" ")).toContain(
      "incomplete or malformed",
    );
    expect(isVpnProfileExecutable("wireguard", normalized?.wireguard[0])).toBe(
      false,
    );
  });

  it("requires provider-specific minimum authority even when portability metadata is missing", () => {
    const source = vpnData().wireguard[0];
    const keyless = {
      ...source,
      config: {
        ...source.config,
        configFile: undefined,
        interface: { ...source.config.interface, privateKey: "" },
      },
    };

    expect(isVpnProfileExecutable("wireguard", keyless)).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...keyless,
        portability: { credentials: "included", executable: true },
      }),
    ).toBe(false);
    expect(
      isVpnProfileExecutable("wireguard", {
        ...keyless,
        config: { ...keyless.config, configFile: "C:/vpn/authoritative.conf" },
      }),
    ).toBe(true);
    expect(isVpnProfileExecutable("wireguard", source)).toBe(true);
  });

  it("enforces analogous minimum authority for the other portable providers", () => {
    expect(
      isVpnProfileExecutable("openvpn", {
        config: { remoteHost: "vpn.example.test" },
      }),
    ).toBe(true);
    expect(isVpnProfileExecutable("openvpn", { config: {} })).toBe(false);
    expect(
      isVpnProfileExecutable("openvpn", {
        config: { remotes: [{ host: "structured-vpn.example.test" }] },
      }),
    ).toBe(true);
    expect(
      isVpnProfileExecutable("tailscale", { config: { authKey: "ts-key" } }),
    ).toBe(true);
    expect(isVpnProfileExecutable("tailscale", { config: {} })).toBe(false);
    expect(
      isVpnProfileExecutable("zerotier", {
        config: { networkId: "8056c2e21c000001" },
      }),
    ).toBe(true);
    expect(
      isVpnProfileExecutable("zerotier", {
        config: { networkId: "not-a-network" },
      }),
    ).toBe(false);
  });

  it("preserves advanced OpenVPN fields and migrates defaulted structured remotes", () => {
    const normalized = normalizeVpnImportData({
      openvpn: [
        {
          id: "ovpn-advanced",
          name: "Advanced OpenVPN",
          config: {
            remotes: [
              { host: "defaulted.example.test" },
              { host: "ipv4.example.test", port: 443, protocol: "tcp4" },
              { host: "invalid.example.test", port: 0, protocol: "udp" },
            ],
            remote_random: true,
            remote_random_hostname: true,
            resolve_retry_infinite: false,
            device_type: "tun",
            device_name: "tun-office",
            data_ciphers: ["AES-256-GCM", "AES-128-GCM"],
            tls_version_min: "1.2",
            verify_x509_name: "vpn-",
            verify_x509_type: "name-prefix",
            remote_cert_tls: true,
            connect_timeout: 30,
            connect_retry: 5,
            connect_retry_max_seconds: 300,
            connect_retry_max: 8,
            server_poll_timeout: 20,
            redirect_gateway: true,
            redirect_gateway_flags: ["ipv6", "!ipv4"],
            block_outside_dns: true,
            persist_tun: true,
            persist_key: true,
            nobind: true,
            float: true,
          },
        },
      ],
    });

    const expectedAdvancedConfig = {
      remotes: [
        { host: "defaulted.example.test", port: 1194, protocol: "udp" },
        { host: "ipv4.example.test", port: 443, protocol: "tcp4" },
      ],
      remoteRandom: true,
      remoteRandomHostname: true,
      resolveRetryInfinite: false,
      deviceType: "tun",
      deviceName: "tun-office",
      dataCiphers: ["AES-256-GCM", "AES-128-GCM"],
      tlsVersionMin: "1.2",
      verifyX509Name: "vpn-",
      verifyX509Type: "name-prefix",
      remoteCertTls: true,
      connectTimeout: 30,
      connectRetry: 5,
      connectRetryMaxSeconds: 300,
      connectRetryMax: 8,
      serverPollTimeout: 20,
      redirectGateway: true,
      redirectGatewayFlags: ["ipv6", "!ipv4"],
      blockOutsideDns: true,
      persistTun: true,
      persistKey: true,
      nobind: true,
      float: true,
    };
    expect(normalized?.openvpn[0].config).toMatchObject(expectedAdvancedConfig);
    expect(isVpnProfileExecutable("openvpn", normalized?.openvpn[0])).toBe(
      true,
    );

    const profile = normalized!.openvpn[0];
    const included = prepareVpnConnectionForTransfer("openvpn", profile, true);
    const includedRoundTrip = normalizeVpnImportData({
      openvpn: [included.connection],
    });
    expect(includedRoundTrip?.openvpn[0].config).toMatchObject(
      expectedAdvancedConfig,
    );

    const redacted = prepareVpnConnectionForTransfer("openvpn", profile, false);
    const redactedRoundTrip = normalizeVpnImportData({
      openvpn: [redacted.connection],
    });
    expect(redactedRoundTrip?.openvpn[0].config).toMatchObject({
      ...expectedAdvancedConfig,
      enabled: false,
    });
    expect(redactedRoundTrip?.openvpn[0].portability).toMatchObject({
      credentials: "redacted",
      executable: false,
    });
  });

  it("preserves explicit empty OpenVPN redirect flags across transfer round trips", () => {
    const normalized = normalizeVpnImportData({
      openvpn: [
        {
          id: "ovpn-bare-redirect",
          name: "Bare redirect gateway",
          config: {
            inline_config: "client\nremote vpn.example.test 1194 udp",
            redirect_gateway: true,
            redirect_gateway_flags: [],
          },
        },
        {
          id: "ovpn-legacy-redirect",
          name: "Legacy redirect gateway",
          config: {
            inline_config: "client\nremote vpn.example.test 1194 udp",
            redirect_gateway: true,
          },
        },
      ],
    });

    const explicit = normalized!.openvpn[0];
    expect(explicit.config.redirectGatewayFlags).toEqual([]);
    expect(normalized!.openvpn[1].config).not.toHaveProperty(
      "redirectGatewayFlags",
    );

    for (const includeCredentials of [true, false]) {
      const transferred = prepareVpnConnectionForTransfer(
        "openvpn",
        explicit,
        includeCredentials,
      );
      const roundTrip = normalizeVpnImportData({
        openvpn: [transferred.connection],
      });
      expect(roundTrip?.openvpn[0].config.redirectGatewayFlags).toEqual([]);
    }
  });

  it("normalizes legacy native snake_case sidecars for all providers", () => {
    const normalized = normalizeVpnImportData({
      open_vpn: [
        {
          id: "ovpn-old",
          name: "Legacy OpenVPN",
          created_at: "2025-01-01T00:00:00.000Z",
          config: {
            remote_host: "legacy-vpn.example.test",
            remote_port: 443,
            inline_config: "legacy-inline",
            client_key: "legacy-client-key",
            keep_alive: { interval: 10, timeout: 60 },
          },
        },
      ],
      wire_guard: [
        {
          id: "wg-old",
          name: "Legacy WireGuard",
          config: {
            private_key: "legacy-wg-private",
            public_key: "legacy-wg-public",
            preshared_key: "legacy-wg-psk",
            addresses: ["10.4.0.2/32"],
            allowed_ips: ["10.4.0.0/16"],
            dns_servers: ["10.4.0.53"],
            config_file: "C:/legacy/wg.conf",
            interface_name: "wg-legacy",
          },
        },
      ],
      tail_scale: [
        {
          id: "ts-old",
          name: "Legacy Tailscale",
          config: {
            auth_key: "legacy-ts-key",
            login_server: "https://legacy-login.example.test",
            advertise_routes: ["10.5.0.0/16"],
            accept_dns: true,
            state_dir: "C:/legacy/tailscale",
          },
        },
      ],
      zero_tier: [
        {
          id: "zt-old",
          name: "Legacy ZeroTier",
          config: {
            network_id: "8056c2e21c000099",
            identity_public: "legacy-public",
            identity_secret: "legacy-secret",
            authtoken_secret: "legacy-token",
            zerotier_home: "C:/legacy/zerotier",
            allow_managed: true,
          },
        },
      ],
    });

    expect(normalized?.openvpn[0].config).toMatchObject({
      remoteHost: "legacy-vpn.example.test",
      remotePort: 443,
      inlineConfig: "legacy-inline",
      clientKey: "legacy-client-key",
      keepAlive: { interval: 10, timeout: 60 },
    });
    expect(normalized?.wireguard[0].config).toMatchObject({
      configFile: "C:/legacy/wg.conf",
      interfaceName: "wg-legacy",
      interface: {
        privateKey: "legacy-wg-private",
        address: ["10.4.0.2/32"],
        dns: ["10.4.0.53"],
      },
      peer: {
        publicKey: "legacy-wg-public",
        presharedKey: "legacy-wg-psk",
        allowedIPs: ["10.4.0.0/16"],
      },
    });
    expect(normalized?.tailscale[0].config).toMatchObject({
      authKey: "legacy-ts-key",
      loginServer: "https://legacy-login.example.test",
      advertiseRoutes: ["10.5.0.0/16"],
      acceptDNS: true,
      stateDir: "C:/legacy/tailscale",
    });
    expect(normalized?.zerotier[0].config).toMatchObject({
      networkId: "8056c2e21c000099",
      identity: { public: "legacy-public", secret: "legacy-secret" },
      authtokenSecret: "legacy-token",
      zerotierHome: "C:/legacy/zerotier",
      allowManaged: true,
    });
  });
});
