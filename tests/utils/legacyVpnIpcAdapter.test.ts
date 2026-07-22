import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { ProxyOpenVPNManager } from "../../src/utils/network/proxyOpenVPNManager";
import {
  fromIkeV2IpcConnection,
  fromIpsecIpcConnection,
  fromL2tpIpcConnection,
  fromPptpIpcConnection,
  fromSstpIpcConnection,
  toIkeV2IpcConfig,
  toIpsecIpcConfig,
  toIpsecIpcSecretMutation,
  toIkeV2IpcSecretMutation,
  toL2tpIpcConfig,
  toL2tpIpcSecretMutation,
  toPptpIpcConfig,
  toSstpIpcConfig,
} from "../../src/utils/network/vpnIpcAdapter";
import { toVpnEditorFormConfig } from "../../src/hooks/network/useVpnEditor";

const createdAt = "2026-07-22T12:00:00Z";

const configs = {
  ikev2: {
    enabled: true,
    server: "ike.example.com",
    username: "alice",
    password: "password",
    certificate: "/certs/client.pem",
    privateKey: "/certs/client.key",
    caCertificate: "/certs/ca.pem",
    eapMethod: "mschapv2" as const,
    phase1Algorithms: "aes256-sha256-modp2048",
    phase2Algorithms: "aes256-sha256",
    localId: "alice@example.com",
    remoteId: "ike.example.com",
    fragmentation: true,
    mobike: true,
    customOptions: ["fragmentation=yes"],
  },
  sstp: {
    enabled: true,
    server: "sstp.example.com",
    username: "alice",
    password: "password",
    domain: "EXAMPLE",
    certificate: "/certs/client.pem",
    caCertificate: "/certs/ca.pem",
    ignoreCertificate: false,
    proxy: {
      type: "http" as const,
      host: "proxy.example.com",
      port: 8080,
      enabled: true,
    },
    customOptions: ["--save-server-route"],
  },
  l2tp: {
    enabled: true,
    server: "l2tp.example.com",
    username: "alice",
    password: "password",
    psk: "gateway secret",
    pppSettings: {
      mru: 1400,
      mtu: 1390,
      lcpEchoInterval: 30,
      lcpEchoFailure: 4,
      requireChap: true,
      requireMsChapV2: true,
      requireEap: false,
    },
    ipsecSettings: {
      ike: "aes256-sha256-modp2048",
      esp: "aes256-sha256",
      pfs: "modp2048",
      ikelifetime: 3600,
      lifetime: 1800,
      phase2alg: "aes256-sha256",
    },
    customOptions: ["debug"],
  },
  pptp: {
    enabled: true,
    server: "pptp.example.com",
    username: "alice",
    password: "password",
    domain: "EXAMPLE",
    requireMppe: true,
    mppeStateful: false,
    refuseEap: true,
    refusePap: true,
    refuseChap: false,
    refuseMsChap: false,
    refuseMsChapV2: false,
    nobsdcomp: true,
    nodeflate: true,
    noVjComp: true,
    customOptions: ["lock"],
  },
  ipsec: {
    enabled: true,
    server: "ipsec.example.com",
    authMethod: "psk" as const,
    psk: "gateway secret",
    certificate: "/certs/client.pem",
    privateKey: "/certs/client.key",
    caCertificate: "/certs/ca.pem",
    phase1Proposals: "aes256-sha256-modp2048",
    phase2Proposals: "aes256-sha256",
    saLifetime: 3600,
    dpdDelay: 30,
    dpdTimeout: 120,
    tunnelMode: true,
    customOptions: ["closeaction=restart"],
  },
};

