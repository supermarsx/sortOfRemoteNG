// ─── Exchange Integration – mailbox operations ──────────────────────────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises (PowerShell)
// ═══════════════════════════════════════════════════════════════════════════════

/// List all mailboxes (Get-Mailbox).
pub async fn ps_list_mailboxes(
    client: &ExchangeClient,
    result_size: Option<i32>,
    filter: Option<&str>,
) -> ExchangeResult<Vec<Mailbox>> {
    let limit = result_size.unwrap_or(1000);
    let mut cmd = format!("Get-Mailbox -ResultSize {limit}");
    if let Some(f) = filter {
        cmd.push_str(&format!(" -Filter \"{f}\""));
    }
    client.run_ps_json(&cmd).await
}

/// Get a single mailbox by identity.
pub async fn ps_get_mailbox(client: &ExchangeClient, identity: &str) -> ExchangeResult<Mailbox> {
    let cmd = format!("Get-Mailbox -Identity '{}'", identity.replace('\'', "''"));
    client.run_ps_json(&cmd).await
}

/// Create a new mailbox (New-Mailbox).
pub async fn ps_create_mailbox(
    client: &ExchangeClient,
    req: &CreateMailboxRequest,
) -> ExchangeResult<Mailbox> {
    let mb_type = match req.mailbox_type {
        MailboxType::SharedMailbox => " -Shared",
        MailboxType::RoomMailbox => " -Room",
        MailboxType::EquipmentMailbox => " -Equipment",
        _ => "",
    };
    let mut cmd = format!(
        "New-Mailbox -Name '{}' -Alias '{}' -PrimarySmtpAddress '{}'{}",
        req.display_name.replace('\'', "''"),
        req.alias.replace('\'', "''"),
        req.primary_smtp_address.replace('\'', "''"),
        mb_type,
    );
    cmd.push_str(&ps_param_opt("FirstName", &req.first_name));
    cmd.push_str(&ps_param_opt("LastName", &req.last_name));
    cmd.push_str(&ps_param_opt("OrganizationalUnit", &req.organizational_unit));
    cmd.push_str(&ps_param_opt("Database", &req.database));
    if let Some(ref pwd) = req.password {
        cmd.push_str(&format!(
            " -Password (ConvertTo-SecureString '{}' -AsPlainText -Force)",
            pwd.replace('\'', "''")
        ));
    }
    client.run_ps_json(&cmd).await
}

/// Remove a mailbox.
pub async fn ps_remove_mailbox(client: &ExchangeClient, identity: &str) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-Mailbox -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Enable a mailbox (Enable-Mailbox on existing AD user).
pub async fn ps_enable_mailbox(
    client: &ExchangeClient,
    identity: &str,
    database: Option<&str>,
) -> ExchangeResult<Mailbox> {
    let mut cmd = format!("Enable-Mailbox -Identity '{}'", identity.replace('\'', "''"));
    if let Some(db) = database {
        cmd.push_str(&format!(" -Database '{}'", db.replace('\'', "''")));
    }
    client.run_ps_json(&cmd).await
}

