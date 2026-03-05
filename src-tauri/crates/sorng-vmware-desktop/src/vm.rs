//! VM lifecycle operations — create, list, get details, update config,
//! delete, clone, register/unregister.
//!
//! Uses both `vmrun` and `vmrest` where available, with vmx file parsing
//! for detailed configuration data.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use crate::vmrest::VmRestClient;
use crate::vmrun::VmRun;
use crate::vmx;

/// List all registered VMs (via vmrest, or scan default dir).
pub async fn list_vms(
    vmrun: &VmRun,
    rest: Option<&VmRestClient>,
    scan_dirs: &[String],
) -> VmwResult<Vec<VmSummary>> {
    let running = vmrun.list().await.unwrap_or_default();

    // If vmrest is available, use it as the primary source
    if let Some(r) = rest {
        if let Ok(rest_vms) = r.list_vms().await {
            let mut result = Vec::new();
            for rv in rest_vms {
                if let Some(ref path) = rv.path {
                    let vmx_data = vmx::parse_vmx(path).ok();
                    let settings = vmx_data.as_ref().map(|v| &v.settings);
                    let is_running = running.iter().any(|rp| rp == path);
                    result.push(VmSummary {
                        id: rv.id.clone().unwrap_or_else(|| path.clone()),
                        vmx_path: path.clone(),
                        name: settings
                            .map(|s| vmx::get_display_name(s))
                            .unwrap_or_else(|| path.clone()),
                        power_state: if is_running {
                            VmPowerState::PoweredOn
                        } else {
                            VmPowerState::PoweredOff
                        },
                        guest_os: settings.and_then(|s| s.get("guestos").cloned()),
                        guest_os_family: settings
                            .map(|s| vmx::get_guest_os_family(s))
                            .unwrap_or(GuestOsFamily::Other),
                        num_cpus: settings.and_then(|s| s.get("numvcpus").and_then(|v| v.parse().ok())),
                        memory_mb: settings.and_then(|s| s.get("memsize").and_then(|v| v.parse().ok())),
                    });
                }
            }
            return Ok(result);
        }
    }

    // Fallback: scan directories for .vmx files
    let mut all_vmx: Vec<String> = Vec::new();
    for dir in scan_dirs {
        if let Ok(found) = vmx::discover_vmx_files(dir) {
            all_vmx.extend(found);
        }
    }
    // Also add any running VMs not yet in the list
    for r in &running {
        if !all_vmx.contains(r) {
            all_vmx.push(r.clone());
        }
    }

    let mut result = Vec::new();
    for path in all_vmx {
        let vmx_data = vmx::parse_vmx(&path).ok();
        let settings = vmx_data.as_ref().map(|v| &v.settings);
        let is_running = running.iter().any(|rp| rp == &path);
        result.push(VmSummary {
            id: path.clone(),
            vmx_path: path.clone(),
            name: settings
                .map(|s| vmx::get_display_name(s))
                .unwrap_or_else(|| path.clone()),
            power_state: if is_running {
                VmPowerState::PoweredOn
            } else {
                VmPowerState::PoweredOff
            },
            guest_os: settings.and_then(|s| s.get("guestos").cloned()),
            guest_os_family: settings
                .map(|s| vmx::get_guest_os_family(s))
                .unwrap_or(GuestOsFamily::Other),
            num_cpus: settings.and_then(|s| s.get("numvcpus").and_then(|v| v.parse().ok())),
            memory_mb: settings.and_then(|s| s.get("memsize").and_then(|v| v.parse().ok())),
        });
    }
    Ok(result)
}

/// Get full detail for a single VM.
pub async fn get_vm(
    vmrun: &VmRun,
    rest: Option<&VmRestClient>,
    vmx_path: &str,
) -> VmwResult<VmDetail> {
    let vmx_data = vmx::parse_vmx(vmx_path)?;
    let mut detail = vmx::vmx_to_detail(vmx_path, &vmx_data.settings);

    // Determine power state
    let running = vmrun.list().await.unwrap_or_default();
    detail.power_state = if running.iter().any(|p| p == vmx_path) {
        VmPowerState::PoweredOn
    } else {
        VmPowerState::PoweredOff
    };

    // Try to get IP if running
    if detail.power_state == VmPowerState::PoweredOn {
        if let Ok(ip) = vmrun.get_guest_ip_address(vmx_path, false).await {
            if !ip.is_empty() && ip != "unknown" {
                detail.ip_address = Some(ip);
            }
        }
        // Tools state
        if let Ok(tools) = vmrun.check_tools_state(vmx_path).await {
            detail.tools_status = Some(tools);
        }
    }

    // If vmrest available, try to enrich with ID
    if let Some(r) = rest {
        if let Ok(vms) = r.list_vms().await {
            for v in vms {
                if v.path.as_deref() == Some(vmx_path) {
                    if let Some(id) = v.id {
                        detail.id = id;
                    }
                }
            }
        }
    }

    Ok(detail)
}

