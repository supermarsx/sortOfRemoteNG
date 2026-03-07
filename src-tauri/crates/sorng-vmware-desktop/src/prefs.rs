//! VMware desktop preferences — detect installed products, read/write
//! application preferences, license info, default VM storage locations.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;

/// Detect the installed VMware desktop product.
pub fn detect_product() -> VmwResult<VmwHostInfo> {
    let (product, version, _build, install_path) = if cfg!(target_os = "windows") {
        detect_windows()
    } else if cfg!(target_os = "macos") {
        detect_macos()
    } else {
        detect_linux()
    }?;

    let os = if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else {
        "linux".to_string()
    };

    // Try to find vmrun in the install directory
    let vmrun_path = find_vmrun_in(&install_path);

    Ok(VmwHostInfo {
        product,
        product_version: version,
        vmrun_path,
        vmrest_available: false,
        vmrest_port: None,
        os,
        default_vm_dir: None,
        network_types: vec![],
    })
}

fn find_vmrun_in(install_path: &str) -> Option<String> {
    let candidates: Vec<String> = if cfg!(target_os = "windows") {
        vec![format!("{install_path}\\vmrun.exe")]
    } else if cfg!(target_os = "macos") {
        vec![format!("{install_path}/Contents/Library/vmrun")]
    } else {
        vec!["/usr/bin/vmrun".to_string()]
    };
    for c in candidates {
        if std::path::Path::new(&c).exists() {
            return Some(c);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn detect_windows() -> VmwResult<(VmwProduct, Option<String>, Option<String>, String)> {
    // Try registry
    let paths = [
        ("SOFTWARE\\VMware, Inc.\\VMware Workstation", true),
        ("SOFTWARE\\VMware, Inc.\\VMware Player", false),
    ];
    for (key_path, is_workstation) in &paths {
        if let Ok(hklm) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(key_path)
        {
            let version: Option<String> = hklm.get_value::<String, _>("ProductVersion").ok();
            let build: Option<String> = hklm.get_value::<String, _>("BuildNumber").ok();
            let install_path: String = hklm
                .get_value::<String, _>("InstallPath")
                .unwrap_or_else(|_| "C:\\Program Files (x86)\\VMware\\VMware Workstation".to_string());
            let product = if *is_workstation {
                // Determine Pro vs regular
                let lic: Option<String> = hklm.get_value::<String, _>("License.ws.e1.bType").ok();
                if lic.as_deref() == Some("site") || lic.as_deref() == Some("volume") {
                    VmwProduct::WorkstationPro
                } else {
                    VmwProduct::Workstation
                }
            } else {
                VmwProduct::Player
            };
            return Ok((product, version, build, install_path));
        }
    }
    // Fallback — check common install directories
    let ws_path = "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmware.exe";
    if std::path::Path::new(ws_path).exists() {
        return Ok((
            VmwProduct::Workstation,
            None,
            None,
            "C:\\Program Files (x86)\\VMware\\VMware Workstation".to_string(),
        ));
    }
    Err(VmwError::new(
        VmwErrorKind::UnsupportedPlatform,
        "No VMware desktop product found on Windows",
    ))
}

#[cfg(not(target_os = "windows"))]
fn detect_windows() -> VmwResult<(VmwProduct, Option<String>, Option<String>, String)> {
    Err(VmwError::new(
        VmwErrorKind::UnsupportedPlatform,
        "Not running on Windows",
    ))
}

fn detect_macos() -> VmwResult<(VmwProduct, Option<String>, Option<String>, String)> {
    let app_path = "/Applications/VMware Fusion.app";
    if !std::path::Path::new(app_path).exists() {
        return Err(VmwError::new(
            VmwErrorKind::UnsupportedPlatform,
            "VMware Fusion not found",
        ));
    }

    // Read Info.plist for version
    let plist_path = format!("{app_path}/Contents/Info.plist");
    let version = std::fs::read_to_string(&plist_path)
        .ok()
        .and_then(|content| {
            // Simple plist parsing for CFBundleShortVersionString
            let marker = "<key>CFBundleShortVersionString</key>";
            content.find(marker).and_then(|pos| {
                let after = &content[pos + marker.len()..];
                let start = after.find("<string>")? + 8;
                let end = after[start..].find("</string>")? + start;
                Some(after[start..end].to_string())
            })
        });

    let build = std::fs::read_to_string(&plist_path)
        .ok()
        .and_then(|content| {
            let marker = "<key>CFBundleVersion</key>";
            content.find(marker).and_then(|pos| {
                let after = &content[pos + marker.len()..];
                let start = after.find("<string>")? + 8;
                let end = after[start..].find("</string>")? + start;
                Some(after[start..end].to_string())
            })
        });

    // Determine Pro vs standard
    let is_pro = std::path::Path::new(&format!(
        "{app_path}/Contents/Library/vmware-vmx-stats"
    ))
    .exists();
    let product = if is_pro {
        VmwProduct::FusionPro
    } else {
        VmwProduct::Fusion
    };

    Ok((product, version, build, app_path.to_string()))
}

fn detect_linux() -> VmwResult<(VmwProduct, Option<String>, Option<String>, String)> {
    // Check for vmware binary
    let vmware_path = "/usr/bin/vmware";
    if !std::path::Path::new(vmware_path).exists() {
        // Try vmplayer
        let player_path = "/usr/bin/vmplayer";
        if std::path::Path::new(player_path).exists() {
            let version = read_vmware_version_linux();
            return Ok((VmwProduct::Player, version, None, "/usr/lib/vmware".to_string()));
        }
        return Err(VmwError::new(
            VmwErrorKind::UnsupportedPlatform,
            "No VMware desktop product found on Linux",
        ));
    }

    let version = read_vmware_version_linux();
    // Workstation vs Player: check for vmware binary (Workstation) vs vmplayer only
    let product = if std::path::Path::new("/usr/lib/vmware/bin/vmware-vmx-debug").exists() {
        VmwProduct::WorkstationPro
    } else {
        VmwProduct::Workstation
    };

    Ok((product, version, None, "/usr/lib/vmware".to_string()))
}

fn read_vmware_version_linux() -> Option<String> {
    // /etc/vmware/config contains version info
    std::fs::read_to_string("/etc/vmware/config")
        .ok()
        .and_then(|content| {
            for line in content.lines() {
                if let Some(v) = line.strip_prefix("player.product.version = ") {
                    return Some(v.trim_matches('"').to_string());
                }
                if let Some(v) = line.strip_prefix("product.version = ") {
                    return Some(v.trim_matches('"').to_string());
                }
            }
            None
        })
}

/// Read VMware application preferences.
pub fn read_preferences() -> VmwResult<VmwPreferences> {
    let prefs_path = if cfg!(target_os = "windows") {
        let appdata =
            std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".to_string());
        format!("{appdata}\\VMware\\preferences.ini")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string());
        format!("{home}/Library/Preferences/VMware Fusion/preferences")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        format!("{home}/.vmware/preferences")
    };

    let content = std::fs::read_to_string(&prefs_path).map_err(|e| {
        VmwError::new(
            VmwErrorKind::IoError,
            format!("Cannot read preferences at {prefs_path}: {e}"),
        )
    })?;

    let mut settings = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            let key = trimmed[..eq].trim().to_lowercase();
            let val = trimmed[eq + 1..].trim().trim_matches('"').to_string();
            settings.insert(key, val);
        }
    }

    Ok(VmwPreferences {
        default_vm_path: settings.get("prefvmx.defaultvmpath")
            .or_else(|| settings.get("prefsvmx.defaultvmpath"))
            .cloned(),
        auto_connect_usb: settings.get("usb.autoconnect")
            .map(|v| v == "TRUE" || v == "true" || v == "1"),
        hot_key_combo: settings.get("pref.hotkey.ctrl").cloned(),
        show_tray_icon: settings.get("pref.trayicon")
            .map(|v| v == "TRUE" || v == "true" || v == "1"),
        updates_check: settings.get("pref.vmplayer.updates.enabled")
            .or_else(|| settings.get("pref.updates.enabled"))
            .map(|v| v == "TRUE" || v == "true" || v == "1"),
        ceip_enabled: settings.get("telemetry.consent")
            .or_else(|| settings.get("telemetryceiplevel"))
            .map(|v| v == "1" || v == "TRUE" || v == "true"),
        shared_vms_path: settings.get("prefvmx.sharedpath").cloned(),
        ws_port: settings.get("wsport").and_then(|v| v.parse().ok()),
        raw: settings,
    })
}

