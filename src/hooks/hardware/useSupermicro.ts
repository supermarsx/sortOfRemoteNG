/**
 * useSupermicro — React hook for all Supermicro BMC backend operations.
 *
 * Wraps every `smc_*` Tauri command with typed helpers,
 * loading/error state, and auto-refresh capabilities.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SmcConfigSafe,
  SmcPlatform,
  SmcSystemInfo,
  SmcBmcInfo,
  PowerAction,
  SmcPowerMetrics,
  SmcThermalData,
  SmcThermalSummary,
  SmcProcessor,
  SmcMemory,
  SmcStorageController,
  SmcVirtualDisk,
  SmcPhysicalDisk,
  SmcNetworkAdapter,
  SmcFirmwareItem,
  SmcVirtualMedia,
  SmcConsoleInfo,
  SmcEventLogEntry,
  SmcUser,
  SmcBiosAttribute,
  SmcBootConfig,
  SmcCertificate,
  SmcHealthRollup,
  SmcLicense,
  SmcSecurityStatus,
  NodeManagerPolicy,
  NodeManagerStats,
  SmcDashboard,
} from "../../types/hardware/supermicro";

// ── Types ────────────────────────────────────────────────────────

export interface UseSmcState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  config: SmcConfigSafe | null;
}

export interface UseSmcReturn extends UseSmcState {
  // Connection
  connect: (params: {
    host: string;
    port?: number;
    username: string;
    password: string;
    useSsl?: boolean;
    verifyCert?: boolean;
    platform?: SmcPlatform;
    timeoutSecs?: number;
  }) => Promise<void>;
  disconnect: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  refreshConfig: () => Promise<void>;

  // System
  getSystemInfo: () => Promise<SmcSystemInfo>;
  getBmcInfo: () => Promise<SmcBmcInfo>;
  setAssetTag: (tag: string) => Promise<void>;
  setIndicatorLed: (state: string) => Promise<void>;

  // Power
  powerAction: (action: PowerAction) => Promise<void>;
  getPowerState: () => Promise<string>;
  getPowerMetrics: () => Promise<SmcPowerMetrics>;

  // Thermal
  getThermalData: () => Promise<SmcThermalData>;
  getThermalSummary: () => Promise<SmcThermalSummary>;

  // Hardware
  getProcessors: () => Promise<SmcProcessor[]>;
  getMemory: () => Promise<SmcMemory[]>;

  // Storage
  getStorageControllers: () => Promise<SmcStorageController[]>;
  getVirtualDisks: () => Promise<SmcVirtualDisk[]>;
  getPhysicalDisks: () => Promise<SmcPhysicalDisk[]>;

  // Network
  getNetworkAdapters: () => Promise<SmcNetworkAdapter[]>;
  getBmcNetwork: () => Promise<SmcNetworkAdapter[]>;

  // Firmware
  getFirmwareInventory: () => Promise<SmcFirmwareItem[]>;

  // Virtual Media
  getVirtualMediaStatus: () => Promise<SmcVirtualMedia[]>;
  insertVirtualMedia: (slot: string, imageUrl: string) => Promise<void>;
  ejectVirtualMedia: (slot: string) => Promise<void>;

  // Console
  getConsoleInfo: () => Promise<SmcConsoleInfo>;
  getHtml5IkvmUrl: () => Promise<string>;

  // Event Logs
  getEventLog: () => Promise<SmcEventLogEntry[]>;
  getAuditLog: () => Promise<SmcEventLogEntry[]>;
  clearEventLog: () => Promise<void>;

  // Users
  getUsers: () => Promise<SmcUser[]>;
  createUser: (
    username: string,
    password: string,
    role: string,
  ) => Promise<void>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;

  // BIOS
  getBiosAttributes: () => Promise<SmcBiosAttribute[]>;
  setBiosAttributes: (attrs: Record<string, unknown>) => Promise<void>;
  getBootConfig: () => Promise<SmcBootConfig>;
  setBootOverride: (target: string, mode?: string) => Promise<void>;

  // Certificates
  getCertificate: () => Promise<SmcCertificate>;
  generateCsr: (params: {
    commonName: string;
    organization?: string;
    organizationalUnit?: string;
    city?: string;
    state?: string;
    country?: string;
    email?: string;
    keySize?: number;
  }) => Promise<string>;
  importCertificate: (certPem: string) => Promise<void>;

  // Health
  getHealthRollup: () => Promise<SmcHealthRollup>;
  getDashboard: () => Promise<SmcDashboard>;

  // Security
  getSecurityStatus: () => Promise<SmcSecurityStatus>;

  // License
  getLicenses: () => Promise<SmcLicense[]>;
  activateLicense: (key: string) => Promise<void>;

  // Node Manager (Intel)
  getNodeManagerPolicies: () => Promise<NodeManagerPolicy[]>;
  getNodeManagerStats: (
    domain?: string,
  ) => Promise<NodeManagerStats>;

  // Reset
  resetBmc: () => Promise<void>;

  // Auto-refresh
  startAutoRefresh: (intervalMs?: number) => void;
  stopAutoRefresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useSupermicro(): UseSmcReturn {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<SmcConfigSafe | null>(null);
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
      useSsl?: boolean;
      verifyCert?: boolean;
      platform?: SmcPlatform;
      timeoutSecs?: number;
    }) =>
      wrap(async () => {
        await invoke("smc_connect", {
          config: {
            host: params.host,
            port: params.port ?? 443,
            username: params.username,
            password: params.password,
            useSsl: params.useSsl ?? true,
            verifyCert: params.verifyCert ?? false,
            platform: params.platform ?? "unknown",
            authMethod: "session",
            timeoutSecs: params.timeoutSecs ?? 30,
          },
        });
        setConnected(true);
        const cfg = await invoke<SmcConfigSafe>("smc_get_config");
        setConfig(cfg);
      }),
    [wrap],
  );

  const disconnect = useCallback(
    () =>
      wrap(async () => {
        await invoke("smc_disconnect");
        setConnected(false);
        setConfig(null);
      }),
    [wrap],
  );

  const checkSession = useCallback(
    () => wrap(() => invoke<boolean>("smc_check_session")),
    [wrap],
  );

  const refreshConfig = useCallback(async () => {
    const cfg = await invoke<SmcConfigSafe>("smc_get_config");
    setConfig(cfg);
  }, []);

  // ── System ──────────────────────────────────────────────────────

  const getSystemInfo = useCallback(
    () => wrap(() => invoke<SmcSystemInfo>("smc_get_system_info")),
    [wrap],
  );

  const getBmcInfo = useCallback(
    () => wrap(() => invoke<SmcBmcInfo>("smc_get_bmc_info")),
    [wrap],
  );

  const setAssetTag = useCallback(
    (tag: string) =>
      wrap(() => invoke<void>("smc_set_asset_tag", { tag })),
    [wrap],
  );

  const setIndicatorLed = useCallback(
    (state: string) =>
      wrap(() =>
        invoke<void>("smc_set_indicator_led", { ledState: state }),
      ),
    [wrap],
  );

  // ── Power ───────────────────────────────────────────────────────

  const powerAction = useCallback(
    (action: PowerAction) =>
      wrap(() => invoke<void>("smc_power_action", { action })),
    [wrap],
  );

  const getPowerState = useCallback(
    () => wrap(() => invoke<string>("smc_get_power_state")),
    [wrap],
  );

  const getPowerMetrics = useCallback(
    () => wrap(() => invoke<SmcPowerMetrics>("smc_get_power_metrics")),
    [wrap],
  );

  // ── Thermal ─────────────────────────────────────────────────────

  const getThermalData = useCallback(
    () => wrap(() => invoke<SmcThermalData>("smc_get_thermal_data")),
    [wrap],
  );

  const getThermalSummary = useCallback(
    () =>
      wrap(() => invoke<SmcThermalSummary>("smc_get_thermal_summary")),
    [wrap],
  );

  // ── Hardware ────────────────────────────────────────────────────

  const getProcessors = useCallback(
    () => wrap(() => invoke<SmcProcessor[]>("smc_get_processors")),
    [wrap],
  );

  const getMemory = useCallback(
    () => wrap(() => invoke<SmcMemory[]>("smc_get_memory")),
    [wrap],
  );

  // ── Storage ─────────────────────────────────────────────────────

  const getStorageControllers = useCallback(
    () =>
      wrap(() =>
        invoke<SmcStorageController[]>("smc_get_storage_controllers"),
      ),
    [wrap],
  );

  const getVirtualDisks = useCallback(
    () =>
      wrap(() => invoke<SmcVirtualDisk[]>("smc_get_virtual_disks")),
    [wrap],
  );

  const getPhysicalDisks = useCallback(
    () =>
      wrap(() => invoke<SmcPhysicalDisk[]>("smc_get_physical_disks")),
    [wrap],
  );

  // ── Network ─────────────────────────────────────────────────────

  const getNetworkAdapters = useCallback(
    () =>
      wrap(() =>
        invoke<SmcNetworkAdapter[]>("smc_get_network_adapters"),
      ),
    [wrap],
  );

  const getBmcNetwork = useCallback(
    () =>
      wrap(() => invoke<SmcNetworkAdapter[]>("smc_get_bmc_network")),
    [wrap],
  );

  // ── Firmware ────────────────────────────────────────────────────

  const getFirmwareInventory = useCallback(
    () =>
      wrap(() =>
        invoke<SmcFirmwareItem[]>("smc_get_firmware_inventory"),
      ),
    [wrap],
  );

  // ── Virtual Media ───────────────────────────────────────────────

  const getVirtualMediaStatus = useCallback(
    () =>
      wrap(() =>
        invoke<SmcVirtualMedia[]>("smc_get_virtual_media_status"),
      ),
    [wrap],
  );

  const insertVirtualMedia = useCallback(
    (slot: string, imageUrl: string) =>
      wrap(() =>
        invoke<void>("smc_insert_virtual_media", { slot, imageUrl }),
      ),
    [wrap],
  );

  const ejectVirtualMedia = useCallback(
    (slot: string) =>
      wrap(() => invoke<void>("smc_eject_virtual_media", { slot })),
    [wrap],
  );

  // ── Console ─────────────────────────────────────────────────────

  const getConsoleInfo = useCallback(
    () => wrap(() => invoke<SmcConsoleInfo>("smc_get_console_info")),
    [wrap],
  );

  const getHtml5IkvmUrl = useCallback(
    () => wrap(() => invoke<string>("smc_get_html5_ikvm_url")),
    [wrap],
  );

  // ── Event Logs ──────────────────────────────────────────────────

  const getEventLog = useCallback(
    () =>
      wrap(() => invoke<SmcEventLogEntry[]>("smc_get_event_log")),
    [wrap],
  );

  const getAuditLog = useCallback(
    () =>
      wrap(() => invoke<SmcEventLogEntry[]>("smc_get_audit_log")),
    [wrap],
  );

  const clearEventLog = useCallback(
    () => wrap(() => invoke<void>("smc_clear_event_log")),
    [wrap],
  );

  // ── Users ───────────────────────────────────────────────────────

  const getUsers = useCallback(
    () => wrap(() => invoke<SmcUser[]>("smc_get_users")),
    [wrap],
  );

  const createUser = useCallback(
    (username: string, password: string, role: string) =>
      wrap(() =>
        invoke<void>("smc_create_user", { username, password, role }),
      ),
    [wrap],
  );

  const updatePassword = useCallback(
    (userId: string, newPassword: string) =>
      wrap(() =>
        invoke<void>("smc_update_password", { userId, newPassword }),
      ),
    [wrap],
  );

  const deleteUser = useCallback(
    (userId: string) =>
      wrap(() => invoke<void>("smc_delete_user", { userId })),
    [wrap],
  );

  // ── BIOS ────────────────────────────────────────────────────────

  const getBiosAttributes = useCallback(
    () =>
      wrap(() =>
        invoke<SmcBiosAttribute[]>("smc_get_bios_attributes"),
      ),
    [wrap],
  );

  const setBiosAttributes = useCallback(
    (attrs: Record<string, unknown>) =>
      wrap(() =>
        invoke<void>("smc_set_bios_attributes", { attributes: attrs }),
      ),
    [wrap],
  );

  const getBootConfig = useCallback(
    () => wrap(() => invoke<SmcBootConfig>("smc_get_boot_config")),
    [wrap],
  );

  const setBootOverride = useCallback(
    (target: string, mode?: string) =>
      wrap(() =>
        invoke<void>("smc_set_boot_override", { target, mode }),
      ),
    [wrap],
  );

  // ── Certificates ────────────────────────────────────────────────

  const getCertificate = useCallback(
    () => wrap(() => invoke<SmcCertificate>("smc_get_certificate")),
    [wrap],
  );

  const generateCsr = useCallback(
    (params: {
      commonName: string;
      organization?: string;
      organizationalUnit?: string;
      city?: string;
      state?: string;
      country?: string;
      email?: string;
      keySize?: number;
    }) =>
      wrap(() => invoke<string>("smc_generate_csr", { params })),
    [wrap],
  );

  const importCertificate = useCallback(
    (certPem: string) =>
      wrap(() =>
        invoke<void>("smc_import_certificate", { certPem }),
      ),
    [wrap],
  );

  // ── Health ──────────────────────────────────────────────────────

  const getHealthRollup = useCallback(
    () =>
      wrap(() => invoke<SmcHealthRollup>("smc_get_health_rollup")),
    [wrap],
  );

  const getDashboard = useCallback(
    () => wrap(() => invoke<SmcDashboard>("smc_get_dashboard")),
    [wrap],
  );

  // ── Security ────────────────────────────────────────────────────

  const getSecurityStatus = useCallback(
    () =>
      wrap(() => invoke<SmcSecurityStatus>("smc_get_security_status")),
    [wrap],
  );

  // ── License ─────────────────────────────────────────────────────

  const getLicenses = useCallback(
    () => wrap(() => invoke<SmcLicense[]>("smc_get_licenses")),
    [wrap],
  );

  const activateLicense = useCallback(
    (key: string) =>
      wrap(() => invoke<void>("smc_activate_license", { key })),
    [wrap],
  );

  // ── Node Manager ────────────────────────────────────────────────

  const getNodeManagerPolicies = useCallback(
    () =>
      wrap(() =>
        invoke<NodeManagerPolicy[]>("smc_get_node_manager_policies"),
      ),
    [wrap],
  );

  const getNodeManagerStats = useCallback(
    (domain?: string) =>
      wrap(() =>
        invoke<NodeManagerStats>("smc_get_node_manager_stats", { domain }),
      ),
    [wrap],
  );

  // ── Reset ───────────────────────────────────────────────────────

  const resetBmc = useCallback(
    () => wrap(() => invoke<void>("smc_reset_bmc")),
    [wrap],
  );

  // ── Auto-refresh ────────────────────────────────────────────────

  const startAutoRefresh = useCallback((intervalMs = 30000) => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(async () => {
      try {
        const ok = await invoke<boolean>("smc_check_session");
        setConnected(ok);
      } catch {
        setConnected(false);
      }
    }, intervalMs);
  }, []);

  const stopAutoRefresh = useCallback(() => {
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
  }, []);

  useEffect(() => () => stopAutoRefresh(), [stopAutoRefresh]);

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
    getBmcInfo,
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
    getBmcNetwork,
    getFirmwareInventory,
    getVirtualMediaStatus,
    insertVirtualMedia,
    ejectVirtualMedia,
    getConsoleInfo,
    getHtml5IkvmUrl,
    getEventLog,
    getAuditLog,
    clearEventLog,
    getUsers,
    createUser,
    updatePassword,
    deleteUser,
    getBiosAttributes,
    setBiosAttributes,
    getBootConfig,
    setBootOverride,
    getCertificate,
    generateCsr,
    importCertificate,
    getHealthRollup,
    getDashboard,
    getSecurityStatus,
    getLicenses,
    activateLicense,
    getNodeManagerPolicies,
    getNodeManagerStats,
    resetBmc,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
