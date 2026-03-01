// ── Tauri command bindings ────────────────────────────────────────────────────
//
// Thin wrappers that take `State<KeePassServiceState>`, lock the mutex, and
// delegate to the service methods.  Every command returns `Result<T, String>`.

use super::types::*;
use super::service::KeePassServiceState;

// ─── Database Lifecycle ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_create_database(
    state: tauri::State<'_, KeePassServiceState>,
    req: CreateDatabaseRequest,
) -> Result<KeePassDatabase, String> {
    let mut svc = state.lock().await;
    svc.create_database(req)
}

#[tauri::command]
pub async fn keepass_open_database(
    state: tauri::State<'_, KeePassServiceState>,
    req: OpenDatabaseRequest,
) -> Result<KeePassDatabase, String> {
    let mut svc = state.lock().await;
    svc.open_database(req)
}

#[tauri::command]
pub async fn keepass_close_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    save_first: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.close_database(&db_id, save_first)
}

#[tauri::command]
pub async fn keepass_close_all_databases(
    state: tauri::State<'_, KeePassServiceState>,
    save_first: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.close_all_databases(save_first);
    Ok(())
}

#[tauri::command]
pub async fn keepass_save_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    options: Option<SaveDatabaseOptions>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.save_database(&db_id, options).map(|_| ())
}

#[tauri::command]
pub async fn keepass_lock_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.lock_database(&db_id)
}

#[tauri::command]
pub async fn keepass_unlock_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    password: Option<String>,
    key_file_path: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.unlock_database(&db_id, password.as_deref(), key_file_path.as_deref())
}

#[tauri::command]
pub async fn keepass_list_databases(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<Vec<KeePassDatabase>, String> {
    let svc = state.lock().await;
    Ok(svc.list_databases())
}

#[tauri::command]
pub async fn keepass_backup_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    backup_dir: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.backup_database(&db_id, backup_dir.as_deref())
}

#[tauri::command]
pub async fn keepass_list_backups(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<DatabaseFileInfo>, String> {
    let svc = state.lock().await;
    svc.list_backups(&db_id)
}

#[tauri::command]
pub async fn keepass_change_master_key(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    current_password: Option<String>,
    current_key_file: Option<String>,
    new_password: Option<String>,
    new_key_file: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.change_master_key(
        &db_id,
        current_password.as_deref(),
        current_key_file.as_deref(),
        new_password.as_deref(),
        new_key_file.as_deref(),
    )
}

#[tauri::command]
pub async fn keepass_get_database_file_info(
    file_path: String,
) -> Result<DatabaseFileInfo, String> {
    super::service::KeePassService::get_database_file_info(&file_path)
}

#[tauri::command]
pub async fn keepass_get_database_statistics(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<DatabaseStatistics, String> {
    let svc = state.lock().await;
    svc.get_database_statistics(&db_id)
}

#[tauri::command]
pub async fn keepass_merge_database(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    _source_file_path: String,
    config: MergeConfig,
) -> Result<MergeResult, String> {
    let mut svc = state.lock().await;
    svc.merge_database(&db_id, config)
}

#[tauri::command]
pub async fn keepass_update_database_metadata(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    name: Option<String>,
    description: Option<String>,
    default_username: Option<String>,
    color: Option<String>,
    recycle_bin_enabled: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_database_metadata(&db_id, name.as_deref(), description.as_deref(), default_username.as_deref(), color.as_deref(), recycle_bin_enabled).map(|_| ())
}

// ─── Entries ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_create_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    req: EntryRequest,
) -> Result<KeePassEntry, String> {
    let mut svc = state.lock().await;
    svc.create_entry(&db_id, req)
}

#[tauri::command]
pub async fn keepass_get_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
) -> Result<KeePassEntry, String> {
    let svc = state.lock().await;
    svc.get_entry(&db_id, &entry_uuid)
}

#[tauri::command]
pub async fn keepass_list_entries_in_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.list_entries_in_group(&db_id, &group_uuid)
}

#[tauri::command]
pub async fn keepass_list_all_entries(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.list_all_entries(&db_id)
}

#[tauri::command]
pub async fn keepass_list_entries_recursive(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.list_entries_recursive(&db_id, &group_uuid)
}

#[tauri::command]
pub async fn keepass_update_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    req: EntryRequest,
) -> Result<KeePassEntry, String> {
    let mut svc = state.lock().await;
    svc.update_entry(&db_id, &entry_uuid, req)
}

#[tauri::command]
pub async fn keepass_delete_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    permanent: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_entry(&db_id, &entry_uuid, permanent)
}

