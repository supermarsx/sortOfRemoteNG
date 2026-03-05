//! VMX file parser and editor.
//!
//! A `.vmx` file is a simple `key = "value"` text file that defines every
//! aspect of a VM's configuration.  This module reads, edits, and writes
//! VMX files while preserving comments and ordering.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use std::collections::HashMap;
use std::path::Path;

/// Parse a VMX file from disk.
pub fn parse_vmx(path: &str) -> VmwResult<VmxFile> {
    let content =
        std::fs::read_to_string(path).map_err(|e| VmwError::new(VmwErrorKind::VmxParseError, e.to_string()))?;
    parse_vmx_content(path, &content)
}

/// Parse VMX content from a string.
pub fn parse_vmx_content(path: &str, content: &str) -> VmwResult<VmxFile> {
    let mut entries = Vec::new();
    let mut settings: HashMap<String, String> = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('/') {
            continue;
        }
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_lowercase();
            let mut val = trimmed[eq_pos + 1..].trim().to_string();
            // Strip surrounding quotes
            if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                val = val[1..val.len() - 1].to_string();
            }
            entries.push(VmxEntry {
                key: key.clone(),
                value: val.clone(),
            });
            settings.insert(key, val);
        }
    }

    Ok(VmxFile {
        path: path.to_string(),
        entries,
        settings,
    })
}

/// Write VMX settings back to disk.
pub fn write_vmx(path: &str, settings: &HashMap<String, String>) -> VmwResult<()> {
    // Read original to preserve comments
    let original = std::fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    let mut written: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('/') {
            lines.push(line.to_string());
            continue;
        }
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_lowercase();
            if let Some(val) = settings.get(&key) {
                lines.push(format!("{} = \"{}\"", key, val));
                written.insert(key);
            } else {
                // Key removed – skip it
            }
        } else {
            lines.push(line.to_string());
        }
    }

    // Append new keys
    for (key, val) in settings {
        if !written.contains(key.as_str()) {
            lines.push(format!("{} = \"{}\"", key, val));
        }
    }

    let content = lines.join("\n") + "\n";
    std::fs::write(path, content)
        .map_err(|e| VmwError::new(VmwErrorKind::IoError, e.to_string()))?;
    Ok(())
}

/// Update specific keys in an existing VMX file.
pub fn update_vmx_keys(path: &str, updates: &HashMap<String, String>) -> VmwResult<()> {
    let mut vmx = parse_vmx(path)?;
    for (k, v) in updates {
        vmx.settings.insert(k.to_lowercase(), v.clone());
    }
    write_vmx(path, &vmx.settings)
}

/// Remove specific keys from a VMX file.
pub fn remove_vmx_keys(path: &str, keys: &[String]) -> VmwResult<()> {
    let mut vmx = parse_vmx(path)?;
    for k in keys {
        vmx.settings.remove(&k.to_lowercase());
    }
    write_vmx(path, &vmx.settings)
}

/// Get the display name from a VMX file.
pub fn get_display_name(settings: &HashMap<String, String>) -> String {
    settings
        .get("displayname")
        .cloned()
        .unwrap_or_else(|| "Unnamed VM".to_string())
}

/// Determine guest OS family from guestOS or guestOS.detailed.data.
pub fn get_guest_os_family(settings: &HashMap<String, String>) -> GuestOsFamily {
    let os = settings
        .get("guestos")
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    if os.contains("windows") || os.starts_with("win") {
        GuestOsFamily::Windows
    } else if os.contains("linux") || os.contains("ubuntu") || os.contains("centos")
        || os.contains("debian") || os.contains("rhel") || os.contains("fedora")
        || os.contains("suse") || os.contains("oracle") || os.contains("amazon")
    {
        GuestOsFamily::Linux
    } else if os.contains("darwin") || os.contains("macos") || os.contains("osx") {
        GuestOsFamily::MacOs
    } else if os.contains("freebsd") {
        GuestOsFamily::FreeBsd
    } else if os.contains("solaris") || os.contains("openindiana") {
        GuestOsFamily::Solaris
    } else {
        GuestOsFamily::Other
    }
}

