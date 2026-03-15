use crate::*;

pub fn is_command(command: &str) -> bool {
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
            // Windows Management (WMI/WinRM)
            | "winmgmt_connect"
            | "winmgmt_disconnect"
            | "winmgmt_disconnect_all"
            | "winmgmt_list_sessions"
            | "winmgmt_get_config"
            | "winmgmt_set_config"
            | "winmgmt_raw_query"
            | "winmgmt_list_services"
            | "winmgmt_get_service"
            | "winmgmt_search_services"
            | "winmgmt_start_service"
            | "winmgmt_stop_service"
            | "winmgmt_restart_service"
            | "winmgmt_pause_service"
            | "winmgmt_resume_service"
            | "winmgmt_set_service_start_mode"
            | "winmgmt_delete_service"
            | "winmgmt_services_by_state"
            | "winmgmt_get_service_dependencies"
            | "winmgmt_list_event_logs"
            | "winmgmt_query_events"
            | "winmgmt_recent_events"
            | "winmgmt_error_events"
            | "winmgmt_events_by_source"
            | "winmgmt_clear_event_log"
            | "winmgmt_backup_event_log"
            | "winmgmt_event_statistics"
            | "winmgmt_export_events_csv"
            | "winmgmt_export_events_json"
            | "winmgmt_list_processes"
            | "winmgmt_get_process"
            | "winmgmt_processes_by_name"
            | "winmgmt_search_processes"
            | "winmgmt_create_process"
            | "winmgmt_terminate_process"
            | "winmgmt_terminate_by_name"
            | "winmgmt_set_process_priority"
            | "winmgmt_get_process_owner"
            | "winmgmt_process_tree"
            | "winmgmt_process_statistics"
            | "winmgmt_perf_snapshot"
            | "winmgmt_perf_cpu"
            | "winmgmt_perf_memory"
            | "winmgmt_perf_disks"
            | "winmgmt_perf_network"
            | "winmgmt_perf_quick_health"
            | "winmgmt_registry_enum_keys"
            | "winmgmt_registry_enum_values"
            | "winmgmt_registry_get_value"
            | "winmgmt_registry_get_key_info"
            | "winmgmt_registry_set_string"
            | "winmgmt_registry_set_dword"
            | "winmgmt_registry_create_key"
            | "winmgmt_registry_delete_key"
            | "winmgmt_registry_delete_value"
            | "winmgmt_registry_key_exists"
            | "winmgmt_registry_set_qword"
            | "winmgmt_registry_set_multi_string"
            | "winmgmt_registry_set_binary"
            | "winmgmt_registry_set_expand_string"
            | "winmgmt_registry_recursive_enum"
            | "winmgmt_registry_recursive_delete"
            | "winmgmt_registry_search"
            | "winmgmt_registry_export"
            | "winmgmt_registry_import"
            | "winmgmt_registry_snapshot"
            | "winmgmt_registry_compare"
            | "winmgmt_registry_bulk_set"
            | "winmgmt_registry_copy_key"
            | "winmgmt_registry_rename_value"
            | "winmgmt_registry_get_security"
            | "winmgmt_registry_check_access"
            | "winmgmt_list_tasks"
            | "winmgmt_get_task"
            | "winmgmt_search_tasks"
            | "winmgmt_enable_task"
            | "winmgmt_disable_task"
            | "winmgmt_run_task"
            | "winmgmt_stop_task"
            | "winmgmt_system_info"
            | "winmgmt_quick_summary"
            | "winmgmt_os_info"
            | "winmgmt_processors_info"
            | "winmgmt_logical_disks"
            | "winmgmt_network_adapters"
            | "winmgmt_list_shadow_copies"
            | "winmgmt_get_shadow_copy"
            | "winmgmt_shadow_copies_by_volume"
            | "winmgmt_create_shadow_copy"
            | "winmgmt_delete_shadow_copy"
            | "winmgmt_list_shadow_storage"
            | "winmgmt_backup_get_status"
            | "winmgmt_backup_list_versions"
            | "winmgmt_backup_get_policy"
            | "winmgmt_backup_get_items"
            | "winmgmt_backup_start"
            | "winmgmt_backup_start_restore"
            | "winmgmt_backup_list_volumes"
    )
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
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
        // Windows Management (WMI/WinRM)
        winmgmt_commands::winmgmt_connect,
        winmgmt_commands::winmgmt_disconnect,
        winmgmt_commands::winmgmt_disconnect_all,
        winmgmt_commands::winmgmt_list_sessions,
        winmgmt_commands::winmgmt_get_config,
        winmgmt_commands::winmgmt_set_config,
        winmgmt_commands::winmgmt_raw_query,
        winmgmt_commands::winmgmt_list_services,
        winmgmt_commands::winmgmt_get_service,
        winmgmt_commands::winmgmt_search_services,
        winmgmt_commands::winmgmt_start_service,
        winmgmt_commands::winmgmt_stop_service,
        winmgmt_commands::winmgmt_restart_service,
        winmgmt_commands::winmgmt_pause_service,
        winmgmt_commands::winmgmt_resume_service,
        winmgmt_commands::winmgmt_set_service_start_mode,
        winmgmt_commands::winmgmt_delete_service,
        winmgmt_commands::winmgmt_services_by_state,
        winmgmt_commands::winmgmt_get_service_dependencies,
        winmgmt_commands::winmgmt_list_event_logs,
        winmgmt_commands::winmgmt_query_events,
        winmgmt_commands::winmgmt_recent_events,
        winmgmt_commands::winmgmt_error_events,
        winmgmt_commands::winmgmt_events_by_source,
        winmgmt_commands::winmgmt_clear_event_log,
        winmgmt_commands::winmgmt_backup_event_log,
        winmgmt_commands::winmgmt_event_statistics,
        winmgmt_commands::winmgmt_export_events_csv,
        winmgmt_commands::winmgmt_export_events_json,
        winmgmt_commands::winmgmt_list_processes,
        winmgmt_commands::winmgmt_get_process,
        winmgmt_commands::winmgmt_processes_by_name,
        winmgmt_commands::winmgmt_search_processes,
        winmgmt_commands::winmgmt_create_process,
        winmgmt_commands::winmgmt_terminate_process,
        winmgmt_commands::winmgmt_terminate_by_name,
        winmgmt_commands::winmgmt_set_process_priority,
        winmgmt_commands::winmgmt_get_process_owner,
        winmgmt_commands::winmgmt_process_tree,
        winmgmt_commands::winmgmt_process_statistics,
        winmgmt_commands::winmgmt_perf_snapshot,
        winmgmt_commands::winmgmt_perf_cpu,
        winmgmt_commands::winmgmt_perf_memory,
        winmgmt_commands::winmgmt_perf_disks,
        winmgmt_commands::winmgmt_perf_network,
        winmgmt_commands::winmgmt_perf_quick_health,
        winmgmt_commands::winmgmt_registry_enum_keys,
        winmgmt_commands::winmgmt_registry_enum_values,
        winmgmt_commands::winmgmt_registry_get_value,
        winmgmt_commands::winmgmt_registry_get_key_info,
        winmgmt_commands::winmgmt_registry_set_string,
        winmgmt_commands::winmgmt_registry_set_dword,
        winmgmt_commands::winmgmt_registry_create_key,
        winmgmt_commands::winmgmt_registry_delete_key,
        winmgmt_commands::winmgmt_registry_delete_value,
        winmgmt_commands::winmgmt_registry_key_exists,
        winmgmt_commands::winmgmt_registry_set_qword,
        winmgmt_commands::winmgmt_registry_set_multi_string,
        winmgmt_commands::winmgmt_registry_set_binary,
        winmgmt_commands::winmgmt_registry_set_expand_string,
        winmgmt_commands::winmgmt_registry_recursive_enum,
        winmgmt_commands::winmgmt_registry_recursive_delete,
        winmgmt_commands::winmgmt_registry_search,
        winmgmt_commands::winmgmt_registry_export,
        winmgmt_commands::winmgmt_registry_import,
        winmgmt_commands::winmgmt_registry_snapshot,
        winmgmt_commands::winmgmt_registry_compare,
        winmgmt_commands::winmgmt_registry_bulk_set,
        winmgmt_commands::winmgmt_registry_copy_key,
        winmgmt_commands::winmgmt_registry_rename_value,
        winmgmt_commands::winmgmt_registry_get_security,
        winmgmt_commands::winmgmt_registry_check_access,
        winmgmt_commands::winmgmt_list_tasks,
        winmgmt_commands::winmgmt_get_task,
        winmgmt_commands::winmgmt_search_tasks,
        winmgmt_commands::winmgmt_enable_task,
        winmgmt_commands::winmgmt_disable_task,
        winmgmt_commands::winmgmt_run_task,
        winmgmt_commands::winmgmt_stop_task,
        winmgmt_commands::winmgmt_system_info,
        winmgmt_commands::winmgmt_quick_summary,
        winmgmt_commands::winmgmt_os_info,
        winmgmt_commands::winmgmt_processors_info,
        winmgmt_commands::winmgmt_logical_disks,
        winmgmt_commands::winmgmt_network_adapters,
        winmgmt_commands::winmgmt_list_shadow_copies,
        winmgmt_commands::winmgmt_get_shadow_copy,
        winmgmt_commands::winmgmt_shadow_copies_by_volume,
        winmgmt_commands::winmgmt_create_shadow_copy,
        winmgmt_commands::winmgmt_delete_shadow_copy,
        winmgmt_commands::winmgmt_list_shadow_storage,
        winmgmt_commands::winmgmt_backup_get_status,
        winmgmt_commands::winmgmt_backup_list_versions,
        winmgmt_commands::winmgmt_backup_get_policy,
        winmgmt_commands::winmgmt_backup_get_items,
        winmgmt_commands::winmgmt_backup_start,
        winmgmt_commands::winmgmt_backup_start_restore,
        winmgmt_commands::winmgmt_backup_list_volumes,
    ]
}
