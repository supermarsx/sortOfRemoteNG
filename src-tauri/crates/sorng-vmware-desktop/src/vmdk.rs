//! Virtual disk management — create, resize, defragment, shrink,
//! convert, info, and VMDK descriptor parsing.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use crate::vmrun::VmRun;

/// Create a new VMDK.
pub async fn create_vmdk(vmrun: &VmRun, req: CreateVmdkRequest) -> VmwResult<VmdkInfo> {
    vmrun
        .create_disk(
            &req.path,
            req.size_mb,
            req.disk_type.as_deref(),
            req.adapter_type.as_deref(),
        )
        .await?;
    get_vmdk_info(&req.path)
}

/// Parse the VMDK descriptor to extract metadata.
pub fn get_vmdk_info(path: &str) -> VmwResult<VmdkInfo> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        VmwError::new(
            VmwErrorKind::VmdkError,
            format!("Cannot read VMDK descriptor {path}: {e}"),
        )
    })?;

    let mut info = VmdkInfo {
        path: path.to_string(),
        size_mb: 0,
        disk_type: String::new(),
        adapter_type: None,
        hardware_version: None,
        parent_file: None,
        extents: vec![],
        cid: None,
        parent_cid: None,
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        // Descriptor entries
        if let Some(val) = trimmed.strip_prefix("createType=") {
            info.disk_type = val.trim_matches('"').to_string();
        } else if let Some(val) = trimmed.strip_prefix("ddb.adapterType = ") {
            info.adapter_type = Some(val.trim_matches('"').to_string());
        } else if let Some(val) = trimmed.strip_prefix("ddb.virtualHWVersion = ") {
            info.hardware_version = Some(val.trim_matches('"').to_string());
        } else if let Some(val) = trimmed.strip_prefix("parentFileNameHint=") {
            info.parent_file = Some(val.trim_matches('"').to_string());
        } else if let Some(val) = trimmed.strip_prefix("CID=") {
            info.cid = Some(val.to_string());
        } else if let Some(val) = trimmed.strip_prefix("parentCID=") {
            info.parent_cid = Some(val.to_string());
        }

        // Extent lines: RW 83886080 SPARSE "disk-s001.vmdk"
        if trimmed.starts_with("RW ") || trimmed.starts_with("RDONLY ") || trimmed.starts_with("NOACCESS ") {
            let parts: Vec<&str> = trimmed.splitn(4, ' ').collect();
            if parts.len() >= 4 {
                let sectors: u64 = parts[1].parse().unwrap_or(0);
                info.size_mb += sectors / 2048; // 512 bytes/sector -> MB
                let extent_type = parts[2].to_string();
                let filename = parts[3].trim_matches('"').to_string();
                info.extents.push(VmdkExtent {
                    access: parts[0].to_string(),
                    size_sectors: sectors,
                    extent_type,
                    filename,
                });
            }
        }
    }

    Ok(info)
}

/// Defragment a VMDK.
pub async fn defragment_vmdk(vmrun: &VmRun, path: &str) -> VmwResult<()> {
    vmrun.defragment_disk(path).await
}

/// Shrink a VMDK to reclaim unused space.
pub async fn shrink_vmdk(vmrun: &VmRun, path: &str) -> VmwResult<()> {
    vmrun.shrink_disk(path).await
}

/// Expand a VMDK to a new size.
pub async fn expand_vmdk(vmrun: &VmRun, path: &str, new_size_mb: u64) -> VmwResult<()> {
    vmrun.expand_disk(path, new_size_mb).await
}

/// Convert a VMDK between disk types.
pub async fn convert_vmdk(
    vmrun: &VmRun,
    source: &str,
    disk_type: &str,
    dest: Option<&str>,
) -> VmwResult<()> {
    vmrun.convert_disk(source, disk_type, dest).await
}

/// Rename/move a VMDK.
pub async fn rename_vmdk(vmrun: &VmRun, source: &str, dest: &str) -> VmwResult<()> {
    vmrun.rename_disk(source, dest).await
}

/// Add a disk to a VM configuration.
pub async fn add_disk_to_vm(
    vmrun: &VmRun,
    req: AddDiskRequest,
) -> VmwResult<()> {
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == &req.vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to add a disk",
        ));
    }

    let controller = req.controller_type.as_deref().unwrap_or("scsi");
    let bus = req.bus_number.unwrap_or(0);
    let unit = req.unit_number.unwrap_or_else(|| {
        // Find next available unit
        let vmx_data = crate::vmx::parse_vmx(&req.vmx_path).ok();
        if let Some(ref vmx) = vmx_data {
            for u in 0..16 {
                let key = format!("{controller}{bus}:{u}.present");
                if vmx.settings.get(&key).is_none() {
                    return u;
                }
            }
        }
        1
    });

    let prefix = format!("{controller}{bus}:{unit}");
    let mut updates = std::collections::HashMap::new();

    // Ensure controller is present
    updates.insert(format!("{controller}{bus}.present"), "TRUE".to_string());
    if controller == "scsi" {
        updates.insert(
            format!("{controller}{bus}.virtualdev"),
            "lsilogic".to_string(),
        );
    }

    updates.insert(format!("{prefix}.present"), "TRUE".to_string());
    updates.insert(format!("{prefix}.filename"), req.vmdk_path.clone());
    updates.insert(
        format!("{prefix}.mode"),
        req.mode.clone().unwrap_or_else(|| "persistent".to_string()),
    );

    crate::vmx::update_vmx_keys(&req.vmx_path, &updates)?;
    Ok(())
}

/// Remove a disk from a VM configuration (does not delete the VMDK file).
pub async fn remove_disk_from_vm(
    vmrun: &VmRun,
    vmx_path: &str,
    controller_type: &str,
    bus: u32,
    unit: u32,
) -> VmwResult<()> {
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to remove a disk",
        ));
    }

    let prefix = format!("{controller_type}{bus}:{unit}");
    let keys = vec![
        format!("{prefix}.present"),
        format!("{prefix}.filename"),
        format!("{prefix}.mode"),
        format!("{prefix}.redo"),
        format!("{prefix}.writethru"),
    ];
    crate::vmx::remove_vmx_keys(vmx_path, &keys)?;
    Ok(())
}

/// List all disks attached to a VM.
pub fn list_vm_disks(vmx_path: &str) -> VmwResult<Vec<VmDisk>> {
    let vmx_data = crate::vmx::parse_vmx(vmx_path)?;
    Ok(crate::vmx::parse_disks(&vmx_data.settings))
}
