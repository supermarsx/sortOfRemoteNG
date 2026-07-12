import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors NetboxPanel.test).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, dflt?: string) => dflt ?? _key,
  }),
}));

import NetboxIpamTab from "./NetboxIpamTab";
import { netboxIpamApi } from "../../../hooks/integration/netbox/useNetboxIpam";

const CID = "conn-1";

beforeEach(() => {
  invokeMock.mockReset();
  // Lists resolve to a paginated envelope; helpers to arrays; the rest to {}.
  invokeMock.mockResolvedValue({ count: 0, results: [] });
});

describe("netboxIpamApi", () => {
  it("wraps all 38 IPAM commands with the exact command names", async () => {
    // IP addresses (5)
    netboxIpamApi.listIpAddresses(CID, [["q", "10."]]);
    netboxIpamApi.getIpAddress(CID, 1);
    netboxIpamApi.createIpAddress(CID, { address: "10.0.0.1/24" });
    netboxIpamApi.updateIpAddress(CID, 1, { dns_name: "a" });
    netboxIpamApi.deleteIpAddress(CID, 1);
    // Prefixes (8)
    netboxIpamApi.listPrefixes(CID, []);
    netboxIpamApi.getPrefix(CID, 2);
    netboxIpamApi.createPrefix(CID, { prefix: "10.0.0.0/24" });
    netboxIpamApi.updatePrefix(CID, 2, { status: "active" });
    netboxIpamApi.deletePrefix(CID, 2);
    netboxIpamApi.getAvailableIps(CID, 2);
    netboxIpamApi.createAvailableIp(CID, 2, {});
    netboxIpamApi.getAvailablePrefixes(CID, 2);
    // VRFs (5)
    netboxIpamApi.listVrfs(CID);
    netboxIpamApi.getVrf(CID, 3);
    netboxIpamApi.createVrf(CID, { name: "v" });
    netboxIpamApi.updateVrf(CID, 3, { rd: "65000:1" });
    netboxIpamApi.deleteVrf(CID, 3);
    // Aggregates / RIRs / roles / services (7)
    netboxIpamApi.listAggregates(CID);
    netboxIpamApi.getAggregate(CID, 4);
    netboxIpamApi.listRirs(CID);
    netboxIpamApi.getRir(CID, 5);
    netboxIpamApi.listIpamRoles(CID);
    netboxIpamApi.getIpamRole(CID, 6);
    netboxIpamApi.listServices(CID, [["device_id", "7"]]);
    // VLANs (13)
    netboxIpamApi.listVlans(CID, []);
    netboxIpamApi.getVlan(CID, 8);
    netboxIpamApi.createVlan(CID, { vid: 10, name: "v10" });
    netboxIpamApi.updateVlan(CID, 8, { name: "v10b" });
    netboxIpamApi.partialUpdateVlan(CID, 8, { name: "v10c" });
    netboxIpamApi.deleteVlan(CID, 8);
    netboxIpamApi.listVlansBySite(CID, 9);
    netboxIpamApi.listVlansByGroup(CID, 10);
    netboxIpamApi.listVlanGroups(CID);
    netboxIpamApi.getVlanGroup(CID, 11);
    netboxIpamApi.createVlanGroup(CID, { name: "g", slug: "g" });
    netboxIpamApi.updateVlanGroup(CID, 11, { name: "g2" });
    netboxIpamApi.deleteVlanGroup(CID, 11);

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "netbox_list_ip_addresses",
      "netbox_get_ip_address",
      "netbox_create_ip_address",
      "netbox_update_ip_address",
      "netbox_delete_ip_address",
      "netbox_list_prefixes",
      "netbox_get_prefix",
      "netbox_create_prefix",
      "netbox_update_prefix",
      "netbox_delete_prefix",
      "netbox_get_available_ips",
      "netbox_create_available_ip",
      "netbox_get_available_prefixes",
      "netbox_list_vrfs",
      "netbox_get_vrf",
      "netbox_create_vrf",
      "netbox_update_vrf",
      "netbox_delete_vrf",
      "netbox_list_aggregates",
      "netbox_get_aggregate",
      "netbox_list_rirs",
      "netbox_get_rir",
      "netbox_list_ipam_roles",
      "netbox_get_ipam_role",
      "netbox_list_services",
      "netbox_list_vlans",
      "netbox_get_vlan",
      "netbox_create_vlan",
      "netbox_update_vlan",
      "netbox_partial_update_vlan",
      "netbox_delete_vlan",
      "netbox_list_vlans_by_site",
      "netbox_list_vlans_by_group",
      "netbox_list_vlan_groups",
      "netbox_get_vlan_group",
      "netbox_create_vlan_group",
      "netbox_update_vlan_group",
      "netbox_delete_vlan_group",
    ]);
    expect(cmds).toHaveLength(38);

    // camelCase arg conversion is exercised end-to-end for the id-bearing calls.
    expect(invokeMock).toHaveBeenCalledWith("netbox_get_ip_address", {
      id: CID,
      addrId: 1,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_create_available_ip", {
      id: CID,
      prefixId: 2,
      data: {},
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_partial_update_vlan", {
      id: CID,
      vlanId: 8,
      data: { name: "v10c" },
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_vlans_by_site", {
      id: CID,
      siteId: 9,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_vlans_by_group", {
      id: CID,
      groupId: 10,
    });
  });
});

describe("NetboxIpamTab", () => {
  it("mounts and loads the default (IP addresses) section for the connection", async () => {
    render(<NetboxIpamTab connectionId={CID} summary={null} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("netbox_list_ip_addresses", {
        id: CID,
        params: [["limit", "100"]],
      }),
    );
    // Section pills render from the inline English defaults.
    expect(screen.getByText("Prefixes")).toBeInTheDocument();
    expect(screen.getByText("VLAN Groups")).toBeInTheDocument();
  });
});
