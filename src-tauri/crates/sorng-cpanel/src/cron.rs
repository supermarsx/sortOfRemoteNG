// ── cPanel cron job management ───────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct CronManager;

impl CronManager {
    /// List cron jobs for a user.
    pub async fn list(client: &CpanelClient, user: &str) -> CpanelResult<Vec<CronJob>> {
        let raw: serde_json::Value = client.whm_uapi(user, "CronJob", "list_cron", &[]).await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Add a cron job.
    pub async fn add(
        client: &CpanelClient,
        user: &str,
        req: &CreateCronRequest,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "CronJob",
                "add_line",
                &[
                    ("command", &req.command),
                    ("minute", &req.minute),
                    ("hour", &req.hour),
                    ("day", &req.day),
                    ("month", &req.month),
                    ("weekday", &req.weekday),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Cron job added: {}", req.command))
    }

    /// Edit a cron job by line key.
    pub async fn edit(
        client: &CpanelClient,
        user: &str,
        linekey: &str,
        req: &CreateCronRequest,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "CronJob",
                "edit_line",
                &[
                    ("linekey", linekey),
                    ("command", &req.command),
                    ("minute", &req.minute),
                    ("hour", &req.hour),
                    ("day", &req.day),
                    ("month", &req.month),
                    ("weekday", &req.weekday),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Cron job {linekey} updated"))
    }

    /// Delete a cron job by line key.
    pub async fn delete(client: &CpanelClient, user: &str, linekey: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "CronJob", "delete_line", &[("linekey", linekey)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Cron job {linekey} deleted"))
    }

    /// Get the cron notification email.
    pub async fn get_email(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client.whm_uapi(user, "CronJob", "get_email", &[]).await?;
        let data = extract_data(&raw)?;
        Ok(data
            .get("email")
            .and_then(|e| e.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// Set the cron notification email.
    pub async fn set_email(client: &CpanelClient, user: &str, email: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "CronJob", "set_email", &[("email", email)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Cron email set to {email}"))
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