const ipcConfigs = {
  ikev2: {
    server: "ike.example.com",
    username: "alice",
    password: "password",
    certificate: "/certs/client.pem",
    private_key: "/certs/client.key",
    ca_certificate: "/certs/ca.pem",
    eap_method: "mschapv2",
    phase1_algorithms: "aes256-sha256-modp2048",
    phase2_algorithms: "aes256-sha256",
    local_id: "alice@example.com",
    remote_id: "ike.example.com",
    fragmentation: true,
    mobike: true,
    custom_options: ["fragmentation=yes"],
  },
  sstp: {
    server: "sstp.example.com",
    username: "alice",
    password: "password",
    domain: "EXAMPLE",
    certificate: "/certs/client.pem",
    ca_certificate: "/certs/ca.pem",
    ignore_certificate: false,
    proxy_host: "proxy.example.com",
    proxy_port: 8080,
    custom_options: ["--save-server-route"],
  },
  l2tp: {
    server: "l2tp.example.com",
    username: "alice",
    password: "password",
    psk: "gateway secret",
    ipsec_ike: "aes256-sha256-modp2048",
    ipsec_esp: "aes256-sha256",
    ipsec_pfs: "modp2048",
    mru: 1400,
    mtu: 1390,
    lcp_echo_interval: 30,
    lcp_echo_failure: 4,
    require_chap: true,
    require_mschapv2: true,
    require_eap: false,
    ipsec_ikelifetime: 3600,
    ipsec_lifetime: 1800,
    ipsec_phase2alg: "aes256-sha256",
    custom_options: ["debug"],
  },
  pptp: {
    server: "pptp.example.com",
    username: "alice",
    password: "password",
    domain: "EXAMPLE",
    require_mppe: true,
    mppe_stateful: false,
    refuse_eap: true,
    refuse_pap: true,
    refuse_chap: false,
    refuse_mschap: false,
    refuse_mschapv2: false,
    nobsdcomp: true,
    nodeflate: true,
    no_vj_comp: true,
    custom_options: ["lock"],
  },
  ipsec: {
    server: "ipsec.example.com",
    auth_method: "psk",
    psk: "gateway secret",
    certificate: "/certs/client.pem",
    private_key: "/certs/client.key",
    ca_certificate: "/certs/ca.pem",
    phase1_proposals: "aes256-sha256-modp2048",
    phase2_proposals: "aes256-sha256",
    sa_lifetime: 3600,
    dpd_delay: 30,
    dpd_timeout: 120,
    tunnel_mode: true,
    custom_options: ["closeaction=restart"],
  },
};

