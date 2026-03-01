//! Google Compute Engine client.
//!
//! Covers instances, disks, snapshots, machine types, images, firewalls,
//! networks, subnetworks, addresses, and instance groups.
//!
//! API base: `https://compute.googleapis.com/compute/v1`

use crate::client::GcpClient;
use crate::error::{GcpError, GcpResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "compute";
const V1: &str = "/compute/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Compute Engine instance.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Instance {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "machineType")]
    pub machine_type: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub zone: String,
    #[serde(default, rename = "creationTimestamp")]
    pub creation_timestamp: String,
    #[serde(default, rename = "networkInterfaces")]
    pub network_interfaces: Vec<NetworkInterface>,
    #[serde(default)]
    pub disks: Vec<AttachedDisk>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub tags: Option<Tags>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default)]
    pub metadata: Option<Metadata>,
    #[serde(default, rename = "serviceAccounts")]
    pub service_accounts: Vec<ServiceAccount>,
    #[serde(default)]
    pub scheduling: Option<Scheduling>,
    #[serde(default, rename = "canIpForward")]
    pub can_ip_forward: bool,
    #[serde(default, rename = "deletionProtection")]
    pub deletion_protection: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetworkInterface {
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub subnetwork: String,
    #[serde(default, rename = "networkIP")]
    pub network_ip: String,
    #[serde(default, rename = "accessConfigs")]
    pub access_configs: Vec<AccessConfig>,
    #[serde(default, rename = "aliasIpRanges")]
    pub alias_ip_ranges: Vec<AliasIpRange>,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccessConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "natIP")]
    pub nat_ip: Option<String>,
    #[serde(default, rename = "type")]
    pub config_type: String,
    #[serde(default, rename = "networkTier")]
    pub network_tier: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AliasIpRange {
    #[serde(default, rename = "ipCidrRange")]
    pub ip_cidr_range: String,
    #[serde(default, rename = "subnetworkRangeName")]
    pub subnetwork_range_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AttachedDisk {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub boot: bool,
    #[serde(default, rename = "autoDelete")]
    pub auto_delete: bool,
    #[serde(default)]
    pub mode: String,
    #[serde(default, rename = "deviceName")]
    pub device_name: String,
    #[serde(default, rename = "type")]
    pub disk_type: String,
    #[serde(default, rename = "diskSizeGb")]
    pub disk_size_gb: Option<String>,
    #[serde(default)]
    pub index: u32,
    #[serde(default)]
    pub interface: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Tags {
    #[serde(default)]
    pub items: Vec<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(default)]
    pub items: Vec<MetadataItem>,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataItem {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServiceAccount {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Scheduling {
    #[serde(default, rename = "onHostMaintenance")]
    pub on_host_maintenance: Option<String>,
    #[serde(default, rename = "automaticRestart")]
    pub automatic_restart: Option<bool>,
    #[serde(default)]
    pub preemptible: bool,
    #[serde(default, rename = "provisioningModel")]
    pub provisioning_model: Option<String>,
}

/// Persistent disk.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Disk {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "sizeGb")]
    pub size_gb: String,
    #[serde(default)]
    pub zone: String,
    #[serde(default, rename = "type")]
    pub disk_type: String,
    #[serde(default, rename = "sourceImage")]
    pub source_image: Option<String>,
    #[serde(default, rename = "sourceSnapshot")]
    pub source_snapshot: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "creationTimestamp")]
    pub creation_timestamp: String,
    #[serde(default)]
    pub users: Vec<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "physicalBlockSizeBytes")]
    pub physical_block_size_bytes: Option<String>,
}

/// Snapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "sourceDisk")]
    pub source_disk: String,
    #[serde(default, rename = "diskSizeGb")]
    pub disk_size_gb: String,
    #[serde(default, rename = "storageBytes")]
    pub storage_bytes: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "creationTimestamp")]
    pub creation_timestamp: String,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
}

/// Machine type.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MachineType {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "guestCpus")]
    pub guest_cpus: u32,
    #[serde(default, rename = "memoryMb")]
    pub memory_mb: u64,
    #[serde(default, rename = "maximumPersistentDisks")]
    pub maximum_persistent_disks: u32,
    #[serde(default, rename = "maximumPersistentDisksSizeGb")]
    pub maximum_persistent_disks_size_gb: Option<String>,
    #[serde(default)]
    pub zone: String,
    #[serde(default, rename = "isSharedCpu")]
    pub is_shared_cpu: bool,
}

