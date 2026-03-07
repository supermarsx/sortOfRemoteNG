//! All shared types for the NetBox IPAM/DCIM crate.

use serde::{Deserialize, Serialize};

// ── Pagination wrapper ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxListResponse<T> {
    pub count: i64,
    pub next: Option<String>,
    pub previous: Option<String>,
    pub results: Vec<T>,
}

// ── Connection ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxConnectionConfig {
    pub host: String,
    pub port: u16,
    pub scheme: String,
    pub api_token: String,
    #[serde(default = "default_true")]
    pub tls_verify: bool,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_true() -> bool { true }
fn default_timeout() -> u64 { 30 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxConnectionSummary {
    pub host: String,
    pub version: String,
    pub python_version: String,
    pub installed_plugins: Vec<String>,
    pub users_count: i64,
    pub django_version: String,
}

// ── Common building blocks ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxObject {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub created: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxRef {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NestedTag {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub q: Option<String>,
    pub ordering: Option<String>,
    pub tag: Option<String>,
}

// ── DCIM – Sites ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub status: Option<serde_json::Value>,
    pub region: Option<NetboxRef>,
    pub group: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub facility: Option<String>,
    pub time_zone: Option<String>,
    pub description: String,
    pub physical_address: Option<String>,
    pub shipping_address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub asns: Option<Vec<serde_json::Value>>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSiteRequest {
    pub name: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physical_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shipping_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSiteRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── DCIM – Racks ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rack {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub facility_id: Option<String>,
    pub site: NetboxRef,
    pub location: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub role: Option<NetboxRef>,
    pub serial: Option<String>,
    pub asset_tag: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub width: Option<serde_json::Value>,
    pub u_height: i64,
    pub desc_units: bool,
    pub outer_width: Option<i64>,
    pub outer_depth: Option<i64>,
    pub outer_unit: Option<serde_json::Value>,
    pub weight: Option<f64>,
    pub weight_unit: Option<serde_json::Value>,
    pub max_weight: Option<i64>,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub device_count: i64,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRackRequest {
    pub name: String,
    pub site: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u_height: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── DCIM – Devices ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: Option<String>,
    pub device_type: NetboxRef,
    pub role: NetboxRef,
    pub tenant: Option<NetboxRef>,
    pub platform: Option<NetboxRef>,
    pub serial: Option<String>,
    pub asset_tag: Option<String>,
    pub site: NetboxRef,
    pub location: Option<NetboxRef>,
    pub rack: Option<NetboxRef>,
    pub position: Option<f64>,
    pub face: Option<serde_json::Value>,
    pub parent_device: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub primary_ip4: Option<serde_json::Value>,
    pub primary_ip6: Option<serde_json::Value>,
    pub oob_ip: Option<serde_json::Value>,
    pub cluster: Option<NetboxRef>,
    pub virtual_chassis: Option<NetboxRef>,
    pub vc_position: Option<i64>,
    pub vc_priority: Option<i64>,
    pub description: String,
    pub comments: String,
    pub config_template: Option<NetboxRef>,
    pub local_context_data: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceType {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub manufacturer: NetboxRef,
    pub model: String,
    pub slug: String,
    pub part_number: Option<String>,
    pub u_height: Option<f64>,
    pub is_full_depth: Option<bool>,
    pub subdevice_role: Option<serde_json::Value>,
    pub airflow: Option<serde_json::Value>,
    pub weight: Option<f64>,
    pub weight_unit: Option<serde_json::Value>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manufacturer {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRole {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub color: String,
    pub vm_role: bool,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Platform {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub manufacturer: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDeviceRequest {
    pub name: Option<String>,
    pub device_type: i64,
    pub role: i64,
    pub site: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rack: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── DCIM – Interfaces ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInterface {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    pub label: Option<String>,
    #[serde(rename = "type")]
    pub type_: serde_json::Value,
    pub enabled: bool,
    pub parent: Option<NetboxRef>,
    pub bridge: Option<NetboxRef>,
    pub lag: Option<NetboxRef>,
    pub mac_address: Option<String>,
    pub mtu: Option<i64>,
    pub speed: Option<i64>,
    pub duplex: Option<serde_json::Value>,
    pub wwn: Option<String>,
    pub mgmt_only: bool,
    pub description: String,
    pub mode: Option<serde_json::Value>,
    pub untagged_vlan: Option<NetboxRef>,
    pub tagged_vlans: Vec<serde_json::Value>,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub cable_end: Option<String>,
    pub wireless_link: Option<serde_json::Value>,
    pub wireless_lans: Vec<serde_json::Value>,
    pub connected_endpoints: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInterfaceRequest {
    pub device: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtu: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── DCIM – Cables ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cable {
    pub id: i64,
    pub url: String,
    pub display: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub a_terminations: Vec<serde_json::Value>,
    pub b_terminations: Vec<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub tenant: Option<NetboxRef>,
    pub label: Option<String>,
    pub color: Option<String>,
    pub length: Option<f64>,
    pub length_unit: Option<serde_json::Value>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

// ── DCIM – Connection ports ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolePort {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub speed: Option<serde_json::Value>,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleServerPort {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub speed: Option<serde_json::Value>,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerPort {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub maximum_draw: Option<i64>,
    pub allocated_draw: Option<i64>,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerOutlet {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub power_port: Option<NetboxRef>,
    pub feed_leg: Option<serde_json::Value>,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RearPort {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: serde_json::Value,
    pub positions: i64,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontPort {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub device: NetboxRef,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: serde_json::Value,
    pub rear_port: NetboxRef,
    pub rear_port_position: i64,
    pub description: String,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

// ── DCIM – Locations ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub site: NetboxRef,
    pub parent: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

// ── DCIM – Regions ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Region {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub parent: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
    pub site_count: i64,
}

// ── IPAM ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpAddress {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub family: Option<serde_json::Value>,
    pub address: String,
    pub vrf: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub role: Option<serde_json::Value>,
    pub assigned_object_type: Option<String>,
    pub assigned_object_id: Option<i64>,
    pub nat_inside: Option<serde_json::Value>,
    pub nat_outside: Option<Vec<serde_json::Value>>,
    pub dns_name: String,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefix {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub family: Option<serde_json::Value>,
    pub prefix: String,
    pub site: Option<NetboxRef>,
    pub vrf: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub vlan: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub role: Option<NetboxRef>,
    pub is_pool: bool,
    pub mark_utilized: bool,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub depth: Option<i64>,
    pub children: Option<i64>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vlan {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub site: Option<NetboxRef>,
    pub group: Option<NetboxRef>,
    pub vid: i64,
    pub name: String,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub role: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub l2vpn_termination: Option<serde_json::Value>,
    pub prefix_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vrf {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub rd: Option<String>,
    pub tenant: Option<NetboxRef>,
    pub enforce_unique: bool,
    pub description: String,
    pub comments: String,
    pub import_targets: Vec<serde_json::Value>,
    pub export_targets: Vec<serde_json::Value>,
    pub tags: Vec<NestedTag>,
    pub prefix_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aggregate {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub family: Option<serde_json::Value>,
    pub prefix: String,
    pub rir: NetboxRef,
    pub tenant: Option<NetboxRef>,
    pub date_added: Option<String>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rir {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub is_private: bool,
    pub aggregate_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpRange {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub family: Option<serde_json::Value>,
    pub start_address: String,
    pub end_address: String,
    pub size: Option<i64>,
    pub vrf: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub role: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsnInfo {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub asn: i64,
    pub rir: NetboxRef,
    pub tenant: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIpAddressRequest {
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrf: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_object_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_object_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePrefixRequest {
    pub prefix: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrf: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vlan: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_pool: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVlanRequest {
    pub vid: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVrfRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enforce_unique: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableIp {
    pub family: i64,
    pub address: String,
    pub vrf: Option<NetboxRef>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailablePrefix {
    pub family: i64,
    pub prefix: String,
    pub vrf: Option<NetboxRef>,
}

// ── Circuits ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Circuit {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub cid: String,
    pub provider: NetboxRef,
    pub provider_account: Option<NetboxRef>,
    #[serde(rename = "type")]
    pub type_: NetboxRef,
    pub status: Option<serde_json::Value>,
    pub tenant: Option<NetboxRef>,
    pub install_date: Option<String>,
    pub termination_date: Option<String>,
    pub commit_rate: Option<i64>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub asns: Option<Vec<serde_json::Value>>,
    pub account: Option<String>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitType {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub color: Option<String>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitTermination {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub circuit: NetboxRef,
    pub term_side: String,
    pub site: Option<NetboxRef>,
    pub provider_network: Option<NetboxRef>,
    pub port_speed: Option<i64>,
    pub upstream_speed: Option<i64>,
    pub xconnect_id: Option<String>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCircuitRequest {
    pub cid: String,
    pub provider: i64,
    #[serde(rename = "type")]
    pub type_: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_account: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_rate: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── Virtualization ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: NetboxRef,
    pub group: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub site: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub device_count: i64,
    pub virtualmachine_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterType {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualMachine {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub status: Option<serde_json::Value>,
    pub site: Option<NetboxRef>,
    pub cluster: Option<NetboxRef>,
    pub role: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub platform: Option<NetboxRef>,
    pub primary_ip4: Option<serde_json::Value>,
    pub primary_ip6: Option<serde_json::Value>,
    pub vcpus: Option<f64>,
    pub memory: Option<i64>,
    pub disk: Option<i64>,
    pub description: String,
    pub comments: String,
    pub config_template: Option<NetboxRef>,
    pub local_context_data: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VMInterface {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub virtual_machine: NetboxRef,
    pub name: String,
    pub enabled: bool,
    pub parent: Option<NetboxRef>,
    pub bridge: Option<NetboxRef>,
    pub mac_address: Option<String>,
    pub mtu: Option<i64>,
    pub description: String,
    pub mode: Option<serde_json::Value>,
    pub untagged_vlan: Option<NetboxRef>,
    pub tagged_vlans: Vec<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVMRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vcpus: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateClusterRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<serde_json::Value>>,
}

// ── Tenancy ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub group: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub custom_fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub parent: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactAssignment {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub content_type: String,
    pub object_id: i64,
    pub contact: NetboxRef,
    pub role: NetboxRef,
    pub priority: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

// ── Contacts ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub group: Option<NetboxRef>,
    pub name: String,
    pub title: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub link: Option<String>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub parent: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactRole {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

// ── Wireless ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirelessLan {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub ssid: String,
    pub group: Option<NetboxRef>,
    pub status: Option<serde_json::Value>,
    pub vlan: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub auth_type: Option<serde_json::Value>,
    pub auth_cipher: Option<serde_json::Value>,
    pub auth_psk: Option<String>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirelessLanGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub parent: Option<NetboxRef>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirelessLink {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub interface_a: NetboxRef,
    pub interface_b: NetboxRef,
    pub ssid: Option<String>,
    pub status: Option<serde_json::Value>,
    pub tenant: Option<NetboxRef>,
    pub auth_type: Option<serde_json::Value>,
    pub auth_cipher: Option<serde_json::Value>,
    pub auth_psk: Option<String>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

// ── VPN ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnel {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub status: Option<serde_json::Value>,
    pub group: Option<NetboxRef>,
    pub encapsulation: Option<serde_json::Value>,
    pub tunnel_id: Option<i64>,
    pub ipsec_profile: Option<NetboxRef>,
    pub tenant: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelTermination {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub tunnel: NetboxRef,
    pub role: Option<serde_json::Value>,
    pub termination_type: Option<String>,
    pub termination_id: Option<i64>,
    pub termination: Option<serde_json::Value>,
    pub outside_ip: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IKEPolicy {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub version: Option<serde_json::Value>,
    pub mode: Option<serde_json::Value>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IKEProposal {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub authentication_method: Option<serde_json::Value>,
    pub encryption_algorithm: Option<serde_json::Value>,
    pub authentication_algorithm: Option<serde_json::Value>,
    pub group: Option<serde_json::Value>,
    pub sa_lifetime: Option<i64>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IPSecPolicy {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub pfs_group: Option<serde_json::Value>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IPSecProfile {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub mode: Option<serde_json::Value>,
    pub ike_policy: NetboxRef,
    pub ipsec_policy: NetboxRef,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IPSecProposal {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub encryption_algorithm: Option<serde_json::Value>,
    pub authentication_algorithm: Option<serde_json::Value>,
    pub sa_lifetime_seconds: Option<i64>,
    pub sa_lifetime_data: Option<i64>,
    pub description: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L2VPN {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub slug: String,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub identifier: Option<i64>,
    pub tenant: Option<NetboxRef>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L2VPNTermination {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub l2vpn: NetboxRef,
    pub assigned_object_type: Option<String>,
    pub assigned_object_id: Option<i64>,
    pub assigned_object: Option<serde_json::Value>,
    pub tags: Vec<NestedTag>,
}

// ── Power ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerFeed {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub power_panel: NetboxRef,
    pub rack: Option<NetboxRef>,
    pub name: String,
    pub status: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub type_: Option<serde_json::Value>,
    pub supply: Option<serde_json::Value>,
    pub phase: Option<serde_json::Value>,
    pub voltage: Option<i64>,
    pub amperage: Option<i64>,
    pub max_utilization: Option<i64>,
    pub mark_connected: bool,
    pub cable: Option<serde_json::Value>,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerPanel {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub site: NetboxRef,
    pub location: Option<NetboxRef>,
    pub name: String,
    pub description: String,
    pub comments: String,
    pub tags: Vec<NestedTag>,
    pub powerfeed_count: i64,
}

// ── Users ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxUser {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub is_staff: bool,
    pub is_active: bool,
    pub date_joined: Option<String>,
    pub groups: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxGroup {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub user_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxToken {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub user: NetboxRef,
    pub created: Option<String>,
    pub expires: Option<String>,
    pub last_used: Option<String>,
    pub key: Option<String>,
    pub write_enabled: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectPermission {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub object_types: Vec<String>,
    pub actions: Vec<String>,
    pub constraints: Option<serde_json::Value>,
    pub users: Vec<serde_json::Value>,
    pub groups: Vec<serde_json::Value>,
}

// ── Status ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetboxStatus {
    pub django_version: String,
    pub installed_plugins: Vec<PluginInfo>,
    pub python_version: String,
    pub rq_workers_running: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectChange {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub time: String,
    pub user: NetboxRef,
    pub action: serde_json::Value,
    pub changed_object_type: String,
    pub changed_object_id: i64,
    pub object_repr: String,
    pub prechange_data: Option<serde_json::Value>,
    pub postchange_data: Option<serde_json::Value>,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentType {
    pub id: i64,
    pub url: String,
    pub display: String,
    pub app_label: String,
    pub model: String,
}
