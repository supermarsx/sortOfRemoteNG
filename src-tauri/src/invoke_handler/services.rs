use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
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
            | "warpgate_connect"
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
            | "lxd_connect"
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

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Budibase commands
        budibase::commands::budibase_connect,
        budibase::commands::budibase_disconnect,
        budibase::commands::budibase_list_connections,
        budibase::commands::budibase_ping,
        budibase::commands::budibase_set_app_context,
        budibase::commands::budibase_list_apps,
        budibase::commands::budibase_search_apps,
        budibase::commands::budibase_get_app,
        budibase::commands::budibase_create_app,
        budibase::commands::budibase_update_app,
        budibase::commands::budibase_delete_app,
        budibase::commands::budibase_publish_app,
        budibase::commands::budibase_unpublish_app,
        budibase::commands::budibase_list_tables,
        budibase::commands::budibase_get_table,
        budibase::commands::budibase_create_table,
        budibase::commands::budibase_update_table,
        budibase::commands::budibase_delete_table,
        budibase::commands::budibase_get_table_schema,
        budibase::commands::budibase_list_rows,
        budibase::commands::budibase_search_rows,
        budibase::commands::budibase_get_row,
        budibase::commands::budibase_create_row,
        budibase::commands::budibase_update_row,
        budibase::commands::budibase_delete_row,
        budibase::commands::budibase_bulk_create_rows,
        budibase::commands::budibase_bulk_delete_rows,
        budibase::commands::budibase_list_views,
        budibase::commands::budibase_get_view,
        budibase::commands::budibase_create_view,
        budibase::commands::budibase_update_view,
        budibase::commands::budibase_delete_view,
        budibase::commands::budibase_query_view,
        budibase::commands::budibase_list_users,
        budibase::commands::budibase_search_users,
        budibase::commands::budibase_get_user,
        budibase::commands::budibase_create_user,
        budibase::commands::budibase_update_user,
        budibase::commands::budibase_delete_user,
        budibase::commands::budibase_list_queries,
        budibase::commands::budibase_get_query,
        budibase::commands::budibase_execute_query,
        budibase::commands::budibase_create_query,
        budibase::commands::budibase_update_query,
        budibase::commands::budibase_delete_query,
        budibase::commands::budibase_list_automations,
        budibase::commands::budibase_get_automation,
        budibase::commands::budibase_create_automation,
        budibase::commands::budibase_update_automation,
        budibase::commands::budibase_delete_automation,
        budibase::commands::budibase_trigger_automation,
        budibase::commands::budibase_get_automation_logs,
        budibase::commands::budibase_list_datasources,
        budibase::commands::budibase_get_datasource,
        budibase::commands::budibase_create_datasource,
        budibase::commands::budibase_update_datasource,
        budibase::commands::budibase_delete_datasource,
        budibase::commands::budibase_test_datasource,
        // osTicket commands
        osticket::commands::osticket_connect,
        osticket::commands::osticket_disconnect,
        osticket::commands::osticket_list_connections,
        osticket::commands::osticket_ping,
        osticket::commands::osticket_list_tickets,
        osticket::commands::osticket_search_tickets,
        osticket::commands::osticket_get_ticket,
        osticket::commands::osticket_create_ticket,
        osticket::commands::osticket_update_ticket,
        osticket::commands::osticket_delete_ticket,
        osticket::commands::osticket_close_ticket,
        osticket::commands::osticket_reopen_ticket,
        osticket::commands::osticket_assign_ticket,
        osticket::commands::osticket_post_ticket_reply,
        osticket::commands::osticket_post_ticket_note,
        osticket::commands::osticket_get_ticket_threads,
        osticket::commands::osticket_add_ticket_collaborator,
        osticket::commands::osticket_get_ticket_collaborators,
        osticket::commands::osticket_remove_ticket_collaborator,
        osticket::commands::osticket_transfer_ticket,
        osticket::commands::osticket_merge_tickets,
        osticket::commands::osticket_list_users,
        osticket::commands::osticket_get_user,
        osticket::commands::osticket_search_users,
        osticket::commands::osticket_create_user,
        osticket::commands::osticket_update_user,
        osticket::commands::osticket_delete_user,
        osticket::commands::osticket_get_user_tickets,
        osticket::commands::osticket_list_departments,
        osticket::commands::osticket_get_department,
        osticket::commands::osticket_create_department,
        osticket::commands::osticket_update_department,
        osticket::commands::osticket_delete_department,
        osticket::commands::osticket_get_department_agents,
        osticket::commands::osticket_list_topics,
        osticket::commands::osticket_get_topic,
        osticket::commands::osticket_create_topic,
        osticket::commands::osticket_update_topic,
        osticket::commands::osticket_delete_topic,
        osticket::commands::osticket_list_agents,
        osticket::commands::osticket_get_agent,
        osticket::commands::osticket_create_agent,
        osticket::commands::osticket_update_agent,
        osticket::commands::osticket_delete_agent,
        osticket::commands::osticket_set_agent_vacation,
        osticket::commands::osticket_get_agent_teams,
        osticket::commands::osticket_list_teams,
        osticket::commands::osticket_get_team,
        osticket::commands::osticket_create_team,
        osticket::commands::osticket_update_team,
        osticket::commands::osticket_delete_team,
        osticket::commands::osticket_add_team_member,
        osticket::commands::osticket_remove_team_member,
        osticket::commands::osticket_get_team_members,
        osticket::commands::osticket_list_sla,
        osticket::commands::osticket_get_sla,
        osticket::commands::osticket_create_sla,
        osticket::commands::osticket_update_sla,
        osticket::commands::osticket_delete_sla,
        osticket::commands::osticket_list_canned_responses,
        osticket::commands::osticket_get_canned_response,
        osticket::commands::osticket_create_canned_response,
        osticket::commands::osticket_update_canned_response,
        osticket::commands::osticket_delete_canned_response,
        osticket::commands::osticket_search_canned_responses,
        osticket::commands::osticket_list_forms,
        osticket::commands::osticket_get_form,
        osticket::commands::osticket_list_custom_fields,
        osticket::commands::osticket_get_custom_field,
        osticket::commands::osticket_create_custom_field,
        osticket::commands::osticket_update_custom_field,
        osticket::commands::osticket_delete_custom_field,
        // Jira commands
        jira::commands::jira_connect,
        jira::commands::jira_disconnect,
        jira::commands::jira_list_connections,
        jira::commands::jira_ping,
        jira::commands::jira_get_issue,
        jira::commands::jira_create_issue,
        jira::commands::jira_bulk_create_issues,
        jira::commands::jira_update_issue,
        jira::commands::jira_delete_issue,
        jira::commands::jira_search_issues,
        jira::commands::jira_get_transitions,
        jira::commands::jira_transition_issue,
        jira::commands::jira_assign_issue,
        jira::commands::jira_get_issue_changelog,
        jira::commands::jira_link_issues,
        jira::commands::jira_get_watchers,
        jira::commands::jira_add_watcher,
        jira::commands::jira_list_projects,
        jira::commands::jira_get_project,
        jira::commands::jira_create_project,
        jira::commands::jira_delete_project,
        jira::commands::jira_get_project_statuses,
        jira::commands::jira_get_project_components,
        jira::commands::jira_get_project_versions,
        jira::commands::jira_list_comments,
        jira::commands::jira_get_comment,
        jira::commands::jira_add_comment,
        jira::commands::jira_update_comment,
        jira::commands::jira_delete_comment,
        jira::commands::jira_list_attachments,
        jira::commands::jira_get_attachment,
        jira::commands::jira_add_attachment,
        jira::commands::jira_delete_attachment,
        jira::commands::jira_list_worklogs,
        jira::commands::jira_get_worklog,
        jira::commands::jira_add_worklog,
        jira::commands::jira_update_worklog,
        jira::commands::jira_delete_worklog,
        jira::commands::jira_list_boards,
        jira::commands::jira_get_board,
        jira::commands::jira_get_board_issues,
        jira::commands::jira_get_board_backlog,
        jira::commands::jira_get_board_configuration,
        jira::commands::jira_list_sprints,
        jira::commands::jira_get_sprint,
        jira::commands::jira_create_sprint,
        jira::commands::jira_update_sprint,
        jira::commands::jira_delete_sprint,
        jira::commands::jira_get_sprint_issues,
        jira::commands::jira_move_issues_to_sprint,
        jira::commands::jira_start_sprint,
        jira::commands::jira_complete_sprint,
        jira::commands::jira_get_myself,
        jira::commands::jira_get_user,
        jira::commands::jira_search_users,
        jira::commands::jira_find_assignable_users,
        jira::commands::jira_list_fields,
        jira::commands::jira_get_all_issue_types,
        jira::commands::jira_get_priorities,
        jira::commands::jira_get_statuses,
        jira::commands::jira_get_resolutions,
        jira::commands::jira_list_dashboards,
        jira::commands::jira_get_dashboard,
        jira::commands::jira_get_filter,
        jira::commands::jira_get_favourite_filters,
        jira::commands::jira_get_my_filters,
        jira::commands::jira_create_filter,
        jira::commands::jira_update_filter,
        jira::commands::jira_delete_filter,
        // I18n commands
        i18n::commands::i18n_translate,
        i18n::commands::i18n_translate_plural,
        i18n::commands::i18n_translate_batch,
        i18n::commands::i18n_get_bundle,
        i18n::commands::i18n_get_namespace_bundle,
        i18n::commands::i18n_available_locales,
        i18n::commands::i18n_status,
        i18n::commands::i18n_detect_os_locale,
        i18n::commands::i18n_has_key,
        i18n::commands::i18n_missing_keys,
        i18n::commands::i18n_reload,
        i18n::commands::i18n_ssr_payload,
        i18n::commands::i18n_ssr_script,
        // Let's Encrypt / ACME certificate management
        letsencrypt::commands::le_get_status,
        letsencrypt::commands::le_start,
        letsencrypt::commands::le_stop,
        letsencrypt::commands::le_get_config,
        letsencrypt::commands::le_update_config,
        letsencrypt::commands::le_register_account,
        letsencrypt::commands::le_list_accounts,
        letsencrypt::commands::le_remove_account,
        letsencrypt::commands::le_request_certificate,
        letsencrypt::commands::le_renew_certificate,
        letsencrypt::commands::le_revoke_certificate,
        letsencrypt::commands::le_list_certificates,
        letsencrypt::commands::le_get_certificate,
        letsencrypt::commands::le_find_certificates_by_domain,
        letsencrypt::commands::le_remove_certificate,
        letsencrypt::commands::le_get_cert_paths,
        letsencrypt::commands::le_health_check,
        letsencrypt::commands::le_has_critical_issues,
        letsencrypt::commands::le_fetch_ocsp,
        letsencrypt::commands::le_get_ocsp_status,
        letsencrypt::commands::le_recent_events,
        letsencrypt::commands::le_drain_events,
        letsencrypt::commands::le_check_rate_limit,
        letsencrypt::commands::le_is_rate_limited,
        // SSH Agent management
        ssh_agent::commands::ssh_agent_get_status,
        ssh_agent::commands::ssh_agent_start,
        ssh_agent::commands::ssh_agent_stop,
        ssh_agent::commands::ssh_agent_restart,
        ssh_agent::commands::ssh_agent_get_config,
        ssh_agent::commands::ssh_agent_update_config,
        ssh_agent::commands::ssh_agent_list_keys,
        ssh_agent::commands::ssh_agent_add_key,
        ssh_agent::commands::ssh_agent_remove_key,
        ssh_agent::commands::ssh_agent_remove_all_keys,
        ssh_agent::commands::ssh_agent_lock,
        ssh_agent::commands::ssh_agent_unlock,
        ssh_agent::commands::ssh_agent_connect_system,
        ssh_agent::commands::ssh_agent_disconnect_system,
        ssh_agent::commands::ssh_agent_set_system_path,
        ssh_agent::commands::ssh_agent_discover_system,
        ssh_agent::commands::ssh_agent_start_forwarding,
        ssh_agent::commands::ssh_agent_stop_forwarding,
        ssh_agent::commands::ssh_agent_list_forwarding,
        ssh_agent::commands::ssh_agent_audit_log,
        ssh_agent::commands::ssh_agent_export_audit,
        ssh_agent::commands::ssh_agent_clear_audit,
        ssh_agent::commands::ssh_agent_run_maintenance,
        // SSH Agent PKCS#11 / Hardware key commands
        ssh_agent::commands::ssh_agent_load_pkcs11,
        ssh_agent::commands::ssh_agent_unload_pkcs11,
        ssh_agent::commands::ssh_agent_list_pkcs11_providers,
        ssh_agent::commands::ssh_agent_get_pkcs11_slots,
        ssh_agent::commands::ssh_agent_add_smartcard_key,
        ssh_agent::commands::ssh_agent_remove_smartcard_key,
        ssh_agent::commands::ssh_agent_list_security_keys,
        ssh_agent::commands::ssh_agent_add_security_key,
        ssh_agent::commands::ssh_agent_get_pending_confirm,
        ssh_agent::commands::ssh_agent_confirm_sign,
        ssh_agent::commands::ssh_agent_get_key_details,
        ssh_agent::commands::ssh_agent_update_key_comment,
        ssh_agent::commands::ssh_agent_update_key_constraints,
        ssh_agent::commands::ssh_agent_export_public_key,
        // GPG Agent commands
        gpg_agent::commands::gpg_get_status,
        gpg_agent::commands::gpg_start_agent,
        gpg_agent::commands::gpg_stop_agent,
        gpg_agent::commands::gpg_reload_agent,
        gpg_agent::commands::gpg_get_config,
        gpg_agent::commands::gpg_update_config,
        gpg_agent::commands::gpg_detect_environment,
        gpg_agent::commands::gpg_list_keys,
        gpg_agent::commands::gpg_get_key,
        gpg_agent::commands::gpg_generate_key,
        gpg_agent::commands::gpg_import_key,
        gpg_agent::commands::gpg_import_key_file,
        gpg_agent::commands::gpg_export_key,
        gpg_agent::commands::gpg_export_secret_key,
        gpg_agent::commands::gpg_delete_key,
        gpg_agent::commands::gpg_add_uid,
        gpg_agent::commands::gpg_revoke_uid,
        gpg_agent::commands::gpg_add_subkey,
        gpg_agent::commands::gpg_revoke_subkey,
        gpg_agent::commands::gpg_set_expiration,
        gpg_agent::commands::gpg_generate_revocation,
        gpg_agent::commands::gpg_sign_data,
        gpg_agent::commands::gpg_verify_signature,
        gpg_agent::commands::gpg_sign_key,
        gpg_agent::commands::gpg_encrypt_data,
        gpg_agent::commands::gpg_decrypt_data,
        gpg_agent::commands::gpg_set_owner_trust,
        gpg_agent::commands::gpg_trust_db_stats,
        gpg_agent::commands::gpg_update_trust_db,
        gpg_agent::commands::gpg_search_keyserver,
        gpg_agent::commands::gpg_fetch_from_keyserver,
        gpg_agent::commands::gpg_send_to_keyserver,
        gpg_agent::commands::gpg_refresh_keys,
        gpg_agent::commands::gpg_card_status,
        gpg_agent::commands::gpg_list_cards,
        gpg_agent::commands::gpg_card_change_pin,
        gpg_agent::commands::gpg_card_factory_reset,
        gpg_agent::commands::gpg_card_set_attribute,
        gpg_agent::commands::gpg_card_generate_key,
        gpg_agent::commands::gpg_card_move_key,
        gpg_agent::commands::gpg_card_fetch_key,
        gpg_agent::commands::gpg_audit_log,
        gpg_agent::commands::gpg_audit_export,
        gpg_agent::commands::gpg_audit_clear,
        // YubiKey commands
        yubikey::commands::yk_list_devices,
        yubikey::commands::yk_get_device_info,
        yubikey::commands::yk_wait_for_device,
        yubikey::commands::yk_get_diagnostics,
        yubikey::commands::yk_piv_list_certs,
        yubikey::commands::yk_piv_get_slot,
        yubikey::commands::yk_piv_generate_key,
        yubikey::commands::yk_piv_self_sign_cert,
        yubikey::commands::yk_piv_generate_csr,
        yubikey::commands::yk_piv_import_cert,
        yubikey::commands::yk_piv_import_key,
        yubikey::commands::yk_piv_export_cert,
        yubikey::commands::yk_piv_delete_cert,
        yubikey::commands::yk_piv_delete_key,
        yubikey::commands::yk_piv_attest,
        yubikey::commands::yk_piv_change_pin,
        yubikey::commands::yk_piv_change_puk,
        yubikey::commands::yk_piv_change_mgmt_key,
        yubikey::commands::yk_piv_unblock_pin,
        yubikey::commands::yk_piv_get_pin_status,
        yubikey::commands::yk_piv_reset,
        yubikey::commands::yk_piv_sign,
        yubikey::commands::yk_fido2_info,
        yubikey::commands::yk_fido2_list_credentials,
        yubikey::commands::yk_fido2_delete_credential,
        yubikey::commands::yk_fido2_set_pin,
        yubikey::commands::yk_fido2_change_pin,
        yubikey::commands::yk_fido2_pin_status,
        yubikey::commands::yk_fido2_reset,
        yubikey::commands::yk_fido2_toggle_always_uv,
        yubikey::commands::yk_fido2_list_rps,
        yubikey::commands::yk_oath_list,
        yubikey::commands::yk_oath_add,
        yubikey::commands::yk_oath_delete,
        yubikey::commands::yk_oath_rename,
        yubikey::commands::yk_oath_calculate,
        yubikey::commands::yk_oath_calculate_all,
        yubikey::commands::yk_oath_set_password,
        yubikey::commands::yk_oath_reset,
        yubikey::commands::yk_otp_info,
        yubikey::commands::yk_otp_configure_yubico,
        yubikey::commands::yk_otp_configure_chalresp,
        yubikey::commands::yk_otp_configure_static,
        yubikey::commands::yk_otp_configure_hotp,
        yubikey::commands::yk_otp_delete,
        yubikey::commands::yk_otp_swap,
        yubikey::commands::yk_config_set_interfaces,
        yubikey::commands::yk_config_lock,
        yubikey::commands::yk_config_unlock,
        yubikey::commands::yk_get_config,
        yubikey::commands::yk_update_config,
        yubikey::commands::yk_audit_log,
        yubikey::commands::yk_audit_export,
        yubikey::commands::yk_audit_clear,
        yubikey::commands::yk_factory_reset_all,
        yubikey::commands::yk_export_report,
        // Warpgate bastion host admin commands
        warpgate::commands::warpgate_connect,
        warpgate::commands::warpgate_disconnect,
        warpgate::commands::warpgate_list_connections,
        warpgate::commands::warpgate_ping,
        warpgate::commands::warpgate_list_targets,
        warpgate::commands::warpgate_create_target,
        warpgate::commands::warpgate_get_target,
        warpgate::commands::warpgate_update_target,
        warpgate::commands::warpgate_delete_target,
        warpgate::commands::warpgate_get_target_ssh_host_keys,
        warpgate::commands::warpgate_get_target_roles,
        warpgate::commands::warpgate_add_target_role,
        warpgate::commands::warpgate_remove_target_role,
        warpgate::commands::warpgate_list_target_groups,
        warpgate::commands::warpgate_create_target_group,
        warpgate::commands::warpgate_get_target_group,
        warpgate::commands::warpgate_update_target_group,
        warpgate::commands::warpgate_delete_target_group,
        warpgate::commands::warpgate_list_users,
        warpgate::commands::warpgate_create_user,
        warpgate::commands::warpgate_get_user,
        warpgate::commands::warpgate_update_user,
        warpgate::commands::warpgate_delete_user,
        warpgate::commands::warpgate_get_user_roles,
        warpgate::commands::warpgate_add_user_role,
        warpgate::commands::warpgate_remove_user_role,
        warpgate::commands::warpgate_unlink_user_ldap,
        warpgate::commands::warpgate_auto_link_user_ldap,
        warpgate::commands::warpgate_list_roles,
        warpgate::commands::warpgate_create_role,
        warpgate::commands::warpgate_get_role,
        warpgate::commands::warpgate_update_role,
        warpgate::commands::warpgate_delete_role,
        warpgate::commands::warpgate_get_role_targets,
        warpgate::commands::warpgate_get_role_users,
        warpgate::commands::warpgate_list_sessions,
        warpgate::commands::warpgate_get_session,
        warpgate::commands::warpgate_close_session,
        warpgate::commands::warpgate_close_all_sessions,
        warpgate::commands::warpgate_get_session_recordings,
        warpgate::commands::warpgate_get_recording,
        warpgate::commands::warpgate_get_recording_cast,
        warpgate::commands::warpgate_get_recording_tcpdump,
        warpgate::commands::warpgate_get_recording_kubernetes,
        warpgate::commands::warpgate_list_tickets,
        warpgate::commands::warpgate_create_ticket,
        warpgate::commands::warpgate_delete_ticket,
        warpgate::commands::warpgate_list_password_credentials,
        warpgate::commands::warpgate_create_password_credential,
        warpgate::commands::warpgate_delete_password_credential,
        warpgate::commands::warpgate_list_public_key_credentials,
        warpgate::commands::warpgate_create_public_key_credential,
        warpgate::commands::warpgate_update_public_key_credential,
        warpgate::commands::warpgate_delete_public_key_credential,
        warpgate::commands::warpgate_list_sso_credentials,
        warpgate::commands::warpgate_create_sso_credential,
        warpgate::commands::warpgate_update_sso_credential,
        warpgate::commands::warpgate_delete_sso_credential,
        warpgate::commands::warpgate_list_otp_credentials,
        warpgate::commands::warpgate_create_otp_credential,
        warpgate::commands::warpgate_delete_otp_credential,
        warpgate::commands::warpgate_list_certificate_credentials,
        warpgate::commands::warpgate_issue_certificate_credential,
        warpgate::commands::warpgate_update_certificate_credential,
        warpgate::commands::warpgate_revoke_certificate_credential,
        warpgate::commands::warpgate_get_ssh_own_keys,
        warpgate::commands::warpgate_list_known_hosts,
        warpgate::commands::warpgate_add_known_host,
        warpgate::commands::warpgate_delete_known_host,
        warpgate::commands::warpgate_check_ssh_host_key,
        warpgate::commands::warpgate_list_ldap_servers,
        warpgate::commands::warpgate_create_ldap_server,
        warpgate::commands::warpgate_get_ldap_server,
        warpgate::commands::warpgate_update_ldap_server,
        warpgate::commands::warpgate_delete_ldap_server,
        warpgate::commands::warpgate_test_ldap_connection,
        warpgate::commands::warpgate_get_ldap_users,
        warpgate::commands::warpgate_import_ldap_users,
        warpgate::commands::warpgate_query_logs,
        warpgate::commands::warpgate_get_parameters,
        warpgate::commands::warpgate_update_parameters,
        // OpenPubkey SSH (opkssh) commands
        opkssh::commands::opkssh_check_binary,
        opkssh::commands::opkssh_get_download_url,
        opkssh::commands::opkssh_login,
        opkssh::commands::opkssh_list_keys,
        opkssh::commands::opkssh_remove_key,
        opkssh::commands::opkssh_get_client_config,
        opkssh::commands::opkssh_update_client_config,
        opkssh::commands::opkssh_well_known_providers,
        opkssh::commands::opkssh_build_env_string,
        opkssh::commands::opkssh_server_read_config_script,
        opkssh::commands::opkssh_parse_server_config,
        opkssh::commands::opkssh_get_server_config,
        opkssh::commands::opkssh_build_add_identity_cmd,
        opkssh::commands::opkssh_build_remove_identity_cmd,
        opkssh::commands::opkssh_build_add_provider_cmd,
        opkssh::commands::opkssh_build_remove_provider_cmd,
        opkssh::commands::opkssh_build_install_cmd,
        opkssh::commands::opkssh_build_audit_cmd,
        opkssh::commands::opkssh_parse_audit_output,
        opkssh::commands::opkssh_get_audit_results,
        opkssh::commands::opkssh_get_status,
        // SSH event-scripts commands
        ssh_scripts::commands::ssh_scripts_create_script,
        ssh_scripts::commands::ssh_scripts_get_script,
        ssh_scripts::commands::ssh_scripts_list_scripts,
        ssh_scripts::commands::ssh_scripts_update_script,
        ssh_scripts::commands::ssh_scripts_delete_script,
        ssh_scripts::commands::ssh_scripts_duplicate_script,
        ssh_scripts::commands::ssh_scripts_toggle_script,
        ssh_scripts::commands::ssh_scripts_create_chain,
        ssh_scripts::commands::ssh_scripts_get_chain,
        ssh_scripts::commands::ssh_scripts_list_chains,
        ssh_scripts::commands::ssh_scripts_update_chain,
        ssh_scripts::commands::ssh_scripts_delete_chain,
        ssh_scripts::commands::ssh_scripts_toggle_chain,
        ssh_scripts::commands::ssh_scripts_run_script,
        ssh_scripts::commands::ssh_scripts_run_chain,
        ssh_scripts::commands::ssh_scripts_record_execution,
        ssh_scripts::commands::ssh_scripts_notify_event,
        ssh_scripts::commands::ssh_scripts_notify_output,
        ssh_scripts::commands::ssh_scripts_scheduler_tick,
        ssh_scripts::commands::ssh_scripts_register_session,
        ssh_scripts::commands::ssh_scripts_unregister_session,
        ssh_scripts::commands::ssh_scripts_query_history,
        ssh_scripts::commands::ssh_scripts_get_execution,
        ssh_scripts::commands::ssh_scripts_get_chain_execution,
        ssh_scripts::commands::ssh_scripts_get_script_stats,
        ssh_scripts::commands::ssh_scripts_get_all_stats,
        ssh_scripts::commands::ssh_scripts_clear_history,
        ssh_scripts::commands::ssh_scripts_clear_script_history,
        ssh_scripts::commands::ssh_scripts_list_timers,
        ssh_scripts::commands::ssh_scripts_list_session_timers,
        ssh_scripts::commands::ssh_scripts_pause_timer,
        ssh_scripts::commands::ssh_scripts_resume_timer,
        ssh_scripts::commands::ssh_scripts_list_by_tag,
        ssh_scripts::commands::ssh_scripts_list_by_category,
        ssh_scripts::commands::ssh_scripts_list_by_trigger,
        ssh_scripts::commands::ssh_scripts_get_tags,
        ssh_scripts::commands::ssh_scripts_get_categories,
        ssh_scripts::commands::ssh_scripts_export,
        ssh_scripts::commands::ssh_scripts_import,
        ssh_scripts::commands::ssh_scripts_bulk_enable,
        ssh_scripts::commands::ssh_scripts_bulk_delete,
        ssh_scripts::commands::ssh_scripts_get_summary,
        // MCP Server commands
        mcp_server::commands::mcp_get_status,
        mcp_server::commands::mcp_start_server,
        mcp_server::commands::mcp_stop_server,
        mcp_server::commands::mcp_get_config,
        mcp_server::commands::mcp_update_config,
        mcp_server::commands::mcp_generate_api_key,
        mcp_server::commands::mcp_list_sessions,
        mcp_server::commands::mcp_disconnect_session,
        mcp_server::commands::mcp_get_metrics,
        mcp_server::commands::mcp_get_tools,
        mcp_server::commands::mcp_get_resources,
        mcp_server::commands::mcp_get_prompts,
        mcp_server::commands::mcp_get_logs,
        mcp_server::commands::mcp_get_events,
        mcp_server::commands::mcp_get_tool_call_logs,
        mcp_server::commands::mcp_clear_logs,
        mcp_server::commands::mcp_reset_metrics,
        mcp_server::commands::mcp_handle_request,
        // SNMP commands
        snmp::commands::snmp_get,
        snmp::commands::snmp_get_next,
        snmp::commands::snmp_get_bulk,
        snmp::commands::snmp_set_value,
        snmp::commands::snmp_walk,
        snmp::commands::snmp_get_table,
        snmp::commands::snmp_get_if_table,
        snmp::commands::snmp_get_system_info,
        snmp::commands::snmp_get_interfaces,
        snmp::commands::snmp_discover,
        snmp::commands::snmp_start_trap_receiver,
        snmp::commands::snmp_stop_trap_receiver,
        snmp::commands::snmp_get_trap_receiver_status,
        snmp::commands::snmp_get_traps,
        snmp::commands::snmp_clear_traps,
        snmp::commands::snmp_mib_resolve_oid,
        snmp::commands::snmp_mib_resolve_name,
        snmp::commands::snmp_mib_search,
        snmp::commands::snmp_mib_load_text,
        snmp::commands::snmp_mib_get_subtree,
        snmp::commands::snmp_add_monitor,
        snmp::commands::snmp_remove_monitor,
        snmp::commands::snmp_start_monitor,
        snmp::commands::snmp_stop_monitor,
        snmp::commands::snmp_get_monitor_alerts,
        snmp::commands::snmp_acknowledge_alert,
        snmp::commands::snmp_clear_alerts,
        snmp::commands::snmp_add_target,
        snmp::commands::snmp_remove_target,
        snmp::commands::snmp_list_targets,
        snmp::commands::snmp_add_usm_user,
        snmp::commands::snmp_remove_usm_user,
        snmp::commands::snmp_list_usm_users,
        snmp::commands::snmp_add_device,
        snmp::commands::snmp_remove_device,
        snmp::commands::snmp_list_devices,
        snmp::commands::snmp_get_service_status,
        snmp::commands::snmp_bulk_get,
        snmp::commands::snmp_bulk_walk,
        // ── Dashboard ──────────────────────────────────────────────────
        dashboard::commands::dash_get_state,
        dashboard::commands::dash_get_health_summary,
        dashboard::commands::dash_get_quick_stats,
        dashboard::commands::dash_get_alerts,
        dashboard::commands::dash_acknowledge_alert,
        dashboard::commands::dash_get_connection_health,
        dashboard::commands::dash_get_all_health,
        dashboard::commands::dash_get_unhealthy,
        dashboard::commands::dash_get_sparkline,
        dashboard::commands::dash_get_widget_data,
        dashboard::commands::dash_start_monitoring,
        dashboard::commands::dash_stop_monitoring,
        dashboard::commands::dash_force_refresh,
        dashboard::commands::dash_get_config,
        dashboard::commands::dash_update_config,
        dashboard::commands::dash_get_layout,
        dashboard::commands::dash_update_layout,
        dashboard::commands::dash_get_heatmap,
        dashboard::commands::dash_get_recent,
        dashboard::commands::dash_get_top_latency,
        dashboard::commands::dash_check_connection,
        // ── Hooks ──────────────────────────────────────────────────────
        hooks::commands::hook_subscribe,
        hooks::commands::hook_unsubscribe,
        hooks::commands::hook_list_subscriptions,
        hooks::commands::hook_get_subscription,
        hooks::commands::hook_enable_subscription,
        hooks::commands::hook_disable_subscription,
        hooks::commands::hook_dispatch_event,
        hooks::commands::hook_get_recent_events,
        hooks::commands::hook_get_events_by_type,
        hooks::commands::hook_get_stats,
        hooks::commands::hook_clear_events,
        hooks::commands::hook_create_pipeline,
        hooks::commands::hook_delete_pipeline,
        hooks::commands::hook_list_pipelines,
        hooks::commands::hook_execute_pipeline,
        hooks::commands::hook_get_config,
        hooks::commands::hook_update_config,
        // ── Notifications ──────────────────────────────────────────────
        notifications::commands::notif_add_rule,
        notifications::commands::notif_remove_rule,
        notifications::commands::notif_list_rules,
        notifications::commands::notif_get_rule,
        notifications::commands::notif_enable_rule,
        notifications::commands::notif_disable_rule,
        notifications::commands::notif_update_rule,
        notifications::commands::notif_add_template,
        notifications::commands::notif_remove_template,
        notifications::commands::notif_list_templates,
        notifications::commands::notif_process_event,
        notifications::commands::notif_get_history,
        notifications::commands::notif_get_recent_history,
        notifications::commands::notif_clear_history,
        notifications::commands::notif_get_stats,
        notifications::commands::notif_get_config,
        notifications::commands::notif_update_config,
        notifications::commands::notif_test_channel,
        notifications::commands::notif_acknowledge_escalation,
        // ── Topology ───────────────────────────────────────────────────
        topology::commands::topo_build_from_connections,
        topology::commands::topo_get_graph,
        topology::commands::topo_add_node,
        topology::commands::topo_remove_node,
        topology::commands::topo_update_node,
        topology::commands::topo_add_edge,
        topology::commands::topo_remove_edge,
        topology::commands::topo_apply_layout,
        topology::commands::topo_get_blast_radius,
        topology::commands::topo_find_bottlenecks,
        topology::commands::topo_find_critical_edges,
        topology::commands::topo_get_path,
        topology::commands::topo_get_neighbors,
        topology::commands::topo_get_connected_components,
        topology::commands::topo_get_stats,
        topology::commands::topo_create_snapshot,
        topology::commands::topo_list_snapshots,
        topology::commands::topo_add_group,
        topology::commands::topo_remove_group,
        // ── Filters ────────────────────────────────────────────────────
        filters::commands::filter_create,
        filters::commands::filter_delete,
        filters::commands::filter_update,
        filters::commands::filter_get,
        filters::commands::filter_list,
        filters::commands::filter_evaluate,
        filters::commands::filter_get_presets,
        filters::commands::filter_create_smart_group,
        filters::commands::filter_delete_smart_group,
        filters::commands::filter_list_smart_groups,
        filters::commands::filter_update_smart_group,
        filters::commands::filter_evaluate_smart_group,
        filters::commands::filter_invalidate_cache,
        filters::commands::filter_get_stats,
        filters::commands::filter_get_config,
        filters::commands::filter_update_config,
        // ── Credentials ────────────────────────────────────────────────
        credentials::commands::cred_add,
        credentials::commands::cred_remove,
        credentials::commands::cred_update,
        credentials::commands::cred_get,
        credentials::commands::cred_list,
        credentials::commands::cred_record_rotation,
        credentials::commands::cred_check_expiry,
        credentials::commands::cred_check_all_expiries,
        credentials::commands::cred_get_stale,
        credentials::commands::cred_get_expiring_soon,
        credentials::commands::cred_get_expired,
        credentials::commands::cred_add_policy,
        credentials::commands::cred_remove_policy,
        credentials::commands::cred_list_policies,
        credentials::commands::cred_check_compliance,
        credentials::commands::cred_check_strength,
        credentials::commands::cred_detect_duplicates,
        credentials::commands::cred_create_group,
        credentials::commands::cred_delete_group,
        credentials::commands::cred_list_groups,
        credentials::commands::cred_add_to_group,
        credentials::commands::cred_remove_from_group,
        credentials::commands::cred_get_alerts,
        credentials::commands::cred_acknowledge_alert,
        credentials::commands::cred_generate_alerts,
        credentials::commands::cred_get_audit_log,
        credentials::commands::cred_get_stats,
        credentials::commands::cred_get_config,
        credentials::commands::cred_update_config,
        // ── Replay ─────────────────────────────────────────────────────
        replay::commands::replay_load_terminal,
        replay::commands::replay_load_video,
        replay::commands::replay_load_har,
        replay::commands::replay_play,
        replay::commands::replay_pause,
        replay::commands::replay_stop,
        replay::commands::replay_seek,
        replay::commands::replay_set_speed,
        replay::commands::replay_get_state,
        replay::commands::replay_get_position,
        replay::commands::replay_get_frame_at,
        replay::commands::replay_get_terminal_state_at,
        replay::commands::replay_advance_frame,
        replay::commands::replay_get_timeline,
        replay::commands::replay_get_markers,
        replay::commands::replay_get_heatmap,
        replay::commands::replay_search,
        replay::commands::replay_add_annotation,
        replay::commands::replay_remove_annotation,
        replay::commands::replay_list_annotations,
        replay::commands::replay_add_bookmark,
        replay::commands::replay_remove_bookmark,
        replay::commands::replay_list_bookmarks,
        replay::commands::replay_export,
        replay::commands::replay_get_stats,
        replay::commands::replay_get_config,
        replay::commands::replay_update_config,
        replay::commands::replay_get_har_waterfall,
        replay::commands::replay_get_har_stats,
        // ── RDP File ───────────────────────────────────────────────────
        rdpfile::commands::rdpfile_parse,
        rdpfile::commands::rdpfile_generate,
        rdpfile::commands::rdpfile_import,
        rdpfile::commands::rdpfile_export,
        rdpfile::commands::rdpfile_batch_export,
        rdpfile::commands::rdpfile_batch_import,
        rdpfile::commands::rdpfile_validate,
        // ── Updater ────────────────────────────────────────────────────
        updater::commands::updater_check,
        updater::commands::updater_download,
        updater::commands::updater_cancel_download,
        updater::commands::updater_install,
        updater::commands::updater_schedule_install,
        updater::commands::updater_get_status,
        updater::commands::updater_get_config,
        updater::commands::updater_update_config,
        updater::commands::updater_set_channel,
        updater::commands::updater_get_version_info,
        updater::commands::updater_get_history,
        updater::commands::updater_rollback,
        updater::commands::updater_get_rollbacks,
        updater::commands::updater_get_release_notes,
        // ── Marketplace ────────────────────────────────────────────────
        marketplace::commands::mkt_search,
        marketplace::commands::mkt_get_listing,
        marketplace::commands::mkt_get_categories,
        marketplace::commands::mkt_get_featured,
        marketplace::commands::mkt_get_popular,
        marketplace::commands::mkt_install,
        marketplace::commands::mkt_uninstall,
        marketplace::commands::mkt_update,
        marketplace::commands::mkt_get_installed,
        marketplace::commands::mkt_check_updates,
        marketplace::commands::mkt_refresh_repositories,
        marketplace::commands::mkt_add_repository,
        marketplace::commands::mkt_remove_repository,
        marketplace::commands::mkt_list_repositories,
        marketplace::commands::mkt_get_reviews,
        marketplace::commands::mkt_add_review,
        marketplace::commands::mkt_get_stats,
        marketplace::commands::mkt_get_config,
        marketplace::commands::mkt_update_config,
        marketplace::commands::mkt_validate_manifest,
        // ── Portable ───────────────────────────────────────────────────
        portable::commands::portable_detect_mode,
        portable::commands::portable_get_status,
        portable::commands::portable_get_paths,
        portable::commands::portable_get_config,
        portable::commands::portable_update_config,
        portable::commands::portable_migrate_to_portable,
        portable::commands::portable_migrate_to_installed,
        portable::commands::portable_create_marker,
        portable::commands::portable_remove_marker,
        portable::commands::portable_validate,
        portable::commands::portable_get_drive_info,
        // ── Scheduler ──────────────────────────────────────────────────
        scheduler::commands::sched_add_task,
        scheduler::commands::sched_remove_task,
        scheduler::commands::sched_update_task,
        scheduler::commands::sched_get_task,
        scheduler::commands::sched_list_tasks,
        scheduler::commands::sched_enable_task,
        scheduler::commands::sched_disable_task,
        scheduler::commands::sched_execute_now,
        scheduler::commands::sched_cancel_task,
        scheduler::commands::sched_get_history,
        scheduler::commands::sched_get_upcoming,
        scheduler::commands::sched_get_stats,
        scheduler::commands::sched_get_config,
        scheduler::commands::sched_update_config,
        scheduler::commands::sched_cleanup_history,
        scheduler::commands::sched_validate_cron,
        scheduler::commands::sched_get_next_occurrences,
        scheduler::commands::sched_pause_all,
        scheduler::commands::sched_resume_all,
        // ── LXD / Incus commands ─────────────────────────────────────
        lxd::commands::lxd_connect,
        lxd::commands::lxd_disconnect,
        lxd::commands::lxd_is_connected,
        // Server & Cluster
        lxd::commands::lxd_get_server,
        lxd::commands::lxd_get_server_resources,
        lxd::commands::lxd_update_server_config,
        lxd::commands::lxd_get_cluster,
        lxd::commands::lxd_list_cluster_members,
        lxd::commands::lxd_get_cluster_member,
        lxd::commands::lxd_evacuate_cluster_member,
        lxd::commands::lxd_restore_cluster_member,
        lxd::commands::lxd_remove_cluster_member,
        // Instances
        lxd::commands::lxd_list_instances,
        lxd::commands::lxd_list_containers,
        lxd::commands::lxd_list_virtual_machines,
        lxd::commands::lxd_get_instance,
        lxd::commands::lxd_get_instance_state,
        lxd::commands::lxd_create_instance,
        lxd::commands::lxd_update_instance,
        lxd::commands::lxd_patch_instance,
        lxd::commands::lxd_delete_instance,
        lxd::commands::lxd_rename_instance,
        lxd::commands::lxd_start_instance,
        lxd::commands::lxd_stop_instance,
        lxd::commands::lxd_restart_instance,
        lxd::commands::lxd_freeze_instance,
        lxd::commands::lxd_unfreeze_instance,
        lxd::commands::lxd_exec_instance,
        lxd::commands::lxd_console_instance,
        lxd::commands::lxd_clear_console_log,
        lxd::commands::lxd_list_instance_logs,
        lxd::commands::lxd_get_instance_log,
        lxd::commands::lxd_get_instance_file,
        lxd::commands::lxd_push_instance_file,
        lxd::commands::lxd_delete_instance_file,
        // Snapshots
        lxd::commands::lxd_list_snapshots,
        lxd::commands::lxd_get_snapshot,
        lxd::commands::lxd_create_snapshot,
        lxd::commands::lxd_delete_snapshot,
        lxd::commands::lxd_rename_snapshot,
        lxd::commands::lxd_restore_snapshot,
        // Backups
        lxd::commands::lxd_list_backups,
        lxd::commands::lxd_get_backup,
        lxd::commands::lxd_create_backup,
        lxd::commands::lxd_delete_backup,
        lxd::commands::lxd_rename_backup,
        // Images
        lxd::commands::lxd_list_images,
        lxd::commands::lxd_get_image,
        lxd::commands::lxd_get_image_alias,
        lxd::commands::lxd_create_image_alias,
        lxd::commands::lxd_delete_image_alias,
        lxd::commands::lxd_delete_image,
        lxd::commands::lxd_update_image,
        lxd::commands::lxd_copy_image_from_remote,
        lxd::commands::lxd_refresh_image,
        // Profiles
        lxd::commands::lxd_list_profiles,
        lxd::commands::lxd_get_profile,
        lxd::commands::lxd_create_profile,
        lxd::commands::lxd_update_profile,
        lxd::commands::lxd_patch_profile,
        lxd::commands::lxd_delete_profile,
        lxd::commands::lxd_rename_profile,
        // Networks
        lxd::commands::lxd_list_networks,
        lxd::commands::lxd_get_network,
        lxd::commands::lxd_create_network,
        lxd::commands::lxd_update_network,
        lxd::commands::lxd_patch_network,
        lxd::commands::lxd_delete_network,
        lxd::commands::lxd_rename_network,
        lxd::commands::lxd_get_network_state,
        lxd::commands::lxd_list_network_leases,
        lxd::commands::lxd_list_network_acls,
        lxd::commands::lxd_get_network_acl,
        lxd::commands::lxd_create_network_acl,
        lxd::commands::lxd_update_network_acl,
        lxd::commands::lxd_delete_network_acl,
        lxd::commands::lxd_list_network_forwards,
        lxd::commands::lxd_get_network_forward,
        lxd::commands::lxd_create_network_forward,
        lxd::commands::lxd_delete_network_forward,
        lxd::commands::lxd_list_network_zones,
        lxd::commands::lxd_get_network_zone,
        lxd::commands::lxd_delete_network_zone,
        lxd::commands::lxd_list_network_load_balancers,
        lxd::commands::lxd_get_network_load_balancer,
        lxd::commands::lxd_delete_network_load_balancer,
        lxd::commands::lxd_list_network_peers,
        // Storage
        lxd::commands::lxd_list_storage_pools,
        lxd::commands::lxd_get_storage_pool,
        lxd::commands::lxd_create_storage_pool,
        lxd::commands::lxd_update_storage_pool,
        lxd::commands::lxd_delete_storage_pool,
        lxd::commands::lxd_get_storage_pool_resources,
        lxd::commands::lxd_list_storage_volumes,
        lxd::commands::lxd_list_custom_volumes,
        lxd::commands::lxd_get_storage_volume,
        lxd::commands::lxd_create_storage_volume,
        lxd::commands::lxd_update_storage_volume,
        lxd::commands::lxd_delete_storage_volume,
        lxd::commands::lxd_rename_storage_volume,
        lxd::commands::lxd_list_volume_snapshots,
        lxd::commands::lxd_create_volume_snapshot,
        lxd::commands::lxd_delete_volume_snapshot,
        lxd::commands::lxd_list_storage_buckets,
        lxd::commands::lxd_get_storage_bucket,
        lxd::commands::lxd_create_storage_bucket,
        lxd::commands::lxd_delete_storage_bucket,
        lxd::commands::lxd_list_bucket_keys,
        // Projects
        lxd::commands::lxd_list_projects,
        lxd::commands::lxd_get_project,
        lxd::commands::lxd_create_project,
        lxd::commands::lxd_update_project,
        lxd::commands::lxd_patch_project,
        lxd::commands::lxd_delete_project,
        lxd::commands::lxd_rename_project,
        // Certificates
        lxd::commands::lxd_list_certificates,
        lxd::commands::lxd_get_certificate,
        lxd::commands::lxd_add_certificate,
        lxd::commands::lxd_delete_certificate,
        lxd::commands::lxd_update_certificate,
        // Operations
        lxd::commands::lxd_list_operations,
        lxd::commands::lxd_get_operation,
        lxd::commands::lxd_cancel_operation,
        lxd::commands::lxd_wait_operation,
        // Warnings
        lxd::commands::lxd_list_warnings,
        lxd::commands::lxd_get_warning,
        lxd::commands::lxd_acknowledge_warning,
        lxd::commands::lxd_delete_warning,
        // Migration / Copy / Publish
        lxd::commands::lxd_migrate_instance,
        lxd::commands::lxd_copy_instance,
        lxd::commands::lxd_publish_instance,
        // VMware Desktop (Player / Workstation / Fusion)
        vmware_desktop::commands::vmwd_connect,
        vmware_desktop::commands::vmwd_disconnect,
        vmware_desktop::commands::vmwd_is_connected,
        vmware_desktop::commands::vmwd_connection_summary,
        vmware_desktop::commands::vmwd_host_info,
        // VMs
        vmware_desktop::commands::vmwd_list_vms,
        vmware_desktop::commands::vmwd_get_vm,
        vmware_desktop::commands::vmwd_create_vm,
        vmware_desktop::commands::vmwd_update_vm,
        vmware_desktop::commands::vmwd_delete_vm,
        vmware_desktop::commands::vmwd_clone_vm,
        vmware_desktop::commands::vmwd_register_vm,
        vmware_desktop::commands::vmwd_unregister_vm,
        vmware_desktop::commands::vmwd_configure_nic,
        vmware_desktop::commands::vmwd_remove_nic,
        vmware_desktop::commands::vmwd_configure_cdrom,
        // Power
        vmware_desktop::commands::vmwd_start_vm,
        vmware_desktop::commands::vmwd_stop_vm,
        vmware_desktop::commands::vmwd_reset_vm,
        vmware_desktop::commands::vmwd_suspend_vm,
        vmware_desktop::commands::vmwd_pause_vm,
        vmware_desktop::commands::vmwd_unpause_vm,
        vmware_desktop::commands::vmwd_get_power_state,
        vmware_desktop::commands::vmwd_batch_power,
        // Snapshots
        vmware_desktop::commands::vmwd_list_snapshots,
        vmware_desktop::commands::vmwd_get_snapshot_tree,
        vmware_desktop::commands::vmwd_create_snapshot,
        vmware_desktop::commands::vmwd_delete_snapshot,
        vmware_desktop::commands::vmwd_revert_to_snapshot,
        vmware_desktop::commands::vmwd_get_snapshot,
        // Guest operations
        vmware_desktop::commands::vmwd_exec_in_guest,
        vmware_desktop::commands::vmwd_run_script_in_guest,
        vmware_desktop::commands::vmwd_copy_to_guest,
        vmware_desktop::commands::vmwd_copy_from_guest,
        vmware_desktop::commands::vmwd_create_directory_in_guest,
        vmware_desktop::commands::vmwd_delete_directory_in_guest,
        vmware_desktop::commands::vmwd_delete_file_in_guest,
        vmware_desktop::commands::vmwd_file_exists_in_guest,
        vmware_desktop::commands::vmwd_directory_exists_in_guest,
        vmware_desktop::commands::vmwd_rename_file_in_guest,
        vmware_desktop::commands::vmwd_list_directory_in_guest,
        vmware_desktop::commands::vmwd_list_processes_in_guest,
        vmware_desktop::commands::vmwd_kill_process_in_guest,
        vmware_desktop::commands::vmwd_read_variable,
        vmware_desktop::commands::vmwd_write_variable,
        vmware_desktop::commands::vmwd_list_env_vars,
        vmware_desktop::commands::vmwd_get_tools_status,
        vmware_desktop::commands::vmwd_install_tools,
        vmware_desktop::commands::vmwd_get_ip_address,
        // Shared folders
        vmware_desktop::commands::vmwd_enable_shared_folders,
        vmware_desktop::commands::vmwd_disable_shared_folders,
        vmware_desktop::commands::vmwd_list_shared_folders,
        vmware_desktop::commands::vmwd_add_shared_folder,
        vmware_desktop::commands::vmwd_remove_shared_folder,
        vmware_desktop::commands::vmwd_set_shared_folder_state,
        // Networking
        vmware_desktop::commands::vmwd_list_networks,
        vmware_desktop::commands::vmwd_get_network,
        vmware_desktop::commands::vmwd_create_network,
        vmware_desktop::commands::vmwd_update_network,
        vmware_desktop::commands::vmwd_delete_network,
        vmware_desktop::commands::vmwd_list_port_forwards,
        vmware_desktop::commands::vmwd_set_port_forward,
        vmware_desktop::commands::vmwd_delete_port_forward,
        vmware_desktop::commands::vmwd_get_dhcp_leases,
        vmware_desktop::commands::vmwd_read_networking_config,
        // VMDK
        vmware_desktop::commands::vmwd_create_vmdk,
        vmware_desktop::commands::vmwd_get_vmdk_info,
        vmware_desktop::commands::vmwd_defragment_vmdk,
        vmware_desktop::commands::vmwd_shrink_vmdk,
        vmware_desktop::commands::vmwd_expand_vmdk,
        vmware_desktop::commands::vmwd_convert_vmdk,
        vmware_desktop::commands::vmwd_rename_vmdk,
        vmware_desktop::commands::vmwd_add_disk_to_vm,
        vmware_desktop::commands::vmwd_remove_disk_from_vm,
        vmware_desktop::commands::vmwd_list_vm_disks,
        // OVF
        vmware_desktop::commands::vmwd_import_ovf,
        vmware_desktop::commands::vmwd_export_ovf,
        // VMX
        vmware_desktop::commands::vmwd_parse_vmx,
        vmware_desktop::commands::vmwd_update_vmx_keys,
        vmware_desktop::commands::vmwd_remove_vmx_keys,
        vmware_desktop::commands::vmwd_discover_vmx_files,
        // Preferences
        vmware_desktop::commands::vmwd_read_preferences,
        vmware_desktop::commands::vmwd_get_default_vm_dir,
        vmware_desktop::commands::vmwd_set_preference,
        // Nginx
        nginx::commands::ngx_connect,
        nginx::commands::ngx_disconnect,
        nginx::commands::ngx_list_connections,
        nginx::commands::ngx_list_sites,
        nginx::commands::ngx_get_site,
        nginx::commands::ngx_create_site,
        nginx::commands::ngx_update_site,
        nginx::commands::ngx_delete_site,
        nginx::commands::ngx_enable_site,
        nginx::commands::ngx_disable_site,
        nginx::commands::ngx_list_upstreams,
        nginx::commands::ngx_get_upstream,
        nginx::commands::ngx_create_upstream,
        nginx::commands::ngx_update_upstream,
        nginx::commands::ngx_delete_upstream,
        nginx::commands::ngx_get_ssl_config,
        nginx::commands::ngx_update_ssl_config,
        nginx::commands::ngx_list_ssl_certificates,
        nginx::commands::ngx_stub_status,
        nginx::commands::ngx_process_status,
        nginx::commands::ngx_health_check,
        nginx::commands::ngx_query_access_log,
        nginx::commands::ngx_query_error_log,
        nginx::commands::ngx_list_log_files,
        nginx::commands::ngx_get_main_config,
        nginx::commands::ngx_update_main_config,
        nginx::commands::ngx_test_config,
        nginx::commands::ngx_list_snippets,
        nginx::commands::ngx_get_snippet,
        nginx::commands::ngx_create_snippet,
        nginx::commands::ngx_update_snippet,
        nginx::commands::ngx_delete_snippet,
        nginx::commands::ngx_start,
        nginx::commands::ngx_stop,
        nginx::commands::ngx_restart,
        nginx::commands::ngx_reload,
        nginx::commands::ngx_version,
        nginx::commands::ngx_info,
        // Traefik
        traefik::commands::traefik_connect,
        traefik::commands::traefik_disconnect,
        traefik::commands::traefik_list_connections,
        traefik::commands::traefik_ping,
        traefik::commands::traefik_list_http_routers,
        traefik::commands::traefik_get_http_router,
        traefik::commands::traefik_list_tcp_routers,
        traefik::commands::traefik_get_tcp_router,
        traefik::commands::traefik_list_udp_routers,
        traefik::commands::traefik_get_udp_router,
        traefik::commands::traefik_list_http_services,
        traefik::commands::traefik_get_http_service,
        traefik::commands::traefik_list_tcp_services,
        traefik::commands::traefik_get_tcp_service,
        traefik::commands::traefik_list_udp_services,
        traefik::commands::traefik_get_udp_service,
        traefik::commands::traefik_list_http_middlewares,
        traefik::commands::traefik_get_http_middleware,
        traefik::commands::traefik_list_tcp_middlewares,
        traefik::commands::traefik_get_tcp_middleware,
        traefik::commands::traefik_list_entrypoints,
        traefik::commands::traefik_get_entrypoint,
        traefik::commands::traefik_list_tls_certificates,
        traefik::commands::traefik_get_tls_certificate,
        traefik::commands::traefik_get_overview,
        traefik::commands::traefik_get_version,
        traefik::commands::traefik_get_raw_config,
        // HAProxy
        haproxy::commands::haproxy_connect,
        haproxy::commands::haproxy_disconnect,
        haproxy::commands::haproxy_list_connections,
        haproxy::commands::haproxy_ping,
        haproxy::commands::haproxy_get_info,
        haproxy::commands::haproxy_get_csv,
        haproxy::commands::haproxy_list_frontends,
        haproxy::commands::haproxy_get_frontend,
        haproxy::commands::haproxy_list_backends,
        haproxy::commands::haproxy_get_backend,
        haproxy::commands::haproxy_list_servers,
        haproxy::commands::haproxy_get_server,
        haproxy::commands::haproxy_set_server_state,
        haproxy::commands::haproxy_list_acls,
        haproxy::commands::haproxy_get_acl,
        haproxy::commands::haproxy_add_acl_entry,
        haproxy::commands::haproxy_del_acl_entry,
        haproxy::commands::haproxy_clear_acl,
        haproxy::commands::haproxy_list_maps,
        haproxy::commands::haproxy_get_map,
        haproxy::commands::haproxy_add_map_entry,
        haproxy::commands::haproxy_del_map_entry,
        haproxy::commands::haproxy_set_map_entry,
        haproxy::commands::haproxy_clear_map,
        haproxy::commands::haproxy_list_stick_tables,
        haproxy::commands::haproxy_get_stick_table,
        haproxy::commands::haproxy_clear_stick_table,
        haproxy::commands::haproxy_set_stick_table_entry,
        haproxy::commands::haproxy_runtime_execute,
        haproxy::commands::haproxy_show_servers_state,
        haproxy::commands::haproxy_show_sessions,
        haproxy::commands::haproxy_show_backend_list,
        haproxy::commands::haproxy_get_raw_config,
        haproxy::commands::haproxy_update_raw_config,
        haproxy::commands::haproxy_validate_config,
        haproxy::commands::haproxy_reload,
        haproxy::commands::haproxy_start,
        haproxy::commands::haproxy_stop,
        haproxy::commands::haproxy_restart,
        haproxy::commands::haproxy_version,
        // Apache
        apache::commands::apache_connect,
        apache::commands::apache_disconnect,
        apache::commands::apache_list_connections,
        apache::commands::apache_ping,
        apache::commands::apache_list_vhosts,
        apache::commands::apache_get_vhost,
        apache::commands::apache_create_vhost,
        apache::commands::apache_update_vhost,
        apache::commands::apache_delete_vhost,
        apache::commands::apache_enable_vhost,
        apache::commands::apache_disable_vhost,
        apache::commands::apache_list_modules,
        apache::commands::apache_list_available_modules,
        apache::commands::apache_list_enabled_modules,
        apache::commands::apache_enable_module,
        apache::commands::apache_disable_module,
        apache::commands::apache_get_ssl_config,
        apache::commands::apache_list_ssl_certificates,
        apache::commands::apache_get_status,
        apache::commands::apache_process_status,
        apache::commands::apache_query_access_log,
        apache::commands::apache_query_error_log,
        apache::commands::apache_list_log_files,
        apache::commands::apache_get_main_config,
        apache::commands::apache_update_main_config,
        apache::commands::apache_test_config,
        apache::commands::apache_list_conf_available,
        apache::commands::apache_list_conf_enabled,
        apache::commands::apache_enable_conf,
        apache::commands::apache_disable_conf,
        apache::commands::apache_start,
        apache::commands::apache_stop,
        apache::commands::apache_restart,
        apache::commands::apache_reload,
        apache::commands::apache_version,
        apache::commands::apache_info,
        // Caddy
        caddy::commands::caddy_connect,
        caddy::commands::caddy_disconnect,
        caddy::commands::caddy_list_connections,
        caddy::commands::caddy_ping,
        caddy::commands::caddy_get_full_config,
        caddy::commands::caddy_get_raw_config,
        caddy::commands::caddy_get_config_path,
        caddy::commands::caddy_set_config_path,
        caddy::commands::caddy_patch_config_path,
        caddy::commands::caddy_delete_config_path,
        caddy::commands::caddy_load_config,
        caddy::commands::caddy_adapt_caddyfile,
        caddy::commands::caddy_stop_server,
        caddy::commands::caddy_list_servers,
        caddy::commands::caddy_get_server,
        caddy::commands::caddy_set_server,
        caddy::commands::caddy_delete_server,
        caddy::commands::caddy_list_routes,
        caddy::commands::caddy_get_route,
        caddy::commands::caddy_add_route,
        caddy::commands::caddy_set_route,
        caddy::commands::caddy_delete_route,
        caddy::commands::caddy_set_all_routes,
        caddy::commands::caddy_get_tls_app,
        caddy::commands::caddy_set_tls_app,
        caddy::commands::caddy_list_automate_domains,
        caddy::commands::caddy_set_automate_domains,
        caddy::commands::caddy_get_tls_automation,
        caddy::commands::caddy_set_tls_automation,
        caddy::commands::caddy_list_tls_certificates,
        caddy::commands::caddy_create_reverse_proxy,
        caddy::commands::caddy_get_upstreams,
        caddy::commands::caddy_create_file_server,
        caddy::commands::caddy_create_redirect,
        // Nginx Proxy Manager
        nginx_proxy_mgr::commands::npm_connect,
        nginx_proxy_mgr::commands::npm_disconnect,
        nginx_proxy_mgr::commands::npm_list_connections,
        nginx_proxy_mgr::commands::npm_ping,
        nginx_proxy_mgr::commands::npm_list_proxy_hosts,
        nginx_proxy_mgr::commands::npm_get_proxy_host,
        nginx_proxy_mgr::commands::npm_create_proxy_host,
        nginx_proxy_mgr::commands::npm_update_proxy_host,
        nginx_proxy_mgr::commands::npm_delete_proxy_host,
        nginx_proxy_mgr::commands::npm_enable_proxy_host,
        nginx_proxy_mgr::commands::npm_disable_proxy_host,
        nginx_proxy_mgr::commands::npm_list_redirection_hosts,
        nginx_proxy_mgr::commands::npm_get_redirection_host,
        nginx_proxy_mgr::commands::npm_create_redirection_host,
        nginx_proxy_mgr::commands::npm_update_redirection_host,
        nginx_proxy_mgr::commands::npm_delete_redirection_host,
        nginx_proxy_mgr::commands::npm_list_dead_hosts,
        nginx_proxy_mgr::commands::npm_get_dead_host,
        nginx_proxy_mgr::commands::npm_create_dead_host,
        nginx_proxy_mgr::commands::npm_update_dead_host,
        nginx_proxy_mgr::commands::npm_delete_dead_host,
        nginx_proxy_mgr::commands::npm_list_streams,
        nginx_proxy_mgr::commands::npm_get_stream,
        nginx_proxy_mgr::commands::npm_create_stream,
        nginx_proxy_mgr::commands::npm_update_stream,
        nginx_proxy_mgr::commands::npm_delete_stream,
        nginx_proxy_mgr::commands::npm_list_certificates,
        nginx_proxy_mgr::commands::npm_get_certificate,
        nginx_proxy_mgr::commands::npm_create_letsencrypt_certificate,
        nginx_proxy_mgr::commands::npm_upload_custom_certificate,
        nginx_proxy_mgr::commands::npm_delete_certificate,
        nginx_proxy_mgr::commands::npm_renew_certificate,
        nginx_proxy_mgr::commands::npm_validate_certificate,
        nginx_proxy_mgr::commands::npm_list_users,
        nginx_proxy_mgr::commands::npm_get_user,
        nginx_proxy_mgr::commands::npm_create_user,
        nginx_proxy_mgr::commands::npm_update_user,
        nginx_proxy_mgr::commands::npm_delete_user,
        nginx_proxy_mgr::commands::npm_change_user_password,
        nginx_proxy_mgr::commands::npm_get_me,
        nginx_proxy_mgr::commands::npm_list_access_lists,
        nginx_proxy_mgr::commands::npm_get_access_list,
        nginx_proxy_mgr::commands::npm_create_access_list,
        nginx_proxy_mgr::commands::npm_update_access_list,
        nginx_proxy_mgr::commands::npm_delete_access_list,
        nginx_proxy_mgr::commands::npm_list_settings,
        nginx_proxy_mgr::commands::npm_get_setting,
        nginx_proxy_mgr::commands::npm_update_setting,
        nginx_proxy_mgr::commands::npm_get_reports,
        nginx_proxy_mgr::commands::npm_get_audit_log,
        nginx_proxy_mgr::commands::npm_get_health,
        // DDNS commands
        ddns::commands::ddns_list_profiles,
        ddns::commands::ddns_get_profile,
        ddns::commands::ddns_create_profile,
        ddns::commands::ddns_update_profile,
        ddns::commands::ddns_delete_profile,
        ddns::commands::ddns_enable_profile,
        ddns::commands::ddns_disable_profile,
        ddns::commands::ddns_trigger_update,
        ddns::commands::ddns_trigger_update_all,
        ddns::commands::ddns_detect_ip,
        ddns::commands::ddns_get_current_ips,
        ddns::commands::ddns_start_scheduler,
        ddns::commands::ddns_stop_scheduler,
        ddns::commands::ddns_get_scheduler_status,
        ddns::commands::ddns_get_profile_health,
        ddns::commands::ddns_get_all_health,
        ddns::commands::ddns_get_system_status,
        ddns::commands::ddns_list_providers,
        ddns::commands::ddns_get_provider_capabilities,
        ddns::commands::ddns_cf_list_zones,
        ddns::commands::ddns_cf_list_records,
        ddns::commands::ddns_cf_create_record,
        ddns::commands::ddns_cf_delete_record,
        ddns::commands::ddns_get_config,
        ddns::commands::ddns_update_config,
        ddns::commands::ddns_get_audit_log,
        ddns::commands::ddns_get_audit_for_profile,
        ddns::commands::ddns_export_audit,
        ddns::commands::ddns_clear_audit,
        ddns::commands::ddns_export_profiles,
        ddns::commands::ddns_import_profiles,
        ddns::commands::ddns_process_scheduled,
        // Postfix
    ]
}
