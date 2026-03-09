//! Firewall management via the Proxmox VE REST API.
//!
//! Supports cluster-level, node-level, and VM/CT-level firewall rules,
//! aliases, IP sets, security groups, and options.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct FirewallManager<'a> {
    client: &'a PveClient,
}

impl<'a> FirewallManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    // ── Cluster-level firewall ────────────────────────────────────

    pub async fn get_cluster_options(&self) -> ProxmoxResult<FirewallOptions> {
        self.client.get("/api2/json/cluster/firewall/options").await
    }

    pub async fn update_cluster_options(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        self.client
            .put_form("/api2/json/cluster/firewall/options", params)
            .await
    }

    pub async fn list_cluster_rules(&self) -> ProxmoxResult<Vec<FirewallRule>> {
        self.client.get("/api2/json/cluster/firewall/rules").await
    }

    pub async fn create_cluster_rule(&self, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/firewall/rules", params)
            .await?;
        Ok(())
    }

    pub async fn delete_cluster_rule(&self, pos: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/firewall/rules/{pos}");
        self.client.delete(&path).await
    }

    pub async fn list_cluster_aliases(&self) -> ProxmoxResult<Vec<FirewallAlias>> {
        self.client.get("/api2/json/cluster/firewall/aliases").await
    }

    pub async fn create_cluster_alias(
        &self,
        name: &str,
        cidr: &str,
        comment: Option<&str>,
    ) -> ProxmoxResult<()> {
        let mut params = vec![("name", name), ("cidr", cidr)];
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/firewall/aliases", &params)
            .await?;
        Ok(())
    }

    pub async fn delete_cluster_alias(&self, name: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/firewall/aliases/{name}");
        self.client.delete(&path).await
    }

    pub async fn list_cluster_ipsets(&self) -> ProxmoxResult<Vec<FirewallIpSet>> {
        self.client.get("/api2/json/cluster/firewall/ipset").await
    }

    pub async fn create_cluster_ipset(
        &self,
        name: &str,
        comment: Option<&str>,
    ) -> ProxmoxResult<()> {
        let mut params = vec![("name", name)];
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/firewall/ipset", &params)
            .await?;
        Ok(())
    }

    pub async fn delete_cluster_ipset(&self, name: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/firewall/ipset/{name}");
        self.client.delete(&path).await
    }

    pub async fn list_ipset_entries(&self, name: &str) -> ProxmoxResult<Vec<FirewallIpSetEntry>> {
        let path = format!("/api2/json/cluster/firewall/ipset/{name}");
        self.client.get(&path).await
    }

    pub async fn add_ipset_entry(
        &self,
        ipset: &str,
        cidr: &str,
        comment: Option<&str>,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/cluster/firewall/ipset/{ipset}");
        let mut params = vec![("cidr", cidr)];
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        let _: serde_json::Value = self.client.post_form(&path, &params).await?;
        Ok(())
    }

    pub async fn remove_ipset_entry(
        &self,
        ipset: &str,
        cidr: &str,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/firewall/ipset/{ipset}/{cidr}");
        self.client.delete(&path).await
    }

    pub async fn list_security_groups(&self) -> ProxmoxResult<Vec<FirewallSecurityGroup>> {
        self.client.get("/api2/json/cluster/firewall/groups").await
    }

    pub async fn create_security_group(
        &self,
        group: &str,
        comment: Option<&str>,
    ) -> ProxmoxResult<()> {
        let mut params = vec![("group", group)];
        if let Some(c) = comment {
            params.push(("comment", c));
        }
        let _: serde_json::Value = self
            .client
            .post_form("/api2/json/cluster/firewall/groups", &params)
            .await?;
        Ok(())
    }

    pub async fn delete_security_group(&self, group: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/cluster/firewall/groups/{group}");
        self.client.delete(&path).await
    }

    pub async fn list_group_rules(&self, group: &str) -> ProxmoxResult<Vec<FirewallRule>> {
        let path = format!("/api2/json/cluster/firewall/groups/{group}");
        self.client.get(&path).await
    }

    // ── VM/CT level firewall ─────────────────────────────────────

    /// List firewall rules for a VM or CT.
    /// `guest_type` is "qemu" or "lxc".
    pub async fn list_guest_rules(
        &self,
        node: &str,
        guest_type: &str,
        vmid: u64,
    ) -> ProxmoxResult<Vec<FirewallRule>> {
        let path = format!("/api2/json/nodes/{node}/{guest_type}/{vmid}/firewall/rules");
        self.client.get(&path).await
    }

    pub async fn create_guest_rule(
        &self,
        node: &str,
        guest_type: &str,
        vmid: u64,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/{guest_type}/{vmid}/firewall/rules");
        let _: serde_json::Value = self.client.post_form(&path, params).await?;
        Ok(())
    }

    pub async fn delete_guest_rule(
        &self,
        node: &str,
        guest_type: &str,
        vmid: u64,
        pos: u64,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/{guest_type}/{vmid}/firewall/rules/{pos}");
        self.client.delete(&path).await
    }

    pub async fn get_guest_firewall_options(
        &self,
        node: &str,
        guest_type: &str,
        vmid: u64,
    ) -> ProxmoxResult<FirewallOptions> {
        let path = format!("/api2/json/nodes/{node}/{guest_type}/{vmid}/firewall/options");
        self.client.get(&path).await
    }

    pub async fn update_guest_firewall_options(
        &self,
        node: &str,
        guest_type: &str,
        vmid: u64,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/{guest_type}/{vmid}/firewall/options");
        self.client.put_form(&path, params).await
    }
}
