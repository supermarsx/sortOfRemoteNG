import type * as S from "../../types/hardware/synology";

export interface SynologyAdminData {
  dashboard: S.SynologyDashboard | null;
  systemInfo: S.DsmInfo | null;
  utilization: S.SystemUtilization | null;
  storageOverview: S.StorageOverview | null;
  disks: S.DiskInfo[];
  volumes: S.VolumeInfo[];
  selectedDiskSmart: S.SmartInfo | null;
  sharedFolders: S.SharedFolder[];
  networkOverview: S.NetworkOverview | null;
  networkInterfaces: S.NetworkInterface[];
  firewallRules: S.FirewallRule[];
  users: S.SynoUser[];
  groups: S.SynoGroup[];
  packages: S.PackageInfo[];
  services: S.ServiceStatus[];
  smbConfig: S.SmbConfig | null;
  nfsConfig: S.NfsConfig | null;
  sshConfig: S.SshConfig | null;
  dockerContainers: S.DockerContainer[];
  dockerImages: S.DockerImage[];
  dockerNetworks: S.DockerNetwork[];
  dockerProjects: S.DockerProject[];
  vms: S.VmGuest[];
  downloadTasks: S.DownloadTask[];
  downloadStats: S.DownloadStationStats | null;
  cameras: S.Camera[];
  backupTasks: S.BackupTaskInfo[];
  activeBackupDevices: S.ActiveBackupDevice[];
  securityOverview: S.SecurityOverview | null;
  blockedIps: S.BlockedIp[];
  certificates: S.CertificateInfo[];
  autoBlockConfig: S.AutoBlockConfig | null;
  hardwareInfo: S.HardwareInfo | null;
  upsInfo: S.UpsInfo | null;
  powerSchedule: S.PowerSchedule | null;
  systemLogs: S.LogEntry[];
  connectionLogs: S.ConnectionEntry[];
  notificationConfig: S.NotificationConfig | null;
}
export const emptyAdminData = (): SynologyAdminData => ({
  dashboard: null,
  systemInfo: null,
  utilization: null,
  storageOverview: null,
  disks: [],
  volumes: [],
  selectedDiskSmart: null,
  sharedFolders: [],
  networkOverview: null,
  networkInterfaces: [],
  firewallRules: [],
  users: [],
  groups: [],
  packages: [],
  services: [],
  smbConfig: null,
  nfsConfig: null,
  sshConfig: null,
  dockerContainers: [],
  dockerImages: [],
  dockerNetworks: [],
  dockerProjects: [],
  vms: [],
  downloadTasks: [],
  downloadStats: null,
  cameras: [],
  backupTasks: [],
  activeBackupDevices: [],
  securityOverview: null,
  blockedIps: [],
  certificates: [],
  autoBlockConfig: null,
  hardwareInfo: null,
  upsInfo: null,
  powerSchedule: null,
  systemLogs: [],
  connectionLogs: [],
  notificationConfig: null,
});
export const ADMIN_READS = {
  dashboard: { dashboard: "syn_get_dashboard" },
  system: {
    systemInfo: "syn_get_system_info",
    utilization: "syn_get_utilization",
  },
  storage: {
    storageOverview: "syn_get_storage_overview",
    disks: "syn_list_disks",
    volumes: "syn_list_volumes",
  },
  shares: { sharedFolders: "syn_list_shared_folders" },
  network: {
    networkOverview: "syn_get_network_overview",
    networkInterfaces: "syn_list_network_interfaces",
    firewallRules: "syn_list_firewall_rules",
  },
  users: { users: "syn_list_users", groups: "syn_list_groups" },
  packages: { packages: "syn_list_packages" },
  services: {
    services: "syn_list_services",
    smbConfig: "syn_get_smb_config",
    nfsConfig: "syn_get_nfs_config",
    sshConfig: "syn_get_ssh_config",
  },
  docker: {
    dockerContainers: "syn_list_docker_containers",
    dockerImages: "syn_list_docker_images",
    dockerNetworks: "syn_list_docker_networks",
    dockerProjects: "syn_list_docker_projects",
  },
  vms: { vms: "syn_list_vms" },
  downloads: {
    downloadTasks: "syn_list_download_tasks",
    downloadStats: "syn_get_download_stats",
  },
  surveillance: { cameras: "syn_list_cameras" },
  backup: {
    backupTasks: "syn_list_backup_tasks",
    activeBackupDevices: "syn_list_active_backup_devices",
  },
  security: {
    securityOverview: "syn_get_security_overview",
    blockedIps: "syn_list_blocked_ips",
    certificates: "syn_list_certificates",
    autoBlockConfig: "syn_get_auto_block_config",
  },
  hardware: {
    hardwareInfo: "syn_get_hardware_info",
    upsInfo: "syn_get_ups_info",
    powerSchedule: "syn_get_power_schedule",
  },
  logs: {
    systemLogs: "syn_get_system_logs",
    connectionLogs: "syn_get_connection_logs",
  },
  notifications: { notificationConfig: "syn_get_notification_config" },
} as const;
export type SynologyTab = keyof typeof ADMIN_READS | "fileStation";
