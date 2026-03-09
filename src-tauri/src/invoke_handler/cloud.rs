use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "connect_gcp"
            | "disconnect_gcp"
            | "list_gcp_sessions"
            | "get_gcp_session"
            | "list_gcp_instances"
            | "get_gcp_instance"
            | "start_gcp_instance"
            | "stop_gcp_instance"
            | "reset_gcp_instance"
            | "delete_gcp_instance"
            | "list_gcp_disks"
            | "list_gcp_snapshots"
            | "list_gcp_firewalls"
            | "list_gcp_networks"
            | "list_gcp_machine_types"
            | "list_gcp_buckets"
            | "get_gcp_bucket"
            | "create_gcp_bucket"
            | "delete_gcp_bucket"
            | "list_gcp_objects"
            | "download_gcp_object"
            | "delete_gcp_object"
            | "list_gcp_service_accounts"
            | "get_gcp_iam_policy"
            | "list_gcp_roles"
            | "list_gcp_secrets"
            | "get_gcp_secret"
            | "access_gcp_secret_version"
            | "create_gcp_secret"
            | "delete_gcp_secret"
            | "list_gcp_sql_instances"
            | "get_gcp_sql_instance"
            | "list_gcp_sql_databases"
            | "list_gcp_sql_users"
            | "list_gcp_functions"
            | "get_gcp_function"
            | "call_gcp_function"
            | "list_gcp_clusters"
            | "get_gcp_cluster"
            | "list_gcp_node_pools"
            | "list_gcp_managed_zones"
            | "list_gcp_dns_record_sets"
            | "list_gcp_topics"
            | "create_gcp_topic"
            | "delete_gcp_topic"
            | "publish_gcp_message"
            | "list_gcp_subscriptions"
            | "pull_gcp_messages"
            | "list_gcp_run_services"
            | "list_gcp_run_jobs"
            | "list_gcp_log_entries"
            | "list_gcp_logs"
            | "list_gcp_log_sinks"
            | "list_gcp_metric_descriptors"
            | "list_gcp_time_series"
            | "list_gcp_alert_policies"
            | "azure_set_credentials"
            | "azure_authenticate"
            | "azure_disconnect"
            | "azure_is_authenticated"
            | "azure_connection_summary"
            | "azure_list_vms"
            | "azure_list_vms_in_rg"
            | "azure_get_vm"
            | "azure_get_vm_instance_view"
            | "azure_start_vm"
            | "azure_stop_vm"
            | "azure_restart_vm"
            | "azure_deallocate_vm"
            | "azure_delete_vm"
            | "azure_resize_vm"
            | "azure_list_vm_sizes"
            | "azure_list_vm_summaries"
            | "azure_list_resource_groups"
            | "azure_get_resource_group"
            | "azure_create_resource_group"
            | "azure_delete_resource_group"
            | "azure_list_resources_in_rg"
            | "azure_list_all_resources"
            | "azure_list_storage_accounts"
            | "azure_list_storage_accounts_in_rg"
            | "azure_get_storage_account"
            | "azure_create_storage_account"
            | "azure_delete_storage_account"
            | "azure_list_storage_keys"
            | "azure_list_containers"
            | "azure_list_vnets"
            | "azure_list_vnets_in_rg"
            | "azure_get_vnet"
            | "azure_list_nsgs"
            | "azure_list_nsgs_in_rg"
            | "azure_list_public_ips"
            | "azure_list_nics"
            | "azure_list_load_balancers"
            | "azure_list_web_apps"
            | "azure_list_web_apps_in_rg"
            | "azure_get_web_app"
            | "azure_start_web_app"
            | "azure_stop_web_app"
            | "azure_restart_web_app"
            | "azure_delete_web_app"
            | "azure_list_slots"
            | "azure_swap_slot"
            | "azure_list_sql_servers"
            | "azure_list_sql_servers_in_rg"
            | "azure_get_sql_server"
            | "azure_list_databases"
            | "azure_get_database"
            | "azure_create_database"
            | "azure_delete_database"
            | "azure_list_firewall_rules"
            | "azure_create_firewall_rule"
            | "azure_delete_firewall_rule"
            | "azure_list_vaults"
            | "azure_list_vaults_in_rg"
            | "azure_get_vault"
            | "azure_list_secrets"
            | "azure_get_secret"
            | "azure_set_secret"
            | "azure_delete_secret"
            | "azure_list_keys"
            | "azure_list_certificates"
            | "azure_list_container_groups"
            | "azure_list_container_groups_in_rg"
            | "azure_get_container_group"
            | "azure_create_container_group"
            | "azure_delete_container_group"
            | "azure_restart_container_group"
            | "azure_stop_container_group"
            | "azure_start_container_group"
            | "azure_get_container_logs"
            | "azure_list_metric_definitions"
            | "azure_query_metrics"
            | "azure_list_activity_log"
            | "azure_list_usage_details"
            | "azure_list_budgets"
            | "azure_get_budget"
            | "azure_search_resources"
            | "exchange_set_config"
            | "exchange_connect"
            | "exchange_disconnect"
            | "exchange_is_connected"
            | "exchange_connection_summary"
            | "exchange_list_mailboxes"
            | "exchange_get_mailbox"
            | "exchange_create_mailbox"
            | "exchange_remove_mailbox"
            | "exchange_enable_mailbox"
            | "exchange_disable_mailbox"
            | "exchange_update_mailbox"
            | "exchange_get_mailbox_statistics"
            | "exchange_get_mailbox_permissions"
            | "exchange_add_mailbox_permission"
            | "exchange_remove_mailbox_permission"
            | "exchange_get_forwarding"
            | "exchange_get_ooo"
            | "exchange_set_ooo"
            | "exchange_list_groups"
            | "exchange_get_group"
            | "exchange_create_group"
            | "exchange_update_group"
            | "exchange_remove_group"
            | "exchange_list_group_members"
            | "exchange_add_group_member"
            | "exchange_remove_group_member"
            | "exchange_list_dynamic_groups"
            | "exchange_list_transport_rules"
            | "exchange_get_transport_rule"
            | "exchange_create_transport_rule"
            | "exchange_update_transport_rule"
            | "exchange_remove_transport_rule"
            | "exchange_enable_transport_rule"
            | "exchange_disable_transport_rule"
            | "exchange_list_send_connectors"
            | "exchange_get_send_connector"
            | "exchange_list_receive_connectors"
            | "exchange_get_receive_connector"
            | "exchange_list_inbound_connectors"
            | "exchange_list_outbound_connectors"
            | "exchange_message_trace"
            | "exchange_message_tracking_log"
            | "exchange_list_queues"
            | "exchange_get_queue"
            | "exchange_retry_queue"
            | "exchange_suspend_queue"
            | "exchange_resume_queue"
            | "exchange_queue_summary"
            | "exchange_list_calendar_permissions"
            | "exchange_set_calendar_permission"
            | "exchange_remove_calendar_permission"
            | "exchange_get_booking_config"
            | "exchange_set_booking_config"
            | "exchange_list_public_folders"
            | "exchange_get_public_folder"
            | "exchange_create_public_folder"
            | "exchange_remove_public_folder"
            | "exchange_mail_enable_public_folder"
            | "exchange_mail_disable_public_folder"
            | "exchange_get_public_folder_statistics"
            | "exchange_list_address_policies"
            | "exchange_get_address_policy"
            | "exchange_apply_address_policy"
            | "exchange_list_accepted_domains"
            | "exchange_list_address_lists"
            | "exchange_list_migration_batches"
            | "exchange_get_migration_batch"
            | "exchange_start_migration_batch"
            | "exchange_stop_migration_batch"
            | "exchange_complete_migration_batch"
            | "exchange_remove_migration_batch"
            | "exchange_list_migration_users"
            | "exchange_list_move_requests"
            | "exchange_get_move_request_statistics"
            | "exchange_new_move_request"
            | "exchange_remove_move_request"
            | "exchange_list_retention_policies"
            | "exchange_get_retention_policy"
            | "exchange_list_retention_tags"
            | "exchange_get_retention_tag"
            | "exchange_get_mailbox_hold"
            | "exchange_enable_litigation_hold"
            | "exchange_disable_litigation_hold"
            | "exchange_list_dlp_policies"
            | "exchange_get_dlp_policy"
            | "exchange_list_servers"
            | "exchange_get_server"
            | "exchange_list_databases"
            | "exchange_get_database"
            | "exchange_mount_database"
            | "exchange_dismount_database"
            | "exchange_list_dags"
            | "exchange_get_dag"
            | "exchange_get_dag_copy_status"
            | "exchange_test_replication_health"
            | "exchange_service_health"
            | "exchange_service_issues"
            | "exchange_test_mailflow"
            | "exchange_test_service_health"
            | "exchange_get_server_component_state"
            | "exchange_list_mail_contacts"
            | "exchange_get_mail_contact"
            | "exchange_create_mail_contact"
            | "exchange_update_mail_contact"
            | "exchange_remove_mail_contact"
            | "exchange_list_mail_users"
            | "exchange_get_mail_user"
            | "exchange_create_mail_user"
            | "exchange_remove_mail_user"
            | "exchange_convert_mailbox"
            | "exchange_list_shared_mailboxes"
            | "exchange_list_room_mailboxes"
            | "exchange_list_equipment_mailboxes"
            | "exchange_add_automapping"
            | "exchange_remove_automapping"
            | "exchange_add_send_as"
            | "exchange_remove_send_as"
            | "exchange_add_send_on_behalf"
            | "exchange_remove_send_on_behalf"
            | "exchange_list_room_lists"
            | "exchange_get_archive_info"
            | "exchange_enable_archive"
            | "exchange_disable_archive"
            | "exchange_enable_auto_expanding_archive"
            | "exchange_set_archive_quota"
            | "exchange_get_archive_statistics"
            | "exchange_list_mobile_devices"
            | "exchange_get_mobile_device_statistics"
            | "exchange_wipe_mobile_device"
            | "exchange_block_mobile_device"
            | "exchange_allow_mobile_device"
            | "exchange_remove_mobile_device"
            | "exchange_list_all_mobile_devices"
            | "exchange_list_inbox_rules"
            | "exchange_get_inbox_rule"
            | "exchange_create_inbox_rule"
            | "exchange_update_inbox_rule"
            | "exchange_remove_inbox_rule"
            | "exchange_enable_inbox_rule"
            | "exchange_disable_inbox_rule"
            | "exchange_list_owa_policies"
            | "exchange_get_owa_policy"
            | "exchange_set_owa_policy"
            | "exchange_list_mobile_device_policies"
            | "exchange_get_mobile_device_policy"
            | "exchange_set_mobile_device_policy"
            | "exchange_list_throttling_policies"
            | "exchange_get_throttling_policy"
            | "exchange_list_journal_rules"
            | "exchange_get_journal_rule"
            | "exchange_create_journal_rule"
            | "exchange_remove_journal_rule"
            | "exchange_enable_journal_rule"
            | "exchange_disable_journal_rule"
            | "exchange_list_role_groups"
            | "exchange_get_role_group"
            | "exchange_add_role_group_member"
            | "exchange_remove_role_group_member"
            | "exchange_list_management_roles"
            | "exchange_get_management_role"
            | "exchange_list_role_assignments"
            | "exchange_search_admin_audit_log"
            | "exchange_get_admin_audit_log_config"
            | "exchange_search_mailbox_audit_log"
            | "exchange_enable_mailbox_audit"
            | "exchange_disable_mailbox_audit"
            | "exchange_list_remote_domains"
            | "exchange_get_remote_domain"
            | "exchange_create_remote_domain"
            | "exchange_update_remote_domain"
            | "exchange_remove_remote_domain"
            | "exchange_list_certificates"
            | "exchange_get_certificate"
            | "exchange_enable_certificate"
            | "exchange_import_certificate"
            | "exchange_remove_certificate"
            | "exchange_new_certificate_request"
            | "exchange_list_owa_virtual_directories"
            | "exchange_list_ecp_virtual_directories"
            | "exchange_list_activesync_virtual_directories"
            | "exchange_list_ews_virtual_directories"
            | "exchange_list_mapi_virtual_directories"
            | "exchange_list_autodiscover_virtual_directories"
            | "exchange_list_powershell_virtual_directories"
            | "exchange_list_oab_virtual_directories"
            | "exchange_set_virtual_directory_urls"
            | "exchange_list_outlook_anywhere"
            | "exchange_get_organization_config"
            | "exchange_set_organization_config"
            | "exchange_get_transport_config"
            | "exchange_set_transport_config"
            | "exchange_get_content_filter_config"
            | "exchange_set_content_filter_config"
            | "exchange_get_connection_filter_config"
            | "exchange_set_connection_filter_config"
            | "exchange_get_sender_filter_config"
            | "exchange_set_sender_filter_config"
            | "exchange_list_quarantine_messages"
            | "exchange_get_quarantine_message"
            | "exchange_release_quarantine_message"
            | "exchange_delete_quarantine_message"
            | "exchange_new_mailbox_import_request"
            | "exchange_new_mailbox_export_request"
            | "exchange_list_mailbox_import_requests"
            | "exchange_list_mailbox_export_requests"
            | "exchange_remove_mailbox_import_request"
            | "exchange_remove_mailbox_export_request"
            | "smtp_add_profile"
            | "smtp_update_profile"
            | "smtp_delete_profile"
            | "smtp_get_profile"
            | "smtp_find_profile_by_name"
            | "smtp_list_profiles"
            | "smtp_set_default_profile"
            | "smtp_get_default_profile"
            | "smtp_add_template"
            | "smtp_update_template"
            | "smtp_delete_template"
            | "smtp_get_template"
            | "smtp_find_template_by_name"
            | "smtp_list_templates"
            | "smtp_render_template"
            | "smtp_extract_template_variables"
            | "smtp_validate_template"
            | "smtp_add_contact"
            | "smtp_update_contact"
            | "smtp_delete_contact"
            | "smtp_get_contact"
            | "smtp_find_contact_by_email"
            | "smtp_search_contacts"
            | "smtp_list_contacts"
            | "smtp_list_contacts_in_group"
            | "smtp_list_contacts_by_tag"
            | "smtp_add_contact_to_group"
            | "smtp_remove_contact_from_group"
            | "smtp_add_contact_tag"
            | "smtp_remove_contact_tag"
            | "smtp_all_contact_tags"
            | "smtp_create_contact_group"
            | "smtp_delete_contact_group"
            | "smtp_rename_contact_group"
            | "smtp_list_contact_groups"
            | "smtp_get_contact_group"
            | "smtp_export_contacts_csv"
            | "smtp_import_contacts_csv"
            | "smtp_export_contacts_json"
            | "smtp_import_contacts_json"
            | "smtp_send_email"
            | "smtp_enqueue"
            | "smtp_enqueue_scheduled"
            | "smtp_process_queue"
            | "smtp_bulk_enqueue"
            | "smtp_queue_summary"
            | "smtp_queue_list"
            | "smtp_queue_get"
            | "smtp_queue_cancel"
            | "smtp_queue_retry_failed"
            | "smtp_queue_purge_completed"
            | "smtp_queue_clear"
            | "smtp_set_queue_config"
            | "smtp_get_queue_config"
            | "smtp_run_diagnostics"
            | "smtp_quick_deliverability_check"
            | "smtp_lookup_mx"
            | "smtp_check_port"
            | "smtp_suggest_security"
            | "smtp_get_dns_txt"
            | "smtp_validate_dkim_config"
            | "smtp_generate_dkim_dns_record"
            | "smtp_connection_summary"
            | "smtp_stats"
            | "smtp_build_message"
            | "smtp_validate_email_address"
            | "smtp_parse_email_address"
            | "smtp_reverse_dns"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        gcp::connect_gcp,
        gcp::disconnect_gcp,
        gcp::list_gcp_sessions,
        gcp::get_gcp_session,
        // Compute Engine
        gcp::list_gcp_instances,
        gcp::get_gcp_instance,
        gcp::start_gcp_instance,
        gcp::stop_gcp_instance,
        gcp::reset_gcp_instance,
        gcp::delete_gcp_instance,
        gcp::list_gcp_disks,
        gcp::list_gcp_snapshots,
        gcp::list_gcp_firewalls,
        gcp::list_gcp_networks,
        gcp::list_gcp_machine_types,
        // Cloud Storage
        gcp::list_gcp_buckets,
        gcp::get_gcp_bucket,
        gcp::create_gcp_bucket,
        gcp::delete_gcp_bucket,
        gcp::list_gcp_objects,
        gcp::download_gcp_object,
        gcp::delete_gcp_object,
        // IAM
        gcp::list_gcp_service_accounts,
        gcp::get_gcp_iam_policy,
        gcp::list_gcp_roles,
        // Secret Manager
        gcp::list_gcp_secrets,
        gcp::get_gcp_secret,
        gcp::access_gcp_secret_version,
        gcp::create_gcp_secret,
        gcp::delete_gcp_secret,
        // Cloud SQL
        gcp::list_gcp_sql_instances,
        gcp::get_gcp_sql_instance,
        gcp::list_gcp_sql_databases,
        gcp::list_gcp_sql_users,
        // Cloud Functions
        gcp::list_gcp_functions,
        gcp::get_gcp_function,
        gcp::call_gcp_function,
        // GKE
        gcp::list_gcp_clusters,
        gcp::get_gcp_cluster,
        gcp::list_gcp_node_pools,
        // Cloud DNS
        gcp::list_gcp_managed_zones,
        gcp::list_gcp_dns_record_sets,
        // Pub/Sub
        gcp::list_gcp_topics,
        gcp::create_gcp_topic,
        gcp::delete_gcp_topic,
        gcp::publish_gcp_message,
        gcp::list_gcp_subscriptions,
        gcp::pull_gcp_messages,
        // Cloud Run
        gcp::list_gcp_run_services,
        gcp::list_gcp_run_jobs,
        // Cloud Logging
        gcp::list_gcp_log_entries,
        gcp::list_gcp_logs,
        gcp::list_gcp_log_sinks,
        // Cloud Monitoring
        gcp::list_gcp_metric_descriptors,
        gcp::list_gcp_time_series,
        gcp::list_gcp_alert_policies,
        // Azure (sorng-azure)
        azure::commands::azure_set_credentials,
        azure::commands::azure_authenticate,
        azure::commands::azure_disconnect,
        azure::commands::azure_is_authenticated,
        azure::commands::azure_connection_summary,
        azure::commands::azure_list_vms,
        azure::commands::azure_list_vms_in_rg,
        azure::commands::azure_get_vm,
        azure::commands::azure_get_vm_instance_view,
        azure::commands::azure_start_vm,
        azure::commands::azure_stop_vm,
        azure::commands::azure_restart_vm,
        azure::commands::azure_deallocate_vm,
        azure::commands::azure_delete_vm,
        azure::commands::azure_resize_vm,
        azure::commands::azure_list_vm_sizes,
        azure::commands::azure_list_vm_summaries,
        azure::commands::azure_list_resource_groups,
        azure::commands::azure_get_resource_group,
        azure::commands::azure_create_resource_group,
        azure::commands::azure_delete_resource_group,
        azure::commands::azure_list_resources_in_rg,
        azure::commands::azure_list_all_resources,
        azure::commands::azure_list_storage_accounts,
        azure::commands::azure_list_storage_accounts_in_rg,
        azure::commands::azure_get_storage_account,
        azure::commands::azure_create_storage_account,
        azure::commands::azure_delete_storage_account,
        azure::commands::azure_list_storage_keys,
        azure::commands::azure_list_containers,
        azure::commands::azure_list_vnets,
        azure::commands::azure_list_vnets_in_rg,
        azure::commands::azure_get_vnet,
        azure::commands::azure_list_nsgs,
        azure::commands::azure_list_nsgs_in_rg,
        azure::commands::azure_list_public_ips,
        azure::commands::azure_list_nics,
        azure::commands::azure_list_load_balancers,
        azure::commands::azure_list_web_apps,
        azure::commands::azure_list_web_apps_in_rg,
        azure::commands::azure_get_web_app,
        azure::commands::azure_start_web_app,
        azure::commands::azure_stop_web_app,
        azure::commands::azure_restart_web_app,
        azure::commands::azure_delete_web_app,
        azure::commands::azure_list_slots,
        azure::commands::azure_swap_slot,
        azure::commands::azure_list_sql_servers,
        azure::commands::azure_list_sql_servers_in_rg,
        azure::commands::azure_get_sql_server,
        azure::commands::azure_list_databases,
        azure::commands::azure_get_database,
        azure::commands::azure_create_database,
        azure::commands::azure_delete_database,
        azure::commands::azure_list_firewall_rules,
        azure::commands::azure_create_firewall_rule,
        azure::commands::azure_delete_firewall_rule,
        azure::commands::azure_list_vaults,
        azure::commands::azure_list_vaults_in_rg,
        azure::commands::azure_get_vault,
        azure::commands::azure_list_secrets,
        azure::commands::azure_get_secret,
        azure::commands::azure_set_secret,
        azure::commands::azure_delete_secret,
        azure::commands::azure_list_keys,
        azure::commands::azure_list_certificates,
        azure::commands::azure_list_container_groups,
        azure::commands::azure_list_container_groups_in_rg,
        azure::commands::azure_get_container_group,
        azure::commands::azure_create_container_group,
        azure::commands::azure_delete_container_group,
        azure::commands::azure_restart_container_group,
        azure::commands::azure_stop_container_group,
        azure::commands::azure_start_container_group,
        azure::commands::azure_get_container_logs,
        azure::commands::azure_list_metric_definitions,
        azure::commands::azure_query_metrics,
        azure::commands::azure_list_activity_log,
        azure::commands::azure_list_usage_details,
        azure::commands::azure_list_budgets,
        azure::commands::azure_get_budget,
        azure::commands::azure_search_resources,
        // Exchange commands (sorng-exchange)
        exchange::commands::exchange_set_config,
        exchange::commands::exchange_connect,
        exchange::commands::exchange_disconnect,
        exchange::commands::exchange_is_connected,
        exchange::commands::exchange_connection_summary,
        exchange::commands::exchange_list_mailboxes,
        exchange::commands::exchange_get_mailbox,
        exchange::commands::exchange_create_mailbox,
        exchange::commands::exchange_remove_mailbox,
        exchange::commands::exchange_enable_mailbox,
        exchange::commands::exchange_disable_mailbox,
        exchange::commands::exchange_update_mailbox,
        exchange::commands::exchange_get_mailbox_statistics,
        exchange::commands::exchange_get_mailbox_permissions,
        exchange::commands::exchange_add_mailbox_permission,
        exchange::commands::exchange_remove_mailbox_permission,
        exchange::commands::exchange_get_forwarding,
        exchange::commands::exchange_get_ooo,
        exchange::commands::exchange_set_ooo,
        exchange::commands::exchange_list_groups,
        exchange::commands::exchange_get_group,
        exchange::commands::exchange_create_group,
        exchange::commands::exchange_update_group,
        exchange::commands::exchange_remove_group,
        exchange::commands::exchange_list_group_members,
        exchange::commands::exchange_add_group_member,
        exchange::commands::exchange_remove_group_member,
        exchange::commands::exchange_list_dynamic_groups,
        exchange::commands::exchange_list_transport_rules,
        exchange::commands::exchange_get_transport_rule,
        exchange::commands::exchange_create_transport_rule,
        exchange::commands::exchange_update_transport_rule,
        exchange::commands::exchange_remove_transport_rule,
        exchange::commands::exchange_enable_transport_rule,
        exchange::commands::exchange_disable_transport_rule,
        exchange::commands::exchange_list_send_connectors,
        exchange::commands::exchange_get_send_connector,
        exchange::commands::exchange_list_receive_connectors,
        exchange::commands::exchange_get_receive_connector,
        exchange::commands::exchange_list_inbound_connectors,
        exchange::commands::exchange_list_outbound_connectors,
        exchange::commands::exchange_message_trace,
        exchange::commands::exchange_message_tracking_log,
        exchange::commands::exchange_list_queues,
        exchange::commands::exchange_get_queue,
        exchange::commands::exchange_retry_queue,
        exchange::commands::exchange_suspend_queue,
        exchange::commands::exchange_resume_queue,
        exchange::commands::exchange_queue_summary,
        exchange::commands::exchange_list_calendar_permissions,
        exchange::commands::exchange_set_calendar_permission,
        exchange::commands::exchange_remove_calendar_permission,
        exchange::commands::exchange_get_booking_config,
        exchange::commands::exchange_set_booking_config,
        exchange::commands::exchange_list_public_folders,
        exchange::commands::exchange_get_public_folder,
        exchange::commands::exchange_create_public_folder,
        exchange::commands::exchange_remove_public_folder,
        exchange::commands::exchange_mail_enable_public_folder,
        exchange::commands::exchange_mail_disable_public_folder,
        exchange::commands::exchange_get_public_folder_statistics,
        exchange::commands::exchange_list_address_policies,
        exchange::commands::exchange_get_address_policy,
        exchange::commands::exchange_apply_address_policy,
        exchange::commands::exchange_list_accepted_domains,
        exchange::commands::exchange_list_address_lists,
        exchange::commands::exchange_list_migration_batches,
        exchange::commands::exchange_get_migration_batch,
        exchange::commands::exchange_start_migration_batch,
        exchange::commands::exchange_stop_migration_batch,
        exchange::commands::exchange_complete_migration_batch,
        exchange::commands::exchange_remove_migration_batch,
        exchange::commands::exchange_list_migration_users,
        exchange::commands::exchange_list_move_requests,
        exchange::commands::exchange_get_move_request_statistics,
        exchange::commands::exchange_new_move_request,
        exchange::commands::exchange_remove_move_request,
        exchange::commands::exchange_list_retention_policies,
        exchange::commands::exchange_get_retention_policy,
        exchange::commands::exchange_list_retention_tags,
        exchange::commands::exchange_get_retention_tag,
        exchange::commands::exchange_get_mailbox_hold,
        exchange::commands::exchange_enable_litigation_hold,
        exchange::commands::exchange_disable_litigation_hold,
        exchange::commands::exchange_list_dlp_policies,
        exchange::commands::exchange_get_dlp_policy,
        exchange::commands::exchange_list_servers,
        exchange::commands::exchange_get_server,
        exchange::commands::exchange_list_databases,
        exchange::commands::exchange_get_database,
        exchange::commands::exchange_mount_database,
        exchange::commands::exchange_dismount_database,
        exchange::commands::exchange_list_dags,
        exchange::commands::exchange_get_dag,
        exchange::commands::exchange_get_dag_copy_status,
        exchange::commands::exchange_test_replication_health,
        exchange::commands::exchange_service_health,
        exchange::commands::exchange_service_issues,
        exchange::commands::exchange_test_mailflow,
        exchange::commands::exchange_test_service_health,
        exchange::commands::exchange_get_server_component_state,
        // Exchange – Mail Contacts & Mail Users
        exchange::commands::exchange_list_mail_contacts,
        exchange::commands::exchange_get_mail_contact,
        exchange::commands::exchange_create_mail_contact,
        exchange::commands::exchange_update_mail_contact,
        exchange::commands::exchange_remove_mail_contact,
        exchange::commands::exchange_list_mail_users,
        exchange::commands::exchange_get_mail_user,
        exchange::commands::exchange_create_mail_user,
        exchange::commands::exchange_remove_mail_user,
        // Exchange – Shared / Resource Mailboxes
        exchange::commands::exchange_convert_mailbox,
        exchange::commands::exchange_list_shared_mailboxes,
        exchange::commands::exchange_list_room_mailboxes,
        exchange::commands::exchange_list_equipment_mailboxes,
        exchange::commands::exchange_add_automapping,
        exchange::commands::exchange_remove_automapping,
        exchange::commands::exchange_add_send_as,
        exchange::commands::exchange_remove_send_as,
        exchange::commands::exchange_add_send_on_behalf,
        exchange::commands::exchange_remove_send_on_behalf,
        exchange::commands::exchange_list_room_lists,
        // Exchange – Archive Mailboxes
        exchange::commands::exchange_get_archive_info,
        exchange::commands::exchange_enable_archive,
        exchange::commands::exchange_disable_archive,
        exchange::commands::exchange_enable_auto_expanding_archive,
        exchange::commands::exchange_set_archive_quota,
        exchange::commands::exchange_get_archive_statistics,
        // Exchange – Mobile Devices
        exchange::commands::exchange_list_mobile_devices,
        exchange::commands::exchange_get_mobile_device_statistics,
        exchange::commands::exchange_wipe_mobile_device,
        exchange::commands::exchange_block_mobile_device,
        exchange::commands::exchange_allow_mobile_device,
        exchange::commands::exchange_remove_mobile_device,
        exchange::commands::exchange_list_all_mobile_devices,
        // Exchange – Inbox Rules
        exchange::commands::exchange_list_inbox_rules,
        exchange::commands::exchange_get_inbox_rule,
        exchange::commands::exchange_create_inbox_rule,
        exchange::commands::exchange_update_inbox_rule,
        exchange::commands::exchange_remove_inbox_rule,
        exchange::commands::exchange_enable_inbox_rule,
        exchange::commands::exchange_disable_inbox_rule,
        // Exchange – Policies
        exchange::commands::exchange_list_owa_policies,
        exchange::commands::exchange_get_owa_policy,
        exchange::commands::exchange_set_owa_policy,
        exchange::commands::exchange_list_mobile_device_policies,
        exchange::commands::exchange_get_mobile_device_policy,
        exchange::commands::exchange_set_mobile_device_policy,
        exchange::commands::exchange_list_throttling_policies,
        exchange::commands::exchange_get_throttling_policy,
        // Exchange – Journal Rules
        exchange::commands::exchange_list_journal_rules,
        exchange::commands::exchange_get_journal_rule,
        exchange::commands::exchange_create_journal_rule,
        exchange::commands::exchange_remove_journal_rule,
        exchange::commands::exchange_enable_journal_rule,
        exchange::commands::exchange_disable_journal_rule,
        // Exchange – RBAC & Audit
        exchange::commands::exchange_list_role_groups,
        exchange::commands::exchange_get_role_group,
        exchange::commands::exchange_add_role_group_member,
        exchange::commands::exchange_remove_role_group_member,
        exchange::commands::exchange_list_management_roles,
        exchange::commands::exchange_get_management_role,
        exchange::commands::exchange_list_role_assignments,
        exchange::commands::exchange_search_admin_audit_log,
        exchange::commands::exchange_get_admin_audit_log_config,
        exchange::commands::exchange_search_mailbox_audit_log,
        exchange::commands::exchange_enable_mailbox_audit,
        exchange::commands::exchange_disable_mailbox_audit,
        // Exchange – Remote Domains
        exchange::commands::exchange_list_remote_domains,
        exchange::commands::exchange_get_remote_domain,
        exchange::commands::exchange_create_remote_domain,
        exchange::commands::exchange_update_remote_domain,
        exchange::commands::exchange_remove_remote_domain,
        // Exchange – Certificates
        exchange::commands::exchange_list_certificates,
        exchange::commands::exchange_get_certificate,
        exchange::commands::exchange_enable_certificate,
        exchange::commands::exchange_import_certificate,
        exchange::commands::exchange_remove_certificate,
        exchange::commands::exchange_new_certificate_request,
        // Exchange – Virtual Directories & Org Config
        exchange::commands::exchange_list_owa_virtual_directories,
        exchange::commands::exchange_list_ecp_virtual_directories,
        exchange::commands::exchange_list_activesync_virtual_directories,
        exchange::commands::exchange_list_ews_virtual_directories,
        exchange::commands::exchange_list_mapi_virtual_directories,
        exchange::commands::exchange_list_autodiscover_virtual_directories,
        exchange::commands::exchange_list_powershell_virtual_directories,
        exchange::commands::exchange_list_oab_virtual_directories,
        exchange::commands::exchange_set_virtual_directory_urls,
        exchange::commands::exchange_list_outlook_anywhere,
        exchange::commands::exchange_get_organization_config,
        exchange::commands::exchange_set_organization_config,
        exchange::commands::exchange_get_transport_config,
        exchange::commands::exchange_set_transport_config,
        // Exchange – Anti-Spam & Hygiene
        exchange::commands::exchange_get_content_filter_config,
        exchange::commands::exchange_set_content_filter_config,
        exchange::commands::exchange_get_connection_filter_config,
        exchange::commands::exchange_set_connection_filter_config,
        exchange::commands::exchange_get_sender_filter_config,
        exchange::commands::exchange_set_sender_filter_config,
        exchange::commands::exchange_list_quarantine_messages,
        exchange::commands::exchange_get_quarantine_message,
        exchange::commands::exchange_release_quarantine_message,
        exchange::commands::exchange_delete_quarantine_message,
        // Exchange – Mailbox Import/Export (PST)
        exchange::commands::exchange_new_mailbox_import_request,
        exchange::commands::exchange_new_mailbox_export_request,
        exchange::commands::exchange_list_mailbox_import_requests,
        exchange::commands::exchange_list_mailbox_export_requests,
        exchange::commands::exchange_remove_mailbox_import_request,
        exchange::commands::exchange_remove_mailbox_export_request,
        // SMTP commands
        smtp::commands::smtp_add_profile,
        smtp::commands::smtp_update_profile,
        smtp::commands::smtp_delete_profile,
        smtp::commands::smtp_get_profile,
        smtp::commands::smtp_find_profile_by_name,
        smtp::commands::smtp_list_profiles,
        smtp::commands::smtp_set_default_profile,
        smtp::commands::smtp_get_default_profile,
        smtp::commands::smtp_add_template,
        smtp::commands::smtp_update_template,
        smtp::commands::smtp_delete_template,
        smtp::commands::smtp_get_template,
        smtp::commands::smtp_find_template_by_name,
        smtp::commands::smtp_list_templates,
        smtp::commands::smtp_render_template,
        smtp::commands::smtp_extract_template_variables,
        smtp::commands::smtp_validate_template,
        smtp::commands::smtp_add_contact,
        smtp::commands::smtp_update_contact,
        smtp::commands::smtp_delete_contact,
        smtp::commands::smtp_get_contact,
        smtp::commands::smtp_find_contact_by_email,
        smtp::commands::smtp_search_contacts,
        smtp::commands::smtp_list_contacts,
        smtp::commands::smtp_list_contacts_in_group,
        smtp::commands::smtp_list_contacts_by_tag,
        smtp::commands::smtp_add_contact_to_group,
        smtp::commands::smtp_remove_contact_from_group,
        smtp::commands::smtp_add_contact_tag,
        smtp::commands::smtp_remove_contact_tag,
        smtp::commands::smtp_all_contact_tags,
        smtp::commands::smtp_create_contact_group,
        smtp::commands::smtp_delete_contact_group,
        smtp::commands::smtp_rename_contact_group,
        smtp::commands::smtp_list_contact_groups,
        smtp::commands::smtp_get_contact_group,
        smtp::commands::smtp_export_contacts_csv,
        smtp::commands::smtp_import_contacts_csv,
        smtp::commands::smtp_export_contacts_json,
        smtp::commands::smtp_import_contacts_json,
        smtp::commands::smtp_send_email,
        smtp::commands::smtp_enqueue,
        smtp::commands::smtp_enqueue_scheduled,
        smtp::commands::smtp_process_queue,
        smtp::commands::smtp_bulk_enqueue,
        smtp::commands::smtp_queue_summary,
        smtp::commands::smtp_queue_list,
        smtp::commands::smtp_queue_get,
        smtp::commands::smtp_queue_cancel,
        smtp::commands::smtp_queue_retry_failed,
        smtp::commands::smtp_queue_purge_completed,
        smtp::commands::smtp_queue_clear,
        smtp::commands::smtp_set_queue_config,
        smtp::commands::smtp_get_queue_config,
        smtp::commands::smtp_run_diagnostics,
        smtp::commands::smtp_quick_deliverability_check,
        smtp::commands::smtp_lookup_mx,
        smtp::commands::smtp_check_port,
        smtp::commands::smtp_suggest_security,
        smtp::commands::smtp_get_dns_txt,
        smtp::commands::smtp_validate_dkim_config,
        smtp::commands::smtp_generate_dkim_dns_record,
        smtp::commands::smtp_connection_summary,
        smtp::commands::smtp_stats,
        smtp::commands::smtp_build_message,
        smtp::commands::smtp_validate_email_address,
        smtp::commands::smtp_parse_email_address,
        smtp::commands::smtp_reverse_dns,
    ]
}
