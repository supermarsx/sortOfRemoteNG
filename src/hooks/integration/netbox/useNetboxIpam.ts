// useNetboxIpam — IPAM category slice for the NetBox integration (t42 `c2`).
//
// `netboxIpamApi` pairs 1:1 with the 38 IPAM commands in
// `src-tauri/crates/sorng-netbox/src/commands.rs` (IP addresses, prefixes +
// available-ip/prefix helpers, VRFs, aggregates, RIRs, IPAM roles, services,
// VLANs + groups). Argument keys are the camelCase form of each Rust
// `#[tauri::command]` param — Tauri maps them to the snake_case params
// (`addrId` → `addr_id`, `vlanId` → `vlan_id`, …).
//
// Category tabs never open their own connection: the live `connectionId` comes
// from the shell via props and is threaded through as the `id` arg here.

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaginatedResponse } from "../../../types/netbox";
import type {
  Aggregate,
  IpAddress,
  IpamRole,
  Prefix,
  Rir,
  Service,
  Vlan,
  VlanGroup,
  Vrf,
} from "../../../types/netbox";

/** NetBox list query params, sent as `Vec<(String, String)>` on the Rust side
 *  (a JSON array of `[key, value]` pairs). */
export type NetboxListParams = Array<[string, string]>;

/** Request body for create/update/patch commands (`data: serde_json::Value`). */
export type NetboxBody = Record<string, unknown>;

// ─── Low-level invoke wrappers (all 38 IPAM commands) ─────────────────────────

export const netboxIpamApi = {
  // IP addresses (5)
  listIpAddresses: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<IpAddress>>("netbox_list_ip_addresses", {
      id,
      params,
    }),
  getIpAddress: (id: string, addrId: number) =>
    invoke<IpAddress>("netbox_get_ip_address", { id, addrId }),
  createIpAddress: (id: string, data: NetboxBody) =>
    invoke<IpAddress>("netbox_create_ip_address", { id, data }),
  updateIpAddress: (id: string, addrId: number, data: NetboxBody) =>
    invoke<IpAddress>("netbox_update_ip_address", { id, addrId, data }),
  deleteIpAddress: (id: string, addrId: number) =>
    invoke<void>("netbox_delete_ip_address", { id, addrId }),

  // Prefixes (8)
  listPrefixes: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<Prefix>>("netbox_list_prefixes", { id, params }),
  getPrefix: (id: string, prefixId: number) =>
    invoke<Prefix>("netbox_get_prefix", { id, prefixId }),
  createPrefix: (id: string, data: NetboxBody) =>
    invoke<Prefix>("netbox_create_prefix", { id, data }),
  updatePrefix: (id: string, prefixId: number, data: NetboxBody) =>
    invoke<Prefix>("netbox_update_prefix", { id, prefixId, data }),
  deletePrefix: (id: string, prefixId: number) =>
    invoke<void>("netbox_delete_prefix", { id, prefixId }),
  getAvailableIps: (id: string, prefixId: number) =>
    invoke<IpAddress[]>("netbox_get_available_ips", { id, prefixId }),
  createAvailableIp: (id: string, prefixId: number, data: NetboxBody) =>
    invoke<IpAddress>("netbox_create_available_ip", { id, prefixId, data }),
  getAvailablePrefixes: (id: string, prefixId: number) =>
    invoke<Prefix[]>("netbox_get_available_prefixes", { id, prefixId }),

  // VRFs (5)
  listVrfs: (id: string) =>
    invoke<PaginatedResponse<Vrf>>("netbox_list_vrfs", { id }),
  getVrf: (id: string, vrfId: number) =>
    invoke<Vrf>("netbox_get_vrf", { id, vrfId }),
  createVrf: (id: string, data: NetboxBody) =>
    invoke<Vrf>("netbox_create_vrf", { id, data }),
  updateVrf: (id: string, vrfId: number, data: NetboxBody) =>
    invoke<Vrf>("netbox_update_vrf", { id, vrfId, data }),
  deleteVrf: (id: string, vrfId: number) =>
    invoke<void>("netbox_delete_vrf", { id, vrfId }),

  // Aggregates / RIRs / roles / services (7)
  listAggregates: (id: string) =>
    invoke<PaginatedResponse<Aggregate>>("netbox_list_aggregates", { id }),
  getAggregate: (id: string, aggId: number) =>
    invoke<Aggregate>("netbox_get_aggregate", { id, aggId }),
  listRirs: (id: string) =>
    invoke<PaginatedResponse<Rir>>("netbox_list_rirs", { id }),
  getRir: (id: string, rirId: number) =>
    invoke<Rir>("netbox_get_rir", { id, rirId }),
  listIpamRoles: (id: string) =>
    invoke<PaginatedResponse<IpamRole>>("netbox_list_ipam_roles", { id }),
  getIpamRole: (id: string, roleId: number) =>
    invoke<IpamRole>("netbox_get_ipam_role", { id, roleId }),
  listServices: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<Service>>("netbox_list_services", { id, params }),

  // VLANs (13)
  listVlans: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<Vlan>>("netbox_list_vlans", { id, params }),
  getVlan: (id: string, vlanId: number) =>
    invoke<Vlan>("netbox_get_vlan", { id, vlanId }),
  createVlan: (id: string, data: NetboxBody) =>
    invoke<Vlan>("netbox_create_vlan", { id, data }),
  updateVlan: (id: string, vlanId: number, data: NetboxBody) =>
    invoke<Vlan>("netbox_update_vlan", { id, vlanId, data }),
  partialUpdateVlan: (id: string, vlanId: number, data: NetboxBody) =>
    invoke<Vlan>("netbox_partial_update_vlan", { id, vlanId, data }),
  deleteVlan: (id: string, vlanId: number) =>
    invoke<void>("netbox_delete_vlan", { id, vlanId }),
  listVlansBySite: (id: string, siteId: number) =>
    invoke<PaginatedResponse<Vlan>>("netbox_list_vlans_by_site", {
      id,
      siteId,
    }),
  listVlansByGroup: (id: string, groupId: number) =>
    invoke<PaginatedResponse<Vlan>>("netbox_list_vlans_by_group", {
      id,
      groupId,
    }),
  listVlanGroups: (id: string) =>
    invoke<PaginatedResponse<VlanGroup>>("netbox_list_vlan_groups", { id }),
  getVlanGroup: (id: string, groupId: number) =>
    invoke<VlanGroup>("netbox_get_vlan_group", { id, groupId }),
  createVlanGroup: (id: string, data: NetboxBody) =>
    invoke<VlanGroup>("netbox_create_vlan_group", { id, data }),
  updateVlanGroup: (id: string, groupId: number, data: NetboxBody) =>
    invoke<VlanGroup>("netbox_update_vlan_group", { id, groupId, data }),
  deleteVlanGroup: (id: string, groupId: number) =>
    invoke<void>("netbox_delete_vlan_group", { id, groupId }),
};

