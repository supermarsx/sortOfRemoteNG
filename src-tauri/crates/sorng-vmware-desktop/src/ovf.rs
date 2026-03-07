//! OVF / OVA import and export operations.

use crate::error::VmwResult;
use crate::types::*;
use crate::vmrun::VmRun;

/// Import an OVF/OVA into a VMware desktop VM.
pub async fn import_ovf(vmrun: &VmRun, req: OvfImportRequest) -> VmwResult<String> {
    let target = req.target_dir.as_deref().unwrap_or(".");
    vmrun.import_ovf(&req.source_path, target).await?;
    Ok(target.to_string())
}

/// Export a VM to OVF/OVA format.
pub async fn export_ovf(vmrun: &VmRun, req: OvfExportRequest) -> VmwResult<()> {
    vmrun.export_ovf(&req.vmx_path, &req.target_path).await
}
