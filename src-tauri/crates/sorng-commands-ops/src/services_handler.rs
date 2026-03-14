use crate::*;

fn is_command_a(command: &str) -> bool {
    matches!(
        command,
        "budibase_connect"
            | "budibase_disconnect"
            | "budibase_list_connections"
            | "budibase_ping"
            | "budibase_set_app_context"
            | "budibase_list_apps"
            | "budibase_search_apps"
            | "budibase_get_app"
            | "budibase_create_app"
            | "budibase_update_app"
            | "budibase_delete_app"
            | "budibase_publish_app"
            | "budibase_unpublish_app"
            | "budibase_list_tables"
            | "budibase_get_table"
            | "budibase_create_table"
            | "budibase_update_table"
            | "budibase_delete_table"
            | "budibase_get_table_schema"
            | "budibase_list_rows"
            | "budibase_search_rows"
            | "budibase_get_row"
            | "budibase_create_row"
            | "budibase_update_row"
            | "budibase_delete_row"
            | "budibase_bulk_create_rows"
            | "budibase_bulk_delete_rows"
            | "budibase_list_views"
            | "budibase_get_view"
            | "budibase_create_view"
            | "budibase_update_view"
            | "budibase_delete_view"
            | "budibase_query_view"
            | "budibase_list_users"
            | "budibase_search_users"
            | "budibase_get_user"
            | "budibase_create_user"
            | "budibase_update_user"
            | "budibase_delete_user"
            | "budibase_list_queries"
            | "budibase_get_query"
            | "budibase_execute_query"
            | "budibase_create_query"
            | "budibase_update_query"
            | "budibase_delete_query"
            | "budibase_list_automations"
            | "budibase_get_automation"
            | "budibase_create_automation"
            | "budibase_update_automation"
            | "budibase_delete_automation"
            | "budibase_trigger_automation"
            | "budibase_get_automation_logs"
            | "budibase_list_datasources"
            | "budibase_get_datasource"
            | "budibase_create_datasource"
            | "budibase_update_datasource"
            | "budibase_delete_datasource"
            | "budibase_test_datasource"
            | "osticket_connect"
            | "osticket_disconnect"
            | "osticket_list_connections"
            | "osticket_ping"
            | "osticket_list_tickets"
            | "osticket_search_tickets"
            | "osticket_get_ticket"
            | "osticket_create_ticket"
            | "osticket_update_ticket"
            | "osticket_delete_ticket"
            | "osticket_close_ticket"
            | "osticket_reopen_ticket"
            | "osticket_assign_ticket"
            | "osticket_post_ticket_reply"
            | "osticket_post_ticket_note"
            | "osticket_get_ticket_threads"
            | "osticket_add_ticket_collaborator"
            | "osticket_get_ticket_collaborators"
            | "osticket_remove_ticket_collaborator"
            | "osticket_transfer_ticket"
            | "osticket_merge_tickets"
            | "osticket_list_users"
            | "osticket_get_user"
            | "osticket_search_users"
            | "osticket_create_user"
            | "osticket_update_user"
            | "osticket_delete_user"
            | "osticket_get_user_tickets"
            | "osticket_list_departments"
            | "osticket_get_department"
            | "osticket_create_department"
            | "osticket_update_department"
            | "osticket_delete_department"
            | "osticket_get_department_agents"
            | "osticket_list_topics"
            | "osticket_get_topic"
            | "osticket_create_topic"
            | "osticket_update_topic"
            | "osticket_delete_topic"
            | "osticket_list_agents"
            | "osticket_get_agent"
            | "osticket_create_agent"
            | "osticket_update_agent"
            | "osticket_delete_agent"
            | "osticket_set_agent_vacation"
            | "osticket_get_agent_teams"
            | "osticket_list_teams"
            | "osticket_get_team"
            | "osticket_create_team"
            | "osticket_update_team"
            | "osticket_delete_team"
            | "osticket_add_team_member"
            | "osticket_remove_team_member"
            | "osticket_get_team_members"
            | "osticket_list_sla"
            | "osticket_get_sla"
            | "osticket_create_sla"
            | "osticket_update_sla"
            | "osticket_delete_sla"
            | "osticket_list_canned_responses"
            | "osticket_get_canned_response"
            | "osticket_create_canned_response"
            | "osticket_update_canned_response"
            | "osticket_delete_canned_response"
            | "osticket_search_canned_responses"
            | "osticket_list_forms"
            | "osticket_get_form"
            | "osticket_list_custom_fields"
            | "osticket_get_custom_field"
            | "osticket_create_custom_field"
            | "osticket_update_custom_field"
            | "osticket_delete_custom_field"
            | "jira_connect"
            | "jira_disconnect"
            | "jira_list_connections"
            | "jira_ping"
            | "jira_get_issue"
            | "jira_create_issue"
            | "jira_bulk_create_issues"
            | "jira_update_issue"
            | "jira_delete_issue"
            | "jira_search_issues"
            | "jira_get_transitions"
            | "jira_transition_issue"
            | "jira_assign_issue"
            | "jira_get_issue_changelog"
            | "jira_link_issues"
            | "jira_get_watchers"
            | "jira_add_watcher"
            | "jira_list_projects"
            | "jira_get_project"
            | "jira_create_project"
            | "jira_delete_project"
            | "jira_get_project_statuses"
            | "jira_get_project_components"
            | "jira_get_project_versions"
            | "jira_list_comments"
            | "jira_get_comment"
            | "jira_add_comment"
            | "jira_update_comment"
            | "jira_delete_comment"
            | "jira_list_attachments"
            | "jira_get_attachment"
            | "jira_add_attachment"
            | "jira_delete_attachment"
            | "jira_list_worklogs"
            | "jira_get_worklog"
            | "jira_add_worklog"
            | "jira_update_worklog"
            | "jira_delete_worklog"
            | "jira_list_boards"
            | "jira_get_board"
            | "jira_get_board_issues"
            | "jira_get_board_backlog"
            | "jira_get_board_configuration"
            | "jira_list_sprints"
            | "jira_get_sprint"
            | "jira_create_sprint"
            | "jira_update_sprint"
            | "jira_delete_sprint"
            | "jira_get_sprint_issues"
            | "jira_move_issues_to_sprint"
            | "jira_start_sprint"
            | "jira_complete_sprint"
            | "jira_get_myself"
            | "jira_get_user"
            | "jira_search_users"
            | "jira_find_assignable_users"
            | "jira_list_fields"
            | "jira_get_all_issue_types"
            | "jira_get_priorities"
            | "jira_get_statuses"
            | "jira_get_resolutions"
            | "jira_list_dashboards"
            | "jira_get_dashboard"
            | "jira_get_filter"
            | "jira_get_favourite_filters"
            | "jira_get_my_filters"
            | "jira_create_filter"
            | "jira_update_filter"
            | "jira_delete_filter"
            | "i18n_translate"
            | "i18n_translate_plural"
            | "i18n_translate_batch"
            | "i18n_get_bundle"
            | "i18n_get_namespace_bundle"
            | "i18n_available_locales"
            | "i18n_status"
            | "i18n_detect_os_locale"
            | "i18n_has_key"
            | "i18n_missing_keys"
            | "i18n_reload"
            | "i18n_ssr_payload"
            | "i18n_ssr_script"
            | "le_get_status"
            | "le_start"
            | "le_stop"
            | "le_get_config"
            | "le_update_config"
            | "le_register_account"
            | "le_list_accounts"
            | "le_remove_account"
            | "le_request_certificate"
            | "le_renew_certificate"
            | "le_revoke_certificate"
            | "le_list_certificates"
            | "le_get_certificate"
            | "le_find_certificates_by_domain"
            | "le_remove_certificate"
            | "le_get_cert_paths"
            | "le_health_check"
            | "le_has_critical_issues"
            | "le_fetch_ocsp"
            | "le_get_ocsp_status"
            | "le_recent_events"
            | "le_drain_events"
            | "le_check_rate_limit"
            | "le_is_rate_limited"
            | "ssh_agent_get_status"
            | "ssh_agent_start"
            | "ssh_agent_stop"
            | "ssh_agent_restart"
            | "ssh_agent_get_config"
            | "ssh_agent_update_config"
            | "ssh_agent_list_keys"
            | "ssh_agent_add_key"
            | "ssh_agent_remove_key"
            | "ssh_agent_remove_all_keys"
            | "ssh_agent_lock"
            | "ssh_agent_unlock"
            | "ssh_agent_connect_system"
            | "ssh_agent_disconnect_system"
            | "ssh_agent_set_system_path"
            | "ssh_agent_discover_system"
            | "ssh_agent_start_forwarding"
            | "ssh_agent_stop_forwarding"
            | "ssh_agent_list_forwarding"
            | "ssh_agent_audit_log"
            | "ssh_agent_export_audit"
            | "ssh_agent_clear_audit"
            | "ssh_agent_run_maintenance"
            | "ssh_agent_load_pkcs11"
            | "ssh_agent_unload_pkcs11"
            | "ssh_agent_list_pkcs11_providers"
            | "ssh_agent_get_pkcs11_slots"
            | "ssh_agent_add_smartcard_key"
            | "ssh_agent_remove_smartcard_key"
            | "ssh_agent_list_security_keys"
            | "ssh_agent_add_security_key"
            | "ssh_agent_get_pending_confirm"
            | "ssh_agent_confirm_sign"
            | "ssh_agent_get_key_details"
            | "ssh_agent_update_key_comment"
            | "ssh_agent_update_key_constraints"
            | "ssh_agent_export_public_key"
            | "gpg_get_status"
            | "gpg_start_agent"
            | "gpg_stop_agent"
            | "gpg_reload_agent"
            | "gpg_get_config"
            | "gpg_update_config"
            | "gpg_detect_environment"
            | "gpg_list_keys"
            | "gpg_get_key"
            | "gpg_generate_key"
            | "gpg_import_key"
            | "gpg_import_key_file"
            | "gpg_export_key"
            | "gpg_export_secret_key"
            | "gpg_delete_key"
            | "gpg_add_uid"
            | "gpg_revoke_uid"
            | "gpg_add_subkey"
            | "gpg_revoke_subkey"
            | "gpg_set_expiration"
            | "gpg_generate_revocation"
            | "gpg_sign_data"
            | "gpg_verify_signature"
            | "gpg_sign_key"
            | "gpg_encrypt_data"
            | "gpg_decrypt_data"
            | "gpg_set_owner_trust"
            | "gpg_trust_db_stats"
            | "gpg_update_trust_db"
            | "gpg_search_keyserver"
            | "gpg_fetch_from_keyserver"
            | "gpg_send_to_keyserver"
            | "gpg_refresh_keys"
            | "gpg_card_status"
            | "gpg_list_cards"
            | "gpg_card_change_pin"
            | "gpg_card_factory_reset"
            | "gpg_card_set_attribute"
            | "gpg_card_generate_key"
            | "gpg_card_move_key"
            | "gpg_card_fetch_key"
            | "gpg_audit_log"
            | "gpg_audit_export"
            | "gpg_audit_clear"
            | "yk_list_devices"
            | "yk_get_device_info"
            | "yk_wait_for_device"
            | "yk_get_diagnostics"
            | "yk_piv_list_certs"
            | "yk_piv_get_slot"
            | "yk_piv_generate_key"
            | "yk_piv_self_sign_cert"
            | "yk_piv_generate_csr"
            | "yk_piv_import_cert"
            | "yk_piv_import_key"
            | "yk_piv_export_cert"
            | "yk_piv_delete_cert"
            | "yk_piv_delete_key"
            | "yk_piv_attest"
            | "yk_piv_change_pin"
            | "yk_piv_change_puk"
            | "yk_piv_change_mgmt_key"
            | "yk_piv_unblock_pin"
            | "yk_piv_get_pin_status"
            | "yk_piv_reset"
            | "yk_piv_sign"
            | "yk_fido2_info"
            | "yk_fido2_list_credentials"
            | "yk_fido2_delete_credential"
            | "yk_fido2_set_pin"
            | "yk_fido2_change_pin"
            | "yk_fido2_pin_status"
            | "yk_fido2_reset"
            | "yk_fido2_toggle_always_uv"
            | "yk_fido2_list_rps"
            | "yk_oath_list"
            | "yk_oath_add"
            | "yk_oath_delete"
            | "yk_oath_rename"
            | "yk_oath_calculate"
            | "yk_oath_calculate_all"
            | "yk_oath_set_password"
            | "yk_oath_reset"
            | "yk_otp_info"
            | "yk_otp_configure_yubico"
            | "yk_otp_configure_chalresp"
            | "yk_otp_configure_static"
            | "yk_otp_configure_hotp"
            | "yk_otp_delete"
            | "yk_otp_swap"
            | "yk_config_set_interfaces"
            | "yk_config_lock"
            | "yk_config_unlock"
            | "yk_get_config"
            | "yk_update_config"
            | "yk_audit_log"
            | "yk_audit_export"
            | "yk_audit_clear"
            | "yk_factory_reset_all"
            | "yk_export_report"
    )
}

