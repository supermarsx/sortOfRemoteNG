//! Snapshot management for QEMU VMs and LXC containers.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct SnapshotManager<'a> {
    client: &'a PveClient,
}

impl<'a> SnapshotManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    // ── QEMU Snapshots ──────────────────────────────────────────────

    pub async fn list_qemu_snapshots(&self, node: &str, vmid: u64) -> ProxmoxResult<Vec<SnapshotSummary>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot");
        self.client.get(&path).await
    }

    pub async fn create_qemu_snapshot(
        &self,
        node: &str,
        vmid: u64,
        params: &CreateSnapshotParams,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot");
        let mut form: Vec<(&str, &str)> = vec![("snapname", &params.snapname)];
        if let Some(ref d) = params.description { form.push(("description", d)); }
        let vmstate_str;
        if let Some(v) = params.vmstate {
            vmstate_str = v.to_string();
            form.push(("vmstate", &vmstate_str));
        }
        self.client.post_form::<Option<String>>(&path, &form).await
    }

    pub async fn rollback_qemu_snapshot(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback");
        self.client.post_empty(&path).await
    }

    pub async fn delete_qemu_snapshot(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
        force: bool,
    ) -> ProxmoxResult<Option<String>> {
        let path = if force {
            format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}?force=1")
        } else {
            format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}")
        };
        self.client.delete(&path).await
    }

    pub async fn get_qemu_snapshot_config(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
    ) -> ProxmoxResult<serde_json::Value> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config");
        self.client.get(&path).await
    }

    pub async fn update_qemu_snapshot_config(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
        description: &str,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config");
        self.client.put_form(&path, &[("description", description)]).await
    }

    // ── LXC Snapshots ───────────────────────────────────────────────

    pub async fn list_lxc_snapshots(&self, node: &str, vmid: u64) -> ProxmoxResult<Vec<SnapshotSummary>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot");
        self.client.get(&path).await
    }

    pub async fn create_lxc_snapshot(
        &self,
        node: &str,
        vmid: u64,
        params: &CreateSnapshotParams,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot");
        let mut form: Vec<(&str, &str)> = vec![("snapname", &params.snapname)];
        if let Some(ref d) = params.description { form.push(("description", d)); }
        self.client.post_form::<Option<String>>(&path, &form).await
    }

    pub async fn rollback_lxc_snapshot(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
    ) -> ProxmoxResult<Option<String>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback");
        self.client.post_empty(&path).await
    }

    pub async fn delete_lxc_snapshot(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
        force: bool,
    ) -> ProxmoxResult<Option<String>> {
        let path = if force {
            format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}?force=1")
        } else {
            format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}")
        };
        self.client.delete(&path).await
    }

    pub async fn get_lxc_snapshot_config(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
    ) -> ProxmoxResult<serde_json::Value> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config");
        self.client.get(&path).await
    }

    pub async fn update_lxc_snapshot_config(
        &self,
        node: &str,
        vmid: u64,
        snapname: &str,
        description: &str,
    ) -> ProxmoxResult<()> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config");
        self.client.put_form(&path, &[("description", description)]).await
    }
}
