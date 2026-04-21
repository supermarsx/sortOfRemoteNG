import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BindingInfo,
  ChannelInfo,
  ClusterNode,
  ConnectionInfo,
  ConsumerInfo,
  DefinitionsExport,
  ExchangeInfo,
  FederationLink,
  FederationUpstream,
  FederationUpstreamDef,
  OverviewInfo,
  PermissionInfo,
  PolicyInfo,
  QueueInfo,
  RabbitConnectionConfig,
  RabbitSession,
  ShovelDefinition,
  ShovelInfo,
  UserInfo,
  VhostInfo,
} from "../../types/rabbitmq";

export function useRabbitMQ() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wrap = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Session ---
  const connect = (config: RabbitConnectionConfig) =>
    wrap(async () => {
      const s = await invoke<RabbitSession>("rabbit_connect", { config });
      setSessionId(s.id);
      return s;
    });
  const disconnect = (id: string) =>
    wrap(() => invoke<void>("rabbit_disconnect", { sessionId: id }));
  const listSessions = () =>
    wrap(() => invoke<RabbitSession[]>("rabbit_list_sessions"));
  const testConnection = (id: string) =>
    wrap(() => invoke<boolean>("rabbit_test_connection", { sessionId: id }));

  // --- Vhosts ---
  const listVhosts = (id: string) =>
    wrap(() => invoke<VhostInfo[]>("rabbit_list_vhosts", { sessionId: id }));
  const getVhost = (id: string, name: string) =>
    wrap(() => invoke<VhostInfo>("rabbit_get_vhost", { sessionId: id, name }));
  const createVhost = (id: string, name: string, description?: string, tracing?: boolean) =>
    wrap(() =>
      invoke<void>("rabbit_create_vhost", { sessionId: id, name, description, tracing }),
    );
  const deleteVhost = (id: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_vhost", { sessionId: id, name }));

  // --- Exchanges ---
  const listExchanges = (id: string, vhost?: string) =>
    wrap(() => invoke<ExchangeInfo[]>("rabbit_list_exchanges", { sessionId: id, vhost }));
  const getExchange = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<ExchangeInfo>("rabbit_get_exchange", { sessionId: id, vhost, name }));
  const createExchange = (id: string, vhost: string, exchange: ExchangeInfo) =>
    wrap(() => invoke<void>("rabbit_create_exchange", { sessionId: id, vhost, exchange }));
  const deleteExchange = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_exchange", { sessionId: id, vhost, name }));

  // --- Queues ---
  const listQueues = (id: string, vhost?: string) =>
    wrap(() => invoke<QueueInfo[]>("rabbit_list_queues", { sessionId: id, vhost }));
  const getQueue = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<QueueInfo>("rabbit_get_queue", { sessionId: id, vhost, name }));
  const createQueue = (id: string, vhost: string, queue: QueueInfo) =>
    wrap(() => invoke<void>("rabbit_create_queue", { sessionId: id, vhost, queue }));
  const deleteQueue = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_queue", { sessionId: id, vhost, name }));
  const purgeQueue = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_purge_queue", { sessionId: id, vhost, name }));

  // --- Bindings ---
  const listBindings = (id: string, vhost?: string) =>
    wrap(() => invoke<BindingInfo[]>("rabbit_list_bindings", { sessionId: id, vhost }));
  const createBinding = (id: string, vhost: string, binding: BindingInfo) =>
    wrap(() => invoke<void>("rabbit_create_binding", { sessionId: id, vhost, binding }));
  const deleteBinding = (id: string, vhost: string, binding: BindingInfo) =>
    wrap(() => invoke<void>("rabbit_delete_binding", { sessionId: id, vhost, binding }));

  // --- Users / permissions ---
  const listUsers = (id: string) =>
    wrap(() => invoke<UserInfo[]>("rabbit_list_users", { sessionId: id }));
  const createUser = (id: string, user: UserInfo, password: string) =>
    wrap(() => invoke<void>("rabbit_create_user", { sessionId: id, user, password }));
  const deleteUser = (id: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_user", { sessionId: id, name }));
  const listPermissions = (id: string) =>
    wrap(() => invoke<PermissionInfo[]>("rabbit_list_permissions", { sessionId: id }));
  const setPermission = (id: string, permission: PermissionInfo) =>
    wrap(() => invoke<void>("rabbit_set_permission", { sessionId: id, permission }));

  // --- Policies ---
  const listPolicies = (id: string) =>
    wrap(() => invoke<PolicyInfo[]>("rabbit_list_policies", { sessionId: id }));
  const createPolicy = (id: string, policy: PolicyInfo) =>
    wrap(() => invoke<void>("rabbit_create_policy", { sessionId: id, policy }));
  const deletePolicy = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_policy", { sessionId: id, vhost, name }));

  // --- Shovels ---
  const listShovels = (id: string) =>
    wrap(() => invoke<ShovelInfo[]>("rabbit_list_shovels", { sessionId: id }));
  const createShovel = (id: string, shovel: ShovelDefinition) =>
    wrap(() => invoke<void>("rabbit_create_shovel", { sessionId: id, shovel }));
  const deleteShovel = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_shovel", { sessionId: id, vhost, name }));
  const restartShovel = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_restart_shovel", { sessionId: id, vhost, name }));

  // --- Federation ---
  const listFederationUpstreams = (id: string) =>
    wrap(() => invoke<FederationUpstream[]>("rabbit_list_federation_upstreams", { sessionId: id }));
  const createFederationUpstream = (id: string, upstream: FederationUpstreamDef) =>
    wrap(() => invoke<void>("rabbit_create_federation_upstream", { sessionId: id, upstream }));
  const deleteFederationUpstream = (id: string, vhost: string, name: string) =>
    wrap(() => invoke<void>("rabbit_delete_federation_upstream", { sessionId: id, vhost, name }));
  const listFederationLinks = (id: string) =>
    wrap(() => invoke<FederationLink[]>("rabbit_list_federation_links", { sessionId: id }));

  // --- Cluster ---
  const listNodes = (id: string) =>
    wrap(() => invoke<ClusterNode[]>("rabbit_list_nodes", { sessionId: id }));
  const getNode = (id: string, name: string) =>
    wrap(() => invoke<ClusterNode>("rabbit_get_node", { sessionId: id, name }));
  const getClusterName = (id: string) =>
    wrap(() => invoke<string>("rabbit_get_cluster_name", { sessionId: id }));
  const setClusterName = (id: string, name: string) =>
    wrap(() => invoke<void>("rabbit_set_cluster_name", { sessionId: id, name }));
  const checkAlarms = (id: string) =>
    wrap(() => invoke<string[]>("rabbit_check_alarms", { sessionId: id }));

  // --- Connections / channels / consumers ---
  const listConnections = (id: string) =>
    wrap(() => invoke<ConnectionInfo[]>("rabbit_list_connections", { sessionId: id }));
  const getConnection = (id: string, name: string) =>
    wrap(() => invoke<ConnectionInfo>("rabbit_get_connection", { sessionId: id, name }));
  const closeConnection = (id: string, name: string, reason?: string) =>
    wrap(() => invoke<void>("rabbit_close_connection", { sessionId: id, name, reason }));
  const listChannels = (id: string) =>
    wrap(() => invoke<ChannelInfo[]>("rabbit_list_channels", { sessionId: id }));
  const getChannel = (id: string, name: string) =>
    wrap(() => invoke<ChannelInfo>("rabbit_get_channel", { sessionId: id, name }));
  const listConsumers = (id: string) =>
    wrap(() => invoke<ConsumerInfo[]>("rabbit_list_consumers", { sessionId: id }));
  const cancelConsumer = (id: string, vhost: string, channel: string, consumerTag: string) =>
    wrap(() =>
      invoke<void>("rabbit_cancel_consumer", { sessionId: id, vhost, channel, consumerTag }),
    );

  // --- Monitoring ---
  const getOverview = (id: string) =>
    wrap(() => invoke<OverviewInfo>("rabbit_get_overview", { sessionId: id }));
  const getMessageRates = (id: string) =>
    wrap(() => invoke<Record<string, number>>("rabbit_get_message_rates", { sessionId: id }));
  const getQueueRates = (id: string, vhost?: string) =>
    wrap(() =>
      invoke<Record<string, number>>("rabbit_get_queue_rates", { sessionId: id, vhost }),
    );
  const monitoringSnapshot = (id: string) =>
    wrap(() => invoke<unknown>("rabbit_monitoring_snapshot", { sessionId: id }));
  const alivenessTest = (id: string, vhost: string) =>
    wrap(() => invoke<boolean>("rabbit_aliveness_test", { sessionId: id, vhost }));

  // --- Definitions ---
  const exportDefinitions = (id: string) =>
    wrap(() => invoke<DefinitionsExport>("rabbit_export_definitions", { sessionId: id }));
  const importDefinitions = (id: string, definitions: DefinitionsExport) =>
    wrap(() => invoke<void>("rabbit_import_definitions", { sessionId: id, definitions }));
  const exportVhostDefinitions = (id: string, vhost: string) =>
    wrap(() =>
      invoke<DefinitionsExport>("rabbit_export_vhost_definitions", { sessionId: id, vhost }),
    );
  const cloneVhost = (id: string, source: string, destination: string) =>
    wrap(() => invoke<void>("rabbit_clone_vhost", { sessionId: id, source, destination }));
  const definitionsSummary = (id: string) =>
    wrap(() => invoke<Record<string, number>>("rabbit_definitions_summary", { sessionId: id }));

  return {
    sessionId,
    error,
    loading,
    connect,
    disconnect,
    listSessions,
    testConnection,
    listVhosts,
    getVhost,
    createVhost,
    deleteVhost,
    listExchanges,
    getExchange,
    createExchange,
    deleteExchange,
    listQueues,
    getQueue,
    createQueue,
    deleteQueue,
    purgeQueue,
    listBindings,
    createBinding,
    deleteBinding,
    listUsers,
    createUser,
    deleteUser,
    listPermissions,
    setPermission,
    listPolicies,
    createPolicy,
    deletePolicy,
    listShovels,
    createShovel,
    deleteShovel,
    restartShovel,
    listFederationUpstreams,
    createFederationUpstream,
    deleteFederationUpstream,
    listFederationLinks,
    listNodes,
    getNode,
    getClusterName,
    setClusterName,
    checkAlarms,
    listConnections,
    getConnection,
    closeConnection,
    listChannels,
    getChannel,
    listConsumers,
    cancelConsumer,
    getOverview,
    getMessageRates,
    getQueueRates,
    monitoringSnapshot,
    alivenessTest,
    exportDefinitions,
    importDefinitions,
    exportVhostDefinitions,
    cloneVhost,
    definitionsSummary,
  };
}
