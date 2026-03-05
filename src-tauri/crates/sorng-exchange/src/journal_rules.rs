// ─── Exchange Integration – Journal Rules ────────────────────────────────────
//!
//! Manage Exchange journal rules for compliance archiving.

use crate::client::ExchangeClient;
use crate::auth::{wrap_ps_json, ps_param_opt};
use crate::types::*;

/// List all journal rules.
pub async fn ps_list_journal_rules(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<JournalRule>> {
    let script = wrap_ps_json(
        "Get-JournalRule | Select-Object Name,JournalEmailAddress,Scope,Enabled,Recipient"
    );
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

/// Get a specific journal rule.
pub async fn ps_get_journal_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<JournalRule> {
    let script = wrap_ps_json(&format!(
        "Get-JournalRule -Identity '{identity}'"
    ));
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Create a new journal rule.
pub async fn ps_create_journal_rule(
    client: &ExchangeClient,
    req: &CreateJournalRuleRequest,
) -> ExchangeResult<JournalRule> {
    let scope = match req.scope {
        JournalRuleScope::Global => "Global",
        JournalRuleScope::Internal => "Internal",
        JournalRuleScope::External => "External",
    };
    let mut cmd = format!(
        "New-JournalRule -Name '{}' -JournalEmailAddress '{}' -Scope {scope}",
        req.name, req.journal_email_address
    );
    cmd += &ps_param_opt("-Recipient", req.recipient.as_deref());
    if !req.enabled {
        cmd += " -Enabled $false";
    }
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Remove a journal rule.
pub async fn ps_remove_journal_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-JournalRule -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

/// Enable a journal rule.
pub async fn ps_enable_journal_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Enable-JournalRule -Identity '{identity}'"
        ))
        .await
}

/// Disable a journal rule.
pub async fn ps_disable_journal_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Disable-JournalRule -Identity '{identity}'"
        ))
        .await
}
