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
        mremoteng_dedicated::mrng_detect_format,
        mremoteng_dedicated::mrng_get_import_formats,
        mremoteng_dedicated::mrng_get_export_formats,
        // mRemoteNG commands — Import
        mremoteng_dedicated::mrng_import_xml,
        mremoteng_dedicated::mrng_import_xml_as_connections,
        mremoteng_dedicated::mrng_import_csv,
        mremoteng_dedicated::mrng_import_csv_as_connections,
        mremoteng_dedicated::mrng_import_rdp_files,
        mremoteng_dedicated::mrng_import_rdp_as_connections,
        mremoteng_dedicated::mrng_import_putty_reg,
        mremoteng_dedicated::mrng_import_putty_registry,
        mremoteng_dedicated::mrng_import_putty_as_connections,
        mremoteng_dedicated::mrng_import_auto,
        mremoteng_dedicated::mrng_import_auto_as_connections,
        // mRemoteNG commands — Export
        mremoteng_dedicated::mrng_export_xml,
        mremoteng_dedicated::mrng_export_app_to_xml,
        mremoteng_dedicated::mrng_export_csv,
        mremoteng_dedicated::mrng_export_app_to_csv,
        mremoteng_dedicated::mrng_export_rdp_file,
        mremoteng_dedicated::mrng_export_app_to_rdp,
        // mRemoteNG commands — Validation / Info
        mremoteng_dedicated::mrng_validate_xml,
        mremoteng_dedicated::mrng_get_last_import,
        mremoteng_dedicated::mrng_get_last_export,
        // mRemoteNG commands — Configuration
        mremoteng_dedicated::mrng_set_password,
        mremoteng_dedicated::mrng_set_kdf_iterations,
        // Terminal Services commands — Config
        termserv::commands::ts_get_config,
        termserv::commands::ts_set_config,
        // Terminal Services commands — Server handles
        termserv::commands::ts_open_server,
        termserv::commands::ts_close_server,
        termserv::commands::ts_close_all_servers,
        termserv::commands::ts_list_open_servers,
        // Terminal Services commands — Sessions
        termserv::commands::ts_list_sessions,
        termserv::commands::ts_list_user_sessions,
        termserv::commands::ts_get_session_detail,
        termserv::commands::ts_get_all_session_details,
        termserv::commands::ts_disconnect_session,
        termserv::commands::ts_logoff_session,
        termserv::commands::ts_connect_session,
        termserv::commands::ts_logoff_disconnected,
        termserv::commands::ts_find_sessions_by_user,
        termserv::commands::ts_server_summary,
        termserv::commands::ts_get_console_session_id,
        termserv::commands::ts_get_current_session_id,
        termserv::commands::ts_is_remote_session,
        termserv::commands::ts_get_idle_seconds,
        // Terminal Services commands — Processes
        termserv::commands::ts_list_processes,
        termserv::commands::ts_list_session_processes,
        termserv::commands::ts_find_processes_by_name,
        termserv::commands::ts_terminate_process,
        termserv::commands::ts_terminate_processes_by_name,
        termserv::commands::ts_process_count_per_session,
        termserv::commands::ts_top_process_names,
        // Terminal Services commands — Messaging
        termserv::commands::ts_send_message,
        termserv::commands::ts_send_info,
        termserv::commands::ts_broadcast_message,
        // Terminal Services commands — Shadow / Remote Control
        termserv::commands::ts_start_shadow,
        termserv::commands::ts_stop_shadow,
        // Terminal Services commands — Server discovery & control
        termserv::commands::ts_enumerate_domain_servers,
        termserv::commands::ts_shutdown_server,
        termserv::commands::ts_list_listeners,
        // Terminal Services commands — User config, encryption, address
        termserv::commands::ts_query_user_config,
        termserv::commands::ts_set_user_config,
        termserv::commands::ts_get_encryption_level,
        termserv::commands::ts_get_session_address,
        // Terminal Services commands — Filtered sessions & batch ops
        termserv::commands::ts_list_sessions_filtered,
        termserv::commands::ts_batch_disconnect,
        termserv::commands::ts_batch_logoff,
        termserv::commands::ts_batch_send_message,
        // Terminal Services commands — Event monitoring
        termserv::commands::ts_wait_system_event,
        // WhatsApp commands — Configuration
        whatsapp::commands::wa_configure,
        whatsapp::commands::wa_configure_unofficial,
        whatsapp::commands::wa_is_configured,
        // WhatsApp commands — Messaging (Official Cloud API)
        whatsapp::commands::wa_send_text,
        whatsapp::commands::wa_send_image,
        whatsapp::commands::wa_send_document,
        whatsapp::commands::wa_send_video,
        whatsapp::commands::wa_send_audio,
        whatsapp::commands::wa_send_location,
        whatsapp::commands::wa_send_reaction,
        whatsapp::commands::wa_send_template,
        whatsapp::commands::wa_mark_as_read,
        // WhatsApp commands — Media
        whatsapp::commands::wa_upload_media,
        whatsapp::commands::wa_upload_media_file,
        whatsapp::commands::wa_get_media_url,
        whatsapp::commands::wa_download_media,
        whatsapp::commands::wa_delete_media,
        // WhatsApp commands — Templates
        whatsapp::commands::wa_create_template,
        whatsapp::commands::wa_list_templates,
        whatsapp::commands::wa_delete_template,
        // WhatsApp commands — Contacts
        whatsapp::commands::wa_check_contact,
        whatsapp::commands::wa_me_link,
        // WhatsApp commands — Groups
        whatsapp::commands::wa_create_group,
        whatsapp::commands::wa_get_group_info,
        // WhatsApp commands — Business Profile & Phone Numbers
        whatsapp::commands::wa_get_business_profile,
        whatsapp::commands::wa_list_phone_numbers,
        // WhatsApp commands — Webhooks
        whatsapp::commands::wa_webhook_verify,
        whatsapp::commands::wa_webhook_process,
        // WhatsApp commands — Sessions
        whatsapp::commands::wa_list_sessions,
        // WhatsApp commands — Unofficial (WA Web)
        whatsapp::commands::wa_unofficial_connect,
        whatsapp::commands::wa_unofficial_disconnect,
        whatsapp::commands::wa_unofficial_state,
        whatsapp::commands::wa_unofficial_send_text,
        // WhatsApp commands — Pairing
        whatsapp::commands::wa_pairing_start_qr,
        whatsapp::commands::wa_pairing_refresh_qr,
        whatsapp::commands::wa_pairing_start_phone,
        whatsapp::commands::wa_pairing_state,
        whatsapp::commands::wa_pairing_cancel,
        // WhatsApp commands — Chat History
        whatsapp::commands::wa_get_messages,
        whatsapp::commands::wa_send_auto,
        // Telegram Bot API commands — Bot management
        telegram::commands::telegram_add_bot,
        telegram::commands::telegram_remove_bot,
        telegram::commands::telegram_list_bots,
        telegram::commands::telegram_validate_bot,
        telegram::commands::telegram_set_bot_enabled,
        telegram::commands::telegram_update_bot_token,
        // Telegram commands — Messaging
        telegram::commands::telegram_send_message,
        telegram::commands::telegram_send_photo,
        telegram::commands::telegram_send_document,
        telegram::commands::telegram_send_video,
        telegram::commands::telegram_send_audio,
        telegram::commands::telegram_send_voice,
        telegram::commands::telegram_send_location,
        telegram::commands::telegram_send_contact,
        telegram::commands::telegram_send_poll,
        telegram::commands::telegram_send_dice,
        telegram::commands::telegram_send_sticker,
        telegram::commands::telegram_send_chat_action,
        // Telegram commands — Message management
        telegram::commands::telegram_edit_message_text,
        telegram::commands::telegram_edit_message_caption,
        telegram::commands::telegram_edit_message_reply_markup,
        telegram::commands::telegram_delete_message,
        telegram::commands::telegram_forward_message,
        telegram::commands::telegram_copy_message,
        telegram::commands::telegram_pin_message,
        telegram::commands::telegram_unpin_message,
        telegram::commands::telegram_unpin_all_messages,
        telegram::commands::telegram_answer_callback_query,
        // Telegram commands — Chat management
        telegram::commands::telegram_get_chat,
        telegram::commands::telegram_get_chat_member_count,
        telegram::commands::telegram_get_chat_member,
        telegram::commands::telegram_get_chat_administrators,
        telegram::commands::telegram_set_chat_title,
        telegram::commands::telegram_set_chat_description,
        telegram::commands::telegram_ban_chat_member,
        telegram::commands::telegram_unban_chat_member,
        telegram::commands::telegram_restrict_chat_member,
        telegram::commands::telegram_promote_chat_member,
        telegram::commands::telegram_leave_chat,
        telegram::commands::telegram_export_chat_invite_link,
        telegram::commands::telegram_create_invite_link,
        // Telegram commands — Files
        telegram::commands::telegram_get_file,
        telegram::commands::telegram_download_file,
        telegram::commands::telegram_upload_file,
        // Telegram commands — Webhooks & Updates
        telegram::commands::telegram_get_updates,
        telegram::commands::telegram_set_webhook,
        telegram::commands::telegram_delete_webhook,
        telegram::commands::telegram_get_webhook_info,
        // Telegram commands — Notification rules
        telegram::commands::telegram_add_notification_rule,
        telegram::commands::telegram_remove_notification_rule,
        telegram::commands::telegram_list_notification_rules,
        telegram::commands::telegram_set_notification_rule_enabled,
        telegram::commands::telegram_process_connection_event,
        // Telegram commands — Monitoring
        telegram::commands::telegram_add_monitoring_check,
        telegram::commands::telegram_remove_monitoring_check,
        telegram::commands::telegram_list_monitoring_checks,
        telegram::commands::telegram_set_monitoring_check_enabled,
        telegram::commands::telegram_monitoring_summary,
        telegram::commands::telegram_record_monitoring_result,
        // Telegram commands — Templates
        telegram::commands::telegram_add_template,
        telegram::commands::telegram_remove_template,
        telegram::commands::telegram_list_templates,
        telegram::commands::telegram_render_template,
        telegram::commands::telegram_validate_template_body,
        telegram::commands::telegram_send_template,
        // Telegram commands — Scheduled messages
        telegram::commands::telegram_schedule_message,
        telegram::commands::telegram_cancel_scheduled_message,
        telegram::commands::telegram_list_scheduled_messages,
        telegram::commands::telegram_process_scheduled_messages,
        // Telegram commands — Broadcast & Digests
        telegram::commands::telegram_broadcast,
        telegram::commands::telegram_add_digest,
        telegram::commands::telegram_remove_digest,
        telegram::commands::telegram_list_digests,
        // Telegram commands — Stats & Logs
        telegram::commands::telegram_stats,
        telegram::commands::telegram_message_log,
        telegram::commands::telegram_clear_message_log,
        telegram::commands::telegram_notification_history,
        telegram::commands::telegram_monitoring_history,
        // Dropbox commands — Configuration & Connection
        dropbox::commands::dropbox_configure,
        dropbox::commands::dropbox_set_token,
        dropbox::commands::dropbox_disconnect,
        dropbox::commands::dropbox_is_connected,
        dropbox::commands::dropbox_masked_token,
        // Dropbox commands — OAuth 2.0 PKCE
        dropbox::commands::dropbox_start_auth,
        dropbox::commands::dropbox_finish_auth,
        dropbox::commands::dropbox_refresh_token,
        dropbox::commands::dropbox_revoke_token,
        // Dropbox commands — File operations
        dropbox::commands::dropbox_upload,
        dropbox::commands::dropbox_download,
        dropbox::commands::dropbox_get_metadata,
        dropbox::commands::dropbox_move_file,
        dropbox::commands::dropbox_copy_file,
        dropbox::commands::dropbox_delete,
        dropbox::commands::dropbox_delete_batch,
        dropbox::commands::dropbox_move_batch,
        dropbox::commands::dropbox_copy_batch,
        dropbox::commands::dropbox_search,
        dropbox::commands::dropbox_search_continue,
        dropbox::commands::dropbox_list_revisions,
        dropbox::commands::dropbox_restore,
        dropbox::commands::dropbox_get_thumbnail,
        dropbox::commands::dropbox_content_hash,
        dropbox::commands::dropbox_guess_mime,
        dropbox::commands::dropbox_upload_session_start,
        dropbox::commands::dropbox_upload_session_append,
        dropbox::commands::dropbox_upload_session_finish,
        dropbox::commands::dropbox_check_job_status,
        // Dropbox commands — Folder operations
        dropbox::commands::dropbox_create_folder,
        dropbox::commands::dropbox_list_folder,
        dropbox::commands::dropbox_list_folder_continue,
        dropbox::commands::dropbox_get_latest_cursor,
        dropbox::commands::dropbox_create_folder_batch,
        dropbox::commands::dropbox_breadcrumbs,
        dropbox::commands::dropbox_parent_path,
        // Dropbox commands — Sharing
        dropbox::commands::dropbox_create_shared_link,
        dropbox::commands::dropbox_list_shared_links,
        dropbox::commands::dropbox_revoke_shared_link,
        dropbox::commands::dropbox_share_folder,
        dropbox::commands::dropbox_unshare_folder,
        dropbox::commands::dropbox_list_folder_members,
        dropbox::commands::dropbox_list_shared_folders,
        dropbox::commands::dropbox_mount_folder,
        dropbox::commands::dropbox_get_shared_link_metadata,
        dropbox::commands::dropbox_shared_link_to_direct,
        // Dropbox commands — Account
        dropbox::commands::dropbox_get_current_account,
        dropbox::commands::dropbox_get_space_usage,
        dropbox::commands::dropbox_format_space_usage,
        dropbox::commands::dropbox_is_space_critical,
        dropbox::commands::dropbox_get_account,
        dropbox::commands::dropbox_get_features,
        // Dropbox commands — Team
        dropbox::commands::dropbox_get_team_info,
        dropbox::commands::dropbox_team_members_list,
        dropbox::commands::dropbox_team_members_list_continue,
        dropbox::commands::dropbox_team_members_get_info,
        dropbox::commands::dropbox_team_member_suspend,
        dropbox::commands::dropbox_team_member_unsuspend,
        // Dropbox commands — Paper
        dropbox::commands::dropbox_paper_create,
        dropbox::commands::dropbox_paper_update,
        dropbox::commands::dropbox_paper_list,
        dropbox::commands::dropbox_paper_archive,
        // Dropbox commands — Sync manager
        dropbox::commands::dropbox_sync_create,
        dropbox::commands::dropbox_sync_remove,
        dropbox::commands::dropbox_sync_list,
        dropbox::commands::dropbox_sync_set_enabled,
        dropbox::commands::dropbox_sync_set_interval,
        dropbox::commands::dropbox_sync_set_exclude_patterns,
        // Dropbox commands — Backup manager
        dropbox::commands::dropbox_backup_create,
        dropbox::commands::dropbox_backup_remove,
        dropbox::commands::dropbox_backup_list,
        dropbox::commands::dropbox_backup_set_enabled,
        dropbox::commands::dropbox_backup_set_max_revisions,
        dropbox::commands::dropbox_backup_set_interval,
        dropbox::commands::dropbox_backup_get_history,
        dropbox::commands::dropbox_backup_total_size,
        // Dropbox commands — File watcher
        dropbox::commands::dropbox_watch_create,
        dropbox::commands::dropbox_watch_remove,
        dropbox::commands::dropbox_watch_list,
        dropbox::commands::dropbox_watch_set_enabled,
        dropbox::commands::dropbox_watch_get_changes,
        dropbox::commands::dropbox_watch_clear_changes,
        dropbox::commands::dropbox_watch_total_pending,
        // Dropbox commands — Activity & Stats
        dropbox::commands::dropbox_get_activity_log,
        dropbox::commands::dropbox_clear_activity_log,
        dropbox::commands::dropbox_get_stats,
        dropbox::commands::dropbox_reset_stats,
        // Dropbox commands — Longpoll
        dropbox::commands::dropbox_longpoll,
        // Nextcloud commands — Configuration & Connection
        nextcloud::commands::nextcloud_configure,
        nextcloud::commands::nextcloud_set_bearer_token,
        nextcloud::commands::nextcloud_configure_oauth2,
        nextcloud::commands::nextcloud_disconnect,
        nextcloud::commands::nextcloud_is_connected,
        nextcloud::commands::nextcloud_masked_credential,
        nextcloud::commands::nextcloud_get_server_url,
        nextcloud::commands::nextcloud_get_username,
        // Nextcloud commands — Login Flow v2
        nextcloud::commands::nextcloud_start_login_flow,
        nextcloud::commands::nextcloud_poll_login_flow,
        // Nextcloud commands — OAuth 2.0
        nextcloud::commands::nextcloud_start_oauth2,
        nextcloud::commands::nextcloud_exchange_oauth2_code,
        nextcloud::commands::nextcloud_refresh_oauth2_token,
        nextcloud::commands::nextcloud_validate_credentials,
        nextcloud::commands::nextcloud_revoke_app_password,
        // Nextcloud commands — File operations
        nextcloud::commands::nextcloud_upload,
        nextcloud::commands::nextcloud_download,
        nextcloud::commands::nextcloud_get_metadata,
        nextcloud::commands::nextcloud_move_file,
        nextcloud::commands::nextcloud_copy_file,
        nextcloud::commands::nextcloud_delete_file,
        nextcloud::commands::nextcloud_set_favorite,
        nextcloud::commands::nextcloud_set_tags,
        nextcloud::commands::nextcloud_list_versions,
        nextcloud::commands::nextcloud_restore_version,
        nextcloud::commands::nextcloud_list_trash,
        nextcloud::commands::nextcloud_restore_trash_item,
        nextcloud::commands::nextcloud_delete_trash_item,
        nextcloud::commands::nextcloud_empty_trash,
        nextcloud::commands::nextcloud_search,
        nextcloud::commands::nextcloud_content_hash,
        nextcloud::commands::nextcloud_guess_mime,
        nextcloud::commands::nextcloud_get_preview,
        // Nextcloud commands — Folder operations
        nextcloud::commands::nextcloud_create_folder,
        nextcloud::commands::nextcloud_create_folder_recursive,
        nextcloud::commands::nextcloud_list_folder,
        nextcloud::commands::nextcloud_list_files,
        nextcloud::commands::nextcloud_list_subfolders,
        nextcloud::commands::nextcloud_list_folder_recursive,
        nextcloud::commands::nextcloud_breadcrumbs,
        nextcloud::commands::nextcloud_parent_path,
        nextcloud::commands::nextcloud_join_path,
        nextcloud::commands::nextcloud_filename,
        // Nextcloud commands — Sharing (OCS)
        nextcloud::commands::nextcloud_create_share,
        nextcloud::commands::nextcloud_create_public_link,
        nextcloud::commands::nextcloud_list_shares,
        nextcloud::commands::nextcloud_list_shares_for_path,
        nextcloud::commands::nextcloud_list_shared_with_me,
        nextcloud::commands::nextcloud_list_pending_shares,
        nextcloud::commands::nextcloud_get_share,
        nextcloud::commands::nextcloud_update_share,
        nextcloud::commands::nextcloud_delete_share,
        nextcloud::commands::nextcloud_accept_remote_share,
        nextcloud::commands::nextcloud_decline_remote_share,
        nextcloud::commands::nextcloud_share_url,
        nextcloud::commands::nextcloud_share_download_url,
        // Nextcloud commands — Users & Capabilities
        nextcloud::commands::nextcloud_get_current_user,
        nextcloud::commands::nextcloud_get_quota,
        nextcloud::commands::nextcloud_get_user,
        nextcloud::commands::nextcloud_list_users,
        nextcloud::commands::nextcloud_list_groups,
        nextcloud::commands::nextcloud_get_capabilities,
        nextcloud::commands::nextcloud_get_server_status,
        nextcloud::commands::nextcloud_list_notifications,
        nextcloud::commands::nextcloud_delete_notification,
        nextcloud::commands::nextcloud_delete_all_notifications,
        nextcloud::commands::nextcloud_list_external_storages,
        nextcloud::commands::nextcloud_avatar_url,
        nextcloud::commands::nextcloud_get_avatar,
        nextcloud::commands::nextcloud_format_bytes,
        nextcloud::commands::nextcloud_format_quota,
        // Nextcloud commands — Activity Feed
        nextcloud::commands::nextcloud_list_activities,
        nextcloud::commands::nextcloud_activities_for_file,
        nextcloud::commands::nextcloud_recent_activities,
        nextcloud::commands::nextcloud_list_activity_filters,
        // Nextcloud commands — Sync manager
        nextcloud::commands::nextcloud_sync_add,
        nextcloud::commands::nextcloud_sync_remove,
        nextcloud::commands::nextcloud_sync_list,
        nextcloud::commands::nextcloud_sync_set_enabled,
        nextcloud::commands::nextcloud_sync_set_interval,
        nextcloud::commands::nextcloud_sync_set_exclude_patterns,
        // Nextcloud commands — Backup manager
        nextcloud::commands::nextcloud_backup_add,
        nextcloud::commands::nextcloud_backup_remove,
        nextcloud::commands::nextcloud_backup_list,
        nextcloud::commands::nextcloud_backup_set_enabled,
        nextcloud::commands::nextcloud_backup_set_max_versions,
        nextcloud::commands::nextcloud_backup_set_interval,
        nextcloud::commands::nextcloud_backup_get_history,
        nextcloud::commands::nextcloud_backup_total_size,
        // Nextcloud commands — File watcher
        nextcloud::commands::nextcloud_watch_add,
        nextcloud::commands::nextcloud_watch_remove,
        nextcloud::commands::nextcloud_watch_list,
        nextcloud::commands::nextcloud_watch_set_enabled,
        nextcloud::commands::nextcloud_watch_get_changes,
        nextcloud::commands::nextcloud_watch_clear_changes,
        nextcloud::commands::nextcloud_watch_total_pending,
        // Nextcloud commands — Activity Log & Stats
        nextcloud::commands::nextcloud_get_activity_log,
        nextcloud::commands::nextcloud_clear_activity_log,
        nextcloud::commands::nextcloud_get_stats,
        nextcloud::commands::nextcloud_reset_stats,
        // Google Drive commands — Auth & Configuration
        gdrive::commands::gdrive_set_credentials,
        gdrive::commands::gdrive_get_auth_url,
        gdrive::commands::gdrive_exchange_code,
        gdrive::commands::gdrive_refresh_token,
        gdrive::commands::gdrive_set_token,
        gdrive::commands::gdrive_get_token,
        gdrive::commands::gdrive_revoke,
        gdrive::commands::gdrive_is_authenticated,
        gdrive::commands::gdrive_connection_summary,
        gdrive::commands::gdrive_get_about,
        // Google Drive commands — Files
        gdrive::commands::gdrive_get_file,
        gdrive::commands::gdrive_list_files,
        gdrive::commands::gdrive_create_file,
        gdrive::commands::gdrive_update_file,
        gdrive::commands::gdrive_copy_file,
        gdrive::commands::gdrive_delete_file,
        gdrive::commands::gdrive_trash_file,
        gdrive::commands::gdrive_untrash_file,
        gdrive::commands::gdrive_empty_trash,
        gdrive::commands::gdrive_star_file,
        gdrive::commands::gdrive_rename_file,
        gdrive::commands::gdrive_move_file,
        gdrive::commands::gdrive_generate_ids,
        // Google Drive commands — Folders
        gdrive::commands::gdrive_create_folder,
        gdrive::commands::gdrive_list_children,
        gdrive::commands::gdrive_list_subfolders,
        gdrive::commands::gdrive_find_folder,
        // Google Drive commands — Upload & Download
        gdrive::commands::gdrive_upload_file,
        gdrive::commands::gdrive_download_file,
        gdrive::commands::gdrive_export_file,
        // Google Drive commands — Sharing
        gdrive::commands::gdrive_share_with_user,
        gdrive::commands::gdrive_share_with_anyone,
        gdrive::commands::gdrive_list_permissions,
        gdrive::commands::gdrive_delete_permission,
        gdrive::commands::gdrive_unshare_all,
        // Google Drive commands — Revisions
        gdrive::commands::gdrive_list_revisions,
        gdrive::commands::gdrive_pin_revision,
        // Google Drive commands — Comments
        gdrive::commands::gdrive_list_comments,
        gdrive::commands::gdrive_create_comment,
        gdrive::commands::gdrive_resolve_comment,
        gdrive::commands::gdrive_create_reply,
        // Google Drive commands — Shared Drives
        gdrive::commands::gdrive_list_drives,
        gdrive::commands::gdrive_create_drive,
        gdrive::commands::gdrive_delete_drive,
        // Google Drive commands — Changes
        gdrive::commands::gdrive_get_start_page_token,
        gdrive::commands::gdrive_poll_changes,
        // Google Drive commands — Search
        gdrive::commands::gdrive_search,
    ]
}
