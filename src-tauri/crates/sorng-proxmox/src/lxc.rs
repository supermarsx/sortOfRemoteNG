//! LXC container lifecycle management via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

/// High-level LXC container operations.
pub struct LxcManager<'a> {
    client: &'a PveClient,
}

impl<'a> LxcManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// List all LXC containers on a node.
    pub async fn list_containers(&self, node: &str) -> ProxmoxResult<Vec<LxcSummary>> {
        let path = format!("/api2/json/nodes/{node}/lxc");
        self.client.get(&path).await
    }

    /// Get current status of an LXC container.
    pub async fn get_status(&self, node: &str, vmid: u64) -> ProxmoxResult<LxcStatusCurrent> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/current");
        self.client.get(&path).await
    }

    /// Get container config.
    pub async fn get_config(&self, node: &str, vmid: u64) -> ProxmoxResult<LxcConfig> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/config");
        self.client.get(&path).await
    }

    /// Create a new LXC container. Returns UPID.
    pub async fn create_container(&self, node: &str, params: &LxcCreateParams) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/lxc");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    /// Delete an LXC container.
    pub async fn delete_container(&self, node: &str, vmid: u64, purge: bool, force: bool) -> ProxmoxResult<Option<String>> {
        let mut path = format!("/api2/json/nodes/{node}/lxc/{vmid}");
        let mut parts = Vec::new();
        if purge { parts.push("purge=1"); }
        if force { parts.push("force=1"); }
        if !parts.is_empty() {
            path.push('?');
            path.push_str(&parts.join("&"));
        }
        self.client.delete(&path).await
    }

    // ── Power operations ────────────────────────────────────────────

    pub async fn start(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/start");
        self.client.post_empty(&path).await
    }

    pub async fn stop(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/stop");
        self.client.post_empty(&path).await
    }

    pub async fn shutdown(&self, node: &str, vmid: u64, force_stop: bool, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/shutdown");
        let mut params: Vec<(&str, String)> = Vec::new();
        if force_stop { params.push(("forceStop", "1".to_string())); }
        if let Some(t) = timeout { params.push(("timeout", t.to_string())); }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if borrowed.is_empty() {
            self.client.post_empty(&path).await
        } else {
            self.client.post_form::<Option<String>>(&path, &borrowed).await
        }
    }

    pub async fn reboot(&self, node: &str, vmid: u64, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/reboot");
        if let Some(t) = timeout {
            let t_str = t.to_string();
            self.client.post_form::<Option<String>>(&path, &[("timeout", t_str.as_str())]).await
        } else {
            self.client.post_empty(&path).await
        }
    }

    pub async fn suspend(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/suspend");
        self.client.post_empty(&path).await
    }

    pub async fn resume(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/status/resume");
        self.client.post_empty(&path).await
    }

    // ── Configuration ───────────────────────────────────────────────

    pub async fn update_config(
        &self,
        node: &str,
        vmid: u64,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/config");
        self.client.put_form(&path, params).await
    }

    pub async fn resize_disk(
        &self,
        node: &str,
        vmid: u64,
        disk: &str,
        size: &str,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/resize");
        self.client.put_form(&path, &[("disk", disk), ("size", size)]).await
    }

    pub async fn move_volume(
        &self,
        node: &str,
        vmid: u64,
        volume: &str,
        storage: &str,
        delete_original: bool,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/move_volume");
        let del = if delete_original { "1" } else { "0" };
        self.client.post_form::<Option<String>>(&path, &[
            ("volume", volume),
            ("storage", storage),
            ("delete", del),
        ]).await
    }

    // ── Clone / Migrate ─────────────────────────────────────────────

    pub async fn clone_container(
        &self,
        node: &str,
        vmid: u64,
        params: &LxcCloneParams,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/clone");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    pub async fn migrate_container(
        &self,
        node: &str,
        vmid: u64,
        params: &LxcMigrateParams,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/migrate");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    /// Convert container to template.
    pub async fn convert_to_template(&self, node: &str, vmid: u64) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/template");
        self.client.post_empty(&path).await?;
        Ok(())
    }
}

/// Flatten a JSON value into form params.
fn json_to_form_params(value: &serde_json::Value) -> Vec<(String, String)> {
    let mut params = Vec::new();
    if let serde_json::Value::Object(map) = value {
        for (key, val) in map {
            match val {
                serde_json::Value::Null => {}
                serde_json::Value::String(s) => { params.push((key.clone(), s.clone())); }
                serde_json::Value::Number(n) => { params.push((key.clone(), n.to_string())); }
                serde_json::Value::Bool(b) => { params.push((key.clone(), if *b { "1".into() } else { "0".into() })); }
                _ => {
                    if let Ok(s) = serde_json::to_string(val) {
                        params.push((key.clone(), s));
                    }
                }
            }
        }
    }
    params
}
