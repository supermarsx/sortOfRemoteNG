/**
 * React hook wrapping the 32 `consul_*` Tauri commands exposed by the
 * `sorng-consul` backend crate (see t3-e49 wiring).
 *
 * All calls take a connection `id` that must first be registered via
 * `connect(id, config)`. The backend uses `ConsulServiceState` managed
 * under the `ops` feature gate.
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  AclPolicyCreateRequest,
  AclTokenCreateRequest,
  AgentMember,
  CatalogNode,
  ConsulAclPolicy,
  ConsulAclToken,
  ConsulAgentInfo,
  ConsulAgentMetrics,
  ConsulConnectionConfig,
  ConsulConnectionSummary,
  ConsulDashboard,
  ConsulEvent,
  ConsulHealthCheck,
  ConsulKeyValue,
  ConsulNode,
  ConsulServiceEntry,
  ConsulSession,
  EventFireRequest,
  ServiceRegistration,
  SessionCreateRequest,
} from "../../types/consul";

export const consulApi = {
  // ── Connection (3) ─────────────────────────────────────────────
  connect: (id: string, config: ConsulConnectionConfig): Promise<ConsulConnectionSummary> =>
    invoke("consul_connect", { id, config }),
  disconnect: (id: string): Promise<void> => invoke("consul_disconnect", { id }),
  listConnections: (): Promise<string[]> => invoke("consul_list_connections"),

  // ── Dashboard (1) ──────────────────────────────────────────────
  getDashboard: (id: string): Promise<ConsulDashboard> =>
    invoke("consul_get_dashboard", { id }),

  // ── KV (5) ─────────────────────────────────────────────────────
  kvGet: (id: string, key: string): Promise<ConsulKeyValue> =>
    invoke("consul_kv_get", { id, key }),
  kvPut: (id: string, key: string, value: string): Promise<boolean> =>
    invoke("consul_kv_put", { id, key, value }),
  kvDelete: (id: string, key: string): Promise<boolean> =>
    invoke("consul_kv_delete", { id, key }),
  kvList: (id: string, prefix: string): Promise<string[]> =>
    invoke("consul_kv_list", { id, prefix }),
  kvGetTree: (id: string, prefix: string): Promise<ConsulKeyValue[]> =>
    invoke("consul_kv_get_tree", { id, prefix }),

  // ── Services (4) ───────────────────────────────────────────────
  listServices: (id: string): Promise<Record<string, string[]>> =>
    invoke("consul_list_services", { id }),
  getService: (id: string, name: string): Promise<ConsulServiceEntry[]> =>
    invoke("consul_get_service", { id, name }),
  registerService: (id: string, registration: ServiceRegistration): Promise<void> =>
    invoke("consul_register_service", { id, registration }),
  deregisterService: (id: string, serviceId: string): Promise<void> =>
    invoke("consul_deregister_service", { id, serviceId }),

  // ── Catalog (3) ────────────────────────────────────────────────
  listNodes: (id: string): Promise<ConsulNode[]> => invoke("consul_list_nodes", { id }),
  getNode: (id: string, nodeName: string): Promise<CatalogNode> =>
    invoke("consul_get_node", { id, nodeName }),
  listDatacenters: (id: string): Promise<string[]> =>
    invoke("consul_list_datacenters", { id }),

  // ── Health (2) ─────────────────────────────────────────────────
  nodeHealth: (id: string, node: string): Promise<ConsulHealthCheck[]> =>
    invoke("consul_node_health", { id, node }),
  serviceHealth: (id: string, service: string): Promise<ConsulServiceEntry[]> =>
    invoke("consul_service_health", { id, service }),

  // ── Agent (5) ──────────────────────────────────────────────────
  agentInfo: (id: string): Promise<ConsulAgentInfo> =>
    invoke("consul_agent_info", { id }),
  agentMembers: (id: string): Promise<AgentMember[]> =>
    invoke("consul_agent_members", { id }),
  agentJoin: (id: string, address: string): Promise<void> =>
    invoke("consul_agent_join", { id, address }),
  agentLeave: (id: string): Promise<void> => invoke("consul_agent_leave", { id }),
  agentMetrics: (id: string): Promise<ConsulAgentMetrics> =>
    invoke("consul_agent_metrics", { id }),

  // ── ACL (4) ────────────────────────────────────────────────────
  aclListTokens: (id: string): Promise<ConsulAclToken[]> =>
    invoke("consul_acl_list_tokens", { id }),
  aclCreateToken: (id: string, request: AclTokenCreateRequest): Promise<ConsulAclToken> =>
    invoke("consul_acl_create_token", { id, request }),
  aclListPolicies: (id: string): Promise<ConsulAclPolicy[]> =>
    invoke("consul_acl_list_policies", { id }),
  aclCreatePolicy: (id: string, request: AclPolicyCreateRequest): Promise<ConsulAclPolicy> =>
    invoke("consul_acl_create_policy", { id, request }),

  // ── Sessions (3) ───────────────────────────────────────────────
  sessionsList: (id: string): Promise<ConsulSession[]> =>
    invoke("consul_sessions_list", { id }),
  sessionsCreate: (id: string, request: SessionCreateRequest): Promise<string> =>
    invoke("consul_sessions_create", { id, request }),
  sessionsDelete: (id: string, sessionId: string): Promise<void> =>
    invoke("consul_sessions_delete", { id, sessionId }),

  // ── Events (2) ─────────────────────────────────────────────────
  fireEvent: (id: string, request: EventFireRequest): Promise<ConsulEvent> =>
    invoke("consul_fire_event", { id, request }),
  listEvents: (id: string): Promise<ConsulEvent[]> =>
    invoke("consul_list_events", { id }),
};

export default function useConsul() {
  return useMemo(() => consulApi, []);
}
