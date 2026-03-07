//! Snapshot management — create, delete, revert, list, tree navigation.

use crate::error::VmwResult;
use crate::types::*;
use crate::vmrun::VmRun;

/// List all snapshots for a VM (flat list).
pub async fn list_snapshots(vmrun: &VmRun, vmx_path: &str) -> VmwResult<Vec<SnapshotInfo>> {
    let raw = vmrun.list_snapshots(vmx_path).await?;
    let mut snapshots = Vec::new();
    for (i, name) in raw.iter().enumerate() {
        snapshots.push(SnapshotInfo {
            name: name.clone(),
            display_name: Some(name.clone()),
            description: None,
            created_at: None,
            parent: None,
            children: vec![],
            is_current: false,
            has_memory: Some(false),
            size: None,
        });
    }

    // Try to infer parent/child via vmx snapshot metadata
    let vmx_data = crate::vmx::parse_vmx(vmx_path).ok();
    if let Some(ref vmx) = vmx_data {
        // snapshot.numSnapshots, snapshot0.uid, snapshot0.displayName, snapshot0.filename,
        // snapshot.current, snapshot0.parent, etc.
        let num: usize = vmx
            .settings
            .get("snapshot.numsnapshots")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        if num > 0 {
            snapshots.clear();
            let current_uid = vmx.settings.get("snapshot.current").cloned();

            for idx in 0..num {
                let prefix = format!("snapshot{idx}");
                let uid = vmx
                    .settings
                    .get(&format!("{prefix}.uid"))
                    .cloned()
                    .unwrap_or_else(|| format!("snap-{idx}"));
                let name = vmx
                    .settings
                    .get(&format!("{prefix}.displayname"))
                    .cloned()
                    .unwrap_or_else(|| format!("Snapshot {idx}"));
                let desc = vmx.settings.get(&format!("{prefix}.description")).cloned();
                let parent = vmx.settings.get(&format!("{prefix}.parent")).cloned();
                let created_str = vmx.settings.get(&format!("{prefix}.createtimehigh"))
                    .and_then(|_h| vmx.settings.get(&format!("{prefix}.createtimelow")))
                    .map(|_| String::new()); // timestamp reconstruction is complex
                let has_memory = vmx
                    .settings
                    .get(&format!("{prefix}.type"))
                    .map(|t| t == "1" || t.to_lowercase().contains("full"))
                    .unwrap_or(false);
                let is_curr = current_uid.as_deref() == Some(&uid);

                snapshots.push(SnapshotInfo {
                    name: uid.clone(),
                    display_name: Some(name),
                    description: desc,
                    created_at: created_str,
                    parent,
                    children: vec![],
                    is_current: is_curr,
                    has_memory: Some(has_memory),
                    size: None,
                });
            }

            // Build children lists
            let parents: Vec<(usize, Option<String>)> = snapshots
                .iter()
                .enumerate()
                .map(|(i, s)| (i, s.parent.clone()))
                .collect();
            for (idx, parent_uid) in parents {
                if let Some(ref pu) = parent_uid {
                    if let Some(pi) = snapshots.iter().position(|s| &s.name == pu) {
                        let child_id = snapshots[idx].name.clone();
                        snapshots[pi].children.push(child_id);
                    }
                }
            }
        }
    }

    Ok(snapshots)
}

/// Get the snapshot tree for a VM.
pub async fn get_snapshot_tree(vmrun: &VmRun, vmx_path: &str) -> VmwResult<SnapshotTree> {
    let snapshots = list_snapshots(vmrun, vmx_path).await?;
    let roots: Vec<String> = snapshots
        .iter()
        .filter(|s| s.parent.is_none())
        .map(|s| s.name.clone())
        .collect();
    let current = snapshots
        .iter()
        .find(|s| s.is_current)
        .map(|s| s.name.clone());
    Ok(SnapshotTree {
        vm_name: vmx_path.to_string(),
        vmx_path: vmx_path.to_string(),
        current_snapshot: current,
        snapshots,
    })
}

/// Create a new snapshot.
pub async fn create_snapshot(
    vmrun: &VmRun,
    vmx_path: &str,
    req: CreateSnapshotRequest,
) -> VmwResult<()> {
    vmrun.snapshot(vmx_path, &req.name).await
}

/// Delete a snapshot.
pub async fn delete_snapshot(
    vmrun: &VmRun,
    vmx_path: &str,
    name: &str,
    delete_children: bool,
) -> VmwResult<()> {
    vmrun.delete_snapshot(vmx_path, name, delete_children).await
}

/// Revert to a named snapshot.
pub async fn revert_to_snapshot(vmrun: &VmRun, vmx_path: &str, name: &str) -> VmwResult<()> {
    vmrun.revert_to_snapshot(vmx_path, name).await
}

/// Get details for a specific snapshot by name.
pub async fn get_snapshot(
    vmrun: &VmRun,
    vmx_path: &str,
    name: &str,
) -> VmwResult<SnapshotInfo> {
    let all = list_snapshots(vmrun, vmx_path).await?;
    all.into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| crate::error::VmwError::snapshot_not_found(name))
}
