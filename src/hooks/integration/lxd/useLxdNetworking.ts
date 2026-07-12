// useLxdNetworking — Networking category slice for the LXD integration (t42 c3).
//
// Pairs 1:1 with the 25 networking commands in
// `src-tauri/crates/sorng-lxd/src/commands.rs` (Networks 9, ACLs 5, Forwards 4,
// Zones 3, Load balancers 3, Peers 1). All commands run against the single
// active connection held in the LxdService backend state, so there is no
// per-instance session id here — the connection lifecycle is the LEAD's
// (`useLxdConnection`). Argument keys are camelCase; Tauri maps them to the
// snake_case Rust params (e.g. `newName` → `new_name`, `listenAddress` →
// `listen_address`).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CreateNetworkAclRequest,
  CreateNetworkForwardRequest,
  CreateNetworkRequest,
  LxdNetwork,
  LxdNetworkAcl,
  LxdNetworkForward,
  LxdNetworkLease,
  LxdNetworkLoadBalancer,
  LxdNetworkPeer,
  LxdNetworkState,
  LxdNetworkZone,
} from "../../../types/lxd/networking";

// ─── Low-level invoke wrappers (all 25 networking commands) ─────────────────────

export const lxdNetworkingApi = {
  // Networks (9)
  listNetworks: () => invoke<LxdNetwork[]>("lxd_list_networks"),
  getNetwork: (name: string) =>
    invoke<LxdNetwork>("lxd_get_network", { name }),
  createNetwork: (req: CreateNetworkRequest) =>
    invoke<void>("lxd_create_network", { req }),
  updateNetwork: (
    name: string,
    config: Record<string, string>,
    description?: string | null,
  ) =>
    invoke<void>("lxd_update_network", {
      name,
      config,
      description: description ?? null,
    }),
  patchNetwork: (name: string, patch: unknown) =>
    invoke<void>("lxd_patch_network", { name, patch }),
  deleteNetwork: (name: string) =>
    invoke<void>("lxd_delete_network", { name }),
  renameNetwork: (name: string, newName: string) =>
    invoke<void>("lxd_rename_network", { name, newName }),
  getNetworkState: (name: string) =>
    invoke<LxdNetworkState>("lxd_get_network_state", { name }),
  listNetworkLeases: (name: string) =>
    invoke<LxdNetworkLease[]>("lxd_list_network_leases", { name }),

  // ACLs (5)
  listNetworkAcls: () => invoke<LxdNetworkAcl[]>("lxd_list_network_acls"),
  getNetworkAcl: (name: string) =>
    invoke<LxdNetworkAcl>("lxd_get_network_acl", { name }),
  createNetworkAcl: (req: CreateNetworkAclRequest) =>
    invoke<void>("lxd_create_network_acl", { req }),
  updateNetworkAcl: (name: string, body: unknown) =>
    invoke<void>("lxd_update_network_acl", { name, body }),
  deleteNetworkAcl: (name: string) =>
    invoke<void>("lxd_delete_network_acl", { name }),

  // Forwards (4)
  listNetworkForwards: (network: string) =>
    invoke<LxdNetworkForward[]>("lxd_list_network_forwards", { network }),
  getNetworkForward: (network: string, listenAddress: string) =>
    invoke<LxdNetworkForward>("lxd_get_network_forward", {
      network,
      listenAddress,
    }),
  createNetworkForward: (req: CreateNetworkForwardRequest) =>
    invoke<void>("lxd_create_network_forward", { req }),
  deleteNetworkForward: (network: string, listenAddress: string) =>
    invoke<void>("lxd_delete_network_forward", { network, listenAddress }),

  // Zones (3)
  listNetworkZones: () => invoke<LxdNetworkZone[]>("lxd_list_network_zones"),
  getNetworkZone: (name: string) =>
    invoke<LxdNetworkZone>("lxd_get_network_zone", { name }),
  deleteNetworkZone: (name: string) =>
    invoke<void>("lxd_delete_network_zone", { name }),

  // Load balancers (3)
  listNetworkLoadBalancers: (network: string) =>
    invoke<LxdNetworkLoadBalancer[]>("lxd_list_network_load_balancers", {
      network,
    }),
  getNetworkLoadBalancer: (network: string, listenAddress: string) =>
    invoke<LxdNetworkLoadBalancer>("lxd_get_network_load_balancer", {
      network,
      listenAddress,
    }),
  deleteNetworkLoadBalancer: (network: string, listenAddress: string) =>
    invoke<void>("lxd_delete_network_load_balancer", {
      network,
      listenAddress,
    }),

  // Peers (1)
  listNetworkPeers: (network: string) =>
    invoke<LxdNetworkPeer[]>("lxd_list_network_peers", { network }),
};

export type LxdNetworkingApi = typeof lxdNetworkingApi;

