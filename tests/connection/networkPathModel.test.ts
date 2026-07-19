import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { NetworkPathCatalog } from "../../src/utils/network/resolveNetworkPath";
import { buildRuntimeNetworkPath } from "../../src/utils/network/resolveRuntimeNetworkPath";
import {
  asNetworkPathConnection,
  getNetworkPathEditorModel,
  getRawSocketNetworkRoutes,
  getRloginNetworkPathCapability,
  getRuntimeNetworkPathProtocol,
  resetNetworkPath,
  selectedInlineVpnId,
  setInlineVpn,
  setNetworkPathReference,
  withCurrentOrphanOption,
} from "../../src/components/connection/editor/networkPathModel";
import { createDefaultRawSocketSettings } from "../../src/types/protocols/rawSocket";
import { createDefaultPowerShellRemotingSettings } from "../../src/utils/powershell/normalizePowerShellRemoting";

const EMPTY_CATALOG: NetworkPathCatalog = {
  connections: [],
  connectionChains: [],
  proxyCollection: {
    profiles: [],
    chains: [],
    tunnelChains: [],
    tunnelProfiles: [],
  },
};

const draft = (overrides: Partial<Connection> = {}): Partial<Connection> => ({
  id: "target",
  name: "Target",
  protocol: "ssh",
  hostname: "target.example.test",
  port: 22,
  isGroup: false,
  ...overrides,
});

