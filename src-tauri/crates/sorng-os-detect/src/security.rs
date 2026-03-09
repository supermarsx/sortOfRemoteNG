//! Security subsystem detection — SELinux, AppArmor, firewall, capabilities.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect SELinux status and mode.
pub async fn detect_selinux(host: &OsDetectHost) -> Result<(bool, Option<String>), OsDetectError> {
    // Try getenforce
    let getenforce = client::exec_soft(host, "getenforce", &[]).await;
    let mode = getenforce.trim().to_lowercase();
    if !mode.is_empty() && mode != "command not found" {
        let enabled = mode != "disabled";
        return Ok((enabled, Some(getenforce.trim().to_string())));
    }

    // Try sestatus
    let sestatus = client::exec_soft(host, "sestatus", &[]).await;
    if !sestatus.is_empty() {
        let mut enabled = false;
        let mut mode_str = None;
        for line in sestatus.lines() {
            let line = line.trim().to_lowercase();
            if line.starts_with("selinux status:") {
                enabled = line.contains("enabled");
            } else if line.starts_with("current mode:") {
                mode_str = line.split(':').next_back().map(|s| s.trim().to_string());
            }
        }
        return Ok((enabled, mode_str));
    }

    // Check /sys/fs/selinux
    let selinux_fs = client::shell_exec(host, "test -d /sys/fs/selinux && echo yes").await;
    if selinux_fs.trim() == "yes" {
        let enforce = client::shell_exec(host, "cat /sys/fs/selinux/enforce 2>/dev/null").await;
        let mode = match enforce.trim() {
            "1" => "Enforcing",
            "0" => "Permissive",
            _ => "Unknown",
        };
        return Ok((true, Some(mode.to_string())));
    }

    Ok((false, None))
}

/// Detect AppArmor status.
pub async fn detect_apparmor(host: &OsDetectHost) -> Result<bool, OsDetectError> {
    // aa-status
    let aa = client::exec_soft(host, "aa-status", &["--enabled"]).await;
    if aa.trim() == "Yes" {
        return Ok(true);
    }

    // Check /sys/kernel/security/apparmor
    let apparmor_fs =
        client::shell_exec(host, "test -d /sys/kernel/security/apparmor && echo yes").await;
    if apparmor_fs.trim() == "yes" {
        return Ok(true);
    }

    // Check /sys/module/apparmor
    let module = client::shell_exec(host, "test -d /sys/module/apparmor && echo yes").await;
    Ok(module.trim() == "yes")
}

/// Detect the active firewall backend.
pub async fn detect_firewall(host: &OsDetectHost) -> Result<Option<String>, OsDetectError> {
    // firewalld
    let firewalld = client::shell_exec(host, "systemctl is-active firewalld 2>/dev/null").await;
    if firewalld.trim() == "active" {
        return Ok(Some("firewalld".to_string()));
    }

    // ufw
    let ufw = client::exec_soft(host, "ufw", &["status"]).await;
    if ufw.contains("Status: active") {
        return Ok(Some("ufw".to_string()));
    }

    // nftables
    let nft = client::shell_exec(host, "nft list ruleset 2>/dev/null | head -1").await;
    if !nft.is_empty() && !nft.contains("command not found") {
        return Ok(Some("nftables".to_string()));
    }

    // iptables
    let ipt = client::shell_exec(host, "iptables -L -n 2>/dev/null | head -1").await;
    if !ipt.is_empty() && !ipt.contains("command not found") {
        return Ok(Some("iptables".to_string()));
    }

    // pf (BSD)
    let pf = client::shell_exec(host, "pfctl -s info 2>/dev/null | head -1").await;
    if !pf.is_empty() && !pf.contains("command not found") {
        return Ok(Some("pf".to_string()));
    }

    // Windows Firewall
    let win_fw = client::shell_exec(host, "netsh advfirewall show allprofiles state 2>nul").await;
    if win_fw.contains("ON") {
        return Ok(Some("windows_fw".to_string()));
    }

    Ok(None)
}

/// Detect Linux capabilities of the current process.
pub async fn detect_capabilities(host: &OsDetectHost) -> Result<Vec<String>, OsDetectError> {
    // Try capsh
    let capsh = client::exec_soft(host, "capsh", &["--print"]).await;
    if !capsh.is_empty() {
        let mut caps = Vec::new();
        for line in capsh.lines() {
            if let Some(rest) = line.strip_prefix("Current:") {
                for cap in rest.trim().split(',') {
                    let cap = cap.trim();
                    if !cap.is_empty() && cap != "=" {
                        caps.push(cap.to_string());
                    }
                }
            }
        }
        if !caps.is_empty() {
            return Ok(caps);
        }
    }

    // Fallback: parse /proc/self/status CapEff
    let status = client::shell_exec(host, "grep '^Cap' /proc/self/status 2>/dev/null").await;
    let mut caps = Vec::new();
    for line in status.lines() {
        let line = line.trim();
        if !line.is_empty() {
            caps.push(line.to_string());
        }
    }
    Ok(caps)
}

/// Build a full SecurityInfo struct.
pub async fn detect_security_info(host: &OsDetectHost) -> Result<SecurityInfo, OsDetectError> {
    let (selinux_enabled, selinux_mode) = detect_selinux(host).await.unwrap_or((false, None));
    let apparmor_enabled = detect_apparmor(host).await.unwrap_or(false);
    let firewall_backend = detect_firewall(host).await.unwrap_or(None);
    let capabilities = detect_capabilities(host).await.unwrap_or_default();

    Ok(SecurityInfo {
        selinux_enabled,
        selinux_mode,
        apparmor_enabled,
        firewall_backend,
        capabilities,
    })
}
