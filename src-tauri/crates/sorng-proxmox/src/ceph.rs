//! Ceph storage management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct CephManager<'a> {
    client: &'a PveClient,
}

impl<'a> CephManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// Get Ceph cluster status.
    pub async fn get_status(&self, node: &str) -> ProxmoxResult<CephStatus> {
        let path = format!("/api2/json/nodes/{node}/ceph/status");
        self.client.get(&path).await
    }

    /// List Ceph monitors.
    pub async fn list_monitors(&self, node: &str) -> ProxmoxResult<Vec<CephMonitor>> {
        let path = format!("/api2/json/nodes/{node}/ceph/mon");
        self.client.get(&path).await
    }

    /// Create a Ceph monitor.
    pub async fn create_monitor(&self, node: &str, mon_id: Option<&str>) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/ceph/mon");
        if let Some(id) = mon_id {
            self.client.post_form::<Option<String>>(&path, &[("id", id)]).await
        } else {
            self.client.post_empty(&path).await
        }
    }

    /// Destroy a Ceph monitor.
    pub async fn destroy_monitor(&self, node: &str, monid: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/ceph/mon/{monid}");
        self.client.delete(&path).await
    }

    /// List Ceph OSDs.
    pub async fn list_osds(&self, node: &str) -> ProxmoxResult<serde_json::Value> {
        let path = format!("/api2/json/nodes/{node}/ceph/osd");
        self.client.get(&path).await
    }

    /// Create a Ceph OSD.
    pub async fn create_osd(&self, node: &str, dev: &str, params: &[(&str, &str)]) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/ceph/osd");
        let mut all_params = vec![("dev", dev)];
        all_params.extend_from_slice(params);
        self.client.post_form::<Option<String>>(&path, &all_params).await
    }

    /// Destroy (remove) a Ceph OSD.
    pub async fn destroy_osd(&self, node: &str, osdid: u64, cleanup: bool) -> ProxmoxResult<Option<String>> {
        let path = if cleanup {
            format!("/api2/json/nodes/{node}/ceph/osd/{osdid}?cleanup=1")
        } else {
            format!("/api2/json/nodes/{node}/ceph/osd/{osdid}")
        };
        self.client.delete(&path).await
    }

    /// Set OSD in/out.
    pub async fn set_osd_in(&self, node: &str, osdid: u64) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/ceph/osd/{osdid}/in");
        self.client.post_empty(&path).await?;
        Ok(())
    }

    pub async fn set_osd_out(&self, node: &str, osdid: u64) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/ceph/osd/{osdid}/out");
        self.client.post_empty(&path).await?;
        Ok(())
    }

    /// List Ceph pools.
    pub async fn list_pools(&self, node: &str) -> ProxmoxResult<Vec<CephPool>> {
        let path = format!("/api2/json/nodes/{node}/ceph/pool");
        self.client.get(&path).await
    }

    /// Create a Ceph pool.
    pub async fn create_pool(&self, node: &str, params: &CreateCephPoolParams) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/ceph/pool");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = crate::lxc::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let _: serde_json::Value = self.client.post_form(&path, &borrowed).await?;
        Ok(())
    }

    /// Destroy a Ceph pool.
    pub async fn destroy_pool(&self, node: &str, name: &str) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/ceph/pool/{name}");
        self.client.delete(&path).await
    }

    /// Get Ceph filesystem info (CephFS).
    pub async fn list_fs(&self, node: &str) -> ProxmoxResult<Vec<serde_json::Value>> {
        let path = format!("/api2/json/nodes/{node}/ceph/fs");
        self.client.get(&path).await
    }

    /// Get Ceph config.
    pub async fn get_config(&self, node: &str) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/ceph/config");
        self.client.get(&path).await
    }

    /// Get Ceph CRUSH rules.
    pub async fn list_crush_rules(&self, node: &str) -> ProxmoxResult<Vec<serde_json::Value>> {
        let path = format!("/api2/json/nodes/{node}/ceph/rules");
        self.client.get(&path).await
    }
}
