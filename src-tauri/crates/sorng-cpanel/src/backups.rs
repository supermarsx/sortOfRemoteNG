// ── cPanel backup management ─────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    /// List available backups for a user.
    pub async fn list_backups(client: &CpanelClient, user: &str) -> CpanelResult<Vec<BackupInfo>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Backup", "list_backups", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Trigger a full backup for a user account.
    pub async fn create_full_backup(
        client: &CpanelClient,
        user: &str,
        dest: Option<&str>,
        email_notify: Option<&str>,
    ) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![];
        if let Some(d) = dest {
            params.push(("dest", d));
        }
        if let Some(e) = email_notify {
            params.push(("email", e));
        }
        let raw: serde_json::Value = client
            .whm_uapi(user, "Backup", "fullbackup_to_homedir", &params)
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Full backup initiated for {user}"))
    }

    /// Restore a file/directory backup.
    pub async fn restore_file(client: &CpanelClient, user: &str, backup_id: &str, path: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Backup",
                "restore_files",
                &[("backup", backup_id), ("path", path)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("File restore initiated: {path}"))
    }

    /// Restore email for a user.
    pub async fn restore_email(client: &CpanelClient, user: &str, backup_id: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Backup",
                "restore_email_filters",
                &[("backup", backup_id)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Email restore initiated for {user}"))
    }

    /// Restore a MySQL database from backup.
    pub async fn restore_mysql(client: &CpanelClient, user: &str, backup_id: &str, db: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Backup",
                "restore_databases",
                &[("backup", backup_id), ("db", db)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("MySQL database {db} restore initiated"))
    }

    // ── WHM-level backup management ──────────────────────────────────

    /// Get server backup configuration (WHM).
    pub async fn get_backup_config(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("backup_config_get", &[]).await
    }

    /// Set server backup configuration (WHM).
    pub async fn set_backup_config(client: &CpanelClient, config: &serde_json::Value) -> CpanelResult<String> {
        let config_str = config.to_string();
        let raw: serde_json::Value = client
            .post_form(
                &format!("{}/json-api/backup_config_set?api.version=1", whm_base(client)),
                &[("config", &config_str)],
            )
            .await?;
        check_whm(&raw)?;
        Ok("Backup configuration updated".into())
    }

    /// List backup destinations (WHM).
    pub async fn list_destinations(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("backup_destination_list", &[]).await
    }

    /// Trigger a server backup now (WHM).
    pub async fn trigger_server_backup(client: &CpanelClient) -> CpanelResult<String> {
        let raw: serde_json::Value = client.whm_api_raw("backup_set_list", &[]).await?;
        check_whm(&raw)?;
        Ok("Server backup triggered".into())
    }

    /// Get backup restore queue status (WHM).
    pub async fn get_restore_queue(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("backup_restore_queue", &[]).await
    }
}

fn whm_base(client: &CpanelClient) -> String {
    let scheme = if client.config.use_tls.unwrap_or(true) { "https" } else { "http" };
    let port = client.config.whm_port.unwrap_or(2087);
    format!("{scheme}://{}:{port}", client.config.host)
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
