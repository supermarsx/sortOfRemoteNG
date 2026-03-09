// ── cPanel email management ──────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct EmailManager;

impl EmailManager {
    /// List email accounts for a user.
    pub async fn list_accounts(
        client: &CpanelClient,
        user: &str,
    ) -> CpanelResult<Vec<EmailAccount>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_pops_with_disk", &[])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create an email account.
    pub async fn create_account(
        client: &CpanelClient,
        user: &str,
        req: &CreateEmailRequest,
    ) -> CpanelResult<String> {
        let parts: Vec<&str> = req.email.splitn(2, '@').collect();
        if parts.len() != 2 {
            return Err(CpanelError::invalid_request("Invalid email format"));
        }
        let quota_str = req.quota.unwrap_or(0).to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "add_pop",
                &[
                    ("email", parts[0]),
                    ("password", &req.password),
                    ("quota", &quota_str),
                    ("domain", parts[1]),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Email account {} created", req.email))
    }

    /// Delete an email account.
    pub async fn delete_account(
        client: &CpanelClient,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        let parts: Vec<&str> = email.splitn(2, '@').collect();
        if parts.len() != 2 {
            return Err(CpanelError::invalid_request("Invalid email format"));
        }
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "delete_pop",
                &[("email", parts[0]), ("domain", parts[1])],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Email account {email} deleted"))
    }

    /// Change email password.
    pub async fn change_password(
        client: &CpanelClient,
        user: &str,
        email: &str,
        password: &str,
    ) -> CpanelResult<String> {
        let parts: Vec<&str> = email.splitn(2, '@').collect();
        if parts.len() != 2 {
            return Err(CpanelError::invalid_request("Invalid email format"));
        }
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "passwd_pop",
                &[
                    ("email", parts[0]),
                    ("password", password),
                    ("domain", parts[1]),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Password changed for {email}"))
    }

    /// Set email quota.
    pub async fn set_quota(
        client: &CpanelClient,
        user: &str,
        email: &str,
        quota_mb: u64,
    ) -> CpanelResult<String> {
        let parts: Vec<&str> = email.splitn(2, '@').collect();
        if parts.len() != 2 {
            return Err(CpanelError::invalid_request("Invalid email format"));
        }
        let quota_str = quota_mb.to_string();
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "edit_pop_quota",
                &[
                    ("email", parts[0]),
                    ("domain", parts[1]),
                    ("quota", &quota_str),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Quota set to {quota_mb}MB for {email}"))
    }

    /// List email forwarders.
    pub async fn list_forwarders(
        client: &CpanelClient,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<EmailForwarder>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_forwarders", &[("domain", domain)])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Add an email forwarder.
    pub async fn add_forwarder(
        client: &CpanelClient,
        user: &str,
        domain: &str,
        email: &str,
        fwdopt: &str,
        fwdemail: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "add_forwarder",
                &[
                    ("domain", domain),
                    ("email", email),
                    ("fwdopt", fwdopt),
                    ("fwdemail", fwdemail),
                ],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Forwarder added for {email}@{domain}"))
    }

    /// Delete a forwarder.
    pub async fn delete_forwarder(
        client: &CpanelClient,
        user: &str,
        address: &str,
        dest: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Email",
                "delete_forwarder",
                &[("address", address), ("forwarder", dest)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Forwarder deleted: {address} -> {dest}"))
    }

    /// List autoresponders.
    pub async fn list_autoresponders(
        client: &CpanelClient,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<EmailAutoresponder>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_auto_responders", &[("domain", domain)])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// List mailing lists for a domain.
    pub async fn list_mailing_lists(
        client: &CpanelClient,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<MailingList>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_lists", &[("domain", domain)])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get spam filter settings.
    pub async fn get_spam_settings(
        client: &CpanelClient,
        user: &str,
    ) -> CpanelResult<SpamFilterSettings> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SpamAssassin", "get_user_preferences", &[])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Enable SpamAssassin for a user.
    pub async fn enable_spam_filter(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SpamAssassin", "enable_spam_assassin", &[])
            .await?;
        check_uapi(&raw)?;
        Ok("SpamAssassin enabled".into())
    }

    /// Disable SpamAssassin for a user.
    pub async fn disable_spam_filter(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SpamAssassin", "disable_spam_assassin", &[])
            .await?;
        check_uapi(&raw)?;
        Ok("SpamAssassin disabled".into())
    }

    /// List MX records for a domain.
    pub async fn list_mx(
        client: &CpanelClient,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<MxRecord>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_mx_records", &[("domain", domain)])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// List email filters for an account.
    pub async fn list_filters(
        client: &CpanelClient,
        user: &str,
        account: &str,
    ) -> CpanelResult<Vec<EmailFilter>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "list_filters", &[("account", account)])
            .await?;
        let data = extract_uapi_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Suspend incoming mail for an account.
    pub async fn suspend_incoming(
        client: &CpanelClient,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "suspend_incoming", &[("email", email)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Incoming mail suspended for {email}"))
    }

    /// Unsuspend incoming mail.
    pub async fn unsuspend_incoming(
        client: &CpanelClient,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "unsuspend_incoming", &[("email", email)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Incoming mail unsuspended for {email}"))
    }

    /// Suspend outgoing mail (hold).
    pub async fn hold_outgoing(
        client: &CpanelClient,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "hold_outgoing", &[("email", email)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Outgoing mail held for {email}"))
    }

    /// Release outgoing mail hold.
    pub async fn release_outgoing(
        client: &CpanelClient,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Email", "release_outgoing", &[("email", email)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Outgoing mail released for {email}"))
    }
}

fn extract_uapi_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
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
