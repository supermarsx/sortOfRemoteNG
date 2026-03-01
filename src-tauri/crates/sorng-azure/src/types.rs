//! Core types for Azure Resource Manager API integration.

use std::collections::HashMap;
use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Error types ─────────────────────────────────────────────────────

/// Categorised error kinds for Azure operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AzureErrorKind {
    Auth,
    NotFound,
    Conflict,
    Forbidden,
    RateLimit,
    BadRequest,
    ServerError,
    Timeout,
    Network,
    Parse,
    Validation,
    NotAuthenticated,
    SubscriptionNotSet,
    ResourceGroupRequired,
}

impl fmt::Display for AzureErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Auth => write!(f, "Authentication error"),
            Self::NotFound => write!(f, "Resource not found"),
            Self::Conflict => write!(f, "Resource conflict"),
            Self::Forbidden => write!(f, "Forbidden"),
            Self::RateLimit => write!(f, "Rate limit exceeded"),
            Self::BadRequest => write!(f, "Bad request"),
            Self::ServerError => write!(f, "Server error"),
            Self::Timeout => write!(f, "Request timeout"),
            Self::Network => write!(f, "Network error"),
            Self::Parse => write!(f, "Parse error"),
            Self::Validation => write!(f, "Validation error"),
            Self::NotAuthenticated => write!(f, "Not authenticated"),
            Self::SubscriptionNotSet => write!(f, "Subscription ID not set"),
            Self::ResourceGroupRequired => write!(f, "Resource group required"),
        }
    }
}

/// Main error type for Azure operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureError {
    pub kind: AzureErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
}

impl AzureError {
    pub fn new(kind: AzureErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
        }
    }

    pub fn with_status(kind: AzureErrorKind, message: impl Into<String>, status: u16) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: Some(status),
        }
    }

    pub fn from_status(status: u16, body: &str) -> Self {
        let kind = match status {
            400 => AzureErrorKind::BadRequest,
            401 => AzureErrorKind::Auth,
            403 => AzureErrorKind::Forbidden,
            404 => AzureErrorKind::NotFound,
            409 => AzureErrorKind::Conflict,
            429 => AzureErrorKind::RateLimit,
            500..=599 => AzureErrorKind::ServerError,
            _ => AzureErrorKind::Network,
        };
        Self::with_status(kind, body.to_string(), status)
    }

    pub fn not_authenticated() -> Self {
        Self::new(AzureErrorKind::NotAuthenticated, "Not authenticated — call set_credentials and authenticate first")
    }

    pub fn subscription_not_set() -> Self {
        Self::new(AzureErrorKind::SubscriptionNotSet, "Subscription ID not configured")
    }

    pub fn resource_group_required() -> Self {
        Self::new(AzureErrorKind::ResourceGroupRequired, "Resource group name is required for this operation")
    }
}

impl fmt::Display for AzureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for AzureError {}

impl From<AzureError> for String {
    fn from(e: AzureError) -> String {
        e.to_string()
    }
}

pub type AzureResult<T> = Result<T, AzureError>;

// ─── OAuth / Auth ────────────────────────────────────────────────────

/// Client credentials for Azure AD (service-principal or app-registration).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AzureCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub tenant_id: String,
    pub subscription_id: String,
    /// Optional default resource group.
    #[serde(default)]
    pub default_resource_group: Option<String>,
    /// Optional default region (e.g. "eastus").
    #[serde(default)]
    pub default_region: Option<String>,
}

/// Cached bearer token.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AzureToken {
    pub access_token: String,
    pub token_type: String,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub resource: Option<String>,
}

impl AzureToken {
    pub fn is_expired(&self) -> bool {
        match self.expires_at {
            Some(exp) => Utc::now() >= exp,
            None => false,
        }
    }
}

/// Raw token endpoint response.
#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub resource: Option<String>,
}

// ─── Azure Resource Manager common ──────────────────────────────────

/// Generic ARM list wrapper (`value` array with optional `nextLink`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArmList<T> {
    #[serde(default)]
    pub value: Vec<T>,
    #[serde(default)]
    pub next_link: Option<String>,
}

/// Minimal resource skeleton common to most ARM resources.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AzureResource {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub resource_type: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}

// ─── Subscriptions ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub subscription_id: String,
    pub display_name: String,
    pub state: String,
    #[serde(default)]
    pub tenant_id: Option<String>,
}

// ─── Resource Groups ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceGroup {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<ResourceGroupProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceGroupProperties {
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateResourceGroupRequest {
    pub location: String,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tags: HashMap<String, String>,
}

