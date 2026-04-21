import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  OpenVpnConfig,
  ConnectionInfo,
  ConnectionState,
  ConnectionStats,
  RoutingPolicy,
  DnsConfig,
  ReconnectPolicy,
  HealthCheck,
  LogEntry,
  ValidationResult,
  ConfigTemplate,
  RouteTableEntry,
  DnsLeakResult,
  ExportFormat,
} from '../../types/openvpn';

// Thin hook wrapping the 37 `openvpn_*` Tauri commands exposed by the
// dedicated `sorng-openvpn` crate. The hook is stateless — callers hold
// their own state — so it stays composable with useQuery/useSWR.
export function useOpenVPN() {
  const createConnection = useCallback(
    (
      config: OpenVpnConfig,
      label?: string,
      routingPolicy?: RoutingPolicy,
      dnsConfig?: DnsConfig,
    ) =>
      invoke<ConnectionInfo>('openvpn_create_connection', {
        config,
        label,
        routingPolicy,
        dnsConfig,
      }),
    [],
  );

  const connect = useCallback(
    (connectionId: string) =>
      invoke<void>('openvpn_connect', { connectionId }),
    [],
  );

  const connectWithEvents = useCallback(
    (connectionId: string) =>
      invoke<void>('openvpn_connect_with_events', { connectionId }),
    [],
  );

  const createAndConnect = useCallback(
    (
      config: OpenVpnConfig,
      label?: string,
      routingPolicy?: RoutingPolicy,
      dnsConfig?: DnsConfig,
    ) =>
      invoke<ConnectionInfo>('openvpn_create_and_connect', {
        config,
        label,
        routingPolicy,
        dnsConfig,
      }),
    [],
  );

  const disconnect = useCallback(
    (connectionId: string) =>
      invoke<void>('openvpn_disconnect', { connectionId }),
    [],
  );

  const disconnectAll = useCallback(
    () => invoke<string[]>('openvpn_disconnect_all'),
    [],
  );

  const removeConnection = useCallback(
    (connectionId: string) =>
      invoke<void>('openvpn_remove_connection', { connectionId }),
    [],
  );

  const listConnections = useCallback(
    () => invoke<ConnectionInfo[]>('openvpn_list_connections'),
    [],
  );

  const getConnectionInfo = useCallback(
    (connectionId: string) =>
      invoke<ConnectionInfo>('openvpn_get_connection_info', { connectionId }),
    [],
  );

  const getStatus = useCallback(
    (connectionId: string) =>
      invoke<ConnectionState>('openvpn_get_status', { connectionId }),
    [],
  );

  const getStats = useCallback(
    (connectionId: string) =>
      invoke<ConnectionStats>('openvpn_get_stats', { connectionId }),
    [],
  );

  const sendAuth = useCallback(
    (connectionId: string, username: string, password: string) =>
      invoke<void>('openvpn_send_auth', { connectionId, username, password }),
    [],
  );

  const sendOtp = useCallback(
    (connectionId: string, otp: string) =>
      invoke<void>('openvpn_send_otp', { connectionId, otp }),
    [],
  );

  const importConfig = useCallback(
    (ovpnContent: string) =>
      invoke<OpenVpnConfig>('openvpn_import_config', { ovpnContent }),
    [],
  );

  const exportConfig = useCallback(
    (connectionId: string) =>
      invoke<string>('openvpn_export_config', { connectionId }),
    [],
  );

  const validateConfig = useCallback(
    (ovpnContent: string) =>
      invoke<ValidationResult>('openvpn_validate_config', { ovpnContent }),
    [],
  );

  const getConfigTemplates = useCallback(
    () => invoke<ConfigTemplate[]>('openvpn_get_config_templates'),
    [],
  );

  const setRoutingPolicy = useCallback(
    (connectionId: string, policy: RoutingPolicy) =>
      invoke<void>('openvpn_set_routing_policy', { connectionId, policy }),
    [],
  );

  const getRoutingPolicy = useCallback(
    (connectionId: string) =>
      invoke<RoutingPolicy>('openvpn_get_routing_policy', { connectionId }),
    [],
  );

  const captureRouteTable = useCallback(
    () => invoke<RouteTableEntry[]>('openvpn_capture_route_table'),
    [],
  );

  const setDnsConfig = useCallback(
    (connectionId: string, config: DnsConfig) =>
      invoke<void>('openvpn_set_dns_config', { connectionId, config }),
    [],
  );

  const getDnsConfig = useCallback(
    (connectionId: string) =>
      invoke<DnsConfig>('openvpn_get_dns_config', { connectionId }),
    [],
  );

  const checkDnsLeak = useCallback(
    (expectedServers: string[], testDomain?: string) =>
      invoke<DnsLeakResult>('openvpn_check_dns_leak', {
        expectedServers,
        testDomain,
      }),
    [],
  );

  const flushDns = useCallback(() => invoke<void>('openvpn_flush_dns'), []);

  const checkHealth = useCallback(
    (connectionId: string) =>
      invoke<HealthCheck>('openvpn_check_health', { connectionId }),
    [],
  );

  const getLogs = useCallback(
    (connectionId: string, tail?: number) =>
      invoke<LogEntry[]>('openvpn_get_logs', { connectionId, tail }),
    [],
  );

  const searchLogs = useCallback(
    (connectionId: string, query: string) =>
      invoke<LogEntry[]>('openvpn_search_logs', { connectionId, query }),
    [],
  );

  const exportLogs = useCallback(
    (connectionId: string, format: ExportFormat) =>
      invoke<string>('openvpn_export_logs', { connectionId, format }),
    [],
  );

  const clearLogs = useCallback(
    (connectionId: string) =>
      invoke<void>('openvpn_clear_logs', { connectionId }),
    [],
  );

  const mgmtCommand = useCallback(
    (connectionId: string, command: string) =>
      invoke<void>('openvpn_mgmt_command', { connectionId, command }),
    [],
  );

  const detectVersion = useCallback(
    () => invoke<string>('openvpn_detect_version'),
    [],
  );

  const findBinary = useCallback(
    () => invoke<string | null>('openvpn_find_binary'),
    [],
  );

  const getBinaryPaths = useCallback(
    () => invoke<string[]>('openvpn_get_binary_paths'),
    [],
  );

  const setDefaultReconnect = useCallback(
    (policy: ReconnectPolicy) =>
      invoke<void>('openvpn_set_default_reconnect', { policy }),
    [],
  );

  const getDefaultReconnect = useCallback(
    () => invoke<ReconnectPolicy>('openvpn_get_default_reconnect'),
    [],
  );

  const setDefaultRouting = useCallback(
    (policy: RoutingPolicy) =>
      invoke<void>('openvpn_set_default_routing', { policy }),
    [],
  );

  const setDefaultDns = useCallback(
    (config: DnsConfig) =>
      invoke<void>('openvpn_set_default_dns', { config }),
    [],
  );

  return {
    createConnection,
    connect,
    connectWithEvents,
    createAndConnect,
    disconnect,
    disconnectAll,
    removeConnection,
    listConnections,
    getConnectionInfo,
    getStatus,
    getStats,
    sendAuth,
    sendOtp,
    importConfig,
    exportConfig,
    validateConfig,
    getConfigTemplates,
    setRoutingPolicy,
    getRoutingPolicy,
    captureRouteTable,
    setDnsConfig,
    getDnsConfig,
    checkDnsLeak,
    flushDns,
    checkHealth,
    getLogs,
    searchLogs,
    exportLogs,
    clearLogs,
    mgmtCommand,
    detectVersion,
    findBinary,
    getBinaryPaths,
    setDefaultReconnect,
    getDefaultReconnect,
    setDefaultRouting,
    setDefaultDns,
  };
}
