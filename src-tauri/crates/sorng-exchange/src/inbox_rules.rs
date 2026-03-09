// ─── Exchange Integration – Inbox Rules ──────────────────────────────────────
//!
//! Manage per-mailbox inbox rules: list, create, update, remove, enable/disable.

use crate::auth::{ps_param_bool, ps_param_list, ps_param_opt};
use crate::client::ExchangeClient;
use crate::types::*;

/// List inbox rules for a mailbox.
pub async fn ps_list_inbox_rules(
    client: &ExchangeClient,
    mailbox: &str,
) -> ExchangeResult<Vec<InboxRule>> {
    let cmd = format!(
        "Get-InboxRule -Mailbox '{mailbox}' | Select-Object RuleIdentity,Name,Priority,Enabled,\
         Description,From,SubjectContainsWords,BodyContainsWords,\
         SubjectOrBodyContainsWords,FromAddressContainsWords,HasAttachment,\
         FlaggedForAction,MessageTypeMatches,\
         MoveToFolder,CopyToFolder,DeleteMessage,ForwardTo,RedirectTo,\
         MarkAsRead,MarkImportance,StopProcessingRules"
    );
    client.run_ps_json(&cmd).await
}

/// Get a specific inbox rule.
pub async fn ps_get_inbox_rule(
    client: &ExchangeClient,
    mailbox: &str,
    rule_id: &str,
) -> ExchangeResult<InboxRule> {
    let cmd = format!("Get-InboxRule -Mailbox '{mailbox}' -Identity '{rule_id}'");
    client.run_ps_json(&cmd).await
}

/// Create a new inbox rule.
pub async fn ps_create_inbox_rule(
    client: &ExchangeClient,
    req: &CreateInboxRuleRequest,
) -> ExchangeResult<InboxRule> {
    let mut cmd = format!(
        "New-InboxRule -Mailbox '{}' -Name '{}'",
        req.mailbox, req.name
    );
    cmd += &ps_param_list("From", &req.from);
    cmd += &ps_param_list("SubjectContainsWords", &req.subject_contains_words);
    if let Some(v) = req.has_attachment {
        cmd += &ps_param_bool("HasAttachment", v);
    }
    cmd += &ps_param_opt("MoveToFolder", req.move_to_folder.as_deref());
    if let Some(v) = req.delete_message {
        cmd += &ps_param_bool("DeleteMessage", v);
    }
    cmd += &ps_param_list("ForwardTo", &req.forward_to);
    if let Some(v) = req.mark_as_read {
        cmd += &ps_param_bool("MarkAsRead", v);
    }
    if let Some(v) = req.stop_processing_rules {
        cmd += &ps_param_bool("StopProcessingRules", v);
    }
    client.run_ps_json(&cmd).await
}

/// Update an existing inbox rule.
pub async fn ps_update_inbox_rule(
    client: &ExchangeClient,
    mailbox: &str,
    rule_id: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-InboxRule -Mailbox '{mailbox}' -Identity '{rule_id}'");
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                cmd += &format!(" -{k} '{s}'");
            } else if let Some(b) = v.as_bool() {
                cmd += &format!(" -{k} ${}", if b { "true" } else { "false" });
            }
        }
    }
    client.run_ps(&cmd).await
}

/// Remove an inbox rule.
pub async fn ps_remove_inbox_rule(
    client: &ExchangeClient,
    mailbox: &str,
    rule_id: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-InboxRule -Mailbox '{mailbox}' -Identity '{rule_id}' -Confirm:$false"
        ))
        .await
}

/// Enable an inbox rule.
pub async fn ps_enable_inbox_rule(
    client: &ExchangeClient,
    mailbox: &str,
    rule_id: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Enable-InboxRule -Mailbox '{mailbox}' -Identity '{rule_id}'"
        ))
        .await
}

/// Disable an inbox rule.
pub async fn ps_disable_inbox_rule(
    client: &ExchangeClient,
    mailbox: &str,
    rule_id: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Disable-InboxRule -Mailbox '{mailbox}' -Identity '{rule_id}'"
        ))
        .await
}
