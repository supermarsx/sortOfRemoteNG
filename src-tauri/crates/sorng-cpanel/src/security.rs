// ── cPanel security management ───────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct SecurityManager;

impl SecurityManager {
    // ── IP Block ─────────────────────────────────────────────────────

    /// List blocked IPs.
    pub async fn list_blocked_ips(client: &CpanelClient, user: &str) -> CpanelResult<Vec<IpBlockRule>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "BlockIP", "list_ips", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Block an IP address.
    pub async fn block_ip(client: &CpanelClient, user: &str, ip: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "BlockIP", "add_ip", &[("ip", ip)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("IP {ip} blocked"))
    }

    /// Unblock an IP address.
    pub async fn unblock_ip(client: &CpanelClient, user: &str, ip: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "BlockIP", "remove_ip", &[("ip", ip)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("IP {ip} unblocked"))
    }

    // ── Hotlink Protection ───────────────────────────────────────────

    /// Get hotlink protection settings.
    pub async fn get_hotlink_protection(client: &CpanelClient, user: &str) -> CpanelResult<HotlinkProtection> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "HotlinkProtection", "get", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Enable hotlink protection.
    pub async fn enable_hotlink(client: &CpanelClient, user: &str, urls: &[&str], extensions: &[&str]) -> CpanelResult<String> {
        let urls_str = urls.join(",");
        let ext_str = extensions.join(",");
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "HotlinkProtection",
                "enable",
                &[("urls", &urls_str), ("extensions", &ext_str)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok("Hotlink protection enabled".into())
    }

    /// Disable hotlink protection.
    pub async fn disable_hotlink(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "HotlinkProtection", "disable", &[])
            .await?;
        check_uapi(&raw)?;
        Ok("Hotlink protection disabled".into())
    }

    // ── Password-protected directories ───────────────────────────────

    /// List password-protected directories.
    pub async fn list_protected_dirs(client: &CpanelClient, user: &str) -> CpanelResult<Vec<PasswordProtectedDirectory>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "DirectoryPrivacy", "list_directories", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Protect a directory with a password.
    pub async fn protect_directory(client: &CpanelClient, user: &str, dir: &str, auth_name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "DirectoryPrivacy",
                "configure_directory_protection",
                &[("dir", dir), ("authname", auth_name), ("enabled", "1")],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Directory {dir} protected"))
    }

    /// Add a user to a protected directory.
    pub async fn add_dir_user(
        client: &CpanelClient,
        user: &str,
        dir: &str,
        dir_user: &str,
        password: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "DirectoryPrivacy",
                "add_user",
                &[("dir", dir), ("user", dir_user), ("password", password)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("User {dir_user} added to protected directory {dir}"))
    }

    /// Remove a user from a protected directory.
    pub async fn remove_dir_user(client: &CpanelClient, user: &str, dir: &str, dir_user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "DirectoryPrivacy",
                "delete_user",
                &[("dir", dir), ("user", dir_user)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("User {dir_user} removed from protected directory {dir}"))
    }

    // ── SSH keys ─────────────────────────────────────────────────────

    /// List SSH keys for a user.
    pub async fn list_ssh_keys(client: &CpanelClient, user: &str) -> CpanelResult<Vec<SshKey>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSH", "list_keys", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Import an SSH key.
    pub async fn import_ssh_key(client: &CpanelClient, user: &str, name: &str, key: &str, key_type: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "SSH",
                "import_key",
                &[("name", name), ("key", key), ("type", key_type)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("SSH key {name} imported"))
    }

    /// Delete an SSH key.
    pub async fn delete_ssh_key(client: &CpanelClient, user: &str, name: &str, key_type: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "SSH",
                "delete_key",
                &[("name", name), ("type", key_type)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("SSH key {name} deleted"))
    }

    /// Authorize an SSH key.
    pub async fn authorize_ssh_key(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSH", "authkey", &[("name", name), ("authorize", "1")])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("SSH key {name} authorized"))
    }

