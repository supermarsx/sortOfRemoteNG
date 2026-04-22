use crate::*;

pub fn is_command(command: &str) -> bool {
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
            | "hetzner_connect"
            | "hetzner_disconnect"
            | "hetzner_list_connections"
            | "hetzner_ping"
            | "hetzner_get_dashboard"
            | "hetzner_list_servers"
            | "hetzner_get_server"
            | "hetzner_create_server"
            | "hetzner_delete_server"
            | "hetzner_start_server"
            | "hetzner_stop_server"
            | "hetzner_reboot_server"
            | "hetzner_rebuild_server"
            | "hetzner_reset_server"
            | "hetzner_change_server_type"
            | "hetzner_enable_rescue"
            | "hetzner_disable_rescue"
            | "hetzner_create_server_image"
            | "hetzner_enable_backup"
            | "hetzner_disable_backup"
            | "hetzner_get_server_metrics"
            | "hetzner_list_networks"
            | "hetzner_get_network"
            | "hetzner_create_network"
            | "hetzner_update_network"
            | "hetzner_delete_network"
            | "hetzner_add_subnet"
            | "hetzner_delete_subnet"
            | "hetzner_add_route"
            | "hetzner_delete_route"
            | "hetzner_list_firewalls"
            | "hetzner_get_firewall"
            | "hetzner_create_firewall"
            | "hetzner_update_firewall"
            | "hetzner_delete_firewall"
            | "hetzner_set_firewall_rules"
            | "hetzner_apply_firewall"
            | "hetzner_remove_firewall"
            | "hetzner_list_floating_ips"
            | "hetzner_get_floating_ip"
            | "hetzner_create_floating_ip"
            | "hetzner_delete_floating_ip"
            | "hetzner_assign_floating_ip"
            | "hetzner_unassign_floating_ip"
            | "hetzner_list_volumes"
            | "hetzner_get_volume"
            | "hetzner_create_volume"
            | "hetzner_delete_volume"
            | "hetzner_attach_volume"
            | "hetzner_detach_volume"
            | "hetzner_resize_volume"
            | "hetzner_list_load_balancers"
            | "hetzner_get_load_balancer"
            | "hetzner_create_load_balancer"
            | "hetzner_delete_load_balancer"
            | "hetzner_add_lb_service"
            | "hetzner_update_lb_service"
            | "hetzner_delete_lb_service"
            | "hetzner_add_lb_target"
            | "hetzner_remove_lb_target"
            | "hetzner_list_images"
            | "hetzner_get_image"
            | "hetzner_update_image"
            | "hetzner_delete_image"
            | "hetzner_list_ssh_keys"
            | "hetzner_get_ssh_key"
            | "hetzner_create_ssh_key"
            | "hetzner_update_ssh_key"
            | "hetzner_delete_ssh_key"
            | "hetzner_list_certificates"
            | "hetzner_get_certificate"
            | "hetzner_create_certificate"
            | "hetzner_update_certificate"
            | "hetzner_delete_certificate"
            | "hetzner_list_actions"
            | "hetzner_get_action"
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

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        gcp_commands::connect_gcp,
        gcp_commands::disconnect_gcp,
        gcp_commands::list_gcp_sessions,
        gcp_commands::get_gcp_session,
        // Compute Engine
        gcp_commands::list_gcp_instances,
        gcp_commands::get_gcp_instance,
        gcp_commands::start_gcp_instance,
        gcp_commands::stop_gcp_instance,
        gcp_commands::reset_gcp_instance,
        gcp_commands::delete_gcp_instance,
        gcp_commands::list_gcp_disks,
        gcp_commands::list_gcp_snapshots,
        gcp_commands::list_gcp_firewalls,
        gcp_commands::list_gcp_networks,
        gcp_commands::list_gcp_machine_types,
        // Cloud Storage
        gcp_commands::list_gcp_buckets,
        gcp_commands::get_gcp_bucket,
        gcp_commands::create_gcp_bucket,
        gcp_commands::delete_gcp_bucket,
        gcp_commands::list_gcp_objects,
        gcp_commands::download_gcp_object,
        gcp_commands::delete_gcp_object,
        // IAM
        gcp_commands::list_gcp_service_accounts,
        gcp_commands::get_gcp_iam_policy,
        gcp_commands::list_gcp_roles,
        // Secret Manager
        gcp_commands::list_gcp_secrets,
        gcp_commands::get_gcp_secret,
        gcp_commands::access_gcp_secret_version,
        gcp_commands::create_gcp_secret,
        gcp_commands::delete_gcp_secret,
        // Cloud SQL
        gcp_commands::list_gcp_sql_instances,
        gcp_commands::get_gcp_sql_instance,
        gcp_commands::list_gcp_sql_databases,
        gcp_commands::list_gcp_sql_users,
        // Cloud Functions
        gcp_commands::list_gcp_functions,
        gcp_commands::get_gcp_function,
        gcp_commands::call_gcp_function,
        // GKE
        gcp_commands::list_gcp_clusters,
        gcp_commands::get_gcp_cluster,
        gcp_commands::list_gcp_node_pools,
        // Cloud DNS
        gcp_commands::list_gcp_managed_zones,
        gcp_commands::list_gcp_dns_record_sets,
        // Pub/Sub
        gcp_commands::list_gcp_topics,
        gcp_commands::create_gcp_topic,
        gcp_commands::delete_gcp_topic,
        gcp_commands::publish_gcp_message,
        gcp_commands::list_gcp_subscriptions,
        gcp_commands::pull_gcp_messages,
        // Cloud Run
        gcp_commands::list_gcp_run_services,
        gcp_commands::list_gcp_run_jobs,
        // Cloud Logging
        gcp_commands::list_gcp_log_entries,
        gcp_commands::list_gcp_logs,
        gcp_commands::list_gcp_log_sinks,
        // Cloud Monitoring
        gcp_commands::list_gcp_metric_descriptors,
        gcp_commands::list_gcp_time_series,
        gcp_commands::list_gcp_alert_policies,
        // Azure (sorng-azure)
        azure_commands::azure_set_credentials,
        azure_commands::azure_authenticate,
        azure_commands::azure_disconnect,
        azure_commands::azure_is_authenticated,
        azure_commands::azure_connection_summary,
        azure_commands::azure_list_vms,
        azure_commands::azure_list_vms_in_rg,
        azure_commands::azure_get_vm,
        azure_commands::azure_get_vm_instance_view,
        azure_commands::azure_start_vm,
        azure_commands::azure_stop_vm,
        azure_commands::azure_restart_vm,
        azure_commands::azure_deallocate_vm,
        azure_commands::azure_delete_vm,
        azure_commands::azure_resize_vm,
        azure_commands::azure_list_vm_sizes,
        azure_commands::azure_list_vm_summaries,
        azure_commands::azure_list_resource_groups,
        azure_commands::azure_get_resource_group,
        azure_commands::azure_create_resource_group,
        azure_commands::azure_delete_resource_group,
        azure_commands::azure_list_resources_in_rg,
        azure_commands::azure_list_all_resources,
        azure_commands::azure_list_storage_accounts,
        azure_commands::azure_list_storage_accounts_in_rg,
        azure_commands::azure_get_storage_account,
        azure_commands::azure_create_storage_account,
        azure_commands::azure_delete_storage_account,
        azure_commands::azure_list_storage_keys,
        azure_commands::azure_list_containers,
        azure_commands::azure_list_vnets,
        azure_commands::azure_list_vnets_in_rg,
        azure_commands::azure_get_vnet,
        azure_commands::azure_list_nsgs,
        azure_commands::azure_list_nsgs_in_rg,
        azure_commands::azure_list_public_ips,
        azure_commands::azure_list_nics,
        azure_commands::azure_list_load_balancers,
        azure_commands::azure_list_web_apps,
        azure_commands::azure_list_web_apps_in_rg,
        azure_commands::azure_get_web_app,
        azure_commands::azure_start_web_app,
        azure_commands::azure_stop_web_app,
        azure_commands::azure_restart_web_app,
        azure_commands::azure_delete_web_app,
        azure_commands::azure_list_slots,
        azure_commands::azure_swap_slot,
        azure_commands::azure_list_sql_servers,
        azure_commands::azure_list_sql_servers_in_rg,
        azure_commands::azure_get_sql_server,
        azure_commands::azure_list_databases,
        azure_commands::azure_get_database,
        azure_commands::azure_create_database,
        azure_commands::azure_delete_database,
        azure_commands::azure_list_firewall_rules,
        azure_commands::azure_create_firewall_rule,
        azure_commands::azure_delete_firewall_rule,
        azure_commands::azure_list_vaults,
        azure_commands::azure_list_vaults_in_rg,
        azure_commands::azure_get_vault,
        azure_commands::azure_list_secrets,
        azure_commands::azure_get_secret,
        azure_commands::azure_set_secret,
        azure_commands::azure_delete_secret,
        azure_commands::azure_list_keys,
        azure_commands::azure_list_certificates,
        azure_commands::azure_list_container_groups,
        azure_commands::azure_list_container_groups_in_rg,
        azure_commands::azure_get_container_group,
        azure_commands::azure_create_container_group,
        azure_commands::azure_delete_container_group,
        azure_commands::azure_restart_container_group,
        azure_commands::azure_stop_container_group,
        azure_commands::azure_start_container_group,
        azure_commands::azure_get_container_logs,
        azure_commands::azure_list_metric_definitions,
        azure_commands::azure_query_metrics,
        azure_commands::azure_list_activity_log,
        azure_commands::azure_list_usage_details,
        azure_commands::azure_list_budgets,
        azure_commands::azure_get_budget,
        azure_commands::azure_search_resources,
        // Exchange commands (sorng-exchange)
        exchange_commands::exchange_set_config,
        exchange_commands::exchange_connect,
        exchange_commands::exchange_disconnect,
        exchange_commands::exchange_is_connected,
        exchange_commands::exchange_connection_summary,
        exchange_commands::exchange_list_mailboxes,
        exchange_commands::exchange_get_mailbox,
        exchange_commands::exchange_create_mailbox,
        exchange_commands::exchange_remove_mailbox,
        exchange_commands::exchange_enable_mailbox,
        exchange_commands::exchange_disable_mailbox,
        exchange_commands::exchange_update_mailbox,
        exchange_commands::exchange_get_mailbox_statistics,
        exchange_commands::exchange_get_mailbox_permissions,
        exchange_commands::exchange_add_mailbox_permission,
        exchange_commands::exchange_remove_mailbox_permission,
        exchange_commands::exchange_get_forwarding,
        exchange_commands::exchange_get_ooo,
        exchange_commands::exchange_set_ooo,
        exchange_commands::exchange_list_groups,
        exchange_commands::exchange_get_group,
        exchange_commands::exchange_create_group,
        exchange_commands::exchange_update_group,
        exchange_commands::exchange_remove_group,
        exchange_commands::exchange_list_group_members,
        exchange_commands::exchange_add_group_member,
        exchange_commands::exchange_remove_group_member,
        exchange_commands::exchange_list_dynamic_groups,
        exchange_commands::exchange_list_transport_rules,
        exchange_commands::exchange_get_transport_rule,
        exchange_commands::exchange_create_transport_rule,
        exchange_commands::exchange_update_transport_rule,
        exchange_commands::exchange_remove_transport_rule,
        exchange_commands::exchange_enable_transport_rule,
        exchange_commands::exchange_disable_transport_rule,
        exchange_commands::exchange_list_send_connectors,
        exchange_commands::exchange_get_send_connector,
        exchange_commands::exchange_list_receive_connectors,
        exchange_commands::exchange_get_receive_connector,
        exchange_commands::exchange_list_inbound_connectors,
        exchange_commands::exchange_list_outbound_connectors,
        exchange_commands::exchange_message_trace,
        exchange_commands::exchange_message_tracking_log,
        exchange_commands::exchange_list_queues,
        exchange_commands::exchange_get_queue,
        exchange_commands::exchange_retry_queue,
        exchange_commands::exchange_suspend_queue,
        exchange_commands::exchange_resume_queue,
        exchange_commands::exchange_queue_summary,
        exchange_commands::exchange_list_calendar_permissions,
        exchange_commands::exchange_set_calendar_permission,
        exchange_commands::exchange_remove_calendar_permission,
        exchange_commands::exchange_get_booking_config,
        exchange_commands::exchange_set_booking_config,
        exchange_commands::exchange_list_public_folders,
        exchange_commands::exchange_get_public_folder,
        exchange_commands::exchange_create_public_folder,
        exchange_commands::exchange_remove_public_folder,
        exchange_commands::exchange_mail_enable_public_folder,
        exchange_commands::exchange_mail_disable_public_folder,
        exchange_commands::exchange_get_public_folder_statistics,
        exchange_commands::exchange_list_address_policies,
        exchange_commands::exchange_get_address_policy,
        exchange_commands::exchange_apply_address_policy,
        exchange_commands::exchange_list_accepted_domains,
        exchange_commands::exchange_list_address_lists,
        exchange_commands::exchange_list_migration_batches,
        exchange_commands::exchange_get_migration_batch,
        exchange_commands::exchange_start_migration_batch,
        exchange_commands::exchange_stop_migration_batch,
        exchange_commands::exchange_complete_migration_batch,
        exchange_commands::exchange_remove_migration_batch,
        exchange_commands::exchange_list_migration_users,
        exchange_commands::exchange_list_move_requests,
        exchange_commands::exchange_get_move_request_statistics,
        exchange_commands::exchange_new_move_request,
        exchange_commands::exchange_remove_move_request,
        exchange_commands::exchange_list_retention_policies,
        exchange_commands::exchange_get_retention_policy,
        exchange_commands::exchange_list_retention_tags,
        exchange_commands::exchange_get_retention_tag,
        exchange_commands::exchange_get_mailbox_hold,
        exchange_commands::exchange_enable_litigation_hold,
        exchange_commands::exchange_disable_litigation_hold,
        exchange_commands::exchange_list_dlp_policies,
        exchange_commands::exchange_get_dlp_policy,
        exchange_commands::exchange_list_servers,
        exchange_commands::exchange_get_server,
        exchange_commands::exchange_list_databases,
        exchange_commands::exchange_get_database,
        exchange_commands::exchange_mount_database,
        exchange_commands::exchange_dismount_database,
        exchange_commands::exchange_list_dags,
        exchange_commands::exchange_get_dag,
        exchange_commands::exchange_get_dag_copy_status,
        exchange_commands::exchange_test_replication_health,
        exchange_commands::exchange_service_health,
        exchange_commands::exchange_service_issues,
        exchange_commands::exchange_test_mailflow,
        exchange_commands::exchange_test_service_health,
        exchange_commands::exchange_get_server_component_state,
        // Exchange – Mail Contacts & Mail Users
        exchange_commands::exchange_list_mail_contacts,
        exchange_commands::exchange_get_mail_contact,
        exchange_commands::exchange_create_mail_contact,
        exchange_commands::exchange_update_mail_contact,
        exchange_commands::exchange_remove_mail_contact,
        exchange_commands::exchange_list_mail_users,
        exchange_commands::exchange_get_mail_user,
        exchange_commands::exchange_create_mail_user,
        exchange_commands::exchange_remove_mail_user,
        // Exchange – Shared / Resource Mailboxes
        exchange_commands::exchange_convert_mailbox,
        exchange_commands::exchange_list_shared_mailboxes,
        exchange_commands::exchange_list_room_mailboxes,
        exchange_commands::exchange_list_equipment_mailboxes,
        exchange_commands::exchange_add_automapping,
        exchange_commands::exchange_remove_automapping,
        exchange_commands::exchange_add_send_as,
        exchange_commands::exchange_remove_send_as,
        exchange_commands::exchange_add_send_on_behalf,
        exchange_commands::exchange_remove_send_on_behalf,
        exchange_commands::exchange_list_room_lists,
        // Exchange – Archive Mailboxes
        exchange_commands::exchange_get_archive_info,
        exchange_commands::exchange_enable_archive,
        exchange_commands::exchange_disable_archive,
        exchange_commands::exchange_enable_auto_expanding_archive,
        exchange_commands::exchange_set_archive_quota,
        exchange_commands::exchange_get_archive_statistics,
        // Exchange – Mobile Devices
        exchange_commands::exchange_list_mobile_devices,
        exchange_commands::exchange_get_mobile_device_statistics,
        exchange_commands::exchange_wipe_mobile_device,
        exchange_commands::exchange_block_mobile_device,
        exchange_commands::exchange_allow_mobile_device,
        exchange_commands::exchange_remove_mobile_device,
        exchange_commands::exchange_list_all_mobile_devices,
        // Exchange – Inbox Rules
        exchange_commands::exchange_list_inbox_rules,
        exchange_commands::exchange_get_inbox_rule,
        exchange_commands::exchange_create_inbox_rule,
        exchange_commands::exchange_update_inbox_rule,
        exchange_commands::exchange_remove_inbox_rule,
        exchange_commands::exchange_enable_inbox_rule,
        exchange_commands::exchange_disable_inbox_rule,
        // Exchange – Policies
        exchange_commands::exchange_list_owa_policies,
        exchange_commands::exchange_get_owa_policy,
        exchange_commands::exchange_set_owa_policy,
        exchange_commands::exchange_list_mobile_device_policies,
        exchange_commands::exchange_get_mobile_device_policy,
        exchange_commands::exchange_set_mobile_device_policy,
        exchange_commands::exchange_list_throttling_policies,
        exchange_commands::exchange_get_throttling_policy,
        // Exchange – Journal Rules
        exchange_commands::exchange_list_journal_rules,
        exchange_commands::exchange_get_journal_rule,
        exchange_commands::exchange_create_journal_rule,
        exchange_commands::exchange_remove_journal_rule,
        exchange_commands::exchange_enable_journal_rule,
        exchange_commands::exchange_disable_journal_rule,
        // Exchange – RBAC & Audit
        exchange_commands::exchange_list_role_groups,
        exchange_commands::exchange_get_role_group,
        exchange_commands::exchange_add_role_group_member,
        exchange_commands::exchange_remove_role_group_member,
        exchange_commands::exchange_list_management_roles,
        exchange_commands::exchange_get_management_role,
        exchange_commands::exchange_list_role_assignments,
        exchange_commands::exchange_search_admin_audit_log,
        exchange_commands::exchange_get_admin_audit_log_config,
        exchange_commands::exchange_search_mailbox_audit_log,
        exchange_commands::exchange_enable_mailbox_audit,
        exchange_commands::exchange_disable_mailbox_audit,
        // Exchange – Remote Domains
        exchange_commands::exchange_list_remote_domains,
        exchange_commands::exchange_get_remote_domain,
        exchange_commands::exchange_create_remote_domain,
        exchange_commands::exchange_update_remote_domain,
        exchange_commands::exchange_remove_remote_domain,
        // Exchange – Certificates
        exchange_commands::exchange_list_certificates,
        exchange_commands::exchange_get_certificate,
        exchange_commands::exchange_enable_certificate,
        exchange_commands::exchange_import_certificate,
        exchange_commands::exchange_remove_certificate,
        exchange_commands::exchange_new_certificate_request,
        // Exchange – Virtual Directories & Org Config
        exchange_commands::exchange_list_owa_virtual_directories,
        exchange_commands::exchange_list_ecp_virtual_directories,
        exchange_commands::exchange_list_activesync_virtual_directories,
        exchange_commands::exchange_list_ews_virtual_directories,
        exchange_commands::exchange_list_mapi_virtual_directories,
        exchange_commands::exchange_list_autodiscover_virtual_directories,
        exchange_commands::exchange_list_powershell_virtual_directories,
        exchange_commands::exchange_list_oab_virtual_directories,
        exchange_commands::exchange_set_virtual_directory_urls,
        exchange_commands::exchange_list_outlook_anywhere,
        exchange_commands::exchange_get_organization_config,
        exchange_commands::exchange_set_organization_config,
        exchange_commands::exchange_get_transport_config,
        exchange_commands::exchange_set_transport_config,
        // Exchange – Anti-Spam & Hygiene
        exchange_commands::exchange_get_content_filter_config,
        exchange_commands::exchange_set_content_filter_config,
        exchange_commands::exchange_get_connection_filter_config,
        exchange_commands::exchange_set_connection_filter_config,
        exchange_commands::exchange_get_sender_filter_config,
        exchange_commands::exchange_set_sender_filter_config,
        exchange_commands::exchange_list_quarantine_messages,
        exchange_commands::exchange_get_quarantine_message,
        exchange_commands::exchange_release_quarantine_message,
        exchange_commands::exchange_delete_quarantine_message,
        // Exchange – Mailbox Import/Export (PST)
        exchange_commands::exchange_new_mailbox_import_request,
        exchange_commands::exchange_new_mailbox_export_request,
        exchange_commands::exchange_list_mailbox_import_requests,
        exchange_commands::exchange_list_mailbox_export_requests,
        exchange_commands::exchange_remove_mailbox_import_request,
        exchange_commands::exchange_remove_mailbox_export_request,
        // Hetzner commands (sorng-hetzner)
        hetzner_commands::hetzner_connect,
        hetzner_commands::hetzner_disconnect,
        hetzner_commands::hetzner_list_connections,
        hetzner_commands::hetzner_ping,
        hetzner_commands::hetzner_get_dashboard,
        hetzner_commands::hetzner_list_servers,
        hetzner_commands::hetzner_get_server,
        hetzner_commands::hetzner_create_server,
        hetzner_commands::hetzner_delete_server,
        hetzner_commands::hetzner_start_server,
        hetzner_commands::hetzner_stop_server,
        hetzner_commands::hetzner_reboot_server,
        hetzner_commands::hetzner_rebuild_server,
        hetzner_commands::hetzner_reset_server,
        hetzner_commands::hetzner_change_server_type,
        hetzner_commands::hetzner_enable_rescue,
        hetzner_commands::hetzner_disable_rescue,
        hetzner_commands::hetzner_create_server_image,
        hetzner_commands::hetzner_enable_backup,
        hetzner_commands::hetzner_disable_backup,
        hetzner_commands::hetzner_get_server_metrics,
        hetzner_commands::hetzner_list_networks,
        hetzner_commands::hetzner_get_network,
        hetzner_commands::hetzner_create_network,
        hetzner_commands::hetzner_update_network,
        hetzner_commands::hetzner_delete_network,
        hetzner_commands::hetzner_add_subnet,
        hetzner_commands::hetzner_delete_subnet,
        hetzner_commands::hetzner_add_route,
        hetzner_commands::hetzner_delete_route,
        hetzner_commands::hetzner_list_firewalls,
        hetzner_commands::hetzner_get_firewall,
        hetzner_commands::hetzner_create_firewall,
        hetzner_commands::hetzner_update_firewall,
        hetzner_commands::hetzner_delete_firewall,
        hetzner_commands::hetzner_set_firewall_rules,
        hetzner_commands::hetzner_apply_firewall,
        hetzner_commands::hetzner_remove_firewall,
        hetzner_commands::hetzner_list_floating_ips,
        hetzner_commands::hetzner_get_floating_ip,
        hetzner_commands::hetzner_create_floating_ip,
        hetzner_commands::hetzner_delete_floating_ip,
        hetzner_commands::hetzner_assign_floating_ip,
        hetzner_commands::hetzner_unassign_floating_ip,
        hetzner_commands::hetzner_list_volumes,
        hetzner_commands::hetzner_get_volume,
        hetzner_commands::hetzner_create_volume,
        hetzner_commands::hetzner_delete_volume,
        hetzner_commands::hetzner_attach_volume,
        hetzner_commands::hetzner_detach_volume,
        hetzner_commands::hetzner_resize_volume,
        hetzner_commands::hetzner_list_load_balancers,
        hetzner_commands::hetzner_get_load_balancer,
        hetzner_commands::hetzner_create_load_balancer,
        hetzner_commands::hetzner_delete_load_balancer,
        hetzner_commands::hetzner_add_lb_service,
        hetzner_commands::hetzner_update_lb_service,
        hetzner_commands::hetzner_delete_lb_service,
        hetzner_commands::hetzner_add_lb_target,
        hetzner_commands::hetzner_remove_lb_target,
        hetzner_commands::hetzner_list_images,
        hetzner_commands::hetzner_get_image,
        hetzner_commands::hetzner_update_image,
        hetzner_commands::hetzner_delete_image,
        hetzner_commands::hetzner_list_ssh_keys,
        hetzner_commands::hetzner_get_ssh_key,
        hetzner_commands::hetzner_create_ssh_key,
        hetzner_commands::hetzner_update_ssh_key,
        hetzner_commands::hetzner_delete_ssh_key,
        hetzner_commands::hetzner_list_certificates,
        hetzner_commands::hetzner_get_certificate,
        hetzner_commands::hetzner_create_certificate,
        hetzner_commands::hetzner_update_certificate,
        hetzner_commands::hetzner_delete_certificate,
        hetzner_commands::hetzner_list_actions,
        hetzner_commands::hetzner_get_action,
        // SMTP commands
        smtp_commands::smtp_add_profile,
        smtp_commands::smtp_update_profile,
        smtp_commands::smtp_delete_profile,
        smtp_commands::smtp_get_profile,
        smtp_commands::smtp_find_profile_by_name,
        smtp_commands::smtp_list_profiles,
        smtp_commands::smtp_set_default_profile,
        smtp_commands::smtp_get_default_profile,
        smtp_commands::smtp_add_template,
        smtp_commands::smtp_update_template,
        smtp_commands::smtp_delete_template,
        smtp_commands::smtp_get_template,
        smtp_commands::smtp_find_template_by_name,
        smtp_commands::smtp_list_templates,
        smtp_commands::smtp_render_template,
        smtp_commands::smtp_extract_template_variables,
        smtp_commands::smtp_validate_template,
        smtp_commands::smtp_add_contact,
        smtp_commands::smtp_update_contact,
        smtp_commands::smtp_delete_contact,
        smtp_commands::smtp_get_contact,
        smtp_commands::smtp_find_contact_by_email,
        smtp_commands::smtp_search_contacts,
        smtp_commands::smtp_list_contacts,
        smtp_commands::smtp_list_contacts_in_group,
        smtp_commands::smtp_list_contacts_by_tag,
        smtp_commands::smtp_add_contact_to_group,
        smtp_commands::smtp_remove_contact_from_group,
        smtp_commands::smtp_add_contact_tag,
        smtp_commands::smtp_remove_contact_tag,
        smtp_commands::smtp_all_contact_tags,
        smtp_commands::smtp_create_contact_group,
        smtp_commands::smtp_delete_contact_group,
        smtp_commands::smtp_rename_contact_group,
        smtp_commands::smtp_list_contact_groups,
        smtp_commands::smtp_get_contact_group,
        smtp_commands::smtp_export_contacts_csv,
        smtp_commands::smtp_import_contacts_csv,
        smtp_commands::smtp_export_contacts_json,
        smtp_commands::smtp_import_contacts_json,
        smtp_commands::smtp_send_email,
        smtp_commands::smtp_enqueue,
        smtp_commands::smtp_enqueue_scheduled,
        smtp_commands::smtp_process_queue,
        smtp_commands::smtp_bulk_enqueue,
        smtp_commands::smtp_queue_summary,
        smtp_commands::smtp_queue_list,
        smtp_commands::smtp_queue_get,
        smtp_commands::smtp_queue_cancel,
        smtp_commands::smtp_queue_retry_failed,
        smtp_commands::smtp_queue_purge_completed,
        smtp_commands::smtp_queue_clear,
        smtp_commands::smtp_set_queue_config,
        smtp_commands::smtp_get_queue_config,
        smtp_commands::smtp_run_diagnostics,
        smtp_commands::smtp_quick_deliverability_check,
        smtp_commands::smtp_lookup_mx,
        smtp_commands::smtp_check_port,
        smtp_commands::smtp_suggest_security,
        smtp_commands::smtp_get_dns_txt,
        smtp_commands::smtp_validate_dkim_config,
        smtp_commands::smtp_generate_dkim_dns_record,
        smtp_commands::smtp_connection_summary,
        smtp_commands::smtp_stats,
        smtp_commands::smtp_build_message,
        smtp_commands::smtp_validate_email_address,
        smtp_commands::smtp_parse_email_address,
        smtp_commands::smtp_reverse_dns,
    ]
}
