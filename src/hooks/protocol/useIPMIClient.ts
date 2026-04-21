import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  BootDevice,
  ChassisControl,
  ChassisStatus,
  ChannelInfo,
  CipherSuite,
  FruDeviceInfo,
  IpmiDeviceId,
  IpmiSessionConfig,
  IpmiSessionInfo,
  IpmiUser,
  LanConfig,
  PefCapabilities,
  RawIpmiResponse,
  SdrFullSensor,
  SdrRecord,
  SelEntry,
  SelInfo,
  SensorReading,
  SensorThresholds,
  SolConfig,
  SolSession,
  WatchdogTimer,
} from '../../types/ipmi';

/**
 * IPMI client hook — backed by the real Rust `sorng-ipmi` crate via Tauri
 * `invoke("ipmi_*", …)` commands. Manages one session at a time; callers
 * can run multiple hook instances for multiple BMCs.
 */
export function useIPMIClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<IpmiSessionInfo | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);

  const toMsg = (e: unknown) =>
    typeof e === 'string' ? e : (e as Error)?.message ?? String(e);

  // ── Connection ─────────────────────────────────────────────────────

  const connect = useCallback(
    async (config: IpmiSessionConfig): Promise<string> => {
      if (connectingRef.current) throw new Error('IPMI connect already in progress');
      connectingRef.current = true;
      setIsConnecting(true);
      setError(null);
      try {
        const id = await invoke<string>('ipmi_connect', { config });
        setSessionId(id);
        try {
          const info = await invoke<IpmiSessionInfo>('ipmi_get_session', {
            sessionId: id,
          });
          setSessionInfo(info);
        } catch {
          /* session info best-effort */
        }
        return id;
      } catch (e) {
        setError(`IPMI connect failed: ${toMsg(e)}`);
        throw e;
      } finally {
        connectingRef.current = false;
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      await invoke<void>('ipmi_disconnect', { sessionId });
    } catch (e) {
      console.warn('ipmi_disconnect failed:', e);
    } finally {
      setSessionId(null);
      setSessionInfo(null);
    }
  }, [sessionId]);

  const disconnectAll = useCallback(async () => {
    await invoke<void>('ipmi_disconnect_all');
    setSessionId(null);
    setSessionInfo(null);
  }, []);

  const listSessions = useCallback(
    () => invoke<IpmiSessionInfo[]>('ipmi_list_sessions'),
    [],
  );

  const ping = useCallback(
    (host: string, port?: number) => invoke<boolean>('ipmi_ping', { host, port }),
    [],
  );

  // ── Chassis / Power ────────────────────────────────────────────────

  const need = (): string => {
    if (!sessionId) throw new Error('IPMI not connected');
    return sessionId;
  };

  const getChassisStatus = useCallback(
    () => invoke<ChassisStatus>('ipmi_get_chassis_status', { sessionId: need() }),
    [sessionId],
  );

  const chassisControl = useCallback(
    (action: ChassisControl) =>
      invoke<void>('ipmi_chassis_control', { sessionId: need(), action }),
    [sessionId],
  );

  const powerOn = useCallback(
    () => invoke<void>('ipmi_power_on', { sessionId: need() }),
    [sessionId],
  );
  const powerOff = useCallback(
    () => invoke<void>('ipmi_power_off', { sessionId: need() }),
    [sessionId],
  );
  const powerCycle = useCallback(
    () => invoke<void>('ipmi_power_cycle', { sessionId: need() }),
    [sessionId],
  );
  const hardReset = useCallback(
    () => invoke<void>('ipmi_hard_reset', { sessionId: need() }),
    [sessionId],
  );
  const softShutdown = useCallback(
    () => invoke<void>('ipmi_soft_shutdown', { sessionId: need() }),
    [sessionId],
  );

  const chassisIdentify = useCallback(
    (duration?: number, force?: boolean) =>
      invoke<void>('ipmi_chassis_identify', {
        sessionId: need(),
        duration,
        force,
      }),
    [sessionId],
  );

  const setBootDevice = useCallback(
    (device: BootDevice, persistent?: boolean, efi?: boolean) =>
      invoke<void>('ipmi_set_boot_device', {
        sessionId: need(),
        device,
        persistent,
        efi,
      }),
    [sessionId],
  );

  const getDeviceId = useCallback(
    () => invoke<IpmiDeviceId>('ipmi_get_device_id', { sessionId: need() }),
    [sessionId],
  );

  // ── Sensors / SDR ──────────────────────────────────────────────────

  const getAllSdrRecords = useCallback(
    () => invoke<SdrRecord[]>('ipmi_get_all_sdr_records', { sessionId: need() }),
    [sessionId],
  );

  const readSensor = useCallback(
    (sensor: SdrFullSensor) =>
      invoke<SensorReading>('ipmi_read_sensor', { sessionId: need(), sensor }),
    [sessionId],
  );

  const getSensorThresholds = useCallback(
    (sensorNumber: number, sdr: SdrFullSensor) =>
      invoke<SensorThresholds>('ipmi_get_sensor_thresholds', {
        sessionId: need(),
        sensorNumber,
        sdr,
      }),
    [sessionId],
  );

  // ── SEL ────────────────────────────────────────────────────────────

  const getSelInfo = useCallback(
    () => invoke<SelInfo>('ipmi_get_sel_info', { sessionId: need() }),
    [sessionId],
  );
  const getAllSelEntries = useCallback(
    () => invoke<SelEntry[]>('ipmi_get_all_sel_entries', { sessionId: need() }),
    [sessionId],
  );
  const clearSel = useCallback(
    () => invoke<void>('ipmi_clear_sel', { sessionId: need() }),
    [sessionId],
  );
  const deleteSelEntry = useCallback(
    (recordId: number) =>
      invoke<number>('ipmi_delete_sel_entry', { sessionId: need(), recordId }),
    [sessionId],
  );

  // ── FRU ────────────────────────────────────────────────────────────

  const getFruInfo = useCallback(
    (deviceId?: number) =>
      invoke<FruDeviceInfo>('ipmi_get_fru_info', { sessionId: need(), deviceId }),
    [sessionId],
  );

  // ── SOL ────────────────────────────────────────────────────────────

  const getSolConfig = useCallback(
    (channel?: number) =>
      invoke<SolConfig>('ipmi_get_sol_config', { sessionId: need(), channel }),
    [sessionId],
  );
  const activateSol = useCallback(
    (instance?: number, encrypt?: boolean, auth?: boolean) =>
      invoke<SolSession>('ipmi_activate_sol', {
        sessionId: need(),
        instance,
        encrypt,
        auth,
      }),
    [sessionId],
  );
  const deactivateSol = useCallback(
    (instance?: number) =>
      invoke<void>('ipmi_deactivate_sol', { sessionId: need(), instance }),
    [sessionId],
  );

  // ── Watchdog ───────────────────────────────────────────────────────

  const getWatchdogTimer = useCallback(
    () => invoke<WatchdogTimer>('ipmi_get_watchdog_timer', { sessionId: need() }),
    [sessionId],
  );
  const resetWatchdogTimer = useCallback(
    () => invoke<void>('ipmi_reset_watchdog_timer', { sessionId: need() }),
    [sessionId],
  );

  // ── LAN ────────────────────────────────────────────────────────────

  const getLanConfig = useCallback(
    (channel?: number) =>
      invoke<LanConfig>('ipmi_get_lan_config', { sessionId: need(), channel }),
    [sessionId],
  );

  // ── Users ──────────────────────────────────────────────────────────

  const listUsers = useCallback(
    (channel?: number) =>
      invoke<IpmiUser[]>('ipmi_list_users', { sessionId: need(), channel }),
    [sessionId],
  );
  const setUserName = useCallback(
    (userId: number, name: string) =>
      invoke<void>('ipmi_set_user_name', { sessionId: need(), userId, name }),
    [sessionId],
  );
  const setUserPassword = useCallback(
    (userId: number, password: string) =>
      invoke<void>('ipmi_set_user_password', {
        sessionId: need(),
        userId,
        password,
      }),
    [sessionId],
  );
  const enableUser = useCallback(
    (userId: number) =>
      invoke<void>('ipmi_enable_user', { sessionId: need(), userId }),
    [sessionId],
  );
  const disableUser = useCallback(
    (userId: number) =>
      invoke<void>('ipmi_disable_user', { sessionId: need(), userId }),
    [sessionId],
  );

  // ── Raw / bridged / PEF / channels ────────────────────────────────

  const rawCommand = useCallback(
    (netfn: number, cmd: number, data?: number[]) =>
      invoke<RawIpmiResponse>('ipmi_raw_command', {
        sessionId: need(),
        netfn,
        cmd,
        data,
      }),
    [sessionId],
  );
  const bridgedCommand = useCallback(
    (
      targetChannel: number,
      targetAddress: number,
      netfn: number,
      cmd: number,
      data?: number[],
    ) =>
      invoke<RawIpmiResponse>('ipmi_bridged_command', {
        sessionId: need(),
        targetChannel,
        targetAddress,
        netfn,
        cmd,
        data,
      }),
    [sessionId],
  );

  const getPefCapabilities = useCallback(
    () =>
      invoke<PefCapabilities>('ipmi_get_pef_capabilities', {
        sessionId: need(),
      }),
    [sessionId],
  );

  const getChannelInfo = useCallback(
    (channel: number) =>
      invoke<ChannelInfo>('ipmi_get_channel_info', {
        sessionId: need(),
        channel,
      }),
    [sessionId],
  );
  const listChannels = useCallback(
    () => invoke<ChannelInfo[]>('ipmi_list_channels', { sessionId: need() }),
    [sessionId],
  );
  const getChannelCipherSuites = useCallback(
    (channel: number) =>
      invoke<CipherSuite[]>('ipmi_get_channel_cipher_suites', {
        sessionId: need(),
        channel,
      }),
    [sessionId],
  );

  return {
    // state
    sessionId,
    sessionInfo,
    isConnecting,
    error,
    // connection
    connect,
    disconnect,
    disconnectAll,
    listSessions,
    ping,
    // chassis / power
    getChassisStatus,
    chassisControl,
    powerOn,
    powerOff,
    powerCycle,
    hardReset,
    softShutdown,
    chassisIdentify,
    setBootDevice,
    getDeviceId,
    // sensors
    getAllSdrRecords,
    readSensor,
    getSensorThresholds,
    // SEL
    getSelInfo,
    getAllSelEntries,
    clearSel,
    deleteSelEntry,
    // FRU
    getFruInfo,
    // SOL
    getSolConfig,
    activateSol,
    deactivateSol,
    // watchdog
    getWatchdogTimer,
    resetWatchdogTimer,
    // LAN
    getLanConfig,
    // users
    listUsers,
    setUserName,
    setUserPassword,
    enableUser,
    disableUser,
    // raw / bridged / PEF / channels
    rawCommand,
    bridgedCommand,
    getPefCapabilities,
    getChannelInfo,
    listChannels,
    getChannelCipherSuites,
  };
}
