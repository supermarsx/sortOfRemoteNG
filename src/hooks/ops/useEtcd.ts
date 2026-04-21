/**
 * React hook wrapping the 42 `etcd_*` Tauri commands exposed by the
 * `sorng-etcd` backend crate (see t3-e49 wiring).
 *
 * Tauri converts snake_case command argument names to camelCase on the
 * JS side, so the bindings below use camelCase keys (`leaseId`,
 * `rangeEnd`, `peerUrls`, etc.). Response payloads however follow the
 * etcd crate's serde defaults (snake_case) — see `src/types/etcd.ts`.
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  EtcdAlarm,
  EtcdClusterHealth,
  EtcdConnectionConfig,
  EtcdConnectionSummary,
  EtcdDashboard,
  EtcdDefragResult,
  EtcdEndpointStatus,
  EtcdKeyValue,
  EtcdLease,
  EtcdLeaseTimeToLive,
  EtcdMember,
  EtcdPermission,
  EtcdRangeResponse,
  EtcdRole,
  EtcdStatusResponse,
  EtcdUser,
} from "../../types/etcd";

export const etcdApi = {
  // ── Connection (3) ─────────────────────────────────────────────
  connect: (id: string, config: EtcdConnectionConfig): Promise<EtcdConnectionSummary> =>
    invoke("etcd_connect", { id, config }),
  disconnect: (id: string): Promise<void> => invoke("etcd_disconnect", { id }),
  listConnections: (): Promise<string[]> => invoke("etcd_list_connections"),

  // ── Dashboard (1) ──────────────────────────────────────────────
  getDashboard: (id: string): Promise<EtcdDashboard> =>
    invoke("etcd_get_dashboard", { id }),

  // ── KV (5) ─────────────────────────────────────────────────────
  kvGet: (id: string, key: string): Promise<EtcdKeyValue | null> =>
    invoke("etcd_kv_get", { id, key }),
  kvPut: (id: string, key: string, value: string, lease?: number): Promise<void> =>
    invoke("etcd_kv_put", { id, key, value, lease }),
  kvDelete: (id: string, key: string): Promise<number> =>
    invoke("etcd_kv_delete", { id, key }),
  kvRange: (
    id: string,
    key: string,
    rangeEnd?: string,
    limit?: number,
  ): Promise<EtcdRangeResponse> =>
    invoke("etcd_kv_range", { id, key, rangeEnd, limit }),
  kvGetHistory: (id: string, key: string): Promise<EtcdKeyValue[]> =>
    invoke("etcd_kv_get_history", { id, key }),

  // ── Leases (5) ─────────────────────────────────────────────────
  leaseGrant: (id: string, ttl: number): Promise<EtcdLease> =>
    invoke("etcd_lease_grant", { id, ttl }),
  leaseRevoke: (id: string, leaseId: number): Promise<void> =>
    invoke("etcd_lease_revoke", { id, leaseId }),
  leaseList: (id: string): Promise<EtcdLease[]> => invoke("etcd_lease_list", { id }),
  leaseTtl: (id: string, leaseId: number): Promise<EtcdLeaseTimeToLive> =>
    invoke("etcd_lease_ttl", { id, leaseId }),
  leaseKeepAlive: (id: string, leaseId: number): Promise<void> =>
    invoke("etcd_lease_keep_alive", { id, leaseId }),

  // ── Cluster (7) ────────────────────────────────────────────────
  memberList: (id: string): Promise<EtcdMember[]> => invoke("etcd_member_list", { id }),
  memberAdd: (id: string, peerUrls: string[], isLearner?: boolean): Promise<EtcdMember> =>
    invoke("etcd_member_add", { id, peerUrls, isLearner }),
  memberRemove: (id: string, memberId: number): Promise<void> =>
    invoke("etcd_member_remove", { id, memberId }),
  memberUpdate: (id: string, memberId: number, peerUrls: string[]): Promise<void> =>
    invoke("etcd_member_update", { id, memberId, peerUrls }),
  memberPromote: (id: string, memberId: number): Promise<void> =>
    invoke("etcd_member_promote", { id, memberId }),
  clusterHealth: (id: string): Promise<EtcdClusterHealth> =>
    invoke("etcd_cluster_health", { id }),
  endpointStatus: (id: string): Promise<EtcdEndpointStatus[]> =>
    invoke("etcd_endpoint_status", { id }),

  // ── Auth / Users (8) ───────────────────────────────────────────
  authEnable: (id: string): Promise<void> => invoke("etcd_auth_enable", { id }),
  authDisable: (id: string): Promise<void> => invoke("etcd_auth_disable", { id }),
  userList: (id: string): Promise<EtcdUser[]> => invoke("etcd_user_list", { id }),
  userAdd: (id: string, name: string, password: string): Promise<void> =>
    invoke("etcd_user_add", { id, name, password }),
  userDelete: (id: string, name: string): Promise<void> =>
    invoke("etcd_user_delete", { id, name }),
  userGet: (id: string, name: string): Promise<EtcdUser> =>
    invoke("etcd_user_get", { id, name }),
  userChangePassword: (id: string, name: string, password: string): Promise<void> =>
    invoke("etcd_user_change_password", { id, name, password }),
  userGrantRole: (id: string, user: string, role: string): Promise<void> =>
    invoke("etcd_user_grant_role", { id, user, role }),
  userRevokeRole: (id: string, user: string, role: string): Promise<void> =>
    invoke("etcd_user_revoke_role", { id, user, role }),

  // ── Roles (6) ──────────────────────────────────────────────────
  roleList: (id: string): Promise<EtcdRole[]> => invoke("etcd_role_list", { id }),
  roleAdd: (id: string, name: string): Promise<void> =>
    invoke("etcd_role_add", { id, name }),
  roleDelete: (id: string, name: string): Promise<void> =>
    invoke("etcd_role_delete", { id, name }),
  roleGet: (id: string, name: string): Promise<EtcdRole> =>
    invoke("etcd_role_get", { id, name }),
  roleGrantPermission: (id: string, name: string, permission: EtcdPermission): Promise<void> =>
    invoke("etcd_role_grant_permission", { id, name, permission }),
  roleRevokePermission: (
    id: string,
    name: string,
    key: string,
    rangeEnd: string,
  ): Promise<void> =>
    invoke("etcd_role_revoke_permission", { id, name, key, rangeEnd }),

  // ── Maintenance (6) ────────────────────────────────────────────
  alarmList: (id: string): Promise<EtcdAlarm[]> => invoke("etcd_alarm_list", { id }),
  alarmDisarm: (id: string, memberId: number): Promise<void> =>
    invoke("etcd_alarm_disarm", { id, memberId }),
  defragment: (id: string, endpoint: string): Promise<EtcdDefragResult> =>
    invoke("etcd_defragment", { id, endpoint }),
  status: (id: string): Promise<EtcdStatusResponse> => invoke("etcd_status", { id }),
  moveLeader: (id: string, targetId: number): Promise<void> =>
    invoke("etcd_move_leader", { id, targetId }),
  compact: (id: string, revision: number): Promise<void> =>
    invoke("etcd_compact", { id, revision }),
};

export default function useEtcd() {
  return useMemo(() => etcdApi, []);
}
