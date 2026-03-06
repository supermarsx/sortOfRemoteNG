/**
 * useIdracManager — "mgr" hook that powers the iDRAC management panel.
 *
 * Manages connection state, tab navigation, dashboard data,
 * refresh polling, and all user actions for Dell iDRAC BMCs.
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
  BootConfig,
  IdracCertificate,
  CsrParams,
  ServerHealthRollup,
  PowerTelemetry,
  ThermalTelemetry,
  TelemetryReport,
  RacadmResult,
  IdracDashboard,
} from "../../types/hardware/idrac";

// ── Tab & View Types ─────────────────────────────────────────────

export type IdracTab =
  | "dashboard"
  | "system"
  | "power"
  | "thermal"
  | "hardware"
  | "storage"
  | "network"
  | "firmware"
  | "lifecycle"
  | "virtual-media"
  | "console"
  | "event-log"
  | "users"
  | "bios"
  | "certificates"
  | "health"
  | "telemetry"
  | "racadm";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface IdracManagerState {
  // Connection
  connectionState: ConnectionState;
  host: string;
  port: number;
  username: string;
  password: string;
  insecure: boolean;
  forceProtocol: string;
  connectionError: string | null;
  config: IdracConfigSafe | null;

  // Navigation
  activeTab: IdracTab;

  // Dashboard
  dashboard: IdracDashboard | null;

  // System
  systemInfo: SystemInfo | null;
  idracInfo: IdracInfo | null;

  // Power
  powerState: string | null;
  powerMetrics: PowerMetrics | null;
  powerSupplies: PowerSupply[];

  // Thermal
  thermalData: ThermalData | null;
  thermalSummary: ThermalSummary | null;

  // Hardware
  processors: Processor[];
  memory: MemoryDimm[];
  pcieDevices: PcieDevice[];

  // Storage
  storageControllers: StorageController[];
  virtualDisks: VirtualDisk[];
  physicalDisks: PhysicalDisk[];
  enclosures: StorageEnclosure[];

  // Network
  networkAdapters: NetworkAdapter[];
  networkConfig: IdracNetworkConfig | null;

  // Firmware
  firmware: FirmwareInventory[];

  // Lifecycle
  jobs: LifecycleJob[];
  lcStatus: string | null;

  // Virtual Media
  virtualMedia: VirtualMediaStatus[];

  // Console
  consoleInfo: ConsoleInfo | null;

  // Event Log
  selEntries: SelEntry[];
  lcLogEntries: LcLogEntry[];

  // Users
  users: IdracUser[];
  ldapConfig: LdapConfig | null;
  adConfig: ActiveDirectoryConfig | null;

  // BIOS
  biosAttributes: BiosAttribute[];
  bootConfig: BootConfig | null;

  // Certificates
  certificates: IdracCertificate[];

  // Health
  healthRollup: ServerHealthRollup | null;

  // Telemetry
  powerTelemetry: PowerTelemetry | null;
  thermalTelemetry: ThermalTelemetry | null;
  telemetryReports: TelemetryReport[];

  // RACADM
  racadmOutput: RacadmResult | null;

  // Loading / error
  loading: boolean;
  dataError: string | null;
  refreshing: boolean;

  // Dialogs
  showConfirmAction: boolean;
  confirmAction: (() => Promise<void>) | null;
  confirmMessage: string;
  confirmTitle: string;

  // Search
  searchQuery: string;
}

// ── The hook ─────────────────────────────────────────────────────

export function useIdracManager(isOpen: boolean) {
  // ---- Connection form state ----
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(443);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [insecure, setInsecure] = useState(true);
  const [forceProtocol, setForceProtocol] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [config, setConfig] = useState<IdracConfigSafe | null>(null);

  // ---- Navigation ----
  const [activeTab, setActiveTab] = useState<IdracTab>("dashboard");

  // ---- Dashboard ----
  const [dashboard, setDashboard] = useState<IdracDashboard | null>(null);

  // ---- System ----
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [idracInfo, setIdracInfo] = useState<IdracInfo | null>(null);

  // ---- Power ----
  const [powerState, setPowerState] = useState<string | null>(null);
  const [powerMetrics, setPowerMetrics] = useState<PowerMetrics | null>(null);
  const [powerSupplies, setPowerSupplies] = useState<PowerSupply[]>([]);

  // ---- Thermal ----
  const [thermalData, setThermalData] = useState<ThermalData | null>(null);
  const [thermalSummary, setThermalSummary] = useState<ThermalSummary | null>(null);

  // ---- Hardware ----
  const [processors, setProcessors] = useState<Processor[]>([]);
  const [memory, setMemory] = useState<MemoryDimm[]>([]);
  const [pcieDevices, setPcieDevices] = useState<PcieDevice[]>([]);

  // ---- Storage ----
  const [storageControllers, setStorageControllers] = useState<StorageController[]>([]);
  const [virtualDisks, setVirtualDisks] = useState<VirtualDisk[]>([]);
  const [physicalDisks, setPhysicalDisks] = useState<PhysicalDisk[]>([]);
  const [enclosures, setEnclosures] = useState<StorageEnclosure[]>([]);

  // ---- Network ----
  const [networkAdapters, setNetworkAdapters] = useState<NetworkAdapter[]>([]);
  const [networkConfig, setNetworkConfig] = useState<IdracNetworkConfig | null>(null);

  // ---- Firmware ----
  const [firmware, setFirmware] = useState<FirmwareInventory[]>([]);

  // ---- Lifecycle ----
  const [jobs, setJobs] = useState<LifecycleJob[]>([]);
  const [lcStatus, setLcStatus] = useState<string | null>(null);

  // ---- Virtual Media ----
  const [virtualMedia, setVirtualMedia] = useState<VirtualMediaStatus[]>([]);

  // ---- Console ----
  const [consoleInfo, setConsoleInfo] = useState<ConsoleInfo | null>(null);

  // ---- Event Log ----
  const [selEntries, setSelEntries] = useState<SelEntry[]>([]);
  const [lcLogEntries, setLcLogEntries] = useState<LcLogEntry[]>([]);

  // ---- Users ----
  const [users, setUsers] = useState<IdracUser[]>([]);
  const [ldapConfig, setLdapConfig] = useState<LdapConfig | null>(null);
  const [adConfig, setAdConfig] = useState<ActiveDirectoryConfig | null>(null);

  // ---- BIOS ----
  const [biosAttributes, setBiosAttributes] = useState<BiosAttribute[]>([]);
  const [bootConfig, setBootConfig] = useState<BootConfig | null>(null);

  // ---- Certificates ----
  const [certificates, setCertificates] = useState<IdracCertificate[]>([]);

  // ---- Health ----
  const [healthRollup, setHealthRollup] = useState<ServerHealthRollup | null>(null);

  // ---- Telemetry ----
  const [powerTelemetry, setPowerTelemetry] = useState<PowerTelemetry | null>(null);
  const [thermalTelemetry, setThermalTelemetry] = useState<ThermalTelemetry | null>(null);
  const [telemetryReports, setTelemetryReports] = useState<TelemetryReport[]>([]);

  // ---- RACADM ----
  const [racadmOutput, setRacadmOutput] = useState<RacadmResult | null>(null);

  // ---- UI ----
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showConfirmAction, setShowConfirmAction] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmTitle, setConfirmTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Helpers ──────────────────────────────────────

  const safe = useCallback(<T>(fn: () => void) => {
    if (mountedRef.current) fn();
  }, []);

  const tryInvoke = useCallback(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      throw new Error(msg);
    }
  }, []);

  // ── Connection ───────────────────────────────────

  const connect = useCallback(async () => {
    safe(() => {
      setConnectionState("connecting");
      setConnectionError(null);
    });
    try {
      await tryInvoke<string>("idrac_connect", {
        host,
        port,
        username,
        password,
        insecure,
        forceProtocol: forceProtocol || null,
        timeoutSecs: 30,
      });
      const cfg = await tryInvoke<IdracConfigSafe>("idrac_get_config");
      safe(() => {
        setConnectionState("connected");
        setConfig(cfg);
      });
    } catch (e) {
      safe(() => {
        setConnectionState("error");
        setConnectionError((e as Error).message);
      });
    }
  }, [host, port, username, password, insecure, forceProtocol, tryInvoke, safe]);

  const disconnect = useCallback(async () => {
    try {
      await tryInvoke("idrac_disconnect");
    } catch {
      // ignore
    }
    safe(() => {
      setConnectionState("disconnected");
      setConfig(null);
      setDashboard(null);
    });
  }, [tryInvoke, safe]);

  const checkSession = useCallback(async () => {
    try {
      const ok = await tryInvoke<boolean>("idrac_check_session");
      if (!ok) safe(() => setConnectionState("disconnected"));
      return ok;
    } catch {
      safe(() => setConnectionState("disconnected"));
      return false;
    }
  }, [tryInvoke, safe]);

  // ── Tab-specific data loading ────────────────────

  const loadDashboard = useCallback(async () => {
    try {
      const d = await tryInvoke<IdracDashboard>("idrac_get_dashboard");
      safe(() => setDashboard(d));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadSystem = useCallback(async () => {
    try {
      const [sys, idr] = await Promise.all([
        tryInvoke<SystemInfo>("idrac_get_system_info"),
        tryInvoke<IdracInfo>("idrac_get_idrac_info"),
      ]);
      safe(() => {
        setSystemInfo(sys);
        setIdracInfo(idr);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadPower = useCallback(async () => {
    try {
      const [state, metrics, psus] = await Promise.all([
        tryInvoke<string>("idrac_get_power_state"),
        tryInvoke<PowerMetrics>("idrac_get_power_metrics"),
        tryInvoke<PowerSupply[]>("idrac_list_power_supplies"),
      ]);
      safe(() => {
        setPowerState(state);
        setPowerMetrics(metrics);
        setPowerSupplies(psus);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadThermal = useCallback(async () => {
    try {
      const [data, summary] = await Promise.all([
        tryInvoke<ThermalData>("idrac_get_thermal_data"),
        tryInvoke<ThermalSummary>("idrac_get_thermal_summary"),
      ]);
      safe(() => {
        setThermalData(data);
        setThermalSummary(summary);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadHardware = useCallback(async () => {
    try {
      const [cpus, mem, pcie] = await Promise.all([
        tryInvoke<Processor[]>("idrac_list_processors"),
        tryInvoke<MemoryDimm[]>("idrac_list_memory"),
        tryInvoke<PcieDevice[]>("idrac_list_pcie_devices"),
      ]);
      safe(() => {
        setProcessors(cpus);
        setMemory(mem);
        setPcieDevices(pcie);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadStorage = useCallback(async () => {
    try {
      const [ctrls, vds, pds, encs] = await Promise.all([
        tryInvoke<StorageController[]>("idrac_list_storage_controllers"),
        tryInvoke<VirtualDisk[]>("idrac_list_virtual_disks", { controllerId: null }),
        tryInvoke<PhysicalDisk[]>("idrac_list_physical_disks", { controllerId: null }),
        tryInvoke<StorageEnclosure[]>("idrac_list_enclosures"),
      ]);
      safe(() => {
        setStorageControllers(ctrls);
        setVirtualDisks(vds);
        setPhysicalDisks(pds);
        setEnclosures(encs);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadNetwork = useCallback(async () => {
    try {
      const [adapters, netCfg] = await Promise.all([
        tryInvoke<NetworkAdapter[]>("idrac_list_network_adapters"),
        tryInvoke<IdracNetworkConfig>("idrac_get_network_config"),
      ]);
      safe(() => {
        setNetworkAdapters(adapters);
        setNetworkConfig(netCfg);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadFirmware = useCallback(async () => {
    try {
      const fw = await tryInvoke<FirmwareInventory[]>("idrac_list_firmware");
      safe(() => setFirmware(fw));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadLifecycle = useCallback(async () => {
    try {
      const [j, status] = await Promise.all([
        tryInvoke<LifecycleJob[]>("idrac_list_jobs"),
        tryInvoke<string>("idrac_get_lc_status"),
      ]);
      safe(() => {
        setJobs(j);
        setLcStatus(status);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadVirtualMedia = useCallback(async () => {
    try {
      const media = await tryInvoke<VirtualMediaStatus[]>("idrac_list_virtual_media");
      safe(() => setVirtualMedia(media));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadConsole = useCallback(async () => {
    try {
      const info = await tryInvoke<ConsoleInfo>("idrac_get_console_info");
      safe(() => setConsoleInfo(info));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadEventLog = useCallback(async () => {
    try {
      const [sel, lc] = await Promise.all([
        tryInvoke<SelEntry[]>("idrac_get_sel_entries", { limit: 200 }),
        tryInvoke<LcLogEntry[]>("idrac_get_lc_log_entries", { limit: 200 }),
      ]);
      safe(() => {
        setSelEntries(sel);
        setLcLogEntries(lc);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadUsers = useCallback(async () => {
    try {
      const [u, ldap, ad] = await Promise.all([
        tryInvoke<IdracUser[]>("idrac_list_users"),
        tryInvoke<LdapConfig>("idrac_get_ldap_config"),
        tryInvoke<ActiveDirectoryConfig>("idrac_get_ad_config"),
      ]);
      safe(() => {
        setUsers(u);
        setLdapConfig(ldap);
        setAdConfig(ad);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadBios = useCallback(async () => {
    try {
      const [attrs, boot] = await Promise.all([
        tryInvoke<BiosAttribute[]>("idrac_get_bios_attributes"),
        tryInvoke<BootConfig>("idrac_get_boot_order"),
      ]);
      safe(() => {
        setBiosAttributes(attrs);
        setBootConfig(boot);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadCertificates = useCallback(async () => {
    try {
      const certs = await tryInvoke<IdracCertificate[]>("idrac_list_certificates");
      safe(() => setCertificates(certs));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadHealth = useCallback(async () => {
    try {
      const h = await tryInvoke<ServerHealthRollup>("idrac_get_health_rollup");
      safe(() => setHealthRollup(h));
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  const loadTelemetry = useCallback(async () => {
    try {
      const [pt, tt, reports] = await Promise.all([
        tryInvoke<PowerTelemetry>("idrac_get_power_telemetry"),
        tryInvoke<ThermalTelemetry>("idrac_get_thermal_telemetry"),
        tryInvoke<TelemetryReport[]>("idrac_list_telemetry_reports"),
      ]);
      safe(() => {
        setPowerTelemetry(pt);
        setThermalTelemetry(tt);
        setTelemetryReports(reports);
      });
    } catch (e) {
      safe(() => setDataError((e as Error).message));
    }
  }, [tryInvoke, safe]);

  // ── Load data for active tab ─────────────────────

  const loadTabData = useCallback(async (tab: IdracTab) => {
    safe(() => {
      setLoading(true);
      setDataError(null);
    });
    try {
      switch (tab) {
        case "dashboard":
          await loadDashboard();
          break;
        case "system":
          await loadSystem();
          break;
        case "power":
          await loadPower();
          break;
        case "thermal":
          await loadThermal();
          break;
        case "hardware":
          await loadHardware();
          break;
        case "storage":
          await loadStorage();
          break;
        case "network":
          await loadNetwork();
          break;
        case "firmware":
          await loadFirmware();
          break;
        case "lifecycle":
          await loadLifecycle();
          break;
        case "virtual-media":
          await loadVirtualMedia();
          break;
        case "console":
          await loadConsole();
          break;
        case "event-log":
          await loadEventLog();
          break;
        case "users":
          await loadUsers();
          break;
        case "bios":
          await loadBios();
          break;
        case "certificates":
          await loadCertificates();
          break;
        case "health":
          await loadHealth();
          break;
        case "telemetry":
          await loadTelemetry();
          break;
        case "racadm":
          // nothing to pre-load
          break;
      }
    } finally {
      safe(() => setLoading(false));
    }
  }, [
    safe, loadDashboard, loadSystem, loadPower, loadThermal,
    loadHardware, loadStorage, loadNetwork, loadFirmware,
    loadLifecycle, loadVirtualMedia, loadConsole, loadEventLog,
    loadUsers, loadBios, loadCertificates, loadHealth, loadTelemetry,
  ]);

  // ── Refresh current tab ──────────────────────────

  const refresh = useCallback(async () => {
    if (connectionState !== "connected") return;
    safe(() => setRefreshing(true));
    await loadTabData(activeTab);
    safe(() => setRefreshing(false));
  }, [connectionState, activeTab, loadTabData, safe]);

  // ── Tab change ───────────────────────────────────

  const changeTab = useCallback(
    (tab: IdracTab) => {
      setActiveTab(tab);
      if (connectionState === "connected") {
        loadTabData(tab);
      }
    },
    [connectionState, loadTabData],
  );

  // ── Auto-refresh polling ─────────────────────────

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (connectionState === "connected" && isOpen) {
      pollRef.current = setInterval(() => {
        if (mountedRef.current) refresh();
      }, 30000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connectionState, isOpen, refresh]);

  // ── Load initial data on connection ──────────────

  useEffect(() => {
    if (connectionState === "connected") {
      loadTabData(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  // ── Power Actions ────────────────────────────────

  const executePowerAction = useCallback(
    async (action: PowerAction) => {
      await tryInvoke<string | null>("idrac_power_action", { action });
      // Refresh power state after action
      const state = await tryInvoke<string>("idrac_get_power_state");
      safe(() => setPowerState(state));
    },
    [tryInvoke, safe],
  );

  // ── Storage Actions ──────────────────────────────

  const createVirtualDisk = useCallback(
    async (params: CreateVirtualDiskParams) => {
      const jobId = await tryInvoke<string | null>("idrac_create_virtual_disk", { params });
      await loadStorage();
      return jobId;
    },
    [tryInvoke, loadStorage],
  );

  const deleteVirtualDisk = useCallback(
    async (id: string) => {
      await tryInvoke<void>("idrac_delete_virtual_disk", { id });
      await loadStorage();
    },
    [tryInvoke, loadStorage],
  );

  // ── Firmware Actions ─────────────────────────────

  const updateFirmware = useCallback(
    async (params: FirmwareUpdateParams) => {
      const jobId = await tryInvoke<string | null>("idrac_update_firmware", { params });
      await loadFirmware();
      return jobId;
    },
    [tryInvoke, loadFirmware],
  );

  // ── Virtual Media Actions ────────────────────────

  const mountVirtualMedia = useCallback(
    async (params: VirtualMediaMountParams) => {
      await tryInvoke<void>("idrac_mount_virtual_media", { params });
      await loadVirtualMedia();
    },
    [tryInvoke, loadVirtualMedia],
  );

  const unmountVirtualMedia = useCallback(
    async (id: string) => {
      await tryInvoke<void>("idrac_unmount_virtual_media", { id });
      await loadVirtualMedia();
    },
    [tryInvoke, loadVirtualMedia],
  );

  // ── User Actions ─────────────────────────────────

  const createOrUpdateUser = useCallback(
    async (slotId: string, params: IdracUserParams) => {
      await tryInvoke<void>("idrac_create_or_update_user", { slotId, params });
      await loadUsers();
    },
    [tryInvoke, loadUsers],
  );

  const deleteUser = useCallback(
    async (slotId: string) => {
      await tryInvoke<void>("idrac_delete_user", { slotId });
      await loadUsers();
    },
    [tryInvoke, loadUsers],
  );

  // ── BIOS Actions ─────────────────────────────────

  const updateBiosAttributes = useCallback(
    async (attrs: Record<string, unknown>) => {
      const jobId = await tryInvoke<string | null>("idrac_set_bios_attributes", { attributes: attrs });
      await loadBios();
      return jobId;
    },
    [tryInvoke, loadBios],
  );

  const setBootOrder = useCallback(
    async (order: string[]) => {
      await tryInvoke<void>("idrac_set_boot_order", { order });
      await loadBios();
    },
    [tryInvoke, loadBios],
  );

  const setBootOnce = useCallback(
    async (target: string) => {
      await tryInvoke<void>("idrac_set_boot_once", { target });
    },
    [tryInvoke],
  );

  const setBootMode = useCallback(
    async (mode: string) => {
      await tryInvoke<void>("idrac_set_boot_mode", { mode });
      await loadBios();
    },
    [tryInvoke, loadBios],
  );

  // ── Certificate Actions ──────────────────────────

  const generateCsr = useCallback(
    async (params: CsrParams) => {
      return tryInvoke<string>("idrac_generate_csr", { params });
    },
    [tryInvoke],
  );

  const importCertificate = useCallback(
    async (certType: string, certData: string) => {
      await tryInvoke<void>("idrac_import_certificate", { certType, certData });
      await loadCertificates();
    },
    [tryInvoke, loadCertificates],
  );

  // ── Lifecycle Actions ─────────────────────────────

  const exportScp = useCallback(
    async (params: ScpExportParams) => {
      return tryInvoke<string>("idrac_export_scp", { params });
    },
    [tryInvoke],
  );

  const importScp = useCallback(
    async (params: ScpImportParams) => {
      return tryInvoke<string>("idrac_import_scp", { params });
    },
    [tryInvoke],
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      await tryInvoke<void>("idrac_delete_job", { jobId });
      await loadLifecycle();
    },
    [tryInvoke, loadLifecycle],
  );

  const purgeJobQueue = useCallback(async () => {
    await tryInvoke<void>("idrac_purge_job_queue");
    await loadLifecycle();
  }, [tryInvoke, loadLifecycle]);

  // ── Event Log Actions ────────────────────────────

  const clearSel = useCallback(async () => {
    await tryInvoke<void>("idrac_clear_sel");
    await loadEventLog();
  }, [tryInvoke, loadEventLog]);

  const clearLcLog = useCallback(async () => {
    await tryInvoke<void>("idrac_clear_lc_log");
    await loadEventLog();
  }, [tryInvoke, loadEventLog]);

  // ── RACADM ───────────────────────────────────────

  const racadmExecute = useCallback(
    async (command: string) => {
      const result = await tryInvoke<RacadmResult>("idrac_racadm_execute", { command });
      safe(() => setRacadmOutput(result));
      return result;
    },
    [tryInvoke, safe],
  );

  const resetIdrac = useCallback(async () => {
    await tryInvoke<void>("idrac_reset");
  }, [tryInvoke]);

  // ── Confirm dialog helpers ───────────────────────

  const requestConfirm = useCallback(
    (title: string, message: string, action: () => Promise<void>) => {
      setConfirmTitle(title);
      setConfirmMessage(message);
      setConfirmAction(() => action);
      setShowConfirmAction(true);
    },
    [],
  );

  const executeConfirm = useCallback(async () => {
    if (confirmAction) {
      await confirmAction();
    }
    setShowConfirmAction(false);
    setConfirmAction(null);
  }, [confirmAction]);

  const cancelConfirm = useCallback(() => {
    setShowConfirmAction(false);
    setConfirmAction(null);
  }, []);

  // ── Return ───────────────────────────────────────

  return {
    // Connection form
    connectionState,
    host,
    port,
    username,
    password,
    insecure,
    forceProtocol,
    connectionError,
    config,
    setHost,
    setPort,
    setUsername,
    setPassword,
    setInsecure,
    setForceProtocol,
    connect,
    disconnect,
    checkSession,

    // Navigation
    activeTab,
    changeTab,

    // Data
    dashboard,
    systemInfo,
    idracInfo,
    powerState,
    powerMetrics,
    powerSupplies,
    thermalData,
    thermalSummary,
    processors,
    memory,
    pcieDevices,
    storageControllers,
    virtualDisks,
    physicalDisks,
    enclosures,
    networkAdapters,
    networkConfig,
    firmware,
    jobs,
    lcStatus,
    virtualMedia,
    consoleInfo,
    selEntries,
    lcLogEntries,
    users,
    ldapConfig,
    adConfig,
    biosAttributes,
    bootConfig,
    certificates,
    healthRollup,
    powerTelemetry,
    thermalTelemetry,
    telemetryReports,
    racadmOutput,

    // Loading / error
    loading,
    dataError,
    refreshing,

    // Actions
    refresh,
    executePowerAction,
    createVirtualDisk,
    deleteVirtualDisk,
    updateFirmware,
    mountVirtualMedia,
    unmountVirtualMedia,
    createOrUpdateUser,
    deleteUser,
    updateBiosAttributes,
    setBootOrder,
    setBootOnce,
    setBootMode,
    generateCsr,
    importCertificate,
    exportScp,
    importScp,
    deleteJob,
    purgeJobQueue,
    clearSel,
    clearLcLog,
    racadmExecute,
    resetIdrac,

    // Confirm dialogs
    showConfirmAction,
    confirmTitle,
    confirmMessage,
    requestConfirm,
    executeConfirm,
    cancelConfirm,

    // Search
    searchQuery,
    setSearchQuery,
  };
}