#[tauri::command]
pub async fn keepass_restore_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    target_group_uuid: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.restore_entry(&db_id, &entry_uuid, target_group_uuid.as_deref()).map(|_| ())
}

#[tauri::command]
pub async fn keepass_empty_recycle_bin(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.empty_recycle_bin(&db_id)
}

#[tauri::command]
pub async fn keepass_move_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    target_group_uuid: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.move_entry(&db_id, &entry_uuid, &target_group_uuid)
}

#[tauri::command]
pub async fn keepass_copy_entry(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    target_group_uuid: String,
) -> Result<KeePassEntry, String> {
    let mut svc = state.lock().await;
    svc.copy_entry(&db_id, &entry_uuid, Some(&target_group_uuid))
}

// ─── Entry History ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_get_entry_history(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
) -> Result<Vec<EntryHistoryItem>, String> {
    let svc = state.lock().await;
    svc.get_entry_history(&db_id, &entry_uuid)
}

#[tauri::command]
pub async fn keepass_get_entry_history_item(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    history_index: usize,
) -> Result<EntryHistoryItem, String> {
    let svc = state.lock().await;
    svc.get_entry_history_item(&db_id, &entry_uuid, history_index)
}

#[tauri::command]
pub async fn keepass_restore_entry_from_history(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    history_index: usize,
) -> Result<KeePassEntry, String> {
    let mut svc = state.lock().await;
    svc.restore_entry_from_history(&db_id, &entry_uuid, history_index)
}

#[tauri::command]
pub async fn keepass_delete_entry_history(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_entry_history(&db_id, &entry_uuid)
}

#[tauri::command]
pub async fn keepass_diff_entry_with_history(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    history_index: usize,
) -> Result<EntryDiff, String> {
    let svc = state.lock().await;
    svc.diff_entry_with_history(&db_id, &entry_uuid, history_index)
}

// ─── OTP ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_get_entry_otp(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
) -> Result<OtpValue, String> {
    let svc = state.lock().await;
    svc.get_entry_otp(&db_id, &entry_uuid)
}

// ─── Password Health ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_password_health_report(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<PasswordHealthReport, String> {
    let svc = state.lock().await;
    svc.password_health_report(&db_id)
}

// ─── Groups ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_create_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    req: GroupRequest,
) -> Result<KeePassGroup, String> {
    let mut svc = state.lock().await;
    svc.create_group(&db_id, req)
}

#[tauri::command]
pub async fn keepass_get_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
) -> Result<KeePassGroup, String> {
    let svc = state.lock().await;
    svc.get_group(&db_id, &group_uuid)
}

#[tauri::command]
pub async fn keepass_list_groups(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<KeePassGroup>, String> {
    let svc = state.lock().await;
    svc.list_groups(&db_id)
}

#[tauri::command]
pub async fn keepass_list_child_groups(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    parent_uuid: String,
) -> Result<Vec<KeePassGroup>, String> {
    let svc = state.lock().await;
    svc.list_child_groups(&db_id, &parent_uuid)
}

#[tauri::command]
pub async fn keepass_get_group_tree(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<GroupTreeNode, String> {
    let svc = state.lock().await;
    svc.get_group_tree(&db_id)
}

#[tauri::command]
pub async fn keepass_get_group_path(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_group_path(&db_id, &group_uuid)
}

#[tauri::command]
pub async fn keepass_update_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
    req: GroupRequest,
) -> Result<KeePassGroup, String> {
    let mut svc = state.lock().await;
    svc.update_group(&db_id, &group_uuid, req)
}

#[tauri::command]
pub async fn keepass_delete_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
    permanent: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_group(&db_id, &group_uuid, permanent).map(|_| ())
}

#[tauri::command]
pub async fn keepass_move_group(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
    new_parent_uuid: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.move_group(&db_id, &group_uuid, &new_parent_uuid)
}

#[tauri::command]
pub async fn keepass_sort_groups(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    parent_uuid: String,
) -> Result<Vec<KeePassGroup>, String> {
    let svc = state.lock().await;
    svc.sort_groups(&db_id, &parent_uuid)
}

#[tauri::command]
pub async fn keepass_group_entry_count(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
    recursive: bool,
) -> Result<usize, String> {
    let svc = state.lock().await;
    svc.group_entry_count(&db_id, &group_uuid, recursive)
}

#[tauri::command]
pub async fn keepass_group_tags(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    group_uuid: String,
) -> Result<Vec<TagCount>, String> {
    let svc = state.lock().await;
    svc.group_tags(&db_id, &group_uuid)
}

