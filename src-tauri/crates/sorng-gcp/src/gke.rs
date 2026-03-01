//! Google Kubernetes Engine (GKE) client.
//!
//! Covers clusters, node pools, and basic workload info.
//!
//! API base: `https://container.googleapis.com/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "container";
const V1: &str = "/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// GKE cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "currentMasterVersion")]
    pub current_master_version: String,
    #[serde(default, rename = "currentNodeVersion")]
    pub current_node_version: Option<String>,
    #[serde(default, rename = "currentNodeCount")]
    pub current_node_count: u32,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default, rename = "clusterIpv4Cidr")]
    pub cluster_ipv4_cidr: Option<String>,
    #[serde(default, rename = "servicesIpv4Cidr")]
    pub services_ipv4_cidr: Option<String>,
    #[serde(default, rename = "nodePools")]
    pub node_pools: Vec<NodePool>,
    #[serde(default, rename = "resourceLabels")]
    pub resource_labels: HashMap<String, String>,
    #[serde(default, rename = "networkConfig")]
    pub network_config: Option<serde_json::Value>,
    #[serde(default, rename = "masterAuth")]
    pub master_auth: Option<MasterAuth>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub subnetwork: Option<String>,
    #[serde(default, rename = "loggingService")]
    pub logging_service: Option<String>,
    #[serde(default, rename = "monitoringService")]
    pub monitoring_service: Option<String>,
    #[serde(default, rename = "releaseChannel")]
    pub release_channel: Option<serde_json::Value>,
    #[serde(default)]
    pub autopilot: Option<Autopilot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Autopilot {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterAuth {
    #[serde(default, rename = "clusterCaCertificate")]
    pub cluster_ca_certificate: Option<String>,
    #[serde(default, rename = "clientCertificate")]
    pub client_certificate: Option<String>,
    #[serde(default, rename = "clientKey")]
    pub client_key: Option<String>,
}

/// GKE node pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePool {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub config: Option<NodeConfig>,
    #[serde(default, rename = "initialNodeCount")]
    pub initial_node_count: u32,
    #[serde(default)]
    pub autoscaling: Option<Autoscaling>,
    #[serde(default)]
    pub management: Option<NodeManagement>,
    #[serde(default)]
    pub locations: Vec<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default, rename = "instanceGroupUrls")]
    pub instance_group_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    #[serde(default, rename = "machineType")]
    pub machine_type: String,
    #[serde(default, rename = "diskSizeGb")]
    pub disk_size_gb: u32,
    #[serde(default, rename = "diskType")]
    pub disk_type: Option<String>,
    #[serde(default, rename = "imageType")]
    pub image_type: Option<String>,
    #[serde(default, rename = "oauthScopes")]
    pub oauth_scopes: Vec<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub preemptible: bool,
    #[serde(default)]
    pub spot: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Autoscaling {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, rename = "minNodeCount")]
    pub min_node_count: u32,
    #[serde(default, rename = "maxNodeCount")]
    pub max_node_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeManagement {
    #[serde(default, rename = "autoUpgrade")]
    pub auto_upgrade: bool,
    #[serde(default, rename = "autoRepair")]
    pub auto_repair: bool,
}

/// GKE operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GkeOperation {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "operationType")]
    pub operation_type: String,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "targetLink")]
    pub target_link: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default, rename = "statusMessage")]
    pub status_message: Option<String>,
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, rename = "endTime")]
    pub end_time: Option<String>,
}

// ── List wrapper ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ClusterList {
    #[serde(default)]
    clusters: Vec<Cluster>,
}

#[derive(Debug, Deserialize)]
struct NodePoolList {
    #[serde(default, rename = "nodePools")]
    node_pools: Vec<NodePool>,
}

// ── GKE Client ──────────────────────────────────────────────────────────

pub struct GkeClient;

impl GkeClient {
    /// List GKE clusters in a location (use "-" for all locations).
    pub async fn list_clusters(
        client: &mut GcpClient,
        project: &str,
        location: &str,
    ) -> GcpResult<Vec<Cluster>> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters",
            V1, project, location
        );
        let resp: ClusterList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.clusters)
    }

    /// Get a specific cluster.
    pub async fn get_cluster(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
    ) -> GcpResult<Cluster> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}",
            V1, project, location, cluster_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a cluster.
    pub async fn delete_cluster(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
    ) -> GcpResult<GkeOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}",
            V1, project, location, cluster_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse: {}", e)))
    }

    /// List node pools in a cluster.
    pub async fn list_node_pools(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
    ) -> GcpResult<Vec<NodePool>> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}/nodePools",
            V1, project, location, cluster_name
        );
        let resp: NodePoolList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.node_pools)
    }

    /// Get a node pool.
    pub async fn get_node_pool(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
        pool_name: &str,
    ) -> GcpResult<NodePool> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}/nodePools/{}",
            V1, project, location, cluster_name, pool_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a node pool.
    pub async fn delete_node_pool(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
        pool_name: &str,
    ) -> GcpResult<GkeOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}/nodePools/{}",
            V1, project, location, cluster_name, pool_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse: {}", e)))
    }

    /// Set node pool autoscaling.
    pub async fn set_node_pool_autoscaling(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
        pool_name: &str,
        enabled: bool,
        min_count: u32,
        max_count: u32,
    ) -> GcpResult<GkeOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}/nodePools/{}:setAutoscaling",
            V1, project, location, cluster_name, pool_name
        );
        let body = serde_json::json!({
            "autoscaling": {
                "enabled": enabled,
                "minNodeCount": min_count,
                "maxNodeCount": max_count,
            }
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Set the node pool size (manual scaling).
    pub async fn set_node_pool_size(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        cluster_name: &str,
        pool_name: &str,
        node_count: u32,
    ) -> GcpResult<GkeOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/clusters/{}/nodePools/{}:setSize",
            V1, project, location, cluster_name, pool_name
        );
        let body = serde_json::json!({ "nodeCount": node_count });
        client.post(SERVICE, &path, &body).await
    }

    /// Get GKE server config for a location (available versions, etc.).
    pub async fn get_server_config(
        client: &mut GcpClient,
        project: &str,
        location: &str,
    ) -> GcpResult<serde_json::Value> {
        let path = format!(
            "{}/projects/{}/locations/{}/serverConfig",
            V1, project, location
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// List operations.
    pub async fn list_operations(
        client: &mut GcpClient,
        project: &str,
        location: &str,
    ) -> GcpResult<Vec<GkeOperation>> {
        let path = format!(
            "{}/projects/{}/locations/{}/operations",
            V1, project, location
        );
        #[derive(Deserialize)]
        struct OpList {
            #[serde(default)]
            operations: Vec<GkeOperation>,
        }
        let resp: OpList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.operations)
    }
}
