// ─── DDNS TypeScript Types ───────────────────────────────────────────────────
// Mirrors src-tauri/crates/sorng-ddns/src/types.rs

export type DdnsProvider =
  | 'Cloudflare'
  | 'NoIp'
  | 'DuckDns'
  | 'AfraidDns'
  | 'Dynu'
  | 'Namecheap'
  | 'GoDaddy'
  | 'GoogleDomains'
  | 'HurricaneElectric'
  | 'ChangeIp'
  | 'Ydns'
  | 'DnsPod'
  | 'Ovh'
  | 'Porkbun'
  | 'Gandi'
  | 'Custom';

export type IpVersion = 'V4Only' | 'V6Only' | 'DualStack' | 'Auto';

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';

export type DdnsAuthMethod =
  | { Basic: { username: string; password: string } }
  | { ApiToken: { token: string } }
  | { ApiKeySecret: { api_key: string; api_secret: string } }
  | { GlobalApiKey: { email: string; api_key: string } }
  | { HashAuth: { hash: string; version: number } }
  | { DirectUrl: { url: string } }
  | { OvhAuth: { app_key: string; app_secret: string; consumer_key: string } }
  | { DnsPodAuth: { token_id: string; token: string } }
  | { CustomHeaders: { headers: Record<string, string> } }
  | 'None';

export type CloudflareProxyMode = 'DnsOnly' | 'Proxied' | 'ProxiedDev';

// ── Provider-specific settings ──────────────────────────────────────────

export interface CloudflareSettings {
  zone_id: string | null;
  record_id: string | null;
  proxy_mode: CloudflareProxyMode;
  ttl: number;
}

export interface NoIpSettings {
  group: string | null;
  offline: boolean;
}

export interface DuckDnsSettings {
  clear_ip: boolean;
  txt_record: string | null;
}

export interface AfraidDnsSettings {
  use_v2_api: boolean;
}

export interface NamecheapSettings {
  hosts: string[];
}

export interface GoDaddySettings {
  record_type: DnsRecordType;
  ttl: number;
}

export interface GoogleDomainsSettings {
  offline: boolean;
}

export interface HurricaneElectricSettings {
  tunnel_id: string | null;
}

export interface DnsPodSettings {
  record_id: string | null;
  record_line: string;
  sub_domain: string;
}

export interface OvhSettings {
  use_dynhost: boolean;
}

export interface PorkbunSettings {
  record_type: DnsRecordType;
  ttl: number;
}

export interface GandiSettings {
  record_type: DnsRecordType;
  ttl: number;
}

export interface CustomProviderSettings {
  url_template: string;
  method: string;
  body_template: string | null;
  headers: Record<string, string>;
  success_regex: string | null;
}

export type ProviderSettings =
  | { Cloudflare: CloudflareSettings }
  | { NoIp: NoIpSettings }
  | { DuckDns: DuckDnsSettings }
  | { AfraidDns: AfraidDnsSettings }
  | { Namecheap: NamecheapSettings }
  | { GoDaddy: GoDaddySettings }
  | { GoogleDomains: GoogleDomainsSettings }
  | { HurricaneElectric: HurricaneElectricSettings }
  | { DnsPod: DnsPodSettings }
  | { Ovh: OvhSettings }
  | { Porkbun: PorkbunSettings }
  | { Gandi: GandiSettings }
  | { Custom: CustomProviderSettings }
  | 'None';

// ── Core types ──────────────────────────────────────────────────────────

