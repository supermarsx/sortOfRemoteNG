// useNetboxVirtualization — Virtualization + Circuits slice for the NetBox
// integration (t42 category exec c3, t42-netbox-c3).
//
// `netboxVirtualizationApi` pairs 1:1 with the 31 Virtualization/Circuits
// commands in `src-tauri/crates/sorng-netbox/src/commands.rs`
// (VMs + interfaces 9, Clusters 9, Circuits 13). Invoke argument names use the
// crate-wide camelCase convention (`vmId`, `ifaceId`, `clusterId`, `circuitId`,
// `providerId`, `typeId`) that Tauri maps to the snake_case Rust parameters.
//
// The hook owns the tab's read state (the three primary lists, the reference
// lists, and the currently-selected detail + its sub-resources) and exposes an
// action for every command so the tab can drive full-depth CRUD.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaginatedResponse } from "../../../types/netbox";
import type {
  Circuit,
  CircuitProvider,
  CircuitTermination,
  CircuitType,
  Cluster,
  ClusterGroup,
  ClusterType,
  VirtualMachine,
  VmInterface,
} from "../../../types/netbox/virtualization";

/** A NetBox filter list, e.g. `[["limit", "50"], ["status", "active"]]`. */
export type NetboxParams = Array<[string, string]>;
/** A create/update payload (a NetBox object body). */
export type NetboxData = Record<string, unknown>;

// ─── Low-level invoke wrappers (all 31 commands) ──────────────────────────────