fn is_command_b(command: &str) -> bool {
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

fn is_command_c(command: &str) -> bool {
    matches!(
        command,
        "lxd_connect"
            | "lxd_disconnect"
            | "lxd_is_connected"
            | "lxd_get_server"
            | "lxd_get_server_resources"
            | "lxd_update_server_config"
            | "lxd_get_cluster"
            | "lxd_list_cluster_members"
            | "lxd_get_cluster_member"
            | "lxd_evacuate_cluster_member"
            | "lxd_restore_cluster_member"
            | "lxd_remove_cluster_member"
            | "lxd_list_instances"
            | "lxd_list_containers"
            | "lxd_list_virtual_machines"
            | "lxd_get_instance"
            | "lxd_get_instance_state"
            | "lxd_create_instance"
            | "lxd_update_instance"
            | "lxd_patch_instance"
            | "lxd_delete_instance"
            | "lxd_rename_instance"
            | "lxd_start_instance"
            | "lxd_stop_instance"
            | "lxd_restart_instance"
            | "lxd_freeze_instance"
            | "lxd_unfreeze_instance"
            | "lxd_exec_instance"
            | "lxd_console_instance"
            | "lxd_clear_console_log"
            | "lxd_list_instance_logs"
            | "lxd_get_instance_log"
            | "lxd_get_instance_file"
            | "lxd_push_instance_file"
            | "lxd_delete_instance_file"
            | "lxd_list_snapshots"
            | "lxd_get_snapshot"
            | "lxd_create_snapshot"
            | "lxd_delete_snapshot"
            | "lxd_rename_snapshot"
            | "lxd_restore_snapshot"
            | "lxd_list_backups"
            | "lxd_get_backup"
            | "lxd_create_backup"
            | "lxd_delete_backup"
            | "lxd_rename_backup"
            | "lxd_list_images"
            | "lxd_get_image"
            | "lxd_get_image_alias"
            | "lxd_create_image_alias"
            | "lxd_delete_image_alias"
            | "lxd_delete_image"
            | "lxd_update_image"
            | "lxd_copy_image_from_remote"
            | "lxd_refresh_image"
            | "lxd_list_profiles"
            | "lxd_get_profile"
            | "lxd_create_profile"
            | "lxd_update_profile"
            | "lxd_patch_profile"
            | "lxd_delete_profile"
            | "lxd_rename_profile"
            | "lxd_list_networks"
            | "lxd_get_network"
            | "lxd_create_network"
            | "lxd_update_network"
            | "lxd_patch_network"
            | "lxd_delete_network"
            | "lxd_rename_network"
            | "lxd_get_network_state"
            | "lxd_list_network_leases"
            | "lxd_list_network_acls"
            | "lxd_get_network_acl"
            | "lxd_create_network_acl"
            | "lxd_update_network_acl"
            | "lxd_delete_network_acl"
            | "lxd_list_network_forwards"
            | "lxd_get_network_forward"
            | "lxd_create_network_forward"
            | "lxd_delete_network_forward"
            | "lxd_list_network_zones"
            | "lxd_get_network_zone"
            | "lxd_delete_network_zone"
            | "lxd_list_network_load_balancers"
            | "lxd_get_network_load_balancer"
            | "lxd_delete_network_load_balancer"
            | "lxd_list_network_peers"
            | "lxd_list_storage_pools"
            | "lxd_get_storage_pool"
            | "lxd_create_storage_pool"
            | "lxd_update_storage_pool"
            | "lxd_delete_storage_pool"
            | "lxd_get_storage_pool_resources"
            | "lxd_list_storage_volumes"
            | "lxd_list_custom_volumes"
            | "lxd_get_storage_volume"
            | "lxd_create_storage_volume"
            | "lxd_update_storage_volume"
            | "lxd_delete_storage_volume"
            | "lxd_rename_storage_volume"
            | "lxd_list_volume_snapshots"
            | "lxd_create_volume_snapshot"
            | "lxd_delete_volume_snapshot"
            | "lxd_list_storage_buckets"
            | "lxd_get_storage_bucket"
            | "lxd_create_storage_bucket"
            | "lxd_delete_storage_bucket"
            | "lxd_list_bucket_keys"
            | "lxd_list_projects"
            | "lxd_get_project"
            | "lxd_create_project"
            | "lxd_update_project"
            | "lxd_patch_project"
            | "lxd_delete_project"
            | "lxd_rename_project"
            | "lxd_list_certificates"
            | "lxd_get_certificate"
            | "lxd_add_certificate"
            | "lxd_delete_certificate"
            | "lxd_update_certificate"
            | "lxd_list_operations"
            | "lxd_get_operation"
            | "lxd_cancel_operation"
            | "lxd_wait_operation"
            | "lxd_list_warnings"
            | "lxd_get_warning"
            | "lxd_acknowledge_warning"
            | "lxd_delete_warning"
            | "lxd_migrate_instance"
            | "lxd_copy_instance"
            | "lxd_publish_instance"
            | "vmwd_connect"
            | "vmwd_disconnect"
            | "vmwd_is_connected"
            | "vmwd_connection_summary"
            | "vmwd_host_info"
            | "vmwd_list_vms"
            | "vmwd_get_vm"
            | "vmwd_create_vm"
            | "vmwd_update_vm"
            | "vmwd_delete_vm"
            | "vmwd_clone_vm"
            | "vmwd_register_vm"
            | "vmwd_unregister_vm"
            | "vmwd_configure_nic"
            | "vmwd_remove_nic"
            | "vmwd_configure_cdrom"
            | "vmwd_start_vm"
            | "vmwd_stop_vm"
            | "vmwd_reset_vm"
            | "vmwd_suspend_vm"
            | "vmwd_pause_vm"
            | "vmwd_unpause_vm"
            | "vmwd_get_power_state"
            | "vmwd_batch_power"
            | "vmwd_list_snapshots"
            | "vmwd_get_snapshot_tree"
            | "vmwd_create_snapshot"
            | "vmwd_delete_snapshot"
            | "vmwd_revert_to_snapshot"
            | "vmwd_get_snapshot"
            | "vmwd_exec_in_guest"
            | "vmwd_run_script_in_guest"
            | "vmwd_copy_to_guest"
            | "vmwd_copy_from_guest"
            | "vmwd_create_directory_in_guest"
            | "vmwd_delete_directory_in_guest"
            | "vmwd_delete_file_in_guest"
            | "vmwd_file_exists_in_guest"
            | "vmwd_directory_exists_in_guest"
            | "vmwd_rename_file_in_guest"
            | "vmwd_list_directory_in_guest"
            | "vmwd_list_processes_in_guest"
            | "vmwd_kill_process_in_guest"
            | "vmwd_read_variable"
            | "vmwd_write_variable"
            | "vmwd_list_env_vars"
            | "vmwd_get_tools_status"
            | "vmwd_install_tools"
            | "vmwd_get_ip_address"
            | "vmwd_enable_shared_folders"
            | "vmwd_disable_shared_folders"
            | "vmwd_list_shared_folders"
            | "vmwd_add_shared_folder"
            | "vmwd_remove_shared_folder"
            | "vmwd_set_shared_folder_state"
            | "vmwd_list_networks"
            | "vmwd_get_network"
            | "vmwd_create_network"
            | "vmwd_update_network"
            | "vmwd_delete_network"
            | "vmwd_list_port_forwards"
            | "vmwd_set_port_forward"
            | "vmwd_delete_port_forward"
            | "vmwd_get_dhcp_leases"
            | "vmwd_read_networking_config"
            | "vmwd_create_vmdk"
            | "vmwd_get_vmdk_info"
            | "vmwd_defragment_vmdk"
            | "vmwd_shrink_vmdk"
            | "vmwd_expand_vmdk"
            | "vmwd_convert_vmdk"
            | "vmwd_rename_vmdk"
            | "vmwd_add_disk_to_vm"
            | "vmwd_remove_disk_from_vm"
            | "vmwd_list_vm_disks"
            | "vmwd_import_ovf"
            | "vmwd_export_ovf"
            | "vmwd_parse_vmx"
            | "vmwd_update_vmx_keys"
            | "vmwd_remove_vmx_keys"
            | "vmwd_discover_vmx_files"
            | "vmwd_read_preferences"
            | "vmwd_get_default_vm_dir"
            | "vmwd_set_preference"
            | "ngx_connect"
            | "ngx_disconnect"
            | "ngx_list_connections"
            | "ngx_list_sites"
            | "ngx_get_site"
            | "ngx_create_site"
            | "ngx_update_site"
            | "ngx_delete_site"
            | "ngx_enable_site"
            | "ngx_disable_site"
            | "ngx_list_upstreams"
            | "ngx_get_upstream"
            | "ngx_create_upstream"
            | "ngx_update_upstream"
            | "ngx_delete_upstream"
            | "ngx_get_ssl_config"
            | "ngx_update_ssl_config"
            | "ngx_list_ssl_certificates"
            | "ngx_stub_status"
            | "ngx_process_status"
            | "ngx_health_check"
            | "ngx_query_access_log"
            | "ngx_query_error_log"
            | "ngx_list_log_files"
            | "ngx_get_main_config"
            | "ngx_update_main_config"
            | "ngx_test_config"
            | "ngx_list_snippets"
            | "ngx_get_snippet"
            | "ngx_create_snippet"
            | "ngx_update_snippet"
            | "ngx_delete_snippet"
            | "ngx_start"
            | "ngx_stop"
            | "ngx_restart"
            | "ngx_reload"
            | "ngx_version"
            | "ngx_info"
            | "traefik_connect"
            | "traefik_disconnect"
            | "traefik_list_connections"
            | "traefik_ping"
            | "traefik_list_http_routers"
            | "traefik_get_http_router"
            | "traefik_list_tcp_routers"
            | "traefik_get_tcp_router"
            | "traefik_list_udp_routers"
            | "traefik_get_udp_router"
            | "traefik_list_http_services"
            | "traefik_get_http_service"
            | "traefik_list_tcp_services"
            | "traefik_get_tcp_service"
            | "traefik_list_udp_services"
            | "traefik_get_udp_service"
            | "traefik_list_http_middlewares"
            | "traefik_get_http_middleware"
            | "traefik_list_tcp_middlewares"
            | "traefik_get_tcp_middleware"
            | "traefik_list_entrypoints"
            | "traefik_get_entrypoint"
            | "traefik_list_tls_certificates"
            | "traefik_get_tls_certificate"
            | "traefik_get_overview"
            | "traefik_get_version"
            | "traefik_get_raw_config"
            | "haproxy_connect"
            | "haproxy_disconnect"
            | "haproxy_list_connections"
            | "haproxy_ping"
            | "haproxy_get_info"
            | "haproxy_get_csv"
            | "haproxy_list_frontends"
            | "haproxy_get_frontend"
            | "haproxy_list_backends"
            | "haproxy_get_backend"
            | "haproxy_list_servers"
            | "haproxy_get_server"
            | "haproxy_set_server_state"
            | "haproxy_list_acls"
            | "haproxy_get_acl"
            | "haproxy_add_acl_entry"
            | "haproxy_del_acl_entry"
            | "haproxy_clear_acl"
            | "haproxy_list_maps"
            | "haproxy_get_map"
            | "haproxy_add_map_entry"
            | "haproxy_del_map_entry"
            | "haproxy_set_map_entry"
            | "haproxy_clear_map"
            | "haproxy_list_stick_tables"
            | "haproxy_get_stick_table"
            | "haproxy_clear_stick_table"
            | "haproxy_set_stick_table_entry"
            | "haproxy_runtime_execute"
            | "haproxy_show_servers_state"
            | "haproxy_show_sessions"
            | "haproxy_show_backend_list"
            | "haproxy_get_raw_config"
            | "haproxy_update_raw_config"
            | "haproxy_validate_config"
            | "haproxy_reload"
            | "haproxy_start"
            | "haproxy_stop"
            | "haproxy_restart"
            | "haproxy_version"
            | "apache_connect"
            | "apache_disconnect"
            | "apache_list_connections"
            | "apache_ping"
            | "apache_list_vhosts"
            | "apache_get_vhost"
            | "apache_create_vhost"
            | "apache_update_vhost"
            | "apache_delete_vhost"
            | "apache_enable_vhost"
            | "apache_disable_vhost"
            | "apache_list_modules"
            | "apache_list_available_modules"
            | "apache_list_enabled_modules"
            | "apache_enable_module"
            | "apache_disable_module"
            | "apache_get_ssl_config"
            | "apache_list_ssl_certificates"
            | "apache_get_status"
            | "apache_process_status"
            | "apache_query_access_log"
            | "apache_query_error_log"
            | "apache_list_log_files"
            | "apache_get_main_config"
            | "apache_update_main_config"
            | "apache_test_config"
            | "apache_list_conf_available"
            | "apache_list_conf_enabled"
            | "apache_enable_conf"
            | "apache_disable_conf"
            | "apache_start"
            | "apache_stop"
            | "apache_restart"
            | "apache_reload"
            | "apache_version"
            | "apache_info"
            | "caddy_connect"
            | "caddy_disconnect"
            | "caddy_list_connections"
            | "caddy_ping"
            | "caddy_get_full_config"
            | "caddy_get_raw_config"
            | "caddy_get_config_path"
            | "caddy_set_config_path"
            | "caddy_patch_config_path"
            | "caddy_delete_config_path"
            | "caddy_load_config"
            | "caddy_adapt_caddyfile"
            | "caddy_stop_server"
            | "caddy_list_servers"
            | "caddy_get_server"
            | "caddy_set_server"
            | "caddy_delete_server"
            | "caddy_list_routes"
            | "caddy_get_route"
            | "caddy_add_route"
            | "caddy_set_route"
            | "caddy_delete_route"
            | "caddy_set_all_routes"
            | "caddy_get_tls_app"
            | "caddy_set_tls_app"
            | "caddy_list_automate_domains"
            | "caddy_set_automate_domains"
            | "caddy_get_tls_automation"
            | "caddy_set_tls_automation"
            | "caddy_list_tls_certificates"
            | "caddy_create_reverse_proxy"
            | "caddy_get_upstreams"
            | "caddy_create_file_server"
            | "caddy_create_redirect"
            | "npm_connect"
            | "npm_disconnect"
            | "npm_list_connections"
            | "npm_ping"
            | "npm_list_proxy_hosts"
            | "npm_get_proxy_host"
            | "npm_create_proxy_host"
            | "npm_update_proxy_host"
            | "npm_delete_proxy_host"
            | "npm_enable_proxy_host"
            | "npm_disable_proxy_host"
            | "npm_list_redirection_hosts"
            | "npm_get_redirection_host"
            | "npm_create_redirection_host"
            | "npm_update_redirection_host"
            | "npm_delete_redirection_host"
            | "npm_list_dead_hosts"
            | "npm_get_dead_host"
            | "npm_create_dead_host"
            | "npm_update_dead_host"
            | "npm_delete_dead_host"
            | "npm_list_streams"
            | "npm_get_stream"
            | "npm_create_stream"
            | "npm_update_stream"
            | "npm_delete_stream"
            | "npm_list_certificates"
            | "npm_get_certificate"
            | "npm_create_letsencrypt_certificate"
            | "npm_upload_custom_certificate"
            | "npm_delete_certificate"
            | "npm_renew_certificate"
            | "npm_validate_certificate"
            | "npm_list_users"
            | "npm_get_user"
            | "npm_create_user"
            | "npm_update_user"
            | "npm_delete_user"
            | "npm_change_user_password"
            | "npm_get_me"
            | "npm_list_access_lists"
            | "npm_get_access_list"
            | "npm_create_access_list"
            | "npm_update_access_list"
            | "npm_delete_access_list"
            | "npm_list_settings"
            | "npm_get_setting"
            | "npm_update_setting"
            | "npm_get_reports"
            | "npm_get_audit_log"
            | "npm_get_health"
            | "ddns_list_profiles"
            | "ddns_get_profile"
            | "ddns_create_profile"
            | "ddns_update_profile"
            | "ddns_delete_profile"
            | "ddns_enable_profile"
            | "ddns_disable_profile"
            | "ddns_trigger_update"
            | "ddns_trigger_update_all"
            | "ddns_detect_ip"
            | "ddns_get_current_ips"
            | "ddns_start_scheduler"
            | "ddns_stop_scheduler"
            | "ddns_get_scheduler_status"
            | "ddns_get_profile_health"
            | "ddns_get_all_health"
            | "ddns_get_system_status"
            | "ddns_list_providers"
            | "ddns_get_provider_capabilities"
            | "ddns_cf_list_zones"
            | "ddns_cf_list_records"
            | "ddns_cf_create_record"
            | "ddns_cf_delete_record"
            | "ddns_get_config"
            | "ddns_update_config"
            | "ddns_get_audit_log"
            | "ddns_get_audit_for_profile"
            | "ddns_export_audit"
            | "ddns_clear_audit"
            | "ddns_export_profiles"
            | "ddns_import_profiles"
            | "ddns_process_scheduled"
    )
}

pub fn is_command(command: &str) -> bool {
    is_command_a(command) || is_command_b(command) || is_command_c(command)
}

fn build_a() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Budibase commands
        budibase_commands::budibase_connect,
        budibase_commands::budibase_disconnect,
        budibase_commands::budibase_list_connections,
        budibase_commands::budibase_ping,
        budibase_commands::budibase_set_app_context,
        budibase_commands::budibase_list_apps,
        budibase_commands::budibase_search_apps,
        budibase_commands::budibase_get_app,
        budibase_commands::budibase_create_app,
        budibase_commands::budibase_update_app,
        budibase_commands::budibase_delete_app,
        budibase_commands::budibase_publish_app,
        budibase_commands::budibase_unpublish_app,
        budibase_commands::budibase_list_tables,
        budibase_commands::budibase_get_table,
        budibase_commands::budibase_create_table,
        budibase_commands::budibase_update_table,
        budibase_commands::budibase_delete_table,
        budibase_commands::budibase_get_table_schema,
        budibase_commands::budibase_list_rows,
        budibase_commands::budibase_search_rows,
        budibase_commands::budibase_get_row,
        budibase_commands::budibase_create_row,
        budibase_commands::budibase_update_row,
        budibase_commands::budibase_delete_row,
        budibase_commands::budibase_bulk_create_rows,
        budibase_commands::budibase_bulk_delete_rows,
        budibase_commands::budibase_list_views,
        budibase_commands::budibase_get_view,
        budibase_commands::budibase_create_view,
        budibase_commands::budibase_update_view,
        budibase_commands::budibase_delete_view,
        budibase_commands::budibase_query_view,
        budibase_commands::budibase_list_users,
        budibase_commands::budibase_search_users,
        budibase_commands::budibase_get_user,
        budibase_commands::budibase_create_user,
        budibase_commands::budibase_update_user,
        budibase_commands::budibase_delete_user,
        budibase_commands::budibase_list_queries,
        budibase_commands::budibase_get_query,
        budibase_commands::budibase_execute_query,
        budibase_commands::budibase_create_query,
        budibase_commands::budibase_update_query,
        budibase_commands::budibase_delete_query,
        budibase_commands::budibase_list_automations,
        budibase_commands::budibase_get_automation,
        budibase_commands::budibase_create_automation,
        budibase_commands::budibase_update_automation,
        budibase_commands::budibase_delete_automation,
        budibase_commands::budibase_trigger_automation,
        budibase_commands::budibase_get_automation_logs,
        budibase_commands::budibase_list_datasources,
        budibase_commands::budibase_get_datasource,
        budibase_commands::budibase_create_datasource,
        budibase_commands::budibase_update_datasource,
        budibase_commands::budibase_delete_datasource,
        budibase_commands::budibase_test_datasource,
        // osTicket commands
        osticket_commands::osticket_connect,
        osticket_commands::osticket_disconnect,
        osticket_commands::osticket_list_connections,
        osticket_commands::osticket_ping,
        osticket_commands::osticket_list_tickets,
        osticket_commands::osticket_search_tickets,
        osticket_commands::osticket_get_ticket,
        osticket_commands::osticket_create_ticket,
        osticket_commands::osticket_update_ticket,
        osticket_commands::osticket_delete_ticket,
        osticket_commands::osticket_close_ticket,
        osticket_commands::osticket_reopen_ticket,
        osticket_commands::osticket_assign_ticket,
        osticket_commands::osticket_post_ticket_reply,
        osticket_commands::osticket_post_ticket_note,
        osticket_commands::osticket_get_ticket_threads,
        osticket_commands::osticket_add_ticket_collaborator,
        osticket_commands::osticket_get_ticket_collaborators,
        osticket_commands::osticket_remove_ticket_collaborator,
        osticket_commands::osticket_transfer_ticket,
        osticket_commands::osticket_merge_tickets,
        osticket_commands::osticket_list_users,
        osticket_commands::osticket_get_user,
        osticket_commands::osticket_search_users,
        osticket_commands::osticket_create_user,
        osticket_commands::osticket_update_user,
        osticket_commands::osticket_delete_user,
        osticket_commands::osticket_get_user_tickets,
        osticket_commands::osticket_list_departments,
        osticket_commands::osticket_get_department,
        osticket_commands::osticket_create_department,
        osticket_commands::osticket_update_department,
        osticket_commands::osticket_delete_department,
        osticket_commands::osticket_get_department_agents,
        osticket_commands::osticket_list_topics,
        osticket_commands::osticket_get_topic,
        osticket_commands::osticket_create_topic,
        osticket_commands::osticket_update_topic,
        osticket_commands::osticket_delete_topic,
        osticket_commands::osticket_list_agents,
        osticket_commands::osticket_get_agent,
        osticket_commands::osticket_create_agent,
        osticket_commands::osticket_update_agent,
        osticket_commands::osticket_delete_agent,
        osticket_commands::osticket_set_agent_vacation,
        osticket_commands::osticket_get_agent_teams,
        osticket_commands::osticket_list_teams,
        osticket_commands::osticket_get_team,
        osticket_commands::osticket_create_team,
        osticket_commands::osticket_update_team,
        osticket_commands::osticket_delete_team,
        osticket_commands::osticket_add_team_member,
        osticket_commands::osticket_remove_team_member,
        osticket_commands::osticket_get_team_members,
        osticket_commands::osticket_list_sla,
        osticket_commands::osticket_get_sla,
        osticket_commands::osticket_create_sla,
        osticket_commands::osticket_update_sla,
        osticket_commands::osticket_delete_sla,
        osticket_commands::osticket_list_canned_responses,
        osticket_commands::osticket_get_canned_response,
        osticket_commands::osticket_create_canned_response,
        osticket_commands::osticket_update_canned_response,
        osticket_commands::osticket_delete_canned_response,
        osticket_commands::osticket_search_canned_responses,
        osticket_commands::osticket_list_forms,
        osticket_commands::osticket_get_form,
        osticket_commands::osticket_list_custom_fields,
        osticket_commands::osticket_get_custom_field,
        osticket_commands::osticket_create_custom_field,
        osticket_commands::osticket_update_custom_field,
        osticket_commands::osticket_delete_custom_field,
        // Jira commands
        jira_commands::jira_connect,
        jira_commands::jira_disconnect,
        jira_commands::jira_list_connections,
        jira_commands::jira_ping,
        jira_commands::jira_get_issue,
        jira_commands::jira_create_issue,
        jira_commands::jira_bulk_create_issues,
        jira_commands::jira_update_issue,
        jira_commands::jira_delete_issue,
        jira_commands::jira_search_issues,
        jira_commands::jira_get_transitions,
        jira_commands::jira_transition_issue,
        jira_commands::jira_assign_issue,
        jira_commands::jira_get_issue_changelog,
        jira_commands::jira_link_issues,
        jira_commands::jira_get_watchers,
        jira_commands::jira_add_watcher,
        jira_commands::jira_list_projects,
        jira_commands::jira_get_project,
        jira_commands::jira_create_project,
        jira_commands::jira_delete_project,
        jira_commands::jira_get_project_statuses,
        jira_commands::jira_get_project_components,
        jira_commands::jira_get_project_versions,
        jira_commands::jira_list_comments,
        jira_commands::jira_get_comment,
        jira_commands::jira_add_comment,
        jira_commands::jira_update_comment,
        jira_commands::jira_delete_comment,
        jira_commands::jira_list_attachments,
        jira_commands::jira_get_attachment,
        jira_commands::jira_add_attachment,
        jira_commands::jira_delete_attachment,
        jira_commands::jira_list_worklogs,
        jira_commands::jira_get_worklog,
        jira_commands::jira_add_worklog,
        jira_commands::jira_update_worklog,
        jira_commands::jira_delete_worklog,
        jira_commands::jira_list_boards,
        jira_commands::jira_get_board,
        jira_commands::jira_get_board_issues,
        jira_commands::jira_get_board_backlog,
        jira_commands::jira_get_board_configuration,
        jira_commands::jira_list_sprints,
        jira_commands::jira_get_sprint,
        jira_commands::jira_create_sprint,
        jira_commands::jira_update_sprint,
        jira_commands::jira_delete_sprint,
        jira_commands::jira_get_sprint_issues,
        jira_commands::jira_move_issues_to_sprint,
        jira_commands::jira_start_sprint,
        jira_commands::jira_complete_sprint,
        jira_commands::jira_get_myself,
        jira_commands::jira_get_user,
        jira_commands::jira_search_users,
        jira_commands::jira_find_assignable_users,
        jira_commands::jira_list_fields,
        jira_commands::jira_get_all_issue_types,
        jira_commands::jira_get_priorities,
        jira_commands::jira_get_statuses,
        jira_commands::jira_get_resolutions,
        jira_commands::jira_list_dashboards,
        jira_commands::jira_get_dashboard,
        jira_commands::jira_get_filter,
        jira_commands::jira_get_favourite_filters,
        jira_commands::jira_get_my_filters,
        jira_commands::jira_create_filter,
        jira_commands::jira_update_filter,
        jira_commands::jira_delete_filter,
        // I18n commands
        i18n_commands::i18n_translate,
        i18n_commands::i18n_translate_plural,
        i18n_commands::i18n_translate_batch,
        i18n_commands::i18n_get_bundle,
        i18n_commands::i18n_get_namespace_bundle,
        i18n_commands::i18n_available_locales,
        i18n_commands::i18n_status,
        i18n_commands::i18n_detect_os_locale,
        i18n_commands::i18n_has_key,
        i18n_commands::i18n_missing_keys,
        i18n_commands::i18n_reload,
        i18n_commands::i18n_ssr_payload,
        i18n_commands::i18n_ssr_script,
        // Let's Encrypt / ACME certificate management
        letsencrypt_commands::le_get_status,
        letsencrypt_commands::le_start,
        letsencrypt_commands::le_stop,
        letsencrypt_commands::le_get_config,
        letsencrypt_commands::le_update_config,
        letsencrypt_commands::le_register_account,
        letsencrypt_commands::le_list_accounts,
        letsencrypt_commands::le_remove_account,
        letsencrypt_commands::le_request_certificate,
        letsencrypt_commands::le_renew_certificate,
        letsencrypt_commands::le_revoke_certificate,
        letsencrypt_commands::le_list_certificates,
        letsencrypt_commands::le_get_certificate,
        letsencrypt_commands::le_find_certificates_by_domain,
        letsencrypt_commands::le_remove_certificate,
        letsencrypt_commands::le_get_cert_paths,
        letsencrypt_commands::le_health_check,
        letsencrypt_commands::le_has_critical_issues,
        letsencrypt_commands::le_fetch_ocsp,
        letsencrypt_commands::le_get_ocsp_status,
        letsencrypt_commands::le_recent_events,
        letsencrypt_commands::le_drain_events,
        letsencrypt_commands::le_check_rate_limit,
        letsencrypt_commands::le_is_rate_limited,
        // SSH Agent management
        ssh_agent_commands::ssh_agent_get_status,
        ssh_agent_commands::ssh_agent_start,
        ssh_agent_commands::ssh_agent_stop,
        ssh_agent_commands::ssh_agent_restart,
        ssh_agent_commands::ssh_agent_get_config,
        ssh_agent_commands::ssh_agent_update_config,
        ssh_agent_commands::ssh_agent_list_keys,
        ssh_agent_commands::ssh_agent_add_key,
        ssh_agent_commands::ssh_agent_remove_key,
        ssh_agent_commands::ssh_agent_remove_all_keys,
        ssh_agent_commands::ssh_agent_lock,
        ssh_agent_commands::ssh_agent_unlock,
        ssh_agent_commands::ssh_agent_connect_system,
        ssh_agent_commands::ssh_agent_disconnect_system,
        ssh_agent_commands::ssh_agent_set_system_path,
        ssh_agent_commands::ssh_agent_discover_system,
        ssh_agent_commands::ssh_agent_start_forwarding,
        ssh_agent_commands::ssh_agent_stop_forwarding,
        ssh_agent_commands::ssh_agent_list_forwarding,
        ssh_agent_commands::ssh_agent_audit_log,
        ssh_agent_commands::ssh_agent_export_audit,
        ssh_agent_commands::ssh_agent_clear_audit,
        ssh_agent_commands::ssh_agent_run_maintenance,
        // SSH Agent PKCS#11 / Hardware key commands
        ssh_agent_commands::ssh_agent_load_pkcs11,
        ssh_agent_commands::ssh_agent_unload_pkcs11,
        ssh_agent_commands::ssh_agent_list_pkcs11_providers,
        ssh_agent_commands::ssh_agent_get_pkcs11_slots,
        ssh_agent_commands::ssh_agent_add_smartcard_key,
        ssh_agent_commands::ssh_agent_remove_smartcard_key,
        ssh_agent_commands::ssh_agent_list_security_keys,
        ssh_agent_commands::ssh_agent_add_security_key,
        ssh_agent_commands::ssh_agent_get_pending_confirm,
        ssh_agent_commands::ssh_agent_confirm_sign,
        ssh_agent_commands::ssh_agent_get_key_details,
        ssh_agent_commands::ssh_agent_update_key_comment,
        ssh_agent_commands::ssh_agent_update_key_constraints,
        ssh_agent_commands::ssh_agent_export_public_key,
        // GPG Agent commands
        gpg_agent_commands::gpg_get_status,
        gpg_agent_commands::gpg_start_agent,
        gpg_agent_commands::gpg_stop_agent,
        gpg_agent_commands::gpg_reload_agent,
        gpg_agent_commands::gpg_get_config,
        gpg_agent_commands::gpg_update_config,
        gpg_agent_commands::gpg_detect_environment,
        gpg_agent_commands::gpg_list_keys,
        gpg_agent_commands::gpg_get_key,
        gpg_agent_commands::gpg_generate_key,
        gpg_agent_commands::gpg_import_key,
        gpg_agent_commands::gpg_import_key_file,
        gpg_agent_commands::gpg_export_key,
        gpg_agent_commands::gpg_export_secret_key,
        gpg_agent_commands::gpg_delete_key,
        gpg_agent_commands::gpg_add_uid,
        gpg_agent_commands::gpg_revoke_uid,
        gpg_agent_commands::gpg_add_subkey,
        gpg_agent_commands::gpg_revoke_subkey,
        gpg_agent_commands::gpg_set_expiration,
        gpg_agent_commands::gpg_generate_revocation,
        gpg_agent_commands::gpg_sign_data,
        gpg_agent_commands::gpg_verify_signature,
        gpg_agent_commands::gpg_sign_key,
        gpg_agent_commands::gpg_encrypt_data,
        gpg_agent_commands::gpg_decrypt_data,
        gpg_agent_commands::gpg_set_owner_trust,
        gpg_agent_commands::gpg_trust_db_stats,
        gpg_agent_commands::gpg_update_trust_db,
        gpg_agent_commands::gpg_search_keyserver,
        gpg_agent_commands::gpg_fetch_from_keyserver,
        gpg_agent_commands::gpg_send_to_keyserver,
        gpg_agent_commands::gpg_refresh_keys,
        gpg_agent_commands::gpg_card_status,
        gpg_agent_commands::gpg_list_cards,
        gpg_agent_commands::gpg_card_change_pin,
        gpg_agent_commands::gpg_card_factory_reset,
        gpg_agent_commands::gpg_card_set_attribute,
        gpg_agent_commands::gpg_card_generate_key,
        gpg_agent_commands::gpg_card_move_key,
        gpg_agent_commands::gpg_card_fetch_key,
        gpg_agent_commands::gpg_audit_log,
        gpg_agent_commands::gpg_audit_export,
        gpg_agent_commands::gpg_audit_clear,
        // YubiKey commands
        yubikey_commands::yk_list_devices,
        yubikey_commands::yk_get_device_info,
        yubikey_commands::yk_wait_for_device,
        yubikey_commands::yk_get_diagnostics,
        yubikey_commands::yk_piv_list_certs,
        yubikey_commands::yk_piv_get_slot,
        yubikey_commands::yk_piv_generate_key,
        yubikey_commands::yk_piv_self_sign_cert,
        yubikey_commands::yk_piv_generate_csr,
        yubikey_commands::yk_piv_import_cert,
        yubikey_commands::yk_piv_import_key,
        yubikey_commands::yk_piv_export_cert,
        yubikey_commands::yk_piv_delete_cert,
        yubikey_commands::yk_piv_delete_key,
        yubikey_commands::yk_piv_attest,
        yubikey_commands::yk_piv_change_pin,
        yubikey_commands::yk_piv_change_puk,
        yubikey_commands::yk_piv_change_mgmt_key,
        yubikey_commands::yk_piv_unblock_pin,
        yubikey_commands::yk_piv_get_pin_status,
        yubikey_commands::yk_piv_reset,
        yubikey_commands::yk_piv_sign,
        yubikey_commands::yk_fido2_info,
        yubikey_commands::yk_fido2_list_credentials,
        yubikey_commands::yk_fido2_delete_credential,
        yubikey_commands::yk_fido2_set_pin,
        yubikey_commands::yk_fido2_change_pin,
        yubikey_commands::yk_fido2_pin_status,
        yubikey_commands::yk_fido2_reset,
        yubikey_commands::yk_fido2_toggle_always_uv,
        yubikey_commands::yk_fido2_list_rps,
        yubikey_commands::yk_oath_list,
        yubikey_commands::yk_oath_add,
        yubikey_commands::yk_oath_delete,
        yubikey_commands::yk_oath_rename,
        yubikey_commands::yk_oath_calculate,
        yubikey_commands::yk_oath_calculate_all,
        yubikey_commands::yk_oath_set_password,
        yubikey_commands::yk_oath_reset,
        yubikey_commands::yk_otp_info,
        yubikey_commands::yk_otp_configure_yubico,
        yubikey_commands::yk_otp_configure_chalresp,
        yubikey_commands::yk_otp_configure_static,
        yubikey_commands::yk_otp_configure_hotp,
        yubikey_commands::yk_otp_delete,
        yubikey_commands::yk_otp_swap,
        yubikey_commands::yk_config_set_interfaces,
        yubikey_commands::yk_config_lock,
        yubikey_commands::yk_config_unlock,
        yubikey_commands::yk_get_config,
        yubikey_commands::yk_update_config,
        yubikey_commands::yk_audit_log,
        yubikey_commands::yk_audit_export,
        yubikey_commands::yk_audit_clear,
        yubikey_commands::yk_factory_reset_all,
        yubikey_commands::yk_export_report,
    ]
}