describe("legacy VPN IPC adapter", () => {
  beforeEach(() => invokeMock.mockReset());

  it("maps every application config to the exact Rust command shape", () => {
    expect(toIkeV2IpcConfig(configs.ikev2)).toEqual(ipcConfigs.ikev2);
    expect(toSstpIpcConfig(configs.sstp)).toEqual(ipcConfigs.sstp);
    expect(toL2tpIpcConfig(configs.l2tp)).toEqual(ipcConfigs.l2tp);
    expect(toPptpIpcConfig(configs.pptp)).toEqual(ipcConfigs.pptp);
    expect(toIpsecIpcConfig(configs.ipsec)).toEqual(ipcConfigs.ipsec);
  });

  it("uses the adapter for create and update commands", async () => {
    invokeMock.mockResolvedValue("connection-id");
    const manager = ProxyOpenVPNManager.getInstance();
    const providers = [
      {
        create: () => manager.createIKEv2Connection("IKE", configs.ikev2),
        update: () => manager.updateIKEv2Connection("id", "IKE", configs.ikev2),
        createCommand: "create_ikev2_connection",
        updateCommand: "update_ikev2_connection",
        config: ipcConfigs.ikev2,
      },
      {
        create: () => manager.createSSTPConnection("SSTP", configs.sstp),
        update: () => manager.updateSSTPConnection("id", "SSTP", configs.sstp),
        createCommand: "create_sstp_connection",
        updateCommand: "update_sstp_connection",
        config: ipcConfigs.sstp,
      },
      {
        create: () => manager.createL2TPConnection("L2TP", configs.l2tp),
        update: () => manager.updateL2TPConnection("id", "L2TP", configs.l2tp),
        createCommand: "create_l2tp_connection",
        updateCommand: "update_l2tp_connection",
        config: ipcConfigs.l2tp,
      },
      {
        create: () => manager.createPPTPConnection("PPTP", configs.pptp),
        update: () => manager.updatePPTPConnection("id", "PPTP", configs.pptp),
        createCommand: "create_pptp_connection",
        updateCommand: "update_pptp_connection",
        config: ipcConfigs.pptp,
      },
      {
        create: () => manager.createIPsecConnection("IPsec", configs.ipsec),
        update: () =>
          manager.updateIPsecConnection("id", "IPsec", configs.ipsec),
        createCommand: "create_ipsec_connection",
        updateCommand: "update_ipsec_connection",
        config: ipcConfigs.ipsec,
      },
    ];

    for (const provider of providers) {
      invokeMock.mockClear();
      await expect(provider.create()).resolves.toBe("connection-id");
      expect(invokeMock).toHaveBeenLastCalledWith(provider.createCommand, {
        name: expect.any(String),
        config: provider.config,
      });

      invokeMock.mockClear();
      await provider.update();
      expect(invokeMock).toHaveBeenLastCalledWith(provider.updateCommand, {
        connectionId: "id",
        name: expect.any(String),
        config: provider.config,
      });
    }
  });

  it("strips malicious plaintext legacy secrets and exposes presence only", () => {
    const connection = (config: object, secret_presence: object) => ({
      id: "connection-id",
      name: "Office",
      config,
      status: "Connected",
      created_at: createdAt,
      connected_at: createdAt,
      local_ip: "10.0.0.2",
      remote_ip: "203.0.113.10",
      secret_presence,
    });

    expect(
      fromIkeV2IpcConnection(
        connection(ipcConfigs.ikev2, { password: true, private_key: true }),
      ),
    ).toMatchObject({
      status: "connected",
      config: { ...configs.ikev2, password: undefined, privateKey: undefined },
      secretPresence: { password: true, privateKey: true },
    });
    expect(
      fromSstpIpcConnection(connection(ipcConfigs.sstp, { password: true })),
    ).toMatchObject({
      status: "connected",
      config: { ...configs.sstp, password: undefined },
      secretPresence: { password: true },
    });
    const l2tp = fromL2tpIpcConnection(
      connection(ipcConfigs.l2tp, { password: true, psk: true }),
    );
    expect(l2tp).toMatchObject({
      status: "connected",
      config: { ...configs.l2tp, password: "", psk: undefined },
      secretPresence: { password: true, psk: true },
    });
    expect(
      fromPptpIpcConnection(connection(ipcConfigs.pptp, { password: true })),
    ).toMatchObject({
      status: "connected",
      config: { ...configs.pptp, password: "" },
      secretPresence: { password: true },
    });
    expect(
      fromIpsecIpcConnection(
        connection(ipcConfigs.ipsec, { psk: true, private_key: true }),
      ),
    ).toMatchObject({
      status: "connected",
      config: { ...configs.ipsec, psk: undefined, privateKey: undefined },
      secretPresence: { psk: true, privateKey: true },
    });

    expect(toVpnEditorFormConfig("l2tp", l2tp.config)).toMatchObject({
      psk: undefined,
      pppMru: 1400,
      pppMtu: 1390,
      ipsecIke: "aes256-sha256-modp2048",
      ipsecEsp: "aes256-sha256",
      ipsecPfs: "modp2048",
      customOptions: "debug",
    });
  });

  it("maps preserve, replacement, and explicit clear semantics", async () => {
    expect(toIkeV2IpcSecretMutation(undefined)).toBeUndefined();
    expect(toL2tpIpcSecretMutation({ clearPassword: false })).toBeUndefined();
    expect(toL2tpIpcSecretMutation({ clearPsk: true })).toEqual({
      clear_password: false,
      clear_psk: true,
    });
    expect(() =>
      toIpsecIpcSecretMutation({ clearPsk: true }, { psk: "replacement" }),
    ).toThrow("same update");

    invokeMock.mockResolvedValue(undefined);
    const manager = ProxyOpenVPNManager.getInstance();
    await manager.updateL2TPConnection(
      "id",
      "L2TP",
      { ...configs.l2tp, password: "", psk: "" },
      { clearPsk: true },
    );
    expect(invokeMock).toHaveBeenLastCalledWith("update_l2tp_connection", {
      connectionId: "id",
      name: "L2TP",
      config: expect.not.objectContaining({
        password: expect.anything(),
        psk: expect.anything(),
      }),
      secretMutation: { clear_password: false, clear_psk: true },
    });
  });

  it("never copies legacy plaintext secrets into editor form state", () => {
    expect(
      toVpnEditorFormConfig("ikev2", {
        ...configs.ikev2,
        password: "malicious-password",
        privateKey: "malicious-key",
      }),
    ).toMatchObject({ password: undefined, privateKey: undefined });
    expect(
      toVpnEditorFormConfig("ipsec", {
        ...configs.ipsec,
        psk: "malicious-psk",
        privateKey: "malicious-key",
      }),
    ).toMatchObject({ psk: undefined, privateKey: undefined });
    expect(
      toVpnEditorFormConfig("l2tp", {
        ...configs.l2tp,
        password: "malicious-password",
        psk: "malicious-psk",
      }),
    ).toMatchObject({ password: undefined, psk: undefined });
    for (const vpnType of ["pptp", "sstp"] as const) {
      expect(
        toVpnEditorFormConfig(vpnType, {
          ...configs[vpnType],
          password: "malicious-password",
        }),
      ).toMatchObject({ password: undefined });
    }
  });

  it("rejects masked legacy secrets before invoking native commands", () => {
    expect(() => toL2tpIpcConfig({ ...configs.l2tp, psk: "********" })).toThrow(
      "masked values cannot be saved",
    );
    expect(() =>
      toIpsecIpcConfig({ ...configs.ipsec, psk: "<redacted>" }),
    ).toThrow("masked values cannot be saved");
    expect(() =>
      toIkeV2IpcConfig({ ...configs.ikev2, password: "••••••••" }),
    ).toThrow("masked values cannot be saved");
  });
});
