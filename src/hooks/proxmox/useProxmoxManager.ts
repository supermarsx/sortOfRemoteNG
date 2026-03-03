/**
 * useProxmoxManager — "mgr" hook that powers the Proxmox panel.
 *
 * Manages connection state, list data for nodes / VMs / containers,
 * active tab, refresh polling, and all user actions.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProxmoxConfigSafe,
  PveVersion,
  NodeSummary,
  NodeStatus,
  QemuVmSummary,
  LxcSummary,
  StorageSummary,
  StorageContent,
  ClusterStatus,
  ClusterResource,
  TaskSummary,
  TaskStatus,
  TaskLogLine,
  SnapshotSummary,
  CreateSnapshotParams,
  BackupJobConfig,
  PoolSummary,
  HaResource,
  HaGroup,
  CephStatus,
  CephPool,
  FirewallRule,
  FirewallOptions,
  NetworkInterface,
  RrdDataPoint,
  QemuConfig,
  LxcConfig,
  QemuCreateParams,
  LxcCreateParams,
  QemuCloneParams,
  LxcCloneParams,
  VncTicket,
  TermProxyTicket,
} from "../../types/proxmox";

// ── Tab & View Types ─────────────────────────────────────────────

export type ProxmoxTab =
  | "dashboard"
  | "nodes"
  | "qemu"
  | "lxc"
  | "storage"
  | "network"
  | "tasks"
  | "backups"
  | "firewall"
  | "pools"
  | "ha"
  | "ceph"
  | "snapshots"
  | "console";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ProxmoxManagerState {
  // Connection
  connectionState: ConnectionState;
  host: string;
  port: number;
  username: string;
  password: string;
  tokenId: string;
  tokenSecret: string;
  useApiToken: boolean;
  insecure: boolean;
  connectionError: string | null;
  config: ProxmoxConfigSafe | null;
  version: PveVersion | null;

  // Navigation
  activeTab: ProxmoxTab;
  selectedNode: string | null;
  selectedVmid: number | null;
  selectedVmType: "qemu" | "lxc" | null;

  // Data
  nodes: NodeSummary[];
  nodeStatus: Record<string, NodeStatus>;
  qemuVms: QemuVmSummary[];
  lxcContainers: LxcSummary[];
  storage: StorageSummary[];
  storageContent: StorageContent[];
  clusterStatus: ClusterStatus[];
  clusterResources: ClusterResource[];
  tasks: TaskSummary[];
  backupJobs: BackupJobConfig[];
  pools: PoolSummary[];
  haResources: HaResource[];
  haGroups: HaGroup[];
  cephStatus: CephStatus | null;
  cephPools: CephPool[];
  firewallRules: FirewallRule[];
  firewallOptions: FirewallOptions | null;
  networkInterfaces: NetworkInterface[];
  snapshots: SnapshotSummary[];
  rrdData: RrdDataPoint[];

  // Detail views
  vmConfig: QemuConfig | null;
  lxcConfig: LxcConfig | null;
  taskDetail: TaskStatus | null;
  taskLog: TaskLogLine[];

  // Loading / error
  loading: boolean;
  dataError: string | null;
  refreshing: boolean;

  // Dialogs
  showCreateVm: boolean;
  showCloneDialog: boolean;
  showSnapshotDialog: boolean;
  showConfirmAction: boolean;
  confirmAction: (() => Promise<void>) | null;
  confirmMessage: string;
  confirmTitle: string;

  // Search
  searchQuery: string;
}

// ── The hook ─────────────────────────────────────────────────────

export function useProxmoxManager(isOpen: boolean) {
  // ---- Connection form state ----
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(8006);
  const [username, setUsername] = useState("root@pam");
  const [password, setPassword] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [useApiToken, setUseApiToken] = useState(false);
  const [insecure, setInsecure] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [config, setConfig] = useState<ProxmoxConfigSafe | null>(null);
  const [version, setVersion] = useState<PveVersion | null>(null);

  // ---- Navigation ----
  const [activeTab, setActiveTab] = useState<ProxmoxTab>("dashboard");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedVmid, setSelectedVmid] = useState<number | null>(null);
  const [selectedVmType, setSelectedVmType] = useState<"qemu" | "lxc" | null>(null);

  // ---- Data ----
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [nodeStatus, setNodeStatus] = useState<Record<string, NodeStatus>>({});
  const [qemuVms, setQemuVms] = useState<QemuVmSummary[]>([]);
  const [lxcContainers, setLxcContainers] = useState<LxcSummary[]>([]);
  const [storage, setStorage] = useState<StorageSummary[]>([]);
  const [storageContent, setStorageContent] = useState<StorageContent[]>([]);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus[]>([]);
  const [clusterResources, setClusterResources] = useState<ClusterResource[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [backupJobs, setBackupJobs] = useState<BackupJobConfig[]>([]);
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [haResources, setHaResources] = useState<HaResource[]>([]);
  const [haGroups, setHaGroups] = useState<HaGroup[]>([]);
  const [cephStatus, setCephStatus] = useState<CephStatus | null>(null);
  const [cephPools, setCephPools] = useState<CephPool[]>([]);
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([]);
  const [firewallOptions, setFirewallOptions] = useState<FirewallOptions | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterface[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [rrdData, setRrdData] = useState<RrdDataPoint[]>([]);

  // ---- Detail ----
  const [vmConfig, setVmConfig] = useState<QemuConfig | null>(null);
  const [lxcConfig, setLxcConfig] = useState<LxcConfig | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskStatus | null>(null);
  const [taskLog, setTaskLog] = useState<TaskLogLine[]>([]);

  // ---- UI ----
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateVm, setShowCreateVm] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
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

  // ── Helpers ───────────────────────────────────────────────────

  const safe = useCallback(<T,>(fn: () => Promise<T>): Promise<T | null> => {
    return fn().catch((e) => {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
      return null;
    });
  }, []);

  // ── Connection ────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setConnectionState("connecting");
    setConnectionError(null);
    try {
      const msg = await invoke<string>("proxmox_connect", {
        host,
        port,
        username,
        password: useApiToken ? undefined : password,
        tokenId: useApiToken ? tokenId : undefined,
        tokenSecret: useApiToken ? tokenSecret : undefined,
        insecure,
      });
      if (!mountedRef.current) return;
      setConnectionState("connected");

      // Fetch initial data
      const [cfg, ver] = await Promise.all([
        safe(() => invoke<ProxmoxConfigSafe | null>("proxmox_get_config")),
        safe(() => invoke<PveVersion>("proxmox_get_version")),
      ]);
      if (mountedRef.current) {
        setConfig(cfg ?? null);
        setVersion(ver ?? null);
      }

      // Fetch dashboard data
      await refreshDashboard();

      return msg;
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) {
        setConnectionState("error");
        setConnectionError(msg);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, port, username, password, tokenId, tokenSecret, useApiToken, insecure, safe]);

  const disconnect = useCallback(async () => {
    try {
      await invoke<void>("proxmox_disconnect");
    } catch { /* ignore */ }
    if (mountedRef.current) {
      setConnectionState("disconnected");
      setConfig(null);
      setVersion(null);
      setNodes([]);
      setNodeStatus({});
      setQemuVms([]);
      setLxcContainers([]);
      setStorage([]);
      setClusterStatus([]);
      setClusterResources([]);
      setTasks([]);
      setActiveTab("dashboard");
      setSelectedNode(null);
      setSelectedVmid(null);
    }
  }, []);

  // ── Data Refresh ──────────────────────────────────────────────

  const refreshDashboard = useCallback(async () => {
    if (!mountedRef.current) return;
    setRefreshing(true);
    setDataError(null);
    try {
      const nodeList = await invoke<NodeSummary[]>("proxmox_list_nodes");
      if (!mountedRef.current) return;
      setNodes(nodeList);

      if (nodeList.length > 0) {
        const firstNode = nodeList[0].node;
        if (!selectedNode) setSelectedNode(firstNode);

        const targetNode = selectedNode || firstNode;
        const [vms, cts, stor, cluster, resources] = await Promise.all([
          safe(() => invoke<QemuVmSummary[]>("proxmox_list_qemu_vms", { node: targetNode })),
          safe(() => invoke<LxcSummary[]>("proxmox_list_lxc_containers", { node: targetNode })),
          safe(() => invoke<StorageSummary[]>("proxmox_list_storage", { node: targetNode })),
          safe(() => invoke<ClusterStatus[]>("proxmox_get_cluster_status")),
          safe(() => invoke<ClusterResource[]>("proxmox_list_cluster_resources")),
        ]);
        if (!mountedRef.current) return;
        if (vms) setQemuVms(vms);
        if (cts) setLxcContainers(cts);
        if (stor) setStorage(stor);
        if (cluster) setClusterStatus(cluster);
        if (resources) setClusterResources(resources);
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [selectedNode, safe]);

  const refreshNodeVms = useCallback(async (node: string) => {
    setRefreshing(true);
    try {
      const [vms, cts] = await Promise.all([
        safe(() => invoke<QemuVmSummary[]>("proxmox_list_qemu_vms", { node })),
        safe(() => invoke<LxcSummary[]>("proxmox_list_lxc_containers", { node })),
      ]);
      if (mountedRef.current) {
        if (vms) setQemuVms(vms);
        if (cts) setLxcContainers(cts);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshTasks = useCallback(async (node: string) => {
    setRefreshing(true);
    try {
      const t = await safe(() => invoke<TaskSummary[]>("proxmox_list_tasks", { node, limit: 50 }));
      if (mountedRef.current && t) setTasks(t);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshStorage = useCallback(async (node: string) => {
    setRefreshing(true);
    try {
      const s = await safe(() => invoke<StorageSummary[]>("proxmox_list_storage", { node }));
      if (mountedRef.current && s) setStorage(s);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshFirewall = useCallback(async () => {
    setRefreshing(true);
    try {
      const [rules, opts] = await Promise.all([
        safe(() => invoke<FirewallRule[]>("proxmox_list_cluster_firewall_rules")),
        safe(() => invoke<FirewallOptions>("proxmox_get_cluster_firewall_options")),
      ]);
      if (mountedRef.current) {
        if (rules) setFirewallRules(rules);
        if (opts) setFirewallOptions(opts);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshBackups = useCallback(async () => {
    setRefreshing(true);
    try {
      const jobs = await safe(() => invoke<BackupJobConfig[]>("proxmox_list_backup_jobs"));
      if (mountedRef.current && jobs) setBackupJobs(jobs);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshPools = useCallback(async () => {
    setRefreshing(true);
    try {
      const p = await safe(() => invoke<PoolSummary[]>("proxmox_list_pools"));
      if (mountedRef.current && p) setPools(p);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshHa = useCallback(async () => {
    setRefreshing(true);
    try {
      const [res, grp] = await Promise.all([
        safe(() => invoke<HaResource[]>("proxmox_list_ha_resources")),
        safe(() => invoke<HaGroup[]>("proxmox_list_ha_groups")),
      ]);
      if (mountedRef.current) {
        if (res) setHaResources(res);
        if (grp) setHaGroups(grp);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshCeph = useCallback(async (node: string) => {
    setRefreshing(true);
    try {
      const [status, pools] = await Promise.all([
        safe(() => invoke<CephStatus>("proxmox_get_ceph_status", { node })),
        safe(() => invoke<CephPool[]>("proxmox_list_ceph_pools", { node })),
      ]);
      if (mountedRef.current) {
        if (status) setCephStatus(status);
        if (pools) setCephPools(pools);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshNetwork = useCallback(async (node: string) => {
    setRefreshing(true);
    try {
      const ifaces = await safe(() => invoke<NetworkInterface[]>("proxmox_list_network_interfaces", { node }));
      if (mountedRef.current && ifaces) setNetworkInterfaces(ifaces);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  const refreshSnapshots = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc") => {
    setRefreshing(true);
    try {
      const cmd = vmType === "qemu" ? "proxmox_list_qemu_snapshots" : "proxmox_list_lxc_snapshots";
      const snaps = await safe(() => invoke<SnapshotSummary[]>(cmd, { node, vmid }));
      if (mountedRef.current && snaps) setSnapshots(snaps);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [safe]);

  // ── VM / Container Actions ────────────────────────────────────

  const vmAction = useCallback(async (node: string, vmid: number, action: string) => {
    setLoading(true);
    setDataError(null);
    try {
      await invoke<string | null>(`proxmox_${action}_qemu_vm`, { node, vmid });
      await refreshNodeVms(node);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshNodeVms]);

  const lxcAction = useCallback(async (node: string, vmid: number, action: string) => {
    setLoading(true);
    setDataError(null);
    try {
      await invoke<string | null>(`proxmox_${action}_lxc_container`, { node, vmid });
      await refreshNodeVms(node);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshNodeVms]);

  const createSnapshot = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc", params: CreateSnapshotParams) => {
    setLoading(true);
    try {
      const cmd = vmType === "qemu" ? "proxmox_create_qemu_snapshot" : "proxmox_create_lxc_snapshot";
      await invoke<string | null>(cmd, { node, vmid, params });
      await refreshSnapshots(node, vmid, vmType);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshSnapshots]);

  const rollbackSnapshot = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc", snapname: string) => {
    setLoading(true);
    try {
      const cmd = vmType === "qemu" ? "proxmox_rollback_qemu_snapshot" : "proxmox_rollback_lxc_snapshot";
      await invoke<string | null>(cmd, { node, vmid, snapname });
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const deleteSnapshot = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc", snapname: string) => {
    setLoading(true);
    try {
      const cmd = vmType === "qemu" ? "proxmox_delete_qemu_snapshot" : "proxmox_delete_lxc_snapshot";
      await invoke<string | null>(cmd, { node, vmid, snapname });
      await refreshSnapshots(node, vmid, vmType);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message ?? String(e);
      if (mountedRef.current) setDataError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshSnapshots]);

  // ── Console ───────────────────────────────────────────────────

  const openVncConsole = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc") => {
    const cmd = vmType === "qemu" ? "proxmox_qemu_vnc_proxy" : "proxmox_lxc_vnc_proxy";
    return invoke<VncTicket>(cmd, { node, vmid });
  }, []);

  const openTermConsole = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc") => {
    const cmd = vmType === "qemu" ? "proxmox_qemu_termproxy" : "proxmox_lxc_termproxy";
    return invoke<TermProxyTicket>(cmd, { node, vmid });
  }, []);

  const openNodeConsole = useCallback(async (node: string) => {
    return invoke<TermProxyTicket>("proxmox_node_termproxy", { node });
  }, []);

  // ── Metrics ───────────────────────────────────────────────────

  const loadNodeMetrics = useCallback(async (node: string, timeframe = "hour") => {
    const data = await safe(() => invoke<RrdDataPoint[]>("proxmox_node_rrd", { node, timeframe }));
    if (mountedRef.current && data) setRrdData(data);
  }, [safe]);

  const loadVmMetrics = useCallback(async (node: string, vmid: number, vmType: "qemu" | "lxc", timeframe = "hour") => {
    const cmd = vmType === "qemu" ? "proxmox_qemu_rrd" : "proxmox_lxc_rrd";
    const data = await safe(() => invoke<RrdDataPoint[]>(cmd, { node, vmid, timeframe }));
    if (mountedRef.current && data) setRrdData(data);
  }, [safe]);

  // ── Task Detail ───────────────────────────────────────────────

  const loadTaskDetail = useCallback(async (node: string, upid: string) => {
    const [status, log] = await Promise.all([
      safe(() => invoke<TaskStatus>("proxmox_get_task_status", { node, upid })),
      safe(() => invoke<TaskLogLine[]>("proxmox_get_task_log", { node, upid })),
    ]);
    if (mountedRef.current) {
      if (status) setTaskDetail(status);
      if (log) setTaskLog(log);
    }
  }, [safe]);

  const stopTask = useCallback(async (node: string, upid: string) => {
    await invoke<void>("proxmox_stop_task", { node, upid });
    await refreshTasks(node);
  }, [refreshTasks]);

  // ── VM Config ─────────────────────────────────────────────────

  const loadVmConfig = useCallback(async (node: string, vmid: number) => {
    const cfg = await safe(() => invoke<QemuConfig>("proxmox_get_qemu_config", { node, vmid }));
    if (mountedRef.current) setVmConfig(cfg);
  }, [safe]);

  const loadLxcConfig = useCallback(async (node: string, vmid: number) => {
    const cfg = await safe(() => invoke<LxcConfig>("proxmox_get_lxc_config", { node, vmid }));
    if (mountedRef.current) setLxcConfig(cfg);
  }, [safe]);

  // ── Confirm Dialog Helper ─────────────────────────────────────

  const requestConfirm = useCallback((title: string, message: string, action: () => Promise<void>) => {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setShowConfirmAction(true);
  }, []);

  const executeConfirm = useCallback(async () => {
    setShowConfirmAction(false);
    if (confirmAction) await confirmAction();
    setConfirmAction(null);
  }, [confirmAction]);

  const cancelConfirm = useCallback(() => {
    setShowConfirmAction(false);
    setConfirmAction(null);
  }, []);

  // ── Tab change with auto-refresh ──────────────────────────────

  const switchTab = useCallback((tab: ProxmoxTab) => {
    setActiveTab(tab);
    setDataError(null);
    const node = selectedNode;
    if (!node) return;

    switch (tab) {
      case "dashboard": refreshDashboard(); break;
      case "qemu":
      case "lxc": refreshNodeVms(node); break;
      case "storage": refreshStorage(node); break;
      case "network": refreshNetwork(node); break;
      case "tasks": refreshTasks(node); break;
      case "backups": refreshBackups(); break;
      case "firewall": refreshFirewall(); break;
      case "pools": refreshPools(); break;
      case "ha": refreshHa(); break;
      case "ceph": refreshCeph(node); break;
    }
  }, [selectedNode, refreshDashboard, refreshNodeVms, refreshStorage, refreshNetwork, refreshTasks, refreshBackups, refreshFirewall, refreshPools, refreshHa, refreshCeph]);

  // ── Auto-poll while open and connected ────────────────────────

  useEffect(() => {
    if (isOpen && connectionState === "connected") {
      pollRef.current = setInterval(() => {
        if (activeTab === "dashboard") refreshDashboard();
        if (activeTab === "tasks" && selectedNode) refreshTasks(selectedNode);
      }, 30_000);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isOpen, connectionState, activeTab, selectedNode, refreshDashboard, refreshTasks]);

  // ── Select a node, refresh its guests ─────────────────────────

  const selectNode = useCallback((node: string) => {
    setSelectedNode(node);
    setSelectedVmid(null);
    setSelectedVmType(null);
    refreshNodeVms(node);
  }, [refreshNodeVms]);

  const selectVm = useCallback((vmid: number, vmType: "qemu" | "lxc") => {
    setSelectedVmid(vmid);
    setSelectedVmType(vmType);
    if (selectedNode) {
      if (vmType === "qemu") loadVmConfig(selectedNode, vmid);
      else loadLxcConfig(selectedNode, vmid);
    }
  }, [selectedNode, loadVmConfig, loadLxcConfig]);

  // ── Filtered lists ────────────────────────────────────────────

  const filteredVms = searchQuery
    ? qemuVms.filter(v =>
        v.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(v.vmid).includes(searchQuery))
    : qemuVms;

  const filteredContainers = searchQuery
    ? lxcContainers.filter(c =>
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(c.vmid).includes(searchQuery))
    : lxcContainers;

  // ── Return ────────────────────────────────────────────────────

  return {
    // Connection form
    connectionState, host, setHost, port, setPort,
    username, setUsername, password, setPassword,
    tokenId, setTokenId, tokenSecret, setTokenSecret,
    useApiToken, setUseApiToken, insecure, setInsecure,
    connectionError, config, version,
    connect, disconnect,

    // Navigation
    activeTab, switchTab,
    selectedNode, selectNode,
    selectedVmid, selectedVmType, selectVm,

    // Data
    nodes, nodeStatus, qemuVms, lxcContainers, storage, storageContent,
    clusterStatus, clusterResources, tasks, backupJobs, pools,
    haResources, haGroups, cephStatus, cephPools,
    firewallRules, firewallOptions, networkInterfaces, snapshots, rrdData,

    // Detail
    vmConfig, lxcConfig, taskDetail, taskLog,

    // Filtered
    filteredVms, filteredContainers,

    // Loading
    loading, dataError, refreshing,

    // Dialogs
    showCreateVm, setShowCreateVm,
    showCloneDialog, setShowCloneDialog,
    showSnapshotDialog, setShowSnapshotDialog,
    showConfirmAction, confirmMessage, confirmTitle,
    requestConfirm, executeConfirm, cancelConfirm,

    // Search
    searchQuery, setSearchQuery,

    // Actions
    vmAction, lxcAction,
    createSnapshot, rollbackSnapshot, deleteSnapshot,
    openVncConsole, openTermConsole, openNodeConsole,
    loadNodeMetrics, loadVmMetrics,
    loadTaskDetail, stopTask,
    loadVmConfig, loadLxcConfig,
    refreshDashboard, refreshNodeVms, refreshTasks, refreshStorage,
    refreshFirewall, refreshBackups, refreshPools, refreshHa,
    refreshCeph, refreshNetwork, refreshSnapshots,
  };
}

export type ProxmoxMgr = ReturnType<typeof useProxmoxManager>;
