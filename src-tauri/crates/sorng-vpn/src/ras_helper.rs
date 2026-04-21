//! Windows RAS (Remote Access Service) helper for VPN protocols.
//! Provides shared functions for PPTP, L2TP, IKEv2, and SSTP connections.

use crate::platform;

/// Create a Windows VPN connection entry via PowerShell.
#[cfg(windows)]
pub async fn create_ras_entry(
    entry_name: &str,
    server: &str,
    tunnel_type: &str, // "Pptp", "L2tp", "Ikev2", "Sstp"
) -> Result<(), String> {
    let binary = platform::resolve_binary("powershell")?;
    let script = format!(
        "Add-VpnConnection -Name '{}' -ServerAddress '{}' -TunnelType {} -Force -RememberCredential",
        entry_name, server, tunnel_type
    );
    let output = tokio::process::Command::new(binary)
        .args(["-NoProfile", "-Command", &script])
        .output()
        .await
        .map_err(|e| format!("PowerShell error: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create VPN entry: {}", stderr));
    }
    Ok(())
}

/// Connect a Windows VPN entry via rasdial.
#[cfg(windows)]
pub async fn rasdial_connect(
    entry_name: &str,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let binary = platform::resolve_binary("rasdial")?;
    let output = tokio::process::Command::new(binary)
        .args([entry_name, username, password])
        .output()
        .await
        .map_err(|e| format!("rasdial error: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rasdial failed: {}", stderr));
    }
    Ok(())
}

/// Disconnect a Windows VPN entry via rasdial.
#[cfg(windows)]
pub async fn rasdial_disconnect(entry_name: &str) -> Result<(), String> {
    let binary = platform::resolve_binary("rasdial")?;
    let output = tokio::process::Command::new(binary)
        .args([entry_name, "/disconnect"])
        .output()
        .await
        .map_err(|e| format!("rasdial disconnect error: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rasdial disconnect failed: {}", stderr));
    }
    Ok(())
}

/// Remove a Windows VPN connection entry.
#[cfg(windows)]
pub async fn remove_ras_entry(entry_name: &str) -> Result<(), String> {
    let binary = platform::resolve_binary("powershell")?;
    let script = format!("Remove-VpnConnection -Name '{}' -Force", entry_name);
    let output = tokio::process::Command::new(binary)
        .args(["-NoProfile", "-Command", &script])
        .output()
        .await
        .map_err(|e| format!("PowerShell error: {}", e))?;
    if !output.status.success() {
        // Ignore errors on cleanup
        log::warn!(
            "Failed to remove VPN entry: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

/// Get the IP address of a connected Windows VPN entry.
#[cfg(windows)]
pub async fn get_vpn_ip(entry_name: &str) -> Result<Option<String>, String> {
    let binary = platform::resolve_binary("powershell")?;
    let script = format!(
        "(Get-VpnConnection -Name '{}').ServerAddress",
        entry_name
    );
    let output = tokio::process::Command::new(binary)
        .args(["-NoProfile", "-Command", &script])
        .output()
        .await
        .map_err(|e| format!("PowerShell error: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok(None)
    } else {
        Ok(Some(stdout))
    }
}

// Linux/macOS stubs (these protocols primarily target Windows)
#[cfg(not(windows))]
pub async fn create_ras_entry(_: &str, _: &str, _: &str) -> Result<(), String> {
    Err("RAS API is Windows-only. Use protocol-specific Linux tools.".to_string())
}
#[cfg(not(windows))]
pub async fn rasdial_connect(_: &str, _: &str, _: &str) -> Result<(), String> {
    Err("rasdial is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn rasdial_disconnect(_: &str) -> Result<(), String> {
    Err("rasdial is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn remove_ras_entry(_: &str) -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub async fn get_vpn_ip(_: &str) -> Result<Option<String>, String> {
    Ok(None)
}
