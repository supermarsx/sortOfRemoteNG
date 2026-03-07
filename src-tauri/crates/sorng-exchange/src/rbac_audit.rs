// ─── Exchange Integration – RBAC & Audit Logging ─────────────────────────────
//!
//! Role-Based Access Control management and administrator/mailbox audit log
//! searching.

use crate::client::ExchangeClient;
use crate::auth::{ps_param_opt, ps_param_list};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Role Groups
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_role_groups(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<RoleGroup>> {
    let cmd = "Get-RoleGroup | Select-Object Name,Description,Members,Roles,ManagedBy";
    client.run_ps_json(cmd).await
}

pub async fn ps_get_role_group(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<RoleGroup> {
    let cmd = format!(
        "Get-RoleGroup -Identity '{identity}' | Select-Object Name,Description,Members,Roles,ManagedBy"
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_add_role_group_member(
    client: &ExchangeClient,
    group: &str,
    member: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Add-RoleGroupMember -Identity '{group}' -Member '{member}'"
        ))
        .await
}

pub async fn ps_remove_role_group_member(
    client: &ExchangeClient,
    group: &str,
    member: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-RoleGroupMember -Identity '{group}' -Member '{member}' -Confirm:$false"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Management Roles
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_management_roles(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<ManagementRole>> {
    let cmd = "Get-ManagementRole | Select-Object Name,RoleType,Parent,IsRootRole,Description";
    client.run_ps_json(cmd).await
}

pub async fn ps_get_management_role(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ManagementRole> {
    let cmd = format!(
        "Get-ManagementRole -Identity '{identity}' | \
         Select-Object Name,RoleType,Parent,IsRootRole,Description"
    );
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Management Role Assignments
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_role_assignments(
    client: &ExchangeClient,
    role: Option<&str>,
    assignee: Option<&str>,
) -> ExchangeResult<Vec<ManagementRoleAssignment>> {
    let mut cmd = String::from("Get-ManagementRoleAssignment");
    if let Some(r) = role {
        cmd += &format!(" -Role '{r}'");
    }
    if let Some(a) = assignee {
        cmd += &format!(" -RoleAssignee '{a}'");
    }
    cmd += " | Select-Object Name,Role,RoleAssignee,RoleAssigneeType,Enabled,\
             CustomRecipientWriteScope,RecipientReadScope";
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Audit Log
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_search_admin_audit_log(
    client: &ExchangeClient,
    req: &AdminAuditLogSearchRequest,
) -> ExchangeResult<Vec<AdminAuditLogEntry>> {
    let mut cmd = String::from("Search-AdminAuditLog");
    cmd += &ps_param_list("Cmdlets", &req.cmdlets);
    cmd += &ps_param_list("ObjectIds", &req.object_ids);
    cmd += &ps_param_list("UserIds", &req.user_ids);
    cmd += &ps_param_opt("StartDate", req.start_date.as_deref());
    cmd += &ps_param_opt("EndDate", req.end_date.as_deref());
    cmd += &format!(" -ResultSize {}", req.result_size);
    cmd += " | Select-Object CmdletName,ObjectModified,Caller,Succeeded,RunDate,CmdletParameters";
    client.run_ps_json(&cmd).await
}

/// Get the admin audit log configuration.
pub async fn ps_get_admin_audit_log_config(
    client: &ExchangeClient,
) -> ExchangeResult<serde_json::Value> {
    let cmd = "Get-AdminAuditLogConfig | Select-Object AdminAuditLogEnabled,\
         AdminAuditLogCmdlets,AdminAuditLogParameters,LogLevel,\
         AdminAuditLogAgeLimit,TestCmdletLoggingEnabled";
    client.run_ps_json(cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox Audit Log
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_search_mailbox_audit_log(
    client: &ExchangeClient,
    identity: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
    log_on_types: Option<&str>,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<MailboxAuditLogEntry>> {
    let mut cmd = format!("Search-MailboxAuditLog -Identity '{identity}'");
    cmd += &ps_param_opt("StartDate", start_date);
    cmd += &ps_param_opt("EndDate", end_date);
    cmd += &ps_param_opt("LogonTypes", log_on_types);
    if let Some(sz) = result_size {
        cmd += &format!(" -ResultSize {sz}");
    }
    cmd += " -ShowDetails | Select-Object Operation,MailboxOwnerUPN,LogonUserDisplayName,\
             LogonType,ItemSubject,FolderPathName,LastAccessed";
    client.run_ps_json(&cmd).await
}

/// Enable mailbox audit logging on a mailbox.
pub async fn ps_enable_mailbox_audit(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-Mailbox -Identity '{identity}' -AuditEnabled $true"
        ))
        .await
}

/// Disable mailbox audit logging on a mailbox.
pub async fn ps_disable_mailbox_audit(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-Mailbox -Identity '{identity}' -AuditEnabled $false"
        ))
        .await
}
