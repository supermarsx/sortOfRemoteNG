// useHetzner — typed Tauri `invoke(...)` wrappers for the sorng-hetzner
// backend. Pairs 1:1 with the 76 `hetzner_*` commands in
// `src-tauri/crates/sorng-hetzner/src/commands.rs`.
//
// Tauri maps JS camelCase arg keys to Rust snake_case arg names, so we
// send `connectionId`, `serverType`, `ipRange`, etc.

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  CreateCertificateRequest,
  CreateFirewallRequest,
  CreateFloatingIpRequest,
  CreateNetworkRequest,
  CreateServerRequest,
  CreateSshKeyRequest,
  CreateVolumeRequest,
  HetznerAction,
  HetznerCertificate,
  HetznerConnectionConfig,
  HetznerConnectionSummary,
  HetznerDashboard,
  HetznerFirewall,
  HetznerFirewallAppliedTo,
  HetznerFirewallRule,
  HetznerFloatingIp,
  HetznerImage,
  HetznerLbService,
  HetznerLbTarget,
  HetznerLoadBalancer,
  HetznerNetwork,
  HetznerRoute,
  HetznerServer,
  HetznerSshKey,
  HetznerSubnet,
  HetznerVolume,
} from '../../types/hetzner';

// ─── Low-level invoke wrappers ─────────────────────────────────────────