/// Firewall rule.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Firewall {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub priority: u32,
    #[serde(default)]
    pub allowed: Vec<FirewallAllowed>,
    #[serde(default)]
    pub denied: Vec<FirewallDenied>,
    #[serde(default, rename = "sourceRanges")]
    pub source_ranges: Vec<String>,
    #[serde(default, rename = "destinationRanges")]
    pub destination_ranges: Vec<String>,
    #[serde(default, rename = "sourceTags")]
    pub source_tags: Vec<String>,
    #[serde(default, rename = "targetTags")]
    pub target_tags: Vec<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FirewallAllowed {
    #[serde(default, rename = "IPProtocol")]
    pub ip_protocol: String,
    #[serde(default)]
    pub ports: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FirewallDenied {
    #[serde(default, rename = "IPProtocol")]
    pub ip_protocol: String,
    #[serde(default)]
    pub ports: Vec<String>,
}

/// VPC network.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Network {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "autoCreateSubnetworks")]
    pub auto_create_subnetworks: bool,
    #[serde(default)]
    pub subnetworks: Vec<String>,
    #[serde(default, rename = "routingConfig")]
    pub routing_config: Option<RoutingConfig>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default)]
    pub mtu: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingConfig {
    #[serde(default, rename = "routingMode")]
    pub routing_mode: String,
}

/// Subnetwork.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Subnetwork {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub region: String,
    #[serde(default, rename = "ipCidrRange")]
    pub ip_cidr_range: String,
    #[serde(default, rename = "gatewayAddress")]
    pub gateway_address: Option<String>,
    #[serde(default, rename = "privateIpGoogleAccess")]
    pub private_ip_google_access: bool,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
}

/// Static/external address.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Address {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default, rename = "addressType")]
    pub address_type: String,
    #[serde(default, rename = "networkTier")]
    pub network_tier: Option<String>,
    #[serde(default)]
    pub users: Vec<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
}

/// GCE operation (for async Compute actions).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Operation {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "operationType")]
    pub operation_type: String,
    #[serde(default, rename = "targetLink")]
    pub target_link: Option<String>,
    #[serde(default)]
    pub progress: u32,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default)]
    pub zone: Option<String>,
}

// ── List response wrappers ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListResponse<T> {
    #[serde(default)]
    items: Vec<T>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── Compute Engine Client ───────────────────────────────────────────────

pub struct ComputeClient;

impl ComputeClient {
    // ── Instances ────────────────────────────────────────────────────

    /// List instances in a zone.
    pub async fn list_instances(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        filter: Option<&str>,
        max_results: Option<u32>,
    ) -> GcpResult<Vec<Instance>> {
        let path = format!("{}/projects/{}/zones/{}/instances", V1, project, zone);
        let mut query: Vec<(&str, &str)> = Vec::new();
        let filter_str;
        if let Some(f) = filter {
            filter_str = f.to_string();
            query.push(("filter", &filter_str));
        }
        let max_str;
        if let Some(m) = max_results {
            max_str = m.to_string();
            query.push(("maxResults", &max_str));
        }
        let resp: ListResponse<Instance> = client.get(SERVICE, &path, &query).await?;
        Ok(resp.items)
    }

