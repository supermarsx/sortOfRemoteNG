/**
 * useIlo — React hook for all HP iLO backend operations.
 *
 * Wraps every `ilo_*` Tauri command with typed helpers,
 * loading/error state, and auto-refresh capabilities.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  IloConfigSafe,
  BmcSystemInfo,
  IloInfo,
  PowerAction,
  BmcPowerMetrics,
  BmcThermalData,
  ThermalSummary,
  BmcProcessor,
  BmcMemoryDimm,
  BmcStorageController,
  BmcVirtualDisk,
  BmcPhysicalDisk,
  BmcNetworkAdapter,
  BmcFirmwareItem,
  BmcVirtualMedia,
  IloConsoleInfo,
  BmcEventLogEntry,
  BmcUser,
  BiosAttribute,
  BootConfig,
  IloCertificate,
  BmcHealthRollup,
  IloLicense,
  IloSecurityStatus,
  IloFederationGroup,
  IloFederationPeer,
  IloDashboard,
  IloGeneration,
} from "../../types/ilo";

// ── Types ────────────────────────────────────────────────────────

export interface UseIloState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  config: IloConfigSafe | null;
}

export interface UseIloReturn extends UseIloState {
  // Connection
  connect: (params: {
    host: string;
    port?: number;
    username: string;
    password: string;
    insecure?: boolean;
    protocol?: string;
    timeoutSecs?: number;
    generation?: string;
  }) => Promise<string>;
  disconnect: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  refreshConfig: () => Promise<void>;

  // System
  getSystemInfo: () => Promise<BmcSystemInfo>;
  getIloInfo: () => Promise<IloInfo>;
  setAssetTag: (tag: string) => Promise<void>;
  setIndicatorLed: (state: string) => Promise<void>;

  // Power
  powerAction: (action: PowerAction) => Promise<void>;
  getPowerState: () => Promise<string>;
  getPowerMetrics: () => Promise<BmcPowerMetrics>;

  // Thermal
  getThermalData: () => Promise<BmcThermalData>;
  getThermalSummary: () => Promise<ThermalSummary>;

  // Hardware
  getProcessors: () => Promise<BmcProcessor[]>;
  getMemory: () => Promise<BmcMemoryDimm[]>;

  // Storage
  getStorageControllers: () => Promise<BmcStorageController[]>;
  getVirtualDisks: () => Promise<BmcVirtualDisk[]>;
  getPhysicalDisks: () => Promise<BmcPhysicalDisk[]>;

  // Network
  getNetworkAdapters: () => Promise<BmcNetworkAdapter[]>;
  getIloNetwork: () => Promise<unknown>;

  // Firmware
  getFirmwareInventory: () => Promise<BmcFirmwareItem[]>;

  // Virtual Media
  getVirtualMediaStatus: () => Promise<BmcVirtualMedia[]>;
  insertVirtualMedia: (url: string, mediaId?: string) => Promise<void>;
  ejectVirtualMedia: (mediaId?: string) => Promise<void>;
  setVmBootOnce: () => Promise<void>;

  // Virtual Console
  getConsoleInfo: () => Promise<IloConsoleInfo>;
  getHtml5LaunchUrl: () => Promise<string>;

  // Event Logs
  getIml: () => Promise<BmcEventLogEntry[]>;
  getIloEventLog: () => Promise<BmcEventLogEntry[]>;
  clearIml: () => Promise<void>;
  clearIloEventLog: () => Promise<void>;

  // Users
  getUsers: () => Promise<BmcUser[]>;
  createUser: (
    username: string,
    password: string,
    role: string,
  ) => Promise<void>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  setUserEnabled: (userId: string, enabled: boolean) => Promise<void>;

  // BIOS
  getBiosAttributes: () => Promise<BiosAttribute[]>;
  setBiosAttributes: (attrs: Record<string, unknown>) => Promise<void>;
  getBootConfig: () => Promise<BootConfig>;
  setBootOverride: (target: string) => Promise<void>;

  // Certificates
  getCertificate: () => Promise<IloCertificate>;
  generateCsr: (params: {
    commonName: string;
    country: string;
    stateName: string;
    city: string;
    organization: string;
    organizationalUnit?: string;
  }) => Promise<string>;
  importCertificate: (certPem: string) => Promise<void>;

  // Health
  getHealthRollup: () => Promise<BmcHealthRollup>;
  getDashboard: () => Promise<IloDashboard>;

  // License
  getLicense: () => Promise<IloLicense>;
  activateLicense: (key: string) => Promise<void>;
  deactivateLicense: () => Promise<void>;

  // Security
  getSecurityStatus: () => Promise<IloSecurityStatus>;
  setMinTlsVersion: (version: string) => Promise<void>;
  setIpmiOverLan: (enabled: boolean) => Promise<void>;

  // Federation
  getFederationGroups: () => Promise<IloFederationGroup[]>;
  getFederationPeers: () => Promise<IloFederationPeer[]>;
  addFederationGroup: (name: string, key: string) => Promise<void>;
  removeFederationGroup: (name: string) => Promise<void>;

  // iLO Reset
  resetIlo: () => Promise<void>;

  // Auto-refresh
  startAutoRefresh: (intervalMs?: number) => void;
  stopAutoRefresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useIlo(): UseIloReturn {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<IloConfigSafe | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Connection ──────────────────────────────────────────────────

  const connect = useCallback(
    (params: {
      host: string;
      port?: number;
      username: string;
      password: string;
      insecure?: boolean;
      protocol?: string;
      timeoutSecs?: number;
      generation?: string;
    }) =>
      wrap(async () => {
        const result = await invoke<string>("ilo_connect", {
          host: params.host,
          port: params.port ?? 443,
          username: params.username,
          password: params.password,
          insecure: params.insecure ?? true,
          protocol: params.protocol,
          timeoutSecs: params.timeoutSecs ?? 30,
          generation: params.generation,
        });
        setConnected(true);
        const cfg = await invoke<IloConfigSafe | null>("ilo_get_config");
        setConfig(cfg);
        return result;
      }),
    [wrap],
  );

  const disconnect = useCallback(
    () =>
      wrap(async () => {
        await invoke("ilo_disconnect");
        setConnected(false);
        setConfig(null);
      }),
    [wrap],
  );

  const checkSession = useCallback(
    () => wrap(() => invoke<boolean>("ilo_check_session")),
    [wrap],
  );

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await invoke<IloConfigSafe | null>("ilo_get_config");
      setConfig(cfg);
      const conn = await invoke<boolean>("ilo_is_connected");
      setConnected(conn);
    } catch {
      /* ignore */
    }
  }, []);

  // ── System ──────────────────────────────────────────────────────

  const getSystemInfo = useCallback(
    () => wrap(() => invoke<BmcSystemInfo>("ilo_get_system_info")),
    [wrap],
  );

  const getIloInfo = useCallback(
    () => wrap(() => invoke<IloInfo>("ilo_get_ilo_info")),
    [wrap],
  );

  const setAssetTag = useCallback(
    (tag: string) => wrap(() => invoke("ilo_set_asset_tag", { tag })),
    [wrap],
  );

  const setIndicatorLed = useCallback(
    (state: string) =>
      wrap(() => invoke("ilo_set_indicator_led", { ledState: state })),
    [wrap],
  );

  // ── Power ──────────────────────────────────────────────────────

  const powerAction = useCallback(
    (action: PowerAction) =>
      wrap(() => invoke("ilo_power_action", { action })),
    [wrap],
  );

  const getPowerState = useCallback(
    () => wrap(() => invoke<string>("ilo_get_power_state")),
    [wrap],
  );

  const getPowerMetrics = useCallback(
    () => wrap(() => invoke<BmcPowerMetrics>("ilo_get_power_metrics")),
    [wrap],
  );

  // ── Thermal ─────────────────────────────────────────────────────

  const getThermalData = useCallback(
    () => wrap(() => invoke<BmcThermalData>("ilo_get_thermal_data")),
    [wrap],
  );

  const getThermalSummary = useCallback(
    () => wrap(() => invoke<ThermalSummary>("ilo_get_thermal_summary")),
    [wrap],
  );

  // ── Hardware ────────────────────────────────────────────────────

  const getProcessors = useCallback(
    () => wrap(() => invoke<BmcProcessor[]>("ilo_get_processors")),
    [wrap],
  );

  const getMemory = useCallback(
    () => wrap(() => invoke<BmcMemoryDimm[]>("ilo_get_memory")),
    [wrap],
  );

  // ── Storage ─────────────────────────────────────────────────────

  const getStorageControllers = useCallback(
    () =>
      wrap(() =>
        invoke<BmcStorageController[]>("ilo_get_storage_controllers"),
      ),
    [wrap],
  );

  const getVirtualDisks = useCallback(
    () => wrap(() => invoke<BmcVirtualDisk[]>("ilo_get_virtual_disks")),
    [wrap],
  );

  const getPhysicalDisks = useCallback(
    () => wrap(() => invoke<BmcPhysicalDisk[]>("ilo_get_physical_disks")),
    [wrap],
  );

  // ── Network ─────────────────────────────────────────────────────

  const getNetworkAdapters = useCallback(
    () =>
      wrap(() => invoke<BmcNetworkAdapter[]>("ilo_get_network_adapters")),
    [wrap],
  );

  const getIloNetwork = useCallback(
    () => wrap(() => invoke<unknown>("ilo_get_ilo_network")),
    [wrap],
  );

  // ── Firmware ────────────────────────────────────────────────────

  const getFirmwareInventory = useCallback(
    () =>
      wrap(() => invoke<BmcFirmwareItem[]>("ilo_get_firmware_inventory")),
    [wrap],
  );

  // ── Virtual Media ───────────────────────────────────────────────

  const getVirtualMediaStatus = useCallback(
    () =>
      wrap(() => invoke<BmcVirtualMedia[]>("ilo_get_virtual_media_status")),
    [wrap],
  );

  const insertVirtualMedia = useCallback(
    (url: string, mediaId?: string) =>
      wrap(() => invoke("ilo_insert_virtual_media", { url, mediaId })),
    [wrap],
  );

  const ejectVirtualMedia = useCallback(
    (mediaId?: string) =>
      wrap(() => invoke("ilo_eject_virtual_media", { mediaId })),
    [wrap],
  );

  const setVmBootOnce = useCallback(
    () => wrap(() => invoke("ilo_set_vm_boot_once")),
    [wrap],
  );

  // ── Virtual Console ─────────────────────────────────────────────

  const getConsoleInfo = useCallback(
    () => wrap(() => invoke<IloConsoleInfo>("ilo_get_console_info")),
    [wrap],
  );

  const getHtml5LaunchUrl = useCallback(
    () => wrap(() => invoke<string>("ilo_get_html5_launch_url")),
    [wrap],
  );

  // ── Event Logs ──────────────────────────────────────────────────

  const getIml = useCallback(
    () => wrap(() => invoke<BmcEventLogEntry[]>("ilo_get_iml")),
    [wrap],
  );

  const getIloEventLog = useCallback(
    () => wrap(() => invoke<BmcEventLogEntry[]>("ilo_get_ilo_event_log")),
    [wrap],
  );

  const clearIml = useCallback(
    () => wrap(() => invoke("ilo_clear_iml")),
    [wrap],
  );

  const clearIloEventLog = useCallback(
    () => wrap(() => invoke("ilo_clear_ilo_event_log")),
    [wrap],
  );

  // ── Users ───────────────────────────────────────────────────────

  const getUsers = useCallback(
    () => wrap(() => invoke<BmcUser[]>("ilo_get_users")),
    [wrap],
  );

  const createUser = useCallback(
    (username: string, password: string, role: string) =>
      wrap(() =>
        invoke("ilo_create_user", { username, password, role }),
      ),
    [wrap],
  );

  const updatePassword = useCallback(
    (userId: string, newPassword: string) =>
      wrap(() => invoke("ilo_update_password", { userId, newPassword })),
    [wrap],
  );

  const deleteUser = useCallback(
    (userId: string) =>
      wrap(() => invoke("ilo_delete_user", { userId })),
    [wrap],
  );

  const setUserEnabled = useCallback(
    (userId: string, enabled: boolean) =>
      wrap(() => invoke("ilo_set_user_enabled", { userId, enabled })),
    [wrap],
  );

  // ── BIOS ────────────────────────────────────────────────────────

  const getBiosAttributes = useCallback(
    () => wrap(() => invoke<BiosAttribute[]>("ilo_get_bios_attributes")),
    [wrap],
  );

  const setBiosAttributes = useCallback(
    (attrs: Record<string, unknown>) =>
      wrap(() => invoke("ilo_set_bios_attributes", { attributes: attrs })),
    [wrap],
  );

  const getBootConfig = useCallback(
    () => wrap(() => invoke<BootConfig>("ilo_get_boot_config")),
    [wrap],
  );

  const setBootOverride = useCallback(
    (target: string) =>
      wrap(() => invoke("ilo_set_boot_override", { target })),
    [wrap],
  );

  // ── Certificates ────────────────────────────────────────────────

  const getCertificate = useCallback(
    () => wrap(() => invoke<IloCertificate>("ilo_get_certificate")),
    [wrap],
  );

  const generateCsr = useCallback(
    (params: {
      commonName: string;
      country: string;
      stateName: string;
      city: string;
      organization: string;
      organizationalUnit?: string;
    }) =>
      wrap(() =>
        invoke<string>("ilo_generate_csr", {
          commonName: params.commonName,
          country: params.country,
          stateName: params.stateName,
          city: params.city,
          organization: params.organization,
          organizationalUnit: params.organizationalUnit,
        }),
      ),
    [wrap],
  );

  const importCertificate = useCallback(
    (certPem: string) =>
      wrap(() => invoke("ilo_import_certificate", { certPem })),
    [wrap],
  );

  // ── Health ──────────────────────────────────────────────────────

  const getHealthRollup = useCallback(
    () => wrap(() => invoke<BmcHealthRollup>("ilo_get_health_rollup")),
    [wrap],
  );

  const getDashboard = useCallback(
    () => wrap(() => invoke<IloDashboard>("ilo_get_dashboard")),
    [wrap],
  );

  // ── License ─────────────────────────────────────────────────────

  const getLicense = useCallback(
    () => wrap(() => invoke<IloLicense>("ilo_get_license")),
    [wrap],
  );

  const activateLicense = useCallback(
    (key: string) =>
      wrap(() => invoke("ilo_activate_license", { key })),
    [wrap],
  );

  const deactivateLicense = useCallback(
    () => wrap(() => invoke("ilo_deactivate_license")),
    [wrap],
  );

  // ── Security ────────────────────────────────────────────────────

  const getSecurityStatus = useCallback(
    () =>
      wrap(() => invoke<IloSecurityStatus>("ilo_get_security_status")),
    [wrap],
  );

  const setMinTlsVersion = useCallback(
    (version: string) =>
      wrap(() => invoke("ilo_set_min_tls_version", { version })),
    [wrap],
  );

  const setIpmiOverLan = useCallback(
    (enabled: boolean) =>
      wrap(() => invoke("ilo_set_ipmi_over_lan", { enabled })),
    [wrap],
  );

  // ── Federation ──────────────────────────────────────────────────

  const getFederationGroups = useCallback(
    () =>
      wrap(() =>
        invoke<IloFederationGroup[]>("ilo_get_federation_groups"),
      ),
    [wrap],
  );

  const getFederationPeers = useCallback(
    () =>
      wrap(() =>
        invoke<IloFederationPeer[]>("ilo_get_federation_peers"),
      ),
    [wrap],
  );

  const addFederationGroup = useCallback(
    (name: string, key: string) =>
      wrap(() => invoke("ilo_add_federation_group", { name, key })),
    [wrap],
  );

  const removeFederationGroup = useCallback(
    (name: string) =>
      wrap(() => invoke("ilo_remove_federation_group", { name })),
    [wrap],
  );

  // ── iLO Reset ───────────────────────────────────────────────────

  const resetIlo = useCallback(
    () => wrap(() => invoke("ilo_reset")),
    [wrap],
  );

  // ── Auto-refresh ───────────────────────────────────────────────

  const startAutoRefresh = useCallback(
    (intervalMs = 30000) => {
      if (refreshRef.current) clearInterval(refreshRef.current);
      refreshRef.current = setInterval(async () => {
        try {
          await refreshConfig();
        } catch {
          /* ignore */
        }
      }, intervalMs);
    },
    [refreshConfig],
  );

  const stopAutoRefresh = useCallback(() => {
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  return {
    connected,
    loading,
    error,
    config,
    connect,
    disconnect,
    checkSession,
    refreshConfig,
    getSystemInfo,
    getIloInfo,
    setAssetTag,
    setIndicatorLed,
    powerAction,
    getPowerState,
    getPowerMetrics,
    getThermalData,
    getThermalSummary,
    getProcessors,
    getMemory,
    getStorageControllers,
    getVirtualDisks,
    getPhysicalDisks,
    getNetworkAdapters,
    getIloNetwork,
    getFirmwareInventory,
    getVirtualMediaStatus,
    insertVirtualMedia,
    ejectVirtualMedia,
    setVmBootOnce,
    getConsoleInfo,
    getHtml5LaunchUrl,
    getIml,
    getIloEventLog,
    clearIml,
    clearIloEventLog,
    getUsers,
    createUser,
    updatePassword,
    deleteUser,
    setUserEnabled,
    getBiosAttributes,
    setBiosAttributes,
    getBootConfig,
    setBootOverride,
    getCertificate,
    generateCsr,
    importCertificate,
    getHealthRollup,
    getDashboard,
    getLicense,
    activateLicense,
    deactivateLicense,
    getSecurityStatus,
    setMinTlsVersion,
    setIpmiOverLan,
    getFederationGroups,
    getFederationPeers,
    addFederationGroup,
    removeFederationGroup,
    resetIlo,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