describe("networkPathModel", () => {
  it("enforces tunnel-source replacement and persists a stable VPN ID", () => {
    const referenced = draft({
      tunnelChainId: "saved-chain",
      security: {
        tunnelChain: [{ id: "old-vpn", type: "openvpn", enabled: true }],
      },
    });

    const selectedChain = setNetworkPathReference(
      referenced,
      "tunnelChainId",
      "replacement-chain",
    );
    expect(selectedChain.security?.tunnelChain).toBeUndefined();

    const selectedVpn = setInlineVpn(selectedChain, {
      id: "vpn-stable-id",
      name: "Production WireGuard",
      vpnType: "wireguard",
    });
    expect(selectedVpn.tunnelChainId).toBeUndefined();
    expect(selectedVpn.security?.tunnelChain).toEqual([
      {
        id: "inline-vpn",
        name: "Production WireGuard",
        type: "wireguard",
        enabled: true,
        vpn: { configId: "vpn-stable-id" },
      },
    ]);
    expect(selectedInlineVpnId(selectedVpn)).toBe("vpn-stable-id");
  });

  it("resets only network-path fields and preserves unrelated security", () => {
    const reset = resetNetworkPath(
      draft({
        connectionChainId: "connection-chain",
        proxyChainId: "proxy-chain",
        tunnelChainId: "tunnel-chain",
        security: {
          encryptionAlgorithm: "aes256",
          openvpn: { enabled: true, configId: "legacy-vpn" },
          proxy: {
            type: "socks5",
            host: "proxy.example.test",
            port: 1080,
            enabled: true,
          },
          tunnelChain: [{ id: "vpn", type: "openvpn", enabled: true }],
        },
      }),
    );

    expect(reset).toMatchObject({
      connectionChainId: undefined,
      proxyChainId: undefined,
      tunnelChainId: undefined,
      security: { encryptionAlgorithm: "aes256" },
    });
    expect(reset.security?.proxy).toBeUndefined();
    expect(reset.security?.openvpn).toBeUndefined();
    expect(reset.security?.tunnelChain).toBeUndefined();
  });

  it("keeps unavailable saved IDs visible and clearable", () => {
    expect(
      withCurrentOrphanOption(
        [{ value: "", label: "None" }],
        "deleted-chain",
        "proxy chain",
      ),
    ).toContainEqual(
      expect.objectContaining({
        value: "deleted-chain",
        label: expect.stringContaining("Unavailable proxy chain"),
      }),
    );
  });

  it("matches the runtime adapter when RDP blocks a proxy-only path", () => {
    const formData = draft({
      protocol: "rdp",
      port: 3389,
      security: {
        proxy: {
          type: "socks5",
          host: "proxy.example.test",
          port: 1080,
          enabled: true,
        },
      },
    });
    const model = getNetworkPathEditorModel(formData, EMPTY_CATALOG, "rdp");

    expect(model.summary.layers.map((layer) => layer.transport)).toEqual([
      "socks5",
    ]);
    expect(model.runtime).toMatchObject({
      supported: false,
      code: "unsupported-layer",
    });
    expect(model.runtime.message).toMatch(/final SSH bastion/i);
    expect(() =>
      buildRuntimeNetworkPath(
        asNetworkPathConnection(formData),
        EMPTY_CATALOG,
        "rdp",
      ),
    ).toThrowError(model.runtime.message);
  });

  it("surfaces missing and non-strict references before connect", () => {
    const missing = getNetworkPathEditorModel(
      draft({ proxyChainId: "missing" }),
      EMPTY_CATALOG,
      "ssh",
    );
    expect(missing.validation.issues).toEqual([
      expect.objectContaining({
        code: "missing-reference",
        severity: "error",
      }),
    ]);
    expect(missing.runtime.supported).toBe(false);

    const dynamicCatalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      proxyCollection: {
        ...EMPTY_CATALOG.proxyCollection!,
        chains: [
          {
            id: "dynamic",
            name: "Dynamic chain",
            createdAt: "",
            updatedAt: "",
            dynamics: { strategy: "dynamic" },
            layers: [
              {
                position: 0,
                type: "proxy",
                inlineConfig: {
                  type: "http",
                  host: "proxy.example.test",
                  port: 8080,
                  enabled: true,
                },
              },
            ],
          },
        ],
      },
    };
    const dynamic = getNetworkPathEditorModel(
      draft({ proxyChainId: "dynamic" }),
      dynamicCatalog,
      "ssh",
    );
    expect(dynamic.runtime.supported).toBe(false);
    expect(dynamic.runtime.message).toMatch(/dynamic routing/i);
  });

  it("reports explicit direct support for Raw TCP, Raw UDP, and RLogin", () => {
    const rawTcp = draft({
      protocol: "raw",
      rawSocketSettings: createDefaultRawSocketSettings("tcp"),
    });
    const rawUdp = draft({
      protocol: "raw",
      rawSocketSettings: createDefaultRawSocketSettings("udp"),
    });
    const rlogin = draft({ protocol: "rlogin", port: 513 });
    const powershell = draft({ protocol: "winrm", port: 5985 });

    expect(getRuntimeNetworkPathProtocol(rawTcp)).toBe("raw-tcp");
    expect(getRuntimeNetworkPathProtocol(rawUdp)).toBe("raw-udp");
    expect(getRuntimeNetworkPathProtocol(rlogin)).toBe("rlogin");
    expect(getRuntimeNetworkPathProtocol(powershell)).toBe("powershell");

    const tcpModel = getNetworkPathEditorModel(
      rawTcp,
      EMPTY_CATALOG,
      "raw-tcp",
    );
    const udpModel = getNetworkPathEditorModel(
      rawUdp,
      EMPTY_CATALOG,
      "raw-udp",
    );
    const rloginModel = getNetworkPathEditorModel(
      rlogin,
      EMPTY_CATALOG,
      "rlogin",
    );
    const powershellModel = getNetworkPathEditorModel(
      powershell,
      EMPTY_CATALOG,
      "powershell",
    );

    expect(tcpModel.runtime).toMatchObject({ supported: true });
    expect(tcpModel.runtime.message).toMatch(/Direct Raw TCP is supported/i);
    expect(udpModel.runtime.message).toMatch(/Direct Raw UDP is supported/i);
    expect(rloginModel.runtime.message).toMatch(
      /Direct RLogin TCP is supported/i,
    );
    expect(powershellModel.runtime).toMatchObject({ supported: true });
    expect(powershellModel.runtime.message).toMatch(
      /Direct PowerShell Remoting is available/i,
    );
    expect(getRawSocketNetworkRoutes(tcpModel)).toEqual(["direct"]);
    expect(getRloginNetworkPathCapability(rloginModel)).toMatchObject({
      configured: false,
      supported: true,
      layers: [],
    });
  });

  it("fails closed for every configured advanced-protocol hop", () => {
    const routed = {
      proxy: {
        type: "socks5" as const,
        host: "proxy.example.test",
        port: 1080,
        enabled: true,
      },
    };
    const cases = [
      ["raw-tcp", draft({ protocol: "raw", security: routed })],
      [
        "raw-udp",
        draft({
          protocol: "raw",
          rawSocketSettings: createDefaultRawSocketSettings("udp"),
          security: routed,
        }),
      ],
      ["rlogin", draft({ protocol: "rlogin", security: routed })],
      ["powershell", draft({ protocol: "winrm", security: routed })],
    ] as const;

    for (const [protocol, formData] of cases) {
      const model = getNetworkPathEditorModel(
        formData,
        EMPTY_CATALOG,
        protocol,
      );
      expect(model.runtime).toMatchObject({
        supported: false,
        code: "unsupported-layer",
      });
      expect(model.runtime.message).toMatch(/will not be bypassed|adapter/i);
    }

    const rloginModel = getNetworkPathEditorModel(
      cases[2][1],
      EMPTY_CATALOG,
      "rlogin",
    );
    expect(getRloginNetworkPathCapability(rloginModel)).toMatchObject({
      configured: true,
      supported: false,
      layers: [{ kind: "socks5", label: "socks5" }],
    });
  });

  it("blocks explicit PowerShell route settings until an adapter exists", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.wsman.proxy = {
      mode: "http",
      url: "http://proxy.example.test:8080",
      credentialRef: null,
    };
    const model = getNetworkPathEditorModel(
      draft({ protocol: "winrm", powerShellRemoting: settings }),
      EMPTY_CATALOG,
      "powershell",
    );

    expect(model.runtime).toMatchObject({
      supported: false,
      code: "unsupported-layer",
    });
    expect(model.runtime.message).toMatch(/no network-path adapter/i);
  });
});
