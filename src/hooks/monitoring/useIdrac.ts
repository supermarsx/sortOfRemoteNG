/**
 * useIdrac — React hook for all Dell iDRAC backend operations.
 *
 * Wraps every `idrac_*` Tauri command with typed helpers,
 * loading/error state, and auto-refresh capabilities.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  IdracConfigSafe,
  SystemInfo,
  IdracInfo,
  PowerAction,
  PowerMetrics,
  PowerSupply,
  ThermalData,
  ThermalSummary,
  Processor,
  MemoryDimm,
  PcieDevice,
  StorageController,
  VirtualDisk,
  PhysicalDisk,
  StorageEnclosure,
  CreateVirtualDiskParams,
  NetworkAdapter,
  NetworkPort,
  IdracNetworkConfig,
  FirmwareInventory,
  FirmwareUpdateParams,
  LifecycleJob,
  ScpExportParams,
  ScpImportParams,
  VirtualMediaStatus,
  VirtualMediaMountParams,
  ConsoleInfo,
  SelEntry,
  LcLogEntry,
  IdracUser,
  IdracUserParams,
  LdapConfig,
  ActiveDirectoryConfig,
  BiosAttribute,
  BootSource,
  BootConfig,
  IdracCertificate,
  CsrParams,
  ComponentHealth,
  ServerHealthRollup,
  PowerTelemetry,
  ThermalTelemetry,
  TelemetryReport,
  RacadmResult,
  IdracDashboard,
} from "../../types/idrac";

// ── Types ────────────────────────────────────────────────────────

export interface UseIdracState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  config: IdracConfigSafe | null;
}

export interface UseIdracReturn extends UseIdracState {
  // Connection
  connect: (params: {
    host: string;
    port?: number;
    username: string;
    password: string;
    insecure?: boolean;
    forceProtocol?: string;
    timeoutSecs?: number;
  }) => Promise<string>;
  disconnect: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  refreshConfig: () => Promise<void>;

  // System
  getSystemInfo: () => Promise<SystemInfo>;
  getIdracInfo: () => Promise<IdracInfo>;
  setAssetTag: (tag: string) => Promise<void>;
  setIndicatorLed: (state: string) => Promise<void>;

  // Power
  powerAction: (action: PowerAction) => Promise<string | null>;
  getPowerState: () => Promise<string>;
  getPowerMetrics: () => Promise<PowerMetrics>;
  listPowerSupplies: () => Promise<PowerSupply[]>;
  setPowerCap: (watts: number, enabled: boolean) => Promise<void>;

  // Thermal
  getThermalData: () => Promise<ThermalData>;
  getThermalSummary: () => Promise<ThermalSummary>;
  setFanOffset: (offset: number) => Promise<void>;

  // Hardware
  listProcessors: () => Promise<Processor[]>;
  listMemory: () => Promise<MemoryDimm[]>;
  listPcieDevices: () => Promise<PcieDevice[]>;
  getTotalMemory: () => Promise<number>;
  getProcessorCount: () => Promise<number>;

  // Storage
  listStorageControllers: () => Promise<StorageController[]>;
  listVirtualDisks: (controllerId?: string) => Promise<VirtualDisk[]>;
  listPhysicalDisks: (controllerId?: string) => Promise<PhysicalDisk[]>;
  listEnclosures: () => Promise<StorageEnclosure[]>;
  createVirtualDisk: (params: CreateVirtualDiskParams) => Promise<string | null>;
  deleteVirtualDisk: (id: string) => Promise<void>;
  assignHotspare: (diskId: string, controllerId: string, vdId?: string) => Promise<void>;
  initializeVirtualDisk: (id: string, initType?: string) => Promise<string | null>;

  // Network
  listNetworkAdapters: () => Promise<NetworkAdapter[]>;
  listNetworkPorts: (adapterId: string) => Promise<NetworkPort[]>;
  getNetworkConfig: () => Promise<IdracNetworkConfig>;
  updateNetworkConfig: (config: Partial<IdracNetworkConfig>) => Promise<void>;

  // Firmware
  listFirmware: () => Promise<FirmwareInventory[]>;
  updateFirmware: (params: FirmwareUpdateParams) => Promise<string | null>;
  getComponentVersion: (componentId: string) => Promise<string | null>;

  // Lifecycle
  listJobs: () => Promise<LifecycleJob[]>;
  getJob: (jobId: string) => Promise<LifecycleJob>;
  deleteJob: (jobId: string) => Promise<void>;
  purgeJobQueue: () => Promise<void>;
  exportScp: (params: ScpExportParams) => Promise<string>;
  importScp: (params: ScpImportParams) => Promise<string>;
  getLcStatus: () => Promise<string>;
  waitForJob: (jobId: string, timeoutSecs?: number) => Promise<LifecycleJob>;

  // Virtual Media
  listVirtualMedia: () => Promise<VirtualMediaStatus[]>;
  mountVirtualMedia: (params: VirtualMediaMountParams) => Promise<void>;
  unmountVirtualMedia: (id: string) => Promise<void>;
  bootFromVirtualCd: () => Promise<void>;

  // Virtual Console
  getConsoleInfo: () => Promise<ConsoleInfo>;
  setConsoleEnabled: (enabled: boolean) => Promise<void>;
  setConsoleType: (consoleType: string) => Promise<void>;
  setVncEnabled: (enabled: boolean) => Promise<void>;
  setVncPassword: (password: string) => Promise<void>;

  // Event Log
  getSelEntries: (limit?: number) => Promise<SelEntry[]>;
  getLcLogEntries: (limit?: number) => Promise<LcLogEntry[]>;
  clearSel: () => Promise<void>;
  clearLcLog: () => Promise<void>;

  // Users
  listUsers: () => Promise<IdracUser[]>;
  createOrUpdateUser: (slotId: string, params: IdracUserParams) => Promise<void>;
  deleteUser: (slotId: string) => Promise<void>;
  unlockUser: (slotId: string) => Promise<void>;
  changeUserPassword: (slotId: string, password: string) => Promise<void>;
  getLdapConfig: () => Promise<LdapConfig>;
  getAdConfig: () => Promise<ActiveDirectoryConfig>;

  // BIOS
  getBiosAttributes: () => Promise<BiosAttribute[]>;
  getBiosAttribute: (name: string) => Promise<BiosAttribute | null>;
  setBiosAttributes: (attrs: Record<string, unknown>) => Promise<string | null>;
  getBootOrder: () => Promise<BootConfig>;
  setBootOrder: (order: string[]) => Promise<void>;
  setBootOnce: (target: string) => Promise<void>;
  setBootMode: (mode: string) => Promise<void>;

  // Certificates
  listCertificates: () => Promise<IdracCertificate[]>;
  generateCsr: (params: CsrParams) => Promise<string>;
  importCertificate: (certType: string, certData: string) => Promise<void>;
  deleteCertificate: (certId: string) => Promise<void>;
  replaceSslCertificate: (certData: string, keyData: string) => Promise<void>;

  // Health
  getHealthRollup: () => Promise<ServerHealthRollup>;
  getComponentHealth: () => Promise<ComponentHealth[]>;
  isHealthy: () => Promise<boolean>;

  // Telemetry
  getPowerTelemetry: () => Promise<PowerTelemetry>;
  getThermalTelemetry: () => Promise<ThermalTelemetry>;
  listTelemetryReports: () => Promise<TelemetryReport[]>;
  getTelemetryReport: (metricId: string) => Promise<TelemetryReport>;

  // RACADM
  racadmExecute: (command: string) => Promise<RacadmResult>;
  resetIdrac: () => Promise<void>;
  getAttribute: (group: string, name: string) => Promise<string>;
  setAttribute: (group: string, name: string, value: string) => Promise<void>;

  // Dashboard
  getDashboard: () => Promise<IdracDashboard>;
}

// ── Hook implementation ──────────────────────────────────────────

export function useIdrac(): UseIdracReturn {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<IdracConfigSafe | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>, opts?: { silent?: boolean }): Promise<T> => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const result = await fn();
        return result;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
        if (mountedRef.current) setError(msg);
        throw e;
      } finally {
        if (mountedRef.current && !opts?.silent) setLoading(false);
      }
    },
    [],
  );

  // ── Connection ───────────────────────────────────

  const connect = useCallback(
    async (params: {
      host: string;
      port?: number;
      username: string;
      password: string;
      insecure?: boolean;
      forceProtocol?: string;
      timeoutSecs?: number;
    }): Promise<string> =>
      wrap(async () => {
        const msg = await invoke<string>("idrac_connect", {
          host: params.host,
          port: params.port ?? 443,
          username: params.username,
          password: params.password,
          insecure: params.insecure ?? true,
          forceProtocol: params.forceProtocol ?? null,
          timeoutSecs: params.timeoutSecs ?? 30,
        });
        if (mountedRef.current) {
          setConnected(true);
          const c = await invoke<IdracConfigSafe>("idrac_get_config");
          setConfig(c);
        }
        return msg;
      }),
    [wrap],
  );

  const disconnect = useCallback(
    async () =>
      wrap(async () => {
        await invoke("idrac_disconnect");
        if (mountedRef.current) {
          setConnected(false);
          setConfig(null);
        }
      }),
    [wrap],
  );

  const checkSession = useCallback(
    async () =>
      wrap(async () => {
        const ok = await invoke<boolean>("idrac_check_session");
        if (mountedRef.current) setConnected(ok);
        return ok;
      }, { silent: true }),
    [wrap],
  );

  const refreshConfig = useCallback(
    async () =>
      wrap(async () => {
        const c = await invoke<IdracConfigSafe>("idrac_get_config");
        if (mountedRef.current) setConfig(c);
      }, { silent: true }),
    [wrap],
  );

  // ── System ───────────────────────────────────────

  const getSystemInfo = useCallback(() => wrap(() => invoke<SystemInfo>("idrac_get_system_info")), [wrap]);
  const getIdracInfo = useCallback(() => wrap(() => invoke<IdracInfo>("idrac_get_idrac_info")), [wrap]);
  const setAssetTag = useCallback((tag: string) => wrap(() => invoke<void>("idrac_set_asset_tag", { tag })), [wrap]);
  const setIndicatorLed = useCallback((state: string) => wrap(() => invoke<void>("idrac_set_indicator_led", { state })), [wrap]);

  // ── Power ────────────────────────────────────────

  const powerAction = useCallback((action: PowerAction) => wrap(() => invoke<string | null>("idrac_power_action", { action })), [wrap]);
  const getPowerState = useCallback(() => wrap(() => invoke<string>("idrac_get_power_state")), [wrap]);
  const getPowerMetrics = useCallback(() => wrap(() => invoke<PowerMetrics>("idrac_get_power_metrics")), [wrap]);
  const listPowerSupplies = useCallback(() => wrap(() => invoke<PowerSupply[]>("idrac_list_power_supplies")), [wrap]);
  const setPowerCap = useCallback((watts: number, enabled: boolean) => wrap(() => invoke<void>("idrac_set_power_cap", { watts, enabled })), [wrap]);

  // ── Thermal ──────────────────────────────────────

  const getThermalData = useCallback(() => wrap(() => invoke<ThermalData>("idrac_get_thermal_data")), [wrap]);
  const getThermalSummary = useCallback(() => wrap(() => invoke<ThermalSummary>("idrac_get_thermal_summary")), [wrap]);
  const setFanOffset = useCallback((offset: number) => wrap(() => invoke<void>("idrac_set_fan_offset", { offset })), [wrap]);

  // ── Hardware ─────────────────────────────────────

  const listProcessors = useCallback(() => wrap(() => invoke<Processor[]>("idrac_list_processors")), [wrap]);
  const listMemory = useCallback(() => wrap(() => invoke<MemoryDimm[]>("idrac_list_memory")), [wrap]);
  const listPcieDevices = useCallback(() => wrap(() => invoke<PcieDevice[]>("idrac_list_pcie_devices")), [wrap]);
  const getTotalMemory = useCallback(() => wrap(() => invoke<number>("idrac_get_total_memory")), [wrap]);
  const getProcessorCount = useCallback(() => wrap(() => invoke<number>("idrac_get_processor_count")), [wrap]);

  // ── Storage ──────────────────────────────────────

  const listStorageControllers = useCallback(() => wrap(() => invoke<StorageController[]>("idrac_list_storage_controllers")), [wrap]);
  const listVirtualDisks = useCallback((controllerId?: string) => wrap(() => invoke<VirtualDisk[]>("idrac_list_virtual_disks", { controllerId: controllerId ?? null })), [wrap]);
  const listPhysicalDisks = useCallback((controllerId?: string) => wrap(() => invoke<PhysicalDisk[]>("idrac_list_physical_disks", { controllerId: controllerId ?? null })), [wrap]);
  const listEnclosures = useCallback(() => wrap(() => invoke<StorageEnclosure[]>("idrac_list_enclosures")), [wrap]);
  const createVirtualDisk = useCallback((params: CreateVirtualDiskParams) => wrap(() => invoke<string | null>("idrac_create_virtual_disk", { params })), [wrap]);
  const deleteVirtualDisk = useCallback((id: string) => wrap(() => invoke<void>("idrac_delete_virtual_disk", { id })), [wrap]);
  const assignHotspare = useCallback((diskId: string, controllerId: string, vdId?: string) => wrap(() => invoke<void>("idrac_assign_hotspare", { diskId, controllerId, virtualDiskId: vdId ?? null })), [wrap]);
  const initializeVirtualDisk = useCallback((id: string, initType?: string) => wrap(() => invoke<string | null>("idrac_initialize_virtual_disk", { id, initType: initType ?? null })), [wrap]);

  // ── Network ──────────────────────────────────────

  const listNetworkAdapters = useCallback(() => wrap(() => invoke<NetworkAdapter[]>("idrac_list_network_adapters")), [wrap]);
  const listNetworkPorts = useCallback((adapterId: string) => wrap(() => invoke<NetworkPort[]>("idrac_list_network_ports", { adapterId })), [wrap]);
  const getNetworkConfig = useCallback(() => wrap(() => invoke<IdracNetworkConfig>("idrac_get_network_config")), [wrap]);
  const updateNetworkConfig = useCallback((cfg: Partial<IdracNetworkConfig>) => wrap(() => invoke<void>("idrac_update_network_config", { config: cfg })), [wrap]);

  // ── Firmware ─────────────────────────────────────

  const listFirmware = useCallback(() => wrap(() => invoke<FirmwareInventory[]>("idrac_list_firmware")), [wrap]);
  const updateFirmware = useCallback((params: FirmwareUpdateParams) => wrap(() => invoke<string | null>("idrac_update_firmware", { params })), [wrap]);
  const getComponentVersion = useCallback((componentId: string) => wrap(() => invoke<string | null>("idrac_get_component_version", { componentId })), [wrap]);

  // ── Lifecycle ────────────────────────────────────

  const listJobs = useCallback(() => wrap(() => invoke<LifecycleJob[]>("idrac_list_jobs")), [wrap]);
  const getJob = useCallback((jobId: string) => wrap(() => invoke<LifecycleJob>("idrac_get_job", { jobId })), [wrap]);
  const deleteJob = useCallback((jobId: string) => wrap(() => invoke<void>("idrac_delete_job", { jobId })), [wrap]);
  const purgeJobQueue = useCallback(() => wrap(() => invoke<void>("idrac_purge_job_queue")), [wrap]);
  const exportScp = useCallback((params: ScpExportParams) => wrap(() => invoke<string>("idrac_export_scp", { params })), [wrap]);
  const importScp = useCallback((params: ScpImportParams) => wrap(() => invoke<string>("idrac_import_scp", { params })), [wrap]);
  const getLcStatus = useCallback(() => wrap(() => invoke<string>("idrac_get_lc_status")), [wrap]);
  const waitForJob = useCallback((jobId: string, timeoutSecs?: number) => wrap(() => invoke<LifecycleJob>("idrac_wait_for_job", { jobId, timeoutSecs: timeoutSecs ?? 600 })), [wrap]);

  // ── Virtual Media ────────────────────────────────

  const listVirtualMedia = useCallback(() => wrap(() => invoke<VirtualMediaStatus[]>("idrac_list_virtual_media")), [wrap]);
  const mountVirtualMedia = useCallback((params: VirtualMediaMountParams) => wrap(() => invoke<void>("idrac_mount_virtual_media", { params })), [wrap]);
  const unmountVirtualMedia = useCallback((id: string) => wrap(() => invoke<void>("idrac_unmount_virtual_media", { id })), [wrap]);
  const bootFromVirtualCd = useCallback(() => wrap(() => invoke<void>("idrac_boot_from_virtual_cd")), [wrap]);

  // ── Virtual Console ──────────────────────────────

  const getConsoleInfo = useCallback(() => wrap(() => invoke<ConsoleInfo>("idrac_get_console_info")), [wrap]);
  const setConsoleEnabled = useCallback((enabled: boolean) => wrap(() => invoke<void>("idrac_set_console_enabled", { enabled })), [wrap]);
  const setConsoleType = useCallback((consoleType: string) => wrap(() => invoke<void>("idrac_set_console_type", { consoleType })), [wrap]);
  const setVncEnabled = useCallback((enabled: boolean) => wrap(() => invoke<void>("idrac_set_vnc_enabled", { enabled })), [wrap]);
  const setVncPassword = useCallback((password: string) => wrap(() => invoke<void>("idrac_set_vnc_password", { password })), [wrap]);

  // ── Event Log ────────────────────────────────────

  const getSelEntries = useCallback((limit?: number) => wrap(() => invoke<SelEntry[]>("idrac_get_sel_entries", { limit: limit ?? 100 })), [wrap]);
  const getLcLogEntries = useCallback((limit?: number) => wrap(() => invoke<LcLogEntry[]>("idrac_get_lc_log_entries", { limit: limit ?? 100 })), [wrap]);
  const clearSel = useCallback(() => wrap(() => invoke<void>("idrac_clear_sel")), [wrap]);
  const clearLcLog = useCallback(() => wrap(() => invoke<void>("idrac_clear_lc_log")), [wrap]);

  // ── Users ────────────────────────────────────────

  const listUsers = useCallback(() => wrap(() => invoke<IdracUser[]>("idrac_list_users")), [wrap]);
  const createOrUpdateUser = useCallback((slotId: string, params: IdracUserParams) => wrap(() => invoke<void>("idrac_create_or_update_user", { slotId, params })), [wrap]);
  const deleteUser = useCallback((slotId: string) => wrap(() => invoke<void>("idrac_delete_user", { slotId })), [wrap]);
  const unlockUser = useCallback((slotId: string) => wrap(() => invoke<void>("idrac_unlock_user", { slotId })), [wrap]);
  const changeUserPassword = useCallback((slotId: string, password: string) => wrap(() => invoke<void>("idrac_change_user_password", { slotId, password })), [wrap]);
  const getLdapConfig = useCallback(() => wrap(() => invoke<LdapConfig>("idrac_get_ldap_config")), [wrap]);
  const getAdConfig = useCallback(() => wrap(() => invoke<ActiveDirectoryConfig>("idrac_get_ad_config")), [wrap]);

  // ── BIOS ─────────────────────────────────────────

  const getBiosAttributes = useCallback(() => wrap(() => invoke<BiosAttribute[]>("idrac_get_bios_attributes")), [wrap]);
  const getBiosAttribute = useCallback((name: string) => wrap(() => invoke<BiosAttribute | null>("idrac_get_bios_attribute", { name })), [wrap]);
  const setBiosAttributes = useCallback((attrs: Record<string, unknown>) => wrap(() => invoke<string | null>("idrac_set_bios_attributes", { attributes: attrs })), [wrap]);
  const getBootOrder = useCallback(() => wrap(() => invoke<BootConfig>("idrac_get_boot_order")), [wrap]);
  const setBootOrder = useCallback((order: string[]) => wrap(() => invoke<void>("idrac_set_boot_order", { order })), [wrap]);
  const setBootOnce = useCallback((target: string) => wrap(() => invoke<void>("idrac_set_boot_once", { target })), [wrap]);
  const setBootMode = useCallback((mode: string) => wrap(() => invoke<void>("idrac_set_boot_mode", { mode })), [wrap]);

  // ── Certificates ─────────────────────────────────

  const listCertificates = useCallback(() => wrap(() => invoke<IdracCertificate[]>("idrac_list_certificates")), [wrap]);
  const generateCsr = useCallback((params: CsrParams) => wrap(() => invoke<string>("idrac_generate_csr", { params })), [wrap]);
  const importCertificate = useCallback((certType: string, certData: string) => wrap(() => invoke<void>("idrac_import_certificate", { certType, certData })), [wrap]);
  const deleteCertificate = useCallback((certId: string) => wrap(() => invoke<void>("idrac_delete_certificate", { certId })), [wrap]);
  const replaceSslCertificate = useCallback((certData: string, keyData: string) => wrap(() => invoke<void>("idrac_replace_ssl_certificate", { certData, keyData })), [wrap]);

  // ── Health ───────────────────────────────────────

  const getHealthRollup = useCallback(() => wrap(() => invoke<ServerHealthRollup>("idrac_get_health_rollup")), [wrap]);
  const getComponentHealth = useCallback(() => wrap(() => invoke<ComponentHealth[]>("idrac_get_component_health")), [wrap]);
  const isHealthy = useCallback(() => wrap(() => invoke<boolean>("idrac_is_healthy")), [wrap]);

  // ── Telemetry ────────────────────────────────────

  const getPowerTelemetry = useCallback(() => wrap(() => invoke<PowerTelemetry>("idrac_get_power_telemetry")), [wrap]);
  const getThermalTelemetry = useCallback(() => wrap(() => invoke<ThermalTelemetry>("idrac_get_thermal_telemetry")), [wrap]);
  const listTelemetryReports = useCallback(() => wrap(() => invoke<TelemetryReport[]>("idrac_list_telemetry_reports")), [wrap]);
  const getTelemetryReport = useCallback((metricId: string) => wrap(() => invoke<TelemetryReport>("idrac_get_telemetry_report", { metricId })), [wrap]);

  // ── RACADM ───────────────────────────────────────

  const racadmExecute = useCallback((command: string) => wrap(() => invoke<RacadmResult>("idrac_racadm_execute", { command })), [wrap]);
  const resetIdrac = useCallback(() => wrap(() => invoke<void>("idrac_reset")), [wrap]);
  const getAttribute = useCallback((group: string, name: string) => wrap(() => invoke<string>("idrac_get_attribute", { group, name })), [wrap]);
  const setAttribute = useCallback((group: string, name: string, value: string) => wrap(() => invoke<void>("idrac_set_attribute", { group, name, value })), [wrap]);

  // ── Dashboard ────────────────────────────────────

  const getDashboard = useCallback(() => wrap(() => invoke<IdracDashboard>("idrac_get_dashboard")), [wrap]);

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
    getIdracInfo,
    setAssetTag,
    setIndicatorLed,
    powerAction,
    getPowerState,
    getPowerMetrics,
    listPowerSupplies,
    setPowerCap,
    getThermalData,
    getThermalSummary,
    setFanOffset,
    listProcessors,
    listMemory,
    listPcieDevices,
    getTotalMemory,
    getProcessorCount,
    listStorageControllers,
    listVirtualDisks,
    listPhysicalDisks,
    listEnclosures,
    createVirtualDisk,
    deleteVirtualDisk,
    assignHotspare,
    initializeVirtualDisk,
    listNetworkAdapters,
    listNetworkPorts,
    getNetworkConfig,
    updateNetworkConfig,
    listFirmware,
    updateFirmware,
    getComponentVersion,
    listJobs,
    getJob,
    deleteJob,
    purgeJobQueue,
    exportScp,
    importScp,
    getLcStatus,
    waitForJob,
    listVirtualMedia,
    mountVirtualMedia,
    unmountVirtualMedia,
    bootFromVirtualCd,
    getConsoleInfo,
    setConsoleEnabled,
    setConsoleType,
    setVncEnabled,
    setVncPassword,
    getSelEntries,
    getLcLogEntries,
    clearSel,
    clearLcLog,
    listUsers,
    createOrUpdateUser,
    deleteUser,
    unlockUser,
    changeUserPassword,
    getLdapConfig,
    getAdConfig,
    getBiosAttributes,
    getBiosAttribute,
    setBiosAttributes,
    getBootOrder,
    setBootOrder,
    setBootOnce,
    setBootMode,
    listCertificates,
    generateCsr,
    importCertificate,
    deleteCertificate,
    replaceSslCertificate,
    getHealthRollup,
    getComponentHealth,
    isHealthy,
    getPowerTelemetry,
    getThermalTelemetry,
    listTelemetryReports,
    getTelemetryReport,
    racadmExecute,
    resetIdrac,
    getAttribute,
    setAttribute,
    getDashboard,
  };
}
