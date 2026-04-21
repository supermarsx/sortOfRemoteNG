import { useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SynologyConfigSafe,
  DsmInfo,
  SystemUtilization,
  ProcessInfo,
  StorageOverview,
  DiskInfo,
  VolumeInfo,
  SmartInfo,
  IscsiLun,
  IscsiTarget,
  FileStationInfo,
  FileListResult,
  ShareLinkInfo,
  SharedFolder,
  SharePermission,
  NetworkOverview,
  NetworkInterface,
  FirewallRule,
  DhcpLease,
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
  VmSnapshot,
  DownloadStationInfo,
  DownloadTask,
  DownloadStationStats,
  SurveillanceInfo,
  Camera,
  Recording,
  BackupTaskInfo,
  BackupVersion,
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
} from "../../types/hardware/synology";

export function useSynology() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<SynologyConfigSafe | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wrap = useCallback(
    <T>(fn: () => Promise<T>) =>
      async (): Promise<T | null> => {
        setLoading(true);
        setError(null);
        try {
          const result = await fn();
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          return null;
        } finally {
          setLoading(false);
        }
      },
    [],
  );

  // ─── Connection ──────────────────────────────────────────────

  const connect = useCallback(
    async (
      host: string,
      port: number,
      username: string,
      password: string,
      useHttps: boolean,
      insecure: boolean,
      otpCode?: string,
      accessToken?: string,
    ): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        const message = await invoke<string>("syn_connect", {
          host,
          port,
          username,
          password,
          useHttps,
          insecure,
          otpCode: otpCode ?? null,
          accessToken: accessToken ?? null,
        });
        setConnected(true);
        const cfg = await invoke<SynologyConfigSafe | null>("syn_get_config");
        setConfig(cfg);
        return message;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setConnected(false);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("syn_disconnect");
      setConnected(false);
      setConfig(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkSession = useMemo(
    () => wrap(() => invoke<boolean>("syn_check_session")),
    [wrap],
  );

  // ─── System ──────────────────────────────────────────────────

  const getSystemInfo = useMemo(
    () => wrap(() => invoke<DsmInfo>("syn_get_system_info")),
    [wrap],
  );

  const getUtilization = useMemo(
    () => wrap(() => invoke<SystemUtilization>("syn_get_utilization")),
    [wrap],
  );

  const listProcesses = useMemo(
    () => wrap(() => invoke<ProcessInfo[]>("syn_list_processes")),
    [wrap],
  );

  const reboot = useMemo(
    () => wrap(() => invoke<void>("syn_reboot")),
    [wrap],
  );

  const shutdown = useMemo(
    () => wrap(() => invoke<void>("syn_shutdown")),
    [wrap],
  );

  const checkUpdate = useMemo(
    () => wrap(() => invoke<unknown>("syn_check_update")),
    [wrap],
  );

  // ─── Storage ─────────────────────────────────────────────────

  const getStorageOverview = useMemo(
    () => wrap(() => invoke<StorageOverview>("syn_get_storage_overview")),
    [wrap],
  );

  const listDisks = useMemo(
    () => wrap(() => invoke<DiskInfo[]>("syn_list_disks")),
    [wrap],
  );

  const listVolumes = useMemo(
    () => wrap(() => invoke<VolumeInfo[]>("syn_list_volumes")),
    [wrap],
  );

  const getSmartInfo = useCallback(
    (diskId: string) =>
      wrap(() => invoke<SmartInfo>("syn_get_smart_info", { diskId }))(),
    [wrap],
  );

  const listIscsiLuns = useMemo(
    () => wrap(() => invoke<IscsiLun[]>("syn_list_iscsi_luns")),
    [wrap],
  );

  const listIscsiTargets = useMemo(
    () => wrap(() => invoke<IscsiTarget[]>("syn_list_iscsi_targets")),
    [wrap],
  );

  // ─── File Station ────────────────────────────────────────────

  const getFileStationInfo = useMemo(
    () => wrap(() => invoke<FileStationInfo>("syn_get_file_station_info")),
    [wrap],
  );

  const listFiles = useCallback(
    (
      folderPath: string,
      offset: number,
      limit: number,
      sortBy: string,
      sortDirection: string,
    ) =>
      wrap(() =>
        invoke<FileListResult>("syn_list_files", {
          folderPath,
          offset,
          limit,
          sortBy,
          sortDirection,
        }),
      )(),
    [wrap],
  );

  const listFileSharedFolders = useMemo(
    () => wrap(() => invoke<FileListResult>("syn_list_file_shared_folders")),
    [wrap],
  );

  const searchFiles = useCallback(
    (folderPath: string, pattern: string) =>
      wrap(() =>
        invoke<unknown>("syn_search_files", { folderPath, pattern }),
      )(),
    [wrap],
  );

  const uploadFile = useCallback(
    (
      destFolder: string,
      fileName: string,
      content: number[],
      overwrite: boolean,
    ) =>
      wrap(() =>
        invoke<void>("syn_upload_file", {
          destFolder,
          fileName,
          content,
          overwrite,
        }),
      )(),
    [wrap],
  );

  const downloadFile = useCallback(
    (filePath: string) =>
      wrap(() => invoke<number[]>("syn_download_file", { filePath }))(),
    [wrap],
  );

  const createFolder = useCallback(
    (folderPath: string, name: string, forceParent: boolean) =>
      wrap(() =>
        invoke<unknown>("syn_create_folder", {
          folderPath,
          name,
          forceParent,
        }),
      )(),
    [wrap],
  );

  const deleteFiles = useCallback(
    (paths: string[], recursive: boolean) =>
      wrap(() => invoke<void>("syn_delete_files", { paths, recursive }))(),
    [wrap],
  );

  const renameFile = useCallback(
    (path: string, newName: string) =>
      wrap(() => invoke<unknown>("syn_rename_file", { path, newName }))(),
    [wrap],
  );

  const createShareLink = useCallback(
    (path: string, password?: string, expireDays?: number) =>
      wrap(() =>
        invoke<ShareLinkInfo>("syn_create_share_link", {
          path,
          password: password ?? null,
          expireDays: expireDays ?? null,
        }),
      )(),
    [wrap],
  );

  // ─── Shared Folders ──────────────────────────────────────────

  const listSharedFolders = useMemo(
    () => wrap(() => invoke<SharedFolder[]>("syn_list_shared_folders")),
    [wrap],
  );

  const getSharePermissions = useCallback(
    (name: string) =>
      wrap(() =>
        invoke<SharePermission[]>("syn_get_share_permissions", { name }),
      )(),
    [wrap],
  );

  const createSharedFolder = useCallback(
    (name: string, volPath: string, desc: string) =>
      wrap(() =>
        invoke<void>("syn_create_shared_folder", { name, volPath, desc }),
      )(),
    [wrap],
  );

  const deleteSharedFolder = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_delete_shared_folder", { name }))(),
    [wrap],
  );

  const mountEncryptedShare = useCallback(
    (name: string, password: string) =>
      wrap(() =>
        invoke<void>("syn_mount_encrypted_share", { name, password }),
      )(),
    [wrap],
  );

  const unmountEncryptedShare = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_unmount_encrypted_share", { name }))(),
    [wrap],
  );

  // ─── Network ─────────────────────────────────────────────────

  const getNetworkOverview = useMemo(
    () => wrap(() => invoke<NetworkOverview>("syn_get_network_overview")),
    [wrap],
  );

  const listNetworkInterfaces = useMemo(
    () => wrap(() => invoke<NetworkInterface[]>("syn_list_network_interfaces")),
    [wrap],
  );

  const listFirewallRules = useMemo(
    () => wrap(() => invoke<FirewallRule[]>("syn_list_firewall_rules")),
    [wrap],
  );

  const listDhcpLeases = useMemo(
    () => wrap(() => invoke<DhcpLease[]>("syn_list_dhcp_leases")),
    [wrap],
  );

  // ─── Users ───────────────────────────────────────────────────

  const listUsers = useMemo(
    () => wrap(() => invoke<SynoUser[]>("syn_list_users")),
    [wrap],
  );

  const createUser = useCallback(
    (
      name: string,
      password: string,
      description?: string,
      email?: string,
    ) =>
      wrap(() =>
        invoke<void>("syn_create_user", {
          name,
          password,
          description: description ?? null,
          email: email ?? null,
        }),
      )(),
    [wrap],
  );

  const deleteUser = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_delete_user", { name }))(),
    [wrap],
  );

  const listGroups = useMemo(
    () => wrap(() => invoke<SynoGroup[]>("syn_list_groups")),
    [wrap],
  );

  // ─── Packages ────────────────────────────────────────────────

  const listPackages = useMemo(
    () => wrap(() => invoke<PackageInfo[]>("syn_list_packages")),
    [wrap],
  );

  const startPackage = useCallback(
    (id: string) =>
      wrap(() => invoke<void>("syn_start_package", { id }))(),
    [wrap],
  );

  const stopPackage = useCallback(
    (id: string) =>
      wrap(() => invoke<void>("syn_stop_package", { id }))(),
    [wrap],
  );

  const installPackage = useCallback(
    (id: string, volume: string) =>
      wrap(() => invoke<void>("syn_install_package", { id, volume }))(),
    [wrap],
  );

  const uninstallPackage = useCallback(
    (id: string) =>
      wrap(() => invoke<void>("syn_uninstall_package", { id }))(),
    [wrap],
  );

  // ─── Services ────────────────────────────────────────────────

  const listServices = useMemo(
    () => wrap(() => invoke<ServiceStatus[]>("syn_list_services")),
    [wrap],
  );

  const getSmbConfig = useMemo(
    () => wrap(() => invoke<SmbConfig>("syn_get_smb_config")),
    [wrap],
  );

  const getNfsConfig = useMemo(
    () => wrap(() => invoke<NfsConfig>("syn_get_nfs_config")),
    [wrap],
  );

  const getSshConfig = useMemo(
    () => wrap(() => invoke<SshConfig>("syn_get_ssh_config")),
    [wrap],
  );

  const setSshEnabled = useCallback(
    (enabled: boolean) =>
      wrap(() => invoke<void>("syn_set_ssh_enabled", { enabled }))(),
    [wrap],
  );

  // ─── Docker ──────────────────────────────────────────────────

  const listDockerContainers = useMemo(
    () => wrap(() => invoke<DockerContainer[]>("syn_list_docker_containers")),
    [wrap],
  );

  const startDockerContainer = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_start_docker_container", { name }))(),
    [wrap],
  );

  const stopDockerContainer = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_stop_docker_container", { name }))(),
    [wrap],
  );

  const restartDockerContainer = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_restart_docker_container", { name }))(),
    [wrap],
  );

  const deleteDockerContainer = useCallback(
    (name: string, force: boolean) =>
      wrap(() =>
        invoke<void>("syn_delete_docker_container", { name, force }),
      )(),
    [wrap],
  );

  const listDockerImages = useMemo(
    () => wrap(() => invoke<DockerImage[]>("syn_list_docker_images")),
    [wrap],
  );

  const pullDockerImage = useCallback(
    (repository: string, tag: string) =>
      wrap(() =>
        invoke<void>("syn_pull_docker_image", { repository, tag }),
      )(),
    [wrap],
  );

  const listDockerNetworks = useMemo(
    () => wrap(() => invoke<DockerNetwork[]>("syn_list_docker_networks")),
    [wrap],
  );

  const listDockerProjects = useMemo(
    () => wrap(() => invoke<DockerProject[]>("syn_list_docker_projects")),
    [wrap],
  );

  const startDockerProject = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_start_docker_project", { name }))(),
    [wrap],
  );

  const stopDockerProject = useCallback(
    (name: string) =>
      wrap(() => invoke<void>("syn_stop_docker_project", { name }))(),
    [wrap],
  );

  // ─── VMs ─────────────────────────────────────────────────────

  const listVms = useMemo(
    () => wrap(() => invoke<VmGuest[]>("syn_list_vms")),
    [wrap],
  );

  const vmPowerOn = useCallback(
    (guestId: string) =>
      wrap(() => invoke<void>("syn_vm_power_on", { guestId }))(),
    [wrap],
  );

  const vmShutdown = useCallback(
    (guestId: string) =>
      wrap(() => invoke<void>("syn_vm_shutdown", { guestId }))(),
    [wrap],
  );

  const vmForceShutdown = useCallback(
    (guestId: string) =>
      wrap(() => invoke<void>("syn_vm_force_shutdown", { guestId }))(),
    [wrap],
  );

  const listVmSnapshots = useCallback(
    (guestId: string) =>
      wrap(() =>
        invoke<VmSnapshot[]>("syn_list_vm_snapshots", { guestId }),
      )(),
    [wrap],
  );

  const takeVmSnapshot = useCallback(
    (guestId: string, description: string) =>
      wrap(() =>
        invoke<void>("syn_take_vm_snapshot", { guestId, description }),
      )(),
    [wrap],
  );

  // ─── Download Station ────────────────────────────────────────

  const getDownloadStationInfo = useMemo(
    () => wrap(() =>
      invoke<DownloadStationInfo>("syn_get_download_station_info"),
    ),
    [wrap],
  );

  const listDownloadTasks = useMemo(
    () => wrap(() => invoke<DownloadTask[]>("syn_list_download_tasks")),
    [wrap],
  );

  const createDownloadTask = useCallback(
    (uri: string, destination?: string) =>
      wrap(() =>
        invoke<void>("syn_create_download_task", {
          uri,
          destination: destination ?? null,
        }),
      )(),
    [wrap],
  );

  const pauseDownload = useCallback(
    (taskId: string) =>
      wrap(() => invoke<void>("syn_pause_download", { taskId }))(),
    [wrap],
  );

  const resumeDownload = useCallback(
    (taskId: string) =>
      wrap(() => invoke<void>("syn_resume_download", { taskId }))(),
    [wrap],
  );

  const deleteDownload = useCallback(
    (taskId: string, force: boolean) =>
      wrap(() =>
        invoke<void>("syn_delete_download", { taskId, force }),
      )(),
    [wrap],
  );

  const getDownloadStats = useMemo(
    () => wrap(() => invoke<DownloadStationStats>("syn_get_download_stats")),
    [wrap],
  );

  // ─── Surveillance ────────────────────────────────────────────

  const getSurveillanceInfo = useMemo(
    () => wrap(() => invoke<SurveillanceInfo>("syn_get_surveillance_info")),
    [wrap],
  );

  const listCameras = useMemo(
    () => wrap(() => invoke<Camera[]>("syn_list_cameras")),
    [wrap],
  );

  const getCameraSnapshot = useCallback(
    (camId: string) =>
      wrap(() => invoke<number[]>("syn_get_camera_snapshot", { camId }))(),
    [wrap],
  );

  const listRecordings = useCallback(
    (camId: string, offset: number, limit: number) =>
      wrap(() =>
        invoke<Recording[]>("syn_list_recordings", {
          camId,
          offset,
          limit,
        }),
      )(),
    [wrap],
  );

  // ─── Backup ──────────────────────────────────────────────────

  const listBackupTasks = useMemo(
    () => wrap(() => invoke<BackupTaskInfo[]>("syn_list_backup_tasks")),
    [wrap],
  );

  const startBackupTask = useCallback(
    (taskId: string) =>
      wrap(() => invoke<void>("syn_start_backup_task", { taskId }))(),
    [wrap],
  );

  const cancelBackupTask = useCallback(
    (taskId: string) =>
      wrap(() => invoke<void>("syn_cancel_backup_task", { taskId }))(),
    [wrap],
  );

  const listBackupVersions = useCallback(
    (taskId: string) =>
      wrap(() =>
        invoke<BackupVersion[]>("syn_list_backup_versions", { taskId }),
      )(),
    [wrap],
  );

  const listActiveBackupDevices = useMemo(
    () => wrap(() =>
      invoke<ActiveBackupDevice[]>("syn_list_active_backup_devices"),
    ),
    [wrap],
  );

  // ─── Security ────────────────────────────────────────────────

  const getSecurityOverview = useMemo(
    () => wrap(() => invoke<SecurityOverview>("syn_get_security_overview")),
    [wrap],
  );

  const listBlockedIps = useMemo(
    () => wrap(() => invoke<BlockedIp[]>("syn_list_blocked_ips")),
    [wrap],
  );

  const unblockIp = useCallback(
    (ip: string) =>
      wrap(() => invoke<void>("syn_unblock_ip", { ip }))(),
    [wrap],
  );

  const listCertificates = useMemo(
    () => wrap(() => invoke<CertificateInfo[]>("syn_list_certificates")),
    [wrap],
  );

  const getAutoBlockConfig = useMemo(
    () => wrap(() => invoke<AutoBlockConfig>("syn_get_auto_block_config")),
    [wrap],
  );

  // ─── Hardware ────────────────────────────────────────────────

  const getHardwareInfo = useMemo(
    () => wrap(() => invoke<HardwareInfo>("syn_get_hardware_info")),
    [wrap],
  );

  const getUpsInfo = useMemo(
    () => wrap(() => invoke<UpsInfo>("syn_get_ups_info")),
    [wrap],
  );

  const getPowerSchedule = useMemo(
    () => wrap(() => invoke<PowerSchedule>("syn_get_power_schedule")),
    [wrap],
  );

  // ─── Logs ────────────────────────────────────────────────────

  const getSystemLogs = useCallback(
    (offset: number, limit: number) =>
      wrap(() =>
        invoke<LogEntry[]>("syn_get_system_logs", { offset, limit }),
      )(),
    [wrap],
  );

  const getConnectionLogs = useCallback(
    (offset: number, limit: number) =>
      wrap(() =>
        invoke<ConnectionEntry[]>("syn_get_connection_logs", {
          offset,
          limit,
        }),
      )(),
    [wrap],
  );

  const getActiveConnections = useMemo(
    () => wrap(() => invoke<ConnectionEntry[]>("syn_get_active_connections")),
    [wrap],
  );

  // ─── Notifications ───────────────────────────────────────────

  const getNotificationConfig = useMemo(
    () => wrap(() => invoke<NotificationConfig>("syn_get_notification_config")),
    [wrap],
  );

  const testEmailNotification = useMemo(
    () => wrap(() => invoke<void>("syn_test_email_notification")),
    [wrap],
  );

  // ─── Dashboard ───────────────────────────────────────────────

  const getDashboard = useMemo(
    () => wrap(() => invoke<SynologyDashboard>("syn_get_dashboard")),
    [wrap],
  );

  // ─── Auto refresh ────────────────────────────────────────────

  const startAutoRefresh = useCallback(
    (intervalMs: number, callback: () => void) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(callback, intervalMs);
    },
    [],
  );

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return {
    // State
    connected,
    loading,
    error,
    config,
    // Connection
    connect,
    disconnect,
    checkSession,
    // System
    getSystemInfo,
    getUtilization,
    listProcesses,
    reboot,
    shutdown,
    checkUpdate,
    // Storage
    getStorageOverview,
    listDisks,
    listVolumes,
    getSmartInfo,
    listIscsiLuns,
    listIscsiTargets,
    // File Station
    getFileStationInfo,
    listFiles,
    listFileSharedFolders,
    searchFiles,
    uploadFile,
    downloadFile,
    createFolder,
    deleteFiles,
    renameFile,
    createShareLink,
    // Shared Folders
    listSharedFolders,
    getSharePermissions,
    createSharedFolder,
    deleteSharedFolder,
    mountEncryptedShare,
    unmountEncryptedShare,
    // Network
    getNetworkOverview,
    listNetworkInterfaces,
    listFirewallRules,
    listDhcpLeases,
    // Users
    listUsers,
    createUser,
    deleteUser,
    listGroups,
    // Packages
    listPackages,
    startPackage,
    stopPackage,
    installPackage,
    uninstallPackage,
    // Services
    listServices,
    getSmbConfig,
    getNfsConfig,
    getSshConfig,
    setSshEnabled,
    // Docker
    listDockerContainers,
    startDockerContainer,
    stopDockerContainer,
    restartDockerContainer,
    deleteDockerContainer,
    listDockerImages,
    pullDockerImage,
    listDockerNetworks,
    listDockerProjects,
    startDockerProject,
    stopDockerProject,
    // VMs
    listVms,
    vmPowerOn,
    vmShutdown,
    vmForceShutdown,
    listVmSnapshots,
    takeVmSnapshot,
    // Download Station
    getDownloadStationInfo,
    listDownloadTasks,
    createDownloadTask,
    pauseDownload,
    resumeDownload,
    deleteDownload,
    getDownloadStats,
    // Surveillance
    getSurveillanceInfo,
    listCameras,
    getCameraSnapshot,
    listRecordings,
    // Backup
    listBackupTasks,
    startBackupTask,
    cancelBackupTask,
    listBackupVersions,
    listActiveBackupDevices,
    // Security
    getSecurityOverview,
    listBlockedIps,
    unblockIp,
    listCertificates,
    getAutoBlockConfig,
    // Hardware
    getHardwareInfo,
    getUpsInfo,
    getPowerSchedule,
    // Logs
    getSystemLogs,
    getConnectionLogs,
    getActiveConnections,
    // Notifications
    getNotificationConfig,
    testEmailNotification,
    // Dashboard
    getDashboard,
    // Auto refresh
    startAutoRefresh,
    stopAutoRefresh,
  };
}
