//! Cluster management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct ClusterManager<'a> {
    client: &'a PveClient,
}

impl<'a> ClusterManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// Get cluster status (nodes, quorum).
    pub async fn get_status(&self) -> ProxmoxResult<Vec<ClusterStatus>> {
        self.client.get("/api2/json/cluster/status").await
    }

    /// List all cluster resources with optional type filter.
    pub async fn list_resources(&self, resource_type: Option<&str>) -> ProxmoxResult<Vec<ClusterResource>> {
        if let Some(t) = resource_type {
            self.client.get_with_params("/api2/json/cluster/resources", &[("type", t)]).await
        } else {
            self.client.get("/api2/json/cluster/resources").await
        }
    }

    /// Get cluster options.
    pub async fn get_options(&self) -> ProxmoxResult<ClusterOptions> {
        self.client.get("/api2/json/cluster/options").await
    }

    /// Update cluster options.
    pub async fn update_options(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        self.client.put_form("/api2/json/cluster/options", params).await
    }

    /// Get cluster join information.
    pub async fn get_join_info(&self) -> ProxmoxResult<ClusterJoinInfo> {
        self.client.get("/api2/json/cluster/config/join").await
    }

    /// Join another node to the cluster.
    pub async fn join_cluster(
        &self,
        hostname: &str,
        password: &str,
        fingerprint: &str,
    ) -> ProxmoxResult<Option<String>> {
        self.client.post_form::<Option<String>>("/api2/json/cluster/config/join", &[
            ("hostname", hostname),
            ("password", password),
            ("fingerprint", fingerprint),
        ]).await
    }

    /// Get next free VMID.
    pub async fn next_id(&self) -> ProxmoxResult<u64> {
        self.client.get::<u64>("/api2/json/cluster/nextid").await
    }

    /// Get PVE version info.
    pub async fn get_version(&self) -> ProxmoxResult<PveVersion> {
        self.client.get("/api2/json/version").await
    }

    /// List ACLs.
    pub async fn list_acls(&self) -> ProxmoxResult<Vec<AclEntry>> {
        self.client.get("/api2/json/access/acl").await
    }

    /// List users.
    pub async fn list_users(&self) -> ProxmoxResult<Vec<PveUser>> {
        self.client.get("/api2/json/access/users").await
    }

    /// List roles.
    pub async fn list_roles(&self) -> ProxmoxResult<Vec<PveRole>> {
        self.client.get("/api2/json/access/roles").await
    }

    /// List groups.
    pub async fn list_groups(&self) -> ProxmoxResult<Vec<PveGroup>> {
        self.client.get("/api2/json/access/groups").await
    }

    /// List replication jobs.
    pub async fn list_replication(&self) -> ProxmoxResult<Vec<ReplicationJob>> {
        self.client.get("/api2/json/cluster/replication").await
    }
}