/// Build a VmDetail from parsed VMX settings.
pub fn vmx_to_detail(path: &str, settings: &HashMap<String, String>) -> VmDetail {
    let name = get_display_name(settings);
    let guest_os = settings.get("guestos").cloned();
    let guest_os_family = get_guest_os_family(settings);
    let hw_version = settings
        .get("virtualhw.version")
        .and_then(|s| s.parse::<u32>().ok());
    let num_cpus = settings
        .get("numvcpus")
        .and_then(|s| s.parse::<u32>().ok());
    let cores_per_socket = settings
        .get("cpuid.corespersocket")
        .and_then(|s| s.parse::<u32>().ok());
    let memory_mb = settings
        .get("memsize")
        .and_then(|s| s.parse::<u64>().ok());
    let firmware = settings.get("firmware").cloned();
    let uefi_secure_boot = settings
        .get("uefi.secureBoot.enabled")
        .map(|v| v == "TRUE" || v == "true");
    let vtpm = settings
        .get("managedvm.autoaddvtpm")
        .or_else(|| settings.get("vtpm.present"))
        .map(|v| v == "TRUE" || v == "true");
    let encryption = settings
        .get("encryption.keysafe")
        .map(|_| true);
    let annotation = settings.get("annotation").cloned();

    // NICs
    let nics = parse_nics(settings);
    let mac_addresses: Vec<String> = nics
        .iter()
        .filter_map(|n| n.mac_address.clone())
        .collect();

    // Disks
    let disks = parse_disks(settings);

    // CDROMs
    let cdroms = parse_cdroms(settings);

    // Shared folders
    let shared_folders = parse_shared_folders(settings);

    // Display
    let display = parse_display(settings);

    VmDetail {
        id: path.to_string(),
        vmx_path: path.to_string(),
        name,
        power_state: VmPowerState::Unknown,
        guest_os,
        guest_os_family,
        annotation,
        hardware_version: hw_version,
        num_cpus,
        cores_per_socket,
        memory_mb,
        firmware,
        bios_type: settings.get("bios.bootorder").cloned(),
        uefi_secure_boot: uefi_secure_boot,
        vtpm_present: vtpm,
        encryption_enabled: encryption,
        tools_status: None,
        tools_version: None,
        ip_address: None,
        mac_addresses,
        nics,
        disks,
        cdroms,
        usb_controllers: parse_usb_controllers(settings),
        sound_card: settings.get("sound.present").and_then(|v| {
            if v == "TRUE" || v == "true" {
                Some(settings.get("sound.virtualdev").cloned().unwrap_or_else(|| "hdaudio".to_string()))
            } else {
                None
            }
        }),
        display,
        shared_folders,
        snapshots: Vec::new(),
        auto_start: settings.get("autostart").map(|v| v == "TRUE" || v == "true"),
        vmx_settings: settings.clone(),
    }
}

// ── Sub-parsers ──────────────────────────────────────────────────────────────

fn parse_nics(s: &HashMap<String, String>) -> Vec<VmNic> {
    let mut nics = Vec::new();
    for i in 0..10 {
        let prefix = format!("ethernet{i}");
        let present_key = format!("{prefix}.present");
        if s.get(&present_key).map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
            nics.push(VmNic {
                index: i,
                adapter_type: s.get(&format!("{prefix}.virtualdev")).cloned().unwrap_or_default(),
                network_type: s
                    .get(&format!("{prefix}.connectiontype"))
                    .cloned()
                    .unwrap_or_default(),
                mac_address: s.get(&format!("{prefix}.address"))
                    .or_else(|| s.get(&format!("{prefix}.generatedaddress")))
                    .cloned(),
                connected: s
                    .get(&format!("{prefix}.startconnected"))
                    .map(|v| v == "TRUE" || v == "true")
                    .unwrap_or(true),
                start_connected: s
                    .get(&format!("{prefix}.startconnected"))
                    .map(|v| v == "TRUE" || v == "true")
                    .unwrap_or(true),
                vnet: s.get(&format!("{prefix}.vnet")).cloned(),
            });
        }
    }
    nics
}

