//! Node management via the Proxmox VE REST API.
//!
//! Covers node listing, status, services, DNS, time, syslog, APT updates.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

/// High-level node operations.
pub struct NodeManager<'a> {
    client: &'a PveClient,
}

impl<'a> NodeManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    /// List all nodes in the cluster.
    pub async fn list_nodes(&self) -> ProxmoxResult<Vec<NodeSummary>> {
        self.client.get("/api2/json/nodes").await
    }

    /// Get detailed status for a single node.
    pub async fn get_node_status(&self, node: &str) -> ProxmoxResult<NodeStatus> {
        let path = format!("/api2/json/nodes/{node}/status");
        self.client.get(&path).await
    }

    /// List services on a node.
    pub async fn list_services(&self, node: &str) -> ProxmoxResult<Vec<NodeService>> {
        let path = format!("/api2/json/nodes/{node}/services");
        self.client.get(&path).await
    }

    /// Start a service on a node.
    pub async fn start_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/services/{service}/start");
        self.client.post_empty(&path).await
    }

    /// Stop a service on a node.
    pub async fn stop_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/services/{service}/stop");
        self.client.post_empty(&path).await
    }

    /// Restart a service on a node.
    pub async fn restart_service(
        &self,
        node: &str,
        service: &str,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/services/{service}/restart");
        self.client.post_empty(&path).await
    }

    /// Reload a service on a node.
    pub async fn reload_service(&self, node: &str, service: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/services/{service}/reload");
        self.client.post_empty(&path).await
    }

    /// Get DNS configuration.
    pub async fn get_dns(&self, node: &str) -> ProxmoxResult<NodeDns> {
        let path = format!("/api2/json/nodes/{node}/dns");
        self.client.get(&path).await
    }

    /// Update DNS configuration.
    pub async fn update_dns(&self, node: &str, search: &str, dns1: &str) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/dns");
        self.client
            .put_form(&path, &[("search", search), ("dns1", dns1)])
            .await
    }

    /// Get time/timezone info.
    pub async fn get_time(&self, node: &str) -> ProxmoxResult<NodeTime> {
        let path = format!("/api2/json/nodes/{node}/time");
        self.client.get(&path).await
    }

    /// Set timezone.
    pub async fn set_timezone(&self, node: &str, timezone: &str) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/time");
        self.client.put_form(&path, &[("timezone", timezone)]).await
    }

    /// Get syslog entries.
    pub async fn get_syslog(
        &self,
        node: &str,
        start: Option<u64>,
        limit: Option<u64>,
        since: Option<&str>,
        until: Option<&str>,
        service: Option<&str>,
    ) -> ProxmoxResult<Vec<SyslogEntry>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(s) = start {
            params.push(("start", s.to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        if let Some(s) = since {
            params.push(("since", s.to_string()));
        }
        if let Some(u) = until {
            params.push(("until", u.to_string()));
        }
        if let Some(svc) = service {
            params.push(("service", svc.to_string()));
        }

        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let path = format!("/api2/json/nodes/{node}/syslog");
        self.client.get_with_params(&path, &borrowed).await
    }

    /// List available APT updates.
    pub async fn list_apt_updates(&self, node: &str) -> ProxmoxResult<Vec<AptUpdate>> {
        let path = format!("/api2/json/nodes/{node}/apt/update");
        self.client.get(&path).await
    }

    /// Refresh APT package lists.
    pub async fn refresh_apt(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/apt/update");
        self.client.post_empty(&path).await
    }

    /// Reboot a node.
    pub async fn reboot_node(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/status");
        self.client.post_form(&path, &[("command", "reboot")]).await
    }

    /// Shutdown a node.
    pub async fn shutdown_node(&self, node: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/status");
        self.client
            .post_form(&path, &[("command", "shutdown")])
            .await
    }
}