    /// Deauthorize an SSH key.
    pub async fn deauthorize_ssh_key(client: &CpanelClient, user: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSH", "authkey", &[("name", name), ("authorize", "0")])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("SSH key {name} deauthorized"))
    }

    // ── Two-Factor Authentication ────────────────────────────────────

    /// Get 2FA status for a user.
    pub async fn get_2fa_status(client: &CpanelClient, user: &str) -> CpanelResult<TwoFactorAuth> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "TwoFactorAuth", "get_user_configuration", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    // ── ModSecurity ──────────────────────────────────────────────────

    /// Get ModSecurity status for a domain (WHM).
    pub async fn get_modsec_status(client: &CpanelClient, domain: &str) -> CpanelResult<bool> {
        let raw: serde_json::Value = client
            .whm_api_raw("modsec_get_domain_setting", &[("domain", domain)])
            .await?;
        Ok(raw
            .get("data")
            .and_then(|d| d.get("enabled"))
            .and_then(|e| e.as_bool())
            .unwrap_or(false))
    }

    /// Enable/disable ModSecurity for a domain (WHM).
    pub async fn set_modsec(client: &CpanelClient, domain: &str, enabled: bool) -> CpanelResult<String> {
        let val = if enabled { "1" } else { "0" };
        let raw: serde_json::Value = client
            .whm_api_raw("modsec_set_domain_setting", &[("domain", domain), ("enabled", val)])
            .await?;
        check_whm(&raw)?;
        Ok(format!(
            "ModSecurity {} for {domain}",
            if enabled { "enabled" } else { "disabled" }
        ))
    }

    // ── cPHulk brute-force protection (WHM) ──────────────────────────

    /// Get cPHulk status.
    pub async fn get_cphulk_status(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("cphulk_status", &[]).await
    }

    /// Flush cPHulk blocked IPs.
    pub async fn flush_cphulk(client: &CpanelClient) -> CpanelResult<String> {
        let raw: serde_json::Value = client.whm_api_raw("cphulk_flush", &[]).await?;
        check_whm(&raw)?;
        Ok("cPHulk blocklist flushed".into())
    }

    // ── Leech protection ─────────────────────────────────────────────

    /// Get leech protection settings for a directory.
    pub async fn get_leech_protection(client: &CpanelClient, user: &str, dir: &str) -> CpanelResult<LeechProtection> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "LeechProtect", "get", &[("dir", dir)])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Enable leech protection.
    pub async fn enable_leech(client: &CpanelClient, user: &str, dir: &str, max_logins: u32) -> CpanelResult<String> {
        let max_str = max_logins.to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "LeechProtect",
                "enable",
                &[("dir", dir), ("numlogins", &max_str)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Leech protection enabled for {dir}"))
    }

    /// Disable leech protection.
    pub async fn disable_leech(client: &CpanelClient, user: &str, dir: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "LeechProtect", "disable", &[("dir", dir)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Leech protection disabled for {dir}"))
    }

    // ── SSL Redirect ─────────────────────────────────────────────────

    /// Check if HTTPS redirect is enabled for a domain.
    pub async fn get_ssl_redirect(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<bool> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "is_https_redirect_enabled", &[("domain", domain)])
            .await?;
        let data = extract_data(&raw)?;
        Ok(data.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false))
    }

    /// Enable HTTPS redirect for a domain.
    pub async fn enable_ssl_redirect(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "toggle_ssl_redirect_for_domains", &[("domain", domain), ("state", "1")])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("HTTPS redirect enabled for {domain}"))
    }

    /// Disable HTTPS redirect for a domain.
    pub async fn disable_ssl_redirect(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "toggle_ssl_redirect_for_domains", &[("domain", domain), ("state", "0")])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("HTTPS redirect disabled for {domain}"))
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "))
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}

fn check_whm(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("metadata")
        .and_then(|m| m.get("result"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let msg = raw
            .get("metadata")
            .and_then(|m| m.get("reason"))
            .and_then(|r| r.as_str())
            .unwrap_or("WHM API call failed");
        return Err(CpanelError::api(msg));
    }
    Ok(())
}
