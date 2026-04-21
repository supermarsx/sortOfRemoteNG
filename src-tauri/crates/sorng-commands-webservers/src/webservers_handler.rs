use crate::*;

pub fn is_command(command: &str) -> bool {
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

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
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
    ]
}
