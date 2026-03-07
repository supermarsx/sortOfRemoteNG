//! QEMU VM lifecycle management via the Proxmox VE REST API.
//!
//! Covers listing, CRUD, power operations, config, clone, migrate, resize,
//! guest agent, feature checks, and more.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

/// High-level QEMU VM operations.
pub struct QemuManager<'a> {
    client: &'a PveClient,
}

impl<'a> QemuManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    // ── List / Get ──────────────────────────────────────────────────

    /// List all QEMU VMs on a node.
    pub async fn list_vms(&self, node: &str) -> ProxmoxResult<Vec<QemuVmSummary>> {
        let path = format!("/api2/json/nodes/{node}/qemu");
        self.client.get(&path).await
    }

    /// Get current status of a QEMU VM.
    pub async fn get_status(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuStatusCurrent> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/current");
        self.client.get(&path).await
    }

    /// Get full VM config.
    pub async fn get_config(&self, node: &str, vmid: u64) -> ProxmoxResult<QemuConfig> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/config");
        self.client.get(&path).await
    }

    /// Get pending config changes (not yet applied).
    pub async fn get_pending_config(&self, node: &str, vmid: u64) -> ProxmoxResult<Vec<serde_json::Value>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/pending");
        self.client.get(&path).await
    }

    // ── Create / Delete ─────────────────────────────────────────────

    /// Create a new QEMU VM.  Returns UPID.
    pub async fn create_vm(&self, node: &str, params: &QemuCreateParams) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/qemu");
        // Serialize to flat form params
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = Self::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    // ── Aliases for service layer ───────────────────────────────────

    pub async fn start_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        self.start(node, vmid).await
    }
    pub async fn stop_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        self.stop(node, vmid).await
    }
    pub async fn shutdown_vm(&self, node: &str, vmid: u64, force_stop: bool, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        self.shutdown(node, vmid, force_stop, timeout).await
    }
    pub async fn reboot_vm(&self, node: &str, vmid: u64, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        self.reboot(node, vmid, timeout).await
    }
    pub async fn suspend_vm(&self, node: &str, vmid: u64, to_disk: bool) -> ProxmoxResult<Option<String>> {
        self.suspend(node, vmid, to_disk).await
    }
    pub async fn resume_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        self.resume(node, vmid).await
    }
    pub async fn reset_vm(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        self.reset(node, vmid).await
    }

    /// Delete a QEMU VM.
    pub async fn delete_vm(&self, node: &str, vmid: u64, purge: bool, destroy_unreferenced: bool) -> ProxmoxResult<Option<String>> {
        let mut path = format!("/api2/json/nodes/{node}/qemu/{vmid}");
        let mut query_parts = Vec::new();
        if purge { query_parts.push("purge=1"); }
        if destroy_unreferenced { query_parts.push("destroy-unreferenced-disks=1"); }
        if !query_parts.is_empty() {
            path.push('?');
            path.push_str(&query_parts.join("&"));
        }
        self.client.delete(&path).await
    }

    // ── Power operations ────────────────────────────────────────────

    /// Start VM.
    pub async fn start(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/start");
        self.client.post_empty(&path).await
    }

    /// Stop VM (hard).
    pub async fn stop(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/stop");
        self.client.post_empty(&path).await
    }

    /// Shutdown VM (ACPI, graceful).
    pub async fn shutdown(&self, node: &str, vmid: u64, force_stop: bool, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/shutdown");
        let mut params: Vec<(&str, String)> = Vec::new();
        if force_stop { params.push(("forceStop", "1".to_string())); }
        if let Some(t) = timeout { params.push(("timeout", t.to_string())); }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        if borrowed.is_empty() {
            self.client.post_empty(&path).await
        } else {
            self.client.post_form::<Option<String>>(&path, &borrowed).await
        }
    }

    /// Reboot VM (ACPI).
    pub async fn reboot(&self, node: &str, vmid: u64, timeout: Option<u64>) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/reboot");
        if let Some(t) = timeout {
            let t_str = t.to_string();
            self.client.post_form::<Option<String>>(&path, &[("timeout", t_str.as_str())]).await
        } else {
            self.client.post_empty(&path).await
        }
    }

    /// Suspend / pause VM.
    pub async fn suspend(&self, node: &str, vmid: u64, to_disk: bool) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/suspend");
        if to_disk {
            self.client.post_form::<Option<String>>(&path, &[("todisk", "1")]).await
        } else {
            self.client.post_empty(&path).await
        }
    }

    /// Resume a paused VM.
    pub async fn resume(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/resume");
        self.client.post_empty(&path).await
    }

    /// Reset VM (hard).
    pub async fn reset(&self, node: &str, vmid: u64) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/status/reset");
        self.client.post_empty(&path).await
    }

    // ── Configuration ───────────────────────────────────────────────

    /// Update VM config (set options).
    pub async fn update_config(
        &self,
        node: &str,
        vmid: u64,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/config");
        self.client.put_form(&path, params).await
    }

    /// Resize a VM disk.
    pub async fn resize_disk(
        &self,
        node: &str,
        vmid: u64,
        disk: &str,
        size: &str,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/resize");
        self.client.put_form(&path, &[("disk", disk), ("size", size)]).await
    }

    /// Move a disk to a different storage.
    pub async fn move_disk(
        &self,
        node: &str,
        vmid: u64,
        disk: &str,
        storage: &str,
        delete_original: bool,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/move_disk");
        let del = if delete_original { "1" } else { "0" };
        self.client.post_form::<Option<String>>(&path, &[
            ("disk", disk),
            ("storage", storage),
            ("delete", del),
        ]).await
    }

    // ── Clone / Migrate ─────────────────────────────────────────────

    /// Clone a VM. Returns UPID.
    pub async fn clone_vm(
        &self,
        node: &str,
        vmid: u64,
        params: &QemuCloneParams,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/clone");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = Self::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    /// Migrate a VM. Returns UPID.
    pub async fn migrate_vm(
        &self,
        node: &str,
        vmid: u64,
        params: &QemuMigrateParams,
    ) -> ProxmoxResult<String> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/migrate");
        let json = serde_json::to_value(params)
            .map_err(|e| crate::error::ProxmoxError::parse(format!("Serialization error: {e}")))?;
        let form_params = Self::json_to_form_params(&json);
        let borrowed: Vec<(&str, &str)> = form_params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.client.post_form::<String>(&path, &borrowed).await
    }

    /// Resize a VM disk (params-based overload).
    pub async fn resize_disk_params(
        &self,
        node: &str,
        vmid: u64,
        params: &DiskResizeParams,
    ) -> ProxmoxResult<()> {
        self.resize_disk(node, vmid, &params.disk, &params.size).await
    }

    /// Convert VM to template.
    pub async fn convert_to_template(&self, node: &str, vmid: u64) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/template");
        self.client.post_empty(&path).await?;
        Ok(())
    }

    // ── Guest Agent ─────────────────────────────────────────────────

    /// Execute a guest-agent command.
    pub async fn agent_exec(
        &self,
        node: &str,
        vmid: u64,
        command: &str,
    ) -> ProxmoxResult<serde_json::Value> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/agent/{command}");
        self.client.get(&path).await
    }

    /// Get guest agent network interfaces.
    pub async fn agent_network_interfaces(
        &self,
        node: &str,
        vmid: u64,
    ) -> ProxmoxResult<QemuAgentInfo> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces");
        self.client.get(&path).await
    }

    /// Get guest agent OS information.
    pub async fn agent_os_info(
        &self,
        node: &str,
        vmid: u64,
    ) -> ProxmoxResult<QemuAgentInfo> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/agent/get-osinfo");
        self.client.get(&path).await
    }

    /// Get guest agent filesystem info.
    pub async fn agent_fsinfo(
        &self,
        node: &str,
        vmid: u64,
    ) -> ProxmoxResult<serde_json::Value> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/agent/get-fsinfo");
        self.client.get(&path).await
    }

    // ── Features ────────────────────────────────────────────────────

    /// Check feature availability (clone, snapshot, etc.)
    pub async fn check_feature(
        &self,
        node: &str,
        vmid: u64,
        feature: &str,
    ) -> ProxmoxResult<QemuFeatureCheck> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/feature");
        self.client.get_with_params(&path, &[("feature", feature)]).await
    }

    /// Get next free VMID.
    pub async fn get_next_vmid(&self) -> ProxmoxResult<u64> {
        self.client.get::<u64>("/api2/json/cluster/nextid").await
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Flatten a JSON value into form params (key=value pairs).
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
}