// ─── Custom Icons ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_add_custom_icon(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    icon_data_base64: String,
    _name: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.add_custom_icon(&db_id, &icon_data_base64)
}

#[tauri::command]
pub async fn keepass_get_custom_icon(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    icon_uuid: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_custom_icon(&db_id, &icon_uuid)
}

#[tauri::command]
pub async fn keepass_list_custom_icons(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.list_custom_icons(&db_id)
}

#[tauri::command]
pub async fn keepass_delete_custom_icon(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    icon_uuid: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_custom_icon(&db_id, &icon_uuid)
}

// ─── Password Generation & Analysis ─────────────────────────────────────────

#[tauri::command]
pub async fn keepass_generate_password(
    state: tauri::State<'_, KeePassServiceState>,
    req: PasswordGeneratorRequest,
) -> Result<GeneratedPassword, String> {
    let svc = state.lock().await;
    svc.generate_password(req)
}

#[tauri::command]
pub async fn keepass_generate_passwords(
    state: tauri::State<'_, KeePassServiceState>,
    req: PasswordGeneratorRequest,
) -> Result<Vec<GeneratedPassword>, String> {
    let svc = state.lock().await;
    svc.generate_passwords(req)
}

#[tauri::command]
pub async fn keepass_analyze_password(
    password: String,
) -> Result<PasswordAnalysis, String> {
    Ok(super::service::KeePassService::analyze_password(&password))
}

// ─── Password Profiles ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_list_password_profiles(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<Vec<PasswordProfile>, String> {
    let svc = state.lock().await;
    Ok(svc.list_password_profiles())
}

#[tauri::command]
pub async fn keepass_add_password_profile(
    state: tauri::State<'_, KeePassServiceState>,
    profile: PasswordProfile,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.save_password_profile(profile);
    Ok(())
}

#[tauri::command]
pub async fn keepass_remove_password_profile(
    state: tauri::State<'_, KeePassServiceState>,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_password_profile(&name)
}

// ─── Key File ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_create_key_file(
    req: CreateKeyFileRequest,
) -> Result<KeyFileInfo, String> {
    super::service::KeePassService::create_key_file(req)
}

#[tauri::command]
pub async fn keepass_verify_key_file(
    file_path: String,
) -> Result<KeyFileInfo, String> {
    super::service::KeePassService::verify_key_file(&file_path)
}

// ─── Search ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_search_entries(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: Option<String>,
    query: SearchQuery,
) -> Result<SearchResult, String> {
    let svc = state.lock().await;
    svc.search_entries(db_id.as_deref(), query)
}

#[tauri::command]
pub async fn keepass_quick_search(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    term: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.quick_search(&db_id, &term)
}

#[tauri::command]
pub async fn keepass_find_entries_for_url(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    url: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.find_entries_for_url(&db_id, &url)
}

#[tauri::command]
pub async fn keepass_find_duplicates(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<Vec<EntrySummary>>, String> {
    let svc = state.lock().await;
    svc.find_duplicates(&db_id)
}

#[tauri::command]
pub async fn keepass_find_expiring_entries(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    days: u32,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.find_expiring_entries(&db_id, days)
}

#[tauri::command]
pub async fn keepass_find_weak_passwords(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    max_strength: PasswordStrength,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.find_weak_passwords(&db_id, max_strength)
}

#[tauri::command]
pub async fn keepass_find_entries_without_password(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.find_entries_without_password(&db_id)
}

#[tauri::command]
pub async fn keepass_get_all_tags(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<TagCount>, String> {
    let svc = state.lock().await;
    svc.get_all_tags(&db_id)
}

#[tauri::command]
pub async fn keepass_find_entries_by_tag(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    tag: String,
) -> Result<Vec<EntrySummary>, String> {
    let svc = state.lock().await;
    svc.find_entries_by_tag(&db_id, &tag)
}

// ─── Import / Export ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_import_entries(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    config: ImportConfig,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_entries(&db_id, config)
}

#[tauri::command]
pub async fn keepass_export_entries(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    config: ExportConfig,
) -> Result<ExportResult, String> {
    let svc = state.lock().await;
    svc.export_entries(&db_id, config)
}

// ─── Auto-Type ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_parse_autotype_sequence(
    sequence: String,
) -> Result<Vec<AutoTypeToken>, String> {
    Ok(super::service::KeePassService::parse_autotype_sequence(&sequence))
}

