// pfSense — "Services & System" invoke slice + hook (t42-pfsense-c2).
//
// `pfsenseServicesApi` is a thin 1:1 wrapper over the 46 `pfsense_*` Tauri
// commands in this category (DHCP 8, DNS 8, Services 5, System 6, Certificates
// 4, Users 5, Diagnostics 7, Backups 3). Every command takes `id` = the live
// pfSense connection id owned by the panel shell. Argument names are camelCase
// exactly matching the Rust fn params after the `#[tauri::command]` macro's
// snake→camel conversion (`mappingId`, `overrideId`, `recordType`, `maxHops`,
// `logName`, `backupId`, …).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  BackupConfig,
  BackupEntry,
  CaCertificate,
  CertificateRequest,
  DhcpConfig,
  DhcpLease,
  DhcpRelay,
  DhcpStaticMapping,
  DnsCacheStats,
  DnsDomainOverride,
  DnsHostOverride,
  DnsLookupResult,
  DnsResolverConfig,
  GeneralConfig,
  NdpEntry,
  ArpEntry,
  PfsenseGroup,
  PfsenseService,
  PfsenseUser,
  PingResult,
  ServerCertificate,
  ServiceStatus,
  SystemInfo,
  SystemUpdate,
  TraceResult,
} from "../../../types/pfsense/services";