// ─── Virtual Machines ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMachine {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: VmProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VmProperties {
    #[serde(default)]
    pub vm_id: Option<String>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
    #[serde(default)]
    pub hardware_profile: Option<HardwareProfile>,
    #[serde(default)]
    pub storage_profile: Option<StorageProfile>,
    #[serde(default)]
    pub os_profile: Option<OsProfile>,
    #[serde(default)]
    pub network_profile: Option<NetworkProfile>,
    #[serde(default)]
    pub instance_view: Option<VmInstanceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    #[serde(default)]
    pub vm_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageProfile {
    #[serde(default)]
    pub image_reference: Option<ImageReference>,
    #[serde(default)]
    pub os_disk: Option<OsDisk>,
    #[serde(default)]
    pub data_disks: Vec<DataDisk>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageReference {
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub offer: Option<String>,
    #[serde(default)]
    pub sku: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OsDisk {
    #[serde(default)]
    pub os_type: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub disk_size_gb: Option<u32>,
    #[serde(default)]
    pub caching: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DataDisk {
    #[serde(default)]
    pub lun: u32,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub disk_size_gb: Option<u32>,
    #[serde(default)]
    pub caching: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OsProfile {
    #[serde(default)]
    pub computer_name: Option<String>,
    #[serde(default)]
    pub admin_username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    #[serde(default)]
    pub network_interfaces: Vec<NetworkInterfaceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkInterfaceRef {
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VmInstanceView {
    #[serde(default)]
    pub statuses: Vec<InstanceViewStatus>,
    #[serde(default)]
    pub vm_agent: Option<VmAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstanceViewStatus {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub display_status: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VmAgent {
    #[serde(default)]
    pub vm_agent_version: Option<String>,
    #[serde(default)]
    pub statuses: Vec<InstanceViewStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VmSize {
    pub name: String,
    #[serde(default)]
    pub number_of_cores: u32,
    #[serde(default)]
    pub memory_in_mb: u64,
    #[serde(default)]
    pub max_data_disk_count: u32,
    #[serde(default)]
    pub os_disk_size_in_mb: u64,
    #[serde(default)]
    pub resource_disk_size_in_mb: u64,
}

/// Simplified VM summary for connection-tree views.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmSummary {
    pub id: String,
    pub name: String,
    pub resource_group: String,
    pub location: String,
    pub size: String,
    pub os_type: String,
    pub power_state: String,
    pub provisioning_state: String,
    pub private_ip: Option<String>,
    pub public_ip: Option<String>,
    pub tags: HashMap<String, String>,
}

// ─── Networking ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VirtualNetwork {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<VnetProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VnetProperties {
    #[serde(default)]
    pub address_space: Option<AddressSpace>,
    #[serde(default)]
    pub subnets: Vec<Subnet>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddressSpace {
    #[serde(default)]
    pub address_prefixes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subnet {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<SubnetProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubnetProperties {
    #[serde(default)]
    pub address_prefix: Option<String>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSecurityGroup {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<NsgProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NsgProperties {
    #[serde(default)]
    pub security_rules: Vec<SecurityRule>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecurityRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<SecurityRuleProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecurityRuleProperties {
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub source_port_range: Option<String>,
    #[serde(default)]
    pub destination_port_range: Option<String>,
    #[serde(default)]
    pub source_address_prefix: Option<String>,
    #[serde(default)]
    pub destination_address_prefix: Option<String>,
    #[serde(default)]
    pub access: Option<String>,
    #[serde(default)]
    pub priority: Option<u32>,
    #[serde(default)]
    pub direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicIpAddress {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub properties: Option<PublicIpProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicIpProperties {
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub public_ip_allocation_method: Option<String>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub properties: Option<NicProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NicProperties {
    #[serde(default)]
    pub ip_configurations: Vec<IpConfiguration>,
    #[serde(default)]
    pub mac_address: Option<String>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpConfiguration {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<IpConfigProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpConfigProperties {
    #[serde(default)]
    pub private_ip_address: Option<String>,
    #[serde(default)]
    pub private_ip_allocation_method: Option<String>,
    #[serde(default)]
    pub public_ip_address: Option<PublicIpRef>,
    #[serde(default)]
    pub subnet: Option<SubnetRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublicIpRef {
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SubnetRef {
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoadBalancer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub sku: Option<LoadBalancerSku>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadBalancerSku {
    #[serde(default)]
    pub name: Option<String>,
}

// ─── Storage Accounts ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageAccount {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub sku: Option<StorageSku>,
    #[serde(default)]
    pub properties: Option<StorageAccountProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageSku {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageAccountProperties {
    #[serde(default)]
    pub provisioning_state: Option<String>,
    #[serde(default)]
    pub creation_time: Option<String>,
    #[serde(default)]
    pub primary_endpoints: Option<StorageEndpoints>,
    #[serde(default)]
    pub primary_location: Option<String>,
    #[serde(default)]
    pub status_of_primary: Option<String>,
    #[serde(default)]
    pub access_tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageEndpoints {
    #[serde(default)]
    pub blob: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub table: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageAccountKey {
    #[serde(default, rename = "keyName")]
    pub key_name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageKeyList {
    #[serde(default)]
    pub keys: Vec<StorageAccountKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStorageAccountRequest {
    pub location: String,
    pub kind: String,
    pub sku: StorageSku,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlobContainer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<BlobContainerProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlobContainerProperties {
    #[serde(default)]
    pub public_access: Option<String>,
    #[serde(default)]
    pub last_modified_time: Option<String>,
    #[serde(default)]
    pub lease_status: Option<String>,
    #[serde(default)]
    pub lease_state: Option<String>,
}

// ─── App Service ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebApp {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<WebAppProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebAppProperties {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub default_host_name: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub https_only: Option<bool>,
    #[serde(default)]
    pub last_modified_time_utc: Option<String>,
    #[serde(default)]
    pub resource_group: Option<String>,
    #[serde(default)]
    pub server_farm_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentSlot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<WebAppProperties>,
}

// ─── SQL ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlServer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<SqlServerProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlServerProperties {
    #[serde(default)]
    pub fully_qualified_domain_name: Option<String>,
    #[serde(default)]
    pub administrator_login: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlDatabase {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub properties: Option<SqlDatabaseProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlDatabaseProperties {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub max_size_bytes: Option<u64>,
    #[serde(default)]
    pub creation_date: Option<String>,
    #[serde(default)]
    pub current_service_objective_name: Option<String>,
    #[serde(default)]
    pub default_secondary_location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlFirewallRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<SqlFirewallRuleProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SqlFirewallRuleProperties {
    #[serde(default)]
    pub start_ip_address: Option<String>,
    #[serde(default)]
    pub end_ip_address: Option<String>,
}

// ─── Key Vault ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyVault {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<KeyVaultProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyVaultProperties {
    #[serde(default)]
    pub vault_uri: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub enable_soft_delete: Option<bool>,
    #[serde(default)]
    pub enable_purge_protection: Option<bool>,
}

/// Key Vault data-plane secret item (list entry).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub attributes: Option<SecretAttributes>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretAttributes {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub created: Option<u64>,
    #[serde(default)]
    pub updated: Option<u64>,
}

/// Key Vault secret value (get).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretBundle {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub attributes: Option<SecretAttributes>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
}

/// Key Vault key item (list entry).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KeyItem {
    #[serde(default)]
    pub kid: String,
    #[serde(default)]
    pub attributes: Option<SecretAttributes>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}

/// Key Vault certificate item (list entry).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CertificateItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub attributes: Option<SecretAttributes>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}

// ─── Container Instances ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerGroup {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub properties: Option<ContainerGroupProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerGroupProperties {
    #[serde(default)]
    pub containers: Vec<Container>,
    #[serde(default)]
    pub os_type: Option<String>,
    #[serde(default)]
    pub provisioning_state: Option<String>,
    #[serde(default)]
    pub ip_address: Option<ContainerIpAddress>,
    #[serde(default)]
    pub restart_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<ContainerProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerProperties {
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub resources: Option<ContainerResources>,
    #[serde(default)]
    pub ports: Vec<ContainerPort>,
    #[serde(default)]
    pub instance_view: Option<ContainerInstanceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContainerResources {
    #[serde(default)]
    pub requests: Option<ResourceRequests>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRequests {
    #[serde(default)]
    pub cpu: Option<f64>,
    #[serde(default)]
    pub memory_in_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContainerPort {
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInstanceView {
    #[serde(default)]
    pub current_state: Option<ContainerState>,
    #[serde(default)]
    pub restart_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerState {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerIpAddress {
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub ports: Vec<ContainerPort>,
    #[serde(default, rename = "type")]
    pub ip_type: Option<String>,
}

/// Container logs response.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContainerLogs {
    #[serde(default)]
    pub content: Option<String>,
}

// ─── Monitor / Metrics ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: Option<MetricName>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub primary_aggregation_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricName {
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub localized_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricResponse {
    #[serde(default)]
    pub cost: Option<u32>,
    #[serde(default)]
    pub timespan: Option<String>,
    #[serde(default)]
    pub interval: Option<String>,
    #[serde(default)]
    pub value: Vec<Metric>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: Option<MetricName>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub timeseries: Vec<TimeSeries>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimeSeries {
    #[serde(default)]
    pub data: Vec<MetricValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricValue {
    #[serde(default)]
    pub time_stamp: String,
    #[serde(default)]
    pub total: Option<f64>,
    #[serde(default)]
    pub average: Option<f64>,
    #[serde(default)]
    pub minimum: Option<f64>,
    #[serde(default)]
    pub maximum: Option<f64>,
    #[serde(default)]
    pub count: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    #[serde(default)]
    pub operation_name: Option<ActivityLogName>,
    #[serde(default)]
    pub status: Option<ActivityLogName>,
    #[serde(default)]
    pub event_timestamp: Option<String>,
    #[serde(default)]
    pub caller: Option<String>,
    #[serde(default)]
    pub resource_id: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogName {
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub localized_value: Option<String>,
}

// ─── Cost Management ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetail {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<UsageDetailProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetailProperties {
    #[serde(default)]
    pub billing_period_id: Option<String>,
    #[serde(default)]
    pub usage_start: Option<String>,
    #[serde(default)]
    pub usage_end: Option<String>,
    #[serde(default)]
    pub instance_name: Option<String>,
    #[serde(default)]
    pub meter_details: Option<MeterDetails>,
    #[serde(default)]
    pub pretax_cost: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub resource_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MeterDetails {
    #[serde(default)]
    pub meter_name: Option<String>,
    #[serde(default)]
    pub meter_category: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub properties: Option<BudgetProperties>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BudgetProperties {
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub time_grain: Option<String>,
    #[serde(default)]
    pub time_period: Option<TimePeriod>,
    #[serde(default)]
    pub current_spend: Option<CurrentSpend>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimePeriod {
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSpend {
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
}

// ─── Resource Search ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSearchRequest {
    pub query: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subscriptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceSearchResponse {
    #[serde(default)]
    pub count: u64,
    #[serde(default)]
    pub data: ResourceSearchData,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceSearchData {
    #[serde(default)]
    pub columns: Vec<ResourceSearchColumn>,
    #[serde(default)]
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceSearchColumn {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub column_type: String,
}

// ─── Configuration / Connection Summary ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AzureConfig {
    pub default_page_size: u32,
    pub api_version_compute: String,
    pub api_version_network: String,
    pub api_version_storage: String,
    pub api_version_web: String,
    pub api_version_sql: String,
    pub api_version_keyvault: String,
    pub api_version_container: String,
    pub api_version_monitor: String,
    pub api_version_cost: String,
    pub api_version_resources: String,
    pub api_version_resource_graph: String,
}

impl AzureConfig {
    pub fn new() -> Self {
        Self {
            default_page_size: 100,
            api_version_compute: "2024-03-01".into(),
            api_version_network: "2024-01-01".into(),
            api_version_storage: "2023-05-01".into(),
            api_version_web: "2023-12-01".into(),
            api_version_sql: "2023-05-01-preview".into(),
            api_version_keyvault: "2023-07-01".into(),
            api_version_container: "2023-05-01".into(),
            api_version_monitor: "2024-02-01".into(),
            api_version_cost: "2023-11-01".into(),
            api_version_resources: "2024-03-01".into(),
            api_version_resource_graph: "2022-10-01".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureConnectionSummary {
    pub authenticated: bool,
    pub subscription_id: Option<String>,
    pub tenant_id: Option<String>,
    pub default_resource_group: Option<String>,
    pub default_region: Option<String>,
    pub token_expires_at: Option<String>,
}

// ─── Azure API version constants ────────────────────────────────────

pub mod api_versions {
    pub const COMPUTE: &str = "2024-03-01";
    pub const NETWORK: &str = "2024-01-01";
    pub const STORAGE: &str = "2023-05-01";
    pub const WEB: &str = "2023-12-01";
    pub const SQL: &str = "2023-05-01-preview";
    pub const KEYVAULT_MGMT: &str = "2023-07-01";
    pub const KEYVAULT_DATA: &str = "7.4";
    pub const CONTAINER_INSTANCE: &str = "2023-05-01";
    pub const MONITOR: &str = "2024-02-01";
    pub const COST: &str = "2023-11-01";
    pub const RESOURCES: &str = "2024-03-01";
    pub const RESOURCE_GRAPH: &str = "2022-10-01";
    pub const SUBSCRIPTIONS: &str = "2022-12-01";
}

/// Azure management base URL.
pub const ARM_BASE: &str = "https://management.azure.com";

/// Azure AD token endpoint template.
pub const TOKEN_URL_TEMPLATE: &str = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = AzureError::new(AzureErrorKind::Auth, "bad credentials");
        assert_eq!(e.to_string(), "[Authentication error] bad credentials");
    }

    #[test]
    fn error_from_status_codes() {
        assert_eq!(AzureError::from_status(400, "x").kind, AzureErrorKind::BadRequest);
        assert_eq!(AzureError::from_status(401, "x").kind, AzureErrorKind::Auth);
        assert_eq!(AzureError::from_status(403, "x").kind, AzureErrorKind::Forbidden);
        assert_eq!(AzureError::from_status(404, "x").kind, AzureErrorKind::NotFound);
        assert_eq!(AzureError::from_status(409, "x").kind, AzureErrorKind::Conflict);
        assert_eq!(AzureError::from_status(429, "x").kind, AzureErrorKind::RateLimit);
        assert_eq!(AzureError::from_status(500, "x").kind, AzureErrorKind::ServerError);
        assert_eq!(AzureError::from_status(503, "x").kind, AzureErrorKind::ServerError);
    }

    #[test]
    fn error_std_error_trait() {
        let e = AzureError::new(AzureErrorKind::Network, "timeout");
        let _: &dyn std::error::Error = &e;
    }

    #[test]
    fn error_to_string_conversion() {
        let e = AzureError::not_authenticated();
        let s: String = e.into();
        assert!(s.contains("Not authenticated"));
    }

    #[test]
    fn token_not_expired_when_no_expiry() {
        let t = AzureToken::default();
        assert!(!t.is_expired());
    }

    #[test]
    fn token_expired_in_past() {
        let t = AzureToken {
            access_token: "tok".into(),
            token_type: "Bearer".into(),
            expires_at: Some(Utc::now() - chrono::Duration::hours(1)),
            resource: None,
        };
        assert!(t.is_expired());
    }

    #[test]
    fn token_not_expired_in_future() {
        let t = AzureToken {
            access_token: "tok".into(),
            token_type: "Bearer".into(),
            expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
            resource: None,
        };
        assert!(!t.is_expired());
    }

    #[test]
    fn credentials_default() {
        let c = AzureCredentials::default();
        assert!(c.client_id.is_empty());
        assert!(c.default_resource_group.is_none());
    }

    #[test]
    fn config_defaults() {
        let c = AzureConfig::new();
        assert_eq!(c.default_page_size, 100);
        assert!(!c.api_version_compute.is_empty());
    }

    #[test]
    fn api_version_constants() {
        assert_eq!(api_versions::COMPUTE, "2024-03-01");
        assert_eq!(api_versions::KEYVAULT_DATA, "7.4");
    }

    #[test]
    fn arm_base_url() {
        assert_eq!(ARM_BASE, "https://management.azure.com");
    }

    #[test]
    fn vm_default() {
        let vm = VirtualMachine::default();
        assert!(vm.name.is_empty());
        assert!(vm.properties.hardware_profile.is_none());
    }

    #[test]
    fn vm_summary_serde() {
        let s = VmSummary {
            id: "/sub/123/vm/test".into(),
            name: "test-vm".into(),
            resource_group: "rg1".into(),
            location: "eastus".into(),
            size: "Standard_B1s".into(),
            os_type: "Linux".into(),
            power_state: "running".into(),
            provisioning_state: "Succeeded".into(),
            private_ip: Some("10.0.0.4".into()),
            public_ip: None,
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let d: VmSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(d.name, "test-vm");
        assert_eq!(d.private_ip, Some("10.0.0.4".into()));
    }

    #[test]
    fn resource_group_serde() {
        let json = r#"{"id":"/sub/rg","name":"my-rg","location":"westus","tags":{}}"#;
        let rg: ResourceGroup = serde_json::from_str(json).unwrap();
        assert_eq!(rg.name, "my-rg");
        assert_eq!(rg.location, "westus");
    }

    #[test]
    fn arm_list_deserialization() {
        let json = r#"{"value":[{"id":"1","name":"a","location":"x","tags":{}},{"id":"2","name":"b","location":"y","tags":{}}],"nextLink":"http://next"}"#;
        let list: ArmList<ResourceGroup> = serde_json::from_str(json).unwrap();
        assert_eq!(list.value.len(), 2);
        assert_eq!(list.next_link.unwrap(), "http://next");
    }

    #[test]
    fn arm_list_empty() {
        let list: ArmList<VirtualMachine> = ArmList::default();
        assert!(list.value.is_empty());
        assert!(list.next_link.is_none());
    }

    #[test]
    fn storage_account_serde() {
        let json = r#"{"id":"x","name":"sa1","location":"eastus","kind":"StorageV2","tags":{}}"#;
        let sa: StorageAccount = serde_json::from_str(json).unwrap();
        assert_eq!(sa.name, "sa1");
        assert_eq!(sa.kind, Some("StorageV2".into()));
    }

    #[test]
    fn network_security_group_default() {
        let nsg = NetworkSecurityGroup::default();
        assert!(nsg.name.is_empty());
    }

    #[test]
    fn web_app_serde() {
        let json = r#"{"id":"x","name":"myapp","location":"westus","kind":"app","tags":{}}"#;
        let app: WebApp = serde_json::from_str(json).unwrap();
        assert_eq!(app.name, "myapp");
        assert_eq!(app.kind, Some("app".into()));
    }

    #[test]
    fn sql_server_default() {
        let s = SqlServer::default();
        assert!(s.name.is_empty());
    }

    #[test]
    fn key_vault_default() {
        let kv = KeyVault::default();
        assert!(kv.name.is_empty());
    }

    #[test]
    fn secret_bundle_serde() {
        let json = r#"{"id":"https://myvault.vault.azure.net/secrets/mysecret","value":"s3cret"}"#;
        let s: SecretBundle = serde_json::from_str(json).unwrap();
        assert_eq!(s.value, "s3cret");
    }

    #[test]
    fn container_group_default() {
        let cg = ContainerGroup::default();
        assert!(cg.name.is_empty());
    }

    #[test]
    fn metric_value_serde() {
        let json = r#"{"timeStamp":"2024-01-01T00:00:00Z","average":42.5}"#;
        let mv: MetricValue = serde_json::from_str(json).unwrap();
        assert_eq!(mv.average, Some(42.5));
    }

    #[test]
    fn subscription_serde() {
        let json = r#"{"subscriptionId":"abc-123","displayName":"My Sub","state":"Enabled"}"#;
        let sub: Subscription = serde_json::from_str(json).unwrap();
        assert_eq!(sub.subscription_id, "abc-123");
        assert_eq!(sub.display_name, "My Sub");
    }

    #[test]
    fn budget_serde() {
        let json = r#"{"id":"x","name":"monthly","properties":{"category":"Cost","amount":1000}}"#;
        let b: Budget = serde_json::from_str(json).unwrap();
        assert_eq!(b.name, "monthly");
        assert_eq!(b.properties.unwrap().amount, Some(1000.0));
    }

    #[test]
    fn connection_summary_serde() {
        let cs = AzureConnectionSummary {
            authenticated: true,
            subscription_id: Some("sub123".into()),
            tenant_id: Some("ten123".into()),
            default_resource_group: Some("rg1".into()),
            default_region: Some("eastus".into()),
            token_expires_at: None,
        };
        let json = serde_json::to_string(&cs).unwrap();
        let d: AzureConnectionSummary = serde_json::from_str(&json).unwrap();
        assert!(d.authenticated);
        assert_eq!(d.subscription_id, Some("sub123".into()));
    }

    #[test]
    fn resource_search_request_serde() {
        let r = ResourceSearchRequest {
            query: "Resources | where type == 'microsoft.compute/virtualmachines'".into(),
            subscriptions: vec!["sub1".into()],
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("Resources"));
    }

    #[test]
    fn create_rg_request_serde() {
        let r = CreateResourceGroupRequest {
            location: "eastus".into(),
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("eastus"));
        // empty tags omitted
        assert!(!json.contains("tags"));
    }

    #[test]
    fn instance_view_status_default() {
        let s = InstanceViewStatus::default();
        assert!(s.code.is_empty());
        assert!(s.display_status.is_none());
    }

    #[test]
    fn load_balancer_default() {
        let lb = LoadBalancer::default();
        assert!(lb.name.is_empty());
        assert!(lb.sku.is_none());
    }

    #[test]
    fn usage_detail_default() {
        let ud = UsageDetail::default();
        assert!(ud.name.is_empty());
    }
}
