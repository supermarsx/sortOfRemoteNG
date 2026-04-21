// ── src/types/zabbix.ts ─────────────────────────────────────────────
// TypeScript mirrors for sorng-zabbix Tauri commands.

export interface ZabbixConnectionConfig {
  url: string;
  username?: string | null;
  password?: string | null;
  api_token?: string | null;
  tls_skip_verify?: boolean | null;
}

export interface ZabbixConnectionSummary {
  id: string;
  url: string;
  version: string;
  user: string;
  connected_at: string;
}

export interface ZabbixDashboard {
  host_count: number;
  template_count: number;
  trigger_count: number;
  active_problems: number;
  total_items: number;
  monitored_hosts: number;
  disabled_hosts: number;
}

export interface ZabbixHostGroup {
  groupid?: string | null;
  name?: string | null;
}

export interface ZabbixHost {
  hostid?: string | null;
  host?: string | null;
  name?: string | null;
  status?: string | null;
  available?: string | null;
  error?: string | null;
  groups?: ZabbixHostGroup[] | null;
  interfaces?: unknown[] | null;
  inventory_mode?: string | null;
}

export interface ZabbixTemplate {
  templateid?: string | null;
  host?: string | null;
  name?: string | null;
  description?: string | null;
  linked_hosts_count?: number | null;
}

export interface ZabbixItem {
  itemid?: string | null;
  hostid?: string | null;
  name?: string | null;
  key_?: string | null;
  type?: string | null;
  value_type?: string | null;
  delay?: string | null;
  status?: string | null;
  state?: string | null;
  lastvalue?: string | null;
  lastclock?: string | null;
  [k: string]: unknown;
}

export interface ZabbixTrigger {
  triggerid?: string | null;
  description?: string | null;
  expression?: string | null;
  priority?: string | null;
  status?: string | null;
  value?: string | null;
  [k: string]: unknown;
}

export interface ZabbixAction {
  actionid?: string | null;
  name?: string | null;
  eventsource?: string | null;
  status?: string | null;
  [k: string]: unknown;
}

export interface ZabbixAlert {
  alertid?: string | null;
  actionid?: string | null;
  eventid?: string | null;
  clock?: string | null;
  subject?: string | null;
  message?: string | null;
  status?: string | null;
  [k: string]: unknown;
}

export interface ZabbixGraph {
  graphid?: string | null;
  name?: string | null;
  width?: string | null;
  height?: string | null;
  [k: string]: unknown;
}

export interface ZabbixDiscoveryRule {
  itemid?: string | null;
  name?: string | null;
  key_?: string | null;
  delay?: string | null;
  status?: string | null;
  [k: string]: unknown;
}

export interface ZabbixMaintenance {
  maintenanceid?: string | null;
  name?: string | null;
  active_since?: string | null;
  active_till?: string | null;
  description?: string | null;
  [k: string]: unknown;
}

export interface ZabbixUser {
  userid?: string | null;
  username?: string | null;
  name?: string | null;
  surname?: string | null;
  roleid?: string | null;
  [k: string]: unknown;
}

export interface ZabbixMediaType {
  mediatypeid?: string | null;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  [k: string]: unknown;
}

export interface ZabbixProxy {
  proxyid?: string | null;
  host?: string | null;
  status?: string | null;
  lastaccess?: string | null;
  [k: string]: unknown;
}

export interface ZabbixProblem {
  eventid?: string | null;
  objectid?: string | null;
  name?: string | null;
  severity?: string | null;
  clock?: string | null;
  acknowledged?: string | null;
  [k: string]: unknown;
}
