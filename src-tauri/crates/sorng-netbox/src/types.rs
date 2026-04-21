// ── sorng-netbox/src/types.rs ────────────────────────────────────────────────
//! Shared types for NetBox IPAM/DCIM management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub use_tls: Option<bool>,
    pub accept_invalid_certs: Option<bool>,
    pub api_token: String,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub site_count: Option<u64>,
    pub device_count: Option<u64>,
    pub prefix_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub count: u64,
    pub next: Option<String>,
    pub previous: Option<String>,
    pub results: Vec<T>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Common nested references
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NestedRef {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Sites
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub status: Option<serde_json::Value>,
    pub region: Option<serde_json::Value>,
    pub group: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub facility: Option<String>,
    pub time_zone: Option<String>,
    pub description: Option<String>,
    pub physical_address: Option<String>,
    pub shipping_address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub circuit_count: Option<u64>,
    pub device_count: Option<u64>,
    pub prefix_count: Option<u64>,
    pub rack_count: Option<u64>,
    pub vlan_count: Option<u64>,
    pub virtualmachine_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Racks
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rack {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub facility_id: Option<String>,
    pub site: Option<serde_json::Value>,
    pub location: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub serial: Option<String>,
    pub asset_tag: Option<String>,
    #[serde(rename = "type")]
    pub rack_type: Option<serde_json::Value>,
    pub width: Option<serde_json::Value>,
    pub u_height: Option<u32>,
    pub desc_units: Option<bool>,
    pub outer_width: Option<u32>,
    pub outer_depth: Option<u32>,
    pub outer_unit: Option<serde_json::Value>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub device_count: Option<u64>,
    pub power_feed_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Devices
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub device_type: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub platform: Option<serde_json::Value>,
    pub serial: Option<String>,
    pub asset_tag: Option<String>,
    pub site: Option<serde_json::Value>,
    pub location: Option<serde_json::Value>,
    pub rack: Option<serde_json::Value>,
    pub position: Option<f64>,
    pub face: Option<serde_json::Value>,
    pub parent_device: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub airflow: Option<serde_json::Value>,
    pub primary_ip4: Option<serde_json::Value>,
    pub primary_ip6: Option<serde_json::Value>,
    pub cluster: Option<serde_json::Value>,
    pub virtual_chassis: Option<serde_json::Value>,
    pub vc_position: Option<u32>,
    pub vc_priority: Option<u32>,
    pub comments: Option<String>,
    pub local_context_data: Option<serde_json::Value>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceType {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub manufacturer: Option<serde_json::Value>,
    pub model: Option<String>,
    pub slug: Option<String>,
    pub part_number: Option<String>,
    pub u_height: Option<f64>,
    pub is_full_depth: Option<bool>,
    pub subdevice_role: Option<serde_json::Value>,
    pub airflow: Option<serde_json::Value>,
    pub front_image: Option<String>,
    pub rear_image: Option<String>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub device_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interface {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub device: Option<serde_json::Value>,
    pub name: Option<String>,
    pub label: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub parent: Option<serde_json::Value>,
    pub bridge: Option<serde_json::Value>,
    pub lag: Option<serde_json::Value>,
    pub mtu: Option<u32>,
    pub mac_address: Option<String>,
    pub speed: Option<u64>,
    pub duplex: Option<serde_json::Value>,
    pub wwn: Option<String>,
    pub mgmt_only: Option<bool>,
    pub description: Option<String>,
    pub mode: Option<serde_json::Value>,
    pub rf_role: Option<serde_json::Value>,
    pub rf_channel: Option<serde_json::Value>,
    pub poe_mode: Option<serde_json::Value>,
    pub poe_type: Option<serde_json::Value>,
    pub untagged_vlan: Option<serde_json::Value>,
    pub tagged_vlans: Option<Vec<serde_json::Value>>,
    pub mark_connected: Option<bool>,
    pub cable: Option<serde_json::Value>,
    pub cable_end: Option<String>,
    pub wireless_link: Option<serde_json::Value>,
    pub wireless_lans: Option<Vec<serde_json::Value>>,
    pub vrf: Option<serde_json::Value>,
    pub l2vpn_termination: Option<serde_json::Value>,
    pub connected_endpoints: Option<serde_json::Value>,
    pub connected_endpoints_type: Option<String>,
    pub connected_endpoints_reachable: Option<bool>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub count_ipaddresses: Option<u64>,
    pub count_fhrp_groups: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPAM – IP Addresses
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpAddress {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub family: Option<serde_json::Value>,
    pub address: Option<String>,
    pub vrf: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub assigned_object_type: Option<String>,
    pub assigned_object_id: Option<i64>,
    pub assigned_object: Option<serde_json::Value>,
    pub nat_inside: Option<serde_json::Value>,
    pub nat_outside: Option<Vec<serde_json::Value>>,
    pub dns_name: Option<String>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPAM – Prefixes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefix {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub family: Option<serde_json::Value>,
    pub prefix: Option<String>,
    pub site: Option<serde_json::Value>,
    pub vrf: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub vlan: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub is_pool: Option<bool>,
    pub mark_utilized: Option<bool>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub depth: Option<u32>,
    pub children: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPAM – VRFs, Aggregates, RIRs, Roles
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vrf {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub rd: Option<String>,
    pub tenant: Option<serde_json::Value>,
    pub enforce_unique: Option<bool>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub import_targets: Option<Vec<serde_json::Value>>,
    pub export_targets: Option<Vec<serde_json::Value>>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub ipaddress_count: Option<u64>,
    pub prefix_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aggregate {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub family: Option<serde_json::Value>,
    pub prefix: Option<String>,
    pub rir: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub date_added: Option<String>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rir {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub is_private: Option<bool>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub aggregate_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpamRole {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub weight: Option<u32>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub prefix_count: Option<u64>,
    pub vlan_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub device: Option<serde_json::Value>,
    pub virtual_machine: Option<serde_json::Value>,
    pub name: Option<String>,
    pub protocol: Option<serde_json::Value>,
    pub ports: Option<Vec<u16>>,
    pub ipaddresses: Option<Vec<serde_json::Value>>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPAM – VLANs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vlan {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub site: Option<serde_json::Value>,
    pub group: Option<serde_json::Value>,
    pub vid: Option<u16>,
    pub name: Option<String>,
    pub tenant: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub prefix_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlanGroup {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub scope_type: Option<String>,
    pub scope_id: Option<i64>,
    pub scope: Option<serde_json::Value>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub vlan_count: Option<u64>,
    pub utilization: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Circuits
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Circuit {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub cid: Option<String>,
    pub provider: Option<serde_json::Value>,
    pub provider_account: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub type_field: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub install_date: Option<String>,
    pub termination_date: Option<String>,
    pub commit_rate: Option<u64>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitProvider {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub asns: Option<Vec<serde_json::Value>>,
    pub account: Option<String>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub circuit_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitType {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub circuit_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitTermination {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub circuit: Option<serde_json::Value>,
    pub term_side: Option<String>,
    pub site: Option<serde_json::Value>,
    pub provider_network: Option<serde_json::Value>,
    pub port_speed: Option<u64>,
    pub upstream_speed: Option<u64>,
    pub xconnect_id: Option<String>,
    pub pp_info: Option<String>,
    pub description: Option<String>,
    pub mark_connected: Option<bool>,
    pub cable: Option<serde_json::Value>,
    pub cable_end: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Cables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cable {
    pub id: Option<i64>,
    pub url: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<serde_json::Value>,
    pub a_terminations: Option<Vec<serde_json::Value>>,
    pub b_terminations: Option<Vec<serde_json::Value>>,
    pub status: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub label: Option<String>,
    pub color: Option<String>,
    pub length: Option<f64>,
    pub length_unit: Option<serde_json::Value>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tenancy
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub group: Option<serde_json::Value>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantGroup {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub parent: Option<serde_json::Value>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub tenant_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Contacts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub group: Option<serde_json::Value>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub link: Option<String>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactGroup {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub parent: Option<serde_json::Value>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub contact_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactRole {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactAssignment {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub object_type: Option<String>,
    pub object_id: Option<i64>,
    pub object: Option<serde_json::Value>,
    pub contact: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub priority: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtualization
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualMachine {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub status: Option<serde_json::Value>,
    pub site: Option<serde_json::Value>,
    pub cluster: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub platform: Option<serde_json::Value>,
    pub primary_ip4: Option<serde_json::Value>,
    pub primary_ip6: Option<serde_json::Value>,
    pub vcpus: Option<f64>,
    pub memory: Option<u64>,
    pub disk: Option<u64>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub local_context_data: Option<serde_json::Value>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmInterface {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub virtual_machine: Option<serde_json::Value>,
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub parent: Option<serde_json::Value>,
    pub bridge: Option<serde_json::Value>,
    pub mtu: Option<u32>,
    pub mac_address: Option<String>,
    pub description: Option<String>,
    pub mode: Option<serde_json::Value>,
    pub untagged_vlan: Option<serde_json::Value>,
    pub tagged_vlans: Option<Vec<serde_json::Value>>,
    pub vrf: Option<serde_json::Value>,
    pub l2vpn_termination: Option<serde_json::Value>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub count_ipaddresses: Option<u64>,
    pub count_fhrp_groups: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_field: Option<serde_json::Value>,
    pub group: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub site: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
    pub device_count: Option<u64>,
    pub virtualmachine_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterType {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub cluster_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterGroup {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub cluster_count: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DCIM – Supporting types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manufacturer {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub devicetype_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Platform {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub manufacturer: Option<serde_json::Value>,
    pub config_template: Option<serde_json::Value>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub device_count: Option<u64>,
    pub virtualmachine_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRole {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub color: Option<String>,
    pub vm_role: Option<bool>,
    pub config_template: Option<serde_json::Value>,
    pub description: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub device_count: Option<u64>,
    pub virtualmachine_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RackReservation {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub rack: Option<serde_json::Value>,
    pub units: Option<Vec<u32>>,
    pub user: Option<serde_json::Value>,
    pub tenant: Option<serde_json::Value>,
    pub description: Option<String>,
    pub comments: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub custom_fields: Option<serde_json::Value>,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RackUnit {
    pub id: u32,
    pub name: String,
    pub face: Option<serde_json::Value>,
    pub device: Option<serde_json::Value>,
    pub occupied: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceConnection {
    pub interface_a: Option<serde_json::Value>,
    pub interface_b: Option<serde_json::Value>,
    pub connected_endpoint_reachable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CableTrace {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub cable: Option<serde_json::Value>,
    pub near_end: Option<serde_json::Value>,
    pub far_end: Option<serde_json::Value>,
}
