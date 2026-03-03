/**
 * useProxmox — React hook for all Proxmox VE backend operations.
 *
 * Wraps every `proxmox_*` Tauri command with typed helpers,
 * loading/error state, and auto-refresh capabilities.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProxmoxConfigSafe,
  PveVersion,
  // Nodes
  NodeSummary,
  NodeStatus,
  NodeService,
  NodeDns,
  AptUpdate,
  SyslogEntry,
  // QEMU
  QemuVmSummary,
  QemuStatusCurrent,
  QemuConfig,
  QemuCreateParams,
  QemuCloneParams,
  QemuMigrateParams,
  DiskResizeParams,
  QemuAgentInfo,
  // LXC
  LxcSummary,
  LxcStatusCurrent,
  LxcConfig,
  LxcCreateParams,
  LxcCloneParams,
  LxcMigrateParams,
  // Storage
  StorageSummary,
  StorageContent,
  // Network
  NetworkInterface,
  CreateNetworkParams,
  // Cluster
  ClusterStatus,
  ClusterResource,
  // Tasks
  TaskSummary,
  TaskStatus,
  TaskLogLine,
  // Backups
  BackupJobConfig,
  VzdumpParams,
  // Firewall
  FirewallOptions,
  FirewallRule,
  FirewallSecurityGroup,
  FirewallAlias,
  FirewallIpSet,
  // Pools
  PoolSummary,
  PoolInfo,
  // HA
  HaResource,
  HaGroup,
  // Ceph
  CephStatus,
  CephPool,
  CephMonitor,
  // SDN
  SdnZone,
  SdnVnet,
  // Console
  VncTicket,
  SpiceTicket,
  TermProxyTicket,
  // Snapshots
  SnapshotSummary,
  CreateSnapshotParams,
  // Metrics
  RrdDataPoint,
  // Templates
  ApplianceTemplate,
  // Access
  PveUser,
  PveRole,
  PveGroup,
} from "../../types/proxmox";

// ── Types ────────────────────────────────────────────────────────

export interface UseProxmoxState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  config: ProxmoxConfigSafe | null;
  version: PveVersion | null;
}

export interface UseProxmoxReturn extends UseProxmoxState {
  // Connection
  connect: (params: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    tokenId?: string;
    tokenSecret?: string;
    insecure?: boolean;
    timeoutSecs?: number;
  }) => Promise<string>;
  disconnect: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  refreshConfig: () => Promise<void>;
  refreshVersion: () => Promise<void>;

  // Nodes
  listNodes: () => Promise<NodeSummary[]>;
  getNodeStatus: (node: string) => Promise<NodeStatus>;
  listNodeServices: (node: string) => Promise<NodeService[]>;
  startNodeService: (node: string, service: string) => Promise<string | null>;
  stopNodeService: (node: string, service: string) => Promise<string | null>;
  restartNodeService: (node: string, service: string) => Promise<string | null>;
  getNodeDns: (node: string) => Promise<NodeDns>;
  getNodeSyslog: (node: string, opts?: { start?: number; limit?: number; since?: string; until?: string; service?: string }) => Promise<SyslogEntry[]>;
  listAptUpdates: (node: string) => Promise<AptUpdate[]>;
  rebootNode: (node: string) => Promise<string | null>;
  shutdownNode: (node: string) => Promise<string | null>;

  // QEMU
  listQemuVms: (node: string) => Promise<QemuVmSummary[]>;
  getQemuStatus: (node: string, vmid: number) => Promise<QemuStatusCurrent>;
  getQemuConfig: (node: string, vmid: number) => Promise<QemuConfig>;
  createQemuVm: (node: string, params: QemuCreateParams) => Promise<string | null>;
  deleteQemuVm: (node: string, vmid: number, opts?: { purge?: boolean; destroyUnreferenced?: boolean }) => Promise<string | null>;
  startQemuVm: (node: string, vmid: number) => Promise<string | null>;
  stopQemuVm: (node: string, vmid: number) => Promise<string | null>;
  shutdownQemuVm: (node: string, vmid: number, opts?: { force?: boolean; timeout?: number }) => Promise<string | null>;
  rebootQemuVm: (node: string, vmid: number, timeout?: number) => Promise<string | null>;
  suspendQemuVm: (node: string, vmid: number, toDisk?: boolean) => Promise<string | null>;
  resumeQemuVm: (node: string, vmid: number) => Promise<string | null>;
  resetQemuVm: (node: string, vmid: number) => Promise<string | null>;
  resizeQemuDisk: (node: string, vmid: number, params: DiskResizeParams) => Promise<void>;
  cloneQemuVm: (node: string, vmid: number, params: QemuCloneParams) => Promise<string | null>;
  migrateQemuVm: (node: string, vmid: number, params: QemuMigrateParams) => Promise<string | null>;
  convertQemuToTemplate: (node: string, vmid: number) => Promise<void>;
  qemuAgentExec: (node: string, vmid: number, command: string) => Promise<unknown>;
  qemuAgentNetwork: (node: string, vmid: number) => Promise<QemuAgentInfo>;
  qemuAgentOsinfo: (node: string, vmid: number) => Promise<QemuAgentInfo>;
  getNextVmid: () => Promise<number>;

  // LXC
  listLxcContainers: (node: string) => Promise<LxcSummary[]>;
  getLxcStatus: (node: string, vmid: number) => Promise<LxcStatusCurrent>;
  getLxcConfig: (node: string, vmid: number) => Promise<LxcConfig>;
  createLxcContainer: (node: string, params: LxcCreateParams) => Promise<string | null>;
  deleteLxcContainer: (node: string, vmid: number, opts?: { purge?: boolean; force?: boolean }) => Promise<string | null>;
  startLxcContainer: (node: string, vmid: number) => Promise<string | null>;
  stopLxcContainer: (node: string, vmid: number) => Promise<string | null>;
  shutdownLxcContainer: (node: string, vmid: number, opts?: { force?: boolean; timeout?: number }) => Promise<string | null>;
  rebootLxcContainer: (node: string, vmid: number, timeout?: number) => Promise<string | null>;
  cloneLxcContainer: (node: string, vmid: number, params: LxcCloneParams) => Promise<string | null>;
  migrateLxcContainer: (node: string, vmid: number, params: LxcMigrateParams) => Promise<string | null>;

  // Storage
  listStorage: (node: string) => Promise<StorageSummary[]>;
  listStorageContent: (node: string, storage: string, opts?: { contentType?: string; vmid?: number }) => Promise<StorageContent[]>;
  deleteStorageVolume: (node: string, storage: string, volume: string) => Promise<string | null>;
  downloadToStorage: (node: string, storage: string, url: string, content: string, filename: string) => Promise<string>;

  // Network
  listNetworkInterfaces: (node: string) => Promise<NetworkInterface[]>;
  getNetworkInterface: (node: string, iface: string) => Promise<NetworkInterface>;
  createNetworkInterface: (node: string, params: CreateNetworkParams) => Promise<void>;
  deleteNetworkInterface: (node: string, iface: string) => Promise<string | null>;
  applyNetworkChanges: (node: string) => Promise<string | null>;
  revertNetworkChanges: (node: string) => Promise<string | null>;

  // Cluster
  getClusterStatus: () => Promise<ClusterStatus[]>;
  listClusterResources: (resourceType?: string) => Promise<ClusterResource[]>;
  getClusterNextId: () => Promise<number>;
  listUsers: () => Promise<PveUser[]>;
  listRoles: () => Promise<PveRole[]>;
  listGroups: () => Promise<PveGroup[]>;

  // Tasks
  listTasks: (node: string, opts?: { start?: number; limit?: number; vmid?: number; typeFilter?: string; statusFilter?: string }) => Promise<TaskSummary[]>;
  getTaskStatus: (node: string, upid: string) => Promise<TaskStatus>;
  getTaskLog: (node: string, upid: string, opts?: { start?: number; limit?: number }) => Promise<TaskLogLine[]>;
  stopTask: (node: string, upid: string) => Promise<void>;

  // Backups
  listBackupJobs: () => Promise<BackupJobConfig[]>;
  vzdump: (node: string, params: VzdumpParams) => Promise<string>;
  restoreBackup: (node: string, vmid: number, archive: string, opts?: { storage?: string; force?: boolean; unique?: boolean }) => Promise<string>;
  listBackups: (node: string, storage: string, vmid?: number) => Promise<StorageContent[]>;

  // Firewall
  getClusterFirewallOptions: () => Promise<FirewallOptions>;
  listClusterFirewallRules: () => Promise<FirewallRule[]>;
  listSecurityGroups: () => Promise<FirewallSecurityGroup[]>;
  listFirewallAliases: () => Promise<FirewallAlias[]>;
  listFirewallIpsets: () => Promise<FirewallIpSet[]>;
  listGuestFirewallRules: (node: string, guestType: string, vmid: number) => Promise<FirewallRule[]>;

  // Pools
  listPools: () => Promise<PoolSummary[]>;
  getPool: (poolid: string) => Promise<PoolInfo>;
  createPool: (poolid: string, comment?: string) => Promise<void>;
  deletePool: (poolid: string) => Promise<string | null>;

  // HA
  listHaResources: () => Promise<HaResource[]>;
  listHaGroups: () => Promise<HaGroup[]>;

  // Ceph
  getCephStatus: (node: string) => Promise<CephStatus>;
  listCephPools: (node: string) => Promise<CephPool[]>;
  listCephMonitors: (node: string) => Promise<CephMonitor[]>;
  listCephOsds: (node: string) => Promise<unknown>;

  // SDN
  listSdnZones: () => Promise<SdnZone[]>;
  listSdnVnets: () => Promise<SdnVnet[]>;

  // Console
  qemuVncProxy: (node: string, vmid: number) => Promise<VncTicket>;
  qemuSpiceProxy: (node: string, vmid: number) => Promise<SpiceTicket>;
  qemuTermproxy: (node: string, vmid: number) => Promise<TermProxyTicket>;
  lxcVncProxy: (node: string, vmid: number) => Promise<VncTicket>;
  lxcSpiceProxy: (node: string, vmid: number) => Promise<SpiceTicket>;
  lxcTermproxy: (node: string, vmid: number) => Promise<TermProxyTicket>;
  nodeTermproxy: (node: string) => Promise<TermProxyTicket>;

  // Snapshots
  listQemuSnapshots: (node: string, vmid: number) => Promise<SnapshotSummary[]>;
  createQemuSnapshot: (node: string, vmid: number, params: CreateSnapshotParams) => Promise<string | null>;
  rollbackQemuSnapshot: (node: string, vmid: number, snapname: string) => Promise<string | null>;
  deleteQemuSnapshot: (node: string, vmid: number, snapname: string, force?: boolean) => Promise<string | null>;
  listLxcSnapshots: (node: string, vmid: number) => Promise<SnapshotSummary[]>;
  createLxcSnapshot: (node: string, vmid: number, params: CreateSnapshotParams) => Promise<string | null>;
  rollbackLxcSnapshot: (node: string, vmid: number, snapname: string) => Promise<string | null>;
  deleteLxcSnapshot: (node: string, vmid: number, snapname: string, force?: boolean) => Promise<string | null>;

  // Metrics
  nodeRrd: (node: string, timeframe: string, cf?: string) => Promise<RrdDataPoint[]>;
  qemuRrd: (node: string, vmid: number, timeframe: string, cf?: string) => Promise<RrdDataPoint[]>;
  lxcRrd: (node: string, vmid: number, timeframe: string, cf?: string) => Promise<RrdDataPoint[]>;

  // Templates
  listApplianceTemplates: (node: string) => Promise<ApplianceTemplate[]>;
  downloadAppliance: (node: string, storage: string, template: string) => Promise<string>;
  listIsos: (node: string, storage: string) => Promise<StorageContent[]>;
  listContainerTemplates: (node: string, storage: string) => Promise<StorageContent[]>;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useProxmox(): UseProxmoxReturn {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ProxmoxConfigSafe | null>(null);
  const [version, setVersion] = useState<PveVersion | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Helper that wraps invoke + loading/error state. */
  const call = useCallback(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<T>(cmd, args);
      return result;
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setError(msg);
      throw new Error(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // ── Connection ──────────────────────────────────────────────────

  const connect = useCallback(async (params: {
    host: string; port?: number; username: string;
    password?: string; tokenId?: string; tokenSecret?: string;
    insecure?: boolean; timeoutSecs?: number;
  }): Promise<string> => {
    const res = await call<string>("proxmox_connect", {
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      tokenId: params.tokenId,
      tokenSecret: params.tokenSecret,
      insecure: params.insecure,
      timeoutSecs: params.timeoutSecs,
    });
    if (mountedRef.current) setConnected(true);
    return res;
  }, [call]);

  const disconnect = useCallback(async () => {
    await call<void>("proxmox_disconnect");
    if (mountedRef.current) {
      setConnected(false);
      setConfig(null);
      setVersion(null);
    }
  }, [call]);

  const checkSession = useCallback(async (): Promise<boolean> => {
    const ok = await call<boolean>("proxmox_check_session");
    if (mountedRef.current) setConnected(ok);
    return ok;
  }, [call]);

  const refreshConfig = useCallback(async () => {
    const cfg = await call<ProxmoxConfigSafe | null>("proxmox_get_config");
    if (mountedRef.current) setConfig(cfg);
  }, [call]);

  const refreshVersion = useCallback(async () => {
    const v = await call<PveVersion>("proxmox_get_version");
    if (mountedRef.current) setVersion(v);
  }, [call]);

  // ── Nodes ─────────────────────────────────────────────────────

  const listNodes = useCallback(() => call<NodeSummary[]>("proxmox_list_nodes"), [call]);
  const getNodeStatus = useCallback((node: string) => call<NodeStatus>("proxmox_get_node_status", { node }), [call]);
  const listNodeServices = useCallback((node: string) => call<NodeService[]>("proxmox_list_node_services", { node }), [call]);
  const startNodeService = useCallback((node: string, service: string) => call<string | null>("proxmox_start_node_service", { node, service }), [call]);
  const stopNodeService = useCallback((node: string, service: string) => call<string | null>("proxmox_stop_node_service", { node, service }), [call]);
  const restartNodeService = useCallback((node: string, service: string) => call<string | null>("proxmox_restart_node_service", { node, service }), [call]);
  const getNodeDns = useCallback((node: string) => call<NodeDns>("proxmox_get_node_dns", { node }), [call]);
  const getNodeSyslog = useCallback((node: string, opts?: { start?: number; limit?: number; since?: string; until?: string; service?: string }) =>
    call<SyslogEntry[]>("proxmox_get_node_syslog", { node, ...opts }), [call]);
  const listAptUpdates = useCallback((node: string) => call<AptUpdate[]>("proxmox_list_apt_updates", { node }), [call]);
  const rebootNode = useCallback((node: string) => call<string | null>("proxmox_reboot_node", { node }), [call]);
  const shutdownNode = useCallback((node: string) => call<string | null>("proxmox_shutdown_node", { node }), [call]);

  // ── QEMU ──────────────────────────────────────────────────────

  const listQemuVms = useCallback((node: string) => call<QemuVmSummary[]>("proxmox_list_qemu_vms", { node }), [call]);
  const getQemuStatus = useCallback((node: string, vmid: number) => call<QemuStatusCurrent>("proxmox_get_qemu_status", { node, vmid }), [call]);
  const getQemuConfig = useCallback((node: string, vmid: number) => call<QemuConfig>("proxmox_get_qemu_config", { node, vmid }), [call]);
  const createQemuVm = useCallback((node: string, params: QemuCreateParams) => call<string | null>("proxmox_create_qemu_vm", { node, params }), [call]);
  const deleteQemuVm = useCallback((node: string, vmid: number, opts?: { purge?: boolean; destroyUnreferenced?: boolean }) =>
    call<string | null>("proxmox_delete_qemu_vm", { node, vmid, purge: opts?.purge, destroyUnreferenced: opts?.destroyUnreferenced }), [call]);
  const startQemuVm = useCallback((node: string, vmid: number) => call<string | null>("proxmox_start_qemu_vm", { node, vmid }), [call]);
  const stopQemuVm = useCallback((node: string, vmid: number) => call<string | null>("proxmox_stop_qemu_vm", { node, vmid }), [call]);
  const shutdownQemuVm = useCallback((node: string, vmid: number, opts?: { force?: boolean; timeout?: number }) =>
    call<string | null>("proxmox_shutdown_qemu_vm", { node, vmid, force: opts?.force, timeout: opts?.timeout }), [call]);
  const rebootQemuVm = useCallback((node: string, vmid: number, timeout?: number) =>
    call<string | null>("proxmox_reboot_qemu_vm", { node, vmid, timeout }), [call]);
  const suspendQemuVm = useCallback((node: string, vmid: number, toDisk?: boolean) =>
    call<string | null>("proxmox_suspend_qemu_vm", { node, vmid, toDisk }), [call]);
  const resumeQemuVm = useCallback((node: string, vmid: number) => call<string | null>("proxmox_resume_qemu_vm", { node, vmid }), [call]);
  const resetQemuVm = useCallback((node: string, vmid: number) => call<string | null>("proxmox_reset_qemu_vm", { node, vmid }), [call]);
  const resizeQemuDisk = useCallback((node: string, vmid: number, params: DiskResizeParams) =>
    call<void>("proxmox_resize_qemu_disk", { node, vmid, params }), [call]);
  const cloneQemuVm = useCallback((node: string, vmid: number, params: QemuCloneParams) =>
    call<string | null>("proxmox_clone_qemu_vm", { node, vmid, params }), [call]);
  const migrateQemuVm = useCallback((node: string, vmid: number, params: QemuMigrateParams) =>
    call<string | null>("proxmox_migrate_qemu_vm", { node, vmid, params }), [call]);
  const convertQemuToTemplate = useCallback((node: string, vmid: number) =>
    call<void>("proxmox_convert_qemu_to_template", { node, vmid }), [call]);
  const qemuAgentExec = useCallback((node: string, vmid: number, command: string) =>
    call<unknown>("proxmox_qemu_agent_exec", { node, vmid, command }), [call]);
  const qemuAgentNetwork = useCallback((node: string, vmid: number) =>
    call<QemuAgentInfo>("proxmox_qemu_agent_network", { node, vmid }), [call]);
  const qemuAgentOsinfo = useCallback((node: string, vmid: number) =>
    call<QemuAgentInfo>("proxmox_qemu_agent_osinfo", { node, vmid }), [call]);
  const getNextVmid = useCallback(() => call<number>("proxmox_get_next_vmid"), [call]);

  // ── LXC ───────────────────────────────────────────────────────

  const listLxcContainers = useCallback((node: string) => call<LxcSummary[]>("proxmox_list_lxc_containers", { node }), [call]);
  const getLxcStatus = useCallback((node: string, vmid: number) => call<LxcStatusCurrent>("proxmox_get_lxc_status", { node, vmid }), [call]);
  const getLxcConfig = useCallback((node: string, vmid: number) => call<LxcConfig>("proxmox_get_lxc_config", { node, vmid }), [call]);
  const createLxcContainer = useCallback((node: string, params: LxcCreateParams) =>
    call<string | null>("proxmox_create_lxc_container", { node, params }), [call]);
  const deleteLxcContainer = useCallback((node: string, vmid: number, opts?: { purge?: boolean; force?: boolean }) =>
    call<string | null>("proxmox_delete_lxc_container", { node, vmid, purge: opts?.purge, force: opts?.force }), [call]);
  const startLxcContainer = useCallback((node: string, vmid: number) => call<string | null>("proxmox_start_lxc_container", { node, vmid }), [call]);
  const stopLxcContainer = useCallback((node: string, vmid: number) => call<string | null>("proxmox_stop_lxc_container", { node, vmid }), [call]);
  const shutdownLxcContainer = useCallback((node: string, vmid: number, opts?: { force?: boolean; timeout?: number }) =>
    call<string | null>("proxmox_shutdown_lxc_container", { node, vmid, force: opts?.force, timeout: opts?.timeout }), [call]);
  const rebootLxcContainer = useCallback((node: string, vmid: number, timeout?: number) =>
    call<string | null>("proxmox_reboot_lxc_container", { node, vmid, timeout }), [call]);
  const cloneLxcContainer = useCallback((node: string, vmid: number, params: LxcCloneParams) =>
    call<string | null>("proxmox_clone_lxc_container", { node, vmid, params }), [call]);
  const migrateLxcContainer = useCallback((node: string, vmid: number, params: LxcMigrateParams) =>
    call<string | null>("proxmox_migrate_lxc_container", { node, vmid, params }), [call]);

  // ── Storage ───────────────────────────────────────────────────

  const listStorage = useCallback((node: string) => call<StorageSummary[]>("proxmox_list_storage", { node }), [call]);
  const listStorageContent = useCallback((node: string, storage: string, opts?: { contentType?: string; vmid?: number }) =>
    call<StorageContent[]>("proxmox_list_storage_content", { node, storage, contentType: opts?.contentType, vmid: opts?.vmid }), [call]);
  const deleteStorageVolume = useCallback((node: string, storage: string, volume: string) =>
    call<string | null>("proxmox_delete_storage_volume", { node, storage, volume }), [call]);
  const downloadToStorage = useCallback((node: string, storage: string, url: string, content: string, filename: string) =>
    call<string>("proxmox_download_to_storage", { node, storage, url, content, filename }), [call]);

  // ── Network ───────────────────────────────────────────────────

  const listNetworkInterfaces = useCallback((node: string) => call<NetworkInterface[]>("proxmox_list_network_interfaces", { node }), [call]);
  const getNetworkInterface = useCallback((node: string, iface: string) => call<NetworkInterface>("proxmox_get_network_interface", { node, iface }), [call]);
  const createNetworkInterface = useCallback((node: string, params: CreateNetworkParams) =>
    call<void>("proxmox_create_network_interface", { node, params }), [call]);
  const deleteNetworkInterface = useCallback((node: string, iface: string) =>
    call<string | null>("proxmox_delete_network_interface", { node, iface }), [call]);
  const applyNetworkChanges = useCallback((node: string) => call<string | null>("proxmox_apply_network_changes", { node }), [call]);
  const revertNetworkChanges = useCallback((node: string) => call<string | null>("proxmox_revert_network_changes", { node }), [call]);

  // ── Cluster ───────────────────────────────────────────────────

  const getClusterStatus = useCallback(() => call<ClusterStatus[]>("proxmox_get_cluster_status"), [call]);
  const listClusterResources = useCallback((resourceType?: string) =>
    call<ClusterResource[]>("proxmox_list_cluster_resources", { resourceType }), [call]);
  const getClusterNextId = useCallback(() => call<number>("proxmox_get_cluster_next_id"), [call]);
  const listUsers = useCallback(() => call<PveUser[]>("proxmox_list_users"), [call]);
  const listRoles = useCallback(() => call<PveRole[]>("proxmox_list_roles"), [call]);
  const listGroups = useCallback(() => call<PveGroup[]>("proxmox_list_groups"), [call]);

  // ── Tasks ─────────────────────────────────────────────────────

  const listTasks = useCallback((node: string, opts?: { start?: number; limit?: number; vmid?: number; typeFilter?: string; statusFilter?: string }) =>
    call<TaskSummary[]>("proxmox_list_tasks", { node, ...opts }), [call]);
  const getTaskStatus = useCallback((node: string, upid: string) => call<TaskStatus>("proxmox_get_task_status", { node, upid }), [call]);
  const getTaskLog = useCallback((node: string, upid: string, opts?: { start?: number; limit?: number }) =>
    call<TaskLogLine[]>("proxmox_get_task_log", { node, upid, ...opts }), [call]);
  const stopTask = useCallback((node: string, upid: string) => call<void>("proxmox_stop_task", { node, upid }), [call]);

  // ── Backups ───────────────────────────────────────────────────

  const listBackupJobs = useCallback(() => call<BackupJobConfig[]>("proxmox_list_backup_jobs"), [call]);
  const vzdump = useCallback((node: string, params: VzdumpParams) => call<string>("proxmox_vzdump", { node, params }), [call]);
  const restoreBackup = useCallback((node: string, vmid: number, archive: string, opts?: { storage?: string; force?: boolean; unique?: boolean }) =>
    call<string>("proxmox_restore_backup", { node, vmid, archive, storage: opts?.storage, force: opts?.force, unique: opts?.unique }), [call]);
  const listBackups = useCallback((node: string, storage: string, vmid?: number) =>
    call<StorageContent[]>("proxmox_list_backups", { node, storage, vmid }), [call]);

  // ── Firewall ──────────────────────────────────────────────────

  const getClusterFirewallOptions = useCallback(() => call<FirewallOptions>("proxmox_get_cluster_firewall_options"), [call]);
  const listClusterFirewallRules = useCallback(() => call<FirewallRule[]>("proxmox_list_cluster_firewall_rules"), [call]);
  const listSecurityGroups = useCallback(() => call<FirewallSecurityGroup[]>("proxmox_list_security_groups"), [call]);
  const listFirewallAliases = useCallback(() => call<FirewallAlias[]>("proxmox_list_firewall_aliases"), [call]);
  const listFirewallIpsets = useCallback(() => call<FirewallIpSet[]>("proxmox_list_firewall_ipsets"), [call]);
  const listGuestFirewallRules = useCallback((node: string, guestType: string, vmid: number) =>
    call<FirewallRule[]>("proxmox_list_guest_firewall_rules", { node, guestType, vmid }), [call]);

  // ── Pools ─────────────────────────────────────────────────────

  const listPools = useCallback(() => call<PoolSummary[]>("proxmox_list_pools"), [call]);
  const getPool = useCallback((poolid: string) => call<PoolInfo>("proxmox_get_pool", { poolid }), [call]);
  const createPool = useCallback((poolid: string, comment?: string) =>
    call<void>("proxmox_create_pool", { poolid, comment }), [call]);
  const deletePool = useCallback((poolid: string) => call<string | null>("proxmox_delete_pool", { poolid }), [call]);

  // ── HA ────────────────────────────────────────────────────────

  const listHaResources = useCallback(() => call<HaResource[]>("proxmox_list_ha_resources"), [call]);
  const listHaGroups = useCallback(() => call<HaGroup[]>("proxmox_list_ha_groups"), [call]);

  // ── Ceph ──────────────────────────────────────────────────────

  const getCephStatus = useCallback((node: string) => call<CephStatus>("proxmox_get_ceph_status", { node }), [call]);
  const listCephPools = useCallback((node: string) => call<CephPool[]>("proxmox_list_ceph_pools", { node }), [call]);
  const listCephMonitors = useCallback((node: string) => call<CephMonitor[]>("proxmox_list_ceph_monitors", { node }), [call]);
  const listCephOsds = useCallback((node: string) => call<unknown>("proxmox_list_ceph_osds", { node }), [call]);

  // ── SDN ───────────────────────────────────────────────────────

  const listSdnZones = useCallback(() => call<SdnZone[]>("proxmox_list_sdn_zones"), [call]);
  const listSdnVnets = useCallback(() => call<SdnVnet[]>("proxmox_list_sdn_vnets"), [call]);

  // ── Console ───────────────────────────────────────────────────

  const qemuVncProxy = useCallback((node: string, vmid: number) => call<VncTicket>("proxmox_qemu_vnc_proxy", { node, vmid }), [call]);
  const qemuSpiceProxy = useCallback((node: string, vmid: number) => call<SpiceTicket>("proxmox_qemu_spice_proxy", { node, vmid }), [call]);
  const qemuTermproxy = useCallback((node: string, vmid: number) => call<TermProxyTicket>("proxmox_qemu_termproxy", { node, vmid }), [call]);
  const lxcVncProxy = useCallback((node: string, vmid: number) => call<VncTicket>("proxmox_lxc_vnc_proxy", { node, vmid }), [call]);
  const lxcSpiceProxy = useCallback((node: string, vmid: number) => call<SpiceTicket>("proxmox_lxc_spice_proxy", { node, vmid }), [call]);
  const lxcTermproxy = useCallback((node: string, vmid: number) => call<TermProxyTicket>("proxmox_lxc_termproxy", { node, vmid }), [call]);
  const nodeTermproxy = useCallback((node: string) => call<TermProxyTicket>("proxmox_node_termproxy", { node }), [call]);

  // ── Snapshots ─────────────────────────────────────────────────

  const listQemuSnapshots = useCallback((node: string, vmid: number) => call<SnapshotSummary[]>("proxmox_list_qemu_snapshots", { node, vmid }), [call]);
  const createQemuSnapshot = useCallback((node: string, vmid: number, params: CreateSnapshotParams) =>
    call<string | null>("proxmox_create_qemu_snapshot", { node, vmid, params }), [call]);
  const rollbackQemuSnapshot = useCallback((node: string, vmid: number, snapname: string) =>
    call<string | null>("proxmox_rollback_qemu_snapshot", { node, vmid, snapname }), [call]);
  const deleteQemuSnapshot = useCallback((node: string, vmid: number, snapname: string, force?: boolean) =>
    call<string | null>("proxmox_delete_qemu_snapshot", { node, vmid, snapname, force }), [call]);
  const listLxcSnapshots = useCallback((node: string, vmid: number) => call<SnapshotSummary[]>("proxmox_list_lxc_snapshots", { node, vmid }), [call]);
  const createLxcSnapshot = useCallback((node: string, vmid: number, params: CreateSnapshotParams) =>
    call<string | null>("proxmox_create_lxc_snapshot", { node, vmid, params }), [call]);
  const rollbackLxcSnapshot = useCallback((node: string, vmid: number, snapname: string) =>
    call<string | null>("proxmox_rollback_lxc_snapshot", { node, vmid, snapname }), [call]);
  const deleteLxcSnapshot = useCallback((node: string, vmid: number, snapname: string, force?: boolean) =>
    call<string | null>("proxmox_delete_lxc_snapshot", { node, vmid, snapname, force }), [call]);

  // ── Metrics ───────────────────────────────────────────────────

  const nodeRrd = useCallback((node: string, timeframe: string, cf?: string) =>
    call<RrdDataPoint[]>("proxmox_node_rrd", { node, timeframe, cf }), [call]);
  const qemuRrd = useCallback((node: string, vmid: number, timeframe: string, cf?: string) =>
    call<RrdDataPoint[]>("proxmox_qemu_rrd", { node, vmid, timeframe, cf }), [call]);
  const lxcRrd = useCallback((node: string, vmid: number, timeframe: string, cf?: string) =>
    call<RrdDataPoint[]>("proxmox_lxc_rrd", { node, vmid, timeframe, cf }), [call]);

  // ── Templates ─────────────────────────────────────────────────

  const listApplianceTemplates = useCallback((node: string) =>
    call<ApplianceTemplate[]>("proxmox_list_appliance_templates", { node }), [call]);
  const downloadAppliance = useCallback((node: string, storage: string, template: string) =>
    call<string>("proxmox_download_appliance", { node, storage, template }), [call]);
  const listIsos = useCallback((node: string, storage: string) =>
    call<StorageContent[]>("proxmox_list_isos", { node, storage }), [call]);
  const listContainerTemplates = useCallback((node: string, storage: string) =>
    call<StorageContent[]>("proxmox_list_container_templates", { node, storage }), [call]);

  return {
    connected, loading, error, config, version,
    connect, disconnect, checkSession, refreshConfig, refreshVersion,
    listNodes, getNodeStatus, listNodeServices, startNodeService, stopNodeService,
    restartNodeService, getNodeDns, getNodeSyslog, listAptUpdates, rebootNode, shutdownNode,
    listQemuVms, getQemuStatus, getQemuConfig, createQemuVm, deleteQemuVm,
    startQemuVm, stopQemuVm, shutdownQemuVm, rebootQemuVm, suspendQemuVm,
    resumeQemuVm, resetQemuVm, resizeQemuDisk, cloneQemuVm, migrateQemuVm,
    convertQemuToTemplate, qemuAgentExec, qemuAgentNetwork, qemuAgentOsinfo, getNextVmid,
    listLxcContainers, getLxcStatus, getLxcConfig, createLxcContainer, deleteLxcContainer,
    startLxcContainer, stopLxcContainer, shutdownLxcContainer, rebootLxcContainer,
    cloneLxcContainer, migrateLxcContainer,
    listStorage, listStorageContent, deleteStorageVolume, downloadToStorage,
    listNetworkInterfaces, getNetworkInterface, createNetworkInterface,
    deleteNetworkInterface, applyNetworkChanges, revertNetworkChanges,
    getClusterStatus, listClusterResources, getClusterNextId, listUsers, listRoles, listGroups,
    listTasks, getTaskStatus, getTaskLog, stopTask,
    listBackupJobs, vzdump, restoreBackup, listBackups,
    getClusterFirewallOptions, listClusterFirewallRules, listSecurityGroups,
    listFirewallAliases, listFirewallIpsets, listGuestFirewallRules,
    listPools, getPool, createPool, deletePool,
    listHaResources, listHaGroups,
    getCephStatus, listCephPools, listCephMonitors, listCephOsds,
    listSdnZones, listSdnVnets,
    qemuVncProxy, qemuSpiceProxy, qemuTermproxy,
    lxcVncProxy, lxcSpiceProxy, lxcTermproxy, nodeTermproxy,
    listQemuSnapshots, createQemuSnapshot, rollbackQemuSnapshot, deleteQemuSnapshot,
    listLxcSnapshots, createLxcSnapshot, rollbackLxcSnapshot, deleteLxcSnapshot,
    nodeRrd, qemuRrd, lxcRrd,
    listApplianceTemplates, downloadAppliance, listIsos, listContainerTemplates,
  };
}
