// NetBox DCIM invoke slice + hook (t42-netbox-c1).
//
// `netboxDcimApi` is a thin 1:1 wrapper over the 46 DCIM `netbox_*` commands
// (Sites 8, Racks 8, Devices 17, Interfaces 7, Cables 6) in
// `src-tauri/crates/sorng-netbox/src/commands.rs`. Every command's first arg is
// the live connection `id`. Tauri camelCases command params, so the Rust
// signatures map as: `site_id -> siteId`, `rack_id -> rackId`,
// `device_id -> deviceId`, `type_id -> typeId`, `mfg_id -> mfgId`,
// `platform_id -> platformId`, `role_id -> roleId`, `iface_id -> ifaceId`,
// `cable_id -> cableId`, plus `region`, `group`, `params`, `data`.
//
// Return/payload STRUCT fields are the camelCased view described in
// `../../../types/netbox/dcim`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { PaginatedResponse } from "../../../types/netbox";
import type {
  Cable,
  CableTrace,
  Device,
  DeviceRole,
  DeviceType,
  Interface,
  InterfaceConnection,
  Manufacturer,
  NbJson,
  NbParams,
  NbPayload,
  Platform,
  Rack,
  RackReservation,
  RackUnit,
  Site,
} from "../../../types/netbox/dcim";

