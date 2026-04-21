import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  CimInstance,
  CimMethodParams,
  CimQueryParams,
  CimSessionConfig,
  DscConfiguration,
  DscResourceState,
  DscResult,
  FirewallRuleInfo,
  HyperVVmInfo,
  JeaEndpoint,
  JeaRoleCapability,
  LatencyResult,
  NewSessionConfigurationParams,
  PsCertificateInfo,
  PsCommandOutput,
  PsDiagnosticResult,
  PsDirectConfig,
  PsFileCopyParams,
  PsFileTransferProgress,
  PsInvokeCommandParams,
  PsRemotingConfig,
  PsRemotingEvent,
  PsRemotingStats,
  PsSession,
  PsSessionConfiguration,
  SetSessionConfigurationParams,
  WinRmServiceStatus,
} from '../../types/powershell';

/**
 * React hook wrapping the 53 `ps_*` Tauri commands exposed by
 * `sorng-powershell`. Each method is a typed invoke() over the
 * backend command surface.
 *
 * The hook is stateless — it only packages command invocations.
 * Callers are responsible for storing sessions, progress handles,
 * and command output in their own state.
 */
export function usePowerShellClient() {
  // ─── Session lifecycle ───────────────────────────────────────────
  const newSession = useCallback(
    (config: PsRemotingConfig, name?: string) =>
      invoke<PsSession>('ps_new_session', { config, name }),
    [],
  );

  const getSession = useCallback(
    (sessionId: string) =>
      invoke<PsSession>('ps_get_session', { sessionId }),
    [],
  );

  const listSessions = useCallback(
    () => invoke<PsSession[]>('ps_list_sessions'),
    [],
  );

  const disconnectSession = useCallback(
    (sessionId: string) =>
      invoke<void>('ps_disconnect_session', { sessionId }),
    [],
  );

  const reconnectSession = useCallback(
    (sessionId: string) =>
      invoke<void>('ps_reconnect_session', { sessionId }),
    [],
  );

  const removeSession = useCallback(
    (sessionId: string) => invoke<void>('ps_remove_session', { sessionId }),
    [],
  );

  const removeAllSessions = useCallback(
    () => invoke<number>('ps_remove_all_sessions'),
    [],
  );

  // ─── Command execution ───────────────────────────────────────────
  const invokeCommand = useCallback(
    (sessionId: string, params: PsInvokeCommandParams) =>
      invoke<PsCommandOutput>('ps_invoke_command', { sessionId, params }),
    [],
  );

  const invokeCommandFanout = useCallback(
    (sessionIds: string[], params: PsInvokeCommandParams) =>
      invoke<Array<PsCommandOutput | { error: string }>>(
        'ps_invoke_command_fanout',
        { sessionIds, params },
      ),
    [],
  );

  const stopCommand = useCallback(
    (sessionId: string, commandId: string) =>
      invoke<void>('ps_stop_command', { sessionId, commandId }),
    [],
  );

  // ─── Interactive sessions ────────────────────────────────────────
  const enterSession = useCallback(
    (sessionId: string) => invoke<string>('ps_enter_session', { sessionId }),
    [],
  );

  const executeInteractiveLine = useCallback(
    (sessionId: string, line: string) =>
      invoke<string>('ps_execute_interactive_line', { sessionId, line }),
    [],
  );

  const tabComplete = useCallback(
    (sessionId: string, partial: string) =>
      invoke<string[]>('ps_tab_complete', { sessionId, partial }),
    [],
  );

  const exitSession = useCallback(
    (sessionId: string) => invoke<void>('ps_exit_session', { sessionId }),
    [],
  );

  // ─── File transfer ───────────────────────────────────────────────
  const copyToSession = useCallback(
    (sessionId: string, params: PsFileCopyParams) =>
      invoke<string>('ps_copy_to_session', { sessionId, params }),
    [],
  );

  const copyFromSession = useCallback(
    (sessionId: string, params: PsFileCopyParams) =>
      invoke<string>('ps_copy_from_session', { sessionId, params }),
    [],
  );

  const getTransferProgress = useCallback(
    (transferId: string) =>
      invoke<PsFileTransferProgress>('ps_get_transfer_progress', {
        transferId,
      }),
    [],
  );

  const cancelTransfer = useCallback(
    (transferId: string) =>
      invoke<void>('ps_cancel_transfer', { transferId }),
    [],
  );

  const listTransfers = useCallback(
    () => invoke<PsFileTransferProgress[]>('ps_list_transfers'),
    [],
  );

  // ─── CIM ─────────────────────────────────────────────────────────
  const newCimSession = useCallback(
    (sessionId: string, config: CimSessionConfig) =>
      invoke<string>('ps_new_cim_session', { sessionId, config }),
    [],
  );

  const getCimInstances = useCallback(
    (sessionId: string, cimSessionId: string, params: CimQueryParams) =>
      invoke<CimInstance[]>('ps_get_cim_instances', {
        sessionId,
        cimSessionId,
        params,
      }),
    [],
  );

  const invokeCimMethod = useCallback(
    (sessionId: string, cimSessionId: string, params: CimMethodParams) =>
      invoke<unknown>('ps_invoke_cim_method', {
        sessionId,
        cimSessionId,
        params,
      }),
    [],
  );

  const removeCimSession = useCallback(
    (sessionId: string, cimSessionId: string) =>
      invoke<void>('ps_remove_cim_session', { sessionId, cimSessionId }),
    [],
  );

  // ─── DSC ─────────────────────────────────────────────────────────
  const testDscConfiguration = useCallback(
    (sessionId: string) =>
      invoke<DscResult>('ps_test_dsc_configuration', { sessionId }),
    [],
  );

  const getDscConfiguration = useCallback(
    (sessionId: string) =>
      invoke<DscResourceState[]>('ps_get_dsc_configuration', { sessionId }),
    [],
  );

  const startDscConfiguration = useCallback(
    (sessionId: string, configuration: DscConfiguration) =>
      invoke<DscResult>('ps_start_dsc_configuration', {
        sessionId,
        configuration,
      }),
    [],
  );

  const getDscResources = useCallback(
    (sessionId: string) =>
      invoke<unknown[]>('ps_get_dsc_resources', { sessionId }),
    [],
  );

  // ─── JEA ─────────────────────────────────────────────────────────
  const registerJeaEndpoint = useCallback(
    (sessionId: string, endpoint: JeaEndpoint) =>
      invoke<void>('ps_register_jea_endpoint', { sessionId, endpoint }),
    [],
  );

  const unregisterJeaEndpoint = useCallback(
    (sessionId: string, endpointName: string) =>
      invoke<void>('ps_unregister_jea_endpoint', { sessionId, endpointName }),
    [],
  );

  const listJeaEndpoints = useCallback(
    (sessionId: string) =>
      invoke<PsSessionConfiguration[]>('ps_list_jea_endpoints', { sessionId }),
    [],
  );

  const createJeaRoleCapability = useCallback(
    (sessionId: string, roleName: string, capability: JeaRoleCapability) =>
      invoke<string>('ps_create_jea_role_capability', {
        sessionId,
        roleName,
        capability,
      }),
    [],
  );

  // ─── PowerShell Direct (Hyper-V VM) ──────────────────────────────
  const listVms = useCallback(
    (sessionId: string) =>
      invoke<HyperVVmInfo[]>('ps_list_vms', { sessionId }),
    [],
  );

  const invokeCommandVm = useCallback(
    (sessionId: string, config: PsDirectConfig, script: string) =>
      invoke<PsCommandOutput>('ps_invoke_command_vm', {
        sessionId,
        config,
        script,
      }),
    [],
  );

  const copyToVm = useCallback(
    (
      sessionId: string,
      config: PsDirectConfig,
      source: string,
      destination: string,
    ) =>
      invoke<void>('ps_copy_to_vm', {
        sessionId,
        config,
        source,
        destination,
      }),
    [],
  );

  // ─── Session configuration ───────────────────────────────────────
  const getSessionConfigurations = useCallback(
    (sessionId: string) =>
      invoke<PsSessionConfiguration[]>('ps_get_session_configurations', {
        sessionId,
      }),
    [],
  );

  const registerSessionConfiguration = useCallback(
    (sessionId: string, config: NewSessionConfigurationParams) =>
      invoke<void>('ps_register_session_configuration', { sessionId, config }),
    [],
  );

  const unregisterSessionConfiguration = useCallback(
    (sessionId: string, configName: string) =>
      invoke<void>('ps_unregister_session_configuration', {
        sessionId,
        configName,
      }),
    [],
  );

  const enableSessionConfiguration = useCallback(
    (sessionId: string, configName: string) =>
      invoke<void>('ps_enable_session_configuration', {
        sessionId,
        configName,
      }),
    [],
  );

  const disableSessionConfiguration = useCallback(
    (sessionId: string, configName: string) =>
      invoke<void>('ps_disable_session_configuration', {
        sessionId,
        configName,
      }),
    [],
  );

  const setSessionConfiguration = useCallback(
    (
      sessionId: string,
      configName: string,
      params: SetSessionConfigurationParams,
    ) =>
      invoke<void>('ps_set_session_configuration', {
        sessionId,
        configName,
        params,
      }),
    [],
  );

  const getWinrmConfig = useCallback(
    (sessionId: string) =>
      invoke<unknown>('ps_get_winrm_config', { sessionId }),
    [],
  );

  const getTrustedHosts = useCallback(
    (sessionId: string) =>
      invoke<string[]>('ps_get_trusted_hosts', { sessionId }),
    [],
  );

  const setTrustedHosts = useCallback(
    (sessionId: string, hosts: string[]) =>
      invoke<void>('ps_set_trusted_hosts', { sessionId, hosts }),
    [],
  );

  // ─── Diagnostics ─────────────────────────────────────────────────
  const testWsman = useCallback(
    (config: PsRemotingConfig) =>
      invoke<PsDiagnosticResult>('ps_test_wsman', { config }),
    [],
  );

  const diagnoseConnection = useCallback(
    (config: PsRemotingConfig) =>
      invoke<PsDiagnosticResult>('ps_diagnose_connection', { config }),
    [],
  );

  const checkWinrmService = useCallback(
    (sessionId: string) =>
      invoke<WinRmServiceStatus>('ps_check_winrm_service', { sessionId }),
    [],
  );

  const checkFirewallRules = useCallback(
    (sessionId: string) =>
      invoke<FirewallRuleInfo[]>('ps_check_firewall_rules', { sessionId }),
    [],
  );

  const measureLatency = useCallback(
    (sessionId: string, iterations?: number) =>
      invoke<LatencyResult>('ps_measure_latency', { sessionId, iterations }),
    [],
  );

  const getCertificateInfo = useCallback(
    (sessionId: string) =>
      invoke<PsCertificateInfo[]>('ps_get_certificate_info', { sessionId }),
    [],
  );

  // ─── Service stats / events ──────────────────────────────────────
  const getStats = useCallback(
    () => invoke<PsRemotingStats>('ps_get_stats'),
    [],
  );

  const getEvents = useCallback(
    (limit?: number) =>
      invoke<PsRemotingEvent[]>('ps_get_events', { limit }),
    [],
  );

  const clearEvents = useCallback(
    () => invoke<void>('ps_clear_events'),
    [],
  );

  const cleanup = useCallback(() => invoke<void>('ps_cleanup'), []);

  return {
    // Sessions
    newSession,
    getSession,
    listSessions,
    disconnectSession,
    reconnectSession,
    removeSession,
    removeAllSessions,
    // Command execution
    invokeCommand,
    invokeCommandFanout,
    stopCommand,
    // Interactive
    enterSession,
    executeInteractiveLine,
    tabComplete,
    exitSession,
    // File transfer
    copyToSession,
    copyFromSession,
    getTransferProgress,
    cancelTransfer,
    listTransfers,
    // CIM
    newCimSession,
    getCimInstances,
    invokeCimMethod,
    removeCimSession,
    // DSC
    testDscConfiguration,
    getDscConfiguration,
    startDscConfiguration,
    getDscResources,
    // JEA
    registerJeaEndpoint,
    unregisterJeaEndpoint,
    listJeaEndpoints,
    createJeaRoleCapability,
    // Direct (Hyper-V VM)
    listVms,
    invokeCommandVm,
    copyToVm,
    // Session configuration
    getSessionConfigurations,
    registerSessionConfiguration,
    unregisterSessionConfiguration,
    enableSessionConfiguration,
    disableSessionConfiguration,
    setSessionConfiguration,
    getWinrmConfig,
    getTrustedHosts,
    setTrustedHosts,
    // Diagnostics
    testWsman,
    diagnoseConnection,
    checkWinrmService,
    checkFirewallRules,
    measureLatency,
    getCertificateInfo,
    // Stats / events
    getStats,
    getEvents,
    clearEvents,
    cleanup,
  } as const;
}

export type UsePowerShellClient = ReturnType<typeof usePowerShellClient>;