#[tauri::command]
pub async fn keepass_resolve_autotype_sequence(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    sequence: Option<String>,
) -> Result<Vec<AutoTypeToken>, String> {
    let svc = state.lock().await;
    svc.resolve_autotype_sequence(&db_id, &entry_uuid, sequence.as_deref())
}

#[tauri::command]
pub async fn keepass_find_autotype_matches(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    window_title: String,
) -> Result<Vec<AutoTypeMatch>, String> {
    let svc = state.lock().await;
    svc.find_autotype_matches(&db_id, &window_title)
}

#[tauri::command]
pub async fn keepass_list_autotype_associations(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<AutoTypeMatch>, String> {
    let svc = state.lock().await;
    svc.list_autotype_associations(&db_id)
}

#[tauri::command]
pub async fn keepass_validate_autotype_sequence(
    sequence: String,
) -> Result<Vec<String>, String> {
    super::service::KeePassService::validate_autotype_sequence(&sequence)
}

#[tauri::command]
pub async fn keepass_get_default_autotype_sequence() -> Result<String, String> {
    Ok(super::service::KeePassService::get_default_autotype_sequence())
}

// ─── Attachments ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_add_attachment(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    req: AddAttachmentRequest,
) -> Result<KeePassAttachment, String> {
    let mut svc = state.lock().await;
    svc.add_attachment(&db_id, req)
}

#[tauri::command]
pub async fn keepass_get_entry_attachments(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
) -> Result<Vec<KeePassAttachment>, String> {
    let svc = state.lock().await;
    svc.get_entry_attachments(&db_id, &entry_uuid)
}

#[tauri::command]
pub async fn keepass_get_attachment_data(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    ref_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_attachment_data(&db_id, &entry_uuid, &ref_id)
}

#[tauri::command]
pub async fn keepass_remove_attachment(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    ref_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_attachment(&db_id, &entry_uuid, &ref_id)
}

#[tauri::command]
pub async fn keepass_rename_attachment(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    ref_id: String,
    new_filename: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename_attachment(&db_id, &entry_uuid, &ref_id, new_filename)
}

#[tauri::command]
pub async fn keepass_save_attachment_to_file(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    ref_id: String,
    output_path: String,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.save_attachment_to_file(&db_id, &entry_uuid, &ref_id, &output_path)
}

#[tauri::command]
pub async fn keepass_import_attachment_from_file(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
    entry_uuid: String,
    file_path: String,
) -> Result<KeePassAttachment, String> {
    let mut svc = state.lock().await;
    svc.import_attachment_from_file(&db_id, &entry_uuid, &file_path)
}

#[tauri::command]
pub async fn keepass_get_attachment_pool_size(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<(usize, u64), String> {
    let svc = state.lock().await;
    svc.get_attachment_pool_size(&db_id)
}

#[tauri::command]
pub async fn keepass_compact_attachment_pool(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.compact_attachment_pool(&db_id)
}

#[tauri::command]
pub async fn keepass_verify_attachment_integrity(
    state: tauri::State<'_, KeePassServiceState>,
    db_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.verify_attachment_integrity(&db_id)
}

// ─── Recent Databases ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_list_recent_databases(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<Vec<RecentDatabase>, String> {
    let svc = state.lock().await;
    Ok(svc.list_recent_databases())
}

#[tauri::command]
pub async fn keepass_add_recent_database(
    state: tauri::State<'_, KeePassServiceState>,
    file_path: String,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_recent_database(&file_path, &name);
    Ok(())
}

#[tauri::command]
pub async fn keepass_remove_recent_database(
    state: tauri::State<'_, KeePassServiceState>,
    file_path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_recent_database(&file_path);
    Ok(())
}

#[tauri::command]
pub async fn keepass_clear_recent_databases(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_recent_databases();
    Ok(())
}

// ─── Change Log ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_get_change_log(
    state: tauri::State<'_, KeePassServiceState>,
    _db_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ChangeLogEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.get_change_log(limit))
}

// ─── Settings ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_get_settings(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    serde_json::to_value(svc.get_settings())
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
pub async fn keepass_update_settings(
    state: tauri::State<'_, KeePassServiceState>,
    settings_json: serde_json::Value,
) -> Result<(), String> {
    let settings: super::service::KeePassSettings = serde_json::from_value(settings_json)
        .map_err(|e| format!("Invalid settings: {}", e))?;
    let mut svc = state.lock().await;
    svc.update_settings(settings);
    Ok(())
}

// ─── Service Lifecycle ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn keepass_shutdown(
    state: tauri::State<'_, KeePassServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.shutdown();
    Ok(())
}
