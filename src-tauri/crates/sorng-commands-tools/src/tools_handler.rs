use crate::*;

pub fn is_command(command: &str) -> bool {
    matches!(
        command,
        "warpgate_connect"
            | "warpgate_disconnect"
            | "warpgate_list_connections"
            | "warpgate_ping"
            | "warpgate_list_targets"
            | "warpgate_create_target"
            | "warpgate_get_target"
            | "warpgate_update_target"
            | "warpgate_delete_target"
            | "warpgate_get_target_ssh_host_keys"
            | "warpgate_get_target_roles"
            | "warpgate_add_target_role"
            | "warpgate_remove_target_role"
            | "warpgate_list_target_groups"
            | "warpgate_create_target_group"
            | "warpgate_get_target_group"
            | "warpgate_update_target_group"
            | "warpgate_delete_target_group"
            | "warpgate_list_users"
            | "warpgate_create_user"
            | "warpgate_get_user"
            | "warpgate_update_user"
            | "warpgate_delete_user"
            | "warpgate_get_user_roles"
            | "warpgate_add_user_role"
            | "warpgate_remove_user_role"
            | "warpgate_unlink_user_ldap"
            | "warpgate_auto_link_user_ldap"
            | "warpgate_list_roles"
            | "warpgate_create_role"
            | "warpgate_get_role"
            | "warpgate_update_role"
            | "warpgate_delete_role"
            | "warpgate_get_role_targets"
            | "warpgate_get_role_users"
            | "warpgate_list_sessions"
            | "warpgate_get_session"
            | "warpgate_close_session"
            | "warpgate_close_all_sessions"
            | "warpgate_get_session_recordings"
            | "warpgate_get_recording"
            | "warpgate_get_recording_cast"
            | "warpgate_get_recording_tcpdump"
            | "warpgate_get_recording_kubernetes"
            | "warpgate_list_tickets"
            | "warpgate_create_ticket"
            | "warpgate_delete_ticket"
            | "warpgate_list_password_credentials"
            | "warpgate_create_password_credential"
            | "warpgate_delete_password_credential"
            | "warpgate_list_public_key_credentials"
            | "warpgate_create_public_key_credential"
            | "warpgate_update_public_key_credential"
            | "warpgate_delete_public_key_credential"
            | "warpgate_list_sso_credentials"
            | "warpgate_create_sso_credential"
            | "warpgate_update_sso_credential"
            | "warpgate_delete_sso_credential"
            | "warpgate_list_otp_credentials"
            | "warpgate_create_otp_credential"
            | "warpgate_delete_otp_credential"
            | "warpgate_list_certificate_credentials"
            | "warpgate_issue_certificate_credential"
            | "warpgate_update_certificate_credential"
            | "warpgate_revoke_certificate_credential"
            | "warpgate_get_ssh_own_keys"
            | "warpgate_list_known_hosts"
            | "warpgate_add_known_host"
            | "warpgate_delete_known_host"
            | "warpgate_check_ssh_host_key"
            | "warpgate_list_ldap_servers"
            | "warpgate_create_ldap_server"
            | "warpgate_get_ldap_server"
            | "warpgate_update_ldap_server"
            | "warpgate_delete_ldap_server"
            | "warpgate_test_ldap_connection"
            | "warpgate_get_ldap_users"
            | "warpgate_import_ldap_users"
            | "warpgate_query_logs"
            | "warpgate_get_parameters"
            | "warpgate_update_parameters"
            | "opkssh_check_binary"
            | "opkssh_get_download_url"
            | "opkssh_login"
            | "opkssh_list_keys"
            | "opkssh_remove_key"
            | "opkssh_get_client_config"
            | "opkssh_update_client_config"
            | "opkssh_well_known_providers"
            | "opkssh_build_env_string"
            | "opkssh_server_read_config_script"
            | "opkssh_parse_server_config"
            | "opkssh_get_server_config"
            | "opkssh_build_add_identity_cmd"
            | "opkssh_build_remove_identity_cmd"
            | "opkssh_build_add_provider_cmd"
            | "opkssh_build_remove_provider_cmd"
            | "opkssh_build_install_cmd"
            | "opkssh_build_audit_cmd"
            | "opkssh_parse_audit_output"
            | "opkssh_get_audit_results"
            | "opkssh_get_status"
            | "ssh_scripts_create_script"
            | "ssh_scripts_get_script"
            | "ssh_scripts_list_scripts"
            | "ssh_scripts_update_script"
            | "ssh_scripts_delete_script"
            | "ssh_scripts_duplicate_script"
            | "ssh_scripts_toggle_script"
            | "ssh_scripts_create_chain"
            | "ssh_scripts_get_chain"
            | "ssh_scripts_list_chains"
            | "ssh_scripts_update_chain"
            | "ssh_scripts_delete_chain"
            | "ssh_scripts_toggle_chain"
            | "ssh_scripts_run_script"
            | "ssh_scripts_run_chain"
            | "ssh_scripts_record_execution"
            | "ssh_scripts_notify_event"
            | "ssh_scripts_notify_output"
            | "ssh_scripts_scheduler_tick"
            | "ssh_scripts_register_session"
            | "ssh_scripts_unregister_session"
            | "ssh_scripts_query_history"
            | "ssh_scripts_get_execution"
            | "ssh_scripts_get_chain_execution"
            | "ssh_scripts_get_script_stats"
            | "ssh_scripts_get_all_stats"
            | "ssh_scripts_clear_history"
            | "ssh_scripts_clear_script_history"
            | "ssh_scripts_list_timers"
            | "ssh_scripts_list_session_timers"
            | "ssh_scripts_pause_timer"
            | "ssh_scripts_resume_timer"
            | "ssh_scripts_list_by_tag"
            | "ssh_scripts_list_by_category"
            | "ssh_scripts_list_by_trigger"
            | "ssh_scripts_get_tags"
            | "ssh_scripts_get_categories"
            | "ssh_scripts_export"
            | "ssh_scripts_import"
            | "ssh_scripts_bulk_enable"
            | "ssh_scripts_bulk_delete"
            | "ssh_scripts_get_summary"
            | "mcp_get_status"
            | "mcp_start_server"
            | "mcp_stop_server"
            | "mcp_get_config"
            | "mcp_update_config"
            | "mcp_generate_api_key"
            | "mcp_list_sessions"
            | "mcp_disconnect_session"
            | "mcp_get_metrics"
            | "mcp_get_tools"
            | "mcp_get_resources"
            | "mcp_get_prompts"
            | "mcp_get_logs"
            | "mcp_get_events"
            | "mcp_get_tool_call_logs"
            | "mcp_clear_logs"
            | "mcp_reset_metrics"
            | "mcp_handle_request"
            | "snmp_get"
            | "snmp_get_next"
            | "snmp_get_bulk"
            | "snmp_set_value"
            | "snmp_walk"
            | "snmp_get_table"
            | "snmp_get_if_table"
            | "snmp_get_system_info"
            | "snmp_get_interfaces"
            | "snmp_discover"
            | "snmp_start_trap_receiver"
            | "snmp_stop_trap_receiver"
            | "snmp_get_trap_receiver_status"
            | "snmp_get_traps"
            | "snmp_clear_traps"
            | "snmp_mib_resolve_oid"
            | "snmp_mib_resolve_name"
            | "snmp_mib_search"
            | "snmp_mib_load_text"
            | "snmp_mib_get_subtree"
            | "snmp_add_monitor"
            | "snmp_remove_monitor"
            | "snmp_start_monitor"
            | "snmp_stop_monitor"
            | "snmp_get_monitor_alerts"
            | "snmp_acknowledge_alert"
            | "snmp_clear_alerts"
            | "snmp_add_target"
            | "snmp_remove_target"
            | "snmp_list_targets"
            | "snmp_add_usm_user"
            | "snmp_remove_usm_user"
            | "snmp_list_usm_users"
            | "snmp_add_device"
            | "snmp_remove_device"
            | "snmp_list_devices"
            | "snmp_get_service_status"
            | "snmp_bulk_get"
            | "snmp_bulk_walk"
            | "dash_get_state"
            | "dash_get_health_summary"
            | "dash_get_quick_stats"
            | "dash_get_alerts"
            | "dash_acknowledge_alert"
            | "dash_get_connection_health"
            | "dash_get_all_health"
            | "dash_get_unhealthy"
            | "dash_get_sparkline"
            | "dash_get_widget_data"
            | "dash_start_monitoring"
            | "dash_stop_monitoring"
            | "dash_force_refresh"
            | "dash_get_config"
            | "dash_update_config"
            | "dash_get_layout"
            | "dash_update_layout"
            | "dash_get_heatmap"
            | "dash_get_recent"
            | "dash_get_top_latency"
            | "dash_check_connection"
            | "hook_subscribe"
            | "hook_unsubscribe"
            | "hook_list_subscriptions"
            | "hook_get_subscription"
            | "hook_enable_subscription"
            | "hook_disable_subscription"
            | "hook_dispatch_event"
            | "hook_get_recent_events"
            | "hook_get_events_by_type"
            | "hook_get_stats"
            | "hook_clear_events"
            | "hook_create_pipeline"
            | "hook_delete_pipeline"
            | "hook_list_pipelines"
            | "hook_execute_pipeline"
            | "hook_get_config"
            | "hook_update_config"
            | "notif_add_rule"
            | "notif_remove_rule"
            | "notif_list_rules"
            | "notif_get_rule"
            | "notif_enable_rule"
            | "notif_disable_rule"
            | "notif_update_rule"
            | "notif_add_template"
            | "notif_remove_template"
            | "notif_list_templates"
            | "notif_process_event"
            | "notif_get_history"
            | "notif_get_recent_history"
            | "notif_clear_history"
            | "notif_get_stats"
            | "notif_get_config"
            | "notif_update_config"
            | "notif_test_channel"
            | "notif_acknowledge_escalation"
            | "topo_build_from_connections"
            | "topo_get_graph"
            | "topo_add_node"
            | "topo_remove_node"
            | "topo_update_node"
            | "topo_add_edge"
            | "topo_remove_edge"
            | "topo_apply_layout"
            | "topo_get_blast_radius"
            | "topo_find_bottlenecks"
            | "topo_find_critical_edges"
            | "topo_get_path"
            | "topo_get_neighbors"
            | "topo_get_connected_components"
            | "topo_get_stats"
            | "topo_create_snapshot"
            | "topo_list_snapshots"
            | "topo_add_group"
            | "topo_remove_group"
            | "filter_create"
            | "filter_delete"
            | "filter_update"
            | "filter_get"
            | "filter_list"
            | "filter_evaluate"
            | "filter_get_presets"
            | "filter_create_smart_group"
            | "filter_delete_smart_group"
            | "filter_list_smart_groups"
            | "filter_update_smart_group"
            | "filter_evaluate_smart_group"
            | "filter_invalidate_cache"
            | "filter_get_stats"
            | "filter_get_config"
            | "filter_update_config"
            | "cred_add"
            | "cred_remove"
            | "cred_update"
            | "cred_get"
            | "cred_list"
            | "cred_record_rotation"
            | "cred_check_expiry"
            | "cred_check_all_expiries"
            | "cred_get_stale"
            | "cred_get_expiring_soon"
            | "cred_get_expired"
            | "cred_add_policy"
            | "cred_remove_policy"
            | "cred_list_policies"
            | "cred_check_compliance"
            | "cred_check_strength"
            | "cred_detect_duplicates"
            | "cred_create_group"
            | "cred_delete_group"
            | "cred_list_groups"
            | "cred_add_to_group"
            | "cred_remove_from_group"
            | "cred_get_alerts"
            | "cred_acknowledge_alert"
            | "cred_generate_alerts"
            | "cred_get_audit_log"
            | "cred_get_stats"
            | "cred_get_config"
            | "cred_update_config"
            | "replay_load_terminal"
            | "replay_load_video"
            | "replay_load_har"
            | "replay_play"
            | "replay_pause"
            | "replay_stop"
            | "replay_seek"
            | "replay_set_speed"
            | "replay_get_state"
            | "replay_get_position"
            | "replay_get_frame_at"
            | "replay_get_terminal_state_at"
            | "replay_advance_frame"
            | "replay_get_timeline"
            | "replay_get_markers"
            | "replay_get_heatmap"
            | "replay_search"
            | "replay_add_annotation"
            | "replay_remove_annotation"
            | "replay_list_annotations"
            | "replay_add_bookmark"
            | "replay_remove_bookmark"
            | "replay_list_bookmarks"
            | "replay_export"
            | "replay_get_stats"
            | "replay_get_config"
            | "replay_update_config"
            | "replay_get_har_waterfall"
            | "replay_get_har_stats"
            | "rdpfile_parse"
            | "rdpfile_generate"
            | "rdpfile_import"
            | "rdpfile_export"
            | "rdpfile_batch_export"
            | "rdpfile_batch_import"
            | "rdpfile_validate"
            | "updater_check"
            | "updater_download"
            | "updater_cancel_download"
            | "updater_install"
            | "updater_schedule_install"
            | "updater_get_status"
            | "updater_get_config"
            | "updater_update_config"
            | "updater_set_channel"
            | "updater_get_version_info"
            | "updater_get_history"
            | "updater_rollback"
            | "updater_get_rollbacks"
            | "updater_get_release_notes"
            | "mkt_search"
            | "mkt_get_listing"
            | "mkt_get_categories"
            | "mkt_get_featured"
            | "mkt_get_popular"
            | "mkt_install"
            | "mkt_uninstall"
            | "mkt_update"
            | "mkt_get_installed"
            | "mkt_check_updates"
            | "mkt_refresh_repositories"
            | "mkt_add_repository"
            | "mkt_remove_repository"
            | "mkt_list_repositories"
            | "mkt_get_reviews"
            | "mkt_add_review"
            | "mkt_get_stats"
            | "mkt_get_config"
            | "mkt_update_config"
            | "mkt_validate_manifest"
            | "portable_detect_mode"
            | "portable_get_status"
            | "portable_get_paths"
            | "portable_get_config"
            | "portable_update_config"
            | "portable_migrate_to_portable"
            | "portable_migrate_to_installed"
            | "portable_create_marker"
            | "portable_remove_marker"
            | "portable_validate"
            | "portable_get_drive_info"
            | "sched_add_task"
            | "sched_remove_task"
            | "sched_update_task"
            | "sched_get_task"
            | "sched_list_tasks"
            | "sched_enable_task"
            | "sched_disable_task"
            | "sched_execute_now"
            | "sched_cancel_task"
            | "sched_get_history"
            | "sched_get_upcoming"
            | "sched_get_stats"
            | "sched_get_config"
            | "sched_update_config"
            | "sched_cleanup_history"
            | "sched_validate_cron"
            | "sched_get_next_occurrences"
            | "sched_pause_all"
            | "sched_resume_all"
    )
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Warpgate bastion host admin commands
        warpgate_commands::warpgate_connect,
        warpgate_commands::warpgate_disconnect,
        warpgate_commands::warpgate_list_connections,
        warpgate_commands::warpgate_ping,
        warpgate_commands::warpgate_list_targets,
        warpgate_commands::warpgate_create_target,
        warpgate_commands::warpgate_get_target,
        warpgate_commands::warpgate_update_target,
        warpgate_commands::warpgate_delete_target,
        warpgate_commands::warpgate_get_target_ssh_host_keys,
        warpgate_commands::warpgate_get_target_roles,
        warpgate_commands::warpgate_add_target_role,
        warpgate_commands::warpgate_remove_target_role,
        warpgate_commands::warpgate_list_target_groups,
        warpgate_commands::warpgate_create_target_group,
        warpgate_commands::warpgate_get_target_group,
        warpgate_commands::warpgate_update_target_group,
        warpgate_commands::warpgate_delete_target_group,
        warpgate_commands::warpgate_list_users,
        warpgate_commands::warpgate_create_user,
        warpgate_commands::warpgate_get_user,
        warpgate_commands::warpgate_update_user,
        warpgate_commands::warpgate_delete_user,
        warpgate_commands::warpgate_get_user_roles,
        warpgate_commands::warpgate_add_user_role,
        warpgate_commands::warpgate_remove_user_role,
        warpgate_commands::warpgate_unlink_user_ldap,
        warpgate_commands::warpgate_auto_link_user_ldap,
        warpgate_commands::warpgate_list_roles,
        warpgate_commands::warpgate_create_role,
        warpgate_commands::warpgate_get_role,
        warpgate_commands::warpgate_update_role,
        warpgate_commands::warpgate_delete_role,
        warpgate_commands::warpgate_get_role_targets,
        warpgate_commands::warpgate_get_role_users,
        warpgate_commands::warpgate_list_sessions,
        warpgate_commands::warpgate_get_session,
        warpgate_commands::warpgate_close_session,
        warpgate_commands::warpgate_close_all_sessions,
        warpgate_commands::warpgate_get_session_recordings,
        warpgate_commands::warpgate_get_recording,
        warpgate_commands::warpgate_get_recording_cast,
        warpgate_commands::warpgate_get_recording_tcpdump,
        warpgate_commands::warpgate_get_recording_kubernetes,
        warpgate_commands::warpgate_list_tickets,
        warpgate_commands::warpgate_create_ticket,
        warpgate_commands::warpgate_delete_ticket,
        warpgate_commands::warpgate_list_password_credentials,
        warpgate_commands::warpgate_create_password_credential,
        warpgate_commands::warpgate_delete_password_credential,
        warpgate_commands::warpgate_list_public_key_credentials,
        warpgate_commands::warpgate_create_public_key_credential,
        warpgate_commands::warpgate_update_public_key_credential,
        warpgate_commands::warpgate_delete_public_key_credential,
        warpgate_commands::warpgate_list_sso_credentials,
        warpgate_commands::warpgate_create_sso_credential,
        warpgate_commands::warpgate_update_sso_credential,
        warpgate_commands::warpgate_delete_sso_credential,
        warpgate_commands::warpgate_list_otp_credentials,
        warpgate_commands::warpgate_create_otp_credential,
        warpgate_commands::warpgate_delete_otp_credential,
        warpgate_commands::warpgate_list_certificate_credentials,
        warpgate_commands::warpgate_issue_certificate_credential,
        warpgate_commands::warpgate_update_certificate_credential,
        warpgate_commands::warpgate_revoke_certificate_credential,
        warpgate_commands::warpgate_get_ssh_own_keys,
        warpgate_commands::warpgate_list_known_hosts,
        warpgate_commands::warpgate_add_known_host,
        warpgate_commands::warpgate_delete_known_host,
        warpgate_commands::warpgate_check_ssh_host_key,
        warpgate_commands::warpgate_list_ldap_servers,
        warpgate_commands::warpgate_create_ldap_server,
        warpgate_commands::warpgate_get_ldap_server,
        warpgate_commands::warpgate_update_ldap_server,
        warpgate_commands::warpgate_delete_ldap_server,
        warpgate_commands::warpgate_test_ldap_connection,
        warpgate_commands::warpgate_get_ldap_users,
        warpgate_commands::warpgate_import_ldap_users,
        warpgate_commands::warpgate_query_logs,
        warpgate_commands::warpgate_get_parameters,
        warpgate_commands::warpgate_update_parameters,
        // OpenPubkey SSH (opkssh) commands
        opkssh_commands::opkssh_check_binary,
        opkssh_commands::opkssh_get_download_url,
        opkssh_commands::opkssh_login,
        opkssh_commands::opkssh_list_keys,
        opkssh_commands::opkssh_remove_key,
        opkssh_commands::opkssh_get_client_config,
        opkssh_commands::opkssh_update_client_config,
        opkssh_commands::opkssh_well_known_providers,
        opkssh_commands::opkssh_build_env_string,
        opkssh_commands::opkssh_server_read_config_script,
        opkssh_commands::opkssh_parse_server_config,
        opkssh_commands::opkssh_get_server_config,
        opkssh_commands::opkssh_build_add_identity_cmd,
        opkssh_commands::opkssh_build_remove_identity_cmd,
        opkssh_commands::opkssh_build_add_provider_cmd,
        opkssh_commands::opkssh_build_remove_provider_cmd,
        opkssh_commands::opkssh_build_install_cmd,
        opkssh_commands::opkssh_build_audit_cmd,
        opkssh_commands::opkssh_parse_audit_output,
        opkssh_commands::opkssh_get_audit_results,
        opkssh_commands::opkssh_get_status,
        // SSH event-scripts commands
        ssh_scripts_commands::ssh_scripts_create_script,
        ssh_scripts_commands::ssh_scripts_get_script,
        ssh_scripts_commands::ssh_scripts_list_scripts,
        ssh_scripts_commands::ssh_scripts_update_script,
        ssh_scripts_commands::ssh_scripts_delete_script,
        ssh_scripts_commands::ssh_scripts_duplicate_script,
        ssh_scripts_commands::ssh_scripts_toggle_script,
        ssh_scripts_commands::ssh_scripts_create_chain,
        ssh_scripts_commands::ssh_scripts_get_chain,
        ssh_scripts_commands::ssh_scripts_list_chains,
        ssh_scripts_commands::ssh_scripts_update_chain,
        ssh_scripts_commands::ssh_scripts_delete_chain,
        ssh_scripts_commands::ssh_scripts_toggle_chain,
        ssh_scripts_commands::ssh_scripts_run_script,
        ssh_scripts_commands::ssh_scripts_run_chain,
        ssh_scripts_commands::ssh_scripts_record_execution,
        ssh_scripts_commands::ssh_scripts_notify_event,
        ssh_scripts_commands::ssh_scripts_notify_output,
        ssh_scripts_commands::ssh_scripts_scheduler_tick,
        ssh_scripts_commands::ssh_scripts_register_session,
        ssh_scripts_commands::ssh_scripts_unregister_session,
        ssh_scripts_commands::ssh_scripts_query_history,
        ssh_scripts_commands::ssh_scripts_get_execution,
        ssh_scripts_commands::ssh_scripts_get_chain_execution,
        ssh_scripts_commands::ssh_scripts_get_script_stats,
        ssh_scripts_commands::ssh_scripts_get_all_stats,
        ssh_scripts_commands::ssh_scripts_clear_history,
        ssh_scripts_commands::ssh_scripts_clear_script_history,
        ssh_scripts_commands::ssh_scripts_list_timers,
        ssh_scripts_commands::ssh_scripts_list_session_timers,
        ssh_scripts_commands::ssh_scripts_pause_timer,
        ssh_scripts_commands::ssh_scripts_resume_timer,
        ssh_scripts_commands::ssh_scripts_list_by_tag,
        ssh_scripts_commands::ssh_scripts_list_by_category,
        ssh_scripts_commands::ssh_scripts_list_by_trigger,
        ssh_scripts_commands::ssh_scripts_get_tags,
        ssh_scripts_commands::ssh_scripts_get_categories,
        ssh_scripts_commands::ssh_scripts_export,
        ssh_scripts_commands::ssh_scripts_import,
        ssh_scripts_commands::ssh_scripts_bulk_enable,
        ssh_scripts_commands::ssh_scripts_bulk_delete,
        ssh_scripts_commands::ssh_scripts_get_summary,
        // MCP Server commands
        mcp_server_commands::mcp_get_status,
        mcp_server_commands::mcp_start_server,
        mcp_server_commands::mcp_stop_server,
        mcp_server_commands::mcp_get_config,
        mcp_server_commands::mcp_update_config,
        mcp_server_commands::mcp_generate_api_key,
        mcp_server_commands::mcp_list_sessions,
        mcp_server_commands::mcp_disconnect_session,
        mcp_server_commands::mcp_get_metrics,
        mcp_server_commands::mcp_get_tools,
        mcp_server_commands::mcp_get_resources,
        mcp_server_commands::mcp_get_prompts,
        mcp_server_commands::mcp_get_logs,
        mcp_server_commands::mcp_get_events,
        mcp_server_commands::mcp_get_tool_call_logs,
        mcp_server_commands::mcp_clear_logs,
        mcp_server_commands::mcp_reset_metrics,
        mcp_server_commands::mcp_handle_request,
        // SNMP commands
        snmp_commands::snmp_get,
        snmp_commands::snmp_get_next,
        snmp_commands::snmp_get_bulk,
        snmp_commands::snmp_set_value,
        snmp_commands::snmp_walk,
        snmp_commands::snmp_get_table,
        snmp_commands::snmp_get_if_table,
        snmp_commands::snmp_get_system_info,
        snmp_commands::snmp_get_interfaces,
        snmp_commands::snmp_discover,
        snmp_commands::snmp_start_trap_receiver,
        snmp_commands::snmp_stop_trap_receiver,
        snmp_commands::snmp_get_trap_receiver_status,
        snmp_commands::snmp_get_traps,
        snmp_commands::snmp_clear_traps,
        snmp_commands::snmp_mib_resolve_oid,
        snmp_commands::snmp_mib_resolve_name,
        snmp_commands::snmp_mib_search,
        snmp_commands::snmp_mib_load_text,
        snmp_commands::snmp_mib_get_subtree,
        snmp_commands::snmp_add_monitor,
        snmp_commands::snmp_remove_monitor,
        snmp_commands::snmp_start_monitor,
        snmp_commands::snmp_stop_monitor,
        snmp_commands::snmp_get_monitor_alerts,
        snmp_commands::snmp_acknowledge_alert,
        snmp_commands::snmp_clear_alerts,
        snmp_commands::snmp_add_target,
        snmp_commands::snmp_remove_target,
        snmp_commands::snmp_list_targets,
        snmp_commands::snmp_add_usm_user,
        snmp_commands::snmp_remove_usm_user,
        snmp_commands::snmp_list_usm_users,
        snmp_commands::snmp_add_device,
        snmp_commands::snmp_remove_device,
        snmp_commands::snmp_list_devices,
        snmp_commands::snmp_get_service_status,
        snmp_commands::snmp_bulk_get,
        snmp_commands::snmp_bulk_walk,
        // ── Dashboard ──────────────────────────────────────────────────
        dashboard_commands::dash_get_state,
        dashboard_commands::dash_get_health_summary,
        dashboard_commands::dash_get_quick_stats,
        dashboard_commands::dash_get_alerts,
        dashboard_commands::dash_acknowledge_alert,
        dashboard_commands::dash_get_connection_health,
        dashboard_commands::dash_get_all_health,
        dashboard_commands::dash_get_unhealthy,
        dashboard_commands::dash_get_sparkline,
        dashboard_commands::dash_get_widget_data,
        dashboard_commands::dash_start_monitoring,
        dashboard_commands::dash_stop_monitoring,
        dashboard_commands::dash_force_refresh,
        dashboard_commands::dash_get_config,
        dashboard_commands::dash_update_config,
        dashboard_commands::dash_get_layout,
        dashboard_commands::dash_update_layout,
        dashboard_commands::dash_get_heatmap,
        dashboard_commands::dash_get_recent,
        dashboard_commands::dash_get_top_latency,
        dashboard_commands::dash_check_connection,
        // ── Hooks ──────────────────────────────────────────────────────
        hooks_commands::hook_subscribe,
        hooks_commands::hook_unsubscribe,
        hooks_commands::hook_list_subscriptions,
        hooks_commands::hook_get_subscription,
        hooks_commands::hook_enable_subscription,
        hooks_commands::hook_disable_subscription,
        hooks_commands::hook_dispatch_event,
        hooks_commands::hook_get_recent_events,
        hooks_commands::hook_get_events_by_type,
        hooks_commands::hook_get_stats,
        hooks_commands::hook_clear_events,
        hooks_commands::hook_create_pipeline,
        hooks_commands::hook_delete_pipeline,
        hooks_commands::hook_list_pipelines,
        hooks_commands::hook_execute_pipeline,
        hooks_commands::hook_get_config,
        hooks_commands::hook_update_config,
        // ── Notifications ──────────────────────────────────────────────
        notifications_commands::notif_add_rule,
        notifications_commands::notif_remove_rule,
        notifications_commands::notif_list_rules,
        notifications_commands::notif_get_rule,
        notifications_commands::notif_enable_rule,
        notifications_commands::notif_disable_rule,
        notifications_commands::notif_update_rule,
        notifications_commands::notif_add_template,
        notifications_commands::notif_remove_template,
        notifications_commands::notif_list_templates,
        notifications_commands::notif_process_event,
        notifications_commands::notif_get_history,
        notifications_commands::notif_get_recent_history,
        notifications_commands::notif_clear_history,
        notifications_commands::notif_get_stats,
        notifications_commands::notif_get_config,
        notifications_commands::notif_update_config,
        notifications_commands::notif_test_channel,
        notifications_commands::notif_acknowledge_escalation,
        // ── Topology ───────────────────────────────────────────────────
        topology_commands::topo_build_from_connections,
        topology_commands::topo_get_graph,
        topology_commands::topo_add_node,
        topology_commands::topo_remove_node,
        topology_commands::topo_update_node,
        topology_commands::topo_add_edge,
        topology_commands::topo_remove_edge,
        topology_commands::topo_apply_layout,
        topology_commands::topo_get_blast_radius,
        topology_commands::topo_find_bottlenecks,
        topology_commands::topo_find_critical_edges,
        topology_commands::topo_get_path,
        topology_commands::topo_get_neighbors,
        topology_commands::topo_get_connected_components,
        topology_commands::topo_get_stats,
        topology_commands::topo_create_snapshot,
        topology_commands::topo_list_snapshots,
        topology_commands::topo_add_group,
        topology_commands::topo_remove_group,
        // ── Filters ────────────────────────────────────────────────────
        filters_commands::filter_create,
        filters_commands::filter_delete,
        filters_commands::filter_update,
        filters_commands::filter_get,
        filters_commands::filter_list,
        filters_commands::filter_evaluate,
        filters_commands::filter_get_presets,
        filters_commands::filter_create_smart_group,
        filters_commands::filter_delete_smart_group,
        filters_commands::filter_list_smart_groups,
        filters_commands::filter_update_smart_group,
        filters_commands::filter_evaluate_smart_group,
        filters_commands::filter_invalidate_cache,
        filters_commands::filter_get_stats,
        filters_commands::filter_get_config,
        filters_commands::filter_update_config,
        // ── Credentials ────────────────────────────────────────────────
        credentials_commands::cred_add,
        credentials_commands::cred_remove,
        credentials_commands::cred_update,
        credentials_commands::cred_get,
        credentials_commands::cred_list,
        credentials_commands::cred_record_rotation,
        credentials_commands::cred_check_expiry,
        credentials_commands::cred_check_all_expiries,
        credentials_commands::cred_get_stale,
        credentials_commands::cred_get_expiring_soon,
        credentials_commands::cred_get_expired,
        credentials_commands::cred_add_policy,
        credentials_commands::cred_remove_policy,
        credentials_commands::cred_list_policies,
        credentials_commands::cred_check_compliance,
        credentials_commands::cred_check_strength,
        credentials_commands::cred_detect_duplicates,
        credentials_commands::cred_create_group,
        credentials_commands::cred_delete_group,
        credentials_commands::cred_list_groups,
        credentials_commands::cred_add_to_group,
        credentials_commands::cred_remove_from_group,
        credentials_commands::cred_get_alerts,
        credentials_commands::cred_acknowledge_alert,
        credentials_commands::cred_generate_alerts,
        credentials_commands::cred_get_audit_log,
        credentials_commands::cred_get_stats,
        credentials_commands::cred_get_config,
        credentials_commands::cred_update_config,
        // ── Replay ─────────────────────────────────────────────────────
        replay_commands::replay_load_terminal,
        replay_commands::replay_load_video,
        replay_commands::replay_load_har,
        replay_commands::replay_play,
        replay_commands::replay_pause,
        replay_commands::replay_stop,
        replay_commands::replay_seek,
        replay_commands::replay_set_speed,
        replay_commands::replay_get_state,
        replay_commands::replay_get_position,
        replay_commands::replay_get_frame_at,
        replay_commands::replay_get_terminal_state_at,
        replay_commands::replay_advance_frame,
        replay_commands::replay_get_timeline,
        replay_commands::replay_get_markers,
        replay_commands::replay_get_heatmap,
        replay_commands::replay_search,
        replay_commands::replay_add_annotation,
        replay_commands::replay_remove_annotation,
        replay_commands::replay_list_annotations,
        replay_commands::replay_add_bookmark,
        replay_commands::replay_remove_bookmark,
        replay_commands::replay_list_bookmarks,
        replay_commands::replay_export,
        replay_commands::replay_get_stats,
        replay_commands::replay_get_config,
        replay_commands::replay_update_config,
        replay_commands::replay_get_har_waterfall,
        replay_commands::replay_get_har_stats,
        // ── RDP File ───────────────────────────────────────────────────
        rdpfile_commands::rdpfile_parse,
        rdpfile_commands::rdpfile_generate,
        rdpfile_commands::rdpfile_import,
        rdpfile_commands::rdpfile_export,
        rdpfile_commands::rdpfile_batch_export,
        rdpfile_commands::rdpfile_batch_import,
        rdpfile_commands::rdpfile_validate,
        // ── Updater ────────────────────────────────────────────────────
        updater_commands::updater_check,
        updater_commands::updater_download,
        updater_commands::updater_cancel_download,
        updater_commands::updater_install,
        updater_commands::updater_schedule_install,
        updater_commands::updater_get_status,
        updater_commands::updater_get_config,
        updater_commands::updater_update_config,
        updater_commands::updater_set_channel,
        updater_commands::updater_get_version_info,
        updater_commands::updater_get_history,
        updater_commands::updater_rollback,
        updater_commands::updater_get_rollbacks,
        updater_commands::updater_get_release_notes,
        // ── Marketplace ────────────────────────────────────────────────
        marketplace_commands::mkt_search,
        marketplace_commands::mkt_get_listing,
        marketplace_commands::mkt_get_categories,
        marketplace_commands::mkt_get_featured,
        marketplace_commands::mkt_get_popular,
        marketplace_commands::mkt_install,
        marketplace_commands::mkt_uninstall,
        marketplace_commands::mkt_update,
        marketplace_commands::mkt_get_installed,
        marketplace_commands::mkt_check_updates,
        marketplace_commands::mkt_refresh_repositories,
        marketplace_commands::mkt_add_repository,
        marketplace_commands::mkt_remove_repository,
        marketplace_commands::mkt_list_repositories,
        marketplace_commands::mkt_get_reviews,
        marketplace_commands::mkt_add_review,
        marketplace_commands::mkt_get_stats,
        marketplace_commands::mkt_get_config,
        marketplace_commands::mkt_update_config,
        marketplace_commands::mkt_validate_manifest,
        // ── Portable ───────────────────────────────────────────────────
        portable_commands::portable_detect_mode,
        portable_commands::portable_get_status,
        portable_commands::portable_get_paths,
        portable_commands::portable_get_config,
        portable_commands::portable_update_config,
        portable_commands::portable_migrate_to_portable,
        portable_commands::portable_migrate_to_installed,
        portable_commands::portable_create_marker,
        portable_commands::portable_remove_marker,
        portable_commands::portable_validate,
        portable_commands::portable_get_drive_info,
        // ── Scheduler ──────────────────────────────────────────────────
        scheduler_commands::sched_add_task,
        scheduler_commands::sched_remove_task,
        scheduler_commands::sched_update_task,
        scheduler_commands::sched_get_task,
        scheduler_commands::sched_list_tasks,
        scheduler_commands::sched_enable_task,
        scheduler_commands::sched_disable_task,
        scheduler_commands::sched_execute_now,
        scheduler_commands::sched_cancel_task,
        scheduler_commands::sched_get_history,
        scheduler_commands::sched_get_upcoming,
        scheduler_commands::sched_get_stats,
        scheduler_commands::sched_get_config,
        scheduler_commands::sched_update_config,
        scheduler_commands::sched_cleanup_history,
        scheduler_commands::sched_validate_cron,
        scheduler_commands::sched_get_next_occurrences,
        scheduler_commands::sched_pause_all,
        scheduler_commands::sched_resume_all,
    ]
}
