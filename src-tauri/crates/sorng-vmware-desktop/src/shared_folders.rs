//! Shared folder management for VMware desktop VMs.

use crate::error::VmwResult;
use crate::types::*;
use crate::vmrest::VmRestClient;
use crate::vmrun::VmRun;

/// Enable shared folders on a VM.
pub async fn enable_shared_folders(vmrun: &VmRun, vmx_path: &str) -> VmwResult<()> {
    vmrun.enable_shared_folders(vmx_path).await
}

/// Disable shared folders on a VM.
pub async fn disable_shared_folders(vmrun: &VmRun, vmx_path: &str) -> VmwResult<()> {
    vmrun.disable_shared_folders(vmx_path).await
}

/// List shared folders on a VM.
pub async fn list_shared_folders(
    vmx_path: &str,
    rest: Option<&VmRestClient>,
    rest_vm_id: Option<&str>,
) -> VmwResult<Vec<SharedFolder>> {
    // Prefer vmrest if available + VM id known
    if let (Some(r), Some(id)) = (rest, rest_vm_id) {
        if let Ok(sf) = r.list_shared_folders(id).await {
            return Ok(sf
                .into_iter()
                .map(|s| SharedFolder {
                    name: s.folder_id.unwrap_or_default(),
                    host_path: s.host_path.unwrap_or_default(),
                    writable: s.flags.map(|f| f != 0).unwrap_or(true),
                    enabled: true,
                })
                .collect());
        }
    }

    // Fallback to VMX parsing
    let vmx_data = crate::vmx::parse_vmx(vmx_path)?;
    Ok(crate::vmx::parse_shared_folders(&vmx_data.settings))
}

/// Add a shared folder.
pub async fn add_shared_folder(
    vmrun: &VmRun,
    vmx_path: &str,
    req: SharedFolderRequest,
) -> VmwResult<()> {
    vmrun
        .add_shared_folder(vmx_path, &req.name, &req.host_path)
        .await?;
    if !req.writable.unwrap_or(true) {
        vmrun
            .set_shared_folder_state(vmx_path, &req.name, &req.host_path, false)
            .await?;
    }
    Ok(())
}

/// Remove a shared folder.
pub async fn remove_shared_folder(vmrun: &VmRun, vmx_path: &str, name: &str) -> VmwResult<()> {
    vmrun.remove_shared_folder(vmx_path, name).await
}

/// Update shared folder state (read/write).
pub async fn set_shared_folder_state(
    vmrun: &VmRun,
    vmx_path: &str,
    name: &str,
    host_path: &str,
    writable: bool,
) -> VmwResult<()> {
    vmrun
        .set_shared_folder_state(vmx_path, name, host_path, writable)
        .await
}
