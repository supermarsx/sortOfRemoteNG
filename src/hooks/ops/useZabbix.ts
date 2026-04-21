// ── src/hooks/ops/useZabbix.ts ──────────────────────────────────────
// Thin React wrapper over the 53 sorng-zabbix Tauri commands.

import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  ZabbixConnectionConfig,
  ZabbixConnectionSummary,
  ZabbixDashboard,
  ZabbixHost,
  ZabbixHostGroup,
  ZabbixTemplate,
  ZabbixItem,
  ZabbixTrigger,
  ZabbixAction,
  ZabbixAlert,
  ZabbixGraph,
  ZabbixDiscoveryRule,
  ZabbixMaintenance,
  ZabbixUser,
  ZabbixMediaType,
  ZabbixProxy,
  ZabbixProblem,
} from '../../types/zabbix';

export function useZabbix() {
  return useMemo(
    () => ({
      // Connection
      connect: (id: string, config: ZabbixConnectionConfig): Promise<ZabbixConnectionSummary> =>
        invoke('zabbix_connect', { id, config }),
      disconnect: (id: string): Promise<void> => invoke('zabbix_disconnect', { id }),
      listConnections: (): Promise<string[]> => invoke('zabbix_list_connections'),

      // Dashboard
      getDashboard: (id: string): Promise<ZabbixDashboard> =>
        invoke('zabbix_get_dashboard', { id }),

      // Hosts
      listHosts: (id: string, params?: Record<string, unknown>): Promise<ZabbixHost[]> =>
        invoke('zabbix_list_hosts', { id, params }),
      getHost: (id: string, hostid: string): Promise<ZabbixHost> =>
        invoke('zabbix_get_host', { id, hostid }),
      createHost: (id: string, host: ZabbixHost): Promise<string[]> =>
        invoke('zabbix_create_host', { id, host }),
      updateHost: (id: string, host: ZabbixHost): Promise<string[]> =>
        invoke('zabbix_update_host', { id, host }),
      deleteHosts: (id: string, hostids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_hosts', { id, hostids }),

      // Templates
      listTemplates: (id: string, params?: Record<string, unknown>): Promise<ZabbixTemplate[]> =>
        invoke('zabbix_list_templates', { id, params }),
      getTemplate: (id: string, templateid: string): Promise<ZabbixTemplate> =>
        invoke('zabbix_get_template', { id, templateid }),
      createTemplate: (id: string, template: ZabbixTemplate): Promise<string[]> =>
        invoke('zabbix_create_template', { id, template }),
      deleteTemplates: (id: string, templateids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_templates', { id, templateids }),

      // Items
      listItems: (id: string, params?: Record<string, unknown>): Promise<ZabbixItem[]> =>
        invoke('zabbix_list_items', { id, params }),
      getItem: (id: string, itemid: string): Promise<ZabbixItem> =>
        invoke('zabbix_get_item', { id, itemid }),
      createItem: (id: string, item: ZabbixItem): Promise<string[]> =>
        invoke('zabbix_create_item', { id, item }),
      deleteItems: (id: string, itemids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_items', { id, itemids }),

      // Triggers
      listTriggers: (id: string, params?: Record<string, unknown>): Promise<ZabbixTrigger[]> =>
        invoke('zabbix_list_triggers', { id, params }),
      getTrigger: (id: string, triggerid: string): Promise<ZabbixTrigger> =>
        invoke('zabbix_get_trigger', { id, triggerid }),
      createTrigger: (id: string, trigger: ZabbixTrigger): Promise<string[]> =>
        invoke('zabbix_create_trigger', { id, trigger }),
      deleteTriggers: (id: string, triggerids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_triggers', { id, triggerids }),

      // Actions
      listActions: (id: string, params?: Record<string, unknown>): Promise<ZabbixAction[]> =>
        invoke('zabbix_list_actions', { id, params }),
      getAction: (id: string, actionid: string): Promise<ZabbixAction> =>
        invoke('zabbix_get_action', { id, actionid }),
      createAction: (id: string, action: ZabbixAction): Promise<string[]> =>
        invoke('zabbix_create_action', { id, action }),
      deleteActions: (id: string, actionids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_actions', { id, actionids }),

      // Alerts
      listAlerts: (id: string, params?: Record<string, unknown>): Promise<ZabbixAlert[]> =>
        invoke('zabbix_list_alerts', { id, params }),

      // Graphs
      listGraphs: (id: string, params?: Record<string, unknown>): Promise<ZabbixGraph[]> =>
        invoke('zabbix_list_graphs', { id, params }),
      createGraph: (id: string, graph: ZabbixGraph): Promise<string[]> =>
        invoke('zabbix_create_graph', { id, graph }),
      deleteGraphs: (id: string, graphids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_graphs', { id, graphids }),

      // Discovery
      listDiscoveryRules: (
        id: string,
        params?: Record<string, unknown>,
      ): Promise<ZabbixDiscoveryRule[]> => invoke('zabbix_list_discovery_rules', { id, params }),
      createDiscoveryRule: (id: string, rule: ZabbixDiscoveryRule): Promise<string[]> =>
        invoke('zabbix_create_discovery_rule', { id, rule }),
      deleteDiscoveryRules: (id: string, ruleids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_discovery_rules', { id, ruleids }),

      // Maintenance
      listMaintenance: (
        id: string,
        params?: Record<string, unknown>,
      ): Promise<ZabbixMaintenance[]> => invoke('zabbix_list_maintenance', { id, params }),
      createMaintenance: (id: string, maintenance: ZabbixMaintenance): Promise<string[]> =>
        invoke('zabbix_create_maintenance', { id, maintenance }),
      updateMaintenance: (id: string, maintenance: ZabbixMaintenance): Promise<string[]> =>
        invoke('zabbix_update_maintenance', { id, maintenance }),
      deleteMaintenance: (id: string, maintenanceids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_maintenance', { id, maintenanceids }),

      // Users
      listUsers: (id: string, params?: Record<string, unknown>): Promise<ZabbixUser[]> =>
        invoke('zabbix_list_users', { id, params }),
      getUser: (id: string, userid: string): Promise<ZabbixUser> =>
        invoke('zabbix_get_user', { id, userid }),
      createUser: (id: string, user: ZabbixUser): Promise<string[]> =>
        invoke('zabbix_create_user', { id, user }),
      updateUser: (id: string, user: ZabbixUser): Promise<string[]> =>
        invoke('zabbix_update_user', { id, user }),
      deleteUsers: (id: string, userids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_users', { id, userids }),

      // Media types
      listMediaTypes: (id: string, params?: Record<string, unknown>): Promise<ZabbixMediaType[]> =>
        invoke('zabbix_list_media_types', { id, params }),
      createMediaType: (id: string, mediaType: ZabbixMediaType): Promise<string[]> =>
        invoke('zabbix_create_media_type', { id, mediaType }),
      deleteMediaTypes: (id: string, mediatypeids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_media_types', { id, mediatypeids }),

      // Host groups
      listHostGroups: (id: string, params?: Record<string, unknown>): Promise<ZabbixHostGroup[]> =>
        invoke('zabbix_list_host_groups', { id, params }),
      createHostGroup: (id: string, group: ZabbixHostGroup): Promise<string[]> =>
        invoke('zabbix_create_host_group', { id, group }),
      deleteHostGroups: (id: string, groupids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_host_groups', { id, groupids }),

      // Proxies
      listProxies: (id: string, params?: Record<string, unknown>): Promise<ZabbixProxy[]> =>
        invoke('zabbix_list_proxies', { id, params }),
      getProxy: (id: string, proxyid: string): Promise<ZabbixProxy> =>
        invoke('zabbix_get_proxy', { id, proxyid }),
      createProxy: (id: string, proxy: ZabbixProxy): Promise<string[]> =>
        invoke('zabbix_create_proxy', { id, proxy }),
      deleteProxies: (id: string, proxyids: string[]): Promise<string[]> =>
        invoke('zabbix_delete_proxies', { id, proxyids }),

      // Problems
      listProblems: (id: string, params?: Record<string, unknown>): Promise<ZabbixProblem[]> =>
        invoke('zabbix_list_problems', { id, params }),
      acknowledgeProblem: (id: string, eventid: string, message?: string): Promise<unknown> =>
        invoke('zabbix_acknowledge_problem', { id, eventid, message }),
    }),
    [],
  );
}
