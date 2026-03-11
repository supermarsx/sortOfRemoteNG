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
        // ibm_commands::connect_ibm,
        // ibm_commands::disconnect_ibm,
        // ibm_commands::list_ibm_virtual_servers,
        // ibm_commands::get_ibm_session,
        // ibm_commands::list_ibm_sessions,
        digital_ocean_commands::connect_digital_ocean,
        digital_ocean_commands::disconnect_digital_ocean,
        digital_ocean_commands::list_digital_ocean_droplets,
        digital_ocean_commands::get_digital_ocean_session,
        digital_ocean_commands::list_digital_ocean_sessions,
        // heroku_commands::connect_heroku,
        // heroku_commands::disconnect_heroku,
        // heroku_commands::list_heroku_dynos,
        // heroku_commands::get_heroku_session,
        // heroku_commands::list_heroku_sessions,
        // scaleway_commands::connect_scaleway,
        // scaleway_commands::disconnect_scaleway,
        // scaleway_commands::list_scaleway_instances,
        // scaleway_commands::get_scaleway_session,
        // scaleway_commands::list_scaleway_sessions,
        // linode_commands::connect_linode,
        // linode_commands::disconnect_linode,
        // linode_commands::list_linode_instances,
        // linode_commands::get_linode_session,
        // linode_commands::list_linode_sessions,
        // ovh_commands::connect_ovh,
        // ovh_commands::disconnect_ovh,
        // ovh_commands::list_ovh_instances,
        // ovh_commands::get_ovh_session,
        // ovh_commands::list_ovh_sessions
        // Backup commands
        backup_commands::backup_update_config,
        backup_commands::backup_get_config,
        backup_commands::backup_get_status,
        backup_commands::backup_run_now,
        backup_commands::backup_list,
        backup_commands::backup_restore,
        backup_commands::backup_delete,
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
        sftp_commands::sftp_connect,
        sftp_commands::sftp_disconnect,
        sftp_commands::sftp_get_session_info,
        sftp_commands::sftp_list_sessions,
        sftp_commands::sftp_ping,
        sftp_commands::sftp_set_directory,
        sftp_commands::sftp_realpath,
        sftp_commands::sftp_list_directory,
        sftp_commands::sftp_mkdir,
        sftp_commands::sftp_mkdir_p,
        sftp_commands::sftp_rmdir,
        sftp_commands::sftp_disk_usage,
        sftp_commands::sftp_search,
        sftp_commands::sftp_stat,
        sftp_commands::sftp_lstat,
        sftp_commands::sftp_rename,
        sftp_commands::sftp_delete_file,
        sftp_commands::sftp_delete_recursive,
        sftp_commands::sftp_chmod,
        sftp_commands::sftp_chown,
        sftp_commands::sftp_create_symlink,
        sftp_commands::sftp_read_link,
        sftp_commands::sftp_touch,
        sftp_commands::sftp_truncate,
        sftp_commands::sftp_read_text_file,
        sftp_commands::sftp_write_text_file,
        sftp_commands::sftp_checksum,
        sftp_commands::sftp_exists,
        sftp_commands::sftp_upload,
        sftp_commands::sftp_download,
        sftp_commands::sftp_batch_transfer,
        sftp_commands::sftp_get_transfer_progress,
        sftp_commands::sftp_list_active_transfers,
        sftp_commands::sftp_cancel_transfer,
        sftp_commands::sftp_pause_transfer,
        sftp_commands::sftp_clear_completed_transfers,
        sftp_commands::sftp_queue_add,
        sftp_commands::sftp_queue_remove,
        sftp_commands::sftp_queue_list,
        sftp_commands::sftp_queue_status,
        sftp_commands::sftp_queue_start,
        sftp_commands::sftp_queue_stop,
        sftp_commands::sftp_queue_retry_failed,
        sftp_commands::sftp_queue_clear_done,
        sftp_commands::sftp_queue_set_priority,
        sftp_commands::sftp_watch_start,
        sftp_commands::sftp_watch_stop,
        sftp_commands::sftp_watch_list,
        sftp_commands::sftp_sync_pull,
        sftp_commands::sftp_sync_push,
        sftp_commands::sftp_bookmark_add,
        sftp_commands::sftp_bookmark_remove,
        sftp_commands::sftp_bookmark_update,
        sftp_commands::sftp_bookmark_list,
        sftp_commands::sftp_bookmark_touch,
        sftp_commands::sftp_bookmark_import,
        sftp_commands::sftp_bookmark_export,
        sftp_commands::sftp_diagnose,
        // RustDesk commands — Binary / Client
        rustdesk_commands::rustdesk_is_available,
        rustdesk_commands::rustdesk_get_binary_info,
        rustdesk_commands::rustdesk_detect_version,
        rustdesk_commands::rustdesk_get_local_id,
        rustdesk_commands::rustdesk_check_service_running,
        rustdesk_commands::rustdesk_install_service,
        rustdesk_commands::rustdesk_silent_install,
        rustdesk_commands::rustdesk_set_permanent_password,
        // RustDesk commands — Server Configuration
        rustdesk_commands::rustdesk_configure_server,
        rustdesk_commands::rustdesk_get_server_config,
        rustdesk_commands::rustdesk_set_client_config,
        rustdesk_commands::rustdesk_get_client_config,
        // RustDesk commands — Connection Lifecycle
        rustdesk_commands::rustdesk_connect,
        rustdesk_commands::rustdesk_connect_direct_ip,
        rustdesk_commands::rustdesk_disconnect,
        rustdesk_commands::rustdesk_shutdown,
        // RustDesk commands — Sessions
        rustdesk_commands::rustdesk_get_session,
        rustdesk_commands::rustdesk_list_sessions,
        rustdesk_commands::rustdesk_update_session_settings,
        rustdesk_commands::rustdesk_send_input,
        rustdesk_commands::rustdesk_active_session_count,
        // RustDesk commands — TCP Tunnels
        rustdesk_commands::rustdesk_create_tunnel,
        rustdesk_commands::rustdesk_close_tunnel,
        rustdesk_commands::rustdesk_list_tunnels,
        rustdesk_commands::rustdesk_get_tunnel,
        // RustDesk commands — File Transfers
        rustdesk_commands::rustdesk_start_file_transfer,
        rustdesk_commands::rustdesk_upload_file,
        rustdesk_commands::rustdesk_download_file,
        rustdesk_commands::rustdesk_list_file_transfers,
        rustdesk_commands::rustdesk_get_file_transfer,
        rustdesk_commands::rustdesk_active_file_transfers,
        rustdesk_commands::rustdesk_transfer_progress,
        rustdesk_commands::rustdesk_record_file_transfer,
        rustdesk_commands::rustdesk_update_transfer_progress,
        rustdesk_commands::rustdesk_cancel_file_transfer,
        rustdesk_commands::rustdesk_list_remote_files,
        rustdesk_commands::rustdesk_file_transfer_stats,
        // RustDesk commands — CLI Assignment
        rustdesk_commands::rustdesk_assign_via_cli,
        // RustDesk commands — Server Admin: Devices
        rustdesk_commands::rustdesk_api_list_devices,
        rustdesk_commands::rustdesk_api_get_device,
        rustdesk_commands::rustdesk_api_device_action,
        rustdesk_commands::rustdesk_api_assign_device,
        // RustDesk commands — Server Admin: Users
        rustdesk_commands::rustdesk_api_list_users,
        rustdesk_commands::rustdesk_api_create_user,
        rustdesk_commands::rustdesk_api_user_action,
        // RustDesk commands — Server Admin: User Groups
        rustdesk_commands::rustdesk_api_list_user_groups,
        rustdesk_commands::rustdesk_api_create_user_group,
        rustdesk_commands::rustdesk_api_update_user_group,
        rustdesk_commands::rustdesk_api_delete_user_group,
        rustdesk_commands::rustdesk_api_add_users_to_group,
        // RustDesk commands — Server Admin: Device Groups
        rustdesk_commands::rustdesk_api_list_device_groups,
        rustdesk_commands::rustdesk_api_create_device_group,
        rustdesk_commands::rustdesk_api_update_device_group,
        rustdesk_commands::rustdesk_api_delete_device_group,
        rustdesk_commands::rustdesk_api_add_devices_to_group,
        rustdesk_commands::rustdesk_api_remove_devices_from_group,
        // RustDesk commands — Server Admin: Strategies
        rustdesk_commands::rustdesk_api_list_strategies,
        rustdesk_commands::rustdesk_api_get_strategy,
        rustdesk_commands::rustdesk_api_enable_strategy,
        rustdesk_commands::rustdesk_api_disable_strategy,
        rustdesk_commands::rustdesk_api_assign_strategy,
        rustdesk_commands::rustdesk_api_unassign_strategy,
        // RustDesk commands — Address Books
        rustdesk_commands::rustdesk_api_list_address_books,
        rustdesk_commands::rustdesk_api_get_personal_address_book,
        rustdesk_commands::rustdesk_api_create_address_book,
        rustdesk_commands::rustdesk_api_update_address_book,
        rustdesk_commands::rustdesk_api_delete_address_book,
        rustdesk_commands::rustdesk_api_list_ab_peers,
        rustdesk_commands::rustdesk_api_add_ab_peer,
        rustdesk_commands::rustdesk_api_update_ab_peer,
        rustdesk_commands::rustdesk_api_remove_ab_peer,
        rustdesk_commands::rustdesk_api_import_ab_peers,
        rustdesk_commands::rustdesk_api_list_ab_tags,
        rustdesk_commands::rustdesk_api_add_ab_tag,
        rustdesk_commands::rustdesk_api_delete_ab_tag,
        rustdesk_commands::rustdesk_api_list_ab_rules,
        rustdesk_commands::rustdesk_api_add_ab_rule,
        rustdesk_commands::rustdesk_api_delete_ab_rule,
        // RustDesk commands — Audit Logs
        rustdesk_commands::rustdesk_api_connection_audits,
        rustdesk_commands::rustdesk_api_file_audits,
        rustdesk_commands::rustdesk_api_alarm_audits,
        rustdesk_commands::rustdesk_api_console_audits,
        rustdesk_commands::rustdesk_api_peer_audit_summary,
        rustdesk_commands::rustdesk_api_operator_audit_summary,
        // RustDesk commands — Login
        rustdesk_commands::rustdesk_api_login,
        // RustDesk commands — Diagnostics
        rustdesk_commands::rustdesk_diagnostics_report,
        rustdesk_commands::rustdesk_quick_health_check,
        rustdesk_commands::rustdesk_server_health,
        rustdesk_commands::rustdesk_server_latency,
        rustdesk_commands::rustdesk_server_config_summary,
        rustdesk_commands::rustdesk_client_config_summary,
        rustdesk_commands::rustdesk_session_summary,
        // Bitwarden commands
        bitwarden_commands::bw_check_cli,
        bitwarden_commands::bw_status,
        bitwarden_commands::bw_vault_status,
        bitwarden_commands::bw_session_info,
        bitwarden_commands::bw_get_config,
        bitwarden_commands::bw_set_config,
        bitwarden_commands::bw_config_server,
        bitwarden_commands::bw_login,
        bitwarden_commands::bw_login_2fa,
        bitwarden_commands::bw_login_api_key,
        bitwarden_commands::bw_unlock,
        bitwarden_commands::bw_lock,
        bitwarden_commands::bw_logout,
        bitwarden_commands::bw_sync,
        bitwarden_commands::bw_force_sync,
        bitwarden_commands::bw_list_items,
        bitwarden_commands::bw_search_items,
        bitwarden_commands::bw_get_item,
        bitwarden_commands::bw_create_item,
        bitwarden_commands::bw_edit_item,
        bitwarden_commands::bw_delete_item,
        bitwarden_commands::bw_delete_item_permanent,
        bitwarden_commands::bw_restore_item,
        bitwarden_commands::bw_get_username,
        bitwarden_commands::bw_get_password,
        bitwarden_commands::bw_get_totp,
        bitwarden_commands::bw_find_credentials,
        bitwarden_commands::bw_list_folders,
        bitwarden_commands::bw_create_folder,
        bitwarden_commands::bw_edit_folder,
        bitwarden_commands::bw_delete_folder,
        bitwarden_commands::bw_list_collections,
        bitwarden_commands::bw_list_organizations,
        bitwarden_commands::bw_list_sends,
        bitwarden_commands::bw_create_text_send,
        bitwarden_commands::bw_delete_send,
        bitwarden_commands::bw_create_attachment,
        bitwarden_commands::bw_delete_attachment,
        bitwarden_commands::bw_download_attachment,
        bitwarden_commands::bw_generate_password,
        bitwarden_commands::bw_generate_password_local,
        bitwarden_commands::bw_export,
        bitwarden_commands::bw_import,
        bitwarden_commands::bw_vault_stats,
        bitwarden_commands::bw_password_health,
        bitwarden_commands::bw_find_duplicates,
        bitwarden_commands::bw_start_serve,
        bitwarden_commands::bw_stop_serve,
        bitwarden_commands::bw_is_serve_running,
        // KeePass commands
        keepass_commands::keepass_create_database,
        keepass_commands::keepass_open_database,
        keepass_commands::keepass_close_database,
        keepass_commands::keepass_close_all_databases,
        keepass_commands::keepass_save_database,
        keepass_commands::keepass_lock_database,
        keepass_commands::keepass_unlock_database,
        keepass_commands::keepass_list_databases,
        keepass_commands::keepass_backup_database,
        keepass_commands::keepass_list_backups,
        keepass_commands::keepass_change_master_key,
        keepass_commands::keepass_get_database_file_info,
        keepass_commands::keepass_get_database_statistics,
        keepass_commands::keepass_merge_database,
        keepass_commands::keepass_update_database_metadata,
        keepass_commands::keepass_create_entry,
        keepass_commands::keepass_get_entry,
        keepass_commands::keepass_list_entries_in_group,
        keepass_commands::keepass_list_all_entries,
        keepass_commands::keepass_list_entries_recursive,
        keepass_commands::keepass_update_entry,
        keepass_commands::keepass_delete_entry,
        keepass_commands::keepass_restore_entry,
        keepass_commands::keepass_empty_recycle_bin,
        keepass_commands::keepass_move_entry,
        keepass_commands::keepass_copy_entry,
        keepass_commands::keepass_get_entry_history,
        keepass_commands::keepass_get_entry_history_item,
        keepass_commands::keepass_restore_entry_from_history,
        keepass_commands::keepass_delete_entry_history,
        keepass_commands::keepass_diff_entry_with_history,
        keepass_commands::keepass_get_entry_otp,
        keepass_commands::keepass_password_health_report,
        keepass_commands::keepass_create_group,
        keepass_commands::keepass_get_group,
        keepass_commands::keepass_list_groups,
        keepass_commands::keepass_list_child_groups,
        keepass_commands::keepass_get_group_tree,
        keepass_commands::keepass_get_group_path,
        keepass_commands::keepass_update_group,
        keepass_commands::keepass_delete_group,
        keepass_commands::keepass_move_group,
        keepass_commands::keepass_sort_groups,
        keepass_commands::keepass_group_entry_count,
        keepass_commands::keepass_group_tags,
        keepass_commands::keepass_add_custom_icon,
        keepass_commands::keepass_get_custom_icon,
        keepass_commands::keepass_list_custom_icons,
        keepass_commands::keepass_delete_custom_icon,
        keepass_commands::keepass_generate_password,
        keepass_commands::keepass_generate_passwords,
        keepass_commands::keepass_analyze_password,
        keepass_commands::keepass_list_password_profiles,
        keepass_commands::keepass_add_password_profile,
        keepass_commands::keepass_remove_password_profile,
        keepass_commands::keepass_create_key_file,
        keepass_commands::keepass_verify_key_file,
        keepass_commands::keepass_search_entries,
        keepass_commands::keepass_quick_search,
        keepass_commands::keepass_find_entries_for_url,
        keepass_commands::keepass_find_duplicates,
        keepass_commands::keepass_find_expiring_entries,
        keepass_commands::keepass_find_weak_passwords,
        keepass_commands::keepass_find_entries_without_password,
        keepass_commands::keepass_get_all_tags,
        keepass_commands::keepass_find_entries_by_tag,
        keepass_commands::keepass_import_entries,
        keepass_commands::keepass_export_entries,
        keepass_commands::keepass_parse_autotype_sequence,
        keepass_commands::keepass_resolve_autotype_sequence,
        keepass_commands::keepass_find_autotype_matches,
        keepass_commands::keepass_list_autotype_associations,
        keepass_commands::keepass_validate_autotype_sequence,
        keepass_commands::keepass_get_default_autotype_sequence,
        keepass_commands::keepass_add_attachment,
        keepass_commands::keepass_get_entry_attachments,
        keepass_commands::keepass_get_attachment_data,
        keepass_commands::keepass_remove_attachment,
        keepass_commands::keepass_rename_attachment,
        keepass_commands::keepass_save_attachment_to_file,
        keepass_commands::keepass_import_attachment_from_file,
        keepass_commands::keepass_get_attachment_pool_size,
        keepass_commands::keepass_compact_attachment_pool,
        keepass_commands::keepass_verify_attachment_integrity,
        keepass_commands::keepass_list_recent_databases,
        keepass_commands::keepass_add_recent_database,
        keepass_commands::keepass_remove_recent_database,
        keepass_commands::keepass_clear_recent_databases,
        keepass_commands::keepass_get_change_log,
        keepass_commands::keepass_get_settings,
        keepass_commands::keepass_update_settings,
        keepass_commands::keepass_shutdown,
        // Passbolt commands
        passbolt_commands::pb_get_config,
        passbolt_commands::pb_set_config,
        passbolt_commands::pb_login_gpgauth,
        passbolt_commands::pb_login_jwt,
        passbolt_commands::pb_refresh_token,
        passbolt_commands::pb_logout,
        passbolt_commands::pb_check_session,
        passbolt_commands::pb_is_authenticated,
        passbolt_commands::pb_verify_mfa_totp,
        passbolt_commands::pb_verify_mfa_yubikey,
        passbolt_commands::pb_get_mfa_requirements,
        passbolt_commands::pb_list_resources,
        passbolt_commands::pb_get_resource,
        passbolt_commands::pb_create_resource,
        passbolt_commands::pb_update_resource,
        passbolt_commands::pb_delete_resource,
        passbolt_commands::pb_search_resources,
        passbolt_commands::pb_list_favorite_resources,
        passbolt_commands::pb_list_resources_in_folder,
        passbolt_commands::pb_list_resource_types,
        passbolt_commands::pb_get_secret,
        passbolt_commands::pb_get_decrypted_secret,
        passbolt_commands::pb_list_folders,
        passbolt_commands::pb_get_folder,
        passbolt_commands::pb_create_folder,
        passbolt_commands::pb_update_folder,
        passbolt_commands::pb_delete_folder,
        passbolt_commands::pb_move_folder,
        passbolt_commands::pb_move_resource,
        passbolt_commands::pb_get_folder_tree,
        passbolt_commands::pb_list_users,
        passbolt_commands::pb_get_user,
        passbolt_commands::pb_get_me,
        passbolt_commands::pb_create_user,
        passbolt_commands::pb_update_user,
        passbolt_commands::pb_delete_user,
        passbolt_commands::pb_delete_user_dry_run,
        passbolt_commands::pb_search_users,
        passbolt_commands::pb_list_groups,
        passbolt_commands::pb_get_group,
        passbolt_commands::pb_create_group,
        passbolt_commands::pb_update_group,
        passbolt_commands::pb_delete_group,
        passbolt_commands::pb_update_group_dry_run,
        passbolt_commands::pb_list_resource_permissions,
        passbolt_commands::pb_share_resource,
        passbolt_commands::pb_share_folder,
        passbolt_commands::pb_simulate_share_resource,
        passbolt_commands::pb_search_aros,
        passbolt_commands::pb_add_favorite,
        passbolt_commands::pb_remove_favorite,
        passbolt_commands::pb_list_comments,
        passbolt_commands::pb_add_comment,
        passbolt_commands::pb_update_comment,
        passbolt_commands::pb_delete_comment,
        passbolt_commands::pb_list_tags,
        passbolt_commands::pb_update_tag,
        passbolt_commands::pb_delete_tag,
        passbolt_commands::pb_add_tags_to_resource,
        passbolt_commands::pb_list_gpg_keys,
        passbolt_commands::pb_get_gpg_key,
        passbolt_commands::pb_load_recipient_key,
        passbolt_commands::pb_list_roles,
        passbolt_commands::pb_list_metadata_keys,
        passbolt_commands::pb_create_metadata_key,
        passbolt_commands::pb_get_metadata_types_settings,
        passbolt_commands::pb_list_metadata_session_keys,
        passbolt_commands::pb_list_resources_needing_rotation,
        passbolt_commands::pb_rotate_resource_metadata,
        passbolt_commands::pb_list_resources_needing_upgrade,
        passbolt_commands::pb_upgrade_resource_metadata,
        passbolt_commands::pb_healthcheck,
        passbolt_commands::pb_server_status,
        passbolt_commands::pb_is_server_reachable,
        passbolt_commands::pb_server_settings,
        passbolt_commands::pb_directory_sync_dry_run,
        passbolt_commands::pb_directory_sync,
        passbolt_commands::pb_refresh_cache,
        passbolt_commands::pb_invalidate_cache,
        passbolt_commands::pb_get_cached_resources,
        passbolt_commands::pb_get_cached_folders,
        // SCP commands
        scp_commands::scp_connect,
        scp_commands::scp_disconnect,
        scp_commands::scp_disconnect_all,
        scp_commands::scp_get_session_info,
        scp_commands::scp_list_sessions,
        scp_commands::scp_ping,
        scp_commands::scp_remote_exists,
        scp_commands::scp_remote_is_dir,
        scp_commands::scp_remote_file_size,
        scp_commands::scp_remote_mkdir_p,
        scp_commands::scp_remote_rm,
        scp_commands::scp_remote_rm_rf,
        scp_commands::scp_remote_ls,
        scp_commands::scp_remote_stat,
        scp_commands::scp_remote_checksum,
        scp_commands::scp_local_checksum,
        scp_commands::scp_upload,
        scp_commands::scp_download,
        scp_commands::scp_batch_transfer,
        scp_commands::scp_upload_directory,
        scp_commands::scp_download_directory,
        scp_commands::scp_get_transfer_progress,
        scp_commands::scp_list_active_transfers,
        scp_commands::scp_cancel_transfer,
        scp_commands::scp_clear_completed_transfers,
        scp_commands::scp_queue_add,
        scp_commands::scp_queue_remove,
        scp_commands::scp_queue_list,
        scp_commands::scp_queue_status,
        scp_commands::scp_queue_start,
        scp_commands::scp_queue_stop,
        scp_commands::scp_queue_retry_failed,
        scp_commands::scp_queue_clear_done,
        scp_commands::scp_queue_clear_all,
        scp_commands::scp_queue_set_priority,
        scp_commands::scp_queue_pause,
        scp_commands::scp_queue_resume,
        scp_commands::scp_get_history,
        scp_commands::scp_clear_history,
        scp_commands::scp_history_stats,
        scp_commands::scp_diagnose,
        scp_commands::scp_diagnose_connection,
        scp_commands::scp_exec_remote,
    ]
}
