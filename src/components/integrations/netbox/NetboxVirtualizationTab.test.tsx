import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors the other netbox tests).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import NetboxVirtualizationTab from "./NetboxVirtualizationTab";
import { netboxVirtualizationApi } from "../../../hooks/integration/netbox/useNetboxVirtualization";

const CID = "conn-1";

beforeEach(() => {
  invokeMock.mockReset();
  // Every list_* returns a PaginatedResponse; the hook reads `.results`.
  invokeMock.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
});

describe("netboxVirtualizationApi", () => {
  it("binds all 31 Virtualization/Circuits commands by exact name", () => {
    const api = netboxVirtualizationApi;
    // VMs + interfaces (9)
    api.listVms(CID);
    api.getVm(CID, 1);
    api.createVm(CID, {});
    api.updateVm(CID, 1, {});
    api.deleteVm(CID, 1);
    api.listVmInterfaces(CID, 1);
    api.createVmInterface(CID, {});
    api.updateVmInterface(CID, 2, {});
    api.deleteVmInterface(CID, 2);
    // Clusters (9)
    api.listClusters(CID);
    api.getCluster(CID, 3);
    api.createCluster(CID, {});
    api.updateCluster(CID, 3, {});
    api.deleteCluster(CID, 3);
    api.listClusterTypes(CID);
    api.getClusterType(CID, 4);
    api.createClusterType(CID, {});
    api.listClusterGroups(CID);
    // Circuits (13)
    api.listCircuits(CID);
    api.getCircuit(CID, 5);
    api.createCircuit(CID, {});
    api.updateCircuit(CID, 5, {});
    api.deleteCircuit(CID, 5);
    api.listCircuitProviders(CID);
    api.getCircuitProvider(CID, 6);
    api.createCircuitProvider(CID, {});
    api.updateCircuitProvider(CID, 6, {});
    api.deleteCircuitProvider(CID, 6);
    api.listCircuitTypes(CID);
    api.getCircuitType(CID, 7);
    api.listCircuitTerminations(CID, 5);

    const cmds = invokeMock.mock.calls.map((c) => c[0]).sort();
    expect(cmds).toEqual(
      [
        "netbox_list_vms",
        "netbox_get_vm",
        "netbox_create_vm",
        "netbox_update_vm",
        "netbox_delete_vm",
        "netbox_list_vm_interfaces",
        "netbox_create_vm_interface",
        "netbox_update_vm_interface",
        "netbox_delete_vm_interface",
        "netbox_list_clusters",
        "netbox_get_cluster",
        "netbox_create_cluster",
        "netbox_update_cluster",
        "netbox_delete_cluster",
        "netbox_list_cluster_types",
        "netbox_get_cluster_type",
        "netbox_create_cluster_type",
        "netbox_list_cluster_groups",
        "netbox_list_circuits",
        "netbox_get_circuit",
        "netbox_create_circuit",
        "netbox_update_circuit",
        "netbox_delete_circuit",
        "netbox_list_circuit_providers",
        "netbox_get_circuit_provider",
        "netbox_create_circuit_provider",
        "netbox_update_circuit_provider",
        "netbox_delete_circuit_provider",
        "netbox_list_circuit_types",
        "netbox_get_circuit_type",
        "netbox_list_circuit_terminations",
      ].sort(),
    );
    expect(new Set(cmds).size).toBe(31);
  });

  it("passes camelCase args that Tauri maps to snake_case Rust params", () => {
    netboxVirtualizationApi.getVm(CID, 42);
    netboxVirtualizationApi.updateVmInterface(CID, 7, { name: "eth1" });
    netboxVirtualizationApi.listCircuitTerminations(CID, 9);
    netboxVirtualizationApi.updateCircuitProvider(CID, 3, { name: "acme" });

    expect(invokeMock).toHaveBeenCalledWith("netbox_get_vm", { id: CID, vmId: 42 });
    expect(invokeMock).toHaveBeenCalledWith("netbox_update_vm_interface", {
      id: CID,
      ifaceId: 7,
      data: { name: "eth1" },
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_circuit_terminations", {
      id: CID,
      circuitId: 9,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_update_circuit_provider", {
      id: CID,
      providerId: 3,
      data: { name: "acme" },
    });
  });
});

describe("NetboxVirtualizationTab", () => {
  it("lists virtual machines on mount", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "netbox_list_vms")
        return Promise.resolve({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 1, name: "web-01", status: { label: "Active" } }],
        });
      return Promise.resolve({ count: 0, next: null, previous: null, results: [] });
    });

    render(<NetboxVirtualizationTab connectionId={CID} summary={null} />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("netbox_list_vms", {
        id: CID,
        params: [],
      }),
    );
    expect(await screen.findByText("web-01")).toBeInTheDocument();
  });

  it("loads clusters and their reference lists when switching sections", async () => {
    render(<NetboxVirtualizationTab connectionId={CID} summary={null} />);
    fireEvent.click(screen.getByText("Clusters"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("netbox_list_clusters", { id: CID }),
    );
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_cluster_types", { id: CID });
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_cluster_groups", { id: CID });
  });

  it("loads circuits and their reference lists when switching sections", async () => {
    render(<NetboxVirtualizationTab connectionId={CID} summary={null} />);
    fireEvent.click(screen.getByText("Circuits"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("netbox_list_circuits", {
        id: CID,
        params: [],
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_circuit_providers", {
      id: CID,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_list_circuit_types", { id: CID });
  });
});