export interface DdnsProfile {
  id: string;
  name: string;
  enabled: boolean;
  provider: DdnsProvider;
  auth: DdnsAuthMethod;
  domain: string;
  hostname: string;
  ip_version: IpVersion;
  update_interval_secs: number;
  provider_settings: ProviderSettings;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type IpDetectService =
  | 'Ipify'
  | 'IfconfigMe'
  | 'IcanhaZip'
  | 'WhatIsMyIp'
  | 'Cloudflare'
  | 'OpenDns'
  | 'HttpBin'
  | 'Myip'
  | { Custom: { url: string } };

export interface IpDetectResult {
  ipv4: string | null;
  ipv6: string | null;
  service_used: string;
  latency_ms: number;
  timestamp: string;
}

export type UpdateStatus =
  | 'Success'
  | 'NoChange'
  | 'Failed'
  | 'UnexpectedResponse'
  | 'NetworkError'
  | 'AuthError'
  | 'RateLimited'
  | 'Disabled';

export interface DdnsUpdateResult {
  profile_id: string;
  profile_name: string;
  provider: DdnsProvider;
  status: UpdateStatus;
  ip_sent: string | null;
  ip_previous: string | null;
  hostname: string;
  fqdn: string;
  provider_response: string | null;
  error: string | null;
  timestamp: string;
  latency_ms: number;
}

export interface DdnsProfileHealth {
  profile_id: string;
  profile_name: string;
  enabled: boolean;
  provider: DdnsProvider;
  fqdn: string;
  current_ipv4: string | null;
  current_ipv6: string | null;
  last_success: string | null;
  last_failure: string | null;
  last_error: string | null;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  next_update: string | null;
  is_healthy: boolean;
}

export interface DdnsSystemStatus {
  total_profiles: number;
  enabled_profiles: number;
  healthy_profiles: number;
  error_profiles: number;
  current_ipv4: string | null;
  current_ipv6: string | null;
  scheduler_running: boolean;
  last_ip_check: string | null;
  uptime_secs: number;
}

export interface ProviderCapabilities {
  provider: DdnsProvider;
  display_name: string;
  supports_ipv4: boolean;
  supports_ipv6: boolean;
  supports_wildcard: boolean;
  supports_mx: boolean;
  supports_txt: boolean;
  supports_proxy: boolean;
  supports_ttl: boolean;
  supports_multi_host: boolean;
  requires_zone_id: boolean;
  max_update_frequency_secs: number;
  website_url: string;
  free_tier: boolean;
  notes: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  name_servers: string[];
}

export interface CloudflareDnsRecord {
  id: string;
  zone_id: string;
  name: string;
  record_type: string;
  content: string;
  ttl: number;
  proxied: boolean;
  comment: string | null;
  created_on: string;
  modified_on: string;
}

export interface SchedulerEntry {
  profile_id: string;
  interval_secs: number;
  next_run: string;
  last_run: string | null;
  paused: boolean;
  backoff_factor: number;
}

export interface SchedulerStatus {
  running: boolean;
  total_entries: number;
  active_entries: number;
  paused_entries: number;
  entries: SchedulerEntry[];
}

export interface DdnsConfig {
  ip_detect_services: IpDetectService[];
  ip_check_interval_secs: number;
  http_timeout_secs: number;
  max_retries: number;
  retry_backoff_base_secs: number;
  retry_backoff_max_secs: number;
  retry_jitter: boolean;
  max_audit_entries: number;
  auto_start_scheduler: boolean;
  notify_on_ip_change: boolean;
  notify_on_failure: boolean;
  failure_threshold: number;
}

export type DdnsAuditAction =
  | 'ProfileCreated'
  | 'ProfileUpdated'
  | 'ProfileDeleted'
  | 'ProfileEnabled'
  | 'ProfileDisabled'
  | 'UpdateSuccess'
  | 'UpdateFailed'
  | 'UpdateNoChange'
  | 'UpdateAuthError'
  | 'UpdateRateLimited'
  | 'IpChanged'
  | 'IpDetectFailed'
  | 'SchedulerStarted'
  | 'SchedulerStopped'
  | 'ConfigUpdated'
  | 'BulkImport'
  | 'BulkExport'
  | 'RecordCreated'
  | 'RecordDeleted'
  | 'RecordUpdated'
  | 'ManualUpdate';

export interface DdnsAuditEntry {
  id: string;
  timestamp: string;
  action: DdnsAuditAction;
  profile_id: string | null;
  profile_name: string | null;
  provider: DdnsProvider | null;
  detail: string;
  success: boolean;
  error: string | null;
}

export interface DdnsExportData {
  version: number;
  exported_at: string;
  profiles: DdnsProfile[];
  config: DdnsConfig;
}

export interface DdnsImportResult {
  imported_count: number;
  skipped_count: number;
  errors: string[];
}