export const hetznerApi = {
  // ── Connection management ───────────────────────────────────────────
  connect: (connectionId: string, config: HetznerConnectionConfig) =>
    invoke<HetznerConnectionSummary>('hetzner_connect', { connectionId, config }),
  disconnect: (connectionId: string) =>
    invoke<void>('hetzner_disconnect', { connectionId }),
  listConnections: () => invoke<string[]>('hetzner_list_connections'),
  ping: (connectionId: string) => invoke<void>('hetzner_ping', { connectionId }),
  getDashboard: (connectionId: string) =>
    invoke<HetznerDashboard>('hetzner_get_dashboard', { connectionId }),

  // ── Servers ─────────────────────────────────────────────────────────
  listServers: (connectionId: string) =>
    invoke<HetznerServer[]>('hetzner_list_servers', { connectionId }),
  getServer: (connectionId: string, id: number) =>
    invoke<HetznerServer>('hetzner_get_server', { connectionId, id }),
  createServer: (connectionId: string, request: CreateServerRequest) =>
    invoke<[HetznerServer, HetznerAction]>('hetzner_create_server', {
      connectionId,
      request,
    }),
  deleteServer: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_server', { connectionId, id }),
  startServer: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_start_server', { connectionId, id }),
  stopServer: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_stop_server', { connectionId, id }),
  rebootServer: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_reboot_server', { connectionId, id }),
  rebuildServer: (connectionId: string, id: number, image: string) =>
    invoke<HetznerAction>('hetzner_rebuild_server', { connectionId, id, image }),
  resetServer: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_reset_server', { connectionId, id }),
  changeServerType: (
    connectionId: string,
    id: number,
    serverType: string,
    upgradeDisk: boolean,
  ) =>
    invoke<HetznerAction>('hetzner_change_server_type', {
      connectionId,
      id,
      serverType,
      upgradeDisk,
    }),
  enableRescue: (
    connectionId: string,
    id: number,
    rescueType?: string | null,
    sshKeys?: number[] | null,
  ) =>
    invoke<HetznerAction>('hetzner_enable_rescue', {
      connectionId,
      id,
      rescueType: rescueType ?? null,
      sshKeys: sshKeys ?? null,
    }),
  disableRescue: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_disable_rescue', { connectionId, id }),
  createServerImage: (
    connectionId: string,
    id: number,
    description?: string | null,
    imageType?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerAction>('hetzner_create_server_image', {
      connectionId,
      id,
      description: description ?? null,
      imageType: imageType ?? null,
      labels: labels ?? null,
    }),
  enableBackup: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_enable_backup', { connectionId, id }),
  disableBackup: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_disable_backup', { connectionId, id }),
  getServerMetrics: (
    connectionId: string,
    id: number,
    metricType: string,
    start: string,
    end: string,
  ) =>
    invoke<unknown>('hetzner_get_server_metrics', {
      connectionId,
      id,
      metricType,
      start,
      end,
    }),

  // ── Networks ────────────────────────────────────────────────────────
  listNetworks: (connectionId: string) =>
    invoke<HetznerNetwork[]>('hetzner_list_networks', { connectionId }),
  getNetwork: (connectionId: string, id: number) =>
    invoke<HetznerNetwork>('hetzner_get_network', { connectionId, id }),
  createNetwork: (connectionId: string, request: CreateNetworkRequest) =>
    invoke<HetznerNetwork>('hetzner_create_network', { connectionId, request }),
  updateNetwork: (
    connectionId: string,
    id: number,
    name?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerNetwork>('hetzner_update_network', {
      connectionId,
      id,
      name: name ?? null,
      labels: labels ?? null,
    }),
  deleteNetwork: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_network', { connectionId, id }),
  addSubnet: (connectionId: string, id: number, subnet: HetznerSubnet) =>
    invoke<HetznerAction>('hetzner_add_subnet', { connectionId, id, subnet }),
  deleteSubnet: (connectionId: string, id: number, ipRange: string) =>
    invoke<HetznerAction>('hetzner_delete_subnet', { connectionId, id, ipRange }),
  addRoute: (connectionId: string, id: number, route: HetznerRoute) =>
    invoke<HetznerAction>('hetzner_add_route', { connectionId, id, route }),
  deleteRoute: (connectionId: string, id: number, route: HetznerRoute) =>
    invoke<HetznerAction>('hetzner_delete_route', { connectionId, id, route }),

  // ── Firewalls ───────────────────────────────────────────────────────
  listFirewalls: (connectionId: string) =>
    invoke<HetznerFirewall[]>('hetzner_list_firewalls', { connectionId }),
  getFirewall: (connectionId: string, id: number) =>
    invoke<HetznerFirewall>('hetzner_get_firewall', { connectionId, id }),
  createFirewall: (connectionId: string, request: CreateFirewallRequest) =>
    invoke<HetznerFirewall>('hetzner_create_firewall', { connectionId, request }),
  updateFirewall: (
    connectionId: string,
    id: number,
    name?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerFirewall>('hetzner_update_firewall', {
      connectionId,
      id,
      name: name ?? null,
      labels: labels ?? null,
    }),
  deleteFirewall: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_firewall', { connectionId, id }),
  setFirewallRules: (
    connectionId: string,
    id: number,
    rules: HetznerFirewallRule[],
  ) =>
    invoke<HetznerAction[]>('hetzner_set_firewall_rules', {
      connectionId,
      id,
      rules,
    }),
  applyFirewall: (
    connectionId: string,
    id: number,
    applyTo: HetznerFirewallAppliedTo[],
  ) =>
    invoke<HetznerAction[]>('hetzner_apply_firewall', {
      connectionId,
      id,
      applyTo,
    }),
  removeFirewall: (
    connectionId: string,
    id: number,
    removeFrom: HetznerFirewallAppliedTo[],
  ) =>
    invoke<HetznerAction[]>('hetzner_remove_firewall', {
      connectionId,
      id,
      removeFrom,
    }),

  // ── Floating IPs ────────────────────────────────────────────────────
  listFloatingIps: (connectionId: string) =>
    invoke<HetznerFloatingIp[]>('hetzner_list_floating_ips', { connectionId }),
  getFloatingIp: (connectionId: string, id: number) =>
    invoke<HetznerFloatingIp>('hetzner_get_floating_ip', { connectionId, id }),
  createFloatingIp: (connectionId: string, request: CreateFloatingIpRequest) =>
    invoke<HetznerFloatingIp>('hetzner_create_floating_ip', {
      connectionId,
      request,
    }),
  deleteFloatingIp: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_floating_ip', { connectionId, id }),
  assignFloatingIp: (connectionId: string, id: number, server: number) =>
    invoke<HetznerAction>('hetzner_assign_floating_ip', {
      connectionId,
      id,
      server,
    }),
  unassignFloatingIp: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_unassign_floating_ip', { connectionId, id }),

  // ── Volumes ─────────────────────────────────────────────────────────
  listVolumes: (connectionId: string) =>
    invoke<HetznerVolume[]>('hetzner_list_volumes', { connectionId }),
  getVolume: (connectionId: string, id: number) =>
    invoke<HetznerVolume>('hetzner_get_volume', { connectionId, id }),
  createVolume: (connectionId: string, request: CreateVolumeRequest) =>
    invoke<[HetznerVolume, HetznerAction]>('hetzner_create_volume', {
      connectionId,
      request,
    }),
  deleteVolume: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_volume', { connectionId, id }),
  attachVolume: (
    connectionId: string,
    id: number,
    server: number,
    automount?: boolean | null,
  ) =>
    invoke<HetznerAction>('hetzner_attach_volume', {
      connectionId,
      id,
      server,
      automount: automount ?? null,
    }),
  detachVolume: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_detach_volume', { connectionId, id }),
  resizeVolume: (connectionId: string, id: number, size: number) =>
    invoke<HetznerAction>('hetzner_resize_volume', { connectionId, id, size }),

  // ── Load Balancers ──────────────────────────────────────────────────
  listLoadBalancers: (connectionId: string) =>
    invoke<HetznerLoadBalancer[]>('hetzner_list_load_balancers', {
      connectionId,
    }),
  getLoadBalancer: (connectionId: string, id: number) =>
    invoke<HetznerLoadBalancer>('hetzner_get_load_balancer', {
      connectionId,
      id,
    }),
  createLoadBalancer: (connectionId: string, request: unknown) =>
    invoke<HetznerLoadBalancer>('hetzner_create_load_balancer', {
      connectionId,
      request,
    }),
  deleteLoadBalancer: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_load_balancer', { connectionId, id }),
  addLbService: (connectionId: string, id: number, service: HetznerLbService) =>
    invoke<HetznerAction>('hetzner_add_lb_service', {
      connectionId,
      id,
      service,
    }),
  updateLbService: (
    connectionId: string,
    id: number,
    service: HetznerLbService,
  ) =>
    invoke<HetznerAction>('hetzner_update_lb_service', {
      connectionId,
      id,
      service,
    }),
  deleteLbService: (connectionId: string, id: number, listenPort: number) =>
    invoke<HetznerAction>('hetzner_delete_lb_service', {
      connectionId,
      id,
      listenPort,
    }),
  addLbTarget: (connectionId: string, id: number, target: HetznerLbTarget) =>
    invoke<HetznerAction>('hetzner_add_lb_target', {
      connectionId,
      id,
      target,
    }),
  removeLbTarget: (
    connectionId: string,
    id: number,
    target: HetznerLbTarget,
  ) =>
    invoke<HetznerAction>('hetzner_remove_lb_target', {
      connectionId,
      id,
      target,
    }),

  // ── Images ──────────────────────────────────────────────────────────
  listImages: (connectionId: string) =>
    invoke<HetznerImage[]>('hetzner_list_images', { connectionId }),
  getImage: (connectionId: string, id: number) =>
    invoke<HetznerImage>('hetzner_get_image', { connectionId, id }),
  updateImage: (
    connectionId: string,
    id: number,
    description?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerImage>('hetzner_update_image', {
      connectionId,
      id,
      description: description ?? null,
      labels: labels ?? null,
    }),
  deleteImage: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_image', { connectionId, id }),

  // ── SSH Keys ────────────────────────────────────────────────────────
  listSshKeys: (connectionId: string) =>
    invoke<HetznerSshKey[]>('hetzner_list_ssh_keys', { connectionId }),
  getSshKey: (connectionId: string, id: number) =>
    invoke<HetznerSshKey>('hetzner_get_ssh_key', { connectionId, id }),
  createSshKey: (connectionId: string, request: CreateSshKeyRequest) =>
    invoke<HetznerSshKey>('hetzner_create_ssh_key', { connectionId, request }),
  updateSshKey: (
    connectionId: string,
    id: number,
    name?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerSshKey>('hetzner_update_ssh_key', {
      connectionId,
      id,
      name: name ?? null,
      labels: labels ?? null,
    }),
  deleteSshKey: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_ssh_key', { connectionId, id }),

  // ── Certificates ────────────────────────────────────────────────────
  listCertificates: (connectionId: string) =>
    invoke<HetznerCertificate[]>('hetzner_list_certificates', { connectionId }),
  getCertificate: (connectionId: string, id: number) =>
    invoke<HetznerCertificate>('hetzner_get_certificate', { connectionId, id }),
  createCertificate: (
    connectionId: string,
    request: CreateCertificateRequest,
  ) =>
    invoke<HetznerCertificate>('hetzner_create_certificate', {
      connectionId,
      request,
    }),
  updateCertificate: (
    connectionId: string,
    id: number,
    name?: string | null,
    labels?: unknown,
  ) =>
    invoke<HetznerCertificate>('hetzner_update_certificate', {
      connectionId,
      id,
      name: name ?? null,
      labels: labels ?? null,
    }),
  deleteCertificate: (connectionId: string, id: number) =>
    invoke<void>('hetzner_delete_certificate', { connectionId, id }),

  // ── Actions ─────────────────────────────────────────────────────────
  listActions: (connectionId: string) =>
    invoke<HetznerAction[]>('hetzner_list_actions', { connectionId }),
  getAction: (connectionId: string, id: number) =>
    invoke<HetznerAction>('hetzner_get_action', { connectionId, id }),
} as const;

// ─── State hook ────────────────────────────────────────────────────────

interface HetznerState {
  connections: string[];
  activeId: string | null;
  lastError: string | null;
  loading: boolean;
}

export function useHetzner() {
  const [state, setState] = useState<HetznerState>({
    connections: [],
    activeId: null,
    lastError: null,
    loading: false,
  });

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await hetznerApi.listConnections();
      setState((s) => ({ ...s, connections, lastError: null }));
      return connections;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, lastError: msg }));
      throw e;
    }
  }, []);

  const connect = useCallback(
    async (connectionId: string, config: HetznerConnectionConfig) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const summary = await hetznerApi.connect(connectionId, config);
        const connections = await hetznerApi.listConnections();
        setState((s) => ({
          ...s,
          connections,
          activeId: connectionId,
          lastError: null,
          loading: false,
        }));
        return summary;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg, loading: false }));
        throw e;
      }
    },
    [],
  );

  const disconnect = useCallback(async (connectionId: string) => {
    await hetznerApi.disconnect(connectionId);
    const connections = await hetznerApi.listConnections();
    setState((s) => ({
      ...s,
      connections,
      activeId: s.activeId === connectionId ? null : s.activeId,
    }));
  }, []);

  return {
    ...state,
    api: hetznerApi,
    refreshConnections,
    connect,
    disconnect,
    setActiveId: (id: string | null) =>
      setState((s) => ({ ...s, activeId: id })),
  };
}

export default useHetzner;
