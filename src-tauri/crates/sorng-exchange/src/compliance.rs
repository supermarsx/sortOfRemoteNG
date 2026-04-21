// ─── Exchange Integration – compliance, retention, DLP, holds ────────────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Retention Policies
// ═══════════════════════════════════════════════════════════════════════════════

/// List retention policies.
pub async fn ps_list_retention_policies(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<RetentionPolicy>> {
    client.run_ps_json("Get-RetentionPolicy").await
}

/// Get a specific retention policy.
pub async fn ps_get_retention_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<RetentionPolicy> {
    let cmd = format!(
        "Get-RetentionPolicy -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Retention Tags
// ═══════════════════════════════════════════════════════════════════════════════

/// List retention tags.
pub async fn ps_list_retention_tags(client: &ExchangeClient) -> ExchangeResult<Vec<RetentionTag>> {
    client.run_ps_json("Get-RetentionPolicyTag").await
}

/// Get a specific retention tag.
pub async fn ps_get_retention_tag(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<RetentionTag> {
    let cmd = format!(
        "Get-RetentionPolicyTag -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create a retention tag.
pub async fn ps_create_retention_tag(
    client: &ExchangeClient,
    name: &str,
    tag_type: &str,
    age_limit_days: i32,
    action: &str,
) -> ExchangeResult<RetentionTag> {
    let cmd = format!(
        "New-RetentionPolicyTag -Name '{}' -Type {} -AgeLimitForRetention {} -RetentionAction {} -RetentionEnabled $true",
        name.replace('\'', "''"),
        tag_type,
        age_limit_days,
        action,
    );
    client.run_ps_json(&cmd).await
}

/// Remove a retention tag.
pub async fn ps_remove_retention_tag(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-RetentionPolicyTag -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Litigation / In-Place Hold
// ═══════════════════════════════════════════════════════════════════════════════

/// Get hold status for a mailbox.
pub async fn ps_get_mailbox_hold(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailboxHold> {
    let cmd = format!(
        "Get-Mailbox -Identity '{}' | Select-Object Identity,LitigationHoldEnabled,LitigationHoldDate,LitigationHoldOwner,LitigationHoldDuration,InPlaceHolds",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Enable litigation hold on a mailbox.
pub async fn ps_enable_litigation_hold(
    client: &ExchangeClient,
    identity: &str,
    duration: Option<&str>,
    owner: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Set-Mailbox -Identity '{}' -LitigationHoldEnabled $true",
        identity.replace('\'', "''")
    );
    cmd.push_str(&ps_param_opt("LitigationHoldDuration", duration));
    cmd.push_str(&ps_param_opt("LitigationHoldOwner", owner));
    client.run_ps(&cmd).await
}

/// Disable litigation hold on a mailbox.
pub async fn ps_disable_litigation_hold(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Set-Mailbox -Identity '{}' -LitigationHoldEnabled $false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// DLP Policies
// ═══════════════════════════════════════════════════════════════════════════════

/// List DLP policies.
pub async fn ps_list_dlp_policies(client: &ExchangeClient) -> ExchangeResult<Vec<DlpPolicy>> {
    client.run_ps_json("Get-DlpPolicy").await
}

/// Get a specific DLP policy.
pub async fn ps_get_dlp_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<DlpPolicy> {
    let cmd = format!("Get-DlpPolicy -Identity '{}'", identity.replace('\'', "''"));
    client.run_ps_json(&cmd).await
}

/// Enable / disable a DLP policy.
pub async fn ps_set_dlp_policy_state(
    client: &ExchangeClient,
    identity: &str,
    enabled: bool,
) -> ExchangeResult<String> {
    let state = if enabled { "Enabled" } else { "Disabled" };
    let cmd = format!(
        "Set-DlpPolicy -Identity '{}' -State {}",
        identity.replace('\'', "''"),
        state,
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance Search (eDiscovery)
// ═══════════════════════════════════════════════════════════════════════════════

/// Start a compliance search.
pub async fn ps_start_compliance_search(
    client: &ExchangeClient,
    name: &str,
    query: &str,
    mailboxes: Option<&[String]>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "New-ComplianceSearch -Name '{}' -ExchangeLocation ",
        name.replace('\'', "''")
    );
    match mailboxes {
        Some(mbs) if !mbs.is_empty() => {
            let quoted: Vec<String> = mbs
                .iter()
                .map(|m| format!("'{}'", m.replace('\'', "''")))
                .collect();
            cmd.push_str(&quoted.join(","));
        }
        _ => cmd.push_str("All"),
    }
    cmd.push_str(&format!(
        " -ContentMatchQuery '{}'; Start-ComplianceSearch -Identity '{}'",
        query.replace('\'', "''"),
        name.replace('\'', "''")
    ));
    client.run_ps(&cmd).await
}

/// Get compliance search results.
pub async fn ps_get_compliance_search(
    client: &ExchangeClient,
    name: &str,
) -> ExchangeResult<serde_json::Value> {
    let cmd = format!(
        "Get-ComplianceSearch -Identity '{}'",
        name.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}
