//! Tauri command handlers for SMTP integration.
//!
//! All commands follow the `smtp_*` naming convention and accept
//! `State<'_, SmtpServiceState>` as their first parameter.

use std::collections::HashMap;

use tauri::State;

use crate::service::{SmtpServiceState, SmtpStats};
use crate::types::*;

/// Convert an SmtpError to a String for Tauri's error channel.
fn err_str(e: SmtpError) -> String {
    e.to_string()
}

// ── Profiles ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_add_profile(
    state: State<'_, SmtpServiceState>,
    profile: SmtpProfile,
) -> Result<String, String> {
    state.lock().await.add_profile(profile).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_update_profile(
    state: State<'_, SmtpServiceState>,
    profile: SmtpProfile,
) -> Result<(), String> {
    state.lock().await.update_profile(profile).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_delete_profile(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state.lock().await.delete_profile(&id).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_get_profile(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<Option<SmtpProfile>, String> {
    Ok(state.lock().await.get_profile(&id).cloned())
}

#[tauri::command]
pub async fn smtp_find_profile_by_name(
    state: State<'_, SmtpServiceState>,
    name: String,
) -> Result<Option<SmtpProfile>, String> {
    Ok(state.lock().await.find_profile_by_name(&name).cloned())
}

#[tauri::command]
pub async fn smtp_list_profiles(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<SmtpProfile>, String> {
    Ok(state.lock().await.list_profiles().to_vec())
}

#[tauri::command]
pub async fn smtp_set_default_profile(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .set_default_profile(&id)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_get_default_profile(
    state: State<'_, SmtpServiceState>,
) -> Result<Option<SmtpProfile>, String> {
    Ok(state.lock().await.default_profile().cloned())
}

// ── Templates ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_add_template(
    state: State<'_, SmtpServiceState>,
    template: EmailTemplate,
) -> Result<String, String> {
    state.lock().await.add_template(template).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_update_template(
    state: State<'_, SmtpServiceState>,
    template: EmailTemplate,
) -> Result<(), String> {
    state
        .lock()
        .await
        .update_template(template)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_delete_template(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state.lock().await.delete_template(&id).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_get_template(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<Option<EmailTemplate>, String> {
    Ok(state.lock().await.get_template(&id).cloned())
}

#[tauri::command]
pub async fn smtp_find_template_by_name(
    state: State<'_, SmtpServiceState>,
    name: String,
) -> Result<Option<EmailTemplate>, String> {
    Ok(state.lock().await.find_template_by_name(&name).cloned())
}

#[tauri::command]
pub async fn smtp_list_templates(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<EmailTemplate>, String> {
    Ok(state.lock().await.list_templates().to_vec())
}

#[tauri::command]
pub async fn smtp_render_template(
    state: State<'_, SmtpServiceState>,
    template_id: String,
    variables: HashMap<String, String>,
) -> Result<EmailMessage, String> {
    state
        .lock()
        .await
        .render_template(&template_id, &variables)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_extract_template_variables(
    state: State<'_, SmtpServiceState>,
    template_id: String,
) -> Result<Vec<String>, String> {
    state
        .lock()
        .await
        .extract_template_variables(&template_id)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_validate_template(
    state: State<'_, SmtpServiceState>,
    template_id: String,
) -> Result<Vec<String>, String> {
    state
        .lock()
        .await
        .validate_template(&template_id)
        .map_err(err_str)
}

// ── Contacts ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_add_contact(
    state: State<'_, SmtpServiceState>,
    contact: Contact,
) -> Result<String, String> {
    state
        .lock()
        .await
        .contacts_mut()
        .add_contact(contact)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_update_contact(
    state: State<'_, SmtpServiceState>,
    contact: Contact,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .update_contact(contact)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_delete_contact(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .delete_contact(&id)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_get_contact(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<Option<Contact>, String> {
    Ok(state.lock().await.contacts().get_contact(&id).cloned())
}

#[tauri::command]
pub async fn smtp_find_contact_by_email(
    state: State<'_, SmtpServiceState>,
    email: String,
) -> Result<Option<Contact>, String> {
    Ok(state
        .lock()
        .await
        .contacts()
        .find_by_email(&email)
        .cloned())
}

#[tauri::command]
pub async fn smtp_search_contacts(
    state: State<'_, SmtpServiceState>,
    query: String,
) -> Result<Vec<Contact>, String> {
    Ok(state
        .lock()
        .await
        .contacts()
        .search(&query)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn smtp_list_contacts(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<Contact>, String> {
    Ok(state.lock().await.contacts().list_contacts().to_vec())
}

#[tauri::command]
pub async fn smtp_list_contacts_in_group(
    state: State<'_, SmtpServiceState>,
    group_name: String,
) -> Result<Vec<Contact>, String> {
    Ok(state
        .lock()
        .await
        .contacts()
        .list_contacts_in_group(&group_name)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn smtp_list_contacts_by_tag(
    state: State<'_, SmtpServiceState>,
    tag: String,
) -> Result<Vec<Contact>, String> {
    Ok(state
        .lock()
        .await
        .contacts()
        .list_contacts_by_tag(&tag)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn smtp_add_contact_to_group(
    state: State<'_, SmtpServiceState>,
    contact_id: String,
    group_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .add_to_group(&contact_id, &group_name)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_remove_contact_from_group(
    state: State<'_, SmtpServiceState>,
    contact_id: String,
    group_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .remove_from_group(&contact_id, &group_name)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_add_contact_tag(
    state: State<'_, SmtpServiceState>,
    contact_id: String,
    tag: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .add_tag(&contact_id, &tag)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_remove_contact_tag(
    state: State<'_, SmtpServiceState>,
    contact_id: String,
    tag: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .remove_tag(&contact_id, &tag)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_all_contact_tags(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<String>, String> {
    Ok(state.lock().await.contacts().all_tags())
}

// ── Contact Groups ───────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_create_contact_group(
    state: State<'_, SmtpServiceState>,
    group: ContactGroup,
) -> Result<String, String> {
    state
        .lock()
        .await
        .contacts_mut()
        .create_group(group)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_delete_contact_group(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .delete_group(&id)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_rename_contact_group(
    state: State<'_, SmtpServiceState>,
    id: String,
    new_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .contacts_mut()
        .rename_group(&id, &new_name)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_list_contact_groups(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<ContactGroup>, String> {
    Ok(state.lock().await.contacts().list_groups().to_vec())
}

#[tauri::command]
pub async fn smtp_get_contact_group(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<Option<ContactGroup>, String> {
    Ok(state.lock().await.contacts().get_group(&id).cloned())
}

// ── Contact Import/Export ────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_export_contacts_csv(
    state: State<'_, SmtpServiceState>,
) -> Result<String, String> {
    Ok(state.lock().await.contacts().export_csv())
}

#[tauri::command]
pub async fn smtp_import_contacts_csv(
    state: State<'_, SmtpServiceState>,
    csv: String,
) -> Result<usize, String> {
    state
        .lock()
        .await
        .contacts_mut()
        .import_csv(&csv)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_export_contacts_json(
    state: State<'_, SmtpServiceState>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .contacts()
        .export_json()
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_import_contacts_json(
    state: State<'_, SmtpServiceState>,
    json: String,
) -> Result<usize, String> {
    state
        .lock()
        .await
        .contacts_mut()
        .import_json(&json)
        .map_err(err_str)
}

// ── Send ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_send_email(
    state: State<'_, SmtpServiceState>,
    message: EmailMessage,
    profile_name: Option<String>,
) -> Result<SendResult, String> {
    state
        .lock()
        .await
        .send_email(&message, profile_name.as_deref())
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_enqueue(
    state: State<'_, SmtpServiceState>,
    message: EmailMessage,
    profile_name: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enqueue(message, profile_name)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_enqueue_scheduled(
    state: State<'_, SmtpServiceState>,
    message: EmailMessage,
    schedule: SendSchedule,
    profile_name: Option<String>,
) -> Result<String, String> {
    state
        .lock()
        .await
        .enqueue_scheduled(message, schedule, profile_name)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_process_queue(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<SendResult>, String> {
    Ok(state.lock().await.process_queue().await)
}

#[tauri::command]
pub async fn smtp_bulk_enqueue(
    state: State<'_, SmtpServiceState>,
    request: BulkSendRequest,
) -> Result<BulkSendResult, String> {
    state
        .lock()
        .await
        .bulk_enqueue(&request)
        .map_err(err_str)
}

// ── Queue ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_queue_summary(
    state: State<'_, SmtpServiceState>,
) -> Result<QueueSummary, String> {
    Ok(state.lock().await.queue_summary())
}

#[tauri::command]
pub async fn smtp_queue_list(
    state: State<'_, SmtpServiceState>,
) -> Result<Vec<QueueItem>, String> {
    Ok(state
        .lock()
        .await
        .queue_list()
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn smtp_queue_get(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<Option<QueueItem>, String> {
    Ok(state.lock().await.queue_get(&id).cloned())
}

#[tauri::command]
pub async fn smtp_queue_cancel(
    state: State<'_, SmtpServiceState>,
    id: String,
) -> Result<(), String> {
    state.lock().await.queue_cancel(&id).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_queue_retry_failed(
    state: State<'_, SmtpServiceState>,
) -> Result<usize, String> {
    Ok(state.lock().await.queue_retry_failed())
}

#[tauri::command]
pub async fn smtp_queue_purge_completed(
    state: State<'_, SmtpServiceState>,
) -> Result<usize, String> {
    Ok(state.lock().await.queue_purge_completed())
}

#[tauri::command]
pub async fn smtp_queue_clear(
    state: State<'_, SmtpServiceState>,
) -> Result<usize, String> {
    Ok(state.lock().await.queue_clear())
}

#[tauri::command]
pub async fn smtp_set_queue_config(
    state: State<'_, SmtpServiceState>,
    config: QueueConfig,
) -> Result<(), String> {
    state.lock().await.set_queue_config(config);
    Ok(())
}

#[tauri::command]
pub async fn smtp_get_queue_config(
    state: State<'_, SmtpServiceState>,
) -> Result<QueueConfig, String> {
    Ok(state.lock().await.queue_config().clone())
}

// ── Diagnostics ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_run_diagnostics(
    state: State<'_, SmtpServiceState>,
    domain: String,
) -> Result<DiagnosticsReport, String> {
    Ok(state.lock().await.run_diagnostics(&domain).await)
}

#[tauri::command]
pub async fn smtp_quick_deliverability_check(
    state: State<'_, SmtpServiceState>,
    domain: String,
) -> Result<String, String> {
    state
        .lock()
        .await
        .quick_deliverability_check(&domain)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_lookup_mx(
    state: State<'_, SmtpServiceState>,
    domain: String,
) -> Result<Vec<MxRecord>, String> {
    Ok(state.lock().await.lookup_mx(&domain).await)
}

#[tauri::command]
pub async fn smtp_check_port(
    state: State<'_, SmtpServiceState>,
    host: String,
    port: u16,
) -> Result<u64, String> {
    state
        .lock()
        .await
        .check_port(&host, port)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_suggest_security(
    state: State<'_, SmtpServiceState>,
    host: String,
) -> Result<(u16, SmtpSecurity), String> {
    Ok(state.lock().await.suggest_security(&host).await)
}

#[tauri::command]
pub async fn smtp_get_dns_txt(
    state: State<'_, SmtpServiceState>,
    domain: String,
) -> Result<Vec<String>, String> {
    Ok(state.lock().await.get_dns_txt(&domain).await)
}

// ── DKIM ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_validate_dkim_config(
    state: State<'_, SmtpServiceState>,
    config: DkimConfig,
) -> Result<(), String> {
    state
        .lock()
        .await
        .validate_dkim_config(&config)
        .map_err(err_str)
}

#[tauri::command]
pub async fn smtp_generate_dkim_dns_record(
    state: State<'_, SmtpServiceState>,
    config: DkimConfig,
) -> Result<String, String> {
    state
        .lock()
        .await
        .generate_dkim_dns_record(&config)
        .map_err(err_str)
}

// ── Status ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_connection_summary(
    state: State<'_, SmtpServiceState>,
) -> Result<SmtpConnectionSummary, String> {
    Ok(state.lock().await.connection_summary())
}

#[tauri::command]
pub async fn smtp_stats(
    state: State<'_, SmtpServiceState>,
) -> Result<SmtpStats, String> {
    Ok(state.lock().await.stats())
}

// ── Message Utilities ────────────────────────────────────────────────

#[tauri::command]
pub async fn smtp_build_message(
    message: EmailMessage,
) -> Result<String, String> {
    crate::message::build_message(&message).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_validate_email_address(
    address: String,
) -> Result<bool, String> {
    Ok(EmailAddress::new(&address).is_valid())
}

#[tauri::command]
pub async fn smtp_parse_email_address(
    input: String,
) -> Result<EmailAddress, String> {
    EmailAddress::parse(&input).map_err(err_str)
}

#[tauri::command]
pub async fn smtp_reverse_dns(
    host: String,
) -> Result<Option<String>, String> {
    Ok(crate::diagnostics::reverse_lookup(&host))
}
