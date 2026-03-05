// ─── Exchange Integration – Remote Domains ───────────────────────────────────
//!
//! Manage Exchange remote domain settings (message format, auto-replies,
//! auto-forward, NDR, delivery reports for external domains).

use crate::client::ExchangeClient;
use crate::auth::{wrap_ps_json, ps_param_opt, ps_param_bool};
use crate::types::*;

/// List all remote domains.
pub async fn ps_list_remote_domains(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<RemoteDomain>> {
    let script = wrap_ps_json(
        "Get-RemoteDomain | Select-Object Name,DomainName,IsInternal,\
         AutoReplyEnabled,AutoForwardEnabled,DeliveryReportEnabled,\
         NDREnabled,TNEFEnabled,AllowedOOFType,ContentType,CharacterSet"
    );
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

/// Get a specific remote domain.
pub async fn ps_get_remote_domain(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<RemoteDomain> {
    let script = wrap_ps_json(&format!(
        "Get-RemoteDomain -Identity '{identity}' | Select-Object Name,DomainName,IsInternal,\
         AutoReplyEnabled,AutoForwardEnabled,DeliveryReportEnabled,\
         NDREnabled,TNEFEnabled,AllowedOOFType,ContentType,CharacterSet"
    ));
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Create a new remote domain.
pub async fn ps_create_remote_domain(
    client: &ExchangeClient,
    req: &CreateRemoteDomainRequest,
) -> ExchangeResult<RemoteDomain> {
    let mut cmd = format!(
        "New-RemoteDomain -Name '{}' -DomainName '{}'",
        req.name, req.domain_name
    );
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;

    // Apply optional settings
    if req.auto_reply_enabled.is_some()
        || req.auto_forward_enabled.is_some()
        || req.delivery_report_enabled.is_some()
        || req.ndr_enabled.is_some()
        || req.allowed_oof_type.is_some()
    {
        let mut set_cmd = format!("Set-RemoteDomain -Identity '{}'", req.name);
        set_cmd += &ps_param_bool("-AutoReplyEnabled", req.auto_reply_enabled);
        set_cmd += &ps_param_bool("-AutoForwardEnabled", req.auto_forward_enabled);
        set_cmd += &ps_param_bool("-DeliveryReportEnabled", req.delivery_report_enabled);
        set_cmd += &ps_param_bool("-NDREnabled", req.ndr_enabled);
        set_cmd += &ps_param_opt("-AllowedOOFType", req.allowed_oof_type.as_deref());
        let _ = client.run_ps(&set_cmd).await;
    }

    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Update a remote domain.
pub async fn ps_update_remote_domain(
    client: &ExchangeClient,
    identity: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-RemoteDomain -Identity '{identity}'");
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

/// Remove a remote domain.
pub async fn ps_remove_remote_domain(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-RemoteDomain -Identity '{identity}' -Confirm:$false"
        ))
        .await
}