/// Disable a mailbox.
pub async fn ps_disable_mailbox(client: &ExchangeClient, identity: &str) -> ExchangeResult<String> {
    let cmd = format!(
        "Disable-Mailbox -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Update mailbox properties (Set-Mailbox).
pub async fn ps_update_mailbox(
    client: &ExchangeClient,
    req: &UpdateMailboxRequest,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-Mailbox -Identity '{}'", req.identity.replace('\'', "''"));
    cmd.push_str(&ps_param_opt("DisplayName", &req.display_name));
    cmd.push_str(&ps_param_opt("Alias", &req.alias));
    cmd.push_str(&ps_param_opt("PrimarySmtpAddress", &req.primary_smtp_address));
    cmd.push_str(&ps_param_opt("MaxSendSize", &req.max_send_size));
    cmd.push_str(&ps_param_opt("MaxReceiveSize", &req.max_receive_size));

    if let Some(ref q) = req.quota {
        cmd.push_str(&ps_param_opt("ProhibitSendQuota", &q.prohibit_send_quota));
        cmd.push_str(&ps_param_opt(
            "ProhibitSendReceiveQuota",
            &q.prohibit_send_receive_quota,
        ));
        cmd.push_str(&ps_param_opt("IssueWarningQuota", &q.issue_warning_quota));
        cmd.push_str(&ps_param_bool(
            "UseDatabaseQuotaDefaults",
            q.use_database_quota_defaults,
        ));
    }

    if let Some(ref fwd) = req.forwarding {
        cmd.push_str(&ps_param_opt("ForwardingAddress", &fwd.forwarding_address));
        cmd.push_str(&ps_param_opt("ForwardingSmtpAddress", &fwd.forwarding_smtp_address));
        cmd.push_str(&ps_param_bool(
            "DeliverToMailboxAndForward",
            fwd.deliver_to_mailbox_and_forward,
        ));
    }

    client.run_ps(&cmd).await
}

/// Get mailbox statistics.
pub async fn ps_get_mailbox_statistics(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailboxStatistics> {
    let cmd = format!(
        "Get-MailboxStatistics -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Get mailbox permissions.
pub async fn ps_get_mailbox_permissions(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Vec<MailboxPermission>> {
    let cmd = format!(
        "Get-MailboxPermission -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Add mailbox permission.
pub async fn ps_add_mailbox_permission(
    client: &ExchangeClient,
    identity: &str,
    user: &str,
    access_rights: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Add-MailboxPermission -Identity '{}' -User '{}' -AccessRights {} -InheritanceType All -Confirm:$false",
        identity.replace('\'', "''"),
        user.replace('\'', "''"),
        access_rights
    );
    client.run_ps(&cmd).await
}

/// Remove mailbox permission.
pub async fn ps_remove_mailbox_permission(
    client: &ExchangeClient,
    identity: &str,
    user: &str,
    access_rights: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-MailboxPermission -Identity '{}' -User '{}' -AccessRights {} -InheritanceType All -Confirm:$false",
        identity.replace('\'', "''"),
        user.replace('\'', "''"),
        access_rights
    );
    client.run_ps(&cmd).await
}

/// Get forwarding configuration.
pub async fn ps_get_forwarding(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailboxForwarding> {
    let cmd = format!(
        "Get-Mailbox -Identity '{}' | Select-Object Identity,ForwardingAddress,ForwardingSmtpAddress,DeliverToMailboxAndForward",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Get / set Out-of-Office (automatic replies).
pub async fn ps_get_ooo(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<OutOfOfficeSettings> {
    let cmd = format!(
        "Get-MailboxAutoReplyConfiguration -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_set_ooo(
    client: &ExchangeClient,
    settings: &OutOfOfficeSettings,
) -> ExchangeResult<String> {
    let state = match settings.auto_reply_state {
        AutoReplyState::Enabled => "Enabled",
        AutoReplyState::Scheduled => "Scheduled",
        AutoReplyState::Disabled => "Disabled",
    };
    let mut cmd = format!(
        "Set-MailboxAutoReplyConfiguration -Identity '{}' -AutoReplyState {state}",
        settings.identity.replace('\'', "''")
    );
    cmd.push_str(&ps_param_opt("InternalMessage", &settings.internal_message));
    cmd.push_str(&ps_param_opt("ExternalMessage", &settings.external_message));
    // Scheduled times handled if present
    if let Some(ref start) = settings.start_time {
        cmd.push_str(&format!(" -StartTime '{}'", start.format("%m/%d/%Y %H:%M:%S")));
    }
    if let Some(ref end) = settings.end_time {
        cmd.push_str(&format!(" -EndTime '{}'", end.format("%m/%d/%Y %H:%M:%S")));
    }
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online (Graph API)
// ═══════════════════════════════════════════════════════════════════════════════

/// List mailboxes via Graph (users with mailbox).
pub async fn graph_list_mailboxes(client: &ExchangeClient) -> ExchangeResult<Vec<Mailbox>> {
    // Graph users with mailboxSettings populated
    let users: Vec<serde_json::Value> = client
        .graph_list("/users?$select=id,displayName,mail,userPrincipalName,mailNickname,accountEnabled,createdDateTime&$filter=assignedPlans/any(p:p/service eq 'exchange')&$top=999")
        .await
        .unwrap_or_default();

    let mailboxes = users
        .into_iter()
        .map(|u| Mailbox {
            id: u["id"].as_str().unwrap_or_default().to_string(),
            display_name: u["displayName"].as_str().unwrap_or_default().to_string(),
            primary_smtp_address: u["mail"].as_str().unwrap_or_default().to_string(),
            alias: u["mailNickname"].as_str().unwrap_or_default().to_string(),
            user_principal_name: u["userPrincipalName"].as_str().map(String::from),
            is_enabled: u["accountEnabled"].as_bool().unwrap_or(true),
            mailbox_type: MailboxType::UserMailbox,
            ..Default::default()
        })
        .collect();

    Ok(mailboxes)
}

/// Get a single user/mailbox via Graph.
pub async fn graph_get_mailbox(
    client: &ExchangeClient,
    user_id_or_upn: &str,
) -> ExchangeResult<Mailbox> {
    let u: serde_json::Value = client
        .graph_get(&format!("/users/{user_id_or_upn}?$select=id,displayName,mail,userPrincipalName,mailNickname,accountEnabled,createdDateTime"))
        .await?;

    Ok(Mailbox {
        id: u["id"].as_str().unwrap_or_default().to_string(),
        display_name: u["displayName"].as_str().unwrap_or_default().to_string(),
        primary_smtp_address: u["mail"].as_str().unwrap_or_default().to_string(),
        alias: u["mailNickname"].as_str().unwrap_or_default().to_string(),
        user_principal_name: u["userPrincipalName"].as_str().map(String::from),
        is_enabled: u["accountEnabled"].as_bool().unwrap_or(true),
        mailbox_type: MailboxType::UserMailbox,
        ..Default::default()
    })
}
