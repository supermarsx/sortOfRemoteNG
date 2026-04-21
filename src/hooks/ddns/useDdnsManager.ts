import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  DdnsProfile,
  DdnsProvider,
  DdnsAuthMethod,
  IpVersion,
  ProviderSettings,
  DdnsUpdateResult,
  IpDetectResult,
  DdnsProfileHealth,
  DdnsSystemStatus,
  ProviderCapabilities,
  CloudflareZone,
  CloudflareDnsRecord,
  SchedulerStatus,
  DdnsConfig,
  DdnsAuditEntry,
  DdnsExportData,
  DdnsImportResult,
} from '../../types/ddns/ddns';

export function useDdnsManager() {
  const [profiles, setProfiles] = useState<DdnsProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<DdnsProfile | null>(null);
  const [updateResults, setUpdateResults] = useState<DdnsUpdateResult[]>([]);
  const [ipResult, setIpResult] = useState<IpDetectResult | null>(null);
  const [currentIps, setCurrentIps] = useState<[string | null, string | null]>([null, null]);
  const [healthList, setHealthList] = useState<DdnsProfileHealth[]>([]);
  const [systemStatus, setSystemStatus] = useState<DdnsSystemStatus | null>(null);
  const [providers, setProviders] = useState<ProviderCapabilities[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [config, setConfig] = useState<DdnsConfig | null>(null);
  const [auditLog, setAuditLog] = useState<DdnsAuditEntry[]>([]);
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [cfRecords, setCfRecords] = useState<CloudflareDnsRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>, setter?: (val: T) => void): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn();
        if (setter) setter(result);
        return result;
      } catch (e: unknown) {
        setError(typeof e === 'string' ? e : (e as Error).message ?? String(e));
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Profile CRUD ──────────────────────────────────────────────────

  const listProfiles = useCallback(
    () => wrap(() => invoke<DdnsProfile[]>('ddns_list_profiles'), setProfiles),
    [wrap],
  );

  const getProfile = useCallback(
    (id: string) => wrap(() => invoke<DdnsProfile>('ddns_get_profile', { id }), setSelectedProfile),
    [wrap],
  );

  const createProfile = useCallback(
    (args: {
      name: string;
      provider: DdnsProvider;
      auth: DdnsAuthMethod;
      domain: string;
      hostname: string;
      ip_version: IpVersion;
      update_interval_secs: number;
      provider_settings: ProviderSettings;
      tags: string[];
      notes: string | null;
    }) =>
      wrap(async () => {
        const p = await invoke<DdnsProfile>('ddns_create_profile', args);
        await listProfiles();
        return p;
      }),
    [wrap, listProfiles],
  );

  const updateProfile = useCallback(
    (args: {
      id: string;
      name?: string;
      enabled?: boolean;
      auth?: DdnsAuthMethod;
      domain?: string;
      hostname?: string;
      ip_version?: IpVersion;
      update_interval_secs?: number;
      provider_settings?: ProviderSettings;
      tags?: string[];
      notes?: string | null;
    }) =>
      wrap(async () => {
        const p = await invoke<DdnsProfile>('ddns_update_profile', args);
        await listProfiles();
        return p;
      }),
    [wrap, listProfiles],
  );

  const deleteProfile = useCallback(
    (id: string) =>
      wrap(async () => {
        await invoke('ddns_delete_profile', { id });
        await listProfiles();
      }),
    [wrap, listProfiles],
  );

  const enableProfile = useCallback(
    (id: string) =>
      wrap(async () => {
        await invoke('ddns_enable_profile', { id });
        await listProfiles();
      }),
    [wrap, listProfiles],
  );

  const disableProfile = useCallback(
    (id: string) =>
      wrap(async () => {
        await invoke('ddns_disable_profile', { id });
        await listProfiles();
      }),
    [wrap, listProfiles],
  );

  // ── Updates ───────────────────────────────────────────────────────

  const triggerUpdate = useCallback(
    (profileId: string) =>
      wrap(() => invoke<DdnsUpdateResult>('ddns_trigger_update', { profileId }), (r) =>
        setUpdateResults((prev) => [r, ...prev]),
      ),
    [wrap],
  );

  const triggerUpdateAll = useCallback(
    () => wrap(() => invoke<DdnsUpdateResult[]>('ddns_trigger_update_all'), setUpdateResults),
    [wrap],
  );

  // ── IP Detection ──────────────────────────────────────────────────

  const detectIp = useCallback(
    () => wrap(() => invoke<IpDetectResult>('ddns_detect_ip'), setIpResult),
    [wrap],
  );

  const getCurrentIps = useCallback(
    () =>
      wrap(
        () => invoke<[string | null, string | null]>('ddns_get_current_ips'),
        setCurrentIps,
      ),
    [wrap],
  );

  // ── Scheduler ─────────────────────────────────────────────────────

  const startScheduler = useCallback(
    () => wrap(() => invoke('ddns_start_scheduler')),
    [wrap],
  );

  const stopScheduler = useCallback(
    () => wrap(() => invoke('ddns_stop_scheduler')),
    [wrap],
  );

  const getSchedulerStatus = useCallback(
    () => wrap(() => invoke<SchedulerStatus>('ddns_get_scheduler_status'), setSchedulerStatus),
    [wrap],
  );

  // ── Health & Status ───────────────────────────────────────────────

  const getAllHealth = useCallback(
    () => wrap(() => invoke<DdnsProfileHealth[]>('ddns_get_all_health'), setHealthList),
    [wrap],
  );

  const getProfileHealth = useCallback(
    (profileId: string) =>
      wrap(() => invoke<DdnsProfileHealth>('ddns_get_profile_health', { profileId })),
    [wrap],
  );

  const getSystemStatus = useCallback(
    () => wrap(() => invoke<DdnsSystemStatus>('ddns_get_system_status'), setSystemStatus),
    [wrap],
  );

  // ── Provider Info ─────────────────────────────────────────────────

  const listProviders = useCallback(
    () => wrap(() => invoke<ProviderCapabilities[]>('ddns_list_providers'), setProviders),
    [wrap],
  );

  const getProviderCapabilities = useCallback(
    (provider: DdnsProvider) =>
      wrap(() => invoke<ProviderCapabilities>('ddns_get_provider_capabilities', { provider })),
    [wrap],
  );

  // ── Cloudflare ────────────────────────────────────────────────────

  const cfListZones = useCallback(
    (profileId: string) =>
      wrap(() => invoke<CloudflareZone[]>('ddns_cf_list_zones', { profileId }), setCfZones),
    [wrap],
  );

  const cfListRecords = useCallback(
    (profileId: string, zoneId: string, recordType?: string, name?: string) =>
      wrap(
        () =>
          invoke<CloudflareDnsRecord[]>('ddns_cf_list_records', {
            profileId,
            zoneId,
            recordType: recordType ?? null,
            name: name ?? null,
          }),
        setCfRecords,
      ),
    [wrap],
  );

  const cfCreateRecord = useCallback(
    (args: {
      profileId: string;
      zoneId: string;
      recordType: string;
      name: string;
      content: string;
      ttl: number;
      proxied: boolean;
      comment?: string;
    }) =>
      wrap(() =>
        invoke<CloudflareDnsRecord>('ddns_cf_create_record', {
          ...args,
          comment: args.comment ?? null,
        }),
      ),
    [wrap],
  );

  const cfDeleteRecord = useCallback(
    (profileId: string, zoneId: string, recordId: string) =>
      wrap(() => invoke('ddns_cf_delete_record', { profileId, zoneId, recordId })),
    [wrap],
  );

  // ── Config ────────────────────────────────────────────────────────

  const getConfig = useCallback(
    () => wrap(() => invoke<DdnsConfig>('ddns_get_config'), setConfig),
    [wrap],
  );

  const updateConfig = useCallback(
    (cfg: DdnsConfig) =>
      wrap(async () => {
        await invoke('ddns_update_config', { config: cfg });
        setConfig(cfg);
      }),
    [wrap],
  );

  // ── Audit ─────────────────────────────────────────────────────────

  const getAuditLog = useCallback(
    () => wrap(() => invoke<DdnsAuditEntry[]>('ddns_get_audit_log'), setAuditLog),
    [wrap],
  );

  const getAuditForProfile = useCallback(
    (profileId: string) =>
      wrap(() => invoke<DdnsAuditEntry[]>('ddns_get_audit_for_profile', { profileId }), setAuditLog),
    [wrap],
  );

  const exportAudit = useCallback(
    () => wrap(() => invoke<string>('ddns_export_audit')),
    [wrap],
  );

  const clearAudit = useCallback(
    () =>
      wrap(async () => {
        await invoke('ddns_clear_audit');
        setAuditLog([]);
      }),
    [wrap],
  );

  // ── Import / Export ───────────────────────────────────────────────

  const exportProfiles = useCallback(
    () => wrap(() => invoke<DdnsExportData>('ddns_export_profiles')),
    [wrap],
  );

  const importProfiles = useCallback(
    (data: DdnsExportData) =>
      wrap(async () => {
        const result = await invoke<DdnsImportResult>('ddns_import_profiles', { data });
        await listProfiles();
        return result;
      }),
    [wrap, listProfiles],
  );

  return {
    // state
    profiles,
    selectedProfile,
    updateResults,
    ipResult,
    currentIps,
    healthList,
    systemStatus,
    providers,
    schedulerStatus,
    config,
    auditLog,
    cfZones,
    cfRecords,
    loading,
    error,
    // profile CRUD
    listProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    enableProfile,
    disableProfile,
    // updates
    triggerUpdate,
    triggerUpdateAll,
    // IP
    detectIp,
    getCurrentIps,
    // scheduler
    startScheduler,
    stopScheduler,
    getSchedulerStatus,
    // health
    getAllHealth,
    getProfileHealth,
    getSystemStatus,
    // provider info
    listProviders,
    getProviderCapabilities,
    // cloudflare
    cfListZones,
    cfListRecords,
    cfCreateRecord,
    cfDeleteRecord,
    // config
    getConfig,
    updateConfig,
    // audit
    getAuditLog,
    getAuditForProfile,
    exportAudit,
    clearAudit,
    // import / export
    exportProfiles,
    importProfiles,
  };
}
