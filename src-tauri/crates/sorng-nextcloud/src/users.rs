// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · users
// ──────────────────────────────────────────────────────────────────────────────
// OCS Provisioning API – user information, capabilities, quota, status,
// external storages, notifications.
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::types::*;

// ── Current User ─────────────────────────────────────────────────────────────

/// Get info about the currently authenticated user.
pub async fn get_current_user(client: &NextcloudClient) -> Result<UserInfo, String> {
    let resp: OcsResponse<UserInfo> = client
        .ocs_get("ocs/v2.php/cloud/user?format=json")
        .await?;
    Ok(resp.ocs.data)
}

/// Get the current user's quota information.
pub async fn get_quota(client: &NextcloudClient) -> Result<UserQuota, String> {
    let user = get_current_user(client).await?;
    user.quota
        .ok_or_else(|| "quota information not available".to_string())
}

/// Get info about a specific user by id (requires admin privileges).
pub async fn get_user(client: &NextcloudClient, user_id: &str) -> Result<UserInfo, String> {
    let url = format!(
        "ocs/v2.php/cloud/users/{}?format=json",
        url::form_urlencoded::byte_serialize(user_id.as_bytes()).collect::<String>()
    );
    let resp: OcsResponse<UserInfo> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// List all users (requires admin privileges). Returns user IDs.
pub async fn list_users(
    client: &NextcloudClient,
    search: Option<&str>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<String>, String> {
    let mut url = "ocs/v2.php/cloud/users?format=json".to_string();
    if let Some(s) = search {
        url.push_str(&format!(
            "&search={}",
            url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
        ));
    }
    if let Some(l) = limit {
        url.push_str(&format!("&limit={}", l));
    }
    if let Some(o) = offset {
        url.push_str(&format!("&offset={}", o));
    }

    #[derive(serde::Deserialize)]
    struct UsersData {
        users: Vec<String>,
    }

    let resp: OcsResponse<UsersData> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data.users)
}

/// List all groups (requires admin privileges).
pub async fn list_groups(
    client: &NextcloudClient,
    search: Option<&str>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<String>, String> {
    let mut url = "ocs/v2.php/cloud/groups?format=json".to_string();
    if let Some(s) = search {
        url.push_str(&format!(
            "&search={}",
            url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
        ));
    }
    if let Some(l) = limit {
        url.push_str(&format!("&limit={}", l));
    }
    if let Some(o) = offset {
        url.push_str(&format!("&offset={}", o));
    }

    #[derive(serde::Deserialize)]
    struct GroupsData {
        groups: Vec<String>,
    }

    let resp: OcsResponse<GroupsData> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data.groups)
}

// ── Server Capabilities ──────────────────────────────────────────────────────

/// Fetch server capabilities.
pub async fn get_capabilities(
    client: &NextcloudClient,
) -> Result<ServerCapabilities, String> {
    let resp: OcsResponse<ServerCapabilities> = client
        .ocs_get("ocs/v1.php/cloud/capabilities?format=json")
        .await?;
    Ok(resp.ocs.data)
}

/// Check whether a specific capability exists.
pub fn has_capability(caps: &ServerCapabilities, path: &str) -> bool {
    if let Some(ref c) = caps.capabilities {
        let mut current = &c.0;
        for key in path.split('.') {
            match current.get(key) {
                Some(v) => current = v,
                None => return false,
            }
        }
        true
    } else {
        false
    }
}

/// Extract a capability value as a string.
pub fn capability_str(caps: &ServerCapabilities, path: &str) -> Option<String> {
    if let Some(ref c) = caps.capabilities {
        let mut current = &c.0;
        for key in path.split('.') {
            match current.get(key) {
                Some(v) => current = v,
                None => return None,
            }
        }
        current.as_str().map(|s| s.to_string())
    } else {
        None
    }
}

// ── Server Status ────────────────────────────────────────────────────────────

/// Fetch server status from /status.php (no authentication required).
pub async fn get_server_status(base_url: &str) -> Result<ServerStatus, String> {
    let url = format!("{}/status.php", base_url.trim_end_matches('/'));
    let http = reqwest::Client::new();
    let resp = http
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("status.php: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("status.php {} → {}: {}", url, status, text));
    }

    resp.json::<ServerStatus>()
        .await
        .map_err(|e| format!("parse status.php: {}", e))
}

/// Check if the server is in maintenance mode.
pub async fn is_in_maintenance(base_url: &str) -> Result<bool, String> {
    let status = get_server_status(base_url).await?;
    Ok(status.maintenance)
}

// ── Notifications ────────────────────────────────────────────────────────────

/// List all notifications for the current user.
pub async fn list_notifications(
    client: &NextcloudClient,
) -> Result<Vec<Notification>, String> {
    let resp: OcsResponse<Vec<Notification>> = client
        .ocs_get("ocs/v2.php/apps/notifications/api/v2/notifications?format=json")
        .await?;
    Ok(resp.ocs.data)
}

/// Get a single notification by id.
pub async fn get_notification(
    client: &NextcloudClient,
    notification_id: u64,
) -> Result<Notification, String> {
    let url = format!(
        "ocs/v2.php/apps/notifications/api/v2/notifications/{}?format=json",
        notification_id
    );
    let resp: OcsResponse<Notification> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// Delete (dismiss) a notification.
pub async fn delete_notification(
    client: &NextcloudClient,
    notification_id: u64,
) -> Result<(), String> {
    let url = format!(
        "ocs/v2.php/apps/notifications/api/v2/notifications/{}?format=json",
        notification_id
    );
    let _: OcsResponse<serde_json::Value> = client.ocs_delete(&url).await?;
    Ok(())
}

/// Delete (dismiss) all notifications.
pub async fn delete_all_notifications(client: &NextcloudClient) -> Result<(), String> {
    let _: OcsResponse<serde_json::Value> = client
        .ocs_delete("ocs/v2.php/apps/notifications/api/v2/notifications?format=json")
        .await?;
    Ok(())
}

// ── External Storages ────────────────────────────────────────────────────────

/// List external storages visible to the current user.
pub async fn list_external_storages(
    client: &NextcloudClient,
) -> Result<Vec<ExternalStorage>, String> {
    let resp: OcsResponse<Vec<ExternalStorage>> = client
        .ocs_get("ocs/v2.php/apps/files_external/api/v1/mounts?format=json")
        .await?;
    Ok(resp.ocs.data)
}

// ── User avatar ──────────────────────────────────────────────────────────────

/// Get the URL for a user's avatar.
pub fn avatar_url(base_url: &str, user_id: &str, size: u32) -> String {
    format!(
        "{}/avatar/{}/{}",
        base_url.trim_end_matches('/'),
        url::form_urlencoded::byte_serialize(user_id.as_bytes()).collect::<String>(),
        size
    )
}

/// Download a user's avatar. Returns raw image bytes.
pub async fn get_avatar(
    client: &NextcloudClient,
    user_id: &str,
    size: u32,
) -> Result<Vec<u8>, String> {
    let url = avatar_url(client.base_url(), user_id, size);
    client.plain_get_bytes(&url).await
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Format bytes into a human-readable string.
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB", "PB"];
    let mut size = bytes as f64;
    let mut unit_idx = 0;
    while size >= 1024.0 && unit_idx < UNITS.len() - 1 {
        size /= 1024.0;
        unit_idx += 1;
    }
    if unit_idx == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{:.1} {}", size, UNITS[unit_idx])
    }
}

/// Format quota as a human-readable string like "1.2 GB / 5.0 GB (24.0%)".
pub fn format_quota(quota: &UserQuota) -> String {
    let used = quota.used.unwrap_or(0);
    let total = quota.total.unwrap_or(0);
    let pct = quota.relative.unwrap_or(0.0);

    if total <= 0 {
        format!("{} used (unlimited)", format_bytes(used as u64))
    } else {
        format!(
            "{} / {} ({:.1}%)",
            format_bytes(used as u64),
            format_bytes(total as u64),
            pct
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_bytes_values() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1048576), "1.0 MB");
        assert_eq!(format_bytes(1073741824), "1.0 GB");
    }

    #[test]
    fn format_quota_normal() {
        let q = UserQuota {
            free: Some(3 * 1024 * 1024 * 1024),
            used: Some(2 * 1024 * 1024 * 1024),
            total: Some(5 * 1024 * 1024 * 1024),
            relative: Some(40.0),
            quota: None,
        };
        let s = format_quota(&q);
        assert!(s.contains("2.0 GB"));
        assert!(s.contains("5.0 GB"));
        assert!(s.contains("40.0%"));
    }

    #[test]
    fn format_quota_unlimited() {
        let q = UserQuota {
            free: None,
            used: Some(100),
            total: Some(0),
            relative: None,
            quota: None,
        };
        let s = format_quota(&q);
        assert!(s.contains("unlimited"));
    }

    #[test]
    fn avatar_url_format() {
        let url = avatar_url("https://nc.test", "alice", 64);
        assert_eq!(url, "https://nc.test/avatar/alice/64");
    }

    #[test]
    fn avatar_url_encodes_username() {
        let url = avatar_url("https://nc.test", "user name", 32);
        assert!(url.contains("user+name"));
    }

    #[test]
    fn has_capability_nested() {
        let caps = ServerCapabilities {
            version: None,
            capabilities: Some(CapabilitiesMap(serde_json::json!({
                "files": {
                    "bigfilechunking": true,
                    "versioning": true
                }
            }))),
        };
        assert!(has_capability(&caps, "files.bigfilechunking"));
        assert!(has_capability(&caps, "files.versioning"));
        assert!(!has_capability(&caps, "files.nonexistent"));
        assert!(!has_capability(&caps, "missing"));
    }

    #[test]
    fn has_capability_none() {
        let caps = ServerCapabilities {
            version: None,
            capabilities: None,
        };
        assert!(!has_capability(&caps, "anything"));
    }

    #[test]
    fn capability_str_value() {
        let caps = ServerCapabilities {
            version: None,
            capabilities: Some(CapabilitiesMap(serde_json::json!({
                "theming": {
                    "name": "Nextcloud"
                }
            }))),
        };
        assert_eq!(
            capability_str(&caps, "theming.name"),
            Some("Nextcloud".to_string())
        );
        assert_eq!(capability_str(&caps, "theming.missing"), None);
    }
}
