use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "connect_digital_ocean"
            | "disconnect_digital_ocean"
            | "list_digital_ocean_droplets"
            | "get_digital_ocean_session"
            | "list_digital_ocean_sessions"
            | "backup_update_config"
            | "backup_get_config"
            | "backup_get_status"
            | "backup_run_now"
            | "backup_list"
            | "backup_restore"
            | "backup_delete"
            | "create_desktop_shortcut"
            | "scan_shortcuts"
            | "set_autostart"
            | "get_desktop_path"
            | "get_documents_path"
            | "get_appdata_path"
            | "check_file_exists"
            | "delete_file"
            | "open_folder"
            | "flash_window"
            | "sftp_connect"
            | "sftp_disconnect"
            | "sftp_get_session_info"
            | "sftp_list_sessions"
            | "sftp_ping"
            | "sftp_set_directory"
            | "sftp_realpath"
            | "sftp_list_directory"
            | "sftp_mkdir"
            | "sftp_mkdir_p"
            | "sftp_rmdir"
            | "sftp_disk_usage"
            | "sftp_search"
            | "sftp_stat"
            | "sftp_lstat"
            | "sftp_rename"
            | "sftp_delete_file"
            | "sftp_delete_recursive"
            | "sftp_chmod"
            | "sftp_chown"
            | "sftp_create_symlink"
            | "sftp_read_link"
            | "sftp_touch"
            | "sftp_truncate"
            | "sftp_read_text_file"
            | "sftp_write_text_file"
            | "sftp_checksum"
            | "sftp_exists"
            | "sftp_upload"
            | "sftp_download"
            | "sftp_batch_transfer"
            | "sftp_get_transfer_progress"
            | "sftp_list_active_transfers"
            | "sftp_cancel_transfer"
            | "sftp_pause_transfer"
            | "sftp_clear_completed_transfers"
            | "sftp_queue_add"
            | "sftp_queue_remove"
            | "sftp_queue_list"
            | "sftp_queue_status"
            | "sftp_queue_start"
            | "sftp_queue_stop"
            | "sftp_queue_retry_failed"
            | "sftp_queue_clear_done"
            | "sftp_queue_set_priority"
            | "sftp_watch_start"
            | "sftp_watch_stop"
            | "sftp_watch_list"
            | "sftp_sync_pull"
            | "sftp_sync_push"
            | "sftp_bookmark_add"
            | "sftp_bookmark_remove"
            | "sftp_bookmark_update"
            | "sftp_bookmark_list"
            | "sftp_bookmark_touch"
            | "sftp_bookmark_import"
            | "sftp_bookmark_export"
            | "sftp_diagnose"
            | "rustdesk_is_available"
            | "rustdesk_get_binary_info"
            | "rustdesk_detect_version"
            | "rustdesk_get_local_id"
            | "rustdesk_check_service_running"
            | "rustdesk_install_service"
            | "rustdesk_silent_install"
            | "rustdesk_set_permanent_password"
            | "rustdesk_configure_server"
            | "rustdesk_get_server_config"
            | "rustdesk_set_client_config"
            | "rustdesk_get_client_config"
            | "rustdesk_connect"
            | "rustdesk_connect_direct_ip"
            | "rustdesk_disconnect"
            | "rustdesk_shutdown"
            | "rustdesk_get_session"
            | "rustdesk_list_sessions"
            | "rustdesk_update_session_settings"
            | "rustdesk_send_input"
            | "rustdesk_active_session_count"
            | "rustdesk_create_tunnel"
            | "rustdesk_close_tunnel"
            | "rustdesk_list_tunnels"
            | "rustdesk_get_tunnel"
            | "rustdesk_start_file_transfer"
            | "rustdesk_upload_file"
            | "rustdesk_download_file"
            | "rustdesk_list_file_transfers"
            | "rustdesk_get_file_transfer"
            | "rustdesk_active_file_transfers"
            | "rustdesk_transfer_progress"
            | "rustdesk_record_file_transfer"
            | "rustdesk_update_transfer_progress"
            | "rustdesk_cancel_file_transfer"
            | "rustdesk_list_remote_files"
            | "rustdesk_file_transfer_stats"
            | "rustdesk_assign_via_cli"
            | "rustdesk_api_list_devices"
            | "rustdesk_api_get_device"
            | "rustdesk_api_device_action"
            | "rustdesk_api_assign_device"
            | "rustdesk_api_list_users"
            | "rustdesk_api_create_user"
            | "rustdesk_api_user_action"
            | "rustdesk_api_list_user_groups"
            | "rustdesk_api_create_user_group"
            | "rustdesk_api_update_user_group"
            | "rustdesk_api_delete_user_group"
            | "rustdesk_api_add_users_to_group"
            | "rustdesk_api_list_device_groups"
            | "rustdesk_api_create_device_group"
            | "rustdesk_api_update_device_group"
            | "rustdesk_api_delete_device_group"
            | "rustdesk_api_add_devices_to_group"
            | "rustdesk_api_remove_devices_from_group"
            | "rustdesk_api_list_strategies"
            | "rustdesk_api_get_strategy"
            | "rustdesk_api_enable_strategy"
            | "rustdesk_api_disable_strategy"
            | "rustdesk_api_assign_strategy"
            | "rustdesk_api_unassign_strategy"
            | "rustdesk_api_list_address_books"
            | "rustdesk_api_get_personal_address_book"
            | "rustdesk_api_create_address_book"
            | "rustdesk_api_update_address_book"
            | "rustdesk_api_delete_address_book"
            | "rustdesk_api_list_ab_peers"
            | "rustdesk_api_add_ab_peer"
            | "rustdesk_api_update_ab_peer"
            | "rustdesk_api_remove_ab_peer"
            | "rustdesk_api_import_ab_peers"
            | "rustdesk_api_list_ab_tags"
            | "rustdesk_api_add_ab_tag"
            | "rustdesk_api_delete_ab_tag"
            | "rustdesk_api_list_ab_rules"
            | "rustdesk_api_add_ab_rule"
            | "rustdesk_api_delete_ab_rule"
            | "rustdesk_api_connection_audits"
            | "rustdesk_api_file_audits"
            | "rustdesk_api_alarm_audits"
            | "rustdesk_api_console_audits"
            | "rustdesk_api_peer_audit_summary"
            | "rustdesk_api_operator_audit_summary"
            | "rustdesk_api_login"
            | "rustdesk_diagnostics_report"
            | "rustdesk_quick_health_check"
            | "rustdesk_server_health"
            | "rustdesk_server_latency"
            | "rustdesk_server_config_summary"
            | "rustdesk_client_config_summary"
            | "rustdesk_session_summary"
            | "bw_check_cli"
            | "bw_status"
            | "bw_vault_status"
            | "bw_session_info"
            | "bw_get_config"
            | "bw_set_config"
            | "bw_config_server"
            | "bw_login"
            | "bw_login_2fa"
            | "bw_login_api_key"
            | "bw_unlock"
            | "bw_lock"
            | "bw_logout"
            | "bw_sync"
            | "bw_force_sync"
            | "bw_list_items"
            | "bw_search_items"
            | "bw_get_item"
            | "bw_create_item"
            | "bw_edit_item"
            | "bw_delete_item"
            | "bw_delete_item_permanent"
            | "bw_restore_item"
            | "bw_get_username"
            | "bw_get_password"
            | "bw_get_totp"
            | "bw_find_credentials"
            | "bw_list_folders"
            | "bw_create_folder"
            | "bw_edit_folder"
            | "bw_delete_folder"
            | "bw_list_collections"
            | "bw_list_organizations"
            | "bw_list_sends"
            | "bw_create_text_send"
            | "bw_delete_send"
            | "bw_create_attachment"
            | "bw_delete_attachment"
            | "bw_download_attachment"
            | "bw_generate_password"
            | "bw_generate_password_local"
            | "bw_export"
            | "bw_import"
            | "bw_vault_stats"
            | "bw_password_health"
            | "bw_find_duplicates"
            | "bw_start_serve"
            | "bw_stop_serve"
            | "bw_is_serve_running"
            | "keepass_create_database"
            | "keepass_open_database"
            | "keepass_close_database"
            | "keepass_close_all_databases"
            | "keepass_save_database"
            | "keepass_lock_database"
            | "keepass_unlock_database"
            | "keepass_list_databases"
            | "keepass_backup_database"
            | "keepass_list_backups"
            | "keepass_change_master_key"
            | "keepass_get_database_file_info"
            | "keepass_get_database_statistics"
            | "keepass_merge_database"
            | "keepass_update_database_metadata"
            | "keepass_create_entry"
            | "keepass_get_entry"
            | "keepass_list_entries_in_group"
            | "keepass_list_all_entries"
            | "keepass_list_entries_recursive"
            | "keepass_update_entry"
            | "keepass_delete_entry"
            | "keepass_restore_entry"
            | "keepass_empty_recycle_bin"
            | "keepass_move_entry"
            | "keepass_copy_entry"
            | "keepass_get_entry_history"
            | "keepass_get_entry_history_item"
            | "keepass_restore_entry_from_history"
            | "keepass_delete_entry_history"
            | "keepass_diff_entry_with_history"
            | "keepass_get_entry_otp"
            | "keepass_password_health_report"
            | "keepass_create_group"
            | "keepass_get_group"
            | "keepass_list_groups"
            | "keepass_list_child_groups"
            | "keepass_get_group_tree"
            | "keepass_get_group_path"
            | "keepass_update_group"
            | "keepass_delete_group"
            | "keepass_move_group"
            | "keepass_sort_groups"
            | "keepass_group_entry_count"
            | "keepass_group_tags"
            | "keepass_add_custom_icon"
            | "keepass_get_custom_icon"
            | "keepass_list_custom_icons"
            | "keepass_delete_custom_icon"
            | "keepass_generate_password"
            | "keepass_generate_passwords"
            | "keepass_analyze_password"
            | "keepass_list_password_profiles"
            | "keepass_add_password_profile"
            | "keepass_remove_password_profile"
            | "keepass_create_key_file"
            | "keepass_verify_key_file"
            | "keepass_search_entries"
            | "keepass_quick_search"
            | "keepass_find_entries_for_url"
            | "keepass_find_duplicates"
            | "keepass_find_expiring_entries"
            | "keepass_find_weak_passwords"
            | "keepass_find_entries_without_password"
            | "keepass_get_all_tags"
            | "keepass_find_entries_by_tag"
            | "keepass_import_entries"
            | "keepass_export_entries"
            | "keepass_parse_autotype_sequence"
            | "keepass_resolve_autotype_sequence"
            | "keepass_find_autotype_matches"
            | "keepass_list_autotype_associations"
            | "keepass_validate_autotype_sequence"
            | "keepass_get_default_autotype_sequence"
            | "keepass_add_attachment"
            | "keepass_get_entry_attachments"
            | "keepass_get_attachment_data"
            | "keepass_remove_attachment"
            | "keepass_rename_attachment"
            | "keepass_save_attachment_to_file"
            | "keepass_import_attachment_from_file"
            | "keepass_get_attachment_pool_size"
            | "keepass_compact_attachment_pool"
            | "keepass_verify_attachment_integrity"
            | "keepass_list_recent_databases"
            | "keepass_add_recent_database"
            | "keepass_remove_recent_database"
            | "keepass_clear_recent_databases"
            | "keepass_get_change_log"
            | "keepass_get_settings"
            | "keepass_update_settings"
            | "keepass_shutdown"
            | "pb_get_config"
            | "pb_set_config"
            | "pb_login_gpgauth"
            | "pb_login_jwt"
            | "pb_refresh_token"
            | "pb_logout"
            | "pb_check_session"
            | "pb_is_authenticated"
            | "pb_verify_mfa_totp"
            | "pb_verify_mfa_yubikey"
            | "pb_get_mfa_requirements"
            | "pb_list_resources"
            | "pb_get_resource"
            | "pb_create_resource"
            | "pb_update_resource"
            | "pb_delete_resource"
            | "pb_search_resources"
            | "pb_list_favorite_resources"
            | "pb_list_resources_in_folder"
            | "pb_list_resource_types"
            | "pb_get_secret"
            | "pb_get_decrypted_secret"
            | "pb_list_folders"
            | "pb_get_folder"
            | "pb_create_folder"
            | "pb_update_folder"
            | "pb_delete_folder"
            | "pb_move_folder"
            | "pb_move_resource"
            | "pb_get_folder_tree"
            | "pb_list_users"
            | "pb_get_user"
            | "pb_get_me"
            | "pb_create_user"
            | "pb_update_user"
            | "pb_delete_user"
            | "pb_delete_user_dry_run"
            | "pb_search_users"
            | "pb_list_groups"
            | "pb_get_group"
            | "pb_create_group"
            | "pb_update_group"
            | "pb_delete_group"
            | "pb_update_group_dry_run"
            | "pb_list_resource_permissions"
            | "pb_share_resource"
            | "pb_share_folder"
            | "pb_simulate_share_resource"
            | "pb_search_aros"
            | "pb_add_favorite"
            | "pb_remove_favorite"
            | "pb_list_comments"
            | "pb_add_comment"
            | "pb_update_comment"
            | "pb_delete_comment"
            | "pb_list_tags"
            | "pb_update_tag"
            | "pb_delete_tag"
            | "pb_add_tags_to_resource"
            | "pb_list_gpg_keys"
            | "pb_get_gpg_key"
            | "pb_load_recipient_key"
            | "pb_list_roles"
            | "pb_list_metadata_keys"
            | "pb_create_metadata_key"
            | "pb_get_metadata_types_settings"
            | "pb_list_metadata_session_keys"
            | "pb_list_resources_needing_rotation"
            | "pb_rotate_resource_metadata"
            | "pb_list_resources_needing_upgrade"
            | "pb_upgrade_resource_metadata"
            | "pb_healthcheck"
            | "pb_server_status"
            | "pb_is_server_reachable"
            | "pb_server_settings"
            | "pb_directory_sync_dry_run"
            | "pb_directory_sync"
            | "pb_refresh_cache"
            | "pb_invalidate_cache"
            | "pb_get_cached_resources"
            | "pb_get_cached_folders"
            | "scp_connect"
            | "scp_disconnect"
            | "scp_disconnect_all"
            | "scp_get_session_info"
            | "scp_list_sessions"
            | "scp_ping"
            | "scp_remote_exists"
            | "scp_remote_is_dir"
            | "scp_remote_file_size"
            | "scp_remote_mkdir_p"
            | "scp_remote_rm"
            | "scp_remote_rm_rf"
            | "scp_remote_ls"
            | "scp_remote_stat"
            | "scp_remote_checksum"
            | "scp_local_checksum"
            | "scp_upload"
            | "scp_download"
            | "scp_batch_transfer"
            | "scp_upload_directory"
            | "scp_download_directory"
            | "scp_get_transfer_progress"
            | "scp_list_active_transfers"
            | "scp_cancel_transfer"
            | "scp_clear_completed_transfers"
            | "scp_queue_add"
            | "scp_queue_remove"
            | "scp_queue_list"
            | "scp_queue_status"
            | "scp_queue_start"
            | "scp_queue_stop"
            | "scp_queue_retry_failed"
            | "scp_queue_clear_done"
            | "scp_queue_clear_all"
            | "scp_queue_set_priority"
            | "scp_queue_pause"
            | "scp_queue_resume"
            | "scp_get_history"
            | "scp_clear_history"
            | "scp_history_stats"
            | "scp_diagnose"
            | "scp_diagnose_connection"
            | "scp_exec_remote"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ibm::connect_ibm,
        // ibm::disconnect_ibm,
        // ibm::list_ibm_virtual_servers,
        // ibm::get_ibm_session,
        // ibm::list_ibm_sessions,
        digital_ocean::connect_digital_ocean,
        digital_ocean::disconnect_digital_ocean,
        digital_ocean::list_digital_ocean_droplets,
        digital_ocean::get_digital_ocean_session,
        digital_ocean::list_digital_ocean_sessions,
        // heroku::connect_heroku,
        // heroku::disconnect_heroku,
        // heroku::list_heroku_dynos,
        // heroku::get_heroku_session,
        // heroku::list_heroku_sessions,
        // scaleway::connect_scaleway,
        // scaleway::disconnect_scaleway,
        // scaleway::list_scaleway_instances,
        // scaleway::get_scaleway_session,
        // scaleway::list_scaleway_sessions,
        // linode::connect_linode,
        // linode::disconnect_linode,
        // linode::list_linode_instances,
        // linode::get_linode_session,
        // linode::list_linode_sessions,
        // ovh::connect_ovh,
        // ovh::disconnect_ovh,
        // ovh::list_ovh_instances,
        // ovh::get_ovh_session,
        // ovh::list_ovh_sessions
        // Backup commands
        backup::backup_update_config,
        backup::backup_get_config,
        backup::backup_get_status,
        backup::backup_run_now,
        backup::backup_list,
        backup::backup_restore,
        backup::backup_delete,
        app_shell_commands::create_desktop_shortcut,
        app_shell_commands::scan_shortcuts,
        app_shell_commands::set_autostart,
        app_shell_commands::get_desktop_path,
        app_shell_commands::get_documents_path,
        app_shell_commands::get_appdata_path,
        app_shell_commands::check_file_exists,
        app_shell_commands::delete_file,
        app_shell_commands::open_folder,
        app_shell_commands::flash_window,
        // SFTP commands
        sftp::sftp_connect,
        sftp::sftp_disconnect,
        sftp::sftp_get_session_info,
        sftp::sftp_list_sessions,
        sftp::sftp_ping,
        sftp::sftp_set_directory,
        sftp::sftp_realpath,
        sftp::sftp_list_directory,
        sftp::sftp_mkdir,
        sftp::sftp_mkdir_p,
        sftp::sftp_rmdir,
        sftp::sftp_disk_usage,
        sftp::sftp_search,
        sftp::sftp_stat,
        sftp::sftp_lstat,
        sftp::sftp_rename,
        sftp::sftp_delete_file,
        sftp::sftp_delete_recursive,
        sftp::sftp_chmod,
        sftp::sftp_chown,
        sftp::sftp_create_symlink,
        sftp::sftp_read_link,
        sftp::sftp_touch,
        sftp::sftp_truncate,
        sftp::sftp_read_text_file,
        sftp::sftp_write_text_file,
        sftp::sftp_checksum,
        sftp::sftp_exists,
        sftp::sftp_upload,
        sftp::sftp_download,
        sftp::sftp_batch_transfer,
        sftp::sftp_get_transfer_progress,
        sftp::sftp_list_active_transfers,
        sftp::sftp_cancel_transfer,
        sftp::sftp_pause_transfer,
        sftp::sftp_clear_completed_transfers,
        sftp::sftp_queue_add,
        sftp::sftp_queue_remove,
        sftp::sftp_queue_list,
        sftp::sftp_queue_status,
        sftp::sftp_queue_start,
        sftp::sftp_queue_stop,
        sftp::sftp_queue_retry_failed,
        sftp::sftp_queue_clear_done,
        sftp::sftp_queue_set_priority,
        sftp::sftp_watch_start,
        sftp::sftp_watch_stop,
        sftp::sftp_watch_list,
        sftp::sftp_sync_pull,
        sftp::sftp_sync_push,
        sftp::sftp_bookmark_add,
        sftp::sftp_bookmark_remove,
        sftp::sftp_bookmark_update,
        sftp::sftp_bookmark_list,
        sftp::sftp_bookmark_touch,
        sftp::sftp_bookmark_import,
        sftp::sftp_bookmark_export,
        sftp::sftp_diagnose,
        // RustDesk commands — Binary / Client
        rustdesk::rustdesk_is_available,
        rustdesk::rustdesk_get_binary_info,
        rustdesk::rustdesk_detect_version,
        rustdesk::rustdesk_get_local_id,
        rustdesk::rustdesk_check_service_running,
        rustdesk::rustdesk_install_service,
        rustdesk::rustdesk_silent_install,
        rustdesk::rustdesk_set_permanent_password,
        // RustDesk commands — Server Configuration
        rustdesk::rustdesk_configure_server,
        rustdesk::rustdesk_get_server_config,
        rustdesk::rustdesk_set_client_config,
        rustdesk::rustdesk_get_client_config,
        // RustDesk commands — Connection Lifecycle
        rustdesk::rustdesk_connect,
        rustdesk::rustdesk_connect_direct_ip,
        rustdesk::rustdesk_disconnect,
        rustdesk::rustdesk_shutdown,
        // RustDesk commands — Sessions
        rustdesk::rustdesk_get_session,
        rustdesk::rustdesk_list_sessions,
        rustdesk::rustdesk_update_session_settings,
        rustdesk::rustdesk_send_input,
        rustdesk::rustdesk_active_session_count,
        // RustDesk commands — TCP Tunnels
        rustdesk::rustdesk_create_tunnel,
        rustdesk::rustdesk_close_tunnel,
        rustdesk::rustdesk_list_tunnels,
        rustdesk::rustdesk_get_tunnel,
        // RustDesk commands — File Transfers
        rustdesk::rustdesk_start_file_transfer,
        rustdesk::rustdesk_upload_file,
        rustdesk::rustdesk_download_file,
        rustdesk::rustdesk_list_file_transfers,
        rustdesk::rustdesk_get_file_transfer,
        rustdesk::rustdesk_active_file_transfers,
        rustdesk::rustdesk_transfer_progress,
        rustdesk::rustdesk_record_file_transfer,
        rustdesk::rustdesk_update_transfer_progress,
        rustdesk::rustdesk_cancel_file_transfer,
        rustdesk::rustdesk_list_remote_files,
        rustdesk::rustdesk_file_transfer_stats,
        // RustDesk commands — CLI Assignment
        rustdesk::rustdesk_assign_via_cli,
        // RustDesk commands — Server Admin: Devices
        rustdesk::rustdesk_api_list_devices,
        rustdesk::rustdesk_api_get_device,
        rustdesk::rustdesk_api_device_action,
        rustdesk::rustdesk_api_assign_device,
        // RustDesk commands — Server Admin: Users
        rustdesk::rustdesk_api_list_users,
        rustdesk::rustdesk_api_create_user,
        rustdesk::rustdesk_api_user_action,
        // RustDesk commands — Server Admin: User Groups
        rustdesk::rustdesk_api_list_user_groups,
        rustdesk::rustdesk_api_create_user_group,
        rustdesk::rustdesk_api_update_user_group,
        rustdesk::rustdesk_api_delete_user_group,
        rustdesk::rustdesk_api_add_users_to_group,
        // RustDesk commands — Server Admin: Device Groups
        rustdesk::rustdesk_api_list_device_groups,
        rustdesk::rustdesk_api_create_device_group,
        rustdesk::rustdesk_api_update_device_group,
        rustdesk::rustdesk_api_delete_device_group,
        rustdesk::rustdesk_api_add_devices_to_group,
        rustdesk::rustdesk_api_remove_devices_from_group,
        // RustDesk commands — Server Admin: Strategies
        rustdesk::rustdesk_api_list_strategies,
        rustdesk::rustdesk_api_get_strategy,
        rustdesk::rustdesk_api_enable_strategy,
        rustdesk::rustdesk_api_disable_strategy,
        rustdesk::rustdesk_api_assign_strategy,
        rustdesk::rustdesk_api_unassign_strategy,
        // RustDesk commands — Address Books
        rustdesk::rustdesk_api_list_address_books,
        rustdesk::rustdesk_api_get_personal_address_book,
        rustdesk::rustdesk_api_create_address_book,
        rustdesk::rustdesk_api_update_address_book,
        rustdesk::rustdesk_api_delete_address_book,
        rustdesk::rustdesk_api_list_ab_peers,
        rustdesk::rustdesk_api_add_ab_peer,
        rustdesk::rustdesk_api_update_ab_peer,
        rustdesk::rustdesk_api_remove_ab_peer,
        rustdesk::rustdesk_api_import_ab_peers,
        rustdesk::rustdesk_api_list_ab_tags,
        rustdesk::rustdesk_api_add_ab_tag,
        rustdesk::rustdesk_api_delete_ab_tag,
        rustdesk::rustdesk_api_list_ab_rules,
        rustdesk::rustdesk_api_add_ab_rule,
        rustdesk::rustdesk_api_delete_ab_rule,
        // RustDesk commands — Audit Logs
        rustdesk::rustdesk_api_connection_audits,
        rustdesk::rustdesk_api_file_audits,
        rustdesk::rustdesk_api_alarm_audits,
        rustdesk::rustdesk_api_console_audits,
        rustdesk::rustdesk_api_peer_audit_summary,
        rustdesk::rustdesk_api_operator_audit_summary,
        // RustDesk commands — Login
        rustdesk::rustdesk_api_login,
        // RustDesk commands — Diagnostics
        rustdesk::rustdesk_diagnostics_report,
        rustdesk::rustdesk_quick_health_check,
        rustdesk::rustdesk_server_health,
        rustdesk::rustdesk_server_latency,
        rustdesk::rustdesk_server_config_summary,
        rustdesk::rustdesk_client_config_summary,
        rustdesk::rustdesk_session_summary,
        // Bitwarden commands
        bitwarden::bw_check_cli,
        bitwarden::bw_status,
        bitwarden::bw_vault_status,
        bitwarden::bw_session_info,
        bitwarden::bw_get_config,
        bitwarden::bw_set_config,
        bitwarden::bw_config_server,
        bitwarden::bw_login,
        bitwarden::bw_login_2fa,
        bitwarden::bw_login_api_key,
        bitwarden::bw_unlock,
        bitwarden::bw_lock,
        bitwarden::bw_logout,
        bitwarden::bw_sync,
        bitwarden::bw_force_sync,
        bitwarden::bw_list_items,
        bitwarden::bw_search_items,
        bitwarden::bw_get_item,
        bitwarden::bw_create_item,
        bitwarden::bw_edit_item,
        bitwarden::bw_delete_item,
        bitwarden::bw_delete_item_permanent,
        bitwarden::bw_restore_item,
        bitwarden::bw_get_username,
        bitwarden::bw_get_password,
        bitwarden::bw_get_totp,
        bitwarden::bw_find_credentials,
        bitwarden::bw_list_folders,
        bitwarden::bw_create_folder,
        bitwarden::bw_edit_folder,
        bitwarden::bw_delete_folder,
        bitwarden::bw_list_collections,
        bitwarden::bw_list_organizations,
        bitwarden::bw_list_sends,
        bitwarden::bw_create_text_send,
        bitwarden::bw_delete_send,
        bitwarden::bw_create_attachment,
        bitwarden::bw_delete_attachment,
        bitwarden::bw_download_attachment,
        bitwarden::bw_generate_password,
        bitwarden::bw_generate_password_local,
        bitwarden::bw_export,
        bitwarden::bw_import,
        bitwarden::bw_vault_stats,
        bitwarden::bw_password_health,
        bitwarden::bw_find_duplicates,
        bitwarden::bw_start_serve,
        bitwarden::bw_stop_serve,
        bitwarden::bw_is_serve_running,
        // KeePass commands
        keepass::keepass_create_database,
        keepass::keepass_open_database,
        keepass::keepass_close_database,
        keepass::keepass_close_all_databases,
        keepass::keepass_save_database,
        keepass::keepass_lock_database,
        keepass::keepass_unlock_database,
        keepass::keepass_list_databases,
        keepass::keepass_backup_database,
        keepass::keepass_list_backups,
        keepass::keepass_change_master_key,
        keepass::keepass_get_database_file_info,
        keepass::keepass_get_database_statistics,
        keepass::keepass_merge_database,
        keepass::keepass_update_database_metadata,
        keepass::keepass_create_entry,
        keepass::keepass_get_entry,
        keepass::keepass_list_entries_in_group,
        keepass::keepass_list_all_entries,
        keepass::keepass_list_entries_recursive,
        keepass::keepass_update_entry,
        keepass::keepass_delete_entry,
        keepass::keepass_restore_entry,
        keepass::keepass_empty_recycle_bin,
        keepass::keepass_move_entry,
        keepass::keepass_copy_entry,
        keepass::keepass_get_entry_history,
        keepass::keepass_get_entry_history_item,
        keepass::keepass_restore_entry_from_history,
        keepass::keepass_delete_entry_history,
        keepass::keepass_diff_entry_with_history,
        keepass::keepass_get_entry_otp,
        keepass::keepass_password_health_report,
        keepass::keepass_create_group,
        keepass::keepass_get_group,
        keepass::keepass_list_groups,
        keepass::keepass_list_child_groups,
        keepass::keepass_get_group_tree,
        keepass::keepass_get_group_path,
        keepass::keepass_update_group,
        keepass::keepass_delete_group,
        keepass::keepass_move_group,
        keepass::keepass_sort_groups,
        keepass::keepass_group_entry_count,
        keepass::keepass_group_tags,
        keepass::keepass_add_custom_icon,
        keepass::keepass_get_custom_icon,
        keepass::keepass_list_custom_icons,
        keepass::keepass_delete_custom_icon,
        keepass::keepass_generate_password,
        keepass::keepass_generate_passwords,
        keepass::keepass_analyze_password,
        keepass::keepass_list_password_profiles,
        keepass::keepass_add_password_profile,
        keepass::keepass_remove_password_profile,
        keepass::keepass_create_key_file,
        keepass::keepass_verify_key_file,
        keepass::keepass_search_entries,
        keepass::keepass_quick_search,
        keepass::keepass_find_entries_for_url,
        keepass::keepass_find_duplicates,
        keepass::keepass_find_expiring_entries,
        keepass::keepass_find_weak_passwords,
        keepass::keepass_find_entries_without_password,
        keepass::keepass_get_all_tags,
        keepass::keepass_find_entries_by_tag,
        keepass::keepass_import_entries,
        keepass::keepass_export_entries,
        keepass::keepass_parse_autotype_sequence,
        keepass::keepass_resolve_autotype_sequence,
        keepass::keepass_find_autotype_matches,
        keepass::keepass_list_autotype_associations,
        keepass::keepass_validate_autotype_sequence,
        keepass::keepass_get_default_autotype_sequence,
        keepass::keepass_add_attachment,
        keepass::keepass_get_entry_attachments,
        keepass::keepass_get_attachment_data,
        keepass::keepass_remove_attachment,
        keepass::keepass_rename_attachment,
        keepass::keepass_save_attachment_to_file,
        keepass::keepass_import_attachment_from_file,
        keepass::keepass_get_attachment_pool_size,
        keepass::keepass_compact_attachment_pool,
        keepass::keepass_verify_attachment_integrity,
        keepass::keepass_list_recent_databases,
        keepass::keepass_add_recent_database,
        keepass::keepass_remove_recent_database,
        keepass::keepass_clear_recent_databases,
        keepass::keepass_get_change_log,
        keepass::keepass_get_settings,
        keepass::keepass_update_settings,
        keepass::keepass_shutdown,
        // Passbolt commands
        passbolt::pb_get_config,
        passbolt::pb_set_config,
        passbolt::pb_login_gpgauth,
        passbolt::pb_login_jwt,
        passbolt::pb_refresh_token,
        passbolt::pb_logout,
        passbolt::pb_check_session,
        passbolt::pb_is_authenticated,
        passbolt::pb_verify_mfa_totp,
        passbolt::pb_verify_mfa_yubikey,
        passbolt::pb_get_mfa_requirements,
        passbolt::pb_list_resources,
        passbolt::pb_get_resource,
        passbolt::pb_create_resource,
        passbolt::pb_update_resource,
        passbolt::pb_delete_resource,
        passbolt::pb_search_resources,
        passbolt::pb_list_favorite_resources,
        passbolt::pb_list_resources_in_folder,
        passbolt::pb_list_resource_types,
        passbolt::pb_get_secret,
        passbolt::pb_get_decrypted_secret,
        passbolt::pb_list_folders,
        passbolt::pb_get_folder,
        passbolt::pb_create_folder,
        passbolt::pb_update_folder,
        passbolt::pb_delete_folder,
        passbolt::pb_move_folder,
        passbolt::pb_move_resource,
        passbolt::pb_get_folder_tree,
        passbolt::pb_list_users,
        passbolt::pb_get_user,
        passbolt::pb_get_me,
        passbolt::pb_create_user,
        passbolt::pb_update_user,
        passbolt::pb_delete_user,
        passbolt::pb_delete_user_dry_run,
        passbolt::pb_search_users,
        passbolt::pb_list_groups,
        passbolt::pb_get_group,
        passbolt::pb_create_group,
        passbolt::pb_update_group,
        passbolt::pb_delete_group,
        passbolt::pb_update_group_dry_run,
        passbolt::pb_list_resource_permissions,
        passbolt::pb_share_resource,
        passbolt::pb_share_folder,
        passbolt::pb_simulate_share_resource,
        passbolt::pb_search_aros,
        passbolt::pb_add_favorite,
        passbolt::pb_remove_favorite,
        passbolt::pb_list_comments,
        passbolt::pb_add_comment,
        passbolt::pb_update_comment,
        passbolt::pb_delete_comment,
        passbolt::pb_list_tags,
        passbolt::pb_update_tag,
        passbolt::pb_delete_tag,
        passbolt::pb_add_tags_to_resource,
        passbolt::pb_list_gpg_keys,
        passbolt::pb_get_gpg_key,
        passbolt::pb_load_recipient_key,
        passbolt::pb_list_roles,
        passbolt::pb_list_metadata_keys,
        passbolt::pb_create_metadata_key,
        passbolt::pb_get_metadata_types_settings,
        passbolt::pb_list_metadata_session_keys,
        passbolt::pb_list_resources_needing_rotation,
        passbolt::pb_rotate_resource_metadata,
        passbolt::pb_list_resources_needing_upgrade,
        passbolt::pb_upgrade_resource_metadata,
        passbolt::pb_healthcheck,
        passbolt::pb_server_status,
        passbolt::pb_is_server_reachable,
        passbolt::pb_server_settings,
        passbolt::pb_directory_sync_dry_run,
        passbolt::pb_directory_sync,
        passbolt::pb_refresh_cache,
        passbolt::pb_invalidate_cache,
        passbolt::pb_get_cached_resources,
        passbolt::pb_get_cached_folders,
        // SCP commands
        scp::scp_connect,
        scp::scp_disconnect,
        scp::scp_disconnect_all,
        scp::scp_get_session_info,
        scp::scp_list_sessions,
        scp::scp_ping,
        scp::scp_remote_exists,
        scp::scp_remote_is_dir,
        scp::scp_remote_file_size,
        scp::scp_remote_mkdir_p,
        scp::scp_remote_rm,
        scp::scp_remote_rm_rf,
        scp::scp_remote_ls,
        scp::scp_remote_stat,
        scp::scp_remote_checksum,
        scp::scp_local_checksum,
        scp::scp_upload,
        scp::scp_download,
        scp::scp_batch_transfer,
        scp::scp_upload_directory,
        scp::scp_download_directory,
        scp::scp_get_transfer_progress,
        scp::scp_list_active_transfers,
        scp::scp_cancel_transfer,
        scp::scp_clear_completed_transfers,
        scp::scp_queue_add,
        scp::scp_queue_remove,
        scp::scp_queue_list,
        scp::scp_queue_status,
        scp::scp_queue_start,
        scp::scp_queue_stop,
        scp::scp_queue_retry_failed,
        scp::scp_queue_clear_done,
        scp::scp_queue_clear_all,
        scp::scp_queue_set_priority,
        scp::scp_queue_pause,
        scp::scp_queue_resume,
        scp::scp_get_history,
        scp::scp_clear_history,
        scp::scp_history_stats,
        scp::scp_diagnose,
        scp::scp_diagnose_connection,
        scp::scp_exec_remote,
    ]
}