export type NetboxIpamApi = typeof netboxIpamApi;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseNetboxIpam {
  /** The raw invoke wrappers (all 38 IPAM commands). */
  api: NetboxIpamApi;
  /** Rows for the currently loaded list section. */
  items: unknown[];
  /** `count` from the last paginated list load, when available. */
  total: number | null;
  loading: boolean;
  /** True while a create/update/delete/helper action is in flight. */
  busy: boolean;
  error: string | null;
  /** Run a list loader and store its rows. Accepts either a
   *  `PaginatedResponse<T>` or a bare `T[]` (the available-ips/prefixes
   *  helpers return the latter). */
  loadList: (
    loader: () => Promise<PaginatedResponse<unknown> | unknown[]>,
  ) => Promise<void>;
  /** Run a mutation/detail action, surfacing loading + errors. Returns the
   *  result on success, or `null` on failure (error is set). */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  clearItems: () => void;
  clearError: () => void;
}

function toMessage(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * State machine for the IPAM tab: one active list (rows + count + loading) plus
 * a shared busy/error channel for detail fetches and mutations. It stays
 * resource-agnostic so the tab can point `loadList` at any of the nine IPAM
 * sections and `run` at any of the create/update/delete/helper commands.
 */
export function useNetboxIpam(): UseNetboxIpam {
  const [items, setItems] = useState<unknown[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier list load overwriting a newer one.
  const loadSeq = useRef(0);

  const loadList = useCallback(
    async (
      loader: () => Promise<PaginatedResponse<unknown> | unknown[]>,
    ): Promise<void> => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await loader();
        if (seq !== loadSeq.current) return;
        if (Array.isArray(res)) {
          setItems(res);
          setTotal(res.length);
        } else {
          setItems(res.results ?? []);
          setTotal(res.count ?? res.results?.length ?? null);
        }
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(toMessage(e));
        setItems([]);
        setTotal(null);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [],
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (e) {
        setError(toMessage(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const clearItems = useCallback(() => {
    setItems([]);
    setTotal(null);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return {
    api: netboxIpamApi,
    items,
    total,
    loading,
    busy,
    error,
    loadList,
    run,
    clearItems,
    clearError,
  };
}