export const netboxDcimApi = {
  // ── Sites (8) ──────────────────────────────────────────────────
  listSites: (id: string, params: NbParams = []) =>
    invoke<PaginatedResponse<Site>>("netbox_list_sites", { id, params }),
  getSite: (id: string, siteId: number) =>
    invoke<Site>("netbox_get_site", { id, siteId }),
  createSite: (id: string, data: NbPayload) =>
    invoke<Site>("netbox_create_site", { id, data }),
  updateSite: (id: string, siteId: number, data: NbPayload) =>
    invoke<Site>("netbox_update_site", { id, siteId, data }),
  partialUpdateSite: (id: string, siteId: number, data: NbPayload) =>
    invoke<Site>("netbox_partial_update_site", { id, siteId, data }),
  deleteSite: (id: string, siteId: number) =>
    invoke<void>("netbox_delete_site", { id, siteId }),
  listSitesByRegion: (id: string, region: string) =>
    invoke<PaginatedResponse<Site>>("netbox_list_sites_by_region", {
      id,
      region,
    }),
  listSitesByGroup: (id: string, group: string) =>
    invoke<PaginatedResponse<Site>>("netbox_list_sites_by_group", { id, group }),

  // ── Racks (8) ──────────────────────────────────────────────────
  listRacks: (id: string, siteId?: number | null) =>
    invoke<PaginatedResponse<Rack>>("netbox_list_racks", {
      id,
      siteId: siteId ?? null,
    }),
  getRack: (id: string, rackId: number) =>
    invoke<Rack>("netbox_get_rack", { id, rackId }),
  createRack: (id: string, data: NbPayload) =>
    invoke<Rack>("netbox_create_rack", { id, data }),
  updateRack: (id: string, rackId: number, data: NbPayload) =>
    invoke<Rack>("netbox_update_rack", { id, rackId, data }),
  partialUpdateRack: (id: string, rackId: number, data: NbPayload) =>
    invoke<Rack>("netbox_partial_update_rack", { id, rackId, data }),
  deleteRack: (id: string, rackId: number) =>
    invoke<void>("netbox_delete_rack", { id, rackId }),
  getRackElevation: (id: string, rackId: number) =>
    invoke<RackUnit[]>("netbox_get_rack_elevation", { id, rackId }),
  listRackReservations: (id: string, rackId: number) =>
    invoke<PaginatedResponse<RackReservation>>("netbox_list_rack_reservations", {
      id,
      rackId,
    }),

  // ── Devices (17) ───────────────────────────────────────────────
  listDevices: (id: string, params: NbParams = []) =>
    invoke<PaginatedResponse<Device>>("netbox_list_devices", { id, params }),
  getDevice: (id: string, deviceId: number) =>
    invoke<Device>("netbox_get_device", { id, deviceId }),
  createDevice: (id: string, data: NbPayload) =>
    invoke<Device>("netbox_create_device", { id, data }),
  updateDevice: (id: string, deviceId: number, data: NbPayload) =>
    invoke<Device>("netbox_update_device", { id, deviceId, data }),
  partialUpdateDevice: (id: string, deviceId: number, data: NbPayload) =>
    invoke<Device>("netbox_partial_update_device", { id, deviceId, data }),
  deleteDevice: (id: string, deviceId: number) =>
    invoke<void>("netbox_delete_device", { id, deviceId }),
  listDevicesBySite: (id: string, siteId: number) =>
    invoke<PaginatedResponse<Device>>("netbox_list_devices_by_site", {
      id,
      siteId,
    }),
  listDevicesByRack: (id: string, rackId: number) =>
    invoke<PaginatedResponse<Device>>("netbox_list_devices_by_rack", {
      id,
      rackId,
    }),
  listDeviceTypes: (id: string) =>
    invoke<PaginatedResponse<DeviceType>>("netbox_list_device_types", { id }),
  getDeviceType: (id: string, typeId: number) =>
    invoke<DeviceType>("netbox_get_device_type", { id, typeId }),
  listManufacturers: (id: string) =>
    invoke<PaginatedResponse<Manufacturer>>("netbox_list_manufacturers", { id }),
  getManufacturer: (id: string, mfgId: number) =>
    invoke<Manufacturer>("netbox_get_manufacturer", { id, mfgId }),
  listPlatforms: (id: string) =>
    invoke<PaginatedResponse<Platform>>("netbox_list_platforms", { id }),
  getPlatform: (id: string, platformId: number) =>
    invoke<Platform>("netbox_get_platform", { id, platformId }),
  listDeviceRoles: (id: string) =>
    invoke<PaginatedResponse<DeviceRole>>("netbox_list_device_roles", { id }),
  getDeviceRole: (id: string, roleId: number) =>
    invoke<DeviceRole>("netbox_get_device_role", { id, roleId }),
  renderDeviceConfig: (id: string, deviceId: number) =>
    invoke<NbJson>("netbox_render_device_config", { id, deviceId }),

  // ── Interfaces (7) ─────────────────────────────────────────────
  listInterfaces: (id: string, deviceId?: number | null) =>
    invoke<PaginatedResponse<Interface>>("netbox_list_interfaces", {
      id,
      deviceId: deviceId ?? null,
    }),
  getInterface: (id: string, ifaceId: number) =>
    invoke<Interface>("netbox_get_interface", { id, ifaceId }),
  createInterface: (id: string, data: NbPayload) =>
    invoke<Interface>("netbox_create_interface", { id, data }),
  updateInterface: (id: string, ifaceId: number, data: NbPayload) =>
    invoke<Interface>("netbox_update_interface", { id, ifaceId, data }),
  partialUpdateInterface: (id: string, ifaceId: number, data: NbPayload) =>
    invoke<Interface>("netbox_partial_update_interface", { id, ifaceId, data }),
  deleteInterface: (id: string, ifaceId: number) =>
    invoke<void>("netbox_delete_interface", { id, ifaceId }),
  listInterfaceConnections: (id: string) =>
    invoke<PaginatedResponse<InterfaceConnection>>(
      "netbox_list_interface_connections",
      { id },
    ),

  // ── Cables (6) ─────────────────────────────────────────────────
  listCables: (id: string, params: NbParams = []) =>
    invoke<PaginatedResponse<Cable>>("netbox_list_cables", { id, params }),
  getCable: (id: string, cableId: number) =>
    invoke<Cable>("netbox_get_cable", { id, cableId }),
  createCable: (id: string, data: NbPayload) =>
    invoke<Cable>("netbox_create_cable", { id, data }),
  updateCable: (id: string, cableId: number, data: NbPayload) =>
    invoke<Cable>("netbox_update_cable", { id, cableId, data }),
  deleteCable: (id: string, cableId: number) =>
    invoke<void>("netbox_delete_cable", { id, cableId }),
  traceCable: (id: string, cableId: number) =>
    invoke<CableTrace[]>("netbox_trace_cable", { id, cableId }),
};

export type NetboxDcimApi = typeof netboxDcimApi;

/**
 * Convenience hook for the DCIM tab. Exposes the invoke slice plus shared
 * `isLoading`/`error` state and a `run` helper that binds the live
 * `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function useNetboxDcim(connectionId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(connectionId);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  return {
    api: netboxDcimApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseNetboxDcim = ReturnType<typeof useNetboxDcim>;
