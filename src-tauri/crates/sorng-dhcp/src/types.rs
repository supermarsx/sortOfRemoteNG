//! Data types for DHCP management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    Agent,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub backend: DhcpBackend,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DhcpBackend {
    IscDhcpd,
    Dnsmasq,
    Kea,
}

// ─── Subnet ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpSubnet {
    pub network: String,
    pub netmask: String,
    pub range_start: Option<String>,
    pub range_end: Option<String>,
    pub gateway: Option<String>,
    pub dns_servers: Vec<String>,
    pub domain_name: Option<String>,
    pub lease_time: Option<u32>,
    pub max_lease_time: Option<u32>,
    pub options: HashMap<String, String>,
}

// ─── Reservation ────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpReservation {
    pub hostname: String,
    pub mac_address: String,
    pub ip_address: String,
    pub options: HashMap<String, String>,
}

// ─── Lease ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpLease {
    pub ip_address: String,
    pub mac_address: String,
    pub hostname: Option<String>,
    pub starts: Option<DateTime<Utc>>,
    pub ends: Option<DateTime<Utc>>,
    pub state: LeaseState,
    pub client_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaseState {
    Active,
    Free,
    Expired,
    Backup,
    Abandoned,
}

// ─── ISC dhcpd ──────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IscDhcpdConfig {
    pub global_options: HashMap<String, String>,
    pub subnets: Vec<DhcpSubnet>,
    pub reservations: Vec<DhcpReservation>,
    pub shared_networks: Vec<SharedNetwork>,
    pub authoritative: bool,
    pub ddns_update_style: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedNetwork {
    pub name: String,
    pub subnets: Vec<DhcpSubnet>,
}

// ─── dnsmasq ────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsmasqConfig {
    pub interface: Option<String>,
    pub listen_address: Option<String>,
    pub dhcp_ranges: Vec<DnsmasqRange>,
    pub dhcp_hosts: Vec<DhcpReservation>,
    pub dhcp_options: HashMap<String, String>,
    pub domain: Option<String>,
    pub enable_tftp: bool,
    pub tftp_root: Option<String>,
    pub all_settings: HashMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsmasqRange {
    pub tag: Option<String>,
    pub start: String,
    pub end: String,
    pub lease_time: String,
    pub netmask: Option<String>,
}

// ─── Kea ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeaDhcp4Config {
    pub interfaces: Vec<String>,
    pub subnets: Vec<DhcpSubnet>,
    pub reservations: Vec<DhcpReservation>,
    pub lease_database: Option<KeaLeaseDb>,
    pub valid_lifetime: Option<u32>,
    pub renew_timer: Option<u32>,
    pub rebind_timer: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeaLeaseDb {
    pub db_type: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
}

// ─── Health ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpHealthCheck {
    pub backend: DhcpBackend,
    pub service_running: bool,
    pub config_valid: bool,
    pub total_leases: u32,
    pub active_leases: u32,
    pub subnet_count: u32,
    pub reservation_count: u32,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}
