import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  DsmInfo,
  SystemUtilization,
  StorageOverview,
  DiskInfo,
  VolumeInfo,
  SmartInfo,
  SharedFolder,
  NetworkOverview,
  NetworkInterface,
  FirewallRule,
  SynoUser,
  SynoGroup,
  PackageInfo,
  ServiceStatus,
  SmbConfig,
  NfsConfig,
  SshConfig,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerProject,
  VmGuest,
  DownloadTask,
  DownloadStationStats,
  Camera,
  BackupTaskInfo,
  ActiveBackupDevice,
  SecurityOverview,
  BlockedIp,
  CertificateInfo,
  AutoBlockConfig,
  HardwareInfo,
  UpsInfo,
  PowerSchedule,
  LogEntry,
  ConnectionEntry,
  NotificationConfig,
  SynologyDashboard,
  FileListResult,
} from "../../types/synology";

export type SynologyTab =
  | "dashboard"
  | "system"
  | "storage"
  | "fileStation"
  | "shares"
  | "network"
  | "users"
  | "packages"
  | "services"
  | "docker"
  | "vms"
  | "downloads"
  | "surveillance"
  | "backup"
  | "security"
  | "hardware"
  | "logs"
  | "notifications";

type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export function useSynologyManager(isOpen: boolean) {
  const mountedRef = useRef(true);

  // ─── Connection state ────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(
    null,
  );
  const [host, setHost] = useState("192.168.1.1");
  const [port, setPort] = useState(5001);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [useHttps, setUseHttps] = useState(true);
  const [insecure, setInsecure] = useState(true);
  const [otpCode, setOtpCode] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // ─── Tab state ───────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SynologyTab>("dashboard");
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  // ─── Confirm dialog ──────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const confirmActionRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Dashboard data ──────────────────────────────────────────
  const [dashboard, setDashboard] = useState<SynologyDashboard | null>(
    null,
  );

  // ─── System data ─────────────────────────────────────────────
  const [systemInfo, setSystemInfo] = useState<DsmInfo | null>(null);
  const [utilization, setUtilization] =
    useState<SystemUtilization | null>(null);

  // ─── Storage data ────────────────────────────────────────────
  const [storageOverview, setStorageOverview] =
    useState<StorageOverview | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [selectedDiskSmart, setSelectedDiskSmart] =
    useState<SmartInfo | null>(null);

  // ─── File Station data ───────────────────────────────────────
  const [fileList, setFileList] = useState<FileListResult | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [fileSearch, setFileSearch] = useState("");

  // ─── Shares data ─────────────────────────────────────────────
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([]);

  // ─── Network data ────────────────────────────────────────────
  const [networkOverview, setNetworkOverview] =
    useState<NetworkOverview | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([]);

  // ─── Users data ──────────────────────────────────────────────
  const [users, setUsers] = useState<SynoUser[]>([]);
  const [groups, setGroups] = useState<SynoGroup[]>([]);

  // ─── Packages data ───────────────────────────────────────────
  const [packages, setPackages] = useState<PackageInfo[]>([]);

  // ─── Services data ───────────────────────────────────────────
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [smbConfig, setSmbConfig] = useState<SmbConfig | null>(null);
  const [nfsConfig, setNfsConfig] = useState<NfsConfig | null>(null);
  const [sshConfig, setSshConfig] = useState<SshConfig | null>(null);

  // ─── Docker data ─────────────────────────────────────────────
  const [dockerContainers, setDockerContainers] = useState<
    DockerContainer[]
  >([]);
  const [dockerImages, setDockerImages] = useState<DockerImage[]>([]);
  const [dockerNetworks, setDockerNetworks] = useState<DockerNetwork[]>(
    [],
  );
  const [dockerProjects, setDockerProjects] = useState<DockerProject[]>(
    [],
  );

  // ─── VM data ─────────────────────────────────────────────────
  const [vms, setVms] = useState<VmGuest[]>([]);

  // ─── Download data ───────────────────────────────────────────
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [downloadStats, setDownloadStats] =
    useState<DownloadStationStats | null>(null);

  // ─── Surveillance data ───────────────────────────────────────
  const [cameras, setCameras] = useState<Camera[]>([]);

  // ─── Backup data ─────────────────────────────────────────────
  const [backupTasks, setBackupTasks] = useState<BackupTaskInfo[]>([]);
  const [activeBackupDevices, setActiveBackupDevices] = useState<
    ActiveBackupDevice[]
  >([]);

  // ─── Security data ───────────────────────────────────────────
  const [securityOverview, setSecurityOverview] =
    useState<SecurityOverview | null>(null);
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [certificates, setCertificates] = useState<CertificateInfo[]>([]);
  const [autoBlockConfig, setAutoBlockConfig] =
    useState<AutoBlockConfig | null>(null);

  // ─── Hardware data ───────────────────────────────────────────
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(
    null,
  );
  const [upsInfo, setUpsInfo] = useState<UpsInfo | null>(null);
  const [powerSchedule, setPowerSchedule] =
    useState<PowerSchedule | null>(null);

  // ─── Logs data ───────────────────────────────────────────────
  const [systemLogs, setSystemLogs] = useState<LogEntry[]>([]);
  const [connectionLogs, setConnectionLogs] = useState<ConnectionEntry[]>(
    [],
  );

  // ─── Notification data ───────────────────────────────────────
  const [notificationConfig, setNotificationConfig] =
    useState<NotificationConfig | null>(null);

  // ─── Helpers ─────────────────────────────────────────────────

  async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const result = await fn();
      if (!mountedRef.current) return null;
      return result;
    } catch (e) {
      if (!mountedRef.current) return null;
      const msg = e instanceof Error ? e.message : String(e);
      setDataError(msg);
      return null;
    }
  }

  // ─── Connection ──────────────────────────────────────────────

  const connect = useCallback(async () => {
    setConnectionStatus("connecting");
    setConnectionError(null);
    try {
      await invoke<string>("syn_connect", {
        host,
        port,
        username,
        password,
        useHttps,
        insecure,
        otpCode: otpCode || null,
        accessToken: accessToken || null,
      });
      if (!mountedRef.current) return;
      setConnectionStatus("connected");
      setActiveTab("dashboard");
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setConnectionError(msg);
      setConnectionStatus("error");
    }
  }, [
    host,
    port,
    username,
    password,
    useHttps,
    insecure,
    otpCode,
    accessToken,
  ]);

  const disconnect = useCallback(async () => {
    try {
      await invoke("syn_disconnect");
    } catch {
      // ignore
    }
    if (!mountedRef.current) return;
    setConnectionStatus("disconnected");
    setDashboard(null);
    setSystemInfo(null);
    setUtilization(null);
  }, []);

  // ─── Tab data loaders ────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() =>
      invoke<SynologyDashboard>("syn_get_dashboard"),
    );
    if (data && mountedRef.current) setDashboard(data);
    setDataLoading(false);
  }, []);

  const loadSystem = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [info, util] = await Promise.all([
      safe(() => invoke<DsmInfo>("syn_get_system_info")),
      safe(() => invoke<SystemUtilization>("syn_get_utilization")),
    ]);
    if (mountedRef.current) {
      if (info) setSystemInfo(info);
      if (util) setUtilization(util);
    }
    setDataLoading(false);
  }, []);

  const loadStorage = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [overview, diskList, volumeList] = await Promise.all([
      safe(() => invoke<StorageOverview>("syn_get_storage_overview")),
      safe(() => invoke<DiskInfo[]>("syn_list_disks")),
      safe(() => invoke<VolumeInfo[]>("syn_list_volumes")),
    ]);
    if (mountedRef.current) {
      if (overview) setStorageOverview(overview);
      if (diskList) setDisks(diskList);
      if (volumeList) setVolumes(volumeList);
    }
    setDataLoading(false);
  }, []);

  const loadFileStation = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() =>
      invoke<FileListResult>("syn_list_files", {
        folderPath: currentPath,
        offset: 0,
        limit: 200,
        sortBy: "name",
        sortDirection: "asc",
      }),
    );
    if (data && mountedRef.current) setFileList(data);
    setDataLoading(false);
  }, [currentPath]);

  const loadShares = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() =>
      invoke<SharedFolder[]>("syn_list_shared_folders"),
    );
    if (data && mountedRef.current) setSharedFolders(data);
    setDataLoading(false);
  }, []);

  const loadNetwork = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [overview, ifaces, fw] = await Promise.all([
      safe(() => invoke<NetworkOverview>("syn_get_network_overview")),
      safe(() =>
        invoke<NetworkInterface[]>("syn_list_network_interfaces"),
      ),
      safe(() => invoke<FirewallRule[]>("syn_list_firewall_rules")),
    ]);
    if (mountedRef.current) {
      if (overview) setNetworkOverview(overview);
      if (ifaces) setNetworkInterfaces(ifaces);
      if (fw) setFirewallRules(fw);
    }
    setDataLoading(false);
  }, []);

  const loadUsers = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [u, g] = await Promise.all([
      safe(() => invoke<SynoUser[]>("syn_list_users")),
      safe(() => invoke<SynoGroup[]>("syn_list_groups")),
    ]);
    if (mountedRef.current) {
      if (u) setUsers(u);
      if (g) setGroups(g);
    }
    setDataLoading(false);
  }, []);

  const loadPackages = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() =>
      invoke<PackageInfo[]>("syn_list_packages"),
    );
    if (data && mountedRef.current) setPackages(data);
    setDataLoading(false);
  }, []);

  const loadServices = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [svc, smb, nfs, ssh] = await Promise.all([
      safe(() => invoke<ServiceStatus[]>("syn_list_services")),
      safe(() => invoke<SmbConfig>("syn_get_smb_config")),
      safe(() => invoke<NfsConfig>("syn_get_nfs_config")),
      safe(() => invoke<SshConfig>("syn_get_ssh_config")),
    ]);
    if (mountedRef.current) {
      if (svc) setServices(svc);
      if (smb) setSmbConfig(smb);
      if (nfs) setNfsConfig(nfs);
      if (ssh) setSshConfig(ssh);
    }
    setDataLoading(false);
  }, []);

  const loadDocker = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [containers, images, networks, projects] = await Promise.all([
      safe(() =>
        invoke<DockerContainer[]>("syn_list_docker_containers"),
      ),
      safe(() => invoke<DockerImage[]>("syn_list_docker_images")),
      safe(() => invoke<DockerNetwork[]>("syn_list_docker_networks")),
      safe(() => invoke<DockerProject[]>("syn_list_docker_projects")),
    ]);
    if (mountedRef.current) {
      if (containers) setDockerContainers(containers);
      if (images) setDockerImages(images);
      if (networks) setDockerNetworks(networks);
      if (projects) setDockerProjects(projects);
    }
    setDataLoading(false);
  }, []);

  const loadVms = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() => invoke<VmGuest[]>("syn_list_vms"));
    if (data && mountedRef.current) setVms(data);
    setDataLoading(false);
  }, []);

  const loadDownloads = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [tasks, stats] = await Promise.all([
      safe(() => invoke<DownloadTask[]>("syn_list_download_tasks")),
      safe(() =>
        invoke<DownloadStationStats>("syn_get_download_stats"),
      ),
    ]);
    if (mountedRef.current) {
      if (tasks) setDownloadTasks(tasks);
      if (stats) setDownloadStats(stats);
    }
    setDataLoading(false);
  }, []);

  const loadSurveillance = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() => invoke<Camera[]>("syn_list_cameras"));
    if (data && mountedRef.current) setCameras(data);
    setDataLoading(false);
  }, []);

  const loadBackup = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [tasks, devices] = await Promise.all([
      safe(() => invoke<BackupTaskInfo[]>("syn_list_backup_tasks")),
      safe(() =>
        invoke<ActiveBackupDevice[]>("syn_list_active_backup_devices"),
      ),
    ]);
    if (mountedRef.current) {
      if (tasks) setBackupTasks(tasks);
      if (devices) setActiveBackupDevices(devices);
    }
    setDataLoading(false);
  }, []);

  const loadSecurity = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [overview, blocked, certs, autoBlock] = await Promise.all([
      safe(() =>
        invoke<SecurityOverview>("syn_get_security_overview"),
      ),
      safe(() => invoke<BlockedIp[]>("syn_list_blocked_ips")),
      safe(() => invoke<CertificateInfo[]>("syn_list_certificates")),
      safe(() =>
        invoke<AutoBlockConfig>("syn_get_auto_block_config"),
      ),
    ]);
    if (mountedRef.current) {
      if (overview) setSecurityOverview(overview);
      if (blocked) setBlockedIps(blocked);
      if (certs) setCertificates(certs);
      if (autoBlock) setAutoBlockConfig(autoBlock);
    }
    setDataLoading(false);
  }, []);

  const loadHardware = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [hw, ups, pwr] = await Promise.all([
      safe(() => invoke<HardwareInfo>("syn_get_hardware_info")),
      safe(() => invoke<UpsInfo>("syn_get_ups_info")),
      safe(() => invoke<PowerSchedule>("syn_get_power_schedule")),
    ]);
    if (mountedRef.current) {
      if (hw) setHardwareInfo(hw);
      if (ups) setUpsInfo(ups);
      if (pwr) setPowerSchedule(pwr);
    }
    setDataLoading(false);
  }, []);

  const loadLogs = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const [sys, conn] = await Promise.all([
      safe(() =>
        invoke<LogEntry[]>("syn_get_system_logs", {
          offset: 0,
          limit: 200,
        }),
      ),
      safe(() =>
        invoke<ConnectionEntry[]>("syn_get_connection_logs", {
          offset: 0,
          limit: 200,
        }),
      ),
    ]);
    if (mountedRef.current) {
      if (sys) setSystemLogs(sys);
      if (conn) setConnectionLogs(conn);
    }
    setDataLoading(false);
  }, []);

  const loadNotifications = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const data = await safe(() =>
      invoke<NotificationConfig>("syn_get_notification_config"),
    );
    if (data && mountedRef.current) setNotificationConfig(data);
    setDataLoading(false);
  }, []);

  // ─── Tab switch handler ──────────────────────────────────────

  const loadTabData = useCallback(
    (tab: SynologyTab) => {
      const loaders: Record<SynologyTab, () => Promise<void>> = {
        dashboard: loadDashboard,
        system: loadSystem,
        storage: loadStorage,
        fileStation: loadFileStation,
        shares: loadShares,
        network: loadNetwork,
        users: loadUsers,
        packages: loadPackages,
        services: loadServices,
        docker: loadDocker,
        vms: loadVms,
        downloads: loadDownloads,
        surveillance: loadSurveillance,
        backup: loadBackup,
        security: loadSecurity,
        hardware: loadHardware,
        logs: loadLogs,
        notifications: loadNotifications,
      };
      loaders[tab]?.();
    },
    [
      loadDashboard,
      loadSystem,
      loadStorage,
      loadFileStation,
      loadShares,
      loadNetwork,
      loadUsers,
      loadPackages,
      loadServices,
      loadDocker,
      loadVms,
      loadDownloads,
      loadSurveillance,
      loadBackup,
      loadSecurity,
      loadHardware,
      loadLogs,
      loadNotifications,
    ],
  );

  const changeTab = useCallback(
    (tab: SynologyTab) => {
      setActiveTab(tab);
      loadTabData(tab);
    },
    [loadTabData],
  );

  // ─── Actions (with confirm dialog support) ───────────────────

  const requestConfirm = useCallback(
    (title: string, message: string, action: () => Promise<void>) => {
      setConfirmTitle(title);
      setConfirmMessage(message);
      confirmActionRef.current = action;
      setConfirmOpen(true);
    },
    [],
  );

  const executeConfirm = useCallback(async () => {
    setConfirmOpen(false);
    if (confirmActionRef.current) {
      await confirmActionRef.current();
      confirmActionRef.current = null;
      loadTabData(activeTab);
    }
  }, [activeTab, loadTabData]);

  const cancelConfirm = useCallback(() => {
    setConfirmOpen(false);
    confirmActionRef.current = null;
  }, []);

  // ─── Quick actions ───────────────────────────────────────────

  const rebootNas = useCallback(() => {
    requestConfirm("Reboot NAS", "Are you sure you want to reboot the NAS?", async () => {
      await invoke("syn_reboot");
    });
  }, [requestConfirm]);

  const shutdownNas = useCallback(() => {
    requestConfirm("Shutdown NAS", "Are you sure you want to shut down the NAS?", async () => {
      await invoke("syn_shutdown");
    });
  }, [requestConfirm]);

  const startContainer = useCallback(
    async (name: string) => {
      await safe(() =>
        invoke<void>("syn_start_docker_container", { name }),
      );
      loadTabData("docker");
    },
    [loadTabData],
  );

  const stopContainer = useCallback(
    async (name: string) => {
      await safe(() =>
        invoke<void>("syn_stop_docker_container", { name }),
      );
      loadTabData("docker");
    },
    [loadTabData],
  );

  const restartContainer = useCallback(
    async (name: string) => {
      await safe(() =>
        invoke<void>("syn_restart_docker_container", { name }),
      );
      loadTabData("docker");
    },
    [loadTabData],
  );

  const startPackage = useCallback(
    async (id: string) => {
      await safe(() => invoke<void>("syn_start_package", { id }));
      loadTabData("packages");
    },
    [loadTabData],
  );

  const stopPackage = useCallback(
    async (id: string) => {
      await safe(() => invoke<void>("syn_stop_package", { id }));
      loadTabData("packages");
    },
    [loadTabData],
  );

  const unblockIp = useCallback(
    async (ip: string) => {
      await safe(() => invoke<void>("syn_unblock_ip", { ip }));
      loadTabData("security");
    },
    [loadTabData],
  );

  const loadSmartInfo = useCallback(
    async (diskId: string) => {
      const data = await safe(() =>
        invoke<SmartInfo>("syn_get_smart_info", { diskId }),
      );
      if (data && mountedRef.current) setSelectedDiskSmart(data);
    },
    [],
  );

  const navigateToFolder = useCallback(
    (path: string) => {
      setCurrentPath(path);
    },
    [],
  );

  // ─── Auto-refresh on open ────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isOpen && connectionStatus === "connected") {
      loadTabData(activeTab);
      const interval = setInterval(() => {
        if (mountedRef.current) loadTabData(activeTab);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [isOpen, connectionStatus, activeTab, loadTabData]);

  // Reload file station on path change
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      activeTab === "fileStation"
    ) {
      loadFileStation();
    }
  }, [currentPath, connectionStatus, activeTab, loadFileStation]);

  return {
    // Connection
    connectionStatus,
    connectionError,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    password,
    setPassword,
    useHttps,
    setUseHttps,
    insecure,
    setInsecure,
    otpCode,
    setOtpCode,
    accessToken,
    setAccessToken,
    connect,
    disconnect,

    // Tab navigation
    activeTab,
    changeTab,
    dataError,
    dataLoading,

    // Confirm dialog
    confirmOpen,
    confirmTitle,
    confirmMessage,
    executeConfirm,
    cancelConfirm,

    // Dashboard
    dashboard,

    // System
    systemInfo,
    utilization,

    // Storage
    storageOverview,
    disks,
    volumes,
    selectedDiskSmart,
    loadSmartInfo,

    // File Station
    fileList,
    currentPath,
    navigateToFolder,
    fileSearch,
    setFileSearch,

    // Shares
    sharedFolders,

    // Network
    networkOverview,
    networkInterfaces,
    firewallRules,

    // Users
    users,
    groups,

    // Packages
    packages,
    startPackage,
    stopPackage,

    // Services
    services,
    smbConfig,
    nfsConfig,
    sshConfig,

    // Docker
    dockerContainers,
    dockerImages,
    dockerNetworks,
    dockerProjects,
    startContainer,
    stopContainer,
    restartContainer,

    // VMs
    vms,

    // Downloads
    downloadTasks,
    downloadStats,

    // Surveillance
    cameras,

    // Backup
    backupTasks,
    activeBackupDevices,

    // Security
    securityOverview,
    blockedIps,
    certificates,
    autoBlockConfig,
    unblockIp,

    // Hardware
    hardwareInfo,
    upsInfo,
    powerSchedule,

    // Logs
    systemLogs,
    connectionLogs,

    // Notifications
    notificationConfig,

    // Actions
    rebootNas,
    shutdownNas,
    loadTabData,
  };
}
