// ── sorng-zabbix/src/types.rs ────────────────────────────────────────────────
//! Zabbix API data structures.

use serde::{Deserialize, Serialize};

// ── Connection ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixConnectionConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub api_token: Option<String>,
    pub tls_skip_verify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixConnectionSummary {
    pub id: String,
    pub url: String,
    pub version: String,
    pub user: String,
    pub connected_at: String,
}

// ── Dashboard (overview) ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixDashboard {
    pub host_count: u64,
    pub template_count: u64,
    pub trigger_count: u64,
    pub active_problems: u64,
    pub total_items: u64,
    pub monitored_hosts: u64,
    pub disabled_hosts: u64,
}

// ── Hosts ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixHost {
    pub hostid: Option<String>,
    pub host: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub available: Option<String>,
    pub error: Option<String>,
    pub groups: Option<Vec<ZabbixHostGroup>>,
    pub interfaces: Option<Vec<serde_json::Value>>,
    pub inventory_mode: Option<String>,
}

// ── Templates ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixTemplate {
    pub templateid: Option<String>,
    pub host: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_hosts_count: Option<u64>,
}

// ── Items ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixItem {
    pub itemid: Option<String>,
    pub hostid: Option<String>,
    pub name: Option<String>,
    pub key_: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub value_type: Option<String>,
    pub delay: Option<String>,
    pub status: Option<String>,
    pub state: Option<String>,
    pub lastvalue: Option<String>,
    pub lastclock: Option<String>,
    pub units: Option<String>,
    pub error: Option<String>,
}

// ── Triggers ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixTrigger {
    pub triggerid: Option<String>,
    pub description: Option<String>,
    pub expression: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub state: Option<String>,
    pub value: Option<String>,
    pub lastchange: Option<String>,
    pub hosts: Option<Vec<ZabbixHost>>,
}

// ── Actions ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixAction {
    pub actionid: Option<String>,
    pub name: Option<String>,
    pub eventsource: Option<String>,
    pub status: Option<String>,
    pub operations: Option<Vec<serde_json::Value>>,
}

// ── Alerts ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixAlert {
    pub alertid: Option<String>,
    pub actionid: Option<String>,
    pub eventid: Option<String>,
    pub userid: Option<String>,
    pub clock: Option<String>,
    pub message: Option<String>,
    pub status: Option<String>,
    pub retries: Option<String>,
    pub subject: Option<String>,
}

// ── Graphs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixGraph {
    pub graphid: Option<String>,
    pub name: Option<String>,
    pub width: Option<String>,
    pub height: Option<String>,
    pub graphtype: Option<String>,
    pub items: Option<Vec<serde_json::Value>>,
}

// ── Discovery ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixDiscoveryRule {
    pub druleid: Option<String>,
    pub name: Option<String>,
    pub iprange: Option<String>,
    pub delay: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixDhost {
    pub dhostid: Option<String>,
    pub druleid: Option<String>,
    pub status: Option<String>,
    pub lastup: Option<String>,
    pub lastdown: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixDservice {
    pub dserviceid: Option<String>,
    pub dhostid: Option<String>,
    pub ip: Option<String>,
    pub port: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub value: Option<String>,
}

// ── Maintenance ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixMaintenance {
    pub maintenanceid: Option<String>,
    pub name: Option<String>,
    pub active_since: Option<String>,
    pub active_till: Option<String>,
    pub description: Option<String>,
    pub maintenance_type: Option<String>,
    pub groups: Option<Vec<ZabbixHostGroup>>,
    pub hosts: Option<Vec<ZabbixHost>>,
    pub timeperiods: Option<Vec<serde_json::Value>>,
}

// ── Users ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixUser {
    pub userid: Option<String>,
    pub username: Option<String>,
    pub name: Option<String>,
    pub surname: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub roleid: Option<String>,
    pub lang: Option<String>,
    pub theme: Option<String>,
    pub autologin: Option<String>,
    pub autologout: Option<String>,
}

// ── Media Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixMediaType {
    pub mediatypeid: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub status: Option<String>,
    pub description: Option<String>,
}

// ── Host Groups ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixHostGroup {
    pub groupid: Option<String>,
    pub name: Option<String>,
    pub flags: Option<String>,
    pub hosts_count: Option<u64>,
}

// ── Proxies ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixProxy {
    pub proxyid: Option<String>,
    pub host: Option<String>,
    pub status: Option<String>,
    pub lastaccess: Option<String>,
    pub version: Option<String>,
    pub hosts_count: Option<u64>,
}

// ── Problems ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZabbixProblem {
    pub eventid: Option<String>,
    pub objectid: Option<String>,
    pub name: Option<String>,
    pub severity: Option<String>,
    pub clock: Option<String>,
    pub r_clock: Option<String>,
    pub acknowledged: Option<String>,
    pub suppressed: Option<String>,
    pub tags: Option<Vec<serde_json::Value>>,
}