/** One thin wrapper per command. `id` is always the connection id. */
export const pfsenseServicesApi = {
  // ── DHCP ───────────────────────────────────────────────────────────────
  getDhcpConfig: (id: string, iface: string) =>
    invoke<DhcpConfig>("pfsense_get_dhcp_config", { id, interface: iface }),
  updateDhcpConfig: (id: string, iface: string, config: DhcpConfig) =>
    invoke<DhcpConfig>("pfsense_update_dhcp_config", {
      id,
      interface: iface,
      config,
    }),
  listDhcpLeases: (id: string) =>
    invoke<DhcpLease[]>("pfsense_list_dhcp_leases", { id }),
  listDhcpStaticMappings: (id: string, iface: string) =>
    invoke<DhcpStaticMapping[]>("pfsense_list_dhcp_static_mappings", {
      id,
      interface: iface,
    }),
  createDhcpStaticMapping: (
    id: string,
    iface: string,
    mapping: DhcpStaticMapping,
  ) =>
    invoke<DhcpStaticMapping>("pfsense_create_dhcp_static_mapping", {
      id,
      interface: iface,
      mapping,
    }),
  updateDhcpStaticMapping: (
    id: string,
    iface: string,
    mappingId: string,
    mapping: DhcpStaticMapping,
  ) =>
    invoke<DhcpStaticMapping>("pfsense_update_dhcp_static_mapping", {
      id,
      interface: iface,
      mappingId,
      mapping,
    }),
  deleteDhcpStaticMapping: (id: string, iface: string, mappingId: string) =>
    invoke<void>("pfsense_delete_dhcp_static_mapping", {
      id,
      interface: iface,
      mappingId,
    }),
  getDhcpRelay: (id: string) =>
    invoke<DhcpRelay>("pfsense_get_dhcp_relay", { id }),

  // ── DNS ────────────────────────────────────────────────────────────────
  getDnsResolverConfig: (id: string) =>
    invoke<DnsResolverConfig>("pfsense_get_dns_resolver_config", { id }),
  updateDnsResolverConfig: (id: string, config: DnsResolverConfig) =>
    invoke<DnsResolverConfig>("pfsense_update_dns_resolver_config", {
      id,
      config,
    }),
  listDnsHostOverrides: (id: string) =>
    invoke<DnsHostOverride[]>("pfsense_list_dns_host_overrides", { id }),
  createDnsHostOverride: (id: string, entry: DnsHostOverride) =>
    invoke<DnsHostOverride>("pfsense_create_dns_host_override", { id, entry }),
  deleteDnsHostOverride: (id: string, overrideId: string) =>
    invoke<void>("pfsense_delete_dns_host_override", { id, overrideId }),
  listDnsDomainOverrides: (id: string) =>
    invoke<DnsDomainOverride[]>("pfsense_list_dns_domain_overrides", { id }),
  flushDnsCache: (id: string) =>
    invoke<unknown>("pfsense_flush_dns_cache", { id }),
  getDnsCacheStats: (id: string) =>
    invoke<DnsCacheStats>("pfsense_get_dns_cache_stats", { id }),

  // ── Services ───────────────────────────────────────────────────────────
  listServices: (id: string) =>
    invoke<PfsenseService[]>("pfsense_list_services", { id }),
  getServiceStatus: (id: string, name: string) =>
    invoke<ServiceStatus>("pfsense_get_service_status", { id, name }),
  startService: (id: string, name: string) =>
    invoke<unknown>("pfsense_start_service", { id, name }),
  stopService: (id: string, name: string) =>
    invoke<unknown>("pfsense_stop_service", { id, name }),
  restartService: (id: string, name: string) =>
    invoke<unknown>("pfsense_restart_service", { id, name }),

  // ── System ─────────────────────────────────────────────────────────────
  getSystemInfo: (id: string) =>
    invoke<SystemInfo>("pfsense_get_system_info", { id }),
  getSystemUpdates: (id: string) =>
    invoke<SystemUpdate>("pfsense_get_system_updates", { id }),
  getGeneralConfig: (id: string) =>
    invoke<GeneralConfig>("pfsense_get_general_config", { id }),
  updateGeneralConfig: (id: string, config: GeneralConfig) =>
    invoke<GeneralConfig>("pfsense_update_general_config", { id, config }),
  reboot: (id: string) => invoke<unknown>("pfsense_reboot", { id }),
  halt: (id: string) => invoke<unknown>("pfsense_halt", { id }),

  // ── Certificates ───────────────────────────────────────────────────────
  listCas: (id: string) =>
    invoke<CaCertificate[]>("pfsense_list_cas", { id }),
  listCerts: (id: string) =>
    invoke<ServerCertificate[]>("pfsense_list_certs", { id }),
  createCert: (id: string, req: CertificateRequest) =>
    invoke<ServerCertificate>("pfsense_create_cert", { id, req }),
  deleteCert: (id: string, refid: string) =>
    invoke<void>("pfsense_delete_cert", { id, refid }),

  // ── Users ──────────────────────────────────────────────────────────────
  listUsers: (id: string) =>
    invoke<PfsenseUser[]>("pfsense_list_users", { id }),
  getUser: (id: string, name: string) =>
    invoke<PfsenseUser>("pfsense_get_user", { id, name }),
  createUser: (id: string, user: PfsenseUser) =>
    invoke<PfsenseUser>("pfsense_create_user", { id, user }),
  deleteUser: (id: string, name: string) =>
    invoke<void>("pfsense_delete_user", { id, name }),
  listGroups: (id: string) =>
    invoke<PfsenseGroup[]>("pfsense_list_groups", { id }),

  // ── Diagnostics ────────────────────────────────────────────────────────
  getArpTable: (id: string) =>
    invoke<ArpEntry[]>("pfsense_get_arp_table", { id }),
  getNdpTable: (id: string) =>
    invoke<NdpEntry[]>("pfsense_get_ndp_table", { id }),
  dnsLookup: (
    id: string,
    host: string,
    recordType?: string,
    server?: string,
  ) => invoke<DnsLookupResult>("pfsense_dns_lookup", {
    id,
    host,
    recordType,
    server,
  }),
  diagPing: (id: string, host: string, count?: number, source?: string) =>
    invoke<PingResult>("pfsense_diag_ping", { id, host, count, source }),
  traceroute: (id: string, host: string, maxHops?: number, source?: string) =>
    invoke<TraceResult>("pfsense_traceroute", { id, host, maxHops, source }),
  getPfinfo: (id: string) => invoke<unknown>("pfsense_get_pfinfo", { id }),
  getSystemLog: (id: string, logName: string, count?: number) =>
    invoke<string[]>("pfsense_get_system_log", { id, logName, count }),

  // ── Backups ────────────────────────────────────────────────────────────
  listBackups: (id: string) =>
    invoke<BackupEntry[]>("pfsense_list_backups", { id }),
  createBackup: (id: string, config: BackupConfig) =>
    invoke<BackupEntry>("pfsense_create_backup", { id, config }),
  deleteBackup: (id: string, backupId: string) =>
    invoke<void>("pfsense_delete_backup", { id, backupId }),
} as const;

export type PfsenseServicesApi = typeof pfsenseServicesApi;

/** Small stateful helper the tab uses to funnel every command through a shared
 *  `loading` / `error` surface. Section view-state stays in the component; this
 *  hook owns only the cross-cutting request lifecycle. */
export function usePfsenseServices() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run an api call with shared loading/error handling. Returns the resolved
   *  value, or `undefined` if the call threw (the error is captured in state). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { api: pfsenseServicesApi, loading, error, setError, clearError, run };
}

export type UsePfsenseServices = ReturnType<typeof usePfsenseServices>;