/// Create a new VM from scratch.
pub async fn create_vm(
    vmrun: &VmRun,
    rest: Option<&VmRestClient>,
    req: CreateVmRequest,
) -> VmwResult<VmDetail> {
    let target_dir = req.target_dir.clone().unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            format!(
                "{}\\Documents\\Virtual Machines\\{}",
                std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string()),
                &req.name
            )
        } else if cfg!(target_os = "macos") {
            format!(
                "{}/Virtual Machines.localized/{}",
                std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string()),
                &req.name
            )
        } else {
            format!(
                "{}/vmware/{}",
                std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()),
                &req.name
            )
        }
    });

    // Create directory
    std::fs::create_dir_all(&target_dir).map_err(|e| VmwError::io(e))?;

    let vmx_path = format!(
        "{}{}{}.vmx",
        target_dir,
        std::path::MAIN_SEPARATOR,
        &req.name
    );

    // Generate VMDK
    let disk_size = req.disk_size_mb.unwrap_or(40960);
    let vmdk_path = format!(
        "{}{}{}.vmdk",
        target_dir,
        std::path::MAIN_SEPARATOR,
        &req.name
    );
    vmrun
        .create_disk(&vmdk_path, disk_size, req.disk_type.as_deref(), None)
        .await?;

    // Generate and write VMX
    let settings = vmx::generate_vmx(&req);
    vmx::write_vmx(&vmx_path, &settings)?;

    // Register with vmrest if available
    if let Some(r) = rest {
        let _ = r.register_vm(&vmx_path).await;
    }

    get_vm(vmrun, rest, &vmx_path).await
}

/// Update VM configuration (must be powered off).
pub async fn update_vm(
    vmrun: &VmRun,
    req: UpdateVmRequest,
) -> VmwResult<()> {
    // Verify powered off
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == &req.vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to change configuration",
        ));
    }

    let mut updates = std::collections::HashMap::new();
    if let Some(ref name) = req.name {
        updates.insert("displayname".to_string(), name.clone());
    }
    if let Some(cpus) = req.num_cpus {
        updates.insert("numvcpus".to_string(), cpus.to_string());
    }
    if let Some(cores) = req.cores_per_socket {
        updates.insert("cpuid.corespersocket".to_string(), cores.to_string());
    }
    if let Some(mem) = req.memory_mb {
        updates.insert("memsize".to_string(), mem.to_string());
    }
    if let Some(ref ann) = req.annotation {
        updates.insert("annotation".to_string(), ann.clone());
    }
    if let Some(ref fw) = req.firmware {
        updates.insert("firmware".to_string(), fw.clone());
    }
    if let Some(nv) = req.nested_virt {
        updates.insert(
            "vhv.enable".to_string(),
            if nv { "TRUE" } else { "FALSE" }.to_string(),
        );
    }
    if let Some(sc) = req.side_channel_mitigations {
        updates.insert(
            "ulm.disablemodules".to_string(),
            if sc { "FALSE" } else { "TRUE" }.to_string(),
        );
    }
    if let Some(sb) = req.uefi_secure_boot {
        updates.insert(
            "uefi.secureboot.enabled".to_string(),
            if sb { "TRUE" } else { "FALSE" }.to_string(),
        );
    }
    if let Some(vtpm) = req.vtpm {
        updates.insert(
            "vtpm.present".to_string(),
            if vtpm { "TRUE" } else { "FALSE" }.to_string(),
        );
    }

    if !updates.is_empty() {
        vmx::update_vmx_keys(&req.vmx_path, &updates)?;
    }
    Ok(())
}

/// Delete a VM (remove files from disk).
pub async fn delete_vm(
    vmrun: &VmRun,
    rest: Option<&VmRestClient>,
    vmx_path: &str,
) -> VmwResult<()> {
    // Ensure stopped
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == vmx_path) {
        vmrun.stop(vmx_path, true).await?;
    }

    // Unregister from vmrest
    if let Some(r) = rest {
        if let Ok(vms) = r.list_vms().await {
            for v in vms {
                if v.path.as_deref() == Some(vmx_path) {
                    if let Some(id) = v.id {
                        let _ = r.unregister_vm(&id).await;
                    }
                }
            }
        }
    }

    // Delete via vmrun
    vmrun.delete_vm(vmx_path).await?;
    Ok(())
}