/// Get the default VM storage directory.
pub fn get_default_vm_dir() -> String {
    if let Ok(prefs) = read_preferences() {
        if let Some(ref dir) = prefs.default_vm_path {
            return dir.clone();
        }
    }
    if cfg!(target_os = "windows") {
        let profile =
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        format!("{profile}\\Documents\\Virtual Machines")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string());
        format!("{home}/Virtual Machines.localized")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        format!("{home}/vmware")
    }
}

/// Update a preference value.
pub fn set_preference(key: &str, value: &str) -> VmwResult<()> {
    let prefs_path = if cfg!(target_os = "windows") {
        let appdata =
            std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".to_string());
        format!("{appdata}\\VMware\\preferences.ini")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string());
        format!("{home}/Library/Preferences/VMware Fusion/preferences")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        format!("{home}/.vmware/preferences")
    };

    let content = std::fs::read_to_string(&prefs_path).unwrap_or_default();
    let key_lower = key.to_lowercase();
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|l| {
            if let Some(eq) = l.find('=') {
                let lk = l[..eq].trim().to_lowercase();
                if lk == key_lower {
                    found = true;
                    return format!("{} = \"{}\"", l[..eq].trim(), value);
                }
            }
            l.to_string()
        })
        .collect();

    if !found {
        lines.push(format!("{key} = \"{value}\""));
    }

    let out = lines.join("\n");
    std::fs::write(&prefs_path, out).map_err(|e| VmwError::io(e))?;
    Ok(())
}