fn build_b() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
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

fn build_c() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── LXD / Incus commands ─────────────────────────────────────
        lxd_commands::lxd_connect,
        lxd_commands::lxd_disconnect,
        lxd_commands::lxd_is_connected,
        // Server & Cluster
        lxd_commands::lxd_get_server,
        lxd_commands::lxd_get_server_resources,
        lxd_commands::lxd_update_server_config,
        lxd_commands::lxd_get_cluster,
        lxd_commands::lxd_list_cluster_members,
        lxd_commands::lxd_get_cluster_member,
        lxd_commands::lxd_evacuate_cluster_member,
        lxd_commands::lxd_restore_cluster_member,
        lxd_commands::lxd_remove_cluster_member,
        // Instances
        lxd_commands::lxd_list_instances,
        lxd_commands::lxd_list_containers,
        lxd_commands::lxd_list_virtual_machines,
        lxd_commands::lxd_get_instance,
        lxd_commands::lxd_get_instance_state,
        lxd_commands::lxd_create_instance,
        lxd_commands::lxd_update_instance,
        lxd_commands::lxd_patch_instance,
        lxd_commands::lxd_delete_instance,
        lxd_commands::lxd_rename_instance,
        lxd_commands::lxd_start_instance,
        lxd_commands::lxd_stop_instance,
        lxd_commands::lxd_restart_instance,
        lxd_commands::lxd_freeze_instance,
        lxd_commands::lxd_unfreeze_instance,
        lxd_commands::lxd_exec_instance,
        lxd_commands::lxd_console_instance,
        lxd_commands::lxd_clear_console_log,
        lxd_commands::lxd_list_instance_logs,
        lxd_commands::lxd_get_instance_log,
        lxd_commands::lxd_get_instance_file,
        lxd_commands::lxd_push_instance_file,
        lxd_commands::lxd_delete_instance_file,
        // Snapshots
        lxd_commands::lxd_list_snapshots,
        lxd_commands::lxd_get_snapshot,
        lxd_commands::lxd_create_snapshot,
        lxd_commands::lxd_delete_snapshot,
        lxd_commands::lxd_rename_snapshot,
        lxd_commands::lxd_restore_snapshot,
        // Backups
        lxd_commands::lxd_list_backups,
        lxd_commands::lxd_get_backup,
        lxd_commands::lxd_create_backup,
        lxd_commands::lxd_delete_backup,
        lxd_commands::lxd_rename_backup,
        // Images
        lxd_commands::lxd_list_images,
        lxd_commands::lxd_get_image,
        lxd_commands::lxd_get_image_alias,
        lxd_commands::lxd_create_image_alias,
        lxd_commands::lxd_delete_image_alias,
        lxd_commands::lxd_delete_image,
        lxd_commands::lxd_update_image,
        lxd_commands::lxd_copy_image_from_remote,
        lxd_commands::lxd_refresh_image,
        // Profiles
        lxd_commands::lxd_list_profiles,
        lxd_commands::lxd_get_profile,
        lxd_commands::lxd_create_profile,
        lxd_commands::lxd_update_profile,
        lxd_commands::lxd_patch_profile,
        lxd_commands::lxd_delete_profile,
        lxd_commands::lxd_rename_profile,
        // Networks
        lxd_commands::lxd_list_networks,
        lxd_commands::lxd_get_network,
        lxd_commands::lxd_create_network,
        lxd_commands::lxd_update_network,
        lxd_commands::lxd_patch_network,
        lxd_commands::lxd_delete_network,
        lxd_commands::lxd_rename_network,
        lxd_commands::lxd_get_network_state,
        lxd_commands::lxd_list_network_leases,
        lxd_commands::lxd_list_network_acls,
        lxd_commands::lxd_get_network_acl,
        lxd_commands::lxd_create_network_acl,
        lxd_commands::lxd_update_network_acl,
        lxd_commands::lxd_delete_network_acl,
        lxd_commands::lxd_list_network_forwards,
        lxd_commands::lxd_get_network_forward,
        lxd_commands::lxd_create_network_forward,
        lxd_commands::lxd_delete_network_forward,
        lxd_commands::lxd_list_network_zones,
        lxd_commands::lxd_get_network_zone,
        lxd_commands::lxd_delete_network_zone,
        lxd_commands::lxd_list_network_load_balancers,
        lxd_commands::lxd_get_network_load_balancer,
        lxd_commands::lxd_delete_network_load_balancer,
        lxd_commands::lxd_list_network_peers,
        // Storage
        lxd_commands::lxd_list_storage_pools,
        lxd_commands::lxd_get_storage_pool,
        lxd_commands::lxd_create_storage_pool,
        lxd_commands::lxd_update_storage_pool,
        lxd_commands::lxd_delete_storage_pool,
        lxd_commands::lxd_get_storage_pool_resources,
        lxd_commands::lxd_list_storage_volumes,
        lxd_commands::lxd_list_custom_volumes,
        lxd_commands::lxd_get_storage_volume,
        lxd_commands::lxd_create_storage_volume,
        lxd_commands::lxd_update_storage_volume,
        lxd_commands::lxd_delete_storage_volume,
        lxd_commands::lxd_rename_storage_volume,
        lxd_commands::lxd_list_volume_snapshots,
        lxd_commands::lxd_create_volume_snapshot,
        lxd_commands::lxd_delete_volume_snapshot,
        lxd_commands::lxd_list_storage_buckets,
        lxd_commands::lxd_get_storage_bucket,
        lxd_commands::lxd_create_storage_bucket,
        lxd_commands::lxd_delete_storage_bucket,
        lxd_commands::lxd_list_bucket_keys,
        // Projects
        lxd_commands::lxd_list_projects,
        lxd_commands::lxd_get_project,
        lxd_commands::lxd_create_project,
        lxd_commands::lxd_update_project,
        lxd_commands::lxd_patch_project,
        lxd_commands::lxd_delete_project,
        lxd_commands::lxd_rename_project,
        // Certificates
        lxd_commands::lxd_list_certificates,
        lxd_commands::lxd_get_certificate,
        lxd_commands::lxd_add_certificate,
        lxd_commands::lxd_delete_certificate,
        lxd_commands::lxd_update_certificate,
        // Operations
        lxd_commands::lxd_list_operations,
        lxd_commands::lxd_get_operation,
        lxd_commands::lxd_cancel_operation,
        lxd_commands::lxd_wait_operation,
        // Warnings
        lxd_commands::lxd_list_warnings,
        lxd_commands::lxd_get_warning,
        lxd_commands::lxd_acknowledge_warning,
        lxd_commands::lxd_delete_warning,
        // Migration / Copy / Publish
        lxd_commands::lxd_migrate_instance,
        lxd_commands::lxd_copy_instance,
        lxd_commands::lxd_publish_instance,
        // VMware Desktop (Player / Workstation / Fusion)
        vmware_desktop_commands::vmwd_connect,
        vmware_desktop_commands::vmwd_disconnect,
        vmware_desktop_commands::vmwd_is_connected,
        vmware_desktop_commands::vmwd_connection_summary,
        vmware_desktop_commands::vmwd_host_info,
        // VMs
        vmware_desktop_commands::vmwd_list_vms,
        vmware_desktop_commands::vmwd_get_vm,
        vmware_desktop_commands::vmwd_create_vm,
        vmware_desktop_commands::vmwd_update_vm,
        vmware_desktop_commands::vmwd_delete_vm,
        vmware_desktop_commands::vmwd_clone_vm,
        vmware_desktop_commands::vmwd_register_vm,
        vmware_desktop_commands::vmwd_unregister_vm,
        vmware_desktop_commands::vmwd_configure_nic,
        vmware_desktop_commands::vmwd_remove_nic,
        vmware_desktop_commands::vmwd_configure_cdrom,
        // Power
        vmware_desktop_commands::vmwd_start_vm,
        vmware_desktop_commands::vmwd_stop_vm,
        vmware_desktop_commands::vmwd_reset_vm,
        vmware_desktop_commands::vmwd_suspend_vm,
        vmware_desktop_commands::vmwd_pause_vm,
        vmware_desktop_commands::vmwd_unpause_vm,
        vmware_desktop_commands::vmwd_get_power_state,
        vmware_desktop_commands::vmwd_batch_power,
        // Snapshots
        vmware_desktop_commands::vmwd_list_snapshots,
        vmware_desktop_commands::vmwd_get_snapshot_tree,
        vmware_desktop_commands::vmwd_create_snapshot,
        vmware_desktop_commands::vmwd_delete_snapshot,
        vmware_desktop_commands::vmwd_revert_to_snapshot,
        vmware_desktop_commands::vmwd_get_snapshot,
        // Guest operations
        vmware_desktop_commands::vmwd_exec_in_guest,
        vmware_desktop_commands::vmwd_run_script_in_guest,
        vmware_desktop_commands::vmwd_copy_to_guest,
        vmware_desktop_commands::vmwd_copy_from_guest,
        vmware_desktop_commands::vmwd_create_directory_in_guest,
        vmware_desktop_commands::vmwd_delete_directory_in_guest,
        vmware_desktop_commands::vmwd_delete_file_in_guest,
        vmware_desktop_commands::vmwd_file_exists_in_guest,
        vmware_desktop_commands::vmwd_directory_exists_in_guest,
        vmware_desktop_commands::vmwd_rename_file_in_guest,
        vmware_desktop_commands::vmwd_list_directory_in_guest,
        vmware_desktop_commands::vmwd_list_processes_in_guest,
        vmware_desktop_commands::vmwd_kill_process_in_guest,
        vmware_desktop_commands::vmwd_read_variable,
        vmware_desktop_commands::vmwd_write_variable,
        vmware_desktop_commands::vmwd_list_env_vars,
        vmware_desktop_commands::vmwd_get_tools_status,
        vmware_desktop_commands::vmwd_install_tools,
        vmware_desktop_commands::vmwd_get_ip_address,
        // Shared folders
        vmware_desktop_commands::vmwd_enable_shared_folders,
        vmware_desktop_commands::vmwd_disable_shared_folders,
        vmware_desktop_commands::vmwd_list_shared_folders,
        vmware_desktop_commands::vmwd_add_shared_folder,
        vmware_desktop_commands::vmwd_remove_shared_folder,
        vmware_desktop_commands::vmwd_set_shared_folder_state,
        // Networking
        vmware_desktop_commands::vmwd_list_networks,
        vmware_desktop_commands::vmwd_get_network,
        vmware_desktop_commands::vmwd_create_network,
        vmware_desktop_commands::vmwd_update_network,
        vmware_desktop_commands::vmwd_delete_network,
        vmware_desktop_commands::vmwd_list_port_forwards,
        vmware_desktop_commands::vmwd_set_port_forward,
        vmware_desktop_commands::vmwd_delete_port_forward,
        vmware_desktop_commands::vmwd_get_dhcp_leases,
        vmware_desktop_commands::vmwd_read_networking_config,
        // VMDK
        vmware_desktop_commands::vmwd_create_vmdk,
        vmware_desktop_commands::vmwd_get_vmdk_info,
        vmware_desktop_commands::vmwd_defragment_vmdk,
        vmware_desktop_commands::vmwd_shrink_vmdk,
        vmware_desktop_commands::vmwd_expand_vmdk,
        vmware_desktop_commands::vmwd_convert_vmdk,
        vmware_desktop_commands::vmwd_rename_vmdk,
        vmware_desktop_commands::vmwd_add_disk_to_vm,
        vmware_desktop_commands::vmwd_remove_disk_from_vm,
        vmware_desktop_commands::vmwd_list_vm_disks,
        // OVF
        vmware_desktop_commands::vmwd_import_ovf,
        vmware_desktop_commands::vmwd_export_ovf,
        // VMX
        vmware_desktop_commands::vmwd_parse_vmx,
        vmware_desktop_commands::vmwd_update_vmx_keys,
        vmware_desktop_commands::vmwd_remove_vmx_keys,
        vmware_desktop_commands::vmwd_discover_vmx_files,
        // Preferences
        vmware_desktop_commands::vmwd_read_preferences,
        vmware_desktop_commands::vmwd_get_default_vm_dir,
        vmware_desktop_commands::vmwd_set_preference,
        // Nginx
        nginx_commands::ngx_connect,
        nginx_commands::ngx_disconnect,
        nginx_commands::ngx_list_connections,
        nginx_commands::ngx_list_sites,
        nginx_commands::ngx_get_site,
        nginx_commands::ngx_create_site,
        nginx_commands::ngx_update_site,
        nginx_commands::ngx_delete_site,
        nginx_commands::ngx_enable_site,
        nginx_commands::ngx_disable_site,
        nginx_commands::ngx_list_upstreams,
        nginx_commands::ngx_get_upstream,
        nginx_commands::ngx_create_upstream,
        nginx_commands::ngx_update_upstream,
        nginx_commands::ngx_delete_upstream,
        nginx_commands::ngx_get_ssl_config,
        nginx_commands::ngx_update_ssl_config,
        nginx_commands::ngx_list_ssl_certificates,
        nginx_commands::ngx_stub_status,
        nginx_commands::ngx_process_status,
        nginx_commands::ngx_health_check,
        nginx_commands::ngx_query_access_log,
        nginx_commands::ngx_query_error_log,
        nginx_commands::ngx_list_log_files,
        nginx_commands::ngx_get_main_config,
        nginx_commands::ngx_update_main_config,
        nginx_commands::ngx_test_config,
        nginx_commands::ngx_list_snippets,
        nginx_commands::ngx_get_snippet,
        nginx_commands::ngx_create_snippet,
        nginx_commands::ngx_update_snippet,
        nginx_commands::ngx_delete_snippet,
        nginx_commands::ngx_start,
        nginx_commands::ngx_stop,
        nginx_commands::ngx_restart,
        nginx_commands::ngx_reload,
        nginx_commands::ngx_version,
        nginx_commands::ngx_info,
        // Traefik
        traefik_commands::traefik_connect,
        traefik_commands::traefik_disconnect,
        traefik_commands::traefik_list_connections,
        traefik_commands::traefik_ping,
        traefik_commands::traefik_list_http_routers,
        traefik_commands::traefik_get_http_router,
        traefik_commands::traefik_list_tcp_routers,
        traefik_commands::traefik_get_tcp_router,
        traefik_commands::traefik_list_udp_routers,
        traefik_commands::traefik_get_udp_router,
        traefik_commands::traefik_list_http_services,
        traefik_commands::traefik_get_http_service,
        traefik_commands::traefik_list_tcp_services,
        traefik_commands::traefik_get_tcp_service,
        traefik_commands::traefik_list_udp_services,
        traefik_commands::traefik_get_udp_service,
        traefik_commands::traefik_list_http_middlewares,
        traefik_commands::traefik_get_http_middleware,
        traefik_commands::traefik_list_tcp_middlewares,
        traefik_commands::traefik_get_tcp_middleware,
        traefik_commands::traefik_list_entrypoints,
        traefik_commands::traefik_get_entrypoint,
        traefik_commands::traefik_list_tls_certificates,
        traefik_commands::traefik_get_tls_certificate,
        traefik_commands::traefik_get_overview,
        traefik_commands::traefik_get_version,
        traefik_commands::traefik_get_raw_config,
        // HAProxy
        haproxy_commands::haproxy_connect,
        haproxy_commands::haproxy_disconnect,
        haproxy_commands::haproxy_list_connections,
        haproxy_commands::haproxy_ping,
        haproxy_commands::haproxy_get_info,
        haproxy_commands::haproxy_get_csv,
        haproxy_commands::haproxy_list_frontends,
        haproxy_commands::haproxy_get_frontend,
        haproxy_commands::haproxy_list_backends,
        haproxy_commands::haproxy_get_backend,
        haproxy_commands::haproxy_list_servers,
        haproxy_commands::haproxy_get_server,
        haproxy_commands::haproxy_set_server_state,
        haproxy_commands::haproxy_list_acls,
        haproxy_commands::haproxy_get_acl,
        haproxy_commands::haproxy_add_acl_entry,
        haproxy_commands::haproxy_del_acl_entry,
        haproxy_commands::haproxy_clear_acl,
        haproxy_commands::haproxy_list_maps,
        haproxy_commands::haproxy_get_map,
        haproxy_commands::haproxy_add_map_entry,
        haproxy_commands::haproxy_del_map_entry,
        haproxy_commands::haproxy_set_map_entry,
        haproxy_commands::haproxy_clear_map,
        haproxy_commands::haproxy_list_stick_tables,
        haproxy_commands::haproxy_get_stick_table,
        haproxy_commands::haproxy_clear_stick_table,
        haproxy_commands::haproxy_set_stick_table_entry,
        haproxy_commands::haproxy_runtime_execute,
        haproxy_commands::haproxy_show_servers_state,
        haproxy_commands::haproxy_show_sessions,
        haproxy_commands::haproxy_show_backend_list,
        haproxy_commands::haproxy_get_raw_config,
        haproxy_commands::haproxy_update_raw_config,
        haproxy_commands::haproxy_validate_config,
        haproxy_commands::haproxy_reload,
        haproxy_commands::haproxy_start,
        haproxy_commands::haproxy_stop,
        haproxy_commands::haproxy_restart,
        haproxy_commands::haproxy_version,
        // Apache
        apache_commands::apache_connect,
        apache_commands::apache_disconnect,
        apache_commands::apache_list_connections,
        apache_commands::apache_ping,
        apache_commands::apache_list_vhosts,
        apache_commands::apache_get_vhost,
        apache_commands::apache_create_vhost,
        apache_commands::apache_update_vhost,
        apache_commands::apache_delete_vhost,
        apache_commands::apache_enable_vhost,
        apache_commands::apache_disable_vhost,
        apache_commands::apache_list_modules,
        apache_commands::apache_list_available_modules,
        apache_commands::apache_list_enabled_modules,
        apache_commands::apache_enable_module,
        apache_commands::apache_disable_module,
        apache_commands::apache_get_ssl_config,
        apache_commands::apache_list_ssl_certificates,
        apache_commands::apache_get_status,
        apache_commands::apache_process_status,
        apache_commands::apache_query_access_log,
        apache_commands::apache_query_error_log,
        apache_commands::apache_list_log_files,
        apache_commands::apache_get_main_config,
        apache_commands::apache_update_main_config,
        apache_commands::apache_test_config,
        apache_commands::apache_list_conf_available,
        apache_commands::apache_list_conf_enabled,
        apache_commands::apache_enable_conf,
        apache_commands::apache_disable_conf,
        apache_commands::apache_start,
        apache_commands::apache_stop,
        apache_commands::apache_restart,
        apache_commands::apache_reload,
        apache_commands::apache_version,
        apache_commands::apache_info,
        // Caddy
        caddy_commands::caddy_connect,
        caddy_commands::caddy_disconnect,
        caddy_commands::caddy_list_connections,
        caddy_commands::caddy_ping,
        caddy_commands::caddy_get_full_config,
        caddy_commands::caddy_get_raw_config,
        caddy_commands::caddy_get_config_path,
        caddy_commands::caddy_set_config_path,
        caddy_commands::caddy_patch_config_path,
        caddy_commands::caddy_delete_config_path,
        caddy_commands::caddy_load_config,
        caddy_commands::caddy_adapt_caddyfile,
        caddy_commands::caddy_stop_server,
        caddy_commands::caddy_list_servers,
        caddy_commands::caddy_get_server,
        caddy_commands::caddy_set_server,
        caddy_commands::caddy_delete_server,
        caddy_commands::caddy_list_routes,
        caddy_commands::caddy_get_route,
        caddy_commands::caddy_add_route,
        caddy_commands::caddy_set_route,
        caddy_commands::caddy_delete_route,
        caddy_commands::caddy_set_all_routes,
        caddy_commands::caddy_get_tls_app,
        caddy_commands::caddy_set_tls_app,
        caddy_commands::caddy_list_automate_domains,
        caddy_commands::caddy_set_automate_domains,
        caddy_commands::caddy_get_tls_automation,
        caddy_commands::caddy_set_tls_automation,
        caddy_commands::caddy_list_tls_certificates,
        caddy_commands::caddy_create_reverse_proxy,
        caddy_commands::caddy_get_upstreams,
        caddy_commands::caddy_create_file_server,
        caddy_commands::caddy_create_redirect,
        // Nginx Proxy Manager
        nginx_proxy_mgr_commands::npm_connect,
        nginx_proxy_mgr_commands::npm_disconnect,
        nginx_proxy_mgr_commands::npm_list_connections,
        nginx_proxy_mgr_commands::npm_ping,
        nginx_proxy_mgr_commands::npm_list_proxy_hosts,
        nginx_proxy_mgr_commands::npm_get_proxy_host,
        nginx_proxy_mgr_commands::npm_create_proxy_host,
        nginx_proxy_mgr_commands::npm_update_proxy_host,
        nginx_proxy_mgr_commands::npm_delete_proxy_host,
        nginx_proxy_mgr_commands::npm_enable_proxy_host,
        nginx_proxy_mgr_commands::npm_disable_proxy_host,
        nginx_proxy_mgr_commands::npm_list_redirection_hosts,
        nginx_proxy_mgr_commands::npm_get_redirection_host,
        nginx_proxy_mgr_commands::npm_create_redirection_host,
        nginx_proxy_mgr_commands::npm_update_redirection_host,
        nginx_proxy_mgr_commands::npm_delete_redirection_host,
        nginx_proxy_mgr_commands::npm_list_dead_hosts,
        nginx_proxy_mgr_commands::npm_get_dead_host,
        nginx_proxy_mgr_commands::npm_create_dead_host,
        nginx_proxy_mgr_commands::npm_update_dead_host,
        nginx_proxy_mgr_commands::npm_delete_dead_host,
        nginx_proxy_mgr_commands::npm_list_streams,
        nginx_proxy_mgr_commands::npm_get_stream,
        nginx_proxy_mgr_commands::npm_create_stream,
        nginx_proxy_mgr_commands::npm_update_stream,
        nginx_proxy_mgr_commands::npm_delete_stream,
        nginx_proxy_mgr_commands::npm_list_certificates,
        nginx_proxy_mgr_commands::npm_get_certificate,
        nginx_proxy_mgr_commands::npm_create_letsencrypt_certificate,
        nginx_proxy_mgr_commands::npm_upload_custom_certificate,
        nginx_proxy_mgr_commands::npm_delete_certificate,
        nginx_proxy_mgr_commands::npm_renew_certificate,
        nginx_proxy_mgr_commands::npm_validate_certificate,
        nginx_proxy_mgr_commands::npm_list_users,
        nginx_proxy_mgr_commands::npm_get_user,
        nginx_proxy_mgr_commands::npm_create_user,
        nginx_proxy_mgr_commands::npm_update_user,
        nginx_proxy_mgr_commands::npm_delete_user,
        nginx_proxy_mgr_commands::npm_change_user_password,
        nginx_proxy_mgr_commands::npm_get_me,
        nginx_proxy_mgr_commands::npm_list_access_lists,
        nginx_proxy_mgr_commands::npm_get_access_list,
        nginx_proxy_mgr_commands::npm_create_access_list,
        nginx_proxy_mgr_commands::npm_update_access_list,
        nginx_proxy_mgr_commands::npm_delete_access_list,
        nginx_proxy_mgr_commands::npm_list_settings,
        nginx_proxy_mgr_commands::npm_get_setting,
        nginx_proxy_mgr_commands::npm_update_setting,
        nginx_proxy_mgr_commands::npm_get_reports,
        nginx_proxy_mgr_commands::npm_get_audit_log,
        nginx_proxy_mgr_commands::npm_get_health,
        // DDNS commands
        ddns_commands::ddns_list_profiles,
        ddns_commands::ddns_get_profile,
        ddns_commands::ddns_create_profile,
        ddns_commands::ddns_update_profile,
        ddns_commands::ddns_delete_profile,
        ddns_commands::ddns_enable_profile,
        ddns_commands::ddns_disable_profile,
        ddns_commands::ddns_trigger_update,
        ddns_commands::ddns_trigger_update_all,
        ddns_commands::ddns_detect_ip,
        ddns_commands::ddns_get_current_ips,
        ddns_commands::ddns_start_scheduler,
        ddns_commands::ddns_stop_scheduler,
        ddns_commands::ddns_get_scheduler_status,
        ddns_commands::ddns_get_profile_health,
        ddns_commands::ddns_get_all_health,
        ddns_commands::ddns_get_system_status,
        ddns_commands::ddns_list_providers,
        ddns_commands::ddns_get_provider_capabilities,
        ddns_commands::ddns_cf_list_zones,
        ddns_commands::ddns_cf_list_records,
        ddns_commands::ddns_cf_create_record,
        ddns_commands::ddns_cf_delete_record,
        ddns_commands::ddns_get_config,
        ddns_commands::ddns_update_config,
        ddns_commands::ddns_get_audit_log,
        ddns_commands::ddns_get_audit_for_profile,
        ddns_commands::ddns_export_audit,
        ddns_commands::ddns_clear_audit,
        ddns_commands::ddns_export_profiles,
        ddns_commands::ddns_import_profiles,
        ddns_commands::ddns_process_scheduled,
        // Postfix
    ]
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    let a = build_a();
    let b = build_b();
    let c = build_c();
    move |invoke| {
        let cmd = invoke.message.command();
        if is_command_a(cmd) { return a(invoke); }
        if is_command_b(cmd) { return b(invoke); }
        if is_command_c(cmd) { return c(invoke); }
        false
    }
}
