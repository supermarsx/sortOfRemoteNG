import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { VPN_PROVIDER_CATALOG } from "../../src/utils/network/vpnProviderCatalog";
import { loadVpnRuntimeCapabilities } from "../../src/utils/network/vpnRuntimeCapabilities";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("VPN runtime capability IPC", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("preserves backend capability reasons and fills omissions fail-closed", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { vpnType: "openvpn", executable: true },
      {
        vpnType: "ipsec",
        executable: false,
        reason: "Windows RAS cannot safely implement this IPsec profile.",
      },
    ]);

    const capabilities = await loadVpnRuntimeCapabilities();

    expect(invoke).toHaveBeenCalledWith("get_vpn_runtime_capabilities");
    expect(capabilities).toHaveLength(VPN_PROVIDER_CATALOG.length);
    expect(capabilities).toContainEqual({
      vpnType: "ipsec",
      executable: false,
      reason: "Windows RAS cannot safely implement this IPsec profile.",
    });
    expect(capabilities).toContainEqual({
      vpnType: "ikev2",
      executable: false,
      reason:
        "The backend did not report an executable runtime capability for this provider.",
    });
    expect(capabilities).toContainEqual({
      vpnType: "softether",
      executable: false,
      reason:
        "The backend did not report an executable runtime capability for this provider.",
    });
  });

  it.each([
    null,
    {},
    [{ vpnType: "unknown", executable: true }],
    [{ vpnType: "openvpn", executable: "yes" }],
    [{ vpnType: "openvpn", executable: false, reason: 42 }],
  ])("rejects malformed responses %#", async (response) => {
    vi.mocked(invoke).mockResolvedValue(response);

    await expect(loadVpnRuntimeCapabilities()).rejects.toThrow(/malformed/i);
  });

  it("rejects duplicate provider declarations", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { vpnType: "wireguard", executable: true },
      { vpnType: "wireguard", executable: false },
    ]);

    await expect(loadVpnRuntimeCapabilities()).rejects.toThrow(/duplicates/i);
  });
});
