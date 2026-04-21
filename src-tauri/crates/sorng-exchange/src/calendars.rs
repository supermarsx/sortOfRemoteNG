// ─── Exchange Integration – calendar & resource management ──────────────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar permissions (On-Prem + Online via PS)
// ═══════════════════════════════════════════════════════════════════════════════

/// List calendar folder permissions for a mailbox.
pub async fn ps_list_calendar_permissions(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Vec<CalendarPermission>> {
    let cmd = format!(
        "Get-MailboxFolderPermission -Identity '{}:\\Calendar'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Set / add calendar permission for a user.
pub async fn ps_set_calendar_permission(
    client: &ExchangeClient,
    identity: &str,
    user: &str,
    access_rights: &str,
) -> ExchangeResult<String> {
    // Try Set first, fall back to Add for new entries
    let cmd = format!(
        "try {{ Set-MailboxFolderPermission -Identity '{}:\\Calendar' -User '{}' -AccessRights {} -ErrorAction Stop }} catch {{ Add-MailboxFolderPermission -Identity '{}:\\Calendar' -User '{}' -AccessRights {} }}",
        identity.replace('\'', "''"),
        user.replace('\'', "''"),
        access_rights,
        identity.replace('\'', "''"),
        user.replace('\'', "''"),
        access_rights,
    );
    client.run_ps(&cmd).await
}

/// Remove a calendar permission entry.
pub async fn ps_remove_calendar_permission(
    client: &ExchangeClient,
    identity: &str,
    user: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-MailboxFolderPermission -Identity '{}:\\Calendar' -User '{}' -Confirm:$false",
        identity.replace('\'', "''"),
        user.replace('\'', "''"),
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Resource mailbox booking configuration
// ═══════════════════════════════════════════════════════════════════════════════

/// Get resource booking configuration (room / equipment).
pub async fn ps_get_booking_config(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ResourceBookingConfig> {
    let cmd = format!(
        "Get-CalendarProcessing -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Update resource booking policy.
pub async fn ps_set_booking_config(
    client: &ExchangeClient,
    config: &ResourceBookingConfig,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Set-CalendarProcessing -Identity '{}'",
        config.identity.replace('\'', "''")
    );
    cmd.push_str(&ps_param_bool("AutomateProcessing", config.auto_accept));
    cmd.push_str(&ps_param_bool("AllowConflicts", config.allow_conflicts));
    cmd.push_str(&ps_param_bool(
        "AllowRecurringMeetings",
        config.allow_recurring_meetings,
    ));
    if let Some(d) = config.booking_window_in_days {
        cmd.push_str(&format!(" -BookingWindowInDays {d}"));
    }
    if let Some(d) = config.max_duration_in_minutes {
        cmd.push_str(&format!(" -MaximumDurationInMinutes {d}"));
    }
    cmd.push_str(&ps_param_list(
        "ResourceDelegates",
        &config.resource_delegates,
    ));

    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online – Graph calendar operations
// ═══════════════════════════════════════════════════════════════════════════════

/// List calendar permissions via Graph.
pub async fn graph_list_calendar_permissions(
    client: &ExchangeClient,
    user_id: &str,
) -> ExchangeResult<Vec<CalendarPermission>> {
    let perms: Vec<serde_json::Value> = client
        .graph_list(&format!("/users/{user_id}/calendar/calendarPermissions"))
        .await
        .unwrap_or_default();

    Ok(perms
        .into_iter()
        .map(|p| CalendarPermission {
            identity: user_id.to_string(),
            user: p["emailAddress"]["address"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            access_rights: serde_json::from_value(p["role"].clone()).unwrap_or_default(),
        })
        .collect())
}
