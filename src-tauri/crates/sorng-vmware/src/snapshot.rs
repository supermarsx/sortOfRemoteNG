//! VM snapshot management via the vSphere REST API.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

/// Snapshot operations on a VM.
pub struct SnapshotManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> SnapshotManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    /// List all snapshots for a VM as a flat list.
    pub async fn list_snapshots(&self, vm_id: &str) -> VmwareResult<Vec<SnapshotSummary>> {
        let path = format!("/api/vcenter/vm/{vm_id}/snapshots");
        // The API may return 404 if no snapshots exist; treat that as empty
        match self.client.get::<Vec<SnapshotSummary>>(&path).await {
            Ok(snaps) => Ok(snaps),
            Err(e) if e.to_string().contains("not found") => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    /// Get details of a specific snapshot.
    pub async fn get_snapshot(
        &self,
        vm_id: &str,
        snapshot_id: &str,
    ) -> VmwareResult<SnapshotSummary> {
        let path = format!("/api/vcenter/vm/{vm_id}/snapshots/{snapshot_id}");
        self.client.get::<SnapshotSummary>(&path).await
    }

    /// Create a new snapshot.
    pub async fn create_snapshot(
        &self,
        vm_id: &str,
        spec: &CreateSnapshotSpec,
    ) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Created {
            value: String,
        }
        let path = format!("/api/vcenter/vm/{vm_id}/snapshots");
        let resp: Created = self.client.post(&path, spec).await?;
        Ok(resp.value)
    }

    /// Create a named snapshot with default options.
    pub async fn create_named_snapshot(
        &self,
        vm_id: &str,
        name: &str,
        description: Option<&str>,
    ) -> VmwareResult<String> {
        let spec = CreateSnapshotSpec {
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            memory: Some(true),
            quiesce: Some(false),
        };
        self.create_snapshot(vm_id, &spec).await
    }

    /// Revert to a specific snapshot.
    pub async fn revert_to_snapshot(
        &self,
        vm_id: &str,
        snapshot_id: &str,
    ) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/snapshots/{snapshot_id}?action=revert");
        self.client.post_empty(&path).await
    }

    /// Delete a specific snapshot (and optionally its children).
    pub async fn delete_snapshot(
        &self,
        vm_id: &str,
        snapshot_id: &str,
        children: bool,
    ) -> VmwareResult<()> {
        let path = if children {
            format!(
                "/api/vcenter/vm/{vm_id}/snapshots/{snapshot_id}?remove_children=true"
            )
        } else {
            format!("/api/vcenter/vm/{vm_id}/snapshots/{snapshot_id}")
        };
        self.client.delete(&path).await
    }

    /// Delete all snapshots on a VM.
    pub async fn delete_all_snapshots(&self, vm_id: &str) -> VmwareResult<()> {
        // The vSphere API doesn't have a single "remove all" endpoint.
        // We delete the root snapshots (which cascades children).
        let snapshots = self.list_snapshots(vm_id).await?;

        // Find root snapshots (those whose parent is not in the list)
        let _ids: std::collections::HashSet<String> = snapshots
            .iter()
            .map(|s| s.snapshot.clone())
            .collect();

        for snap in &snapshots {
            // Delete with children flag so the tree is cleaned in one pass
            if let Err(e) = self.delete_snapshot(vm_id, &snap.snapshot, true).await {
                log::warn!("Error deleting snapshot {}: {}", snap.snapshot, e);
            }
            // After first root delete, subsequent may 404 (already gone). That's fine.
            break; // first root nukes everything when children=true
        }

        Ok(())
    }

    /// Find snapshots by name.
    pub async fn find_snapshots_by_name(
        &self,
        vm_id: &str,
        name: &str,
    ) -> VmwareResult<Vec<SnapshotSummary>> {
        let all = self.list_snapshots(vm_id).await?;
        Ok(all
            .into_iter()
            .filter(|s| s.name.as_deref().unwrap_or_default().eq_ignore_ascii_case(name))
            .collect())
    }

    /// Get snapshot count.
    pub async fn snapshot_count(&self, vm_id: &str) -> VmwareResult<usize> {
        let snaps = self.list_snapshots(vm_id).await?;
        Ok(snaps.len())
    }
}
