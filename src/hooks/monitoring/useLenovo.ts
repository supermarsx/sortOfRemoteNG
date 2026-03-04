/**
 * useLenovo — React hook for all Lenovo XCC/IMM backend operations.
 *
 * Wraps every `lenovo_*` Tauri command with typed helpers,
 * loading/error state, and auto-refresh capabilities.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  LenovoConfigSafe,
  LenovoSystemInfo,
  XccInfo,
  PowerAction,
  LenovoPowerMetrics,
  LenovoThermalData,
  LenovoThermalSummary,
  LenovoProcessor,
  LenovoMemory,
  LenovoStorageController,
  LenovoVirtualDisk,
  LenovoPhysicalDisk,
  LenovoNetworkAdapter,
  LenovoFirmwareItem,
  LenovoVirtualMedia,
  XccConsoleInfo,
  LenovoEventLogEntry,
  LenovoUser,
  LenovoBiosAttribute,
  LenovoBootConfig,
  XccCertificate,
  LenovoHealthRollup,
  XccLicense,
  OnecliResult,
  XccDashboard,
  XccGeneration,
} from "../../types/lenovo";

// ── Types ────────────────────────────────────────────────────────

export interface UseLenovoState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  config: LenovoConfigSafe | null;
}

export interface UseLenovoReturn extends UseLenovoState {
  // Connection
  connect: (params: {
    host: string;
    port?: number;
    username: string;
    password: string;
    useSsl?: boolean;
    verifyCert?: boolean;
    generation?: XccGeneration;
    timeoutSecs?: number;
  }) => Promise<void>;
  disconnect: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  refreshConfig: () => Promise<void>;

  // System
  getSystemInfo: () => Promise<LenovoSystemInfo>;
  getXccInfo: () => Promise<XccInfo>;
  setAssetTag: (tag: string) => Promise<void>;
  setIndicatorLed: (state: string) => Promise<void>;

  // Power
  powerAction: (action: PowerAction) => Promise<void>;
  getPowerState: () => Promise<string>;
  getPowerMetrics: () => Promise<LenovoPowerMetrics>;

  // Thermal
  getThermalData: () => Promise<LenovoThermalData>;
  getThermalSummary: () => Promise<LenovoThermalSummary>;

  // Hardware
  getProcessors: () => Promise<LenovoProcessor[]>;
  getMemory: () => Promise<LenovoMemory[]>;

  // Storage
  getStorageControllers: () => Promise<LenovoStorageController[]>;
  getVirtualDisks: () => Promise<LenovoVirtualDisk[]>;
  getPhysicalDisks: () => Promise<LenovoPhysicalDisk[]>;

  // Network
  getNetworkAdapters: () => Promise<LenovoNetworkAdapter[]>;
  getXccNetwork: () => Promise<LenovoNetworkAdapter[]>;

  // Firmware
  getFirmwareInventory: () => Promise<LenovoFirmwareItem[]>;

  // Virtual Media
  getVirtualMediaStatus: () => Promise<LenovoVirtualMedia[]>;
  insertVirtualMedia: (slot: string, imageUrl: string) => Promise<void>;
  ejectVirtualMedia: (slot: string) => Promise<void>;

  // Console
  getConsoleInfo: () => Promise<XccConsoleInfo>;
  getHtml5LaunchUrl: () => Promise<string>;

  // Event Logs
  getEventLog: () => Promise<LenovoEventLogEntry[]>;
  getAuditLog: () => Promise<LenovoEventLogEntry[]>;
  clearEventLog: () => Promise<void>;

  // Users
  getUsers: () => Promise<LenovoUser[]>;
  createUser: (
    username: string,
    password: string,
    role: string,
  ) => Promise<void>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;

  // BIOS
  getBiosAttributes: () => Promise<LenovoBiosAttribute[]>;
  setBiosAttributes: (attrs: Record<string, unknown>) => Promise<void>;
  getBootConfig: () => Promise<LenovoBootConfig>;
  setBootOverride: (target: string, mode?: string) => Promise<void>;

  // Certificates
  getCertificate: () => Promise<XccCertificate>;
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
  getHealthRollup: () => Promise<LenovoHealthRollup>;
  getDashboard: () => Promise<XccDashboard>;

  // License
  getLicense: () => Promise<XccLicense>;

  // OneCLI
  onecliExecute: (command: string) => Promise<OnecliResult>;

  // Reset
  resetController: () => Promise<void>;

  // Auto-refresh
  startAutoRefresh: (intervalMs?: number) => void;
  stopAutoRefresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useLenovo(): UseLenovoReturn {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<LenovoConfigSafe | null>(null);
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
      generation?: XccGeneration;
      timeoutSecs?: number;
    }) =>
      wrap(async () => {
        await invoke("lenovo_connect", {
          config: {
            host: params.host,
            port: params.port ?? 443,
            username: params.username,
            password: params.password,
            useSsl: params.useSsl ?? true,
            verifyCert: params.verifyCert ?? false,
            generation: params.generation ?? "unknown",
            authMethod: "session",
            timeoutSecs: params.timeoutSecs ?? 30,
          },
        });
        setConnected(true);
        const cfg = await invoke<LenovoConfigSafe>("lenovo_get_config");
        setConfig(cfg);
      }),
    [wrap],
  );

  const disconnect = useCallback(
    () =>
      wrap(async () => {
        await invoke("lenovo_disconnect");
        setConnected(false);
        setConfig(null);
      }),
    [wrap],
  );

  const checkSession = useCallback(
    () => wrap(() => invoke<boolean>("lenovo_check_session")),
    [wrap],
  );

  const refreshConfig = useCallback(async () => {
    const cfg = await invoke<LenovoConfigSafe>("lenovo_get_config");
    setConfig(cfg);
  }, []);

  // ── System ──────────────────────────────────────────────────────

  const getSystemInfo = useCallback(
    () => wrap(() => invoke<LenovoSystemInfo>("lenovo_get_system_info")),
    [wrap],
  );

  const getXccInfo = useCallback(
    () => wrap(() => invoke<XccInfo>("lenovo_get_xcc_info")),
    [wrap],
  );

  const setAssetTag = useCallback(
    (tag: string) => wrap(() => invoke<void>("lenovo_set_asset_tag", { tag })),
    [wrap],
  );

  const setIndicatorLed = useCallback(
    (state: string) =>
      wrap(() => invoke<void>("lenovo_set_indicator_led", { ledState: state })),
    [wrap],
  );

  // ── Power ───────────────────────────────────────────────────────

  const powerAction = useCallback(
    (action: PowerAction) =>
      wrap(() => invoke<void>("lenovo_power_action", { action })),
    [wrap],
  );

  const getPowerState = useCallback(
    () => wrap(() => invoke<string>("lenovo_get_power_state")),
    [wrap],
  );

  const getPowerMetrics = useCallback(
    () => wrap(() => invoke<LenovoPowerMetrics>("lenovo_get_power_metrics")),
    [wrap],
  );

  // ── Thermal ─────────────────────────────────────────────────────

  const getThermalData = useCallback(
    () => wrap(() => invoke<LenovoThermalData>("lenovo_get_thermal_data")),
    [wrap],
  );

  const getThermalSummary = useCallback(
    () =>
      wrap(() => invoke<LenovoThermalSummary>("lenovo_get_thermal_summary")),
    [wrap],
  );

  // ── Hardware ────────────────────────────────────────────────────

  const getProcessors = useCallback(
    () => wrap(() => invoke<LenovoProcessor[]>("lenovo_get_processors")),
    [wrap],
  );

  const getMemory = useCallback(
    () => wrap(() => invoke<LenovoMemory[]>("lenovo_get_memory")),
    [wrap],
  );

  // ── Storage ─────────────────────────────────────────────────────

  const getStorageControllers = useCallback(
    () =>
      wrap(() =>
        invoke<LenovoStorageController[]>("lenovo_get_storage_controllers"),
      ),
    [wrap],
  );

  const getVirtualDisks = useCallback(
    () => wrap(() => invoke<LenovoVirtualDisk[]>("lenovo_get_virtual_disks")),
    [wrap],
  );

  const getPhysicalDisks = useCallback(
    () =>
      wrap(() => invoke<LenovoPhysicalDisk[]>("lenovo_get_physical_disks")),
    [wrap],
  );

  // ── Network ─────────────────────────────────────────────────────

  const getNetworkAdapters = useCallback(
    () =>
      wrap(() =>
        invoke<LenovoNetworkAdapter[]>("lenovo_get_network_adapters"),
      ),
    [wrap],
  );

  const getXccNetwork = useCallback(
    () =>
      wrap(() => invoke<LenovoNetworkAdapter[]>("lenovo_get_xcc_network")),
    [wrap],
  );

  // ── Firmware ────────────────────────────────────────────────────

  const getFirmwareInventory = useCallback(
    () =>
      wrap(() =>
        invoke<LenovoFirmwareItem[]>("lenovo_get_firmware_inventory"),
      ),
    [wrap],
  );

  // ── Virtual Media ───────────────────────────────────────────────

  const getVirtualMediaStatus = useCallback(
    () =>
      wrap(() =>
        invoke<LenovoVirtualMedia[]>("lenovo_get_virtual_media_status"),
      ),
    [wrap],
  );

  const insertVirtualMedia = useCallback(
    (slot: string, imageUrl: string) =>
      wrap(() =>
        invoke<void>("lenovo_insert_virtual_media", { slot, imageUrl }),
      ),
    [wrap],
  );

  const ejectVirtualMedia = useCallback(
    (slot: string) =>
      wrap(() => invoke<void>("lenovo_eject_virtual_media", { slot })),
    [wrap],
  );

  // ── Console ─────────────────────────────────────────────────────

  const getConsoleInfo = useCallback(
    () => wrap(() => invoke<XccConsoleInfo>("lenovo_get_console_info")),
    [wrap],
  );

  const getHtml5LaunchUrl = useCallback(
    () => wrap(() => invoke<string>("lenovo_get_html5_launch_url")),
    [wrap],
  );

  // ── Event Logs ──────────────────────────────────────────────────

  const getEventLog = useCallback(
    () =>
      wrap(() => invoke<LenovoEventLogEntry[]>("lenovo_get_event_log")),
    [wrap],
  );

  const getAuditLog = useCallback(
    () =>
      wrap(() => invoke<LenovoEventLogEntry[]>("lenovo_get_audit_log")),
    [wrap],
  );

  const clearEventLog = useCallback(
    () => wrap(() => invoke<void>("lenovo_clear_event_log")),
    [wrap],
  );

  // ── Users ───────────────────────────────────────────────────────

  const getUsers = useCallback(
    () => wrap(() => invoke<LenovoUser[]>("lenovo_get_users")),
    [wrap],
  );

  const createUser = useCallback(
    (username: string, password: string, role: string) =>
      wrap(() =>
        invoke<void>("lenovo_create_user", { username, password, role }),
      ),
    [wrap],
  );

  const updatePassword = useCallback(
    (userId: string, newPassword: string) =>
      wrap(() =>
        invoke<void>("lenovo_update_password", { userId, newPassword }),
      ),
    [wrap],
  );

  const deleteUser = useCallback(
    (userId: string) =>
      wrap(() => invoke<void>("lenovo_delete_user", { userId })),
    [wrap],
  );

  // ── BIOS ────────────────────────────────────────────────────────

  const getBiosAttributes = useCallback(
    () =>
      wrap(() =>
        invoke<LenovoBiosAttribute[]>("lenovo_get_bios_attributes"),
      ),
    [wrap],
  );

  const setBiosAttributes = useCallback(
    (attrs: Record<string, unknown>) =>
      wrap(() =>
        invoke<void>("lenovo_set_bios_attributes", { attributes: attrs }),
      ),
    [wrap],
  );

  const getBootConfig = useCallback(
    () => wrap(() => invoke<LenovoBootConfig>("lenovo_get_boot_config")),
    [wrap],
  );

  const setBootOverride = useCallback(
    (target: string, mode?: string) =>
      wrap(() =>
        invoke<void>("lenovo_set_boot_override", { target, mode }),
      ),
    [wrap],
  );

  // ── Certificates ────────────────────────────────────────────────

  const getCertificate = useCallback(
    () => wrap(() => invoke<XccCertificate>("lenovo_get_certificate")),
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
      wrap(() => invoke<string>("lenovo_generate_csr", { params })),
    [wrap],
  );

  const importCertificate = useCallback(
    (certPem: string) =>
      wrap(() =>
        invoke<void>("lenovo_import_certificate", { certPem }),
      ),
    [wrap],
  );

  // ── Health ──────────────────────────────────────────────────────

  const getHealthRollup = useCallback(
    () =>
      wrap(() => invoke<LenovoHealthRollup>("lenovo_get_health_rollup")),
    [wrap],
  );

  const getDashboard = useCallback(
    () => wrap(() => invoke<XccDashboard>("lenovo_get_dashboard")),
    [wrap],
  );

  // ── License ─────────────────────────────────────────────────────

  const getLicense = useCallback(
    () => wrap(() => invoke<XccLicense>("lenovo_get_license")),
    [wrap],
  );

  // ── OneCLI ──────────────────────────────────────────────────────

  const onecliExecute = useCallback(
    (command: string) =>
      wrap(() => invoke<OnecliResult>("lenovo_onecli_execute", { command })),
    [wrap],
  );

  // ── Reset ───────────────────────────────────────────────────────

  const resetController = useCallback(
    () => wrap(() => invoke<void>("lenovo_reset_controller")),
    [wrap],
  );

  // ── Auto-refresh ────────────────────────────────────────────────

  const startAutoRefresh = useCallback((intervalMs = 30000) => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(async () => {
      try {
        const ok = await invoke<boolean>("lenovo_check_session");
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
    getXccInfo,
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
    getXccNetwork,
    getFirmwareInventory,
    getVirtualMediaStatus,
    insertVirtualMedia,
    ejectVirtualMedia,
    getConsoleInfo,
    getHtml5LaunchUrl,
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
    getLicense,
    onecliExecute,
    resetController,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