fn parse_disks(s: &HashMap<String, String>) -> Vec<VmDisk> {
    let mut disks = Vec::new();
    let controllers = ["scsi", "sata", "nvme", "ide"];
    for ctrl in &controllers {
        for bus in 0..4 {
            for unit in 0..16 {
                let prefix = format!("{ctrl}{bus}:{unit}");
                let present = format!("{prefix}.present");
                let fname = format!("{prefix}.filename");
                if s.get(&present).map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
                    if let Some(file) = s.get(&fname) {
                        disks.push(VmDisk {
                            index: disks.len() as u32,
                            file_name: file.clone(),
                            capacity_mb: None,
                            disk_type: s
                                .get(&format!("{prefix}.mode"))
                                .cloned()
                                .unwrap_or_else(|| "persistent".to_string()),
                            controller_type: ctrl.to_string(),
                            controller_bus: bus,
                            unit_number: unit,
                        });
                    }
                }
            }
        }
    }
    disks
}

fn parse_cdroms(s: &HashMap<String, String>) -> Vec<VmCdrom> {
    let mut cdroms = Vec::new();
    let controllers = ["sata", "ide"];
    for ctrl in &controllers {
        for bus in 0..4 {
            for unit in 0..2 {
                let prefix = format!("{ctrl}{bus}:{unit}");
                let present = format!("{prefix}.present");
                let dev_type = format!("{prefix}.devicetype");
                if s.get(&present).map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
                    let dt = s.get(&dev_type).cloned().unwrap_or_default();
                    if dt.contains("cdrom") || dt.contains("atapi-cdrom") || dt == "cdrom-image" || dt == "cdrom-raw" {
                        cdroms.push(VmCdrom {
                            index: cdroms.len() as u32,
                            device_type: dt,
                            file_name: s.get(&format!("{prefix}.filename")).cloned(),
                            connected: s
                                .get(&format!("{prefix}.startconnected"))
                                .map(|v| v == "TRUE" || v == "true")
                                .unwrap_or(true),
                            start_connected: s
                                .get(&format!("{prefix}.startconnected"))
                                .map(|v| v == "TRUE" || v == "true")
                                .unwrap_or(true),
                        });
                    }
                }
            }
        }
    }
    cdroms
}

fn parse_shared_folders(s: &HashMap<String, String>) -> Vec<SharedFolder> {
    let mut folders = Vec::new();
    let max = s
        .get("sharedfolder.maxnum")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    for i in 0..max {
        let prefix = format!("sharedfolder{i}");
        let present = format!("{prefix}.present");
        if s.get(&present).map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
            folders.push(SharedFolder {
                name: s
                    .get(&format!("{prefix}.guestname"))
                    .cloned()
                    .unwrap_or_else(|| format!("share{i}")),
                host_path: s
                    .get(&format!("{prefix}.hostpath"))
                    .cloned()
                    .unwrap_or_default(),
                writable: s
                    .get(&format!("{prefix}.readaccess"))
                    .map(|v| v != "TRUE" && v != "true")
                    .unwrap_or(true),
                enabled: s
                    .get(&format!("{prefix}.enabled"))
                    .map(|v| v == "TRUE" || v == "true")
                    .unwrap_or(true),
            });
        }
    }
    folders
}

fn parse_usb_controllers(s: &HashMap<String, String>) -> Vec<String> {
    let mut usb = Vec::new();
    if s.get("usb.present").map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
        usb.push("USB 1.1".to_string());
    }
    if s.get("ehci.present").map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
        usb.push("USB 2.0 (EHCI)".to_string());
    }
    if s.get("usb_xhci.present").map(|v| v == "TRUE" || v == "true").unwrap_or(false) {
        usb.push("USB 3.1 (xHCI)".to_string());
    }
    usb
}

fn parse_display(s: &HashMap<String, String>) -> Option<VmDisplay> {
    Some(VmDisplay {
        display_name: s.get("svga.graphicsmemorykb").map(|_| "SVGA".to_string()),
        use_auto_detect: s
            .get("svga.autodetect")
            .map(|v| v == "TRUE" || v == "true")
            .unwrap_or(true),
        accel_3d: s
            .get("mks.enable3d")
            .map(|v| v == "TRUE" || v == "true")
            .unwrap_or(false),
        vram_size_kb: s
            .get("svga.graphicsmemorykb")
            .and_then(|v| v.parse().ok()),
        num_displays: s
            .get("svga.numDisplays")
            .and_then(|v| v.parse().ok()),
    })
}

