// ── cPanel FTP account management ────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct FtpManager;

impl FtpManager {
    /// List FTP accounts for a user.
    pub async fn list_accounts(client: &CpanelClient, user: &str) -> CpanelResult<Vec<FtpAccount>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Ftp", "list_ftp_with_disk", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create an FTP account.
    pub async fn create_account(
        client: &CpanelClient,
        user: &str,
        req: &CreateFtpRequest,
    ) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![("user", &req.user), ("pass", &req.password)];
        let quota_str;
        if let Some(q) = req.quota {
            quota_str = q.to_string();
            params.push(("quota", &quota_str));
        }
        let homedir;
        if let Some(ref h) = req.homedir {
            homedir = h.clone();
            params.push(("homedir", &homedir));
        }

        let raw: serde_json::Value = client.whm_uapi(user, "Ftp", "add_ftp", &params).await?;
        check_uapi(&raw)?;
        Ok(format!("FTP account {} created", req.user))
    }

    /// Delete an FTP account.
    pub async fn delete_account(
        client: &CpanelClient,
        user: &str,
        ftp_user: &str,
        destroy: bool,
    ) -> CpanelResult<String> {
        let destroy_str = if destroy { "1" } else { "0" };
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Ftp",
                "delete_ftp",
                &[("user", ftp_user), ("destroy", destroy_str)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("FTP account {ftp_user} deleted"))
    }

    /// Change FTP account password.
    pub async fn change_password(
        client: &CpanelClient,
        user: &str,
        ftp_user: &str,
        password: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Ftp",
                "passwd",
                &[("user", ftp_user), ("pass", password)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("FTP password changed for {ftp_user}"))
    }

    /// Set FTP account quota.
    pub async fn set_quota(
        client: &CpanelClient,
        user: &str,
        ftp_user: &str,
        quota_mb: u64,
    ) -> CpanelResult<String> {
        let quota_str = quota_mb.to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Ftp",
                "setquota",
                &[("user", ftp_user), ("quota", &quota_str)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("FTP quota set to {quota_mb}MB for {ftp_user}"))
    }

    /// List active FTP sessions (WHM).
    pub async fn list_sessions(client: &CpanelClient) -> CpanelResult<Vec<FtpSession>> {
        let raw: serde_json::Value = client.whm_api_raw("ftplist", &[]).await?;
        let data = raw
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Kill an FTP session (WHM).
    pub async fn kill_session(client: &CpanelClient, pid: u32) -> CpanelResult<String> {
        let pid_str = pid.to_string();
        let raw: serde_json::Value = client.whm_api_raw("killftp", &[("pid", &pid_str)]).await?;
        check_whm(&raw)?;
        Ok(format!("FTP session {pid} killed"))
    }

    /// Get FTP server configuration (WHM).
    pub async fn get_config(client: &CpanelClient) -> CpanelResult<FtpConfig> {
        let raw: serde_json::Value = client.whm_api_raw("get_ftp_config", &[]).await?;
        let data = raw.get("data").cloned().unwrap_or_default();
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Configure anonymous FTP (WHM).
    pub async fn set_anonymous_ftp(client: &CpanelClient, enabled: bool) -> CpanelResult<String> {
        let val = if enabled { "1" } else { "0" };
        let raw: serde_json::Value = client
            .whm_api_raw("set_ftp_config", &[("anon", val)])
            .await?;
        check_whm(&raw)?;
        Ok(format!(
            "Anonymous FTP {}",
            if enabled { "enabled" } else { "disabled" }
        ))
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
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
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
