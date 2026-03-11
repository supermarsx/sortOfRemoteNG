// IPC command handlers exposed to the SortOfRemote NG front-end via Tauri's
// `#[tauri::command]` system. All commands are prefixed with `notif_`.

use super::service::NotificationServiceState;
use super::types::*;
use tauri::State;

// ── Rule Management ─────────────────────────────────────────────────

/// Add a new notification rule.
#[tauri::command]
pub async fn notif_add_rule(
    state: State<'_, NotificationServiceState>,
    rule: NotificationRule,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rules.add_rule(rule).map_err(|e| e.to_string())
}

/// Remove a notification rule by ID.
#[tauri::command]
pub async fn notif_remove_rule(
    state: State<'_, NotificationServiceState>,
    rule_id: String,
) -> Result<NotificationRule, String> {
    let mut svc = state.lock().await;
    svc.rules.remove_rule(&rule_id).map_err(|e| e.to_string())
}

/// List all registered notification rules.
#[tauri::command]
pub async fn notif_list_rules(
    state: State<'_, NotificationServiceState>,
) -> Result<Vec<NotificationRule>, String> {
    let svc = state.lock().await;
    Ok(svc.rules.list_rules().into_iter().cloned().collect())
}

/// Get a single notification rule by ID.
#[tauri::command]
pub async fn notif_get_rule(
    state: State<'_, NotificationServiceState>,
    rule_id: String,
) -> Result<NotificationRule, String> {
    let svc = state.lock().await;
    svc.rules
        .get_rule(&rule_id)
        .cloned()
        .map_err(|e| e.to_string())
}

/// Enable a notification rule.
#[tauri::command]
pub async fn notif_enable_rule(
    state: State<'_, NotificationServiceState>,
    rule_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rules.enable_rule(&rule_id).map_err(|e| e.to_string())
}

/// Disable a notification rule.
#[tauri::command]
pub async fn notif_disable_rule(
    state: State<'_, NotificationServiceState>,
    rule_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rules.disable_rule(&rule_id).map_err(|e| e.to_string())
}

/// Update an existing notification rule (full replacement).
#[tauri::command]
pub async fn notif_update_rule(
    state: State<'_, NotificationServiceState>,
    rule: NotificationRule,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rules.update_rule(rule).map_err(|e| e.to_string())
}

// ── Template Management ─────────────────────────────────────────────

/// Add (or replace) a notification template.
#[tauri::command]
pub async fn notif_add_template(
    state: State<'_, NotificationServiceState>,
    template: NotificationTemplate,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.templates.add_template(template);
    Ok(())
}

/// Remove a notification template by ID.
#[tauri::command]
pub async fn notif_remove_template(
    state: State<'_, NotificationServiceState>,
    template_id: String,
) -> Result<NotificationTemplate, String> {
    let mut svc = state.lock().await;
    svc.templates
        .remove_template(&template_id)
        .map_err(|e| e.to_string())
}

/// List all registered notification templates.
#[tauri::command]
pub async fn notif_list_templates(
    state: State<'_, NotificationServiceState>,
) -> Result<Vec<NotificationTemplate>, String> {
    let svc = state.lock().await;
    Ok(svc
        .templates
        .list_templates()
        .into_iter()
        .cloned()
        .collect())
}

// ── Event Processing ────────────────────────────────────────────────

/// Manually trigger notification processing for a given event.
#[tauri::command]
pub async fn notif_process_event(
    state: State<'_, NotificationServiceState>,
    trigger: NotificationTrigger,
    data: serde_json::Value,
) -> Result<Vec<NotificationRecord>, String> {
    let mut svc = state.lock().await;
    Ok(svc.process_event(trigger, data).await)
}

// ── History ─────────────────────────────────────────────────────────

/// Get the full notification history.
#[tauri::command]
pub async fn notif_get_history(
    state: State<'_, NotificationServiceState>,
) -> Result<Vec<NotificationRecord>, String> {
    let svc = state.lock().await;
    Ok(svc
        .history
        .get_recent(svc.config.max_history_size)
        .into_iter()
        .cloned()
        .collect())
}

/// Get the N most recent notification records.
#[tauri::command]
pub async fn notif_get_recent_history(
    state: State<'_, NotificationServiceState>,
    count: usize,
) -> Result<Vec<NotificationRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.history.get_recent(count).into_iter().cloned().collect())
}

/// Clear all notification history.
#[tauri::command]
pub async fn notif_clear_history(state: State<'_, NotificationServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.history.clear();
    Ok(())
}

// ── Statistics ───────────────────────────────────────────────────────

/// Get aggregate notification statistics.
#[tauri::command]
pub async fn notif_get_stats(
    state: State<'_, NotificationServiceState>,
) -> Result<NotificationStats, String> {
    let svc = state.lock().await;
    Ok(svc.history.stats())
}

// ── Configuration ───────────────────────────────────────────────────

/// Get the current notification configuration.
#[tauri::command]
pub async fn notif_get_config(
    state: State<'_, NotificationServiceState>,
) -> Result<NotificationsConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config.clone())
}

/// Update the notification configuration.
#[tauri::command]
pub async fn notif_update_config(
    state: State<'_, NotificationServiceState>,
    config: NotificationsConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.history.set_max_size(config.max_history_size);
    svc.config = config;
    Ok(())
}

// ── Channel Testing ─────────────────────────────────────────────────

/// Send a test notification through a specific channel to verify it works.
#[tauri::command]
pub async fn notif_test_channel(
    _state: State<'_, NotificationServiceState>,
    channel: ChannelConfig,
) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let test_data = serde_json::json!({
        "test": true,
        "source": "SortOfRemote NG",
        "timestamp": timestamp,
    });

    super::channels::deliver_notification(
        &channel,
        "SortOfRemote NG — Test Notification",
        "This is a test notification from SortOfRemote NG. If you see this, the channel is configured correctly.",
        &test_data,
    )
    .await
    .map_err(|e| e.to_string())
}

// ── Escalation ──────────────────────────────────────────────────────

/// Acknowledge an active escalation chain, stopping further levels.
#[tauri::command]
pub async fn notif_acknowledge_escalation(
    state: State<'_, NotificationServiceState>,
    escalation_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.escalation.acknowledge(&escalation_id))
}