    /// Get a single instance by name.
    pub async fn get_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Instance> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}",
            V1, project, zone, instance_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Start an instance.
    pub async fn start_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/start",
            V1, project, zone, instance_name
        );
        client.post(SERVICE, &path, &serde_json::Value::Null).await
    }

    /// Stop an instance.
    pub async fn stop_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/stop",
            V1, project, zone, instance_name
        );
        client.post(SERVICE, &path, &serde_json::Value::Null).await
    }

    /// Reset (hard reboot) an instance.
    pub async fn reset_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/reset",
            V1, project, zone, instance_name
        );
        client.post(SERVICE, &path, &serde_json::Value::Null).await
    }

    /// Suspend an instance.
    pub async fn suspend_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/suspend",
            V1, project, zone, instance_name
        );
        client.post(SERVICE, &path, &serde_json::Value::Null).await
    }

    /// Resume a suspended instance.
    pub async fn resume_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/resume",
            V1, project, zone, instance_name
        );
        client.post(SERVICE, &path, &serde_json::Value::Null).await
    }

    /// Delete an instance.
    pub async fn delete_instance(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}",
            V1, project, zone, instance_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    /// Get serial port output (console log).
    pub async fn get_serial_port_output(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
        port: u32,
    ) -> GcpResult<String> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/serialPort",
            V1, project, zone, instance_name
        );
        let port_str = port.to_string();
        let query = [("port", port_str.as_str())];
        let resp: serde_json::Value = client.get(SERVICE, &path, &query).await?;
        Ok(resp
            .get("contents")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// Set labels on an instance.
    pub async fn set_instance_labels(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
        labels: HashMap<String, String>,
        label_fingerprint: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/setLabels",
            V1, project, zone, instance_name
        );
        let body = serde_json::json!({
            "labels": labels,
            "labelFingerprint": label_fingerprint,
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Set tags on an instance.
    pub async fn set_instance_tags(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
        tags: Vec<String>,
        fingerprint: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/setTags",
            V1, project, zone, instance_name
        );
        let body = serde_json::json!({
            "items": tags,
            "fingerprint": fingerprint,
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Set metadata on an instance.
    pub async fn set_instance_metadata(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        instance_name: &str,
        items: Vec<MetadataItem>,
        fingerprint: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/instances/{}/setMetadata",
            V1, project, zone, instance_name
        );
        let body = serde_json::json!({
            "items": items,
            "fingerprint": fingerprint,
        });
        client.post(SERVICE, &path, &body).await
    }

    // ── Disks ───────────────────────────────────────────────────────

    /// List persistent disks in a zone.
    pub async fn list_disks(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
    ) -> GcpResult<Vec<Disk>> {
        let path = format!("{}/projects/{}/zones/{}/disks", V1, project, zone);
        let resp: ListResponse<Disk> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Get a disk by name.
    pub async fn get_disk(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        disk_name: &str,
    ) -> GcpResult<Disk> {
        let path = format!(
            "{}/projects/{}/zones/{}/disks/{}",
            V1, project, zone, disk_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a snapshot from a disk.
    pub async fn create_snapshot(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        disk_name: &str,
        snapshot_name: &str,
        description: Option<&str>,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/disks/{}/createSnapshot",
            V1, project, zone, disk_name
        );
        let mut body = serde_json::json!({
            "name": snapshot_name,
        });
        if let Some(desc) = description {
            body["description"] = serde_json::Value::String(desc.to_string());
        }
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a disk.
    pub async fn delete_disk(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
        disk_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/zones/{}/disks/{}",
            V1, project, zone, disk_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    // ── Snapshots ───────────────────────────────────────────────────

    /// List snapshots.
    pub async fn list_snapshots(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Snapshot>> {
        let path = format!("{}/projects/{}/global/snapshots", V1, project);
        let resp: ListResponse<Snapshot> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Delete a snapshot.
    pub async fn delete_snapshot(
        client: &mut GcpClient,
        project: &str,
        snapshot_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/global/snapshots/{}",
            V1, project, snapshot_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    // ── Machine Types ───────────────────────────────────────────────

    /// List machine types in a zone.
    pub async fn list_machine_types(
        client: &mut GcpClient,
        project: &str,
        zone: &str,
    ) -> GcpResult<Vec<MachineType>> {
        let path = format!(
            "{}/projects/{}/zones/{}/machineTypes",
            V1, project, zone
        );
        let resp: ListResponse<MachineType> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    // ── Firewalls ───────────────────────────────────────────────────

    /// List firewall rules.
    pub async fn list_firewalls(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Firewall>> {
        let path = format!("{}/projects/{}/global/firewalls", V1, project);
        let resp: ListResponse<Firewall> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Get a firewall rule.
    pub async fn get_firewall(
        client: &mut GcpClient,
        project: &str,
        firewall_name: &str,
    ) -> GcpResult<Firewall> {
        let path = format!(
            "{}/projects/{}/global/firewalls/{}",
            V1, project, firewall_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a firewall rule.
    pub async fn delete_firewall(
        client: &mut GcpClient,
        project: &str,
        firewall_name: &str,
    ) -> GcpResult<Operation> {
        let path = format!(
            "{}/projects/{}/global/firewalls/{}",
            V1, project, firewall_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    // ── Networks ────────────────────────────────────────────────────

    /// List VPC networks.
    pub async fn list_networks(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Network>> {
        let path = format!("{}/projects/{}/global/networks", V1, project);
        let resp: ListResponse<Network> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Get a VPC network.
    pub async fn get_network(
        client: &mut GcpClient,
        project: &str,
        network_name: &str,
    ) -> GcpResult<Network> {
        let path = format!(
            "{}/projects/{}/global/networks/{}",
            V1, project, network_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    // ── Subnetworks ─────────────────────────────────────────────────

    /// List subnetworks in a region.
    pub async fn list_subnetworks(
        client: &mut GcpClient,
        project: &str,
        region: &str,
    ) -> GcpResult<Vec<Subnetwork>> {
        let path = format!(
            "{}/projects/{}/regions/{}/subnetworks",
            V1, project, region
        );
        let resp: ListResponse<Subnetwork> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    // ── Addresses ───────────────────────────────────────────────────

    /// List addresses (static IPs) in a region.
    pub async fn list_addresses(
        client: &mut GcpClient,
        project: &str,
        region: &str,
    ) -> GcpResult<Vec<Address>> {
        let path = format!(
            "{}/projects/{}/regions/{}/addresses",
            V1, project, region
        );
        let resp: ListResponse<Address> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// List global addresses.
    pub async fn list_global_addresses(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Address>> {
        let path = format!("{}/projects/{}/global/addresses", V1, project);
        let resp: ListResponse<Address> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    // ── Zones ───────────────────────────────────────────────────────

    /// List available zones in the project.
    pub async fn list_zones(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<serde_json::Value>> {
        let path = format!("{}/projects/{}/zones", V1, project);
        let resp: ListResponse<serde_json::Value> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// List available regions in the project.
    pub async fn list_regions(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<serde_json::Value>> {
        let path = format!("{}/projects/{}/regions", V1, project);
        let resp: ListResponse<serde_json::Value> = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }
}
