// ─── Exchange Integration – transport rules ─────────────────────────────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises / Exchange Online (PowerShell – same cmdlets)
// ═══════════════════════════════════════════════════════════════════════════════

/// List all transport (mail-flow) rules.
pub async fn ps_list_transport_rules(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<TransportRule>> {
    client
        .run_ps_json("Get-TransportRule -ResultSize Unlimited")
        .await
}

/// Get a single transport rule.
pub async fn ps_get_transport_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<TransportRule> {
    let cmd = format!(
        "Get-TransportRule -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create a transport rule.
pub async fn ps_create_transport_rule(
    client: &ExchangeClient,
    req: &CreateTransportRuleRequest,
) -> ExchangeResult<TransportRule> {
    let mut cmd = format!(
        "New-TransportRule -Name '{}'",
        req.name.replace('\'', "''")
    );
    if let Some(p) = req.priority {
        cmd.push_str(&format!(" -Priority {p}"));
    }
    cmd.push_str(&ps_param_list("From", &req.from_addresses));
    cmd.push_str(&ps_param_list("SentTo", &req.sent_to_addresses));
    cmd.push_str(&ps_param_list("SubjectContainsWords", &req.subject_contains_words));
    if let Some(true) = req.has_attachment {
        cmd.push_str(" -AttachmentHasExecutableContent $true");
    }
    cmd.push_str(&ps_param_opt("PrependSubject", req.prepend_subject.as_deref()));
    cmd.push_str(&ps_param_list("RedirectMessageTo", &req.redirect_message_to));
    cmd.push_str(&ps_param_opt(
        "RejectMessageReasonText",
        req.reject_message_reason.as_deref(),
    ));
    client.run_ps_json(&cmd).await
}

/// Update a transport rule (Set-TransportRule).
pub async fn ps_update_transport_rule(
    client: &ExchangeClient,
    identity: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Set-TransportRule -Identity '{}'",
        identity.replace('\'', "''")
    );
    // Apply arbitrary key/value pairs from the JSON object
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            match v {
                serde_json::Value::Bool(b) => {
                    let val = if *b { "$true" } else { "$false" };
                    cmd.push_str(&format!(" -{k} {val}"));
                }
                serde_json::Value::Number(n) => {
                    cmd.push_str(&format!(" -{k} {n}"));
                }
                serde_json::Value::String(s) => {
                    cmd.push_str(&format!(" -{k} '{}'", s.replace('\'', "''")));
                }
                _ => {}
            }
        }
    }
    client.run_ps(&cmd).await
}

/// Remove a transport rule.
pub async fn ps_remove_transport_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-TransportRule -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Enable a transport rule.
pub async fn ps_enable_transport_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Enable-TransportRule -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Disable a transport rule.
pub async fn ps_disable_transport_rule(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Disable-TransportRule -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}
