use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "postfix_connect"
            | "postfix_disconnect"
            | "postfix_list_connections"
            | "postfix_ping"
            | "postfix_get_main_cf"
            | "postfix_get_param"
            | "postfix_set_param"
            | "postfix_delete_param"
            | "postfix_get_master_cf"
            | "postfix_update_master_cf"
            | "postfix_check_config"
            | "postfix_get_maps"
            | "postfix_get_map_entries"
            | "postfix_set_map_entry"
            | "postfix_delete_map_entry"
            | "postfix_rebuild_map"
            | "postfix_list_domains"
            | "postfix_get_domain"
            | "postfix_create_domain"
            | "postfix_update_domain"
            | "postfix_delete_domain"
            | "postfix_list_aliases"
            | "postfix_get_alias"
            | "postfix_create_alias"
            | "postfix_update_alias"
            | "postfix_delete_alias"
            | "postfix_list_virtual_aliases"
            | "postfix_list_local_aliases"
            | "postfix_list_transports"
            | "postfix_get_transport"
            | "postfix_create_transport"
            | "postfix_update_transport"
            | "postfix_delete_transport"
            | "postfix_test_transport"
            | "postfix_list_queues"
            | "postfix_list_queue_entries"
            | "postfix_get_queue_entry"
            | "postfix_flush"
            | "postfix_flush_queue"
            | "postfix_delete_queue_entry"
            | "postfix_hold_queue_entry"
            | "postfix_release_queue_entry"
            | "postfix_delete_all_queued"
            | "postfix_requeue_all"
            | "postfix_purge_queues"
            | "postfix_get_tls_config"
            | "postfix_set_tls_param"
            | "postfix_list_tls_policies"
            | "postfix_set_tls_policy"
            | "postfix_delete_tls_policy"
            | "postfix_check_certificate"
            | "postfix_list_restrictions"
            | "postfix_get_restrictions"
            | "postfix_set_restrictions"
            | "postfix_add_restriction"
            | "postfix_remove_restriction"
            | "postfix_list_milters"
            | "postfix_add_milter"
            | "postfix_remove_milter"
            | "postfix_update_milter"
            | "postfix_start"
            | "postfix_stop"
            | "postfix_restart"
            | "postfix_reload"
            | "postfix_status"
            | "postfix_version"
            | "postfix_info"
            | "postfix_query_mail_log"
            | "postfix_list_log_files"
            | "postfix_get_statistics"
            | "dovecot_connect"
            | "dovecot_disconnect"
            | "dovecot_list_connections"
            | "dovecot_ping"
            | "dovecot_list_mailboxes"
            | "dovecot_mailbox_status"
            | "dovecot_create_mailbox"
            | "dovecot_delete_mailbox"
            | "dovecot_rename_mailbox"
            | "dovecot_subscribe_mailbox"
            | "dovecot_unsubscribe_mailbox"
            | "dovecot_list_subscriptions"
            | "dovecot_sync_mailbox"
            | "dovecot_force_resync"
            | "dovecot_list_users"
            | "dovecot_get_user"
            | "dovecot_create_user"
            | "dovecot_update_user"
            | "dovecot_delete_user"
            | "dovecot_auth_test"
            | "dovecot_kick_user"
            | "dovecot_who"
            | "dovecot_list_sieve"
            | "dovecot_get_sieve"
            | "dovecot_create_sieve"
            | "dovecot_update_sieve"
            | "dovecot_delete_sieve"
            | "dovecot_activate_sieve"
            | "dovecot_deactivate_sieve"
            | "dovecot_compile_sieve"
            | "dovecot_get_quota"
            | "dovecot_set_quota"
            | "dovecot_recalculate_quota"
            | "dovecot_list_quota_rules"
            | "dovecot_set_quota_rule"
            | "dovecot_delete_quota_rule"
            | "dovecot_get_config"
            | "dovecot_get_config_param"
            | "dovecot_set_config_param"
            | "dovecot_list_namespaces"
            | "dovecot_get_namespace"
            | "dovecot_list_plugins"
            | "dovecot_enable_plugin"
            | "dovecot_disable_plugin"
            | "dovecot_configure_plugin"
            | "dovecot_get_auth_config"
            | "dovecot_list_services"
            | "dovecot_test_config"
            | "dovecot_list_acls"
            | "dovecot_get_acl"
            | "dovecot_set_acl"
            | "dovecot_delete_acl"
            | "dovecot_replication_status"
            | "dovecot_replicate_user"
            | "dovecot_dsync_backup"
            | "dovecot_dsync_mirror"
            | "dovecot_start"
            | "dovecot_stop"
            | "dovecot_restart"
            | "dovecot_reload"
            | "dovecot_status"
            | "dovecot_version"
            | "dovecot_info"
            | "dovecot_process_who"
            | "dovecot_process_stats"
            | "dovecot_process_test_config"
            | "dovecot_query_log"
            | "dovecot_list_log_files"
            | "dovecot_set_log_level"
            | "dovecot_get_log_level"
            | "dkim_connect"
            | "dkim_disconnect"
            | "dkim_list_connections"
            | "dkim_ping"
            | "dkim_list_keys"
            | "dkim_get_key"
            | "dkim_generate_key"
            | "dkim_rotate_key"
            | "dkim_delete_key"
            | "dkim_get_dns_record"
            | "dkim_verify_dns"
            | "dkim_export_public_key"
            | "dkim_list_signing_table"
            | "dkim_get_signing_entry"
            | "dkim_add_signing_entry"
            | "dkim_update_signing_entry"
            | "dkim_remove_signing_entry"
            | "dkim_rebuild_signing_table"
            | "dkim_list_key_table"
            | "dkim_get_key_entry"
            | "dkim_add_key_entry"
            | "dkim_update_key_entry"
            | "dkim_remove_key_entry"
            | "dkim_rebuild_key_table"
            | "dkim_list_trusted_hosts"
            | "dkim_add_trusted_host"
            | "dkim_remove_trusted_host"
            | "dkim_list_internal_hosts"
            | "dkim_add_internal_host"
            | "dkim_remove_internal_host"
            | "dkim_get_config"
            | "dkim_get_config_param"
            | "dkim_set_config_param"
            | "dkim_delete_config_param"
            | "dkim_test_config"
            | "dkim_get_mode"
            | "dkim_set_mode"
            | "dkim_get_socket"
            | "dkim_set_socket"
            | "dkim_get_stats"
            | "dkim_reset_stats"
            | "dkim_get_last_messages"
            | "dkim_start"
            | "dkim_stop"
            | "dkim_restart"
            | "dkim_reload"
            | "dkim_status"
            | "dkim_version"
            | "dkim_info"
            | "sasl_connect"
            | "sasl_disconnect"
            | "sasl_list_connections"
            | "sasl_ping"
            | "sasl_list_mechanisms"
            | "sasl_get_mechanism"
            | "sasl_list_available_mechanisms"
            | "sasl_list_enabled_mechanisms"
            | "sasl_enable_mechanism"
            | "sasl_disable_mechanism"
            | "sasl_list_users"
            | "sasl_get_user"
            | "sasl_create_user"
            | "sasl_update_user"
            | "sasl_delete_user"
            | "sasl_test_auth"
            | "sasl_list_realms"
            | "sasl_get_saslauthd_config"
            | "sasl_set_saslauthd_config"
            | "sasl_get_saslauthd_status"
            | "sasl_start_saslauthd"
            | "sasl_stop_saslauthd"
            | "sasl_restart_saslauthd"
            | "sasl_set_saslauthd_mechanism"
            | "sasl_set_saslauthd_flags"
            | "sasl_test_saslauthd_auth"
            | "sasl_list_apps"
            | "sasl_get_app_config"
            | "sasl_set_app_config"
            | "sasl_delete_app_config"
            | "sasl_get_app_param"
            | "sasl_set_app_param"
            | "sasl_delete_app_param"
            | "sasl_list_auxprop"
            | "sasl_get_auxprop"
            | "sasl_configure_auxprop"
            | "sasl_test_auxprop"
            | "sasl_list_db_entries"
            | "sasl_get_db_entry"
            | "sasl_set_db_password"
            | "sasl_delete_db_entry"
            | "sasl_dump_db"
            | "sasl_import_db"
            | "sasl_start"
            | "sasl_stop"
            | "sasl_restart"
            | "sasl_reload"
            | "sasl_status"
            | "sasl_version"
            | "sasl_info"
            | "sasl_test_config"
            | "procmail_connect"
            | "procmail_disconnect"
            | "procmail_list_connections"
            | "procmail_list_recipes"
            | "procmail_get_recipe"
            | "procmail_create_recipe"
            | "procmail_update_recipe"
            | "procmail_delete_recipe"
            | "procmail_enable_recipe"
            | "procmail_disable_recipe"
            | "procmail_reorder_recipe"
            | "procmail_test_recipe"
            | "procmail_list_rules"
            | "procmail_get_rule"
            | "procmail_create_rule"
            | "procmail_update_rule"
            | "procmail_delete_rule"
            | "procmail_enable_rule"
            | "procmail_disable_rule"
            | "procmail_list_variables"
            | "procmail_get_variable"
            | "procmail_set_variable"
            | "procmail_delete_variable"
            | "procmail_list_includes"
            | "procmail_add_include"
            | "procmail_remove_include"
            | "procmail_enable_include"
            | "procmail_disable_include"
            | "procmail_get_config"
            | "procmail_set_config"
            | "procmail_backup_config"
            | "procmail_restore_config"
            | "procmail_validate_config"
            | "procmail_get_raw_config"
            | "procmail_set_raw_config"
            | "procmail_query_log"
            | "procmail_list_log_files"
            | "procmail_clear_log"
            | "procmail_get_log_path"
            | "procmail_set_log_path"
            | "spam_connect"
            | "spam_disconnect"
            | "spam_list_connections"
            | "spam_ping"
            | "spam_list_rules"
            | "spam_get_rule"
            | "spam_list_scores"
            | "spam_set_score"
            | "spam_create_custom_rule"
            | "spam_delete_custom_rule"
            | "spam_enable_rule"
            | "spam_disable_rule"
            | "spam_list_custom_rules"
            | "spam_get_rule_description"
            | "spam_bayes_status"
            | "spam_learn_spam"
            | "spam_learn_ham"
            | "spam_learn_spam_folder"
            | "spam_learn_ham_folder"
            | "spam_bayes_forget"
            | "spam_bayes_clear"
            | "spam_bayes_sync"
            | "spam_bayes_backup"
            | "spam_bayes_restore"
            | "spam_list_channels"
            | "spam_update_all_channels"
            | "spam_update_channel"
            | "spam_add_channel"
            | "spam_remove_channel"
            | "spam_list_channel_keys"
            | "spam_import_channel_key"
            | "spam_list_whitelist"
            | "spam_add_whitelist"
            | "spam_remove_whitelist"
            | "spam_list_trusted_networks"
            | "spam_add_trusted_network"
            | "spam_remove_trusted_network"
            | "spam_list_plugins"
            | "spam_get_plugin"
            | "spam_enable_plugin"
            | "spam_disable_plugin"
            | "spam_configure_plugin"
            | "spam_get_plugin_config"
            | "spam_get_local_cf"
            | "spam_set_local_cf"
            | "spam_get_param"
            | "spam_set_param"
            | "spam_delete_param"
            | "spam_get_spamd_config"
            | "spam_set_spamd_config"
            | "spam_test_config"
            | "spam_check_message"
            | "spam_check_file"
            | "spam_report_message"
            | "spam_revoke_message"
            | "spam_start"
            | "spam_stop"
            | "spam_restart"
            | "spam_reload"
            | "spam_status"
            | "spam_version"
            | "spam_info"
            | "spam_lint"
            | "spam_query_log"
            | "spam_list_log_files"
            | "spam_get_statistics"
            | "rspamd_connect"
            | "rspamd_disconnect"
            | "rspamd_list_connections"
            | "rspamd_ping"
            | "rspamd_check_message"
            | "rspamd_check_file"
            | "rspamd_learn_spam"
            | "rspamd_learn_ham"
            | "rspamd_fuzzy_add"
            | "rspamd_fuzzy_delete"
            | "rspamd_get_stats"
            | "rspamd_get_graph"
            | "rspamd_get_throughput"
            | "rspamd_reset_stats"
            | "rspamd_get_errors"
            | "rspamd_list_symbols"
            | "rspamd_get_symbol"
            | "rspamd_list_symbol_groups"
            | "rspamd_get_symbol_group"
            | "rspamd_list_actions"
            | "rspamd_get_action"
            | "rspamd_set_action"
            | "rspamd_enable_action"
            | "rspamd_disable_action"
            | "rspamd_list_maps"
            | "rspamd_get_map"
            | "rspamd_get_map_entries"
            | "rspamd_save_map_entries"
            | "rspamd_add_map_entry"
            | "rspamd_remove_map_entry"
            | "rspamd_get_history"
            | "rspamd_get_history_entry"
            | "rspamd_reset_history"
            | "rspamd_list_workers"
            | "rspamd_get_worker"
            | "rspamd_list_neighbours"
            | "rspamd_fuzzy_status"
            | "rspamd_fuzzy_check"
            | "rspamd_get_actions_config"
            | "rspamd_get_plugins"
            | "rspamd_enable_plugin"
            | "rspamd_disable_plugin"
            | "rspamd_reload_config"
            | "rspamd_save_actions_config"
            | "clamav_connect"
            | "clamav_disconnect"
            | "clamav_list_connections"
            | "clamav_ping"
            | "clamav_scan"
            | "clamav_quick_scan"
            | "clamav_scan_stream"
            | "clamav_multiscan"
            | "clamav_contscan"
            | "clamav_allmatchscan"
            | "clamav_list_databases"
            | "clamav_update_databases"
            | "clamav_update_database"
            | "clamav_check_update"
            | "clamav_get_mirrors"
            | "clamav_add_mirror"
            | "clamav_remove_mirror"
            | "clamav_get_db_version"
            | "clamav_list_quarantine"
            | "clamav_get_quarantine_entry"
            | "clamav_restore_quarantine"
            | "clamav_delete_quarantine"
            | "clamav_delete_all_quarantine"
            | "clamav_get_quarantine_stats"
            | "clamav_get_clamd_config"
            | "clamav_get_clamd_param"
            | "clamav_set_clamd_param"
            | "clamav_delete_clamd_param"
            | "clamav_get_socket"
            | "clamav_set_socket"
            | "clamav_test_clamd_config"
            | "clamav_get_freshclam_config"
            | "clamav_get_freshclam_param"
            | "clamav_set_freshclam_param"
            | "clamav_delete_freshclam_param"
            | "clamav_get_update_interval"
            | "clamav_set_update_interval"
            | "clamav_get_on_access_config"
            | "clamav_set_on_access_config"
            | "clamav_enable_on_access"
            | "clamav_disable_on_access"
            | "clamav_add_on_access_path"
            | "clamav_remove_on_access_path"
            | "clamav_get_milter_config"
            | "clamav_set_milter_config"
            | "clamav_enable_milter"
            | "clamav_disable_milter"
            | "clamav_list_scheduled_scans"
            | "clamav_get_scheduled_scan"
            | "clamav_create_scheduled_scan"
            | "clamav_update_scheduled_scan"
            | "clamav_delete_scheduled_scan"
            | "clamav_enable_scheduled_scan"
            | "clamav_disable_scheduled_scan"
            | "clamav_run_scheduled_scan"
            | "clamav_start_clamd"
            | "clamav_stop_clamd"
            | "clamav_restart_clamd"
            | "clamav_reload_clamd"
            | "clamav_clamd_status"
            | "clamav_start_freshclam"
            | "clamav_stop_freshclam"
            | "clamav_restart_freshclam"
            | "clamav_version"
            | "clamav_info"
            | "rc_connect"
            | "rc_disconnect"
            | "rc_list_connections"
            | "rc_ping"
            | "rc_list_users"
            | "rc_get_user"
            | "rc_create_user"
            | "rc_update_user"
            | "rc_delete_user"
            | "rc_get_user_preferences"
            | "rc_update_user_preferences"
            | "rc_list_identities"
            | "rc_get_identity"
            | "rc_create_identity"
            | "rc_update_identity"
            | "rc_delete_identity"
            | "rc_set_default_identity"
            | "rc_list_address_books"
            | "rc_get_address_book"
            | "rc_list_contacts"
            | "rc_get_contact"
            | "rc_create_contact"
            | "rc_update_contact"
            | "rc_delete_contact"
            | "rc_search_contacts"
            | "rc_export_vcard"
            | "rc_list_folders"
            | "rc_get_folder"
            | "rc_create_folder"
            | "rc_rename_folder"
            | "rc_delete_folder"
            | "rc_subscribe_folder"
            | "rc_unsubscribe_folder"
            | "rc_purge_folder"
            | "rc_get_quota"
            | "rc_list_filters"
            | "rc_get_filter"
            | "rc_create_filter"
            | "rc_update_filter"
            | "rc_delete_filter"
            | "rc_enable_filter"
            | "rc_disable_filter"
            | "rc_reorder_filters"
            | "rc_list_plugins"
            | "rc_get_plugin"
            | "rc_enable_plugin"
            | "rc_disable_plugin"
            | "rc_get_plugin_config"
            | "rc_update_plugin_config"
            | "rc_get_system_config"
            | "rc_update_system_config"
            | "rc_get_smtp_config"
            | "rc_update_smtp_config"
            | "rc_get_cache_stats"
            | "rc_clear_cache"
            | "rc_get_logs"
            | "rc_vacuum_db"
            | "rc_optimize_db"
            | "rc_clear_temp_files"
            | "rc_clear_expired_sessions"
            | "rc_get_db_stats"
            | "rc_test_smtp"
            | "rc_test_imap"
            | "mailcow_connect"
            | "mailcow_disconnect"
            | "mailcow_list_connections"
            | "mailcow_ping"
            | "mailcow_list_domains"
            | "mailcow_get_domain"
            | "mailcow_create_domain"
            | "mailcow_update_domain"
            | "mailcow_delete_domain"
            | "mailcow_list_mailboxes"
            | "mailcow_list_mailboxes_by_domain"
            | "mailcow_get_mailbox"
            | "mailcow_create_mailbox"
            | "mailcow_update_mailbox"
            | "mailcow_delete_mailbox"
            | "mailcow_quarantine_notifications"
            | "mailcow_pushover_setup"
            | "mailcow_list_aliases"
            | "mailcow_get_alias"
            | "mailcow_create_alias"
            | "mailcow_update_alias"
            | "mailcow_delete_alias"
            | "mailcow_get_dkim"
            | "mailcow_generate_dkim"
            | "mailcow_delete_dkim"
            | "mailcow_duplicate_dkim"
            | "mailcow_list_domain_aliases"
            | "mailcow_get_domain_alias"
            | "mailcow_create_domain_alias"
            | "mailcow_update_domain_alias"
            | "mailcow_delete_domain_alias"
            | "mailcow_list_transport_maps"
            | "mailcow_get_transport_map"
            | "mailcow_create_transport_map"
            | "mailcow_update_transport_map"
            | "mailcow_delete_transport_map"
            | "mailcow_get_queue_summary"
            | "mailcow_list_queue"
            | "mailcow_flush_queue"
            | "mailcow_delete_queue_item"
            | "mailcow_super_delete_queue"
            | "mailcow_list_quarantine"
            | "mailcow_get_quarantine"
            | "mailcow_release_quarantine"
            | "mailcow_delete_quarantine"
            | "mailcow_whitelist_sender"
            | "mailcow_get_quarantine_settings"
            | "mailcow_update_quarantine_settings"
            | "mailcow_get_logs"
            | "mailcow_get_api_logs"
            | "mailcow_get_container_status"
            | "mailcow_get_solr_status"
            | "mailcow_get_system_status"
            | "mailcow_get_rspamd_stats"
            | "mailcow_get_fail2ban_config"
            | "mailcow_update_fail2ban_config"
            | "mailcow_get_rate_limits"
            | "mailcow_set_rate_limit"
            | "mailcow_delete_rate_limit"
            | "mailcow_list_app_passwords"
            | "mailcow_create_app_password"
            | "mailcow_delete_app_password"
            | "mailcow_list_resources"
            | "mailcow_get_resource"
            | "mailcow_create_resource"
            | "mailcow_update_resource"
            | "mailcow_delete_resource"
            | "amavis_connect"
            | "amavis_disconnect"
            | "amavis_list_connections"
            | "amavis_ping"
            | "amavis_get_main_config"
            | "amavis_update_main_config"
            | "amavis_list_snippets"
            | "amavis_get_snippet"
            | "amavis_create_snippet"
            | "amavis_update_snippet"
            | "amavis_delete_snippet"
            | "amavis_enable_snippet"
            | "amavis_disable_snippet"
            | "amavis_test_config"
            | "amavis_list_policy_banks"
            | "amavis_get_policy_bank"
            | "amavis_create_policy_bank"
            | "amavis_update_policy_bank"
            | "amavis_delete_policy_bank"
            | "amavis_activate_policy_bank"
            | "amavis_deactivate_policy_bank"
            | "amavis_list_banned_rules"
            | "amavis_get_banned_rule"
            | "amavis_create_banned_rule"
            | "amavis_update_banned_rule"
            | "amavis_delete_banned_rule"
            | "amavis_test_filename"
            | "amavis_list_entries"
            | "amavis_get_list_entry"
            | "amavis_add_list_entry"
            | "amavis_update_list_entry"
            | "amavis_remove_list_entry"
            | "amavis_check_sender"
            | "amavis_list_quarantine"
            | "amavis_get_quarantine"
            | "amavis_release_quarantine"
            | "amavis_delete_quarantine"
            | "amavis_release_all_quarantine"
            | "amavis_delete_all_quarantine"
            | "amavis_get_quarantine_stats"
            | "amavis_get_stats"
            | "amavis_get_child_processes"
            | "amavis_get_throughput"
            | "amavis_reset_stats"
            | "amavis_start"
            | "amavis_stop"
            | "amavis_restart"
            | "amavis_reload"
            | "amavis_process_status"
            | "amavis_version"
            | "amavis_debug_sa"
            | "amavis_show_config"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        postfix_commands::postfix_connect,
        postfix_commands::postfix_disconnect,
        postfix_commands::postfix_list_connections,
        postfix_commands::postfix_ping,
        postfix_commands::postfix_get_main_cf,
        postfix_commands::postfix_get_param,
        postfix_commands::postfix_set_param,
        postfix_commands::postfix_delete_param,
        postfix_commands::postfix_get_master_cf,
        postfix_commands::postfix_update_master_cf,
        postfix_commands::postfix_check_config,
        postfix_commands::postfix_get_maps,
        postfix_commands::postfix_get_map_entries,
        postfix_commands::postfix_set_map_entry,
        postfix_commands::postfix_delete_map_entry,
        postfix_commands::postfix_rebuild_map,
        postfix_commands::postfix_list_domains,
        postfix_commands::postfix_get_domain,
        postfix_commands::postfix_create_domain,
        postfix_commands::postfix_update_domain,
        postfix_commands::postfix_delete_domain,
        postfix_commands::postfix_list_aliases,
        postfix_commands::postfix_get_alias,
        postfix_commands::postfix_create_alias,
        postfix_commands::postfix_update_alias,
        postfix_commands::postfix_delete_alias,
        postfix_commands::postfix_list_virtual_aliases,
        postfix_commands::postfix_list_local_aliases,
        postfix_commands::postfix_list_transports,
        postfix_commands::postfix_get_transport,
        postfix_commands::postfix_create_transport,
        postfix_commands::postfix_update_transport,
        postfix_commands::postfix_delete_transport,
        postfix_commands::postfix_test_transport,
        postfix_commands::postfix_list_queues,
        postfix_commands::postfix_list_queue_entries,
        postfix_commands::postfix_get_queue_entry,
        postfix_commands::postfix_flush,
        postfix_commands::postfix_flush_queue,
        postfix_commands::postfix_delete_queue_entry,
        postfix_commands::postfix_hold_queue_entry,
        postfix_commands::postfix_release_queue_entry,
        postfix_commands::postfix_delete_all_queued,
        postfix_commands::postfix_requeue_all,
        postfix_commands::postfix_purge_queues,
        postfix_commands::postfix_get_tls_config,
        postfix_commands::postfix_set_tls_param,
        postfix_commands::postfix_list_tls_policies,
        postfix_commands::postfix_set_tls_policy,
        postfix_commands::postfix_delete_tls_policy,
        postfix_commands::postfix_check_certificate,
        postfix_commands::postfix_list_restrictions,
        postfix_commands::postfix_get_restrictions,
        postfix_commands::postfix_set_restrictions,
        postfix_commands::postfix_add_restriction,
        postfix_commands::postfix_remove_restriction,
        postfix_commands::postfix_list_milters,
        postfix_commands::postfix_add_milter,
        postfix_commands::postfix_remove_milter,
        postfix_commands::postfix_update_milter,
        postfix_commands::postfix_start,
        postfix_commands::postfix_stop,
        postfix_commands::postfix_restart,
        postfix_commands::postfix_reload,
        postfix_commands::postfix_status,
        postfix_commands::postfix_version,
        postfix_commands::postfix_info,
        postfix_commands::postfix_query_mail_log,
        postfix_commands::postfix_list_log_files,
        postfix_commands::postfix_get_statistics,
        // Dovecot
        dovecot_commands::dovecot_connect,
        dovecot_commands::dovecot_disconnect,
        dovecot_commands::dovecot_list_connections,
        dovecot_commands::dovecot_ping,
        dovecot_commands::dovecot_list_mailboxes,
        dovecot_commands::dovecot_mailbox_status,
        dovecot_commands::dovecot_create_mailbox,
        dovecot_commands::dovecot_delete_mailbox,
        dovecot_commands::dovecot_rename_mailbox,
        dovecot_commands::dovecot_subscribe_mailbox,
        dovecot_commands::dovecot_unsubscribe_mailbox,
        dovecot_commands::dovecot_list_subscriptions,
        dovecot_commands::dovecot_sync_mailbox,
        dovecot_commands::dovecot_force_resync,
        dovecot_commands::dovecot_list_users,
        dovecot_commands::dovecot_get_user,
        dovecot_commands::dovecot_create_user,
        dovecot_commands::dovecot_update_user,
        dovecot_commands::dovecot_delete_user,
        dovecot_commands::dovecot_auth_test,
        dovecot_commands::dovecot_kick_user,
        dovecot_commands::dovecot_who,
        dovecot_commands::dovecot_list_sieve,
        dovecot_commands::dovecot_get_sieve,
        dovecot_commands::dovecot_create_sieve,
        dovecot_commands::dovecot_update_sieve,
        dovecot_commands::dovecot_delete_sieve,
        dovecot_commands::dovecot_activate_sieve,
        dovecot_commands::dovecot_deactivate_sieve,
        dovecot_commands::dovecot_compile_sieve,
        dovecot_commands::dovecot_get_quota,
        dovecot_commands::dovecot_set_quota,
        dovecot_commands::dovecot_recalculate_quota,
        dovecot_commands::dovecot_list_quota_rules,
        dovecot_commands::dovecot_set_quota_rule,
        dovecot_commands::dovecot_delete_quota_rule,
        dovecot_commands::dovecot_get_config,
        dovecot_commands::dovecot_get_config_param,
        dovecot_commands::dovecot_set_config_param,
        dovecot_commands::dovecot_list_namespaces,
        dovecot_commands::dovecot_get_namespace,
        dovecot_commands::dovecot_list_plugins,
        dovecot_commands::dovecot_enable_plugin,
        dovecot_commands::dovecot_disable_plugin,
        dovecot_commands::dovecot_configure_plugin,
        dovecot_commands::dovecot_get_auth_config,
        dovecot_commands::dovecot_list_services,
        dovecot_commands::dovecot_test_config,
        dovecot_commands::dovecot_list_acls,
        dovecot_commands::dovecot_get_acl,
        dovecot_commands::dovecot_set_acl,
        dovecot_commands::dovecot_delete_acl,
        dovecot_commands::dovecot_replication_status,
        dovecot_commands::dovecot_replicate_user,
        dovecot_commands::dovecot_dsync_backup,
        dovecot_commands::dovecot_dsync_mirror,
        dovecot_commands::dovecot_start,
        dovecot_commands::dovecot_stop,
        dovecot_commands::dovecot_restart,
        dovecot_commands::dovecot_reload,
        dovecot_commands::dovecot_status,
        dovecot_commands::dovecot_version,
        dovecot_commands::dovecot_info,
        dovecot_commands::dovecot_process_who,
        dovecot_commands::dovecot_process_stats,
        dovecot_commands::dovecot_process_test_config,
        dovecot_commands::dovecot_query_log,
        dovecot_commands::dovecot_list_log_files,
        dovecot_commands::dovecot_set_log_level,
        dovecot_commands::dovecot_get_log_level,
        // OpenDKIM
        opendkim_commands::dkim_connect,
        opendkim_commands::dkim_disconnect,
        opendkim_commands::dkim_list_connections,
        opendkim_commands::dkim_ping,
        opendkim_commands::dkim_list_keys,
        opendkim_commands::dkim_get_key,
        opendkim_commands::dkim_generate_key,
        opendkim_commands::dkim_rotate_key,
        opendkim_commands::dkim_delete_key,
        opendkim_commands::dkim_get_dns_record,
        opendkim_commands::dkim_verify_dns,
        opendkim_commands::dkim_export_public_key,
        opendkim_commands::dkim_list_signing_table,
        opendkim_commands::dkim_get_signing_entry,
        opendkim_commands::dkim_add_signing_entry,
        opendkim_commands::dkim_update_signing_entry,
        opendkim_commands::dkim_remove_signing_entry,
        opendkim_commands::dkim_rebuild_signing_table,
        opendkim_commands::dkim_list_key_table,
        opendkim_commands::dkim_get_key_entry,
        opendkim_commands::dkim_add_key_entry,
        opendkim_commands::dkim_update_key_entry,
        opendkim_commands::dkim_remove_key_entry,
        opendkim_commands::dkim_rebuild_key_table,
        opendkim_commands::dkim_list_trusted_hosts,
        opendkim_commands::dkim_add_trusted_host,
        opendkim_commands::dkim_remove_trusted_host,
        opendkim_commands::dkim_list_internal_hosts,
        opendkim_commands::dkim_add_internal_host,
        opendkim_commands::dkim_remove_internal_host,
        opendkim_commands::dkim_get_config,
        opendkim_commands::dkim_get_config_param,
        opendkim_commands::dkim_set_config_param,
        opendkim_commands::dkim_delete_config_param,
        opendkim_commands::dkim_test_config,
        opendkim_commands::dkim_get_mode,
        opendkim_commands::dkim_set_mode,
        opendkim_commands::dkim_get_socket,
        opendkim_commands::dkim_set_socket,
        opendkim_commands::dkim_get_stats,
        opendkim_commands::dkim_reset_stats,
        opendkim_commands::dkim_get_last_messages,
        opendkim_commands::dkim_start,
        opendkim_commands::dkim_stop,
        opendkim_commands::dkim_restart,
        opendkim_commands::dkim_reload,
        opendkim_commands::dkim_status,
        opendkim_commands::dkim_version,
        opendkim_commands::dkim_info,
        // Cyrus SASL
        cyrus_sasl_commands::sasl_connect,
        cyrus_sasl_commands::sasl_disconnect,
        cyrus_sasl_commands::sasl_list_connections,
        cyrus_sasl_commands::sasl_ping,
        cyrus_sasl_commands::sasl_list_mechanisms,
        cyrus_sasl_commands::sasl_get_mechanism,
        cyrus_sasl_commands::sasl_list_available_mechanisms,
        cyrus_sasl_commands::sasl_list_enabled_mechanisms,
        cyrus_sasl_commands::sasl_enable_mechanism,
        cyrus_sasl_commands::sasl_disable_mechanism,
        cyrus_sasl_commands::sasl_list_users,
        cyrus_sasl_commands::sasl_get_user,
        cyrus_sasl_commands::sasl_create_user,
        cyrus_sasl_commands::sasl_update_user,
        cyrus_sasl_commands::sasl_delete_user,
        cyrus_sasl_commands::sasl_test_auth,
        cyrus_sasl_commands::sasl_list_realms,
        cyrus_sasl_commands::sasl_get_saslauthd_config,
        cyrus_sasl_commands::sasl_set_saslauthd_config,
        cyrus_sasl_commands::sasl_get_saslauthd_status,
        cyrus_sasl_commands::sasl_start_saslauthd,
        cyrus_sasl_commands::sasl_stop_saslauthd,
        cyrus_sasl_commands::sasl_restart_saslauthd,
        cyrus_sasl_commands::sasl_set_saslauthd_mechanism,
        cyrus_sasl_commands::sasl_set_saslauthd_flags,
        cyrus_sasl_commands::sasl_test_saslauthd_auth,
        cyrus_sasl_commands::sasl_list_apps,
        cyrus_sasl_commands::sasl_get_app_config,
        cyrus_sasl_commands::sasl_set_app_config,
        cyrus_sasl_commands::sasl_delete_app_config,
        cyrus_sasl_commands::sasl_get_app_param,
        cyrus_sasl_commands::sasl_set_app_param,
        cyrus_sasl_commands::sasl_delete_app_param,
        cyrus_sasl_commands::sasl_list_auxprop,
        cyrus_sasl_commands::sasl_get_auxprop,
        cyrus_sasl_commands::sasl_configure_auxprop,
        cyrus_sasl_commands::sasl_test_auxprop,
        cyrus_sasl_commands::sasl_list_db_entries,
        cyrus_sasl_commands::sasl_get_db_entry,
        cyrus_sasl_commands::sasl_set_db_password,
        cyrus_sasl_commands::sasl_delete_db_entry,
        cyrus_sasl_commands::sasl_dump_db,
        cyrus_sasl_commands::sasl_import_db,
        cyrus_sasl_commands::sasl_start,
        cyrus_sasl_commands::sasl_stop,
        cyrus_sasl_commands::sasl_restart,
        cyrus_sasl_commands::sasl_reload,
        cyrus_sasl_commands::sasl_status,
        cyrus_sasl_commands::sasl_version,
        cyrus_sasl_commands::sasl_info,
        cyrus_sasl_commands::sasl_test_config,
        // Procmail
        procmail_commands::procmail_connect,
        procmail_commands::procmail_disconnect,
        procmail_commands::procmail_list_connections,
        procmail_commands::procmail_list_recipes,
        procmail_commands::procmail_get_recipe,
        procmail_commands::procmail_create_recipe,
        procmail_commands::procmail_update_recipe,
        procmail_commands::procmail_delete_recipe,
        procmail_commands::procmail_enable_recipe,
        procmail_commands::procmail_disable_recipe,
        procmail_commands::procmail_reorder_recipe,
        procmail_commands::procmail_test_recipe,
        procmail_commands::procmail_list_rules,
        procmail_commands::procmail_get_rule,
        procmail_commands::procmail_create_rule,
        procmail_commands::procmail_update_rule,
        procmail_commands::procmail_delete_rule,
        procmail_commands::procmail_enable_rule,
        procmail_commands::procmail_disable_rule,
        procmail_commands::procmail_list_variables,
        procmail_commands::procmail_get_variable,
        procmail_commands::procmail_set_variable,
        procmail_commands::procmail_delete_variable,
        procmail_commands::procmail_list_includes,
        procmail_commands::procmail_add_include,
        procmail_commands::procmail_remove_include,
        procmail_commands::procmail_enable_include,
        procmail_commands::procmail_disable_include,
        procmail_commands::procmail_get_config,
        procmail_commands::procmail_set_config,
        procmail_commands::procmail_backup_config,
        procmail_commands::procmail_restore_config,
        procmail_commands::procmail_validate_config,
        procmail_commands::procmail_get_raw_config,
        procmail_commands::procmail_set_raw_config,
        procmail_commands::procmail_query_log,
        procmail_commands::procmail_list_log_files,
        procmail_commands::procmail_clear_log,
        procmail_commands::procmail_get_log_path,
        procmail_commands::procmail_set_log_path,
        // SpamAssassin
        spamassassin_commands::spam_connect,
        spamassassin_commands::spam_disconnect,
        spamassassin_commands::spam_list_connections,
        spamassassin_commands::spam_ping,
        spamassassin_commands::spam_list_rules,
        spamassassin_commands::spam_get_rule,
        spamassassin_commands::spam_list_scores,
        spamassassin_commands::spam_set_score,
        spamassassin_commands::spam_create_custom_rule,
        spamassassin_commands::spam_delete_custom_rule,
        spamassassin_commands::spam_enable_rule,
        spamassassin_commands::spam_disable_rule,
        spamassassin_commands::spam_list_custom_rules,
        spamassassin_commands::spam_get_rule_description,
        spamassassin_commands::spam_bayes_status,
        spamassassin_commands::spam_learn_spam,
        spamassassin_commands::spam_learn_ham,
        spamassassin_commands::spam_learn_spam_folder,
        spamassassin_commands::spam_learn_ham_folder,
        spamassassin_commands::spam_bayes_forget,
        spamassassin_commands::spam_bayes_clear,
        spamassassin_commands::spam_bayes_sync,
        spamassassin_commands::spam_bayes_backup,
        spamassassin_commands::spam_bayes_restore,
        spamassassin_commands::spam_list_channels,
        spamassassin_commands::spam_update_all_channels,
        spamassassin_commands::spam_update_channel,
        spamassassin_commands::spam_add_channel,
        spamassassin_commands::spam_remove_channel,
        spamassassin_commands::spam_list_channel_keys,
        spamassassin_commands::spam_import_channel_key,
        spamassassin_commands::spam_list_whitelist,
        spamassassin_commands::spam_add_whitelist,
        spamassassin_commands::spam_remove_whitelist,
        spamassassin_commands::spam_list_trusted_networks,
        spamassassin_commands::spam_add_trusted_network,
        spamassassin_commands::spam_remove_trusted_network,
        spamassassin_commands::spam_list_plugins,
        spamassassin_commands::spam_get_plugin,
        spamassassin_commands::spam_enable_plugin,
        spamassassin_commands::spam_disable_plugin,
        spamassassin_commands::spam_configure_plugin,
        spamassassin_commands::spam_get_plugin_config,
        spamassassin_commands::spam_get_local_cf,
        spamassassin_commands::spam_set_local_cf,
        spamassassin_commands::spam_get_param,
        spamassassin_commands::spam_set_param,
        spamassassin_commands::spam_delete_param,
        spamassassin_commands::spam_get_spamd_config,
        spamassassin_commands::spam_set_spamd_config,
        spamassassin_commands::spam_test_config,
        spamassassin_commands::spam_check_message,
        spamassassin_commands::spam_check_file,
        spamassassin_commands::spam_report_message,
        spamassassin_commands::spam_revoke_message,
        spamassassin_commands::spam_start,
        spamassassin_commands::spam_stop,
        spamassassin_commands::spam_restart,
        spamassassin_commands::spam_reload,
        spamassassin_commands::spam_status,
        spamassassin_commands::spam_version,
        spamassassin_commands::spam_info,
        spamassassin_commands::spam_lint,
        spamassassin_commands::spam_query_log,
        spamassassin_commands::spam_list_log_files,
        spamassassin_commands::spam_get_statistics,
        // Rspamd
        rspamd_commands::rspamd_connect,
        rspamd_commands::rspamd_disconnect,
        rspamd_commands::rspamd_list_connections,
        rspamd_commands::rspamd_ping,
        rspamd_commands::rspamd_check_message,
        rspamd_commands::rspamd_check_file,
        rspamd_commands::rspamd_learn_spam,
        rspamd_commands::rspamd_learn_ham,
        rspamd_commands::rspamd_fuzzy_add,
        rspamd_commands::rspamd_fuzzy_delete,
        rspamd_commands::rspamd_get_stats,
        rspamd_commands::rspamd_get_graph,
        rspamd_commands::rspamd_get_throughput,
        rspamd_commands::rspamd_reset_stats,
        rspamd_commands::rspamd_get_errors,
        rspamd_commands::rspamd_list_symbols,
        rspamd_commands::rspamd_get_symbol,
        rspamd_commands::rspamd_list_symbol_groups,
        rspamd_commands::rspamd_get_symbol_group,
        rspamd_commands::rspamd_list_actions,
        rspamd_commands::rspamd_get_action,
        rspamd_commands::rspamd_set_action,
        rspamd_commands::rspamd_enable_action,
        rspamd_commands::rspamd_disable_action,
        rspamd_commands::rspamd_list_maps,
        rspamd_commands::rspamd_get_map,
        rspamd_commands::rspamd_get_map_entries,
        rspamd_commands::rspamd_save_map_entries,
        rspamd_commands::rspamd_add_map_entry,
        rspamd_commands::rspamd_remove_map_entry,
        rspamd_commands::rspamd_get_history,
        rspamd_commands::rspamd_get_history_entry,
        rspamd_commands::rspamd_reset_history,
        rspamd_commands::rspamd_list_workers,
        rspamd_commands::rspamd_get_worker,
        rspamd_commands::rspamd_list_neighbours,
        rspamd_commands::rspamd_fuzzy_status,
        rspamd_commands::rspamd_fuzzy_check,
        rspamd_commands::rspamd_get_actions_config,
        rspamd_commands::rspamd_get_plugins,
        rspamd_commands::rspamd_enable_plugin,
        rspamd_commands::rspamd_disable_plugin,
        rspamd_commands::rspamd_reload_config,
        rspamd_commands::rspamd_save_actions_config,
        // ClamAV
        clamav_commands::clamav_connect,
        clamav_commands::clamav_disconnect,
        clamav_commands::clamav_list_connections,
        clamav_commands::clamav_ping,
        clamav_commands::clamav_scan,
        clamav_commands::clamav_quick_scan,
        clamav_commands::clamav_scan_stream,
        clamav_commands::clamav_multiscan,
        clamav_commands::clamav_contscan,
        clamav_commands::clamav_allmatchscan,
        clamav_commands::clamav_list_databases,
        clamav_commands::clamav_update_databases,
        clamav_commands::clamav_update_database,
        clamav_commands::clamav_check_update,
        clamav_commands::clamav_get_mirrors,
        clamav_commands::clamav_add_mirror,
        clamav_commands::clamav_remove_mirror,
        clamav_commands::clamav_get_db_version,
        clamav_commands::clamav_list_quarantine,
        clamav_commands::clamav_get_quarantine_entry,
        clamav_commands::clamav_restore_quarantine,
        clamav_commands::clamav_delete_quarantine,
        clamav_commands::clamav_delete_all_quarantine,
        clamav_commands::clamav_get_quarantine_stats,
        clamav_commands::clamav_get_clamd_config,
        clamav_commands::clamav_get_clamd_param,
        clamav_commands::clamav_set_clamd_param,
        clamav_commands::clamav_delete_clamd_param,
        clamav_commands::clamav_get_socket,
        clamav_commands::clamav_set_socket,
        clamav_commands::clamav_test_clamd_config,
        clamav_commands::clamav_get_freshclam_config,
        clamav_commands::clamav_get_freshclam_param,
        clamav_commands::clamav_set_freshclam_param,
        clamav_commands::clamav_delete_freshclam_param,
        clamav_commands::clamav_get_update_interval,
        clamav_commands::clamav_set_update_interval,
        clamav_commands::clamav_get_on_access_config,
        clamav_commands::clamav_set_on_access_config,
        clamav_commands::clamav_enable_on_access,
        clamav_commands::clamav_disable_on_access,
        clamav_commands::clamav_add_on_access_path,
        clamav_commands::clamav_remove_on_access_path,
        clamav_commands::clamav_get_milter_config,
        clamav_commands::clamav_set_milter_config,
        clamav_commands::clamav_enable_milter,
        clamav_commands::clamav_disable_milter,
        clamav_commands::clamav_list_scheduled_scans,
        clamav_commands::clamav_get_scheduled_scan,
        clamav_commands::clamav_create_scheduled_scan,
        clamav_commands::clamav_update_scheduled_scan,
        clamav_commands::clamav_delete_scheduled_scan,
        clamav_commands::clamav_enable_scheduled_scan,
        clamav_commands::clamav_disable_scheduled_scan,
        clamav_commands::clamav_run_scheduled_scan,
        clamav_commands::clamav_start_clamd,
        clamav_commands::clamav_stop_clamd,
        clamav_commands::clamav_restart_clamd,
        clamav_commands::clamav_reload_clamd,
        clamav_commands::clamav_clamd_status,
        clamav_commands::clamav_start_freshclam,
        clamav_commands::clamav_stop_freshclam,
        clamav_commands::clamav_restart_freshclam,
        clamav_commands::clamav_version,
        clamav_commands::clamav_info,
        // Roundcube
        roundcube_commands::rc_connect,
        roundcube_commands::rc_disconnect,
        roundcube_commands::rc_list_connections,
        roundcube_commands::rc_ping,
        roundcube_commands::rc_list_users,
        roundcube_commands::rc_get_user,
        roundcube_commands::rc_create_user,
        roundcube_commands::rc_update_user,
        roundcube_commands::rc_delete_user,
        roundcube_commands::rc_get_user_preferences,
        roundcube_commands::rc_update_user_preferences,
        roundcube_commands::rc_list_identities,
        roundcube_commands::rc_get_identity,
        roundcube_commands::rc_create_identity,
        roundcube_commands::rc_update_identity,
        roundcube_commands::rc_delete_identity,
        roundcube_commands::rc_set_default_identity,
        roundcube_commands::rc_list_address_books,
        roundcube_commands::rc_get_address_book,
        roundcube_commands::rc_list_contacts,
        roundcube_commands::rc_get_contact,
        roundcube_commands::rc_create_contact,
        roundcube_commands::rc_update_contact,
        roundcube_commands::rc_delete_contact,
        roundcube_commands::rc_search_contacts,
        roundcube_commands::rc_export_vcard,
        roundcube_commands::rc_list_folders,
        roundcube_commands::rc_get_folder,
        roundcube_commands::rc_create_folder,
        roundcube_commands::rc_rename_folder,
        roundcube_commands::rc_delete_folder,
        roundcube_commands::rc_subscribe_folder,
        roundcube_commands::rc_unsubscribe_folder,
        roundcube_commands::rc_purge_folder,
        roundcube_commands::rc_get_quota,
        roundcube_commands::rc_list_filters,
        roundcube_commands::rc_get_filter,
        roundcube_commands::rc_create_filter,
        roundcube_commands::rc_update_filter,
        roundcube_commands::rc_delete_filter,
        roundcube_commands::rc_enable_filter,
        roundcube_commands::rc_disable_filter,
        roundcube_commands::rc_reorder_filters,
        roundcube_commands::rc_list_plugins,
        roundcube_commands::rc_get_plugin,
        roundcube_commands::rc_enable_plugin,
        roundcube_commands::rc_disable_plugin,
        roundcube_commands::rc_get_plugin_config,
        roundcube_commands::rc_update_plugin_config,
        roundcube_commands::rc_get_system_config,
        roundcube_commands::rc_update_system_config,
        roundcube_commands::rc_get_smtp_config,
        roundcube_commands::rc_update_smtp_config,
        roundcube_commands::rc_get_cache_stats,
        roundcube_commands::rc_clear_cache,
        roundcube_commands::rc_get_logs,
        roundcube_commands::rc_vacuum_db,
        roundcube_commands::rc_optimize_db,
        roundcube_commands::rc_clear_temp_files,
        roundcube_commands::rc_clear_expired_sessions,
        roundcube_commands::rc_get_db_stats,
        roundcube_commands::rc_test_smtp,
        roundcube_commands::rc_test_imap,
        // Mailcow
        mailcow_commands::mailcow_connect,
        mailcow_commands::mailcow_disconnect,
        mailcow_commands::mailcow_list_connections,
        mailcow_commands::mailcow_ping,
        mailcow_commands::mailcow_list_domains,
        mailcow_commands::mailcow_get_domain,
        mailcow_commands::mailcow_create_domain,
        mailcow_commands::mailcow_update_domain,
        mailcow_commands::mailcow_delete_domain,
        mailcow_commands::mailcow_list_mailboxes,
        mailcow_commands::mailcow_list_mailboxes_by_domain,
        mailcow_commands::mailcow_get_mailbox,
        mailcow_commands::mailcow_create_mailbox,
        mailcow_commands::mailcow_update_mailbox,
        mailcow_commands::mailcow_delete_mailbox,
        mailcow_commands::mailcow_quarantine_notifications,
        mailcow_commands::mailcow_pushover_setup,
        mailcow_commands::mailcow_list_aliases,
        mailcow_commands::mailcow_get_alias,
        mailcow_commands::mailcow_create_alias,
        mailcow_commands::mailcow_update_alias,
        mailcow_commands::mailcow_delete_alias,
        mailcow_commands::mailcow_get_dkim,
        mailcow_commands::mailcow_generate_dkim,
        mailcow_commands::mailcow_delete_dkim,
        mailcow_commands::mailcow_duplicate_dkim,
        mailcow_commands::mailcow_list_domain_aliases,
        mailcow_commands::mailcow_get_domain_alias,
        mailcow_commands::mailcow_create_domain_alias,
        mailcow_commands::mailcow_update_domain_alias,
        mailcow_commands::mailcow_delete_domain_alias,
        mailcow_commands::mailcow_list_transport_maps,
        mailcow_commands::mailcow_get_transport_map,
        mailcow_commands::mailcow_create_transport_map,
        mailcow_commands::mailcow_update_transport_map,
        mailcow_commands::mailcow_delete_transport_map,
        mailcow_commands::mailcow_get_queue_summary,
        mailcow_commands::mailcow_list_queue,
        mailcow_commands::mailcow_flush_queue,
        mailcow_commands::mailcow_delete_queue_item,
        mailcow_commands::mailcow_super_delete_queue,
        mailcow_commands::mailcow_list_quarantine,
        mailcow_commands::mailcow_get_quarantine,
        mailcow_commands::mailcow_release_quarantine,
        mailcow_commands::mailcow_delete_quarantine,
        mailcow_commands::mailcow_whitelist_sender,
        mailcow_commands::mailcow_get_quarantine_settings,
        mailcow_commands::mailcow_update_quarantine_settings,
        mailcow_commands::mailcow_get_logs,
        mailcow_commands::mailcow_get_api_logs,
        mailcow_commands::mailcow_get_container_status,
        mailcow_commands::mailcow_get_solr_status,
        mailcow_commands::mailcow_get_system_status,
        mailcow_commands::mailcow_get_rspamd_stats,
        mailcow_commands::mailcow_get_fail2ban_config,
        mailcow_commands::mailcow_update_fail2ban_config,
        mailcow_commands::mailcow_get_rate_limits,
        mailcow_commands::mailcow_set_rate_limit,
        mailcow_commands::mailcow_delete_rate_limit,
        mailcow_commands::mailcow_list_app_passwords,
        mailcow_commands::mailcow_create_app_password,
        mailcow_commands::mailcow_delete_app_password,
        mailcow_commands::mailcow_list_resources,
        mailcow_commands::mailcow_get_resource,
        mailcow_commands::mailcow_create_resource,
        mailcow_commands::mailcow_update_resource,
        mailcow_commands::mailcow_delete_resource,
        // Amavis
        amavis_commands::amavis_connect,
        amavis_commands::amavis_disconnect,
        amavis_commands::amavis_list_connections,
        amavis_commands::amavis_ping,
        amavis_commands::amavis_get_main_config,
        amavis_commands::amavis_update_main_config,
        amavis_commands::amavis_list_snippets,
        amavis_commands::amavis_get_snippet,
        amavis_commands::amavis_create_snippet,
        amavis_commands::amavis_update_snippet,
        amavis_commands::amavis_delete_snippet,
        amavis_commands::amavis_enable_snippet,
        amavis_commands::amavis_disable_snippet,
        amavis_commands::amavis_test_config,
        amavis_commands::amavis_list_policy_banks,
        amavis_commands::amavis_get_policy_bank,
        amavis_commands::amavis_create_policy_bank,
        amavis_commands::amavis_update_policy_bank,
        amavis_commands::amavis_delete_policy_bank,
        amavis_commands::amavis_activate_policy_bank,
        amavis_commands::amavis_deactivate_policy_bank,
        amavis_commands::amavis_list_banned_rules,
        amavis_commands::amavis_get_banned_rule,
        amavis_commands::amavis_create_banned_rule,
        amavis_commands::amavis_update_banned_rule,
        amavis_commands::amavis_delete_banned_rule,
        amavis_commands::amavis_test_filename,
        amavis_commands::amavis_list_entries,
        amavis_commands::amavis_get_list_entry,
        amavis_commands::amavis_add_list_entry,
        amavis_commands::amavis_update_list_entry,
        amavis_commands::amavis_remove_list_entry,
        amavis_commands::amavis_check_sender,
        amavis_commands::amavis_list_quarantine,
        amavis_commands::amavis_get_quarantine,
        amavis_commands::amavis_release_quarantine,
        amavis_commands::amavis_delete_quarantine,
        amavis_commands::amavis_release_all_quarantine,
        amavis_commands::amavis_delete_all_quarantine,
        amavis_commands::amavis_get_quarantine_stats,
        amavis_commands::amavis_get_stats,
        amavis_commands::amavis_get_child_processes,
        amavis_commands::amavis_get_throughput,
        amavis_commands::amavis_reset_stats,
        amavis_commands::amavis_start,
        amavis_commands::amavis_stop,
        amavis_commands::amavis_restart,
        amavis_commands::amavis_reload,
        amavis_commands::amavis_process_status,
        amavis_commands::amavis_version,
        amavis_commands::amavis_debug_sa,
        amavis_commands::amavis_show_config,
    ]
}
