// ─── Exchange Integration – Anti-Spam & Hygiene ─────────────────────────────
//!
//! Manage content filtering, connection filtering, sender filtering, and
//! quarantine management for Exchange on-premises.  Also handle mailbox
//! import/export requests (PST).

use crate::client::ExchangeClient;
use crate::auth::{wrap_ps_json, ps_param_opt};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Content Filter
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_get_content_filter_config(
    client: &ExchangeClient,
) -> ExchangeResult<ContentFilterConfig> {
    let script = wrap_ps_json(
        "Get-ContentFilterConfig | Select-Object Identity,Enabled,\
         SCLDeleteThreshold,SCLRejectThreshold,SCLQuarantineThreshold,\
         SCLJunkThreshold,QuarantineMailbox,BypassedSenderDomains,BypassedSenders"
    );
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

pub async fn ps_set_content_filter_config(
    client: &ExchangeClient,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = String::from("Set-ContentFilterConfig");
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                cmd += &format!(" -{k} '{s}'");
            } else if let Some(b) = v.as_bool() {
                cmd += &format!(" -{k} ${}", if b { "true" } else { "false" });
            } else if let Some(n) = v.as_i64() {
                cmd += &format!(" -{k} {n}");
            }
        }
    }
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Filter
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_get_connection_filter_config(
    client: &ExchangeClient,
) -> ExchangeResult<ConnectionFilterConfig> {
    let script = wrap_ps_json(
        "Get-IPBlockListConfig; Get-IPAllowListConfig | Select-Object Identity,Enabled; \
         Get-HostedConnectionFilterPolicy | Select-Object Identity,IPAllowList,IPBlockList,EnableSafeList"
    );
    // simplified – just return the hosted connection filter policy for EOP
    let script2 = wrap_ps_json(
        "Get-HostedConnectionFilterPolicy -Identity Default | \
         Select-Object Identity,IPAllowList,IPBlockList,EnableSafeList"
    );
    let out = client.run_ps_json(&script2).await.or_else(|_| {
        // on-prem fallback  
        Ok::<String, ExchangeError>("{}".to_string())
    })?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

pub async fn ps_set_connection_filter_config(
    client: &ExchangeClient,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = String::from("Set-HostedConnectionFilterPolicy -Identity Default");
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sender Filter
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_get_sender_filter_config(
    client: &ExchangeClient,
) -> ExchangeResult<SenderFilterConfig> {
    let script = wrap_ps_json(
        "Get-SenderFilterConfig | Select-Object Identity,Enabled,BlockedSenders,\
         BlockedDomains,BlockedDomainsAndSubdomains,BlankSenderBlockingEnabled"
    );
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

pub async fn ps_set_sender_filter_config(
    client: &ExchangeClient,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = String::from("Set-SenderFilterConfig");
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

// ═══════════════════════════════════════════════════════════════════════════════
// Quarantine (Exchange Online Protection)
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_quarantine_messages(
    client: &ExchangeClient,
    page_size: Option<i32>,
    quarantine_type: Option<&str>,
) -> ExchangeResult<Vec<QuarantineMessage>> {
    let sz = page_size.unwrap_or(100);
    let mut cmd = format!("Get-QuarantineMessage -PageSize {sz}");
    cmd += &ps_param_opt("-QuarantineTypes", quarantine_type);
    cmd += " | Select-Object Identity,Subject,SenderAddress,RecipientAddress,\
             QuarantineTypes,ReceivedTime,ReleasedTo,Expires,Direction,Size";
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

pub async fn ps_get_quarantine_message(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<QuarantineMessage> {
    let script = wrap_ps_json(&format!(
        "Get-QuarantineMessage -Identity '{identity}'"
    ));
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

pub async fn ps_release_quarantine_message(
    client: &ExchangeClient,
    identity: &str,
    release_to_all: bool,
) -> ExchangeResult<String> {
    let all = if release_to_all { " -ReleaseToAll" } else { "" };
    client
        .run_ps(&format!(
            "Release-QuarantineMessage -Identity '{identity}'{all} -Force"
        ))
        .await
}

pub async fn ps_delete_quarantine_message(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Delete-QuarantineMessage -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox Import / Export (PST)
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_new_mailbox_import_request(
    client: &ExchangeClient,
    mailbox: &str,
    file_path: &str,
    target_root_folder: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "New-MailboxImportRequest -Mailbox '{mailbox}' -FilePath '{file_path}'"
    );
    cmd += &ps_param_opt("-TargetRootFolder", target_root_folder);
    client.run_ps(&cmd).await
}

pub async fn ps_new_mailbox_export_request(
    client: &ExchangeClient,
    mailbox: &str,
    file_path: &str,
    include_folders: Option<&[String]>,
    exclude_folders: Option<&[String]>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "New-MailboxExportRequest -Mailbox '{mailbox}' -FilePath '{file_path}'"
    );
    if let Some(inc) = include_folders {
        let list = inc.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(",");
        cmd += &format!(" -IncludeFolders {list}");
    }
    if let Some(exc) = exclude_folders {
        let list = exc.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(",");
        cmd += &format!(" -ExcludeFolders {list}");
    }
    client.run_ps(&cmd).await
}

pub async fn ps_list_mailbox_import_requests(
    client: &ExchangeClient,
    mailbox: Option<&str>,
) -> ExchangeResult<Vec<MailboxImportExportRequest>> {
    let mut cmd = String::from("Get-MailboxImportRequest");
    cmd += &ps_param_opt("-Mailbox", mailbox);
    cmd += " | Select-Object Name,Mailbox,Status,PercentComplete";
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

pub async fn ps_list_mailbox_export_requests(
    client: &ExchangeClient,
    mailbox: Option<&str>,
) -> ExchangeResult<Vec<MailboxImportExportRequest>> {
    let mut cmd = String::from("Get-MailboxExportRequest");
    cmd += &ps_param_opt("-Mailbox", mailbox);
    cmd += " | Select-Object Name,Mailbox,Status,PercentComplete";
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

pub async fn ps_remove_mailbox_import_request(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MailboxImportRequest -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

pub async fn ps_remove_mailbox_export_request(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MailboxExportRequest -Identity '{identity}' -Confirm:$false"
        ))
        .await
}
