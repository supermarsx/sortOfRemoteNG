use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct OciConnectionConfig {
    pub id: String,
    pub name: String,
    pub tenancy_ocid: String,
    pub user_ocid: String,
    pub region: String,
    pub fingerprint: String,
    pub private_key_path: String,
    pub compartment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct OciConnectionInfo {
    pub id: String,
    pub name: String,
    pub region: String,
    pub tenancy_ocid: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OciRegion {
    #[serde(rename = "us-phoenix-1")]
    UsPhoenix1,
    #[serde(rename = "us-ashburn-1")]
    UsAshburn1,
    #[serde(rename = "us-sanjose-1")]
    UsSanjose1,
    #[serde(rename = "us-chicago-1")]
    UsChicago1,
    #[serde(rename = "eu-frankfurt-1")]
    EuFrankfurt1,
    #[serde(rename = "eu-amsterdam-1")]
    EuAmsterdam1,
    #[serde(rename = "eu-zurich-1")]
    EuZurich1,
    #[serde(rename = "eu-marseille-1")]
    EuMarseille1,
    #[serde(rename = "eu-stockholm-1")]
    EuStockholm1,
    #[serde(rename = "eu-milan-1")]
    EuMilan1,
    #[serde(rename = "eu-paris-1")]
    EuParis1,
    #[serde(rename = "eu-madrid-1")]
    EuMadrid1,
    #[serde(rename = "uk-london-1")]
    UkLondon1,
    #[serde(rename = "uk-cardiff-1")]
    UkCardiff1,
    #[serde(rename = "ap-tokyo-1")]
    ApTokyo1,
    #[serde(rename = "ap-osaka-1")]
    ApOsaka1,
    #[serde(rename = "ap-sydney-1")]
    ApSydney1,
    #[serde(rename = "ap-melbourne-1")]
    ApMelbourne1,
    #[serde(rename = "ap-mumbai-1")]
    ApMumbai1,
    #[serde(rename = "ap-hyderabad-1")]
    ApHyderabad1,
    #[serde(rename = "ap-seoul-1")]
    ApSeoul1,
    #[serde(rename = "ap-chuncheon-1")]
    ApChuncheon1,
    #[serde(rename = "ap-singapore-1")]
    ApSingapore1,
    #[serde(rename = "ca-toronto-1")]
    CaToronto1,
    #[serde(rename = "ca-montreal-1")]
    CaMontreal1,
    #[serde(rename = "sa-saopaulo-1")]
    SaSaopaulo1,
    #[serde(rename = "sa-santiago-1")]
    SaSantiago1,
    #[serde(rename = "sa-vinhedo-1")]
    SaVinhedo1,
    #[serde(rename = "me-jeddah-1")]
    MeJeddah1,
    #[serde(rename = "me-dubai-1")]
    MeDubai1,
    #[serde(rename = "af-johannesburg-1")]
    AfJohannesburg1,
    #[serde(rename = "il-jerusalem-1")]
    IlJerusalem1,
}

impl OciRegion {
    pub fn as_str(&self) -> &str {
        match self {
            OciRegion::UsPhoenix1 => "us-phoenix-1",
            OciRegion::UsAshburn1 => "us-ashburn-1",
            OciRegion::UsSanjose1 => "us-sanjose-1",
            OciRegion::UsChicago1 => "us-chicago-1",
            OciRegion::EuFrankfurt1 => "eu-frankfurt-1",
            OciRegion::EuAmsterdam1 => "eu-amsterdam-1",
            OciRegion::EuZurich1 => "eu-zurich-1",
            OciRegion::EuMarseille1 => "eu-marseille-1",
            OciRegion::EuStockholm1 => "eu-stockholm-1",
            OciRegion::EuMilan1 => "eu-milan-1",
            OciRegion::EuParis1 => "eu-paris-1",
            OciRegion::EuMadrid1 => "eu-madrid-1",
            OciRegion::UkLondon1 => "uk-london-1",
            OciRegion::UkCardiff1 => "uk-cardiff-1",
            OciRegion::ApTokyo1 => "ap-tokyo-1",
            OciRegion::ApOsaka1 => "ap-osaka-1",
            OciRegion::ApSydney1 => "ap-sydney-1",
            OciRegion::ApMelbourne1 => "ap-melbourne-1",
            OciRegion::ApMumbai1 => "ap-mumbai-1",
            OciRegion::ApHyderabad1 => "ap-hyderabad-1",
            OciRegion::ApSeoul1 => "ap-seoul-1",
            OciRegion::ApChuncheon1 => "ap-chuncheon-1",
            OciRegion::ApSingapore1 => "ap-singapore-1",
            OciRegion::CaToronto1 => "ca-toronto-1",
            OciRegion::CaMontreal1 => "ca-montreal-1",
            OciRegion::SaSaopaulo1 => "sa-saopaulo-1",
            OciRegion::SaSantiago1 => "sa-santiago-1",
            OciRegion::SaVinhedo1 => "sa-vinhedo-1",
            OciRegion::MeJeddah1 => "me-jeddah-1",
            OciRegion::MeDubai1 => "me-dubai-1",
            OciRegion::AfJohannesburg1 => "af-johannesburg-1",
            OciRegion::IlJerusalem1 => "il-jerusalem-1",
        }
    }
}

impl std::fmt::Display for OciRegion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ─── Compute ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OciInstanceState {
    Moving,
    Provisioning,
    Running,
    Starting,
    Stopped,
    Stopping,
    Terminated,
    Terminating,
    #[serde(rename = "CREATING_IMAGE")]
    CreatingImage,
}

impl Default for OciInstanceState {
    fn default() -> Self {
        OciInstanceState::Stopped
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciInstance {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    #[serde(default)]
    pub fault_domain: String,
    pub shape: String,
    pub lifecycle_state: OciInstanceState,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub image_id: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub source_details: Option<serde_json::Value>,
    #[serde(default)]
    pub launch_options: Option<serde_json::Value>,
    #[serde(default)]
    pub agent_config: Option<serde_json::Value>,
    #[serde(default)]
    pub shape_config: Option<OciShapeConfig>,
    #[serde(default)]
    pub platform_config: Option<serde_json::Value>,
    #[serde(default)]
    pub defined_tags: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    pub freeform_tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciShape {
    pub shape: String,
    #[serde(default)]
    pub ocpus: Option<f64>,
    #[serde(default)]
    pub memory_in_gbs: Option<f64>,
    #[serde(default)]
    pub networking_bandwidth_in_gbps: Option<f64>,
    #[serde(default)]
    pub max_vnic_attachments: Option<u32>,
    #[serde(default)]
    pub gpus: Option<u32>,
    #[serde(default)]
    pub local_disks: Option<u32>,
    #[serde(default)]
    pub local_disk_total_size_in_gbs: Option<f64>,
    #[serde(default)]
    pub processor_description: String,
    #[serde(default)]
    pub is_flexible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciShapeConfig {
    #[serde(default)]
    pub ocpus: Option<f64>,
    #[serde(default)]
    pub memory_in_gbs: Option<f64>,
    #[serde(default)]
    pub baseline_ocpu_utilization: Option<String>,
    #[serde(default)]
    pub nvmes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciImage {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub operating_system: String,
    #[serde(default)]
    pub operating_system_version: String,
    #[serde(default)]
    pub size_in_mbs: Option<u64>,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub compartment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciVnicAttachment {
    pub id: String,
    pub instance_id: String,
    #[serde(default)]
    pub vnic_id: String,
    #[serde(default)]
    pub subnet_id: String,
    #[serde(default)]
    pub nic_index: Option<u32>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBootVolumeAttachment {
    pub id: String,
    pub instance_id: String,
    pub boot_volume_id: String,
    pub availability_domain: String,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInstanceRequest {
    pub compartment_id: String,
    pub availability_domain: String,
    pub shape: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub image_id: String,
    pub subnet_id: String,
    #[serde(default)]
    pub shape_config: Option<OciShapeConfig>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub ssh_authorized_keys: Option<String>,
    #[serde(default)]
    pub user_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciConsoleConnection {
    pub id: String,
    pub instance_id: String,
    pub compartment_id: String,
    #[serde(default)]
    pub connection_string: String,
    #[serde(default)]
    pub vnc_connection_string: String,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciInstanceMetrics {
    pub instance_id: String,
    #[serde(default)]
    pub cpu_utilization: Option<f64>,
    #[serde(default)]
    pub memory_utilization: Option<f64>,
    #[serde(default)]
    pub network_bytes_in: Option<f64>,
    #[serde(default)]
    pub network_bytes_out: Option<f64>,
    #[serde(default)]
    pub disk_read_bytes: Option<f64>,
    #[serde(default)]
    pub disk_write_bytes: Option<f64>,
}

// ─── Networking ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciVcn {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    #[serde(default)]
    pub cidr_block: String,
    #[serde(default)]
    pub cidr_blocks: Vec<String>,
    #[serde(default)]
    pub dns_label: Option<String>,
    #[serde(default)]
    pub default_route_table_id: String,
    #[serde(default)]
    pub default_security_list_id: String,
    #[serde(default)]
    pub default_dhcp_options_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciSubnet {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub cidr_block: String,
    #[serde(default)]
    pub availability_domain: Option<String>,
    #[serde(default)]
    pub route_table_id: String,
    #[serde(default)]
    pub security_list_ids: Vec<String>,
    #[serde(default)]
    pub dns_label: Option<String>,
    #[serde(default)]
    pub prohibit_public_ip_on_vnic: bool,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciSecurityList {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub ingress_security_rules: Vec<OciSecurityRule>,
    #[serde(default)]
    pub egress_security_rules: Vec<OciSecurityRule>,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciSecurityRule {
    pub protocol: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub tcp_options: Option<serde_json::Value>,
    #[serde(default)]
    pub udp_options: Option<serde_json::Value>,
    #[serde(default)]
    pub icmp_options: Option<serde_json::Value>,
    #[serde(default)]
    pub is_stateless: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciRouteTable {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub route_rules: Vec<OciRouteRule>,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciRouteRule {
    pub destination: String,
    #[serde(default)]
    pub destination_type: String,
    pub network_entity_id: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciInternetGateway {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciNatGateway {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub nat_ip: String,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciPublicIp {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    pub compartment_id: String,
    pub ip_address: String,
    #[serde(default)]
    pub lifetime: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub assigned_entity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciNetworkSecurityGroup {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciNsgSecurityRule {
    #[serde(default)]
    pub id: String,
    pub direction: String,
    pub protocol: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub destination_type: Option<String>,
    #[serde(default)]
    pub tcp_options: Option<serde_json::Value>,
    #[serde(default)]
    pub udp_options: Option<serde_json::Value>,
    #[serde(default)]
    pub is_stateless: bool,
    #[serde(default)]
    pub description: Option<String>,
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBlockVolume {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    #[serde(default)]
    pub size_in_gbs: u64,
    #[serde(default)]
    pub vpus_per_gb: Option<u64>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_auto_tune_enabled: bool,
    #[serde(default)]
    pub auto_tuned_vpus_per_gb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciVolumeAttachment {
    pub id: String,
    pub instance_id: String,
    pub volume_id: String,
    #[serde(default)]
    pub attachment_type: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub is_read_only: bool,
    #[serde(default)]
    pub is_shareable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBucket {
    pub name: String,
    pub namespace: String,
    pub compartment_id: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub etag: String,
    #[serde(default)]
    pub public_access_type: Option<String>,
    #[serde(default)]
    pub storage_tier: Option<String>,
    #[serde(default)]
    pub object_lifecycle_policy_etag: Option<String>,
    #[serde(default)]
    pub approximate_count: Option<i64>,
    #[serde(default)]
    pub approximate_size: Option<i64>,
    #[serde(default)]
    pub versioning: Option<String>,
    #[serde(default)]
    pub auto_tiering: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciObject {
    pub name: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub md5: Option<String>,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub time_modified: Option<DateTime<Utc>>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub storage_tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBootVolume {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    #[serde(default)]
    pub size_in_gbs: u64,
    #[serde(default)]
    pub image_id: Option<String>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

// ─── IAM ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciUser {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub email: Option<String>,
    pub compartment_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_mfa_activated: bool,
    #[serde(default)]
    pub capabilities: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub compartment_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciPolicy {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub compartment_id: String,
    #[serde(default)]
    pub statements: Vec<String>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciCompartment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub compartment_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub freeform_tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciApiKey {
    pub key_id: String,
    #[serde(default)]
    pub key_value: String,
    pub fingerprint: String,
    pub user_id: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciUserGroupMembership {
    pub id: String,
    pub user_id: String,
    pub group_id: String,
    pub compartment_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

// ─── Database ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciDbSystem {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub shape: String,
    #[serde(default)]
    pub db_edition: Option<String>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub cpu_core_count: Option<u32>,
    #[serde(default)]
    pub data_storage_size_in_gbs: Option<u64>,
    #[serde(default)]
    pub node_count: Option<u32>,
    #[serde(default)]
    pub license_model: Option<String>,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciAutonomousDatabase {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub db_name: String,
    #[serde(default)]
    pub cpu_core_count: Option<u32>,
    #[serde(default)]
    pub data_storage_size_in_tbs: Option<u32>,
    #[serde(default)]
    pub db_workload: Option<String>,
    #[serde(default)]
    pub is_free_tier: bool,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub connection_strings: Option<serde_json::Value>,
}

// ─── Load Balancer ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciLoadBalancer {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub shape_name: Option<String>,
    #[serde(default)]
    pub ip_addresses: Vec<OciLoadBalancerIp>,
    #[serde(default)]
    pub subnet_ids: Vec<String>,
    #[serde(default)]
    pub listeners: HashMap<String, OciListener>,
    #[serde(default)]
    pub backend_sets: HashMap<String, OciBackendSet>,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciLoadBalancerIp {
    pub ip_address: String,
    #[serde(default)]
    pub is_public: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBackendSet {
    pub name: String,
    #[serde(default)]
    pub policy: String,
    #[serde(default)]
    pub backends: Vec<OciBackend>,
    #[serde(default)]
    pub health_checker: Option<OciHealthChecker>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciBackend {
    pub name: String,
    pub ip_address: String,
    pub port: u16,
    #[serde(default)]
    pub weight: Option<u32>,
    #[serde(default)]
    pub backup: bool,
    #[serde(default)]
    pub drain: bool,
    #[serde(default)]
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciListener {
    pub name: String,
    pub default_backend_set_name: String,
    pub port: u16,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub ssl_configuration: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciHealthChecker {
    pub protocol: String,
    #[serde(default)]
    pub url_path: Option<String>,
    pub port: u16,
    #[serde(default)]
    pub return_code: Option<u16>,
    #[serde(default)]
    pub retries: Option<u32>,
    #[serde(default)]
    pub timeout_in_millis: Option<u64>,
    #[serde(default)]
    pub interval_in_millis: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciLoadBalancerHealth {
    pub status: String,
    #[serde(default)]
    pub warning_state_backends: Vec<String>,
    #[serde(default)]
    pub critical_state_backends: Vec<String>,
    #[serde(default)]
    pub unknown_state_backends: Vec<String>,
    #[serde(default)]
    pub total_backend_count: u32,
}

// ─── Container Engine (OKE) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciCluster {
    pub id: String,
    pub name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    #[serde(default)]
    pub kubernetes_version: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub endpoints: Option<OciClusterEndpoints>,
    #[serde(default)]
    pub options: Option<serde_json::Value>,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciClusterEndpoints {
    #[serde(default)]
    pub kubernetes: Option<String>,
    #[serde(default)]
    pub public_endpoint: Option<String>,
    #[serde(default)]
    pub private_endpoint: Option<String>,
    #[serde(default)]
    pub vcn_hostname_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciNodePool {
    pub id: String,
    pub name: String,
    pub cluster_id: String,
    pub compartment_id: String,
    #[serde(default)]
    pub kubernetes_version: String,
    #[serde(default)]
    pub node_shape: String,
    #[serde(default)]
    pub node_image_id: String,
    #[serde(default)]
    pub nodes: Vec<OciNode>,
    #[serde(default)]
    pub quantity_per_subnet: Option<u32>,
    #[serde(default)]
    pub subnet_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciNode {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub availability_domain: String,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub kubernetes_version: String,
    #[serde(default)]
    pub node_error: Option<serde_json::Value>,
}

// ─── Functions ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciApplication {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    #[serde(default)]
    pub subnet_ids: Vec<String>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciFunction {
    pub id: String,
    pub display_name: String,
    pub application_id: String,
    pub compartment_id: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub memory_in_mbs: Option<u64>,
    #[serde(default)]
    pub timeout_in_seconds: Option<u32>,
    #[serde(default)]
    pub invoke_endpoint: Option<String>,
    #[serde(default)]
    pub lifecycle_state: String,
    #[serde(default)]
    pub time_created: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciFunctionLog {
    pub function_id: String,
    #[serde(default)]
    pub entries: Vec<OciFunctionLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OciFunctionLogEntry {
    #[serde(default)]
    pub timestamp: Option<DateTime<Utc>>,
    #[serde(default)]
    pub message: String,
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct OciDashboard {
    pub region: String,
    pub total_instances: u32,
    pub running_instances: u32,
    pub total_vcns: u32,
    pub total_buckets: u32,
    pub total_volumes: u32,
    pub total_databases: u32,
    pub compartments: u32,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_config_serde() {
        let config = OciConnectionConfig {
            id: "conn-1".to_string(),
            name: "test".to_string(),
            tenancy_ocid: "ocid1.tenancy.oc1..aaa".to_string(),
            user_ocid: "ocid1.user.oc1..bbb".to_string(),
            region: "us-ashburn-1".to_string(),
            fingerprint: "aa:bb:cc".to_string(),
            private_key_path: "/path/to/key.pem".to_string(),
            compartment_id: "ocid1.compartment.oc1..ccc".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: OciConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "conn-1");
        assert_eq!(parsed.region, "us-ashburn-1");
    }

    #[test]
    fn test_region_display() {
        assert_eq!(OciRegion::UsAshburn1.as_str(), "us-ashburn-1");
        assert_eq!(OciRegion::EuFrankfurt1.to_string(), "eu-frankfurt-1");
        assert_eq!(OciRegion::ApTokyo1.as_str(), "ap-tokyo-1");
    }

    #[test]
    fn test_region_serde() {
        let region = OciRegion::UsPhoenix1;
        let json = serde_json::to_string(&region).unwrap();
        assert_eq!(json, "\"us-phoenix-1\"");
        let parsed: OciRegion = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, OciRegion::UsPhoenix1);
    }

    #[test]
    fn test_instance_state_default() {
        let state = OciInstanceState::default();
        assert_eq!(state, OciInstanceState::Stopped);
    }

    #[test]
    fn test_instance_default() {
        let instance = OciInstance::default();
        assert_eq!(instance.lifecycle_state, OciInstanceState::Stopped);
        assert!(instance.id.is_empty());
    }

    #[test]
    fn test_instance_serde() {
        let json = r#"{
            "id": "ocid1.instance.oc1..aaa",
            "displayName": "test-instance",
            "compartmentId": "ocid1.compartment.oc1..bbb",
            "availabilityDomain": "AD-1",
            "shape": "VM.Standard.E4.Flex",
            "lifecycleState": "Running",
            "region": "us-ashburn-1"
        }"#;
        let instance: OciInstance = serde_json::from_str(json).unwrap();
        assert_eq!(instance.display_name, "test-instance");
        assert_eq!(instance.lifecycle_state, OciInstanceState::Running);
    }

    #[test]
    fn test_shape_default() {
        let shape = OciShape::default();
        assert!(!shape.is_flexible);
        assert!(shape.ocpus.is_none());
    }

    #[test]
    fn test_vcn_serde() {
        let json = r#"{
            "id": "ocid1.vcn.oc1..aaa",
            "displayName": "test-vcn",
            "compartmentId": "comp-1",
            "cidrBlock": "10.0.0.0/16",
            "lifecycleState": "AVAILABLE"
        }"#;
        let vcn: OciVcn = serde_json::from_str(json).unwrap();
        assert_eq!(vcn.cidr_block, "10.0.0.0/16");
    }

    #[test]
    fn test_bucket_default() {
        let bucket = OciBucket::default();
        assert!(bucket.name.is_empty());
        assert!(bucket.approximate_count.is_none());
    }

    #[test]
    fn test_autonomous_db_serde() {
        let json = r#"{
            "id": "ocid1.autonomousdatabase.oc1..aaa",
            "displayName": "my-adb",
            "compartmentId": "comp-1",
            "dbName": "MYDB",
            "isFreeTier": true,
            "lifecycleState": "AVAILABLE"
        }"#;
        let db: OciAutonomousDatabase = serde_json::from_str(json).unwrap();
        assert!(db.is_free_tier);
        assert_eq!(db.db_name, "MYDB");
    }

    #[test]
    fn test_load_balancer_default() {
        let lb = OciLoadBalancer::default();
        assert!(lb.listeners.is_empty());
        assert!(lb.backend_sets.is_empty());
        assert!(!lb.is_private);
    }

    #[test]
    fn test_cluster_default() {
        let cluster = OciCluster::default();
        assert!(cluster.id.is_empty());
        assert!(cluster.endpoints.is_none());
    }

    #[test]
    fn test_function_default() {
        let func = OciFunction::default();
        assert!(func.image.is_empty());
        assert!(func.memory_in_mbs.is_none());
    }

    #[test]
    fn test_dashboard_default() {
        let dash = OciDashboard::default();
        assert_eq!(dash.total_instances, 0);
        assert_eq!(dash.running_instances, 0);
    }

    #[test]
    fn test_security_rule_defaults() {
        let rule = OciSecurityRule::default();
        assert!(!rule.is_stateless);
        assert!(rule.source.is_none());
        assert!(rule.destination.is_none());
    }

    #[test]
    fn test_backend_defaults() {
        let backend = OciBackend::default();
        assert!(!backend.backup);
        assert!(!backend.drain);
        assert!(!backend.offline);
        assert_eq!(backend.port, 0);
    }

    #[test]
    fn test_connection_info_default() {
        let info = OciConnectionInfo::default();
        assert!(!info.connected);
    }
}