/// Generate a minimal VMX file for a new VM.
pub fn generate_vmx(req: &CreateVmRequest) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let hw = req.hardware_version.unwrap_or(21);
    m.insert(".encoding".to_string(), "UTF-8".to_string());
    m.insert("displayname".to_string(), req.name.clone());
    m.insert("guestos".to_string(), req.guest_os.clone());
    m.insert("virtualhw.version".to_string(), hw.to_string());
    m.insert("config.version".to_string(), "8".to_string());
    m.insert(
        "numvcpus".to_string(),
        req.num_cpus.unwrap_or(2).to_string(),
    );
    m.insert(
        "cpuid.corespersocket".to_string(),
        req.cores_per_socket.unwrap_or(1).to_string(),
    );
    m.insert(
        "memsize".to_string(),
        req.memory_mb.unwrap_or(2048).to_string(),
    );
    m.insert("pciBridge0.present".to_string(), "TRUE".to_string());
    m.insert("pciBridge4.present".to_string(), "TRUE".to_string());
    m.insert("pciBridge4.virtualdev".to_string(), "pcieRootPort".to_string());
    m.insert("pciBridge4.functions".to_string(), "8".to_string());
    m.insert("vmci0.present".to_string(), "TRUE".to_string());
    m.insert("hpet0.present".to_string(), "TRUE".to_string());

    // Firmware
    if let Some(ref fw) = req.firmware {
        m.insert("firmware".to_string(), fw.clone());
    }

    // Network
    m.insert("ethernet0.present".to_string(), "TRUE".to_string());
    m.insert(
        "ethernet0.connectiontype".to_string(),
        req.network_type.clone().unwrap_or_else(|| "nat".to_string()),
    );
    m.insert("ethernet0.virtualdev".to_string(), "e1000e".to_string());
    m.insert("ethernet0.addresstype".to_string(), "generated".to_string());
    m.insert("ethernet0.startconnected".to_string(), "TRUE".to_string());

    // SCSI controller
    m.insert("scsi0.present".to_string(), "TRUE".to_string());
    m.insert("scsi0.virtualdev".to_string(), "lsilogic".to_string());

    // Primary disk placeholder (actual VMDK must be created separately)
    m.insert("scsi0:0.present".to_string(), "TRUE".to_string());
    m.insert(
        "scsi0:0.filename".to_string(),
        format!("{}.vmdk", req.name),
    );

    // CDROM
    m.insert("sata0.present".to_string(), "TRUE".to_string());
    m.insert("sata0:0.present".to_string(), "TRUE".to_string());
    if let Some(ref iso) = req.iso_path {
        m.insert("sata0:0.devicetype".to_string(), "cdrom-image".to_string());
        m.insert("sata0:0.filename".to_string(), iso.clone());
        m.insert("sata0:0.startconnected".to_string(), "TRUE".to_string());
    } else {
        m.insert("sata0:0.devicetype".to_string(), "cdrom-raw".to_string());
        m.insert("sata0:0.startconnected".to_string(), "FALSE".to_string());
    }

    // Annotation
    if let Some(ref ann) = req.annotation {
        m.insert("annotation".to_string(), ann.clone());
    }

    // USB
    m.insert("usb_xhci.present".to_string(), "TRUE".to_string());

    // Sound
    m.insert("sound.present".to_string(), "TRUE".to_string());
    m.insert("sound.virtualdev".to_string(), "hdaudio".to_string());

    // Display / 3D
    m.insert("mks.enable3d".to_string(), "TRUE".to_string());
    m.insert("svga.autodetect".to_string(), "TRUE".to_string());

    m
}

/// Discover all VMX files in a directory tree.
pub fn discover_vmx_files(dir: &str) -> VmwResult<Vec<String>> {
    let mut results = Vec::new();
    discover_vmx_recursive(Path::new(dir), &mut results)?;
    Ok(results)
}

fn discover_vmx_recursive(dir: &Path, results: &mut Vec<String>) -> VmwResult<()> {
    let entries = std::fs::read_dir(dir).map_err(|e| VmwError::io(e))?;
    for entry in entries {
        let entry = entry.map_err(|e| VmwError::io(e))?;
        let path = entry.path();
        if path.is_dir() {
            // Don't recurse too deep
            let _ = discover_vmx_recursive(&path, results);
        } else if let Some(ext) = path.extension() {
            if ext.to_string_lossy().to_lowercase() == "vmx" {
                results.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}