/// Clone a VM (full or linked clone).
pub async fn clone_vm(
    vmrun: &VmRun,
    rest: Option<&VmRestClient>,
    req: CloneVmRequest,
) -> VmwResult<VmDetail> {
    let dest_dir = req.dest_dir.clone().unwrap_or_else(|| {
        let parent = std::path::Path::new(&req.source_vmx)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        format!("{}{}{}", parent, std::path::MAIN_SEPARATOR, req.dest_name)
    });
    let dest_vmx = format!(
        "{}{}{}.vmx",
        dest_dir,
        std::path::MAIN_SEPARATOR,
        req.dest_name
    );

    vmrun
        .clone_vm(
            &req.source_vmx,
            &dest_vmx,
            &req.clone_type,
            req.snapshot_name.as_deref(),
        )
        .await?;

    // Register in vmrest
    if let Some(r) = rest {
        let _ = r.register_vm(&dest_vmx).await;
    }

    get_vm(vmrun, rest, &dest_vmx).await
}

/// Register a VM from an existing VMX path.
pub async fn register_vm(
    rest: &VmRestClient,
    vmx_path: &str,
) -> VmwResult<String> {
    let rv = rest.register_vm(vmx_path).await?;
    Ok(rv.id.unwrap_or_else(|| vmx_path.to_string()))
}

/// Unregister a VM (does not delete files).
pub async fn unregister_vm(rest: &VmRestClient, id: &str) -> VmwResult<()> {
    rest.unregister_vm(id).await?;
    Ok(())
}

/// Configure a NIC on a VM.
pub async fn configure_nic(
    vmrun: &VmRun,
    req: ConfigureNicRequest,
) -> VmwResult<()> {
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == &req.vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to change NIC configuration",
        ));
    }

    let prefix = format!("ethernet{}", req.nic_index);
    let mut updates = std::collections::HashMap::new();
    updates.insert(format!("{prefix}.present"), "TRUE".to_string());
    if let Some(ref nt) = req.network_type {
        updates.insert(format!("{prefix}.connectiontype"), nt.clone());
    }
    if let Some(ref at) = req.adapter_type {
        updates.insert(format!("{prefix}.virtualdev"), at.clone());
    }
    if let Some(ref mac) = req.mac_address {
        updates.insert(format!("{prefix}.addresstype"), "static".to_string());
        updates.insert(format!("{prefix}.address"), mac.clone());
    }
    if let Some(ref vnet) = req.vnet {
        updates.insert(format!("{prefix}.vnet"), vnet.clone());
    }
    if let Some(c) = req.connected {
        updates.insert(
            format!("{prefix}.startconnected"),
            if c { "TRUE" } else { "FALSE" }.to_string(),
        );
    }
    if let Some(sc) = req.start_connected {
        updates.insert(
            format!("{prefix}.startconnected"),
            if sc { "TRUE" } else { "FALSE" }.to_string(),
        );
    }

    vmx::update_vmx_keys(&req.vmx_path, &updates)?;
    Ok(())
}

/// Remove a NIC from a VM.
pub async fn remove_nic(vmrun: &VmRun, vmx_path: &str, nic_index: u32) -> VmwResult<()> {
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to remove NIC",
        ));
    }
    let prefix = format!("ethernet{nic_index}");
    let keys: Vec<String> = vec![
        format!("{prefix}.present"),
        format!("{prefix}.connectiontype"),
        format!("{prefix}.virtualdev"),
        format!("{prefix}.address"),
        format!("{prefix}.generatedaddress"),
        format!("{prefix}.addresstype"),
        format!("{prefix}.startconnected"),
        format!("{prefix}.vnet"),
    ];
    vmx::remove_vmx_keys(vmx_path, &keys)?;
    Ok(())
}

/// Configure a CD/DVD drive.
pub async fn configure_cdrom(
    vmrun: &VmRun,
    req: ConfigureCdromRequest,
) -> VmwResult<()> {
    let running = vmrun.list().await.unwrap_or_default();
    if running.iter().any(|p| p == &req.vmx_path) {
        return Err(VmwError::new(
            VmwErrorKind::InvalidConfig,
            "VM must be powered off to change CD/DVD settings",
        ));
    }

    let prefix = format!("sata0:{}", req.cdrom_index);
    let mut updates = std::collections::HashMap::new();
    updates.insert(format!("{prefix}.present"), "TRUE".to_string());
    updates.insert(format!("{prefix}.devicetype"), req.device_type.clone());
    if let Some(ref f) = req.file_name {
        updates.insert(format!("{prefix}.filename"), f.clone());
    }
    if let Some(c) = req.connected {
        updates.insert(
            format!("{prefix}.startconnected"),
            if c { "TRUE" } else { "FALSE" }.to_string(),
        );
    }
    vmx::update_vmx_keys(&req.vmx_path, &updates)?;
    Ok(())
}