// ─── React hook ─────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful networking manager. Holds the three global collections (networks,
 * ACLs, zones) plus the resources scoped to a selected network (forwards, load
 * balancers, peers, leases, live state). Every command in `lxdNetworkingApi` is
 * reachable — the collection loaders below cover the list/get calls, and the
 * mutating actions refresh the affected collection so the UI stays in sync.
 */
export function useLxdNetworking(connected: boolean) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [networks, setNetworks] = useState<LxdNetwork[]>([]);
  const [acls, setAcls] = useState<LxdNetworkAcl[]>([]);
  const [zones, setZones] = useState<LxdNetworkZone[]>([]);

  // Selected-network-scoped resources.
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [forwards, setForwards] = useState<LxdNetworkForward[]>([]);
  const [loadBalancers, setLoadBalancers] = useState<LxdNetworkLoadBalancer[]>(
    [],
  );
  const [peers, setPeers] = useState<LxdNetworkPeer[]>([]);
  const [leases, setLeases] = useState<LxdNetworkLease[]>([]);
  const [networkState, setNetworkState] = useState<LxdNetworkState | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        if (mounted.current) setError(errMsg(e));
        return null;
      } finally {
        if (mounted.current) setIsLoading(false);
      }
    },
    [],
  );

  // ── Networks ──────────────────────────────────────────────────────────────
  const refreshNetworks = useCallback(async () => {
    const list = await run(() => lxdNetworkingApi.listNetworks());
    if (list && mounted.current) setNetworks(list);
    return list;
  }, [run]);

  const getNetwork = useCallback(
    (name: string) => run(() => lxdNetworkingApi.getNetwork(name)),
    [run],
  );

  const createNetwork = useCallback(
    async (req: CreateNetworkRequest) => {
      const ok = await run(() => lxdNetworkingApi.createNetwork(req));
      if (ok !== null) await refreshNetworks();
      return ok !== null;
    },
    [run, refreshNetworks],
  );

  const updateNetwork = useCallback(
    async (
      name: string,
      config: Record<string, string>,
      description?: string | null,
    ) => {
      const ok = await run(() =>
        lxdNetworkingApi.updateNetwork(name, config, description),
      );
      if (ok !== null) await refreshNetworks();
      return ok !== null;
    },
    [run, refreshNetworks],
  );

  const patchNetwork = useCallback(
    async (name: string, patch: unknown) => {
      const ok = await run(() => lxdNetworkingApi.patchNetwork(name, patch));
      if (ok !== null) await refreshNetworks();
      return ok !== null;
    },
    [run, refreshNetworks],
  );

  const deleteNetwork = useCallback(
    async (name: string) => {
      const ok = await run(() => lxdNetworkingApi.deleteNetwork(name));
      if (ok !== null) await refreshNetworks();
      return ok !== null;
    },
    [run, refreshNetworks],
  );

  const renameNetwork = useCallback(
    async (name: string, newName: string) => {
      const ok = await run(() =>
        lxdNetworkingApi.renameNetwork(name, newName),
      );
      if (ok !== null) await refreshNetworks();
      return ok !== null;
    },
    [run, refreshNetworks],
  );

  const loadNetworkState = useCallback(
    async (name: string) => {
      const state = await run(() => lxdNetworkingApi.getNetworkState(name));
      if (mounted.current) setNetworkState(state ?? null);
      return state;
    },
    [run],
  );

  const loadLeases = useCallback(
    async (name: string) => {
      const list = await run(() => lxdNetworkingApi.listNetworkLeases(name));
      if (mounted.current) setLeases(list ?? []);
      return list;
    },
    [run],
  );

  // ── Network-scoped resources (forwards / load balancers / peers) ───────────
  const selectNetwork = useCallback(
    async (name: string | null) => {
      setSelectedNetwork(name);
      setForwards([]);
      setLoadBalancers([]);
      setPeers([]);
      setLeases([]);
      setNetworkState(null);
      if (!name) return;
      const [fwd, lbs, prs] = await Promise.all([
        run(() => lxdNetworkingApi.listNetworkForwards(name)),
        run(() => lxdNetworkingApi.listNetworkLoadBalancers(name)),
        run(() => lxdNetworkingApi.listNetworkPeers(name)),
      ]);
      if (!mounted.current) return;
      if (fwd) setForwards(fwd);
      if (lbs) setLoadBalancers(lbs);
      if (prs) setPeers(prs);
    },
    [run],
  );

  const refreshForwards = useCallback(
    async (network: string) => {
      const list = await run(() =>
        lxdNetworkingApi.listNetworkForwards(network),
      );
      if (list && mounted.current) setForwards(list);
      return list;
    },
    [run],
  );

  const getForward = useCallback(
    (network: string, listenAddress: string) =>
      run(() => lxdNetworkingApi.getNetworkForward(network, listenAddress)),
    [run],
  );

  const createForward = useCallback(
    async (req: CreateNetworkForwardRequest) => {
      const ok = await run(() => lxdNetworkingApi.createNetworkForward(req));
      if (ok !== null) await refreshForwards(req.network);
      return ok !== null;
    },
    [run, refreshForwards],
  );

  const deleteForward = useCallback(
    async (network: string, listenAddress: string) => {
      const ok = await run(() =>
        lxdNetworkingApi.deleteNetworkForward(network, listenAddress),
      );
      if (ok !== null) await refreshForwards(network);
      return ok !== null;
    },
    [run, refreshForwards],
  );

  const refreshLoadBalancers = useCallback(
    async (network: string) => {
      const list = await run(() =>
        lxdNetworkingApi.listNetworkLoadBalancers(network),
      );
      if (list && mounted.current) setLoadBalancers(list);
      return list;
    },
    [run],
  );

  const getLoadBalancer = useCallback(
    (network: string, listenAddress: string) =>
      run(() =>
        lxdNetworkingApi.getNetworkLoadBalancer(network, listenAddress),
      ),
    [run],
  );

  const deleteLoadBalancer = useCallback(
    async (network: string, listenAddress: string) => {
      const ok = await run(() =>
        lxdNetworkingApi.deleteNetworkLoadBalancer(network, listenAddress),
      );
      if (ok !== null) await refreshLoadBalancers(network);
      return ok !== null;
    },
    [run, refreshLoadBalancers],
  );

  const refreshPeers = useCallback(
    async (network: string) => {
      const list = await run(() => lxdNetworkingApi.listNetworkPeers(network));
      if (list && mounted.current) setPeers(list);
      return list;
    },
    [run],
  );

  // ── ACLs ───────────────────────────────────────────────────────────────────
  const refreshAcls = useCallback(async () => {
    const list = await run(() => lxdNetworkingApi.listNetworkAcls());
    if (list && mounted.current) setAcls(list);
    return list;
  }, [run]);

  const getAcl = useCallback(
    (name: string) => run(() => lxdNetworkingApi.getNetworkAcl(name)),
    [run],
  );

  const createAcl = useCallback(
    async (req: CreateNetworkAclRequest) => {
      const ok = await run(() => lxdNetworkingApi.createNetworkAcl(req));
      if (ok !== null) await refreshAcls();
      return ok !== null;
    },
    [run, refreshAcls],
  );

  const updateAcl = useCallback(
    async (name: string, body: unknown) => {
      const ok = await run(() => lxdNetworkingApi.updateNetworkAcl(name, body));
      if (ok !== null) await refreshAcls();
      return ok !== null;
    },
    [run, refreshAcls],
  );

  const deleteAcl = useCallback(
    async (name: string) => {
      const ok = await run(() => lxdNetworkingApi.deleteNetworkAcl(name));
      if (ok !== null) await refreshAcls();
      return ok !== null;
    },
    [run, refreshAcls],
  );

  // ── Zones ──────────────────────────────────────────────────────────────────
  const refreshZones = useCallback(async () => {
    const list = await run(() => lxdNetworkingApi.listNetworkZones());
    if (list && mounted.current) setZones(list);
    return list;
  }, [run]);

  const getZone = useCallback(
    (name: string) => run(() => lxdNetworkingApi.getNetworkZone(name)),
    [run],
  );

  const deleteZone = useCallback(
    async (name: string) => {
      const ok = await run(() => lxdNetworkingApi.deleteNetworkZone(name));
      if (ok !== null) await refreshZones();
      return ok !== null;
    },
    [run, refreshZones],
  );

  // Load the global collections once a connection is live; clear on disconnect.
  useEffect(() => {
    if (!connected) {
      setNetworks([]);
      setAcls([]);
      setZones([]);
      setSelectedNetwork(null);
      setForwards([]);
      setLoadBalancers([]);
      setPeers([]);
      setLeases([]);
      setNetworkState(null);
      setError(null);
      return;
    }
    void refreshNetworks();
    void refreshAcls();
    void refreshZones();
  }, [connected, refreshNetworks, refreshAcls, refreshZones]);

  return {
    // state
    networks,
    acls,
    zones,
    selectedNetwork,
    forwards,
    loadBalancers,
    peers,
    leases,
    networkState,
    isLoading,
    error,
    // networks
    refreshNetworks,
    getNetwork,
    createNetwork,
    updateNetwork,
    patchNetwork,
    deleteNetwork,
    renameNetwork,
    loadNetworkState,
    loadLeases,
    // selection + scoped resources
    selectNetwork,
    refreshForwards,
    getForward,
    createForward,
    deleteForward,
    refreshLoadBalancers,
    getLoadBalancer,
    deleteLoadBalancer,
    refreshPeers,
    // acls
    refreshAcls,
    getAcl,
    createAcl,
    updateAcl,
    deleteAcl,
    // zones
    refreshZones,
    getZone,
    deleteZone,
  };
}

export type LxdNetworkingManager = ReturnType<typeof useLxdNetworking>;
