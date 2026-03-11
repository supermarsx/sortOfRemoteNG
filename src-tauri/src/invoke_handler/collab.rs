use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "mrng_detect_format"
            | "mrng_get_import_formats"
            | "mrng_get_export_formats"
            | "mrng_import_xml"
            | "mrng_import_xml_as_connections"
            | "mrng_import_csv"
            | "mrng_import_csv_as_connections"
            | "mrng_import_rdp_files"
            | "mrng_import_rdp_as_connections"
            | "mrng_import_putty_reg"
            | "mrng_import_putty_registry"
            | "mrng_import_putty_as_connections"
            | "mrng_import_auto"
            | "mrng_import_auto_as_connections"
            | "mrng_export_xml"
            | "mrng_export_app_to_xml"
            | "mrng_export_csv"
            | "mrng_export_app_to_csv"
            | "mrng_export_rdp_file"
            | "mrng_export_app_to_rdp"
            | "mrng_validate_xml"
            | "mrng_get_last_import"
            | "mrng_get_last_export"
            | "mrng_set_password"
            | "mrng_set_kdf_iterations"
            | "ts_get_config"
            | "ts_set_config"
            | "ts_open_server"
            | "ts_close_server"
            | "ts_close_all_servers"
            | "ts_list_open_servers"
            | "ts_list_sessions"
            | "ts_list_user_sessions"
            | "ts_get_session_detail"
            | "ts_get_all_session_details"
            | "ts_disconnect_session"
            | "ts_logoff_session"
            | "ts_connect_session"
            | "ts_logoff_disconnected"
            | "ts_find_sessions_by_user"
            | "ts_server_summary"
            | "ts_get_console_session_id"
            | "ts_get_current_session_id"
            | "ts_is_remote_session"
            | "ts_get_idle_seconds"
            | "ts_list_processes"
            | "ts_list_session_processes"
            | "ts_find_processes_by_name"
            | "ts_terminate_process"
            | "ts_terminate_processes_by_name"
            | "ts_process_count_per_session"
            | "ts_top_process_names"
            | "ts_send_message"
            | "ts_send_info"
            | "ts_broadcast_message"
            | "ts_start_shadow"
            | "ts_stop_shadow"
            | "ts_enumerate_domain_servers"
            | "ts_shutdown_server"
            | "ts_list_listeners"
            | "ts_query_user_config"
            | "ts_set_user_config"
            | "ts_get_encryption_level"
            | "ts_get_session_address"
            | "ts_list_sessions_filtered"
            | "ts_batch_disconnect"
            | "ts_batch_logoff"
            | "ts_batch_send_message"
            | "ts_wait_system_event"
            | "wa_configure"
            | "wa_configure_unofficial"
            | "wa_is_configured"
            | "wa_send_text"
            | "wa_send_image"
            | "wa_send_document"
            | "wa_send_video"
            | "wa_send_audio"
            | "wa_send_location"
            | "wa_send_reaction"
            | "wa_send_template"
            | "wa_mark_as_read"
            | "wa_upload_media"
            | "wa_upload_media_file"
            | "wa_get_media_url"
            | "wa_download_media"
            | "wa_delete_media"
            | "wa_create_template"
            | "wa_list_templates"
            | "wa_delete_template"
            | "wa_check_contact"
            | "wa_me_link"
            | "wa_create_group"
            | "wa_get_group_info"
            | "wa_get_business_profile"
            | "wa_list_phone_numbers"
            | "wa_webhook_verify"
            | "wa_webhook_process"
            | "wa_list_sessions"
            | "wa_unofficial_connect"
            | "wa_unofficial_disconnect"
            | "wa_unofficial_state"
            | "wa_unofficial_send_text"
            | "wa_pairing_start_qr"
            | "wa_pairing_refresh_qr"
            | "wa_pairing_start_phone"
            | "wa_pairing_state"
            | "wa_pairing_cancel"
            | "wa_get_messages"
            | "wa_send_auto"
            | "telegram_add_bot"
            | "telegram_remove_bot"
            | "telegram_list_bots"
            | "telegram_validate_bot"
            | "telegram_set_bot_enabled"
            | "telegram_update_bot_token"
            | "telegram_send_message"
            | "telegram_send_photo"
            | "telegram_send_document"
            | "telegram_send_video"
            | "telegram_send_audio"
            | "telegram_send_voice"
            | "telegram_send_location"
            | "telegram_send_contact"
            | "telegram_send_poll"
            | "telegram_send_dice"
            | "telegram_send_sticker"
            | "telegram_send_chat_action"
            | "telegram_edit_message_text"
            | "telegram_edit_message_caption"
            | "telegram_edit_message_reply_markup"
            | "telegram_delete_message"
            | "telegram_forward_message"
            | "telegram_copy_message"
            | "telegram_pin_message"
            | "telegram_unpin_message"
            | "telegram_unpin_all_messages"
            | "telegram_answer_callback_query"
            | "telegram_get_chat"
            | "telegram_get_chat_member_count"
            | "telegram_get_chat_member"
            | "telegram_get_chat_administrators"
            | "telegram_set_chat_title"
            | "telegram_set_chat_description"
            | "telegram_ban_chat_member"
            | "telegram_unban_chat_member"
            | "telegram_restrict_chat_member"
            | "telegram_promote_chat_member"
            | "telegram_leave_chat"
            | "telegram_export_chat_invite_link"
            | "telegram_create_invite_link"
            | "telegram_get_file"
            | "telegram_download_file"
            | "telegram_upload_file"
            | "telegram_get_updates"
            | "telegram_set_webhook"
            | "telegram_delete_webhook"
            | "telegram_get_webhook_info"
            | "telegram_add_notification_rule"
            | "telegram_remove_notification_rule"
            | "telegram_list_notification_rules"
            | "telegram_set_notification_rule_enabled"
            | "telegram_process_connection_event"
            | "telegram_add_monitoring_check"
            | "telegram_remove_monitoring_check"
            | "telegram_list_monitoring_checks"
            | "telegram_set_monitoring_check_enabled"
            | "telegram_monitoring_summary"
            | "telegram_record_monitoring_result"
            | "telegram_add_template"
            | "telegram_remove_template"
            | "telegram_list_templates"
            | "telegram_render_template"
            | "telegram_validate_template_body"
            | "telegram_send_template"
            | "telegram_schedule_message"
            | "telegram_cancel_scheduled_message"
            | "telegram_list_scheduled_messages"
            | "telegram_process_scheduled_messages"
            | "telegram_broadcast"
            | "telegram_add_digest"
            | "telegram_remove_digest"
            | "telegram_list_digests"
            | "telegram_stats"
            | "telegram_message_log"
            | "telegram_clear_message_log"
            | "telegram_notification_history"
            | "telegram_monitoring_history"
            | "dropbox_configure"
            | "dropbox_set_token"
            | "dropbox_disconnect"
            | "dropbox_is_connected"
            | "dropbox_masked_token"
            | "dropbox_start_auth"
            | "dropbox_finish_auth"
            | "dropbox_refresh_token"
            | "dropbox_revoke_token"
            | "dropbox_upload"
            | "dropbox_download"
            | "dropbox_get_metadata"
            | "dropbox_move_file"
            | "dropbox_copy_file"
            | "dropbox_delete"
            | "dropbox_delete_batch"
            | "dropbox_move_batch"
            | "dropbox_copy_batch"
            | "dropbox_search"
            | "dropbox_search_continue"
            | "dropbox_list_revisions"
            | "dropbox_restore"
            | "dropbox_get_thumbnail"
            | "dropbox_content_hash"
            | "dropbox_guess_mime"
            | "dropbox_upload_session_start"
            | "dropbox_upload_session_append"
            | "dropbox_upload_session_finish"
            | "dropbox_check_job_status"
            | "dropbox_create_folder"
            | "dropbox_list_folder"
            | "dropbox_list_folder_continue"
            | "dropbox_get_latest_cursor"
            | "dropbox_create_folder_batch"
            | "dropbox_breadcrumbs"
            | "dropbox_parent_path"
            | "dropbox_create_shared_link"
            | "dropbox_list_shared_links"
            | "dropbox_revoke_shared_link"
            | "dropbox_share_folder"
            | "dropbox_unshare_folder"
            | "dropbox_list_folder_members"
            | "dropbox_list_shared_folders"
            | "dropbox_mount_folder"
            | "dropbox_get_shared_link_metadata"
            | "dropbox_shared_link_to_direct"
            | "dropbox_get_current_account"
            | "dropbox_get_space_usage"
            | "dropbox_format_space_usage"
            | "dropbox_is_space_critical"
            | "dropbox_get_account"
            | "dropbox_get_features"
            | "dropbox_get_team_info"
            | "dropbox_team_members_list"
            | "dropbox_team_members_list_continue"
            | "dropbox_team_members_get_info"
            | "dropbox_team_member_suspend"
            | "dropbox_team_member_unsuspend"
            | "dropbox_paper_create"
            | "dropbox_paper_update"
            | "dropbox_paper_list"
            | "dropbox_paper_archive"
            | "dropbox_sync_create"
            | "dropbox_sync_remove"
            | "dropbox_sync_list"
            | "dropbox_sync_set_enabled"
            | "dropbox_sync_set_interval"
            | "dropbox_sync_set_exclude_patterns"
            | "dropbox_backup_create"
            | "dropbox_backup_remove"
            | "dropbox_backup_list"
            | "dropbox_backup_set_enabled"
            | "dropbox_backup_set_max_revisions"
            | "dropbox_backup_set_interval"
            | "dropbox_backup_get_history"
            | "dropbox_backup_total_size"
            | "dropbox_watch_create"
            | "dropbox_watch_remove"
            | "dropbox_watch_list"
            | "dropbox_watch_set_enabled"
            | "dropbox_watch_get_changes"
            | "dropbox_watch_clear_changes"
            | "dropbox_watch_total_pending"
            | "dropbox_get_activity_log"
            | "dropbox_clear_activity_log"
            | "dropbox_get_stats"
            | "dropbox_reset_stats"
            | "dropbox_longpoll"
            | "nextcloud_configure"
            | "nextcloud_set_bearer_token"
            | "nextcloud_configure_oauth2"
            | "nextcloud_disconnect"
            | "nextcloud_is_connected"
            | "nextcloud_masked_credential"
            | "nextcloud_get_server_url"
            | "nextcloud_get_username"
            | "nextcloud_start_login_flow"
            | "nextcloud_poll_login_flow"
            | "nextcloud_start_oauth2"
            | "nextcloud_exchange_oauth2_code"
            | "nextcloud_refresh_oauth2_token"
            | "nextcloud_validate_credentials"
            | "nextcloud_revoke_app_password"
            | "nextcloud_upload"
            | "nextcloud_download"
            | "nextcloud_get_metadata"
            | "nextcloud_move_file"
            | "nextcloud_copy_file"
            | "nextcloud_delete_file"
            | "nextcloud_set_favorite"
            | "nextcloud_set_tags"
            | "nextcloud_list_versions"
            | "nextcloud_restore_version"
            | "nextcloud_list_trash"
            | "nextcloud_restore_trash_item"
            | "nextcloud_delete_trash_item"
            | "nextcloud_empty_trash"
            | "nextcloud_search"
            | "nextcloud_content_hash"
            | "nextcloud_guess_mime"
            | "nextcloud_get_preview"
            | "nextcloud_create_folder"
            | "nextcloud_create_folder_recursive"
            | "nextcloud_list_folder"
            | "nextcloud_list_files"
            | "nextcloud_list_subfolders"
            | "nextcloud_list_folder_recursive"
            | "nextcloud_breadcrumbs"
            | "nextcloud_parent_path"
            | "nextcloud_join_path"
            | "nextcloud_filename"
            | "nextcloud_create_share"
            | "nextcloud_create_public_link"
            | "nextcloud_list_shares"
            | "nextcloud_list_shares_for_path"
            | "nextcloud_list_shared_with_me"
            | "nextcloud_list_pending_shares"
            | "nextcloud_get_share"
            | "nextcloud_update_share"
            | "nextcloud_delete_share"
            | "nextcloud_accept_remote_share"
            | "nextcloud_decline_remote_share"
            | "nextcloud_share_url"
            | "nextcloud_share_download_url"
            | "nextcloud_get_current_user"
            | "nextcloud_get_quota"
            | "nextcloud_get_user"
            | "nextcloud_list_users"
            | "nextcloud_list_groups"
            | "nextcloud_get_capabilities"
            | "nextcloud_get_server_status"
            | "nextcloud_list_notifications"
            | "nextcloud_delete_notification"
            | "nextcloud_delete_all_notifications"
            | "nextcloud_list_external_storages"
            | "nextcloud_avatar_url"
            | "nextcloud_get_avatar"
            | "nextcloud_format_bytes"
            | "nextcloud_format_quota"
            | "nextcloud_list_activities"
            | "nextcloud_activities_for_file"
            | "nextcloud_recent_activities"
            | "nextcloud_list_activity_filters"
            | "nextcloud_sync_add"
            | "nextcloud_sync_remove"
            | "nextcloud_sync_list"
            | "nextcloud_sync_set_enabled"
            | "nextcloud_sync_set_interval"
            | "nextcloud_sync_set_exclude_patterns"
            | "nextcloud_backup_add"
            | "nextcloud_backup_remove"
            | "nextcloud_backup_list"
            | "nextcloud_backup_set_enabled"
            | "nextcloud_backup_set_max_versions"
            | "nextcloud_backup_set_interval"
            | "nextcloud_backup_get_history"
            | "nextcloud_backup_total_size"
            | "nextcloud_watch_add"
            | "nextcloud_watch_remove"
            | "nextcloud_watch_list"
            | "nextcloud_watch_set_enabled"
            | "nextcloud_watch_get_changes"
            | "nextcloud_watch_clear_changes"
            | "nextcloud_watch_total_pending"
            | "nextcloud_get_activity_log"
            | "nextcloud_clear_activity_log"
            | "nextcloud_get_stats"
            | "nextcloud_reset_stats"
            | "gdrive_set_credentials"
            | "gdrive_get_auth_url"
            | "gdrive_exchange_code"
            | "gdrive_refresh_token"
            | "gdrive_set_token"
            | "gdrive_get_token"
            | "gdrive_revoke"
            | "gdrive_is_authenticated"
            | "gdrive_connection_summary"
            | "gdrive_get_about"
            | "gdrive_get_file"
            | "gdrive_list_files"
            | "gdrive_create_file"
            | "gdrive_update_file"
            | "gdrive_copy_file"
            | "gdrive_delete_file"
            | "gdrive_trash_file"
            | "gdrive_untrash_file"
            | "gdrive_empty_trash"
            | "gdrive_star_file"
            | "gdrive_rename_file"
            | "gdrive_move_file"
            | "gdrive_generate_ids"
            | "gdrive_create_folder"
            | "gdrive_list_children"
            | "gdrive_list_subfolders"
            | "gdrive_find_folder"
            | "gdrive_upload_file"
            | "gdrive_download_file"
            | "gdrive_export_file"
            | "gdrive_share_with_user"
            | "gdrive_share_with_anyone"
            | "gdrive_list_permissions"
            | "gdrive_delete_permission"
            | "gdrive_unshare_all"
            | "gdrive_list_revisions"
            | "gdrive_pin_revision"
            | "gdrive_list_comments"
            | "gdrive_create_comment"
            | "gdrive_resolve_comment"
            | "gdrive_create_reply"
            | "gdrive_list_drives"
            | "gdrive_create_drive"
            | "gdrive_delete_drive"
            | "gdrive_get_start_page_token"
            | "gdrive_poll_changes"
            | "gdrive_search"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // mRemoteNG commands — Format Detection
        mremoteng_dedicated_commands::mrng_detect_format,
        mremoteng_dedicated_commands::mrng_get_import_formats,
        mremoteng_dedicated_commands::mrng_get_export_formats,
        // mRemoteNG commands — Import
        mremoteng_dedicated_commands::mrng_import_xml,
        mremoteng_dedicated_commands::mrng_import_xml_as_connections,
        mremoteng_dedicated_commands::mrng_import_csv,
        mremoteng_dedicated_commands::mrng_import_csv_as_connections,
        mremoteng_dedicated_commands::mrng_import_rdp_files,
        mremoteng_dedicated_commands::mrng_import_rdp_as_connections,
        mremoteng_dedicated_commands::mrng_import_putty_reg,
        mremoteng_dedicated_commands::mrng_import_putty_registry,
        mremoteng_dedicated_commands::mrng_import_putty_as_connections,
        mremoteng_dedicated_commands::mrng_import_auto,
        mremoteng_dedicated_commands::mrng_import_auto_as_connections,
        // mRemoteNG commands — Export
        mremoteng_dedicated_commands::mrng_export_xml,
        mremoteng_dedicated_commands::mrng_export_app_to_xml,
        mremoteng_dedicated_commands::mrng_export_csv,
        mremoteng_dedicated_commands::mrng_export_app_to_csv,
        mremoteng_dedicated_commands::mrng_export_rdp_file,
        mremoteng_dedicated_commands::mrng_export_app_to_rdp,
        // mRemoteNG commands — Validation / Info
        mremoteng_dedicated_commands::mrng_validate_xml,
        mremoteng_dedicated_commands::mrng_get_last_import,
        mremoteng_dedicated_commands::mrng_get_last_export,
        // mRemoteNG commands — Configuration
        mremoteng_dedicated_commands::mrng_set_password,
        mremoteng_dedicated_commands::mrng_set_kdf_iterations,
        // Terminal Services commands — Config
        termserv_commands::ts_get_config,
        termserv_commands::ts_set_config,
        // Terminal Services commands — Server handles
        termserv_commands::ts_open_server,
        termserv_commands::ts_close_server,
        termserv_commands::ts_close_all_servers,
        termserv_commands::ts_list_open_servers,
        // Terminal Services commands — Sessions
        termserv_commands::ts_list_sessions,
        termserv_commands::ts_list_user_sessions,
        termserv_commands::ts_get_session_detail,
        termserv_commands::ts_get_all_session_details,
        termserv_commands::ts_disconnect_session,
        termserv_commands::ts_logoff_session,
        termserv_commands::ts_connect_session,
        termserv_commands::ts_logoff_disconnected,
        termserv_commands::ts_find_sessions_by_user,
        termserv_commands::ts_server_summary,
        termserv_commands::ts_get_console_session_id,
        termserv_commands::ts_get_current_session_id,
        termserv_commands::ts_is_remote_session,
        termserv_commands::ts_get_idle_seconds,
        // Terminal Services commands — Processes
        termserv_commands::ts_list_processes,
        termserv_commands::ts_list_session_processes,
        termserv_commands::ts_find_processes_by_name,
        termserv_commands::ts_terminate_process,
        termserv_commands::ts_terminate_processes_by_name,
        termserv_commands::ts_process_count_per_session,
        termserv_commands::ts_top_process_names,
        // Terminal Services commands — Messaging
        termserv_commands::ts_send_message,
        termserv_commands::ts_send_info,
        termserv_commands::ts_broadcast_message,
        // Terminal Services commands — Shadow / Remote Control
        termserv_commands::ts_start_shadow,
        termserv_commands::ts_stop_shadow,
        // Terminal Services commands — Server discovery & control
        termserv_commands::ts_enumerate_domain_servers,
        termserv_commands::ts_shutdown_server,
        termserv_commands::ts_list_listeners,
        // Terminal Services commands — User config, encryption, address
        termserv_commands::ts_query_user_config,
        termserv_commands::ts_set_user_config,
        termserv_commands::ts_get_encryption_level,
        termserv_commands::ts_get_session_address,
        // Terminal Services commands — Filtered sessions & batch ops
        termserv_commands::ts_list_sessions_filtered,
        termserv_commands::ts_batch_disconnect,
        termserv_commands::ts_batch_logoff,
        termserv_commands::ts_batch_send_message,
        // Terminal Services commands — Event monitoring
        termserv_commands::ts_wait_system_event,
        // WhatsApp commands — Configuration
        whatsapp_commands::wa_configure,
        whatsapp_commands::wa_configure_unofficial,
        whatsapp_commands::wa_is_configured,
        // WhatsApp commands — Messaging (Official Cloud API)
        whatsapp_commands::wa_send_text,
        whatsapp_commands::wa_send_image,
        whatsapp_commands::wa_send_document,
        whatsapp_commands::wa_send_video,
        whatsapp_commands::wa_send_audio,
        whatsapp_commands::wa_send_location,
        whatsapp_commands::wa_send_reaction,
        whatsapp_commands::wa_send_template,
        whatsapp_commands::wa_mark_as_read,
        // WhatsApp commands — Media
        whatsapp_commands::wa_upload_media,
        whatsapp_commands::wa_upload_media_file,
        whatsapp_commands::wa_get_media_url,
        whatsapp_commands::wa_download_media,
        whatsapp_commands::wa_delete_media,
        // WhatsApp commands — Templates
        whatsapp_commands::wa_create_template,
        whatsapp_commands::wa_list_templates,
        whatsapp_commands::wa_delete_template,
        // WhatsApp commands — Contacts
        whatsapp_commands::wa_check_contact,
        whatsapp_commands::wa_me_link,
        // WhatsApp commands — Groups
        whatsapp_commands::wa_create_group,
        whatsapp_commands::wa_get_group_info,
        // WhatsApp commands — Business Profile & Phone Numbers
        whatsapp_commands::wa_get_business_profile,
        whatsapp_commands::wa_list_phone_numbers,
        // WhatsApp commands — Webhooks
        whatsapp_commands::wa_webhook_verify,
        whatsapp_commands::wa_webhook_process,
        // WhatsApp commands — Sessions
        whatsapp_commands::wa_list_sessions,
        // WhatsApp commands — Unofficial (WA Web)
        whatsapp_commands::wa_unofficial_connect,
        whatsapp_commands::wa_unofficial_disconnect,
        whatsapp_commands::wa_unofficial_state,
        whatsapp_commands::wa_unofficial_send_text,
        // WhatsApp commands — Pairing
        whatsapp_commands::wa_pairing_start_qr,
        whatsapp_commands::wa_pairing_refresh_qr,
        whatsapp_commands::wa_pairing_start_phone,
        whatsapp_commands::wa_pairing_state,
        whatsapp_commands::wa_pairing_cancel,
        // WhatsApp commands — Chat History
        whatsapp_commands::wa_get_messages,
        whatsapp_commands::wa_send_auto,
        // Telegram Bot API commands — Bot management
        telegram_commands::telegram_add_bot,
        telegram_commands::telegram_remove_bot,
        telegram_commands::telegram_list_bots,
        telegram_commands::telegram_validate_bot,
        telegram_commands::telegram_set_bot_enabled,
        telegram_commands::telegram_update_bot_token,
        // Telegram commands — Messaging
        telegram_commands::telegram_send_message,
        telegram_commands::telegram_send_photo,
        telegram_commands::telegram_send_document,
        telegram_commands::telegram_send_video,
        telegram_commands::telegram_send_audio,
        telegram_commands::telegram_send_voice,
        telegram_commands::telegram_send_location,
        telegram_commands::telegram_send_contact,
        telegram_commands::telegram_send_poll,
        telegram_commands::telegram_send_dice,
        telegram_commands::telegram_send_sticker,
        telegram_commands::telegram_send_chat_action,
        // Telegram commands — Message management
        telegram_commands::telegram_edit_message_text,
        telegram_commands::telegram_edit_message_caption,
        telegram_commands::telegram_edit_message_reply_markup,
        telegram_commands::telegram_delete_message,
        telegram_commands::telegram_forward_message,
        telegram_commands::telegram_copy_message,
        telegram_commands::telegram_pin_message,
        telegram_commands::telegram_unpin_message,
        telegram_commands::telegram_unpin_all_messages,
        telegram_commands::telegram_answer_callback_query,
        // Telegram commands — Chat management
        telegram_commands::telegram_get_chat,
        telegram_commands::telegram_get_chat_member_count,
        telegram_commands::telegram_get_chat_member,
        telegram_commands::telegram_get_chat_administrators,
        telegram_commands::telegram_set_chat_title,
        telegram_commands::telegram_set_chat_description,
        telegram_commands::telegram_ban_chat_member,
        telegram_commands::telegram_unban_chat_member,
        telegram_commands::telegram_restrict_chat_member,
        telegram_commands::telegram_promote_chat_member,
        telegram_commands::telegram_leave_chat,
        telegram_commands::telegram_export_chat_invite_link,
        telegram_commands::telegram_create_invite_link,
        // Telegram commands — Files
        telegram_commands::telegram_get_file,
        telegram_commands::telegram_download_file,
        telegram_commands::telegram_upload_file,
        // Telegram commands — Webhooks & Updates
        telegram_commands::telegram_get_updates,
        telegram_commands::telegram_set_webhook,
        telegram_commands::telegram_delete_webhook,
        telegram_commands::telegram_get_webhook_info,
        // Telegram commands — Notification rules
        telegram_commands::telegram_add_notification_rule,
        telegram_commands::telegram_remove_notification_rule,
        telegram_commands::telegram_list_notification_rules,
        telegram_commands::telegram_set_notification_rule_enabled,
        telegram_commands::telegram_process_connection_event,
        // Telegram commands — Monitoring
        telegram_commands::telegram_add_monitoring_check,
        telegram_commands::telegram_remove_monitoring_check,
        telegram_commands::telegram_list_monitoring_checks,
        telegram_commands::telegram_set_monitoring_check_enabled,
        telegram_commands::telegram_monitoring_summary,
        telegram_commands::telegram_record_monitoring_result,
        // Telegram commands — Templates
        telegram_commands::telegram_add_template,
        telegram_commands::telegram_remove_template,
        telegram_commands::telegram_list_templates,
        telegram_commands::telegram_render_template,
        telegram_commands::telegram_validate_template_body,
        telegram_commands::telegram_send_template,
        // Telegram commands — Scheduled messages
        telegram_commands::telegram_schedule_message,
        telegram_commands::telegram_cancel_scheduled_message,
        telegram_commands::telegram_list_scheduled_messages,
        telegram_commands::telegram_process_scheduled_messages,
        // Telegram commands — Broadcast & Digests
        telegram_commands::telegram_broadcast,
        telegram_commands::telegram_add_digest,
        telegram_commands::telegram_remove_digest,
        telegram_commands::telegram_list_digests,
        // Telegram commands — Stats & Logs
        telegram_commands::telegram_stats,
        telegram_commands::telegram_message_log,
        telegram_commands::telegram_clear_message_log,
        telegram_commands::telegram_notification_history,
        telegram_commands::telegram_monitoring_history,
        // Dropbox commands — Configuration & Connection
        dropbox_commands::dropbox_configure,
        dropbox_commands::dropbox_set_token,
        dropbox_commands::dropbox_disconnect,
        dropbox_commands::dropbox_is_connected,
        dropbox_commands::dropbox_masked_token,
        // Dropbox commands — OAuth 2.0 PKCE
        dropbox_commands::dropbox_start_auth,
        dropbox_commands::dropbox_finish_auth,
        dropbox_commands::dropbox_refresh_token,
        dropbox_commands::dropbox_revoke_token,
        // Dropbox commands — File operations
        dropbox_commands::dropbox_upload,
        dropbox_commands::dropbox_download,
        dropbox_commands::dropbox_get_metadata,
        dropbox_commands::dropbox_move_file,
        dropbox_commands::dropbox_copy_file,
        dropbox_commands::dropbox_delete,
        dropbox_commands::dropbox_delete_batch,
        dropbox_commands::dropbox_move_batch,
        dropbox_commands::dropbox_copy_batch,
        dropbox_commands::dropbox_search,
        dropbox_commands::dropbox_search_continue,
        dropbox_commands::dropbox_list_revisions,
        dropbox_commands::dropbox_restore,
        dropbox_commands::dropbox_get_thumbnail,
        dropbox_commands::dropbox_content_hash,
        dropbox_commands::dropbox_guess_mime,
        dropbox_commands::dropbox_upload_session_start,
        dropbox_commands::dropbox_upload_session_append,
        dropbox_commands::dropbox_upload_session_finish,
        dropbox_commands::dropbox_check_job_status,
        // Dropbox commands — Folder operations
        dropbox_commands::dropbox_create_folder,
        dropbox_commands::dropbox_list_folder,
        dropbox_commands::dropbox_list_folder_continue,
        dropbox_commands::dropbox_get_latest_cursor,
        dropbox_commands::dropbox_create_folder_batch,
        dropbox_commands::dropbox_breadcrumbs,
        dropbox_commands::dropbox_parent_path,
        // Dropbox commands — Sharing
        dropbox_commands::dropbox_create_shared_link,
        dropbox_commands::dropbox_list_shared_links,
        dropbox_commands::dropbox_revoke_shared_link,
        dropbox_commands::dropbox_share_folder,
        dropbox_commands::dropbox_unshare_folder,
        dropbox_commands::dropbox_list_folder_members,
        dropbox_commands::dropbox_list_shared_folders,
        dropbox_commands::dropbox_mount_folder,
        dropbox_commands::dropbox_get_shared_link_metadata,
        dropbox_commands::dropbox_shared_link_to_direct,
        // Dropbox commands — Account
        dropbox_commands::dropbox_get_current_account,
        dropbox_commands::dropbox_get_space_usage,
        dropbox_commands::dropbox_format_space_usage,
        dropbox_commands::dropbox_is_space_critical,
        dropbox_commands::dropbox_get_account,
        dropbox_commands::dropbox_get_features,
        // Dropbox commands — Team
        dropbox_commands::dropbox_get_team_info,
        dropbox_commands::dropbox_team_members_list,
        dropbox_commands::dropbox_team_members_list_continue,
        dropbox_commands::dropbox_team_members_get_info,
        dropbox_commands::dropbox_team_member_suspend,
        dropbox_commands::dropbox_team_member_unsuspend,
        // Dropbox commands — Paper
        dropbox_commands::dropbox_paper_create,
        dropbox_commands::dropbox_paper_update,
        dropbox_commands::dropbox_paper_list,
        dropbox_commands::dropbox_paper_archive,
        // Dropbox commands — Sync manager
        dropbox_commands::dropbox_sync_create,
        dropbox_commands::dropbox_sync_remove,
        dropbox_commands::dropbox_sync_list,
        dropbox_commands::dropbox_sync_set_enabled,
        dropbox_commands::dropbox_sync_set_interval,
        dropbox_commands::dropbox_sync_set_exclude_patterns,
        // Dropbox commands — Backup manager
        dropbox_commands::dropbox_backup_create,
        dropbox_commands::dropbox_backup_remove,
        dropbox_commands::dropbox_backup_list,
        dropbox_commands::dropbox_backup_set_enabled,
        dropbox_commands::dropbox_backup_set_max_revisions,
        dropbox_commands::dropbox_backup_set_interval,
        dropbox_commands::dropbox_backup_get_history,
        dropbox_commands::dropbox_backup_total_size,
        // Dropbox commands — File watcher
        dropbox_commands::dropbox_watch_create,
        dropbox_commands::dropbox_watch_remove,
        dropbox_commands::dropbox_watch_list,
        dropbox_commands::dropbox_watch_set_enabled,
        dropbox_commands::dropbox_watch_get_changes,
        dropbox_commands::dropbox_watch_clear_changes,
        dropbox_commands::dropbox_watch_total_pending,
        // Dropbox commands — Activity & Stats
        dropbox_commands::dropbox_get_activity_log,
        dropbox_commands::dropbox_clear_activity_log,
        dropbox_commands::dropbox_get_stats,
        dropbox_commands::dropbox_reset_stats,
        // Dropbox commands — Longpoll
        dropbox_commands::dropbox_longpoll,
        // Nextcloud commands — Configuration & Connection
        nextcloud_commands::nextcloud_configure,
        nextcloud_commands::nextcloud_set_bearer_token,
        nextcloud_commands::nextcloud_configure_oauth2,
        nextcloud_commands::nextcloud_disconnect,
        nextcloud_commands::nextcloud_is_connected,
        nextcloud_commands::nextcloud_masked_credential,
        nextcloud_commands::nextcloud_get_server_url,
        nextcloud_commands::nextcloud_get_username,
        // Nextcloud commands — Login Flow v2
        nextcloud_commands::nextcloud_start_login_flow,
        nextcloud_commands::nextcloud_poll_login_flow,
        // Nextcloud commands — OAuth 2.0
        nextcloud_commands::nextcloud_start_oauth2,
        nextcloud_commands::nextcloud_exchange_oauth2_code,
        nextcloud_commands::nextcloud_refresh_oauth2_token,
        nextcloud_commands::nextcloud_validate_credentials,
        nextcloud_commands::nextcloud_revoke_app_password,
        // Nextcloud commands — File operations
        nextcloud_commands::nextcloud_upload,
        nextcloud_commands::nextcloud_download,
        nextcloud_commands::nextcloud_get_metadata,
        nextcloud_commands::nextcloud_move_file,
        nextcloud_commands::nextcloud_copy_file,
        nextcloud_commands::nextcloud_delete_file,
        nextcloud_commands::nextcloud_set_favorite,
        nextcloud_commands::nextcloud_set_tags,
        nextcloud_commands::nextcloud_list_versions,
        nextcloud_commands::nextcloud_restore_version,
        nextcloud_commands::nextcloud_list_trash,
        nextcloud_commands::nextcloud_restore_trash_item,
        nextcloud_commands::nextcloud_delete_trash_item,
        nextcloud_commands::nextcloud_empty_trash,
        nextcloud_commands::nextcloud_search,
        nextcloud_commands::nextcloud_content_hash,
        nextcloud_commands::nextcloud_guess_mime,
        nextcloud_commands::nextcloud_get_preview,
        // Nextcloud commands — Folder operations
        nextcloud_commands::nextcloud_create_folder,
        nextcloud_commands::nextcloud_create_folder_recursive,
        nextcloud_commands::nextcloud_list_folder,
        nextcloud_commands::nextcloud_list_files,
        nextcloud_commands::nextcloud_list_subfolders,
        nextcloud_commands::nextcloud_list_folder_recursive,
        nextcloud_commands::nextcloud_breadcrumbs,
        nextcloud_commands::nextcloud_parent_path,
        nextcloud_commands::nextcloud_join_path,
        nextcloud_commands::nextcloud_filename,
        // Nextcloud commands — Sharing (OCS)
        nextcloud_commands::nextcloud_create_share,
        nextcloud_commands::nextcloud_create_public_link,
        nextcloud_commands::nextcloud_list_shares,
        nextcloud_commands::nextcloud_list_shares_for_path,
        nextcloud_commands::nextcloud_list_shared_with_me,
        nextcloud_commands::nextcloud_list_pending_shares,
        nextcloud_commands::nextcloud_get_share,
        nextcloud_commands::nextcloud_update_share,
        nextcloud_commands::nextcloud_delete_share,
        nextcloud_commands::nextcloud_accept_remote_share,
        nextcloud_commands::nextcloud_decline_remote_share,
        nextcloud_commands::nextcloud_share_url,
        nextcloud_commands::nextcloud_share_download_url,
        // Nextcloud commands — Users & Capabilities
        nextcloud_commands::nextcloud_get_current_user,
        nextcloud_commands::nextcloud_get_quota,
        nextcloud_commands::nextcloud_get_user,
        nextcloud_commands::nextcloud_list_users,
        nextcloud_commands::nextcloud_list_groups,
        nextcloud_commands::nextcloud_get_capabilities,
        nextcloud_commands::nextcloud_get_server_status,
        nextcloud_commands::nextcloud_list_notifications,
        nextcloud_commands::nextcloud_delete_notification,
        nextcloud_commands::nextcloud_delete_all_notifications,
        nextcloud_commands::nextcloud_list_external_storages,
        nextcloud_commands::nextcloud_avatar_url,
        nextcloud_commands::nextcloud_get_avatar,
        nextcloud_commands::nextcloud_format_bytes,
        nextcloud_commands::nextcloud_format_quota,
        // Nextcloud commands — Activity Feed
        nextcloud_commands::nextcloud_list_activities,
        nextcloud_commands::nextcloud_activities_for_file,
        nextcloud_commands::nextcloud_recent_activities,
        nextcloud_commands::nextcloud_list_activity_filters,
        // Nextcloud commands — Sync manager
        nextcloud_commands::nextcloud_sync_add,
        nextcloud_commands::nextcloud_sync_remove,
        nextcloud_commands::nextcloud_sync_list,
        nextcloud_commands::nextcloud_sync_set_enabled,
        nextcloud_commands::nextcloud_sync_set_interval,
        nextcloud_commands::nextcloud_sync_set_exclude_patterns,
        // Nextcloud commands — Backup manager
        nextcloud_commands::nextcloud_backup_add,
        nextcloud_commands::nextcloud_backup_remove,
        nextcloud_commands::nextcloud_backup_list,
        nextcloud_commands::nextcloud_backup_set_enabled,
        nextcloud_commands::nextcloud_backup_set_max_versions,
        nextcloud_commands::nextcloud_backup_set_interval,
        nextcloud_commands::nextcloud_backup_get_history,
        nextcloud_commands::nextcloud_backup_total_size,
        // Nextcloud commands — File watcher
        nextcloud_commands::nextcloud_watch_add,
        nextcloud_commands::nextcloud_watch_remove,
        nextcloud_commands::nextcloud_watch_list,
        nextcloud_commands::nextcloud_watch_set_enabled,
        nextcloud_commands::nextcloud_watch_get_changes,
        nextcloud_commands::nextcloud_watch_clear_changes,
        nextcloud_commands::nextcloud_watch_total_pending,
        // Nextcloud commands — Activity Log & Stats
        nextcloud_commands::nextcloud_get_activity_log,
        nextcloud_commands::nextcloud_clear_activity_log,
        nextcloud_commands::nextcloud_get_stats,
        nextcloud_commands::nextcloud_reset_stats,
        // Google Drive commands — Auth & Configuration
        gdrive_commands::gdrive_set_credentials,
        gdrive_commands::gdrive_get_auth_url,
        gdrive_commands::gdrive_exchange_code,
        gdrive_commands::gdrive_refresh_token,
        gdrive_commands::gdrive_set_token,
        gdrive_commands::gdrive_get_token,
        gdrive_commands::gdrive_revoke,
        gdrive_commands::gdrive_is_authenticated,
        gdrive_commands::gdrive_connection_summary,
        gdrive_commands::gdrive_get_about,
        // Google Drive commands — Files
        gdrive_commands::gdrive_get_file,
        gdrive_commands::gdrive_list_files,
        gdrive_commands::gdrive_create_file,
        gdrive_commands::gdrive_update_file,
        gdrive_commands::gdrive_copy_file,
        gdrive_commands::gdrive_delete_file,
        gdrive_commands::gdrive_trash_file,
        gdrive_commands::gdrive_untrash_file,
        gdrive_commands::gdrive_empty_trash,
        gdrive_commands::gdrive_star_file,
        gdrive_commands::gdrive_rename_file,
        gdrive_commands::gdrive_move_file,
        gdrive_commands::gdrive_generate_ids,
        // Google Drive commands — Folders
        gdrive_commands::gdrive_create_folder,
        gdrive_commands::gdrive_list_children,
        gdrive_commands::gdrive_list_subfolders,
        gdrive_commands::gdrive_find_folder,
        // Google Drive commands — Upload & Download
        gdrive_commands::gdrive_upload_file,
        gdrive_commands::gdrive_download_file,
        gdrive_commands::gdrive_export_file,
        // Google Drive commands — Sharing
        gdrive_commands::gdrive_share_with_user,
        gdrive_commands::gdrive_share_with_anyone,
        gdrive_commands::gdrive_list_permissions,
        gdrive_commands::gdrive_delete_permission,
        gdrive_commands::gdrive_unshare_all,
        // Google Drive commands — Revisions
        gdrive_commands::gdrive_list_revisions,
        gdrive_commands::gdrive_pin_revision,
        // Google Drive commands — Comments
        gdrive_commands::gdrive_list_comments,
        gdrive_commands::gdrive_create_comment,
        gdrive_commands::gdrive_resolve_comment,
        gdrive_commands::gdrive_create_reply,
        // Google Drive commands — Shared Drives
        gdrive_commands::gdrive_list_drives,
        gdrive_commands::gdrive_create_drive,
        gdrive_commands::gdrive_delete_drive,
        // Google Drive commands — Changes
        gdrive_commands::gdrive_get_start_page_token,
        gdrive_commands::gdrive_poll_changes,
        // Google Drive commands — Search
        gdrive_commands::gdrive_search,
    ]
}
