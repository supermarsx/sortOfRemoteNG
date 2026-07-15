import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { NetworkPathCatalog } from "../../src/utils/network/resolveNetworkPath";
import { buildRuntimeNetworkPath } from "../../src/utils/network/resolveRuntimeNetworkPath";
import {
  asNetworkPathConnection,
  getNetworkPathEditorModel,
  resetNetworkPath,
  setInlineVpn,
  setNetworkPathReference,
  withCurrentOrphanOption,
} from "../../src/components/connection/editor/networkPathModel";

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
        id: "vpn-stable-id",
        name: "Production WireGuard",
        type: "wireguard",
        enabled: true,
      },
    ]);
  });

  it("resets only network-path fields and preserves unrelated security", () => {
    const reset = resetNetworkPath(
      draft({
        connectionChainId: "connection-chain",
        proxyChainId: "proxy-chain",
        tunnelChainId: "tunnel-chain",
        security: {
          encryptionAlgorithm: "aes256",
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
});