export const netboxVirtualizationApi = {
  // Virtual machines (5) + VM interfaces (4)
  listVms: (id: string, params: NetboxParams = []) =>
    invoke<PaginatedResponse<VirtualMachine>>("netbox_list_vms", { id, params }),
  getVm: (id: string, vmId: number) =>
    invoke<VirtualMachine>("netbox_get_vm", { id, vmId }),
  createVm: (id: string, data: NetboxData) =>
    invoke<VirtualMachine>("netbox_create_vm", { id, data }),
  updateVm: (id: string, vmId: number, data: NetboxData) =>
    invoke<VirtualMachine>("netbox_update_vm", { id, vmId, data }),
  deleteVm: (id: string, vmId: number) =>
    invoke<void>("netbox_delete_vm", { id, vmId }),
  listVmInterfaces: (id: string, vmId: number) =>
    invoke<PaginatedResponse<VmInterface>>("netbox_list_vm_interfaces", {
      id,
      vmId,
    }),
  createVmInterface: (id: string, data: NetboxData) =>
    invoke<VmInterface>("netbox_create_vm_interface", { id, data }),
  updateVmInterface: (id: string, ifaceId: number, data: NetboxData) =>
    invoke<VmInterface>("netbox_update_vm_interface", { id, ifaceId, data }),
  deleteVmInterface: (id: string, ifaceId: number) =>
    invoke<void>("netbox_delete_vm_interface", { id, ifaceId }),

  // Clusters (5) + types (3) + groups (1)
  listClusters: (id: string) =>
    invoke<PaginatedResponse<Cluster>>("netbox_list_clusters", { id }),
  getCluster: (id: string, clusterId: number) =>
    invoke<Cluster>("netbox_get_cluster", { id, clusterId }),
  createCluster: (id: string, data: NetboxData) =>
    invoke<Cluster>("netbox_create_cluster", { id, data }),
  updateCluster: (id: string, clusterId: number, data: NetboxData) =>
    invoke<Cluster>("netbox_update_cluster", { id, clusterId, data }),
  deleteCluster: (id: string, clusterId: number) =>
    invoke<void>("netbox_delete_cluster", { id, clusterId }),
  listClusterTypes: (id: string) =>
    invoke<PaginatedResponse<ClusterType>>("netbox_list_cluster_types", { id }),
  getClusterType: (id: string, typeId: number) =>
    invoke<ClusterType>("netbox_get_cluster_type", { id, typeId }),
  createClusterType: (id: string, data: NetboxData) =>
    invoke<ClusterType>("netbox_create_cluster_type", { id, data }),
  listClusterGroups: (id: string) =>
    invoke<PaginatedResponse<ClusterGroup>>("netbox_list_cluster_groups", {
      id,
    }),

  // Circuits (5) + providers (5) + types (2) + terminations (1)
  listCircuits: (id: string, params: NetboxParams = []) =>
    invoke<PaginatedResponse<Circuit>>("netbox_list_circuits", { id, params }),
  getCircuit: (id: string, circuitId: number) =>
    invoke<Circuit>("netbox_get_circuit", { id, circuitId }),
  createCircuit: (id: string, data: NetboxData) =>
    invoke<Circuit>("netbox_create_circuit", { id, data }),
  updateCircuit: (id: string, circuitId: number, data: NetboxData) =>
    invoke<Circuit>("netbox_update_circuit", { id, circuitId, data }),
  deleteCircuit: (id: string, circuitId: number) =>
    invoke<void>("netbox_delete_circuit", { id, circuitId }),
  listCircuitProviders: (id: string) =>
    invoke<PaginatedResponse<CircuitProvider>>("netbox_list_circuit_providers", {
      id,
    }),
  getCircuitProvider: (id: string, providerId: number) =>
    invoke<CircuitProvider>("netbox_get_circuit_provider", { id, providerId }),
  createCircuitProvider: (id: string, data: NetboxData) =>
    invoke<CircuitProvider>("netbox_create_circuit_provider", { id, data }),
  updateCircuitProvider: (id: string, providerId: number, data: NetboxData) =>
    invoke<CircuitProvider>("netbox_update_circuit_provider", {
      id,
      providerId,
      data,
    }),
  deleteCircuitProvider: (id: string, providerId: number) =>
    invoke<void>("netbox_delete_circuit_provider", { id, providerId }),
  listCircuitTypes: (id: string) =>
    invoke<PaginatedResponse<CircuitType>>("netbox_list_circuit_types", { id }),
  getCircuitType: (id: string, typeId: number) =>
    invoke<CircuitType>("netbox_get_circuit_type", { id, typeId }),
  listCircuitTerminations: (id: string, circuitId: number) =>
    invoke<PaginatedResponse<CircuitTermination>>(
      "netbox_list_circuit_terminations",
      { id, circuitId },
    ),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Selected-VM detail bundle: the VM plus its interfaces. */
export interface VmDetail {
  vm: VirtualMachine;
  interfaces: VmInterface[];
}

/** Selected-circuit detail bundle: the circuit plus its terminations. */
export interface CircuitDetail {
  circuit: Circuit;
  terminations: CircuitTermination[];
}

export interface UseNetboxVirtualization {
  // Primary lists
  vms: VirtualMachine[];
  clusters: Cluster[];
  circuits: Circuit[];
  // Reference lists
  clusterTypes: ClusterType[];
  clusterGroups: ClusterGroup[];
  circuitProviders: CircuitProvider[];
  circuitTypes: CircuitType[];
  // Selected detail
  vmDetail: VmDetail | null;
  clusterDetail: Cluster | null;
  circuitDetail: CircuitDetail | null;
  // UI state
  loading: boolean;
  error: string | null;
  clearError: () => void;

  // Loaders
  loadVms: (params?: NetboxParams) => Promise<void>;
  loadClusters: () => Promise<void>;
  loadCircuits: (params?: NetboxParams) => Promise<void>;
  loadClusterTypes: () => Promise<void>;
  loadClusterGroups: () => Promise<void>;
  loadCircuitProviders: () => Promise<void>;
  loadCircuitTypes: () => Promise<void>;

  // Selection (get + sub-resources)
  selectVm: (vmId: number) => Promise<void>;
  clearVmDetail: () => void;
  selectCluster: (clusterId: number) => Promise<void>;
  clearClusterDetail: () => void;
  selectCircuit: (circuitId: number) => Promise<void>;
  clearCircuitDetail: () => void;
  loadClusterType: (typeId: number) => Promise<ClusterType | null>;
  loadCircuitProvider: (providerId: number) => Promise<CircuitProvider | null>;
  loadCircuitType: (typeId: number) => Promise<CircuitType | null>;

  // Mutations (each reloads the affected list on success)
  createVm: (data: NetboxData) => Promise<boolean>;
  updateVm: (vmId: number, data: NetboxData) => Promise<boolean>;
  deleteVm: (vmId: number) => Promise<boolean>;
  createVmInterface: (data: NetboxData, vmId: number) => Promise<boolean>;
  updateVmInterface: (
    ifaceId: number,
    data: NetboxData,
    vmId: number,
  ) => Promise<boolean>;
  deleteVmInterface: (ifaceId: number, vmId: number) => Promise<boolean>;
  createCluster: (data: NetboxData) => Promise<boolean>;
  updateCluster: (clusterId: number, data: NetboxData) => Promise<boolean>;
  deleteCluster: (clusterId: number) => Promise<boolean>;
  createClusterType: (data: NetboxData) => Promise<boolean>;
  createCircuit: (data: NetboxData) => Promise<boolean>;
  updateCircuit: (circuitId: number, data: NetboxData) => Promise<boolean>;
  deleteCircuit: (circuitId: number) => Promise<boolean>;
  createCircuitProvider: (data: NetboxData) => Promise<boolean>;
  updateCircuitProvider: (
    providerId: number,
    data: NetboxData,
  ) => Promise<boolean>;
  deleteCircuitProvider: (providerId: number) => Promise<boolean>;
}

function toMessage(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Drives the NetBox Virtualization + Circuits tab against a live `connectionId`.
 * Loaders populate the lists; `select*` fetch a single object plus its
 * sub-resources; the mutation actions wrap the create/update/delete commands and
 * refresh the affected list. Every one of the 31 domain commands is reachable
 * through this hook (directly, or via `netboxVirtualizationApi`).
 */
export function useNetboxVirtualization(
  connectionId: string,
): UseNetboxVirtualization {
  const [vms, setVms] = useState<VirtualMachine[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [clusterTypes, setClusterTypes] = useState<ClusterType[]>([]);
  const [clusterGroups, setClusterGroups] = useState<ClusterGroup[]>([]);
  const [circuitProviders, setCircuitProviders] = useState<CircuitProvider[]>(
    [],
  );
  const [circuitTypes, setCircuitTypes] = useState<CircuitType[]>([]);
  const [vmDetail, setVmDetail] = useState<VmDetail | null>(null);
  const [clusterDetail, setClusterDetail] = useState<Cluster | null>(null);
  const [circuitDetail, setCircuitDetail] = useState<CircuitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  /** Run an async op with shared loading/error handling; returns success. */
  const run = useCallback(async (op: () => Promise<void>): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await op();
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadVms = useCallback(
    async (params: NetboxParams = []) => {
      await run(async () => {
        const res = await netboxVirtualizationApi.listVms(connectionId, params);
        setVms(res.results);
      });
    },
    [connectionId, run],
  );

  const loadClusters = useCallback(async () => {
    await run(async () => {
      const res = await netboxVirtualizationApi.listClusters(connectionId);
      setClusters(res.results);
    });
  }, [connectionId, run]);

  const loadCircuits = useCallback(
    async (params: NetboxParams = []) => {
      await run(async () => {
        const res = await netboxVirtualizationApi.listCircuits(
          connectionId,
          params,
        );
        setCircuits(res.results);
      });
    },
    [connectionId, run],
  );

  const loadClusterTypes = useCallback(async () => {
    await run(async () => {
      const res = await netboxVirtualizationApi.listClusterTypes(connectionId);
      setClusterTypes(res.results);
    });
  }, [connectionId, run]);

  const loadClusterGroups = useCallback(async () => {
    await run(async () => {
      const res = await netboxVirtualizationApi.listClusterGroups(connectionId);
      setClusterGroups(res.results);
    });
  }, [connectionId, run]);

  const loadCircuitProviders = useCallback(async () => {
    await run(async () => {
      const res =
        await netboxVirtualizationApi.listCircuitProviders(connectionId);
      setCircuitProviders(res.results);
    });
  }, [connectionId, run]);

  const loadCircuitTypes = useCallback(async () => {
    await run(async () => {
      const res = await netboxVirtualizationApi.listCircuitTypes(connectionId);
      setCircuitTypes(res.results);
    });
  }, [connectionId, run]);

  // ── Selection (get + sub-resources) ──────────────────────────────────────

  const selectVm = useCallback(
    async (vmId: number) => {
      await run(async () => {
        const [vm, ifaces] = await Promise.all([
          netboxVirtualizationApi.getVm(connectionId, vmId),
          netboxVirtualizationApi.listVmInterfaces(connectionId, vmId),
        ]);
        setVmDetail({ vm, interfaces: ifaces.results });
      });
    },
    [connectionId, run],
  );
  const clearVmDetail = useCallback(() => setVmDetail(null), []);

  const selectCluster = useCallback(
    async (clusterId: number) => {
      await run(async () => {
        setClusterDetail(
          await netboxVirtualizationApi.getCluster(connectionId, clusterId),
        );
      });
    },
    [connectionId, run],
  );
  const clearClusterDetail = useCallback(() => setClusterDetail(null), []);

  const selectCircuit = useCallback(
    async (circuitId: number) => {
      await run(async () => {
        const [circuit, terms] = await Promise.all([
          netboxVirtualizationApi.getCircuit(connectionId, circuitId),
          netboxVirtualizationApi.listCircuitTerminations(
            connectionId,
            circuitId,
          ),
        ]);
        setCircuitDetail({ circuit, terminations: terms.results });
      });
    },
    [connectionId, run],
  );
  const clearCircuitDetail = useCallback(() => setCircuitDetail(null), []);

  const loadClusterType = useCallback(
    async (typeId: number): Promise<ClusterType | null> => {
      try {
        return await netboxVirtualizationApi.getClusterType(
          connectionId,
          typeId,
        );
      } catch (e) {
        setError(toMessage(e));
        return null;
      }
    },
    [connectionId],
  );

  const loadCircuitProvider = useCallback(
    async (providerId: number): Promise<CircuitProvider | null> => {
      try {
        return await netboxVirtualizationApi.getCircuitProvider(
          connectionId,
          providerId,
        );
      } catch (e) {
        setError(toMessage(e));
        return null;
      }
    },
    [connectionId],
  );

  const loadCircuitType = useCallback(
    async (typeId: number): Promise<CircuitType | null> => {
      try {
        return await netboxVirtualizationApi.getCircuitType(
          connectionId,
          typeId,
        );
      } catch (e) {
        setError(toMessage(e));
        return null;
      }
    },
    [connectionId],
  );

  // ── Mutations ────────────────────────────────────────────────────────────

  const createVm = useCallback(
    (data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.createVm(connectionId, data);
        const res = await netboxVirtualizationApi.listVms(connectionId);
        setVms(res.results);
      }),
    [connectionId, run],
  );

  const updateVm = useCallback(
    (vmId: number, data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.updateVm(connectionId, vmId, data);
        const res = await netboxVirtualizationApi.listVms(connectionId);
        setVms(res.results);
      }),
    [connectionId, run],
  );

  const deleteVm = useCallback(
    (vmId: number) =>
      run(async () => {
        await netboxVirtualizationApi.deleteVm(connectionId, vmId);
        setVmDetail(null);
        const res = await netboxVirtualizationApi.listVms(connectionId);
        setVms(res.results);
      }),
    [connectionId, run],
  );

  const refreshVmInterfaces = useCallback(
    async (vmId: number) => {
      const [vm, ifaces] = await Promise.all([
        netboxVirtualizationApi.getVm(connectionId, vmId),
        netboxVirtualizationApi.listVmInterfaces(connectionId, vmId),
      ]);
      setVmDetail({ vm, interfaces: ifaces.results });
    },
    [connectionId],
  );

  const createVmInterface = useCallback(
    (data: NetboxData, vmId: number) =>
      run(async () => {
        await netboxVirtualizationApi.createVmInterface(connectionId, data);
        await refreshVmInterfaces(vmId);
      }),
    [connectionId, run, refreshVmInterfaces],
  );

  const updateVmInterface = useCallback(
    (ifaceId: number, data: NetboxData, vmId: number) =>
      run(async () => {
        await netboxVirtualizationApi.updateVmInterface(
          connectionId,
          ifaceId,
          data,
        );
        await refreshVmInterfaces(vmId);
      }),
    [connectionId, run, refreshVmInterfaces],
  );

  const deleteVmInterface = useCallback(
    (ifaceId: number, vmId: number) =>
      run(async () => {
        await netboxVirtualizationApi.deleteVmInterface(connectionId, ifaceId);
        await refreshVmInterfaces(vmId);
      }),
    [connectionId, run, refreshVmInterfaces],
  );

  const createCluster = useCallback(
    (data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.createCluster(connectionId, data);
        const res = await netboxVirtualizationApi.listClusters(connectionId);
        setClusters(res.results);
      }),
    [connectionId, run],
  );

  const updateCluster = useCallback(
    (clusterId: number, data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.updateCluster(
          connectionId,
          clusterId,
          data,
        );
        const res = await netboxVirtualizationApi.listClusters(connectionId);
        setClusters(res.results);
      }),
    [connectionId, run],
  );

  const deleteCluster = useCallback(
    (clusterId: number) =>
      run(async () => {
        await netboxVirtualizationApi.deleteCluster(connectionId, clusterId);
        setClusterDetail(null);
        const res = await netboxVirtualizationApi.listClusters(connectionId);
        setClusters(res.results);
      }),
    [connectionId, run],
  );

  const createClusterType = useCallback(
    (data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.createClusterType(connectionId, data);
        const res =
          await netboxVirtualizationApi.listClusterTypes(connectionId);
        setClusterTypes(res.results);
      }),
    [connectionId, run],
  );

  const createCircuit = useCallback(
    (data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.createCircuit(connectionId, data);
        const res = await netboxVirtualizationApi.listCircuits(connectionId);
        setCircuits(res.results);
      }),
    [connectionId, run],
  );

  const updateCircuit = useCallback(
    (circuitId: number, data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.updateCircuit(
          connectionId,
          circuitId,
          data,
        );
        const res = await netboxVirtualizationApi.listCircuits(connectionId);
        setCircuits(res.results);
      }),
    [connectionId, run],
  );

  const deleteCircuit = useCallback(
    (circuitId: number) =>
      run(async () => {
        await netboxVirtualizationApi.deleteCircuit(connectionId, circuitId);
        setCircuitDetail(null);
        const res = await netboxVirtualizationApi.listCircuits(connectionId);
        setCircuits(res.results);
      }),
    [connectionId, run],
  );

  const createCircuitProvider = useCallback(
    (data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.createCircuitProvider(connectionId, data);
        const res =
          await netboxVirtualizationApi.listCircuitProviders(connectionId);
        setCircuitProviders(res.results);
      }),
    [connectionId, run],
  );

  const updateCircuitProvider = useCallback(
    (providerId: number, data: NetboxData) =>
      run(async () => {
        await netboxVirtualizationApi.updateCircuitProvider(
          connectionId,
          providerId,
          data,
        );
        const res =
          await netboxVirtualizationApi.listCircuitProviders(connectionId);
        setCircuitProviders(res.results);
      }),
    [connectionId, run],
  );

  const deleteCircuitProvider = useCallback(
    (providerId: number) =>
      run(async () => {
        await netboxVirtualizationApi.deleteCircuitProvider(
          connectionId,
          providerId,
        );
        const res =
          await netboxVirtualizationApi.listCircuitProviders(connectionId);
        setCircuitProviders(res.results);
      }),
    [connectionId, run],
  );

  return {
    vms,
    clusters,
    circuits,
    clusterTypes,
    clusterGroups,
    circuitProviders,
    circuitTypes,
    vmDetail,
    clusterDetail,
    circuitDetail,
    loading,
    error,
    clearError,
    loadVms,
    loadClusters,
    loadCircuits,
    loadClusterTypes,
    loadClusterGroups,
    loadCircuitProviders,
    loadCircuitTypes,
    selectVm,
    clearVmDetail,
    selectCluster,
    clearClusterDetail,
    selectCircuit,
    clearCircuitDetail,
    loadClusterType,
    loadCircuitProvider,
    loadCircuitType,
    createVm,
    updateVm,
    deleteVm,
    createVmInterface,
    updateVmInterface,
    deleteVmInterface,
    createCluster,
    updateCluster,
    deleteCluster,
    createClusterType,
    createCircuit,
    updateCircuit,
    deleteCircuit,
    createCircuitProvider,
    updateCircuitProvider,
    deleteCircuitProvider,
  };
}
