use crate::*;

fn is_command_a(command: &str) -> bool {
    matches!(
        command,
        "os_detect_add_host"
            | "os_detect_remove_host"
            | "os_detect_update_host"
            | "os_detect_get_host"
            | "os_detect_list_hosts"
            | "os_detect_os_family"
            | "os_detect_linux_distro"
            | "os_detect_os_version"
            | "os_detect_macos_version"
            | "os_detect_bsd_version"
            | "os_detect_init_system"
            | "os_detect_init_services"
            | "os_detect_default_target"
            | "os_detect_package_managers"
            | "os_detect_installed_packages"
            | "os_detect_package_sources"
            | "os_detect_updates_available"
            | "os_detect_cpu"
            | "os_detect_memory"
            | "os_detect_disks"
            | "os_detect_network_interfaces"
            | "os_detect_gpus"
            | "os_detect_virtualization"
            | "os_detect_hardware_profile"
            | "os_detect_kernel"
            | "os_detect_architecture"
            | "os_detect_loaded_modules"
            | "os_detect_kernel_features"
            | "os_detect_selinux"
            | "os_detect_apparmor"
            | "os_detect_firewall"
            | "os_detect_available_services"
            | "os_detect_service_capabilities"
            | "os_detect_installed_runtimes"
            | "os_detect_web_servers"
            | "os_detect_databases"
            | "os_detect_container_runtimes"
            | "os_detect_default_shell"
            | "os_detect_available_shells"
            | "os_detect_locale"
            | "os_detect_timezone"
            | "os_detect_full_scan"
            | "os_detect_quick_scan"
            | "cron_add_host"
            | "cron_remove_host"
            | "cron_update_host"
            | "cron_get_host"
            | "cron_list_hosts"
            | "cron_list_user_crontabs"
            | "cron_get_crontab"
            | "cron_add_job"
            | "cron_remove_job"
            | "cron_update_job"
            | "cron_enable_job"
            | "cron_disable_job"
            | "cron_remove_crontab"
            | "cron_backup_crontab"
            | "cron_restore_crontab"
            | "cron_list_system_files"
            | "cron_get_system_file"
            | "cron_create_system_file"
            | "cron_delete_system_file"
            | "cron_list_periodic"
            | "cron_get_etc_crontab"
            | "cron_list_at_jobs"
            | "cron_get_at_job"
            | "cron_schedule_at_job"
            | "cron_schedule_batch_job"
            | "cron_remove_at_job"
            | "cron_get_at_access"
            | "cron_get_anacrontab"
            | "cron_add_anacron_entry"
            | "cron_remove_anacron_entry"
            | "cron_run_anacron"
            | "cron_get_anacron_timestamps"
            | "cron_validate_expression"
            | "cron_next_runs"
            | "cron_describe_expression"
            | "cron_get_access"
            | "cron_set_allow"
            | "cron_set_deny"
            | "cron_check_user_access"
            | "pam_add_host"
            | "pam_remove_host"
            | "pam_update_host"
            | "pam_get_host"
            | "pam_list_hosts"
            | "pam_list_services"
            | "pam_get_service"
            | "pam_create_service"
            | "pam_update_service"
            | "pam_delete_service"
            | "pam_backup_service"
            | "pam_restore_service"
            | "pam_validate_service"
            | "pam_list_modules"
            | "pam_get_module_info"
            | "pam_find_module_users"
            | "pam_get_limits"
            | "pam_set_limit"
            | "pam_remove_limit"
            | "pam_get_access_rules"
            | "pam_add_access_rule"
            | "pam_remove_access_rule"
            | "pam_get_time_rules"
            | "pam_add_time_rule"
            | "pam_remove_time_rule"
            | "pam_get_pwquality"
            | "pam_set_pwquality"
            | "pam_test_password"
            | "pam_get_namespace_rules"
            | "pam_add_namespace_rule"
            | "pam_remove_namespace_rule"
            | "pam_get_login_defs"
            | "pam_set_login_def"
            | "pam_get_password_policy"
            | "boot_add_host"
            | "boot_remove_host"
            | "boot_update_host"
            | "boot_get_host"
            | "boot_list_hosts"
            | "boot_detect_bootloader"
            | "boot_detect_boot_mode"
            | "boot_get_partitions"
            | "boot_get_grub_config"
            | "boot_set_grub_param"
            | "boot_get_grub_environment"
            | "boot_list_grub_entries"
            | "boot_set_default_grub_entry"
            | "boot_update_grub"
            | "boot_install_grub"
            | "boot_get_custom_entries"
            | "boot_set_custom_entries"
            | "boot_list_grub_scripts"
            | "boot_enable_grub_script"
            | "boot_disable_grub_script"
            | "boot_get_sd_config"
            | "boot_set_sd_config"
            | "boot_list_sd_entries"
            | "boot_create_sd_entry"
            | "boot_delete_sd_entry"
            | "boot_set_default_sd"
            | "boot_sd_status"
            | "boot_list_uefi_entries"
            | "boot_get_uefi_order"
            | "boot_set_uefi_order"
            | "boot_create_uefi_entry"
            | "boot_delete_uefi_entry"
            | "boot_set_next_boot"
            | "boot_get_uefi_info"
            | "boot_list_kernels"
            | "boot_get_running_kernel"
            | "boot_get_kernel_params"
            | "boot_set_kernel_params"
            | "boot_add_kernel_param"
            | "boot_remove_kernel_param"
            | "boot_list_initramfs"
            | "boot_rebuild_initramfs"
            | "boot_detect_initramfs_tool"
            | "proc_add_host"
            | "proc_remove_host"
            | "proc_update_host"
            | "proc_get_host"
            | "proc_list_hosts"
            | "proc_list_processes"
            | "proc_get_process"
            | "proc_get_process_tree"
            | "proc_get_process_children"
            | "proc_search_processes"
            | "proc_top_processes"
            | "proc_count_processes"
            | "proc_kill_process"
            | "proc_kill_processes"
            | "proc_killall"
            | "proc_renice"
            | "proc_list_open_files"
            | "proc_list_sockets"
            | "proc_list_process_sockets"
            | "proc_list_listening_ports"
            | "proc_get_status"
            | "proc_get_cmdline"
            | "proc_get_environ"
            | "proc_get_limits"
            | "proc_get_maps"
            | "proc_get_io"
            | "proc_get_namespaces"
            | "proc_get_cgroup"
            | "proc_get_load_average"
            | "proc_get_uptime"
            | "proc_get_meminfo"
            | "proc_get_cpu_stats"
            | "time_add_host"
            | "time_remove_host"
            | "time_update_host"
            | "time_get_host"
            | "time_list_hosts"
            | "time_get_status"
            | "time_set_timezone"
            | "time_list_timezones"
            | "time_set_time"
            | "time_set_ntp"
            | "time_get_chrony_config"
            | "time_chrony_add_server"
            | "time_chrony_remove_server"
            | "time_chrony_get_sources"
            | "time_chrony_get_tracking"
            | "time_chrony_makestep"
            | "time_get_ntpd_config"
            | "time_ntpd_add_server"
            | "time_ntpd_remove_server"
            | "time_ntpd_get_peers"
            | "time_ntpd_get_status"
            | "time_get_hwclock"
            | "time_sync_hwclock_from_system"
            | "time_sync_system_from_hwclock"
            | "time_get_hwclock_drift"
            | "time_detect_ntp"
            | "time_is_synced"
            | "kernel_add_host"
            | "kernel_remove_host"
            | "kernel_update_host"
            | "kernel_get_host"
            | "kernel_list_hosts"
            | "kernel_list_modules"
            | "kernel_get_module_info"
            | "kernel_load_module"
            | "kernel_unload_module"
            | "kernel_get_module_params"
            | "kernel_set_module_param"
            | "kernel_list_available_modules"
            | "kernel_blacklist_module"
            | "kernel_unblacklist_module"
            | "kernel_list_blacklisted"
            | "kernel_list_autoload"
            | "kernel_add_autoload"
            | "kernel_remove_autoload"
            | "kernel_get_all_sysctl"
            | "kernel_get_sysctl"
            | "kernel_set_sysctl"
            | "kernel_set_sysctl_persistent"
            | "kernel_remove_sysctl_persistent"
            | "kernel_reload_sysctl"
            | "kernel_get_network_sysctl"
            | "kernel_get_vm_sysctl"
            | "kernel_get_config"
            | "kernel_check_feature"
            | "kernel_detect_cgroup_version"
            | "kernel_detect_namespace_support"
            | "kernel_detect_security_modules"
            | "kernel_detect_io_schedulers"
            | "kernel_get_command_line"
            | "kernel_get_power_state"
            | "kernel_list_thermal_zones"
            | "kernel_get_cpu_governor"
            | "kernel_set_cpu_governor"
            | "kernel_list_governors"
            | "kernel_read_sysfs"
            | "kernel_write_sysfs"
            | "kernel_list_block_devices"
            | "cpanel_connect"
            | "cpanel_disconnect"
            | "cpanel_list_connections"
            | "cpanel_ping"
            | "cpanel_list_accounts"
            | "cpanel_get_account"
            | "cpanel_create_account"
            | "cpanel_suspend_account"
            | "cpanel_unsuspend_account"
            | "cpanel_terminate_account"
            | "cpanel_modify_account"
            | "cpanel_change_account_password"
            | "cpanel_list_packages"
            | "cpanel_get_account_summary"
            | "cpanel_list_suspended_accounts"
            | "cpanel_get_server_info"
            | "cpanel_list_domains"
            | "cpanel_list_all_domains"
            | "cpanel_create_addon_domain"
            | "cpanel_remove_addon_domain"
            | "cpanel_create_subdomain"
            | "cpanel_remove_subdomain"
            | "cpanel_park_domain"
            | "cpanel_unpark_domain"
            | "cpanel_list_email_accounts"
            | "cpanel_create_email_account"
            | "cpanel_delete_email_account"
            | "cpanel_change_email_password"
            | "cpanel_set_email_quota"
            | "cpanel_list_forwarders"
            | "cpanel_add_forwarder"
            | "cpanel_delete_forwarder"
            | "cpanel_list_autoresponders"
            | "cpanel_list_mailing_lists"
            | "cpanel_get_spam_settings"
            | "cpanel_list_mx_records"
            | "cpanel_list_databases"
            | "cpanel_create_database"
            | "cpanel_delete_database"
            | "cpanel_list_database_users"
            | "cpanel_create_database_user"
            | "cpanel_delete_database_user"
            | "cpanel_grant_database_privileges"
            | "cpanel_list_dns_zones"
            | "cpanel_get_dns_zone"
            | "cpanel_add_dns_record"
            | "cpanel_edit_dns_record"
            | "cpanel_remove_dns_record"
            | "cpanel_list_files"
            | "cpanel_create_directory"
            | "cpanel_delete_file"
            | "cpanel_get_disk_usage"
            | "cpanel_list_ssl_certs"
            | "cpanel_get_ssl_status"
            | "cpanel_install_ssl"
            | "cpanel_generate_csr"
            | "cpanel_autossl_check"
            | "cpanel_list_backups"
            | "cpanel_create_full_backup"
            | "cpanel_restore_file"
            | "cpanel_get_backup_config"
            | "cpanel_trigger_server_backup"
            | "cpanel_list_ftp_accounts"
            | "cpanel_create_ftp_account"
            | "cpanel_delete_ftp_account"
            | "cpanel_list_ftp_sessions"
            | "cpanel_list_cron_jobs"
            | "cpanel_add_cron_job"
            | "cpanel_edit_cron_job"
            | "cpanel_delete_cron_job"
            | "cpanel_get_bandwidth"
            | "cpanel_get_resource_usage"
            | "cpanel_get_error_log"
            | "cpanel_get_server_load"
            | "cpanel_list_php_versions"
            | "cpanel_get_domain_php_version"
            | "cpanel_set_domain_php_version"
            | "cpanel_get_php_config"
            | "cpanel_list_php_extensions"
            | "cpanel_list_blocked_ips"
            | "cpanel_block_ip"
            | "cpanel_unblock_ip"
            | "cpanel_list_ssh_keys"
            | "cpanel_import_ssh_key"
            | "cpanel_delete_ssh_key"
            | "cpanel_get_modsec_status"
            | "cpanel_set_modsec"
            | "php_connect"
            | "php_disconnect"
            | "php_list_connections"
            | "php_list_versions"
            | "php_get_default_version"
            | "php_get_version_detail"
            | "php_set_default_version"
            | "php_list_sapis"
            | "php_get_config_path"
            | "php_get_extension_dir"
            | "php_check_version_installed"
            | "php_list_fpm_pools"
            | "php_get_fpm_pool"
            | "php_create_fpm_pool"
            | "php_update_fpm_pool"
            | "php_delete_fpm_pool"
            | "php_enable_fpm_pool"
            | "php_disable_fpm_pool"
            | "php_get_fpm_pool_status"
            | "php_list_fpm_pool_processes"
            | "php_get_ini_file"
            | "php_list_ini_directives"
            | "php_get_ini_directive"
            | "php_set_ini_directive"
            | "php_remove_ini_directive"
            | "php_get_ini_scan_dir"
            | "php_list_loaded_ini_files"
            | "php_backup_ini"
            | "php_restore_ini"
            | "php_validate_ini"
            | "php_list_modules"
            | "php_get_module"
            | "php_enable_module"
            | "php_disable_module"
            | "php_install_module"
            | "php_uninstall_module"
            | "php_is_module_loaded"
            | "php_list_available_modules"
            | "php_list_pecl_packages"
            | "php_install_pecl_package"
            | "php_uninstall_pecl_package"
            | "php_get_opcache_status"
            | "php_get_opcache_config"
            | "php_reset_opcache"
            | "php_list_cached_scripts"
            | "php_invalidate_cached_script"
            | "php_is_opcache_enabled"
            | "php_update_opcache_config"
            | "php_get_session_config"
            | "php_update_session_config"
            | "php_get_session_stats"
            | "php_cleanup_sessions"
            | "php_list_session_files"
            | "php_get_session_save_path"
            | "php_get_composer_info"
            | "php_is_composer_installed"
            | "php_list_composer_global_packages"
            | "php_install_composer_global_package"
            | "php_remove_composer_global_package"
            | "php_get_composer_project"
            | "php_composer_install"
            | "php_composer_update"
            | "php_composer_require"
            | "php_composer_remove"
            | "php_composer_dump_autoload"
            | "php_composer_validate"
            | "php_composer_outdated"
            | "php_composer_clear_cache"
            | "php_composer_self_update"
            | "php_read_log"
            | "php_get_log_config"
            | "php_get_fpm_log_config"
            | "php_get_log_path"
            | "php_get_fpm_log_path"
            | "php_clear_log"
            | "php_tail_log"
            | "php_get_log_size"
            | "php_rotate_log"
            | "php_get_fpm_service_status"
            | "php_start_fpm"
            | "php_stop_fpm"
            | "php_restart_fpm"
            | "php_reload_fpm"
            | "php_enable_fpm"
            | "php_disable_fpm"
            | "php_test_fpm_config"
            | "php_get_fpm_master_process"
            | "php_list_fpm_worker_pids"
            | "php_graceful_restart_fpm"
            | "php_reopen_fpm_logs"
            | "php_list_all_fpm_services"
            | "pfsense_connect"
            | "pfsense_disconnect"
            | "pfsense_list_connections"
            | "pfsense_list_interfaces"
            | "pfsense_get_interface"
            | "pfsense_update_interface"
            | "pfsense_apply_interface_changes"
            | "pfsense_get_interface_stats"
            | "pfsense_list_firewall_rules"
            | "pfsense_get_firewall_rule"
            | "pfsense_create_firewall_rule"
            | "pfsense_update_firewall_rule"
            | "pfsense_delete_firewall_rule"
            | "pfsense_list_firewall_aliases"
            | "pfsense_get_firewall_alias"
            | "pfsense_create_firewall_alias"
            | "pfsense_update_firewall_alias"
            | "pfsense_delete_firewall_alias"
            | "pfsense_get_firewall_states"
            | "pfsense_flush_firewall_states"
            | "pfsense_list_nat_port_forwards"
            | "pfsense_create_nat_port_forward"
            | "pfsense_update_nat_port_forward"
            | "pfsense_delete_nat_port_forward"
            | "pfsense_list_nat_outbound"
            | "pfsense_create_nat_outbound"
            | "pfsense_update_nat_outbound"
            | "pfsense_delete_nat_outbound"
            | "pfsense_list_nat_1to1"
            | "pfsense_create_nat_1to1"
            | "pfsense_update_nat_1to1"
            | "pfsense_delete_nat_1to1"
            | "pfsense_get_dhcp_config"
            | "pfsense_update_dhcp_config"
            | "pfsense_list_dhcp_leases"
            | "pfsense_list_dhcp_static_mappings"
            | "pfsense_create_dhcp_static_mapping"
            | "pfsense_update_dhcp_static_mapping"
            | "pfsense_delete_dhcp_static_mapping"
            | "pfsense_get_dhcp_relay"
            | "pfsense_get_dns_resolver_config"
            | "pfsense_update_dns_resolver_config"
            | "pfsense_list_dns_host_overrides"
            | "pfsense_create_dns_host_override"
            | "pfsense_delete_dns_host_override"
            | "pfsense_list_dns_domain_overrides"
            | "pfsense_flush_dns_cache"
            | "pfsense_get_dns_cache_stats"
            | "pfsense_list_openvpn_servers"
            | "pfsense_get_openvpn_server"
            | "pfsense_create_openvpn_server"
            | "pfsense_delete_openvpn_server"
            | "pfsense_list_openvpn_clients"
            | "pfsense_list_ipsec_tunnels"
            | "pfsense_list_wireguard_tunnels"
            | "pfsense_list_wireguard_peers"
            | "pfsense_list_routes"
            | "pfsense_create_route"
            | "pfsense_delete_route"
            | "pfsense_list_gateways"
            | "pfsense_get_gateway_status"
            | "pfsense_get_routing_table"
            | "pfsense_list_services"
            | "pfsense_get_service_status"
            | "pfsense_start_service"
            | "pfsense_stop_service"
            | "pfsense_restart_service"
            | "pfsense_get_system_info"
            | "pfsense_get_system_updates"
            | "pfsense_get_general_config"
            | "pfsense_update_general_config"
            | "pfsense_reboot"
            | "pfsense_halt"
            | "pfsense_list_cas"
            | "pfsense_list_certs"
            | "pfsense_create_cert"
            | "pfsense_delete_cert"
            | "pfsense_list_users"
            | "pfsense_get_user"
            | "pfsense_create_user"
            | "pfsense_delete_user"
            | "pfsense_list_groups"
            | "pfsense_get_arp_table"
            | "pfsense_get_ndp_table"
            | "pfsense_dns_lookup"
            | "pfsense_ping"
            | "pfsense_traceroute"
            | "pfsense_get_pfinfo"
            | "pfsense_get_system_log"
            | "pfsense_list_backups"
            | "pfsense_create_backup"
            | "pfsense_delete_backup"
    )
}

fn is_command_b(command: &str) -> bool {
    matches!(
        command,
        "mysql_admin_connect"
            | "mysql_admin_disconnect"
            | "mysql_admin_list_connections"
            | "mysql_admin_list_users"
            | "mysql_admin_get_user"
            | "mysql_admin_create_user"
            | "mysql_admin_drop_user"
            | "mysql_admin_set_password"
            | "mysql_admin_flush_privileges"
            | "mysql_admin_get_slave_status"
            | "mysql_admin_start_slave"
            | "mysql_admin_stop_slave"
            | "mysql_admin_reset_slave"
            | "mysql_admin_change_master"
            | "mysql_admin_skip_counter"
            | "mysql_admin_list_databases"
            | "mysql_admin_create_database"
            | "mysql_admin_drop_database"
            | "mysql_admin_get_database_size"
            | "mysql_admin_list_tables"
            | "mysql_admin_describe_table"
            | "mysql_admin_optimize_table"
            | "mysql_admin_repair_table"
            | "mysql_admin_analyze_table"
            | "mysql_admin_check_table"
            | "mysql_admin_explain_query"
            | "mysql_admin_get_innodb_status"
            | "mysql_admin_get_buffer_pool_stats"
            | "mysql_admin_get_global_status"
            | "mysql_admin_create_backup"
            | "mysql_admin_restore_backup"
            | "mysql_admin_list_backup_files"
            | "mysql_admin_list_processes"
            | "mysql_admin_kill_process"
            | "mysql_admin_list_binlogs"
            | "pg_admin_connect"
            | "pg_admin_disconnect"
            | "pg_admin_list_connections"
            | "pg_admin_list_roles"
            | "pg_admin_get_role"
            | "pg_admin_create_role"
            | "pg_admin_drop_role"
            | "pg_admin_alter_role"
            | "pg_admin_set_role_password"
            | "pg_admin_grant_role"
            | "pg_admin_revoke_role"
            | "pg_admin_list_databases"
            | "pg_admin_get_database"
            | "pg_admin_create_database"
            | "pg_admin_drop_database"
            | "pg_admin_get_database_size"
            | "pg_admin_reload_hba"
            | "pg_admin_get_replication_status"
            | "pg_admin_list_replication_slots"
            | "pg_admin_create_replication_slot"
            | "pg_admin_drop_replication_slot"
            | "pg_admin_get_replication_lag"
            | "pg_admin_vacuum_table"
            | "pg_admin_vacuum_database"
            | "pg_admin_get_bloat"
            | "pg_admin_install_extension"
            | "pg_admin_uninstall_extension"
            | "pg_admin_get_extension"
            | "pg_admin_list_available_extensions"
            | "pg_admin_get_table_stats"
            | "pg_admin_get_index_stats"
            | "pg_admin_reset_stats"
            | "pg_admin_list_wal_files"
            | "pg_admin_switch_wal"
            | "pg_admin_list_tablespaces"
            | "pg_admin_get_tablespace"
            | "pg_admin_create_tablespace"
            | "pg_admin_drop_tablespace"
            | "pg_admin_get_tablespace_size"
            | "pg_admin_list_schemas"
            | "pg_admin_get_schema"
            | "pg_admin_create_schema"
            | "pg_admin_drop_schema"
            | "pg_admin_list_schema_tables"
            | "pg_admin_list_backup_files"
            | "pg_admin_add_hba"
            | "pg_admin_alter_database_owner"
            | "pg_admin_alter_schema_owner"
            | "pg_admin_alter_tablespace_owner"
            | "pg_admin_analyze"
            | "pg_admin_checkpoint"
            | "pg_admin_create_logical_replication_slot"
            | "pg_admin_create_physical_replication_slot"
            | "pg_admin_get_activity"
            | "pg_admin_get_archive_status"
            | "pg_admin_get_autovacuum_config"
            | "pg_admin_get_backup_size"
            | "pg_admin_get_current_lsn"
            | "pg_admin_get_database_connections"
            | "pg_admin_get_database_stats"
            | "pg_admin_get_hba_raw"
            | "pg_admin_get_locks"
            | "pg_admin_get_setting"
            | "pg_admin_get_settings"
            | "pg_admin_get_vacuum_stats"
            | "pg_admin_get_wal_info"
            | "pg_admin_get_wal_receiver_status"
            | "pg_admin_get_wal_size"
            | "pg_admin_grant_schema"
            | "pg_admin_list_database_schemas"
            | "pg_admin_list_hba"
            | "pg_admin_list_installed_extensions"
            | "pg_admin_list_role_memberships"
            | "pg_admin_list_schema_functions"
            | "pg_admin_list_schema_views"
            | "pg_admin_list_tablespace_objects"
            | "pg_admin_pg_basebackup"
            | "pg_admin_pg_dump"
            | "pg_admin_pg_dumpall"
            | "pg_admin_pg_restore"
            | "pg_admin_promote_standby"
            | "pg_admin_reindex"
            | "pg_admin_reload_config"
            | "pg_admin_remove_hba"
            | "pg_admin_rename_database"
            | "pg_admin_rename_role"
            | "pg_admin_rename_schema"
            | "pg_admin_rename_tablespace"
            | "pg_admin_revoke_schema"
            | "pg_admin_set_autovacuum_config"
            | "pg_admin_set_hba_raw"
            | "pg_admin_set_setting"
            | "pg_admin_terminate_connections"
            | "pg_admin_update_extension"
            | "pg_admin_update_hba"
            | "pg_admin_validate_hba"
            | "pg_admin_verify_backup"
            | "prometheus_connect"
            | "prometheus_disconnect"
            | "prometheus_list_connections"
            | "prometheus_instant_query"
            | "prometheus_range_query"
            | "prometheus_label_values"
            | "prometheus_label_names"
            | "prometheus_series"
            | "prometheus_list_targets"
            | "prometheus_list_rules"
            | "prometheus_list_alerts"
            | "prometheus_get_config"
            | "prometheus_reload_config"
            | "prometheus_get_flags"
            | "prometheus_get_tsdb_status"
            | "prometheus_list_metadata"
            | "prometheus_federate"
            | "prometheus_list_recording_rules"
            | "prometheus_list_silences"
            | "prometheus_get_silence"
            | "prometheus_create_silence"
            | "prometheus_delete_silence"
            | "grafana_connect"
            | "grafana_disconnect"
            | "grafana_list_connections"
            | "grafana_search_dashboards"
            | "grafana_get_dashboard"
            | "grafana_delete_dashboard"
            | "grafana_get_home_dashboard"
            | "grafana_list_datasources"
            | "grafana_get_datasource"
            | "grafana_create_datasource"
            | "grafana_delete_datasource"
            | "grafana_test_datasource"
            | "grafana_list_folders"
            | "grafana_get_folder"
            | "grafana_create_folder"
            | "grafana_delete_folder"
            | "grafana_get_current_org"
            | "grafana_list_orgs"
            | "grafana_get_org"
            | "grafana_create_org"
            | "grafana_delete_org"
            | "grafana_list_users"
            | "grafana_get_user"
            | "grafana_create_user"
            | "grafana_delete_user"
            | "grafana_list_teams"
            | "grafana_get_team"
            | "grafana_create_team"
            | "grafana_delete_team"
            | "grafana_list_team_members"
            | "grafana_add_team_member"
            | "grafana_remove_team_member"
            | "grafana_list_alert_rules"
            | "grafana_get_alert_rule"
            | "grafana_create_alert_rule"
            | "grafana_delete_alert_rule"
            | "grafana_pause_alert_rule"
            | "grafana_list_annotations"
            | "grafana_create_annotation"
            | "grafana_delete_annotation"
            | "grafana_list_playlists"
            | "grafana_get_playlist"
            | "grafana_delete_playlist"
            | "grafana_list_snapshots"
            | "grafana_create_snapshot"
            | "grafana_delete_snapshot"
            | "ups_connect"
            | "ups_disconnect"
            | "ups_list_connections"
            | "ups_list_devices"
            | "ups_get_device"
            | "ups_list_device_variables"
            | "ups_get_device_variable"
            | "ups_set_device_variable"
            | "ups_list_device_commands"
            | "ups_run_device_command"
            | "ups_get_status"
            | "ups_is_on_battery"
            | "ups_is_online"
            | "ups_get_load"
            | "ups_get_input_voltage"
            | "ups_get_output_voltage"
            | "ups_get_temperature"
            | "ups_list_all_status"
            | "ups_get_battery_info"
            | "ups_get_battery_charge"
            | "ups_get_battery_runtime"
            | "ups_get_battery_voltage"
            | "ups_is_battery_low"
            | "ups_battery_needs_replacement"
            | "ups_get_battery_health"
            | "ups_list_events"
            | "ups_get_recent_events"
            | "ups_clear_event_log"
            | "ups_list_outlets"
            | "ups_get_outlet"
            | "ups_switch_outlet_on"
            | "ups_switch_outlet_off"
            | "ups_get_outlet_delay"
            | "ups_set_outlet_delay"
            | "ups_list_schedules"
            | "ups_get_schedule"
            | "ups_create_schedule"
            | "ups_update_schedule"
            | "ups_delete_schedule"
            | "ups_enable_schedule"
            | "ups_disable_schedule"
            | "ups_list_thresholds"
            | "ups_get_threshold"
            | "ups_set_threshold"
            | "ups_get_low_battery_threshold"
            | "ups_set_low_battery_threshold"
            | "ups_quick_test"
            | "ups_deep_test"
            | "ups_abort_test"
            | "ups_get_last_test_result"
            | "ups_calibrate_battery"
            | "ups_get_test_history"
            | "ups_get_nut_config"
            | "ups_get_ups_conf"
            | "ups_set_ups_conf"
            | "ups_get_upsd_conf"
            | "ups_set_upsd_conf"
            | "ups_reload_upsd"
            | "ups_reload_upsmon"
            | "ups_restart_nut"
            | "ups_get_nut_mode"
            | "ups_set_nut_mode"
            | "ups_list_notifications"
            | "ups_get_notify_flags"
            | "ups_set_notify_flags"
            | "ups_get_notify_message"
            | "ups_set_notify_message"
            | "ups_get_notify_cmd"
            | "ups_set_notify_cmd"
            | "ups_test_notification"
            | "netbox_connect"
            | "netbox_disconnect"
            | "netbox_list_connections"
            | "netbox_ping"
            | "netbox_list_sites"
            | "netbox_get_site"
            | "netbox_create_site"
            | "netbox_update_site"
            | "netbox_partial_update_site"
            | "netbox_delete_site"
            | "netbox_list_sites_by_region"
            | "netbox_list_sites_by_group"
            | "netbox_list_racks"
            | "netbox_get_rack"
            | "netbox_create_rack"
            | "netbox_update_rack"
            | "netbox_partial_update_rack"
            | "netbox_delete_rack"
            | "netbox_get_rack_elevation"
            | "netbox_list_rack_reservations"
            | "netbox_list_devices"
            | "netbox_get_device"
            | "netbox_create_device"
            | "netbox_update_device"
            | "netbox_partial_update_device"
            | "netbox_delete_device"
            | "netbox_list_devices_by_site"
            | "netbox_list_devices_by_rack"
            | "netbox_list_device_types"
            | "netbox_get_device_type"
            | "netbox_list_manufacturers"
            | "netbox_get_manufacturer"
            | "netbox_list_platforms"
            | "netbox_get_platform"
            | "netbox_list_device_roles"
            | "netbox_get_device_role"
            | "netbox_render_device_config"
            | "netbox_list_interfaces"
            | "netbox_get_interface"
            | "netbox_create_interface"
            | "netbox_update_interface"
            | "netbox_partial_update_interface"
            | "netbox_delete_interface"
            | "netbox_list_interface_connections"
            | "netbox_list_ip_addresses"
            | "netbox_get_ip_address"
            | "netbox_create_ip_address"
            | "netbox_update_ip_address"
            | "netbox_delete_ip_address"
            | "netbox_list_prefixes"
            | "netbox_get_prefix"
            | "netbox_create_prefix"
            | "netbox_update_prefix"
            | "netbox_delete_prefix"
            | "netbox_get_available_ips"
            | "netbox_create_available_ip"
            | "netbox_get_available_prefixes"
            | "netbox_list_vrfs"
            | "netbox_get_vrf"
            | "netbox_create_vrf"
            | "netbox_update_vrf"
            | "netbox_delete_vrf"
            | "netbox_list_aggregates"
            | "netbox_get_aggregate"
            | "netbox_list_rirs"
            | "netbox_get_rir"
            | "netbox_list_ipam_roles"
            | "netbox_get_ipam_role"
            | "netbox_list_services"
            | "netbox_list_vlans"
            | "netbox_get_vlan"
            | "netbox_create_vlan"
            | "netbox_update_vlan"
            | "netbox_partial_update_vlan"
            | "netbox_delete_vlan"
            | "netbox_list_vlans_by_site"
            | "netbox_list_vlans_by_group"
            | "netbox_list_vlan_groups"
            | "netbox_get_vlan_group"
            | "netbox_create_vlan_group"
            | "netbox_update_vlan_group"
            | "netbox_delete_vlan_group"
            | "netbox_list_circuits"
            | "netbox_get_circuit"
            | "netbox_create_circuit"
            | "netbox_update_circuit"
            | "netbox_delete_circuit"
            | "netbox_list_circuit_providers"
            | "netbox_get_circuit_provider"
            | "netbox_create_circuit_provider"
            | "netbox_update_circuit_provider"
            | "netbox_delete_circuit_provider"
            | "netbox_list_circuit_types"
            | "netbox_get_circuit_type"
            | "netbox_list_circuit_terminations"
            | "netbox_list_cables"
            | "netbox_get_cable"
            | "netbox_create_cable"
            | "netbox_update_cable"
            | "netbox_delete_cable"
            | "netbox_trace_cable"
            | "netbox_list_tenants"
            | "netbox_get_tenant"
            | "netbox_create_tenant"
            | "netbox_update_tenant"
            | "netbox_partial_update_tenant"
            | "netbox_delete_tenant"
            | "netbox_list_tenant_groups"
            | "netbox_get_tenant_group"
            | "netbox_create_tenant_group"
            | "netbox_update_tenant_group"
            | "netbox_delete_tenant_group"
            | "netbox_list_contacts"
            | "netbox_get_contact"
            | "netbox_create_contact"
            | "netbox_update_contact"
            | "netbox_partial_update_contact"
            | "netbox_delete_contact"
            | "netbox_list_contact_groups"
            | "netbox_get_contact_group"
            | "netbox_create_contact_group"
            | "netbox_update_contact_group"
            | "netbox_delete_contact_group"
            | "netbox_list_contact_roles"
            | "netbox_list_contact_assignments"
            | "netbox_list_vms"
            | "netbox_get_vm"
            | "netbox_create_vm"
            | "netbox_update_vm"
            | "netbox_delete_vm"
            | "netbox_list_vm_interfaces"
            | "netbox_create_vm_interface"
            | "netbox_update_vm_interface"
            | "netbox_delete_vm_interface"
            | "netbox_list_clusters"
            | "netbox_get_cluster"
            | "netbox_create_cluster"
            | "netbox_update_cluster"
            | "netbox_delete_cluster"
            | "netbox_list_cluster_types"
            | "netbox_get_cluster_type"
            | "netbox_create_cluster_type"
            | "netbox_list_cluster_groups"
            | "port_knock_add_host"
            | "port_knock_remove_host"
            | "port_knock_update_host"
            | "port_knock_get_host"
            | "port_knock_list_hosts"
            | "port_knock_add_sequence"
            | "port_knock_remove_sequence"
            | "port_knock_get_sequence"
            | "port_knock_list_sequences"
            | "port_knock_generate_sequence"
            | "port_knock_encode_sequence_base64"
            | "port_knock_decode_sequence_base64"
            | "port_knock_calculate_complexity"
            | "port_knock_execute"
            | "port_knock_send_spa"
            | "port_knock_sequence_to_knockd"
            | "port_knock_encrypt_payload"
            | "port_knock_decrypt_payload"
            | "port_knock_generate_key"
            | "port_knock_detect_firewall"
            | "port_knock_firewall_accept_rule"
            | "port_knock_firewall_timed_rule"
            | "port_knock_firewall_remove_rule"
            | "port_knock_firewall_backup_command"
            | "port_knock_parse_knockd_config"
            | "port_knock_generate_knockd_config"
            | "port_knock_knockd_status_command"
            | "port_knock_knockd_install_command"
            | "port_knock_knockd_log_command"
            | "port_knock_parse_fwknop_access"
            | "port_knock_generate_fwknop_access"
            | "port_knock_build_fwknop_command"
            | "port_knock_fwknop_install_command"
            | "port_knock_generate_fwknop_keys"
            | "port_knock_generate_fwknop_client_rc"
            | "port_knock_create_profile"
            | "port_knock_update_profile"
            | "port_knock_delete_profile"
            | "port_knock_get_profile"
            | "port_knock_list_profiles"
            | "port_knock_export_profiles"
            | "port_knock_import_profiles"
            | "port_knock_search_profiles"
            | "port_knock_check_port_command"
            | "port_knock_banner_grab_command"
            | "port_knock_nmap_command"
            | "port_knock_rtt_command"
            | "port_knock_get_history"
            | "port_knock_filter_history"
            | "port_knock_get_statistics"
            | "port_knock_clear_history"
            | "port_knock_export_history_json"
            | "port_knock_export_history_csv"
            | "port_knock_get_recent_history"
            | "about_get_info"
            | "about_get_app_info"
            | "about_get_license_summary"
            | "about_get_all_license_texts"
            | "about_get_license_text"
            | "about_get_rust_deps"
            | "about_get_rust_deps_by_category"
            | "about_get_js_deps"
            | "about_get_js_deps_by_category"
            | "about_get_workspace_crates"
            | "about_get_workspace_crates_by_category"
            | "about_get_credits"
            | "about_search_deps"
            | "about_get_deps_by_license"
    )
}

fn is_command_h(command: &str) -> bool {
    matches!(
        command,
        // ── MAC (Linux Mandatory Access Control) – sorng-mac (43) ─────
        "mac_connect"
            | "mac_disconnect"
            | "mac_list_connections"
            | "mac_detect_system"
            | "mac_get_dashboard"
            | "mac_selinux_status"
            | "mac_selinux_get_mode"
            | "mac_selinux_set_mode"
            | "mac_selinux_list_booleans"
            | "mac_selinux_get_boolean"
            | "mac_selinux_set_boolean"
            | "mac_selinux_list_modules"
            | "mac_selinux_manage_module"
            | "mac_selinux_list_file_contexts"
            | "mac_selinux_add_file_context"
            | "mac_selinux_remove_file_context"
            | "mac_selinux_restorecon"
            | "mac_selinux_list_ports"
            | "mac_selinux_add_port_context"
            | "mac_selinux_list_users"
            | "mac_selinux_list_roles"
            | "mac_selinux_get_policy_info"
            | "mac_selinux_audit_log"
            | "mac_selinux_audit2allow"
            | "mac_apparmor_status"
            | "mac_apparmor_list_profiles"
            | "mac_apparmor_set_profile_mode"
            | "mac_apparmor_reload_profile"
            | "mac_apparmor_create_profile"
            | "mac_apparmor_delete_profile"
            | "mac_apparmor_get_profile_content"
            | "mac_apparmor_update_profile_content"
            | "mac_apparmor_audit_log"
            | "mac_tomoyo_status"
            | "mac_tomoyo_list_domains"
            | "mac_tomoyo_set_domain_mode"
            | "mac_tomoyo_list_rules"
            | "mac_smack_status"
            | "mac_smack_list_labels"
            | "mac_smack_list_rules"
            | "mac_smack_add_rule"
            | "mac_smack_remove_rule"
            | "mac_compliance_check"
    )
}

pub fn is_command(command: &str) -> bool {
    is_command_a(command)
        || is_command_b(command)
        || is_command_c(command)
        || is_command_d(command)
        || is_command_e(command)
        || is_command_f(command)
        || is_command_g(command)
        || is_command_h(command)
        || is_command_i(command)
        || is_command_j(command)
        || is_command_k(command)
        || is_command_l(command)
        || is_command_m(command)
        || is_command_r(command)
}

fn is_command_c(command: &str) -> bool {
    matches!(
        command,
        // ── HashiCorp Vault (54) ────────────────────────────────────
        "vault_connect"
            | "vault_disconnect"
            | "vault_list_connections"
            | "vault_get_dashboard"
            | "vault_seal_status"
            | "vault_seal"
            | "vault_unseal"
            | "vault_health"
            | "vault_leader"
            | "vault_kv_read"
            | "vault_kv_write"
            | "vault_kv_delete"
            | "vault_kv_list"
            | "vault_kv_undelete"
            | "vault_kv_destroy"
            | "vault_kv_metadata"
            | "vault_transit_create_key"
            | "vault_transit_list_keys"
            | "vault_transit_read_key"
            | "vault_transit_encrypt"
            | "vault_transit_decrypt"
            | "vault_transit_rotate_key"
            | "vault_transit_sign"
            | "vault_transit_verify"
            | "vault_pki_read_ca"
            | "vault_pki_issue_cert"
            | "vault_pki_list_certs"
            | "vault_pki_revoke_cert"
            | "vault_pki_list_roles"
            | "vault_pki_create_role"
            | "vault_list_auth_methods"
            | "vault_enable_auth"
            | "vault_disable_auth"
            | "vault_userpass_create"
            | "vault_userpass_list"
            | "vault_userpass_delete"
            | "vault_list_policies"
            | "vault_read_policy"
            | "vault_write_policy"
            | "vault_delete_policy"
            | "vault_list_audit_devices"
            | "vault_enable_audit"
            | "vault_disable_audit"
            | "vault_create_token"
            | "vault_lookup_token"
            | "vault_revoke_token"
            | "vault_renew_token"
            | "vault_read_lease"
            | "vault_list_leases"
            | "vault_renew_lease"
            | "vault_revoke_lease"
            | "vault_list_secret_engines"
            | "vault_mount_engine"
            | "vault_unmount_engine"
    )
}

fn build_c() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── HashiCorp Vault (54) ────────────────────────────────────
        hashicorp_vault_commands::vault_connect,
        hashicorp_vault_commands::vault_disconnect,
        hashicorp_vault_commands::vault_list_connections,
        hashicorp_vault_commands::vault_get_dashboard,
        hashicorp_vault_commands::vault_seal_status,
        hashicorp_vault_commands::vault_seal,
        hashicorp_vault_commands::vault_unseal,
        hashicorp_vault_commands::vault_health,
        hashicorp_vault_commands::vault_leader,
        hashicorp_vault_commands::vault_kv_read,
        hashicorp_vault_commands::vault_kv_write,
        hashicorp_vault_commands::vault_kv_delete,
        hashicorp_vault_commands::vault_kv_list,
        hashicorp_vault_commands::vault_kv_undelete,
        hashicorp_vault_commands::vault_kv_destroy,
        hashicorp_vault_commands::vault_kv_metadata,
        hashicorp_vault_commands::vault_transit_create_key,
        hashicorp_vault_commands::vault_transit_list_keys,
        hashicorp_vault_commands::vault_transit_read_key,
        hashicorp_vault_commands::vault_transit_encrypt,
        hashicorp_vault_commands::vault_transit_decrypt,
        hashicorp_vault_commands::vault_transit_rotate_key,
        hashicorp_vault_commands::vault_transit_sign,
        hashicorp_vault_commands::vault_transit_verify,
        hashicorp_vault_commands::vault_pki_read_ca,
        hashicorp_vault_commands::vault_pki_issue_cert,
        hashicorp_vault_commands::vault_pki_list_certs,
        hashicorp_vault_commands::vault_pki_revoke_cert,
        hashicorp_vault_commands::vault_pki_list_roles,
        hashicorp_vault_commands::vault_pki_create_role,
        hashicorp_vault_commands::vault_list_auth_methods,
        hashicorp_vault_commands::vault_enable_auth,
        hashicorp_vault_commands::vault_disable_auth,
        hashicorp_vault_commands::vault_userpass_create,
        hashicorp_vault_commands::vault_userpass_list,
        hashicorp_vault_commands::vault_userpass_delete,
        hashicorp_vault_commands::vault_list_policies,
        hashicorp_vault_commands::vault_read_policy,
        hashicorp_vault_commands::vault_write_policy,
        hashicorp_vault_commands::vault_delete_policy,
        hashicorp_vault_commands::vault_list_audit_devices,
        hashicorp_vault_commands::vault_enable_audit,
        hashicorp_vault_commands::vault_disable_audit,
        hashicorp_vault_commands::vault_create_token,
        hashicorp_vault_commands::vault_lookup_token,
        hashicorp_vault_commands::vault_revoke_token,
        hashicorp_vault_commands::vault_renew_token,
        hashicorp_vault_commands::vault_read_lease,
        hashicorp_vault_commands::vault_list_leases,
        hashicorp_vault_commands::vault_renew_lease,
        hashicorp_vault_commands::vault_revoke_lease,
        hashicorp_vault_commands::vault_list_secret_engines,
        hashicorp_vault_commands::vault_mount_engine,
        hashicorp_vault_commands::vault_unmount_engine,
    ]
}

fn build_a() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // OS Detection
        os_detect_commands::os_detect_add_host,
        os_detect_commands::os_detect_remove_host,
        os_detect_commands::os_detect_update_host,
        os_detect_commands::os_detect_get_host,
        os_detect_commands::os_detect_list_hosts,
        os_detect_commands::os_detect_os_family,
        os_detect_commands::os_detect_linux_distro,
        os_detect_commands::os_detect_os_version,
        os_detect_commands::os_detect_macos_version,
        os_detect_commands::os_detect_bsd_version,
        os_detect_commands::os_detect_init_system,
        os_detect_commands::os_detect_init_services,
        os_detect_commands::os_detect_default_target,
        os_detect_commands::os_detect_package_managers,
        os_detect_commands::os_detect_installed_packages,
        os_detect_commands::os_detect_package_sources,
        os_detect_commands::os_detect_updates_available,
        os_detect_commands::os_detect_cpu,
        os_detect_commands::os_detect_memory,
        os_detect_commands::os_detect_disks,
        os_detect_commands::os_detect_network_interfaces,
        os_detect_commands::os_detect_gpus,
        os_detect_commands::os_detect_virtualization,
        os_detect_commands::os_detect_hardware_profile,
        os_detect_commands::os_detect_kernel,
        os_detect_commands::os_detect_architecture,
        os_detect_commands::os_detect_loaded_modules,
        os_detect_commands::os_detect_kernel_features,
        os_detect_commands::os_detect_selinux,
        os_detect_commands::os_detect_apparmor,
        os_detect_commands::os_detect_firewall,
        os_detect_commands::os_detect_available_services,
        os_detect_commands::os_detect_service_capabilities,
        os_detect_commands::os_detect_installed_runtimes,
        os_detect_commands::os_detect_web_servers,
        os_detect_commands::os_detect_databases,
        os_detect_commands::os_detect_container_runtimes,
        os_detect_commands::os_detect_default_shell,
        os_detect_commands::os_detect_available_shells,
        os_detect_commands::os_detect_locale,
        os_detect_commands::os_detect_timezone,
        os_detect_commands::os_detect_full_scan,
        os_detect_commands::os_detect_quick_scan,
        // Cron
        cron_commands::cron_add_host,
        cron_commands::cron_remove_host,
        cron_commands::cron_update_host,
        cron_commands::cron_get_host,
        cron_commands::cron_list_hosts,
        cron_commands::cron_list_user_crontabs,
        cron_commands::cron_get_crontab,
        cron_commands::cron_add_job,
        cron_commands::cron_remove_job,
        cron_commands::cron_update_job,
        cron_commands::cron_enable_job,
        cron_commands::cron_disable_job,
        cron_commands::cron_remove_crontab,
        cron_commands::cron_backup_crontab,
        cron_commands::cron_restore_crontab,
        cron_commands::cron_list_system_files,
        cron_commands::cron_get_system_file,
        cron_commands::cron_create_system_file,
        cron_commands::cron_delete_system_file,
        cron_commands::cron_list_periodic,
        cron_commands::cron_get_etc_crontab,
        cron_commands::cron_list_at_jobs,
        cron_commands::cron_get_at_job,
        cron_commands::cron_schedule_at_job,
        cron_commands::cron_schedule_batch_job,
        cron_commands::cron_remove_at_job,
        cron_commands::cron_get_at_access,
        cron_commands::cron_get_anacrontab,
        cron_commands::cron_add_anacron_entry,
        cron_commands::cron_remove_anacron_entry,
        cron_commands::cron_run_anacron,
        cron_commands::cron_get_anacron_timestamps,
        cron_commands::cron_validate_expression,
        cron_commands::cron_next_runs,
        cron_commands::cron_describe_expression,
        cron_commands::cron_get_access,
        cron_commands::cron_set_allow,
        cron_commands::cron_set_deny,
        cron_commands::cron_check_user_access,
        // PAM
        pam_commands::pam_add_host,
        pam_commands::pam_remove_host,
        pam_commands::pam_update_host,
        pam_commands::pam_get_host,
        pam_commands::pam_list_hosts,
        pam_commands::pam_list_services,
        pam_commands::pam_get_service,
        pam_commands::pam_create_service,
        pam_commands::pam_update_service,
        pam_commands::pam_delete_service,
        pam_commands::pam_backup_service,
        pam_commands::pam_restore_service,
        pam_commands::pam_validate_service,
        pam_commands::pam_list_modules,
        pam_commands::pam_get_module_info,
        pam_commands::pam_find_module_users,
        pam_commands::pam_get_limits,
        pam_commands::pam_set_limit,
        pam_commands::pam_remove_limit,
        pam_commands::pam_get_access_rules,
        pam_commands::pam_add_access_rule,
        pam_commands::pam_remove_access_rule,
        pam_commands::pam_get_time_rules,
        pam_commands::pam_add_time_rule,
        pam_commands::pam_remove_time_rule,
        pam_commands::pam_get_pwquality,
        pam_commands::pam_set_pwquality,
        pam_commands::pam_test_password,
        pam_commands::pam_get_namespace_rules,
        pam_commands::pam_add_namespace_rule,
        pam_commands::pam_remove_namespace_rule,
        pam_commands::pam_get_login_defs,
        pam_commands::pam_set_login_def,
        pam_commands::pam_get_password_policy,
        // Bootloader
        bootloader_commands::boot_add_host,
        bootloader_commands::boot_remove_host,
        bootloader_commands::boot_update_host,
        bootloader_commands::boot_get_host,
        bootloader_commands::boot_list_hosts,
        bootloader_commands::boot_detect_bootloader,
        bootloader_commands::boot_detect_boot_mode,
        bootloader_commands::boot_get_partitions,
        bootloader_commands::boot_get_grub_config,
        bootloader_commands::boot_set_grub_param,
        bootloader_commands::boot_get_grub_environment,
        bootloader_commands::boot_list_grub_entries,
        bootloader_commands::boot_set_default_grub_entry,
        bootloader_commands::boot_update_grub,
        bootloader_commands::boot_install_grub,
        bootloader_commands::boot_get_custom_entries,
        bootloader_commands::boot_set_custom_entries,
        bootloader_commands::boot_list_grub_scripts,
        bootloader_commands::boot_enable_grub_script,
        bootloader_commands::boot_disable_grub_script,
        bootloader_commands::boot_get_sd_config,
        bootloader_commands::boot_set_sd_config,
        bootloader_commands::boot_list_sd_entries,
        bootloader_commands::boot_create_sd_entry,
        bootloader_commands::boot_delete_sd_entry,
        bootloader_commands::boot_set_default_sd,
        bootloader_commands::boot_sd_status,
        bootloader_commands::boot_list_uefi_entries,
        bootloader_commands::boot_get_uefi_order,
        bootloader_commands::boot_set_uefi_order,
        bootloader_commands::boot_create_uefi_entry,
        bootloader_commands::boot_delete_uefi_entry,
        bootloader_commands::boot_set_next_boot,
        bootloader_commands::boot_get_uefi_info,
        bootloader_commands::boot_list_kernels,
        bootloader_commands::boot_get_running_kernel,
        bootloader_commands::boot_get_kernel_params,
        bootloader_commands::boot_set_kernel_params,
        bootloader_commands::boot_add_kernel_param,
        bootloader_commands::boot_remove_kernel_param,
        bootloader_commands::boot_list_initramfs,
        bootloader_commands::boot_rebuild_initramfs,
        bootloader_commands::boot_detect_initramfs_tool,
        // Process Management
        proc_mgmt_commands::proc_add_host,
        proc_mgmt_commands::proc_remove_host,
        proc_mgmt_commands::proc_update_host,
        proc_mgmt_commands::proc_get_host,
        proc_mgmt_commands::proc_list_hosts,
        proc_mgmt_commands::proc_list_processes,
        proc_mgmt_commands::proc_get_process,
        proc_mgmt_commands::proc_get_process_tree,
        proc_mgmt_commands::proc_get_process_children,
        proc_mgmt_commands::proc_search_processes,
        proc_mgmt_commands::proc_top_processes,
        proc_mgmt_commands::proc_count_processes,
        proc_mgmt_commands::proc_kill_process,
        proc_mgmt_commands::proc_kill_processes,
        proc_mgmt_commands::proc_killall,
        proc_mgmt_commands::proc_renice,
        proc_mgmt_commands::proc_list_open_files,
        proc_mgmt_commands::proc_list_sockets,
        proc_mgmt_commands::proc_list_process_sockets,
        proc_mgmt_commands::proc_list_listening_ports,
        proc_mgmt_commands::proc_get_status,
        proc_mgmt_commands::proc_get_cmdline,
        proc_mgmt_commands::proc_get_environ,
        proc_mgmt_commands::proc_get_limits,
        proc_mgmt_commands::proc_get_maps,
        proc_mgmt_commands::proc_get_io,
        proc_mgmt_commands::proc_get_namespaces,
        proc_mgmt_commands::proc_get_cgroup,
        proc_mgmt_commands::proc_get_load_average,
        proc_mgmt_commands::proc_get_uptime,
        proc_mgmt_commands::proc_get_meminfo,
        proc_mgmt_commands::proc_get_cpu_stats,
        // Time/NTP
        time_ntp_commands::time_add_host,
        time_ntp_commands::time_remove_host,
        time_ntp_commands::time_update_host,
        time_ntp_commands::time_get_host,
        time_ntp_commands::time_list_hosts,
        time_ntp_commands::time_get_status,
        time_ntp_commands::time_set_timezone,
        time_ntp_commands::time_list_timezones,
        time_ntp_commands::time_set_time,
        time_ntp_commands::time_set_ntp,
        time_ntp_commands::time_get_chrony_config,
        time_ntp_commands::time_chrony_add_server,
        time_ntp_commands::time_chrony_remove_server,
        time_ntp_commands::time_chrony_get_sources,
        time_ntp_commands::time_chrony_get_tracking,
        time_ntp_commands::time_chrony_makestep,
        time_ntp_commands::time_get_ntpd_config,
        time_ntp_commands::time_ntpd_add_server,
        time_ntp_commands::time_ntpd_remove_server,
        time_ntp_commands::time_ntpd_get_peers,
        time_ntp_commands::time_ntpd_get_status,
        time_ntp_commands::time_get_hwclock,
        time_ntp_commands::time_sync_hwclock_from_system,
        time_ntp_commands::time_sync_system_from_hwclock,
        time_ntp_commands::time_get_hwclock_drift,
        time_ntp_commands::time_detect_ntp,
        time_ntp_commands::time_is_synced,
        // Kernel Management
        kernel_mgmt_commands::kernel_add_host,
        kernel_mgmt_commands::kernel_remove_host,
        kernel_mgmt_commands::kernel_update_host,
        kernel_mgmt_commands::kernel_get_host,
        kernel_mgmt_commands::kernel_list_hosts,
        kernel_mgmt_commands::kernel_list_modules,
        kernel_mgmt_commands::kernel_get_module_info,
        kernel_mgmt_commands::kernel_load_module,
        kernel_mgmt_commands::kernel_unload_module,
        kernel_mgmt_commands::kernel_get_module_params,
        kernel_mgmt_commands::kernel_set_module_param,
        kernel_mgmt_commands::kernel_list_available_modules,
        kernel_mgmt_commands::kernel_blacklist_module,
        kernel_mgmt_commands::kernel_unblacklist_module,
        kernel_mgmt_commands::kernel_list_blacklisted,
        kernel_mgmt_commands::kernel_list_autoload,
        kernel_mgmt_commands::kernel_add_autoload,
        kernel_mgmt_commands::kernel_remove_autoload,
        kernel_mgmt_commands::kernel_get_all_sysctl,
        kernel_mgmt_commands::kernel_get_sysctl,
        kernel_mgmt_commands::kernel_set_sysctl,
        kernel_mgmt_commands::kernel_set_sysctl_persistent,
        kernel_mgmt_commands::kernel_remove_sysctl_persistent,
        kernel_mgmt_commands::kernel_reload_sysctl,
        kernel_mgmt_commands::kernel_get_network_sysctl,
        kernel_mgmt_commands::kernel_get_vm_sysctl,
        kernel_mgmt_commands::kernel_get_config,
        kernel_mgmt_commands::kernel_check_feature,
        kernel_mgmt_commands::kernel_detect_cgroup_version,
        kernel_mgmt_commands::kernel_detect_namespace_support,
        kernel_mgmt_commands::kernel_detect_security_modules,
        kernel_mgmt_commands::kernel_detect_io_schedulers,
        kernel_mgmt_commands::kernel_get_command_line,
        kernel_mgmt_commands::kernel_get_power_state,
        kernel_mgmt_commands::kernel_list_thermal_zones,
        kernel_mgmt_commands::kernel_get_cpu_governor,
        kernel_mgmt_commands::kernel_set_cpu_governor,
        kernel_mgmt_commands::kernel_list_governors,
        kernel_mgmt_commands::kernel_read_sysfs,
        kernel_mgmt_commands::kernel_write_sysfs,
        kernel_mgmt_commands::kernel_list_block_devices,
        // cPanel
        cpanel_commands::cpanel_connect,
        cpanel_commands::cpanel_disconnect,
        cpanel_commands::cpanel_list_connections,
        cpanel_commands::cpanel_ping,
        cpanel_commands::cpanel_list_accounts,
        cpanel_commands::cpanel_get_account,
        cpanel_commands::cpanel_create_account,
        cpanel_commands::cpanel_suspend_account,
        cpanel_commands::cpanel_unsuspend_account,
        cpanel_commands::cpanel_terminate_account,
        cpanel_commands::cpanel_modify_account,
        cpanel_commands::cpanel_change_account_password,
        cpanel_commands::cpanel_list_packages,
        cpanel_commands::cpanel_get_account_summary,
        cpanel_commands::cpanel_list_suspended_accounts,
        cpanel_commands::cpanel_get_server_info,
        cpanel_commands::cpanel_list_domains,
        cpanel_commands::cpanel_list_all_domains,
        cpanel_commands::cpanel_create_addon_domain,
        cpanel_commands::cpanel_remove_addon_domain,
        cpanel_commands::cpanel_create_subdomain,
        cpanel_commands::cpanel_remove_subdomain,
        cpanel_commands::cpanel_park_domain,
        cpanel_commands::cpanel_unpark_domain,
        cpanel_commands::cpanel_list_email_accounts,
        cpanel_commands::cpanel_create_email_account,
        cpanel_commands::cpanel_delete_email_account,
        cpanel_commands::cpanel_change_email_password,
        cpanel_commands::cpanel_set_email_quota,
        cpanel_commands::cpanel_list_forwarders,
        cpanel_commands::cpanel_add_forwarder,
        cpanel_commands::cpanel_delete_forwarder,
        cpanel_commands::cpanel_list_autoresponders,
        cpanel_commands::cpanel_list_mailing_lists,
        cpanel_commands::cpanel_get_spam_settings,
        cpanel_commands::cpanel_list_mx_records,
        cpanel_commands::cpanel_list_databases,
        cpanel_commands::cpanel_create_database,
        cpanel_commands::cpanel_delete_database,
        cpanel_commands::cpanel_list_database_users,
        cpanel_commands::cpanel_create_database_user,
        cpanel_commands::cpanel_delete_database_user,
        cpanel_commands::cpanel_grant_database_privileges,
        cpanel_commands::cpanel_list_dns_zones,
        cpanel_commands::cpanel_get_dns_zone,
        cpanel_commands::cpanel_add_dns_record,
        cpanel_commands::cpanel_edit_dns_record,
        cpanel_commands::cpanel_remove_dns_record,
        cpanel_commands::cpanel_list_files,
        cpanel_commands::cpanel_create_directory,
        cpanel_commands::cpanel_delete_file,
        cpanel_commands::cpanel_get_disk_usage,
        cpanel_commands::cpanel_list_ssl_certs,
        cpanel_commands::cpanel_get_ssl_status,
        cpanel_commands::cpanel_install_ssl,
        cpanel_commands::cpanel_generate_csr,
        cpanel_commands::cpanel_autossl_check,
        cpanel_commands::cpanel_list_backups,
        cpanel_commands::cpanel_create_full_backup,
        cpanel_commands::cpanel_restore_file,
        cpanel_commands::cpanel_get_backup_config,
        cpanel_commands::cpanel_trigger_server_backup,
        cpanel_commands::cpanel_list_ftp_accounts,
        cpanel_commands::cpanel_create_ftp_account,
        cpanel_commands::cpanel_delete_ftp_account,
        cpanel_commands::cpanel_list_ftp_sessions,
        cpanel_commands::cpanel_list_cron_jobs,
        cpanel_commands::cpanel_add_cron_job,
        cpanel_commands::cpanel_edit_cron_job,
        cpanel_commands::cpanel_delete_cron_job,
        cpanel_commands::cpanel_get_bandwidth,
        cpanel_commands::cpanel_get_resource_usage,
        cpanel_commands::cpanel_get_error_log,
        cpanel_commands::cpanel_get_server_load,
        cpanel_commands::cpanel_list_php_versions,
        cpanel_commands::cpanel_get_domain_php_version,
        cpanel_commands::cpanel_set_domain_php_version,
        cpanel_commands::cpanel_get_php_config,
        cpanel_commands::cpanel_list_php_extensions,
        cpanel_commands::cpanel_list_blocked_ips,
        cpanel_commands::cpanel_block_ip,
        cpanel_commands::cpanel_unblock_ip,
        cpanel_commands::cpanel_list_ssh_keys,
        cpanel_commands::cpanel_import_ssh_key,
        cpanel_commands::cpanel_delete_ssh_key,
        cpanel_commands::cpanel_get_modsec_status,
        cpanel_commands::cpanel_set_modsec,
        // PHP management commands
        php_mgmt_commands::php_connect,
        php_mgmt_commands::php_disconnect,
        php_mgmt_commands::php_list_connections,
        php_mgmt_commands::php_list_versions,
        php_mgmt_commands::php_get_default_version,
        php_mgmt_commands::php_get_version_detail,
        php_mgmt_commands::php_set_default_version,
        php_mgmt_commands::php_list_sapis,
        php_mgmt_commands::php_get_config_path,
        php_mgmt_commands::php_get_extension_dir,
        php_mgmt_commands::php_check_version_installed,
        php_mgmt_commands::php_list_fpm_pools,
        php_mgmt_commands::php_get_fpm_pool,
        php_mgmt_commands::php_create_fpm_pool,
        php_mgmt_commands::php_update_fpm_pool,
        php_mgmt_commands::php_delete_fpm_pool,
        php_mgmt_commands::php_enable_fpm_pool,
        php_mgmt_commands::php_disable_fpm_pool,
        php_mgmt_commands::php_get_fpm_pool_status,
        php_mgmt_commands::php_list_fpm_pool_processes,
        php_mgmt_commands::php_get_ini_file,
        php_mgmt_commands::php_list_ini_directives,
        php_mgmt_commands::php_get_ini_directive,
        php_mgmt_commands::php_set_ini_directive,
        php_mgmt_commands::php_remove_ini_directive,
        php_mgmt_commands::php_get_ini_scan_dir,
        php_mgmt_commands::php_list_loaded_ini_files,
        php_mgmt_commands::php_backup_ini,
        php_mgmt_commands::php_restore_ini,
        php_mgmt_commands::php_validate_ini,
        php_mgmt_commands::php_list_modules,
        php_mgmt_commands::php_get_module,
        php_mgmt_commands::php_enable_module,
        php_mgmt_commands::php_disable_module,
        php_mgmt_commands::php_install_module,
        php_mgmt_commands::php_uninstall_module,
        php_mgmt_commands::php_is_module_loaded,
        php_mgmt_commands::php_list_available_modules,
        php_mgmt_commands::php_list_pecl_packages,
        php_mgmt_commands::php_install_pecl_package,
        php_mgmt_commands::php_uninstall_pecl_package,
        php_mgmt_commands::php_get_opcache_status,
        php_mgmt_commands::php_get_opcache_config,
        php_mgmt_commands::php_reset_opcache,
        php_mgmt_commands::php_list_cached_scripts,
        php_mgmt_commands::php_invalidate_cached_script,
        php_mgmt_commands::php_is_opcache_enabled,
        php_mgmt_commands::php_update_opcache_config,
        php_mgmt_commands::php_get_session_config,
        php_mgmt_commands::php_update_session_config,
        php_mgmt_commands::php_get_session_stats,
        php_mgmt_commands::php_cleanup_sessions,
        php_mgmt_commands::php_list_session_files,
        php_mgmt_commands::php_get_session_save_path,
        php_mgmt_commands::php_get_composer_info,
        php_mgmt_commands::php_is_composer_installed,
        php_mgmt_commands::php_list_composer_global_packages,
        php_mgmt_commands::php_install_composer_global_package,
        php_mgmt_commands::php_remove_composer_global_package,
        php_mgmt_commands::php_get_composer_project,
        php_mgmt_commands::php_composer_install,
        php_mgmt_commands::php_composer_update,
        php_mgmt_commands::php_composer_require,
        php_mgmt_commands::php_composer_remove,
        php_mgmt_commands::php_composer_dump_autoload,
        php_mgmt_commands::php_composer_validate,
        php_mgmt_commands::php_composer_outdated,
        php_mgmt_commands::php_composer_clear_cache,
        php_mgmt_commands::php_composer_self_update,
        php_mgmt_commands::php_read_log,
        php_mgmt_commands::php_get_log_config,
        php_mgmt_commands::php_get_fpm_log_config,
        php_mgmt_commands::php_get_log_path,
        php_mgmt_commands::php_get_fpm_log_path,
        php_mgmt_commands::php_clear_log,
        php_mgmt_commands::php_tail_log,
        php_mgmt_commands::php_get_log_size,
        php_mgmt_commands::php_rotate_log,
        php_mgmt_commands::php_get_fpm_service_status,
        php_mgmt_commands::php_start_fpm,
        php_mgmt_commands::php_stop_fpm,
        php_mgmt_commands::php_restart_fpm,
        php_mgmt_commands::php_reload_fpm,
        php_mgmt_commands::php_enable_fpm,
        php_mgmt_commands::php_disable_fpm,
        php_mgmt_commands::php_test_fpm_config,
        php_mgmt_commands::php_get_fpm_master_process,
        php_mgmt_commands::php_list_fpm_worker_pids,
        php_mgmt_commands::php_graceful_restart_fpm,
        php_mgmt_commands::php_reopen_fpm_logs,
        php_mgmt_commands::php_list_all_fpm_services,
        // pfSense commands
        pfsense_commands::pfsense_connect,
        pfsense_commands::pfsense_disconnect,
        pfsense_commands::pfsense_list_connections,
        pfsense_commands::pfsense_list_interfaces,
        pfsense_commands::pfsense_get_interface,
        pfsense_commands::pfsense_update_interface,
        pfsense_commands::pfsense_apply_interface_changes,
        pfsense_commands::pfsense_get_interface_stats,
        pfsense_commands::pfsense_list_firewall_rules,
        pfsense_commands::pfsense_get_firewall_rule,
        pfsense_commands::pfsense_create_firewall_rule,
        pfsense_commands::pfsense_update_firewall_rule,
        pfsense_commands::pfsense_delete_firewall_rule,
        pfsense_commands::pfsense_list_firewall_aliases,
        pfsense_commands::pfsense_get_firewall_alias,
        pfsense_commands::pfsense_create_firewall_alias,
        pfsense_commands::pfsense_update_firewall_alias,
        pfsense_commands::pfsense_delete_firewall_alias,
        pfsense_commands::pfsense_get_firewall_states,
        pfsense_commands::pfsense_flush_firewall_states,
        pfsense_commands::pfsense_list_nat_port_forwards,
        pfsense_commands::pfsense_create_nat_port_forward,
        pfsense_commands::pfsense_update_nat_port_forward,
        pfsense_commands::pfsense_delete_nat_port_forward,
        pfsense_commands::pfsense_list_nat_outbound,
        pfsense_commands::pfsense_create_nat_outbound,
        pfsense_commands::pfsense_update_nat_outbound,
        pfsense_commands::pfsense_delete_nat_outbound,
        pfsense_commands::pfsense_list_nat_1to1,
        pfsense_commands::pfsense_create_nat_1to1,
        pfsense_commands::pfsense_update_nat_1to1,
        pfsense_commands::pfsense_delete_nat_1to1,
        pfsense_commands::pfsense_get_dhcp_config,
        pfsense_commands::pfsense_update_dhcp_config,
        pfsense_commands::pfsense_list_dhcp_leases,
        pfsense_commands::pfsense_list_dhcp_static_mappings,
        pfsense_commands::pfsense_create_dhcp_static_mapping,
        pfsense_commands::pfsense_update_dhcp_static_mapping,
        pfsense_commands::pfsense_delete_dhcp_static_mapping,
        pfsense_commands::pfsense_get_dhcp_relay,
        pfsense_commands::pfsense_get_dns_resolver_config,
        pfsense_commands::pfsense_update_dns_resolver_config,
        pfsense_commands::pfsense_list_dns_host_overrides,
        pfsense_commands::pfsense_create_dns_host_override,
        pfsense_commands::pfsense_delete_dns_host_override,
        pfsense_commands::pfsense_list_dns_domain_overrides,
        pfsense_commands::pfsense_flush_dns_cache,
        pfsense_commands::pfsense_get_dns_cache_stats,
        pfsense_commands::pfsense_list_openvpn_servers,
        pfsense_commands::pfsense_get_openvpn_server,
        pfsense_commands::pfsense_create_openvpn_server,
        pfsense_commands::pfsense_delete_openvpn_server,
        pfsense_commands::pfsense_list_openvpn_clients,
        pfsense_commands::pfsense_list_ipsec_tunnels,
        pfsense_commands::pfsense_list_wireguard_tunnels,
        pfsense_commands::pfsense_list_wireguard_peers,
        pfsense_commands::pfsense_list_routes,
        pfsense_commands::pfsense_create_route,
        pfsense_commands::pfsense_delete_route,
        pfsense_commands::pfsense_list_gateways,
        pfsense_commands::pfsense_get_gateway_status,
        pfsense_commands::pfsense_get_routing_table,
        pfsense_commands::pfsense_list_services,
        pfsense_commands::pfsense_get_service_status,
        pfsense_commands::pfsense_start_service,
        pfsense_commands::pfsense_stop_service,
        pfsense_commands::pfsense_restart_service,
        pfsense_commands::pfsense_get_system_info,
        pfsense_commands::pfsense_get_system_updates,
        pfsense_commands::pfsense_get_general_config,
        pfsense_commands::pfsense_update_general_config,
        pfsense_commands::pfsense_reboot,
        pfsense_commands::pfsense_halt,
        pfsense_commands::pfsense_list_cas,
        pfsense_commands::pfsense_list_certs,
        pfsense_commands::pfsense_create_cert,
        pfsense_commands::pfsense_delete_cert,
        pfsense_commands::pfsense_list_users,
        pfsense_commands::pfsense_get_user,
        pfsense_commands::pfsense_create_user,
        pfsense_commands::pfsense_delete_user,
        pfsense_commands::pfsense_list_groups,
        pfsense_commands::pfsense_get_arp_table,
        pfsense_commands::pfsense_get_ndp_table,
        pfsense_commands::pfsense_dns_lookup,
        pfsense_commands::pfsense_ping,
        pfsense_commands::pfsense_traceroute,
        pfsense_commands::pfsense_get_pfinfo,
        pfsense_commands::pfsense_get_system_log,
        pfsense_commands::pfsense_list_backups,
        pfsense_commands::pfsense_create_backup,
        pfsense_commands::pfsense_delete_backup,
    ]
}

fn build_b() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // MySQL admin commands
        mysql_admin_commands::mysql_admin_connect,
        mysql_admin_commands::mysql_admin_disconnect,
        mysql_admin_commands::mysql_admin_list_connections,
        mysql_admin_commands::mysql_admin_list_users,
        mysql_admin_commands::mysql_admin_get_user,
        mysql_admin_commands::mysql_admin_create_user,
        mysql_admin_commands::mysql_admin_drop_user,
        mysql_admin_commands::mysql_admin_set_password,
        mysql_admin_commands::mysql_admin_flush_privileges,
        mysql_admin_commands::mysql_admin_get_slave_status,
        mysql_admin_commands::mysql_admin_start_slave,
        mysql_admin_commands::mysql_admin_stop_slave,
        mysql_admin_commands::mysql_admin_reset_slave,
        mysql_admin_commands::mysql_admin_change_master,
        mysql_admin_commands::mysql_admin_skip_counter,
        mysql_admin_commands::mysql_admin_list_databases,
        mysql_admin_commands::mysql_admin_create_database,
        mysql_admin_commands::mysql_admin_drop_database,
        mysql_admin_commands::mysql_admin_get_database_size,
        mysql_admin_commands::mysql_admin_list_tables,
        mysql_admin_commands::mysql_admin_describe_table,
        mysql_admin_commands::mysql_admin_optimize_table,
        mysql_admin_commands::mysql_admin_repair_table,
        mysql_admin_commands::mysql_admin_analyze_table,
        mysql_admin_commands::mysql_admin_check_table,
        mysql_admin_commands::mysql_admin_explain_query,
        mysql_admin_commands::mysql_admin_get_innodb_status,
        mysql_admin_commands::mysql_admin_get_buffer_pool_stats,
        mysql_admin_commands::mysql_admin_get_global_status,
        mysql_admin_commands::mysql_admin_create_backup,
        mysql_admin_commands::mysql_admin_restore_backup,
        mysql_admin_commands::mysql_admin_list_backup_files,
        mysql_admin_commands::mysql_admin_list_processes,
        mysql_admin_commands::mysql_admin_kill_process,
        mysql_admin_commands::mysql_admin_list_binlogs,
        // PostgreSQL admin commands
        pg_admin_commands::pg_admin_connect,
        pg_admin_commands::pg_admin_disconnect,
        pg_admin_commands::pg_admin_list_connections,
        pg_admin_commands::pg_admin_list_roles,
        pg_admin_commands::pg_admin_get_role,
        pg_admin_commands::pg_admin_create_role,
        pg_admin_commands::pg_admin_drop_role,
        pg_admin_commands::pg_admin_alter_role,
        pg_admin_commands::pg_admin_set_role_password,
        pg_admin_commands::pg_admin_grant_role,
        pg_admin_commands::pg_admin_revoke_role,
        pg_admin_commands::pg_admin_list_databases,
        pg_admin_commands::pg_admin_get_database,
        pg_admin_commands::pg_admin_create_database,
        pg_admin_commands::pg_admin_drop_database,
        pg_admin_commands::pg_admin_get_database_size,
        pg_admin_commands::pg_admin_reload_hba,
        pg_admin_commands::pg_admin_get_replication_status,
        pg_admin_commands::pg_admin_list_replication_slots,
        pg_admin_commands::pg_admin_create_replication_slot,
        pg_admin_commands::pg_admin_drop_replication_slot,
        pg_admin_commands::pg_admin_get_replication_lag,
        pg_admin_commands::pg_admin_vacuum_table,
        pg_admin_commands::pg_admin_vacuum_database,
        pg_admin_commands::pg_admin_get_bloat,
        pg_admin_commands::pg_admin_install_extension,
        pg_admin_commands::pg_admin_uninstall_extension,
        pg_admin_commands::pg_admin_get_extension,
        pg_admin_commands::pg_admin_list_available_extensions,
        pg_admin_commands::pg_admin_get_table_stats,
        pg_admin_commands::pg_admin_get_index_stats,
        pg_admin_commands::pg_admin_reset_stats,
        pg_admin_commands::pg_admin_list_wal_files,
        pg_admin_commands::pg_admin_switch_wal,
        pg_admin_commands::pg_admin_list_tablespaces,
        pg_admin_commands::pg_admin_get_tablespace,
        pg_admin_commands::pg_admin_create_tablespace,
        pg_admin_commands::pg_admin_drop_tablespace,
        pg_admin_commands::pg_admin_get_tablespace_size,
        pg_admin_commands::pg_admin_list_schemas,
        pg_admin_commands::pg_admin_get_schema,
        pg_admin_commands::pg_admin_create_schema,
        pg_admin_commands::pg_admin_drop_schema,
        pg_admin_commands::pg_admin_list_schema_tables,
        pg_admin_commands::pg_admin_list_backup_files,
        pg_admin_commands::pg_admin_add_hba,
        pg_admin_commands::pg_admin_alter_database_owner,
        pg_admin_commands::pg_admin_alter_schema_owner,
        pg_admin_commands::pg_admin_alter_tablespace_owner,
        pg_admin_commands::pg_admin_analyze,
        pg_admin_commands::pg_admin_checkpoint,
        pg_admin_commands::pg_admin_create_logical_replication_slot,
        pg_admin_commands::pg_admin_create_physical_replication_slot,
        pg_admin_commands::pg_admin_get_activity,
        pg_admin_commands::pg_admin_get_archive_status,
        pg_admin_commands::pg_admin_get_autovacuum_config,
        pg_admin_commands::pg_admin_get_backup_size,
        pg_admin_commands::pg_admin_get_current_lsn,
        pg_admin_commands::pg_admin_get_database_connections,
        pg_admin_commands::pg_admin_get_database_stats,
        pg_admin_commands::pg_admin_get_hba_raw,
        pg_admin_commands::pg_admin_get_locks,
        pg_admin_commands::pg_admin_get_setting,
        pg_admin_commands::pg_admin_get_settings,
        pg_admin_commands::pg_admin_get_vacuum_stats,
        pg_admin_commands::pg_admin_get_wal_info,
        pg_admin_commands::pg_admin_get_wal_receiver_status,
        pg_admin_commands::pg_admin_get_wal_size,
        pg_admin_commands::pg_admin_grant_schema,
        pg_admin_commands::pg_admin_list_database_schemas,
        pg_admin_commands::pg_admin_list_hba,
        pg_admin_commands::pg_admin_list_installed_extensions,
        pg_admin_commands::pg_admin_list_role_memberships,
        pg_admin_commands::pg_admin_list_schema_functions,
        pg_admin_commands::pg_admin_list_schema_views,
        pg_admin_commands::pg_admin_list_tablespace_objects,
        pg_admin_commands::pg_admin_pg_basebackup,
        pg_admin_commands::pg_admin_pg_dump,
        pg_admin_commands::pg_admin_pg_dumpall,
        pg_admin_commands::pg_admin_pg_restore,
        pg_admin_commands::pg_admin_promote_standby,
        pg_admin_commands::pg_admin_reindex,
        pg_admin_commands::pg_admin_reload_config,
        pg_admin_commands::pg_admin_remove_hba,
        pg_admin_commands::pg_admin_rename_database,
        pg_admin_commands::pg_admin_rename_role,
        pg_admin_commands::pg_admin_rename_schema,
        pg_admin_commands::pg_admin_rename_tablespace,
        pg_admin_commands::pg_admin_revoke_schema,
        pg_admin_commands::pg_admin_set_autovacuum_config,
        pg_admin_commands::pg_admin_set_hba_raw,
        pg_admin_commands::pg_admin_set_setting,
        pg_admin_commands::pg_admin_terminate_connections,
        pg_admin_commands::pg_admin_update_extension,
        pg_admin_commands::pg_admin_update_hba,
        pg_admin_commands::pg_admin_validate_hba,
        pg_admin_commands::pg_admin_verify_backup,
        // Prometheus commands
        prometheus_commands::prometheus_connect,
        prometheus_commands::prometheus_disconnect,
        prometheus_commands::prometheus_list_connections,
        prometheus_commands::prometheus_instant_query,
        prometheus_commands::prometheus_range_query,
        prometheus_commands::prometheus_label_values,
        prometheus_commands::prometheus_label_names,
        prometheus_commands::prometheus_series,
        prometheus_commands::prometheus_list_targets,
        prometheus_commands::prometheus_list_rules,
        prometheus_commands::prometheus_list_alerts,
        prometheus_commands::prometheus_get_config,
        prometheus_commands::prometheus_reload_config,
        prometheus_commands::prometheus_get_flags,
        prometheus_commands::prometheus_get_tsdb_status,
        prometheus_commands::prometheus_list_metadata,
        prometheus_commands::prometheus_federate,
        prometheus_commands::prometheus_list_recording_rules,
        prometheus_commands::prometheus_list_silences,
        prometheus_commands::prometheus_get_silence,
        prometheus_commands::prometheus_create_silence,
        prometheus_commands::prometheus_delete_silence,
        // Grafana commands
        grafana_commands::grafana_connect,
        grafana_commands::grafana_disconnect,
        grafana_commands::grafana_list_connections,
        grafana_commands::grafana_search_dashboards,
        grafana_commands::grafana_get_dashboard,
        grafana_commands::grafana_delete_dashboard,
        grafana_commands::grafana_get_home_dashboard,
        grafana_commands::grafana_list_datasources,
        grafana_commands::grafana_get_datasource,
        grafana_commands::grafana_create_datasource,
        grafana_commands::grafana_delete_datasource,
        grafana_commands::grafana_test_datasource,
        grafana_commands::grafana_list_folders,
        grafana_commands::grafana_get_folder,
        grafana_commands::grafana_create_folder,
        grafana_commands::grafana_delete_folder,
        grafana_commands::grafana_get_current_org,
        grafana_commands::grafana_list_orgs,
        grafana_commands::grafana_get_org,
        grafana_commands::grafana_create_org,
        grafana_commands::grafana_delete_org,
        grafana_commands::grafana_list_users,
        grafana_commands::grafana_get_user,
        grafana_commands::grafana_create_user,
        grafana_commands::grafana_delete_user,
        grafana_commands::grafana_list_teams,
        grafana_commands::grafana_get_team,
        grafana_commands::grafana_create_team,
        grafana_commands::grafana_delete_team,
        grafana_commands::grafana_list_team_members,
        grafana_commands::grafana_add_team_member,
        grafana_commands::grafana_remove_team_member,
        grafana_commands::grafana_list_alert_rules,
        grafana_commands::grafana_get_alert_rule,
        grafana_commands::grafana_create_alert_rule,
        grafana_commands::grafana_delete_alert_rule,
        grafana_commands::grafana_pause_alert_rule,
        grafana_commands::grafana_list_annotations,
        grafana_commands::grafana_create_annotation,
        grafana_commands::grafana_delete_annotation,
        grafana_commands::grafana_list_playlists,
        grafana_commands::grafana_get_playlist,
        grafana_commands::grafana_delete_playlist,
        grafana_commands::grafana_list_snapshots,
        grafana_commands::grafana_create_snapshot,
        grafana_commands::grafana_delete_snapshot,
        // UPS management commands
        ups_mgmt_commands::ups_connect,
        ups_mgmt_commands::ups_disconnect,
        ups_mgmt_commands::ups_list_connections,
        ups_mgmt_commands::ups_list_devices,
        ups_mgmt_commands::ups_get_device,
        ups_mgmt_commands::ups_list_device_variables,
        ups_mgmt_commands::ups_get_device_variable,
        ups_mgmt_commands::ups_set_device_variable,
        ups_mgmt_commands::ups_list_device_commands,
        ups_mgmt_commands::ups_run_device_command,
        ups_mgmt_commands::ups_get_status,
        ups_mgmt_commands::ups_is_on_battery,
        ups_mgmt_commands::ups_is_online,
        ups_mgmt_commands::ups_get_load,
        ups_mgmt_commands::ups_get_input_voltage,
        ups_mgmt_commands::ups_get_output_voltage,
        ups_mgmt_commands::ups_get_temperature,
        ups_mgmt_commands::ups_list_all_status,
        ups_mgmt_commands::ups_get_battery_info,
        ups_mgmt_commands::ups_get_battery_charge,
        ups_mgmt_commands::ups_get_battery_runtime,
        ups_mgmt_commands::ups_get_battery_voltage,
        ups_mgmt_commands::ups_is_battery_low,
        ups_mgmt_commands::ups_battery_needs_replacement,
        ups_mgmt_commands::ups_get_battery_health,
        ups_mgmt_commands::ups_list_events,
        ups_mgmt_commands::ups_get_recent_events,
        ups_mgmt_commands::ups_clear_event_log,
        ups_mgmt_commands::ups_list_outlets,
        ups_mgmt_commands::ups_get_outlet,
        ups_mgmt_commands::ups_switch_outlet_on,
        ups_mgmt_commands::ups_switch_outlet_off,
        ups_mgmt_commands::ups_get_outlet_delay,
        ups_mgmt_commands::ups_set_outlet_delay,
        ups_mgmt_commands::ups_list_schedules,
        ups_mgmt_commands::ups_get_schedule,
        ups_mgmt_commands::ups_create_schedule,
        ups_mgmt_commands::ups_update_schedule,
        ups_mgmt_commands::ups_delete_schedule,
        ups_mgmt_commands::ups_enable_schedule,
        ups_mgmt_commands::ups_disable_schedule,
        ups_mgmt_commands::ups_list_thresholds,
        ups_mgmt_commands::ups_get_threshold,
        ups_mgmt_commands::ups_set_threshold,
        ups_mgmt_commands::ups_get_low_battery_threshold,
        ups_mgmt_commands::ups_set_low_battery_threshold,
        ups_mgmt_commands::ups_quick_test,
        ups_mgmt_commands::ups_deep_test,
        ups_mgmt_commands::ups_abort_test,
        ups_mgmt_commands::ups_get_last_test_result,
        ups_mgmt_commands::ups_calibrate_battery,
        ups_mgmt_commands::ups_get_test_history,
        ups_mgmt_commands::ups_get_nut_config,
        ups_mgmt_commands::ups_get_ups_conf,
        ups_mgmt_commands::ups_set_ups_conf,
        ups_mgmt_commands::ups_get_upsd_conf,
        ups_mgmt_commands::ups_set_upsd_conf,
        ups_mgmt_commands::ups_reload_upsd,
        ups_mgmt_commands::ups_reload_upsmon,
        ups_mgmt_commands::ups_restart_nut,
        ups_mgmt_commands::ups_get_nut_mode,
        ups_mgmt_commands::ups_set_nut_mode,
        ups_mgmt_commands::ups_list_notifications,
        ups_mgmt_commands::ups_get_notify_flags,
        ups_mgmt_commands::ups_set_notify_flags,
        ups_mgmt_commands::ups_get_notify_message,
        ups_mgmt_commands::ups_set_notify_message,
        ups_mgmt_commands::ups_get_notify_cmd,
        ups_mgmt_commands::ups_set_notify_cmd,
        ups_mgmt_commands::ups_test_notification,
        // NetBox commands
        netbox_commands::netbox_connect,
        netbox_commands::netbox_disconnect,
        netbox_commands::netbox_list_connections,
        netbox_commands::netbox_ping,
        netbox_commands::netbox_list_sites,
        netbox_commands::netbox_get_site,
        netbox_commands::netbox_create_site,
        netbox_commands::netbox_update_site,
        netbox_commands::netbox_partial_update_site,
        netbox_commands::netbox_delete_site,
        netbox_commands::netbox_list_sites_by_region,
        netbox_commands::netbox_list_sites_by_group,
        netbox_commands::netbox_list_racks,
        netbox_commands::netbox_get_rack,
        netbox_commands::netbox_create_rack,
        netbox_commands::netbox_update_rack,
        netbox_commands::netbox_partial_update_rack,
        netbox_commands::netbox_delete_rack,
        netbox_commands::netbox_get_rack_elevation,
        netbox_commands::netbox_list_rack_reservations,
        netbox_commands::netbox_list_devices,
        netbox_commands::netbox_get_device,
        netbox_commands::netbox_create_device,
        netbox_commands::netbox_update_device,
        netbox_commands::netbox_partial_update_device,
        netbox_commands::netbox_delete_device,
        netbox_commands::netbox_list_devices_by_site,
        netbox_commands::netbox_list_devices_by_rack,
        netbox_commands::netbox_list_device_types,
        netbox_commands::netbox_get_device_type,
        netbox_commands::netbox_list_manufacturers,
        netbox_commands::netbox_get_manufacturer,
        netbox_commands::netbox_list_platforms,
        netbox_commands::netbox_get_platform,
        netbox_commands::netbox_list_device_roles,
        netbox_commands::netbox_get_device_role,
        netbox_commands::netbox_render_device_config,
        netbox_commands::netbox_list_interfaces,
        netbox_commands::netbox_get_interface,
        netbox_commands::netbox_create_interface,
        netbox_commands::netbox_update_interface,
        netbox_commands::netbox_partial_update_interface,
        netbox_commands::netbox_delete_interface,
        netbox_commands::netbox_list_interface_connections,
        netbox_commands::netbox_list_ip_addresses,
        netbox_commands::netbox_get_ip_address,
        netbox_commands::netbox_create_ip_address,
        netbox_commands::netbox_update_ip_address,
        netbox_commands::netbox_delete_ip_address,
        netbox_commands::netbox_list_prefixes,
        netbox_commands::netbox_get_prefix,
        netbox_commands::netbox_create_prefix,
        netbox_commands::netbox_update_prefix,
        netbox_commands::netbox_delete_prefix,
        netbox_commands::netbox_get_available_ips,
        netbox_commands::netbox_create_available_ip,
        netbox_commands::netbox_get_available_prefixes,
        netbox_commands::netbox_list_vrfs,
        netbox_commands::netbox_get_vrf,
        netbox_commands::netbox_create_vrf,
        netbox_commands::netbox_update_vrf,
        netbox_commands::netbox_delete_vrf,
        netbox_commands::netbox_list_aggregates,
        netbox_commands::netbox_get_aggregate,
        netbox_commands::netbox_list_rirs,
        netbox_commands::netbox_get_rir,
        netbox_commands::netbox_list_ipam_roles,
        netbox_commands::netbox_get_ipam_role,
        netbox_commands::netbox_list_services,
        netbox_commands::netbox_list_vlans,
        netbox_commands::netbox_get_vlan,
        netbox_commands::netbox_create_vlan,
        netbox_commands::netbox_update_vlan,
        netbox_commands::netbox_partial_update_vlan,
        netbox_commands::netbox_delete_vlan,
        netbox_commands::netbox_list_vlans_by_site,
        netbox_commands::netbox_list_vlans_by_group,
        netbox_commands::netbox_list_vlan_groups,
        netbox_commands::netbox_get_vlan_group,
        netbox_commands::netbox_create_vlan_group,
        netbox_commands::netbox_update_vlan_group,
        netbox_commands::netbox_delete_vlan_group,
        netbox_commands::netbox_list_circuits,
        netbox_commands::netbox_get_circuit,
        netbox_commands::netbox_create_circuit,
        netbox_commands::netbox_update_circuit,
        netbox_commands::netbox_delete_circuit,
        netbox_commands::netbox_list_circuit_providers,
        netbox_commands::netbox_get_circuit_provider,
        netbox_commands::netbox_create_circuit_provider,
        netbox_commands::netbox_update_circuit_provider,
        netbox_commands::netbox_delete_circuit_provider,
        netbox_commands::netbox_list_circuit_types,
        netbox_commands::netbox_get_circuit_type,
        netbox_commands::netbox_list_circuit_terminations,
        netbox_commands::netbox_list_cables,
        netbox_commands::netbox_get_cable,
        netbox_commands::netbox_create_cable,
        netbox_commands::netbox_update_cable,
        netbox_commands::netbox_delete_cable,
        netbox_commands::netbox_trace_cable,
        netbox_commands::netbox_list_tenants,
        netbox_commands::netbox_get_tenant,
        netbox_commands::netbox_create_tenant,
        netbox_commands::netbox_update_tenant,
        netbox_commands::netbox_partial_update_tenant,
        netbox_commands::netbox_delete_tenant,
        netbox_commands::netbox_list_tenant_groups,
        netbox_commands::netbox_get_tenant_group,
        netbox_commands::netbox_create_tenant_group,
        netbox_commands::netbox_update_tenant_group,
        netbox_commands::netbox_delete_tenant_group,
        netbox_commands::netbox_list_contacts,
        netbox_commands::netbox_get_contact,
        netbox_commands::netbox_create_contact,
        netbox_commands::netbox_update_contact,
        netbox_commands::netbox_partial_update_contact,
        netbox_commands::netbox_delete_contact,
        netbox_commands::netbox_list_contact_groups,
        netbox_commands::netbox_get_contact_group,
        netbox_commands::netbox_create_contact_group,
        netbox_commands::netbox_update_contact_group,
        netbox_commands::netbox_delete_contact_group,
        netbox_commands::netbox_list_contact_roles,
        netbox_commands::netbox_list_contact_assignments,
        netbox_commands::netbox_list_vms,
        netbox_commands::netbox_get_vm,
        netbox_commands::netbox_create_vm,
        netbox_commands::netbox_update_vm,
        netbox_commands::netbox_delete_vm,
        netbox_commands::netbox_list_vm_interfaces,
        netbox_commands::netbox_create_vm_interface,
        netbox_commands::netbox_update_vm_interface,
        netbox_commands::netbox_delete_vm_interface,
        netbox_commands::netbox_list_clusters,
        netbox_commands::netbox_get_cluster,
        netbox_commands::netbox_create_cluster,
        netbox_commands::netbox_update_cluster,
        netbox_commands::netbox_delete_cluster,
        netbox_commands::netbox_list_cluster_types,
        netbox_commands::netbox_get_cluster_type,
        netbox_commands::netbox_create_cluster_type,
        netbox_commands::netbox_list_cluster_groups,
        // Port knock commands (54)
        port_knock_commands::port_knock_add_host,
        port_knock_commands::port_knock_remove_host,
        port_knock_commands::port_knock_update_host,
        port_knock_commands::port_knock_get_host,
        port_knock_commands::port_knock_list_hosts,
        port_knock_commands::port_knock_add_sequence,
        port_knock_commands::port_knock_remove_sequence,
        port_knock_commands::port_knock_get_sequence,
        port_knock_commands::port_knock_list_sequences,
        port_knock_commands::port_knock_generate_sequence,
        port_knock_commands::port_knock_encode_sequence_base64,
        port_knock_commands::port_knock_decode_sequence_base64,
        port_knock_commands::port_knock_calculate_complexity,
        port_knock_commands::port_knock_execute,
        port_knock_commands::port_knock_send_spa,
        port_knock_commands::port_knock_sequence_to_knockd,
        port_knock_commands::port_knock_encrypt_payload,
        port_knock_commands::port_knock_decrypt_payload,
        port_knock_commands::port_knock_generate_key,
        port_knock_commands::port_knock_detect_firewall,
        port_knock_commands::port_knock_firewall_accept_rule,
        port_knock_commands::port_knock_firewall_timed_rule,
        port_knock_commands::port_knock_firewall_remove_rule,
        port_knock_commands::port_knock_firewall_backup_command,
        port_knock_commands::port_knock_parse_knockd_config,
        port_knock_commands::port_knock_generate_knockd_config,
        port_knock_commands::port_knock_knockd_status_command,
        port_knock_commands::port_knock_knockd_install_command,
        port_knock_commands::port_knock_knockd_log_command,
        port_knock_commands::port_knock_parse_fwknop_access,
        port_knock_commands::port_knock_generate_fwknop_access,
        port_knock_commands::port_knock_build_fwknop_command,
        port_knock_commands::port_knock_fwknop_install_command,
        port_knock_commands::port_knock_generate_fwknop_keys,
        port_knock_commands::port_knock_generate_fwknop_client_rc,
        port_knock_commands::port_knock_create_profile,
        port_knock_commands::port_knock_update_profile,
        port_knock_commands::port_knock_delete_profile,
        port_knock_commands::port_knock_get_profile,
        port_knock_commands::port_knock_list_profiles,
        port_knock_commands::port_knock_export_profiles,
        port_knock_commands::port_knock_import_profiles,
        port_knock_commands::port_knock_search_profiles,
        port_knock_commands::port_knock_check_port_command,
        port_knock_commands::port_knock_banner_grab_command,
        port_knock_commands::port_knock_nmap_command,
        port_knock_commands::port_knock_rtt_command,
        port_knock_commands::port_knock_get_history,
        port_knock_commands::port_knock_filter_history,
        port_knock_commands::port_knock_get_statistics,
        port_knock_commands::port_knock_clear_history,
        port_knock_commands::port_knock_export_history_json,
        port_knock_commands::port_knock_export_history_csv,
        port_knock_commands::port_knock_get_recent_history,
        // About commands (14)
        about_commands::about_get_info,
        about_commands::about_get_app_info,
        about_commands::about_get_license_summary,
        about_commands::about_get_all_license_texts,
        about_commands::about_get_license_text,
        about_commands::about_get_rust_deps,
        about_commands::about_get_rust_deps_by_category,
        about_commands::about_get_js_deps,
        about_commands::about_get_js_deps_by_category,
        about_commands::about_get_workspace_crates,
        about_commands::about_get_workspace_crates_by_category,
        about_commands::about_get_credits,
        about_commands::about_search_deps,
        about_commands::about_get_deps_by_license,
    ]
}

fn build_h() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── MAC (Linux Mandatory Access Control) – sorng-mac (43) ─────
        mac_mgmt_commands::mac_connect,
        mac_mgmt_commands::mac_disconnect,
        mac_mgmt_commands::mac_list_connections,
        mac_mgmt_commands::mac_detect_system,
        mac_mgmt_commands::mac_get_dashboard,
        mac_mgmt_commands::mac_selinux_status,
        mac_mgmt_commands::mac_selinux_get_mode,
        mac_mgmt_commands::mac_selinux_set_mode,
        mac_mgmt_commands::mac_selinux_list_booleans,
        mac_mgmt_commands::mac_selinux_get_boolean,
        mac_mgmt_commands::mac_selinux_set_boolean,
        mac_mgmt_commands::mac_selinux_list_modules,
        mac_mgmt_commands::mac_selinux_manage_module,
        mac_mgmt_commands::mac_selinux_list_file_contexts,
        mac_mgmt_commands::mac_selinux_add_file_context,
        mac_mgmt_commands::mac_selinux_remove_file_context,
        mac_mgmt_commands::mac_selinux_restorecon,
        mac_mgmt_commands::mac_selinux_list_ports,
        mac_mgmt_commands::mac_selinux_add_port_context,
        mac_mgmt_commands::mac_selinux_list_users,
        mac_mgmt_commands::mac_selinux_list_roles,
        mac_mgmt_commands::mac_selinux_get_policy_info,
        mac_mgmt_commands::mac_selinux_audit_log,
        mac_mgmt_commands::mac_selinux_audit2allow,
        mac_mgmt_commands::mac_apparmor_status,
        mac_mgmt_commands::mac_apparmor_list_profiles,
        mac_mgmt_commands::mac_apparmor_set_profile_mode,
        mac_mgmt_commands::mac_apparmor_reload_profile,
        mac_mgmt_commands::mac_apparmor_create_profile,
        mac_mgmt_commands::mac_apparmor_delete_profile,
        mac_mgmt_commands::mac_apparmor_get_profile_content,
        mac_mgmt_commands::mac_apparmor_update_profile_content,
        mac_mgmt_commands::mac_apparmor_audit_log,
        mac_mgmt_commands::mac_tomoyo_status,
        mac_mgmt_commands::mac_tomoyo_list_domains,
        mac_mgmt_commands::mac_tomoyo_set_domain_mode,
        mac_mgmt_commands::mac_tomoyo_list_rules,
        mac_mgmt_commands::mac_smack_status,
        mac_mgmt_commands::mac_smack_list_labels,
        mac_mgmt_commands::mac_smack_list_rules,
        mac_mgmt_commands::mac_smack_add_rule,
        mac_mgmt_commands::mac_smack_remove_rule,
        mac_mgmt_commands::mac_compliance_check,
    ]
}

fn is_command_d(command: &str) -> bool {
    matches!(
        command,
        // ── IPMI (41) ───────────────────────────────────────────────────
        "ipmi_connect"
            | "ipmi_disconnect"
            | "ipmi_disconnect_all"
            | "ipmi_list_sessions"
            | "ipmi_get_session"
            | "ipmi_ping"
            | "ipmi_get_chassis_status"
            | "ipmi_chassis_control"
            | "ipmi_power_on"
            | "ipmi_power_off"
            | "ipmi_power_cycle"
            | "ipmi_hard_reset"
            | "ipmi_soft_shutdown"
            | "ipmi_chassis_identify"
            | "ipmi_set_boot_device"
            | "ipmi_get_device_id"
            | "ipmi_get_all_sdr_records"
            | "ipmi_read_sensor"
            | "ipmi_get_sensor_thresholds"
            | "ipmi_get_sel_info"
            | "ipmi_get_all_sel_entries"
            | "ipmi_clear_sel"
            | "ipmi_delete_sel_entry"
            | "ipmi_get_fru_info"
            | "ipmi_get_sol_config"
            | "ipmi_activate_sol"
            | "ipmi_deactivate_sol"
            | "ipmi_get_watchdog_timer"
            | "ipmi_reset_watchdog_timer"
            | "ipmi_get_lan_config"
            | "ipmi_list_users"
            | "ipmi_set_user_name"
            | "ipmi_set_user_password"
            | "ipmi_enable_user"
            | "ipmi_disable_user"
            | "ipmi_raw_command"
            | "ipmi_bridged_command"
            | "ipmi_get_pef_capabilities"
            | "ipmi_get_channel_info"
            | "ipmi_list_channels"
            | "ipmi_get_channel_cipher_suites"
    )
}

fn build_d() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── IPMI (41) ───────────────────────────────────────────────────
        ipmi_commands::ipmi_connect,
        ipmi_commands::ipmi_disconnect,
        ipmi_commands::ipmi_disconnect_all,
        ipmi_commands::ipmi_list_sessions,
        ipmi_commands::ipmi_get_session,
        ipmi_commands::ipmi_ping,
        ipmi_commands::ipmi_get_chassis_status,
        ipmi_commands::ipmi_chassis_control,
        ipmi_commands::ipmi_power_on,
        ipmi_commands::ipmi_power_off,
        ipmi_commands::ipmi_power_cycle,
        ipmi_commands::ipmi_hard_reset,
        ipmi_commands::ipmi_soft_shutdown,
        ipmi_commands::ipmi_chassis_identify,
        ipmi_commands::ipmi_set_boot_device,
        ipmi_commands::ipmi_get_device_id,
        ipmi_commands::ipmi_get_all_sdr_records,
        ipmi_commands::ipmi_read_sensor,
        ipmi_commands::ipmi_get_sensor_thresholds,
        ipmi_commands::ipmi_get_sel_info,
        ipmi_commands::ipmi_get_all_sel_entries,
        ipmi_commands::ipmi_clear_sel,
        ipmi_commands::ipmi_delete_sel_entry,
        ipmi_commands::ipmi_get_fru_info,
        ipmi_commands::ipmi_get_sol_config,
        ipmi_commands::ipmi_activate_sol,
        ipmi_commands::ipmi_deactivate_sol,
        ipmi_commands::ipmi_get_watchdog_timer,
        ipmi_commands::ipmi_reset_watchdog_timer,
        ipmi_commands::ipmi_get_lan_config,
        ipmi_commands::ipmi_list_users,
        ipmi_commands::ipmi_set_user_name,
        ipmi_commands::ipmi_set_user_password,
        ipmi_commands::ipmi_enable_user,
        ipmi_commands::ipmi_disable_user,
        ipmi_commands::ipmi_raw_command,
        ipmi_commands::ipmi_bridged_command,
        ipmi_commands::ipmi_get_pef_capabilities,
        ipmi_commands::ipmi_get_channel_info,
        ipmi_commands::ipmi_list_channels,
        ipmi_commands::ipmi_get_channel_cipher_suites,
    ]
}


fn is_command_e(command: &str) -> bool {
    matches!(
        command,
        // ── CUPS (52) ───────────────────────────────────────────────────
        "cups_connect"
            | "cups_disconnect"
            | "cups_list_sessions"
            | "cups_list_printers"
            | "cups_get_printer"
            | "cups_modify_printer"
            | "cups_delete_printer"
            | "cups_pause_printer"
            | "cups_resume_printer"
            | "cups_set_default_printer"
            | "cups_get_default_printer"
            | "cups_accept_jobs"
            | "cups_reject_jobs"
            | "cups_discover_printers"
            | "cups_list_jobs"
            | "cups_get_job"
            | "cups_submit_job"
            | "cups_submit_job_uri"
            | "cups_cancel_job"
            | "cups_hold_job"
            | "cups_release_job"
            | "cups_cancel_all_jobs"
            | "cups_move_job"
            | "cups_list_classes"
            | "cups_get_class"
            | "cups_create_class"
            | "cups_modify_class"
            | "cups_delete_class"
            | "cups_add_class_member"
            | "cups_remove_class_member"
            | "cups_list_ppds"
            | "cups_search_ppds"
            | "cups_get_ppd"
            | "cups_get_ppd_options"
            | "cups_upload_ppd"
            | "cups_assign_ppd"
            | "cups_list_drivers"
            | "cups_get_driver"
            | "cups_recommend_driver"
            | "cups_get_driver_options"
            | "cups_get_server_settings"
            | "cups_update_server_settings"
            | "cups_get_error_log"
            | "cups_test_page"
            | "cups_get_subscriptions_status"
            | "cups_cleanup_jobs"
            | "cups_restart"
            | "cups_create_subscription"
            | "cups_cancel_subscription"
            | "cups_list_subscriptions"
            | "cups_get_events"
            | "cups_renew_subscription"
    )
}

fn build_e() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── CUPS (52) ───────────────────────────────────────────────────
        cups_commands::cups_connect,
        cups_commands::cups_disconnect,
        cups_commands::cups_list_sessions,
        cups_commands::cups_list_printers,
        cups_commands::cups_get_printer,
        cups_commands::cups_modify_printer,
        cups_commands::cups_delete_printer,
        cups_commands::cups_pause_printer,
        cups_commands::cups_resume_printer,
        cups_commands::cups_set_default_printer,
        cups_commands::cups_get_default_printer,
        cups_commands::cups_accept_jobs,
        cups_commands::cups_reject_jobs,
        cups_commands::cups_discover_printers,
        cups_commands::cups_list_jobs,
        cups_commands::cups_get_job,
        cups_commands::cups_submit_job,
        cups_commands::cups_submit_job_uri,
        cups_commands::cups_cancel_job,
        cups_commands::cups_hold_job,
        cups_commands::cups_release_job,
        cups_commands::cups_cancel_all_jobs,
        cups_commands::cups_move_job,
        cups_commands::cups_list_classes,
        cups_commands::cups_get_class,
        cups_commands::cups_create_class,
        cups_commands::cups_modify_class,
        cups_commands::cups_delete_class,
        cups_commands::cups_add_class_member,
        cups_commands::cups_remove_class_member,
        cups_commands::cups_list_ppds,
        cups_commands::cups_search_ppds,
        cups_commands::cups_get_ppd,
        cups_commands::cups_get_ppd_options,
        cups_commands::cups_upload_ppd,
        cups_commands::cups_assign_ppd,
        cups_commands::cups_list_drivers,
        cups_commands::cups_get_driver,
        cups_commands::cups_recommend_driver,
        cups_commands::cups_get_driver_options,
        cups_commands::cups_get_server_settings,
        cups_commands::cups_update_server_settings,
        cups_commands::cups_get_error_log,
        cups_commands::cups_test_page,
        cups_commands::cups_get_subscriptions_status,
        cups_commands::cups_cleanup_jobs,
        cups_commands::cups_restart,
        cups_commands::cups_create_subscription,
        cups_commands::cups_cancel_subscription,
        cups_commands::cups_list_subscriptions,
        cups_commands::cups_get_events,
        cups_commands::cups_renew_subscription,    ]
}

fn is_command_f(command: &str) -> bool {
    matches!(
        command,
        // ── FreeIPA (47) ────────────────────────────────────────────────
        "freeipa_connect"
            | "freeipa_disconnect"
            | "freeipa_list_connections"
            | "freeipa_get_dashboard"
            | "freeipa_list_users"
            | "freeipa_get_user"
            | "freeipa_create_user"
            | "freeipa_update_user"
            | "freeipa_delete_user"
            | "freeipa_enable_user"
            | "freeipa_disable_user"
            | "freeipa_list_groups"
            | "freeipa_get_group"
            | "freeipa_create_group"
            | "freeipa_delete_group"
            | "freeipa_add_group_member"
            | "freeipa_remove_group_member"
            | "freeipa_list_hosts"
            | "freeipa_get_host"
            | "freeipa_create_host"
            | "freeipa_delete_host"
            | "freeipa_list_services"
            | "freeipa_get_service"
            | "freeipa_create_service"
            | "freeipa_delete_service"
            | "freeipa_list_dns_zones"
            | "freeipa_get_dns_zone"
            | "freeipa_create_dns_zone"
            | "freeipa_delete_dns_zone"
            | "freeipa_list_dns_records"
            | "freeipa_add_dns_record"
            | "freeipa_delete_dns_record"
            | "freeipa_list_roles"
            | "freeipa_list_privileges"
            | "freeipa_list_permissions"
            | "freeipa_list_certificates"
            | "freeipa_request_certificate"
            | "freeipa_revoke_certificate"
            | "freeipa_list_sudo_rules"
            | "freeipa_create_sudo_rule"
            | "freeipa_delete_sudo_rule"
            | "freeipa_list_hbac_rules"
            | "freeipa_create_hbac_rule"
            | "freeipa_delete_hbac_rule"
            | "freeipa_list_trusts"
            | "freeipa_create_trust"
            | "freeipa_delete_trust"
    )
}

fn build_f() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── FreeIPA (47) ────────────────────────────────────────────────
        freeipa_commands::freeipa_connect,
        freeipa_commands::freeipa_disconnect,
        freeipa_commands::freeipa_list_connections,
        freeipa_commands::freeipa_get_dashboard,
        freeipa_commands::freeipa_list_users,
        freeipa_commands::freeipa_get_user,
        freeipa_commands::freeipa_create_user,
        freeipa_commands::freeipa_update_user,
        freeipa_commands::freeipa_delete_user,
        freeipa_commands::freeipa_enable_user,
        freeipa_commands::freeipa_disable_user,
        freeipa_commands::freeipa_list_groups,
        freeipa_commands::freeipa_get_group,
        freeipa_commands::freeipa_create_group,
        freeipa_commands::freeipa_delete_group,
        freeipa_commands::freeipa_add_group_member,
        freeipa_commands::freeipa_remove_group_member,
        freeipa_commands::freeipa_list_hosts,
        freeipa_commands::freeipa_get_host,
        freeipa_commands::freeipa_create_host,
        freeipa_commands::freeipa_delete_host,
        freeipa_commands::freeipa_list_services,
        freeipa_commands::freeipa_get_service,
        freeipa_commands::freeipa_create_service,
        freeipa_commands::freeipa_delete_service,
        freeipa_commands::freeipa_list_dns_zones,
        freeipa_commands::freeipa_get_dns_zone,
        freeipa_commands::freeipa_create_dns_zone,
        freeipa_commands::freeipa_delete_dns_zone,
        freeipa_commands::freeipa_list_dns_records,
        freeipa_commands::freeipa_add_dns_record,
        freeipa_commands::freeipa_delete_dns_record,
        freeipa_commands::freeipa_list_roles,
        freeipa_commands::freeipa_list_privileges,
        freeipa_commands::freeipa_list_permissions,
        freeipa_commands::freeipa_list_certificates,
        freeipa_commands::freeipa_request_certificate,
        freeipa_commands::freeipa_revoke_certificate,
        freeipa_commands::freeipa_list_sudo_rules,
        freeipa_commands::freeipa_create_sudo_rule,
        freeipa_commands::freeipa_delete_sudo_rule,
        freeipa_commands::freeipa_list_hbac_rules,
        freeipa_commands::freeipa_create_hbac_rule,
        freeipa_commands::freeipa_delete_hbac_rule,
        freeipa_commands::freeipa_list_trusts,
        freeipa_commands::freeipa_create_trust,
        freeipa_commands::freeipa_delete_trust,    ]
}

fn is_command_g(command: &str) -> bool {
    matches!(
        command,
        // ── Fail2ban (44) ───────────────────────────────────────────────
        "f2b_add_host"
            | "f2b_update_host"
            | "f2b_remove_host"
            | "f2b_list_hosts"
            | "f2b_get_host"
            | "f2b_ping"
            | "f2b_version"
            | "f2b_server_status"
            | "f2b_reload"
            | "f2b_reload_jail"
            | "f2b_restart_server"
            | "f2b_list_jails"
            | "f2b_jail_status"
            | "f2b_all_jail_statuses"
            | "f2b_start_jail"
            | "f2b_stop_jail"
            | "f2b_restart_jail"
            | "f2b_set_jail_bantime"
            | "f2b_set_jail_maxretry"
            | "f2b_ban_ip"
            | "f2b_unban_ip"
            | "f2b_unban_ip_all"
            | "f2b_list_banned"
            | "f2b_list_all_banned"
            | "f2b_is_banned"
            | "f2b_list_filters"
            | "f2b_read_filter"
            | "f2b_test_filter"
            | "f2b_test_regex"
            | "f2b_list_actions"
            | "f2b_read_action"
            | "f2b_list_ignored"
            | "f2b_add_ignored"
            | "f2b_remove_ignored"
            | "f2b_add_ignored_all_jails"
            | "f2b_tail_log"
            | "f2b_search_log_by_ip"
            | "f2b_search_log_by_jail"
            | "f2b_search_bans"
            | "f2b_log_info"
            | "f2b_host_stats"
            | "f2b_top_banned_ips"
            | "f2b_log_stats"
            | "f2b_ban_frequency"
    )
}

fn build_g() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── Fail2ban (44) ───────────────────────────────────────────────
        fail2ban_commands::f2b_add_host,
        fail2ban_commands::f2b_update_host,
        fail2ban_commands::f2b_remove_host,
        fail2ban_commands::f2b_list_hosts,
        fail2ban_commands::f2b_get_host,
        fail2ban_commands::f2b_ping,
        fail2ban_commands::f2b_version,
        fail2ban_commands::f2b_server_status,
        fail2ban_commands::f2b_reload,
        fail2ban_commands::f2b_reload_jail,
        fail2ban_commands::f2b_restart_server,
        fail2ban_commands::f2b_list_jails,
        fail2ban_commands::f2b_jail_status,
        fail2ban_commands::f2b_all_jail_statuses,
        fail2ban_commands::f2b_start_jail,
        fail2ban_commands::f2b_stop_jail,
        fail2ban_commands::f2b_restart_jail,
        fail2ban_commands::f2b_set_jail_bantime,
        fail2ban_commands::f2b_set_jail_maxretry,
        fail2ban_commands::f2b_ban_ip,
        fail2ban_commands::f2b_unban_ip,
        fail2ban_commands::f2b_unban_ip_all,
        fail2ban_commands::f2b_list_banned,
        fail2ban_commands::f2b_list_all_banned,
        fail2ban_commands::f2b_is_banned,
        fail2ban_commands::f2b_list_filters,
        fail2ban_commands::f2b_read_filter,
        fail2ban_commands::f2b_test_filter,
        fail2ban_commands::f2b_test_regex,
        fail2ban_commands::f2b_list_actions,
        fail2ban_commands::f2b_read_action,
        fail2ban_commands::f2b_list_ignored,
        fail2ban_commands::f2b_add_ignored,
        fail2ban_commands::f2b_remove_ignored,
        fail2ban_commands::f2b_add_ignored_all_jails,
        fail2ban_commands::f2b_tail_log,
        fail2ban_commands::f2b_search_log_by_ip,
        fail2ban_commands::f2b_search_log_by_jail,
        fail2ban_commands::f2b_search_bans,
        fail2ban_commands::f2b_log_info,
        fail2ban_commands::f2b_host_stats,
        fail2ban_commands::f2b_top_banned_ips,
        fail2ban_commands::f2b_log_stats,
        fail2ban_commands::f2b_ban_frequency,    ]
}


fn is_command_i(command: &str) -> bool {
    matches!(
        command,
        // ── RabbitMQ (58) ──
        "rabbit_connect"
            | "rabbit_disconnect"
            | "rabbit_list_sessions"
            | "rabbit_test_connection"
            | "rabbit_list_vhosts"
            | "rabbit_get_vhost"
            | "rabbit_create_vhost"
            | "rabbit_delete_vhost"
            | "rabbit_list_exchanges"
            | "rabbit_get_exchange"
            | "rabbit_create_exchange"
            | "rabbit_delete_exchange"
            | "rabbit_list_queues"
            | "rabbit_get_queue"
            | "rabbit_create_queue"
            | "rabbit_delete_queue"
            | "rabbit_purge_queue"
            | "rabbit_list_bindings"
            | "rabbit_create_binding"
            | "rabbit_delete_binding"
            | "rabbit_list_users"
            | "rabbit_create_user"
            | "rabbit_delete_user"
            | "rabbit_list_permissions"
            | "rabbit_set_permission"
            | "rabbit_list_policies"
            | "rabbit_create_policy"
            | "rabbit_delete_policy"
            | "rabbit_list_shovels"
            | "rabbit_create_shovel"
            | "rabbit_delete_shovel"
            | "rabbit_restart_shovel"
            | "rabbit_list_federation_upstreams"
            | "rabbit_create_federation_upstream"
            | "rabbit_delete_federation_upstream"
            | "rabbit_list_federation_links"
            | "rabbit_list_nodes"
            | "rabbit_get_node"
            | "rabbit_get_cluster_name"
            | "rabbit_set_cluster_name"
            | "rabbit_check_alarms"
            | "rabbit_list_connections"
            | "rabbit_get_connection"
            | "rabbit_close_connection"
            | "rabbit_list_channels"
            | "rabbit_get_channel"
            | "rabbit_list_consumers"
            | "rabbit_cancel_consumer"
            | "rabbit_get_overview"
            | "rabbit_get_message_rates"
            | "rabbit_get_queue_rates"
            | "rabbit_monitoring_snapshot"
            | "rabbit_aliveness_test"
            | "rabbit_export_definitions"
            | "rabbit_import_definitions"
            | "rabbit_export_vhost_definitions"
            | "rabbit_clone_vhost"
            | "rabbit_definitions_summary"
    )
}

fn build_i() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── RabbitMQ (58) ──
        rabbitmq_commands::rabbit_connect,
        rabbitmq_commands::rabbit_disconnect,
        rabbitmq_commands::rabbit_list_sessions,
        rabbitmq_commands::rabbit_test_connection,
        rabbitmq_commands::rabbit_list_vhosts,
        rabbitmq_commands::rabbit_get_vhost,
        rabbitmq_commands::rabbit_create_vhost,
        rabbitmq_commands::rabbit_delete_vhost,
        rabbitmq_commands::rabbit_list_exchanges,
        rabbitmq_commands::rabbit_get_exchange,
        rabbitmq_commands::rabbit_create_exchange,
        rabbitmq_commands::rabbit_delete_exchange,
        rabbitmq_commands::rabbit_list_queues,
        rabbitmq_commands::rabbit_get_queue,
        rabbitmq_commands::rabbit_create_queue,
        rabbitmq_commands::rabbit_delete_queue,
        rabbitmq_commands::rabbit_purge_queue,
        rabbitmq_commands::rabbit_list_bindings,
        rabbitmq_commands::rabbit_create_binding,
        rabbitmq_commands::rabbit_delete_binding,
        rabbitmq_commands::rabbit_list_users,
        rabbitmq_commands::rabbit_create_user,
        rabbitmq_commands::rabbit_delete_user,
        rabbitmq_commands::rabbit_list_permissions,
        rabbitmq_commands::rabbit_set_permission,
        rabbitmq_commands::rabbit_list_policies,
        rabbitmq_commands::rabbit_create_policy,
        rabbitmq_commands::rabbit_delete_policy,
        rabbitmq_commands::rabbit_list_shovels,
        rabbitmq_commands::rabbit_create_shovel,
        rabbitmq_commands::rabbit_delete_shovel,
        rabbitmq_commands::rabbit_restart_shovel,
        rabbitmq_commands::rabbit_list_federation_upstreams,
        rabbitmq_commands::rabbit_create_federation_upstream,
        rabbitmq_commands::rabbit_delete_federation_upstream,
        rabbitmq_commands::rabbit_list_federation_links,
        rabbitmq_commands::rabbit_list_nodes,
        rabbitmq_commands::rabbit_get_node,
        rabbitmq_commands::rabbit_get_cluster_name,
        rabbitmq_commands::rabbit_set_cluster_name,
        rabbitmq_commands::rabbit_check_alarms,
        rabbitmq_commands::rabbit_list_connections,
        rabbitmq_commands::rabbit_get_connection,
        rabbitmq_commands::rabbit_close_connection,
        rabbitmq_commands::rabbit_list_channels,
        rabbitmq_commands::rabbit_get_channel,
        rabbitmq_commands::rabbit_list_consumers,
        rabbitmq_commands::rabbit_cancel_consumer,
        rabbitmq_commands::rabbit_get_overview,
        rabbitmq_commands::rabbit_get_message_rates,
        rabbitmq_commands::rabbit_get_queue_rates,
        rabbitmq_commands::rabbit_monitoring_snapshot,
        rabbitmq_commands::rabbit_aliveness_test,
        rabbitmq_commands::rabbit_export_definitions,
        rabbitmq_commands::rabbit_import_definitions,
        rabbitmq_commands::rabbit_export_vhost_definitions,
        rabbitmq_commands::rabbit_clone_vhost,
        rabbitmq_commands::rabbit_definitions_summary,
    ]
}

fn is_command_j(command: &str) -> bool {
    matches!(
        command,
        // ── Ceph (57) ──
        "ceph_connect"
            | "ceph_disconnect"
            | "ceph_list_sessions"
            | "ceph_get_cluster_health"
            | "ceph_get_cluster_status"
            | "ceph_get_cluster_df"
            | "ceph_get_cluster_config"
            | "ceph_list_services"
            | "ceph_list_osds"
            | "ceph_get_osd"
            | "ceph_list_pools"
            | "ceph_get_pool"
            | "ceph_list_rbd_images"
            | "ceph_get_rbd_image"
            | "ceph_list_filesystems"
            | "ceph_get_filesystem"
            | "ceph_create_filesystem"
            | "ceph_remove_filesystem"
            | "ceph_list_subvolumes"
            | "ceph_evict_cephfs_client"
            | "ceph_list_rgw_users"
            | "ceph_get_rgw_user"
            | "ceph_create_rgw_user"
            | "ceph_delete_rgw_user"
            | "ceph_list_rgw_buckets"
            | "ceph_get_rgw_bucket"
            | "ceph_list_rgw_zones"
            | "ceph_get_crush_map"
            | "ceph_list_crush_rules"
            | "ceph_get_crush_tunables"
            | "ceph_list_monitors"
            | "ceph_get_quorum_status"
            | "ceph_get_monitor_map"
            | "ceph_compact_monitor_store"
            | "ceph_list_mds_servers"
            | "ceph_get_mds_perf"
            | "ceph_failover_mds"
            | "ceph_list_pgs"
            | "ceph_get_pg_summary"
            | "ceph_repair_pg"
            | "ceph_scrub_pg"
            | "ceph_deep_scrub_pg"
            | "ceph_list_stuck_pgs"
            | "ceph_get_perf_metrics"
            | "ceph_get_slow_requests"
            | "ceph_get_osd_perf"
            | "ceph_get_pool_perf"
            | "ceph_get_performance_counters"
            | "ceph_get_recovery_progress"
            | "ceph_list_health_checks"
            | "ceph_get_health_detail"
            | "ceph_mute_health_check"
            | "ceph_unmute_health_check"
            | "ceph_list_alerts"
            | "ceph_acknowledge_alert"
            | "ceph_clear_alert"
            | "ceph_get_health_summary"
    )
}

fn build_j() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── Ceph (57) ──
        ceph_commands::ceph_connect,
        ceph_commands::ceph_disconnect,
        ceph_commands::ceph_list_sessions,
        ceph_commands::ceph_get_cluster_health,
        ceph_commands::ceph_get_cluster_status,
        ceph_commands::ceph_get_cluster_df,
        ceph_commands::ceph_get_cluster_config,
        ceph_commands::ceph_list_services,
        ceph_commands::ceph_list_osds,
        ceph_commands::ceph_get_osd,
        ceph_commands::ceph_list_pools,
        ceph_commands::ceph_get_pool,
        ceph_commands::ceph_list_rbd_images,
        ceph_commands::ceph_get_rbd_image,
        ceph_commands::ceph_list_filesystems,
        ceph_commands::ceph_get_filesystem,
        ceph_commands::ceph_create_filesystem,
        ceph_commands::ceph_remove_filesystem,
        ceph_commands::ceph_list_subvolumes,
        ceph_commands::ceph_evict_cephfs_client,
        ceph_commands::ceph_list_rgw_users,
        ceph_commands::ceph_get_rgw_user,
        ceph_commands::ceph_create_rgw_user,
        ceph_commands::ceph_delete_rgw_user,
        ceph_commands::ceph_list_rgw_buckets,
        ceph_commands::ceph_get_rgw_bucket,
        ceph_commands::ceph_list_rgw_zones,
        ceph_commands::ceph_get_crush_map,
        ceph_commands::ceph_list_crush_rules,
        ceph_commands::ceph_get_crush_tunables,
        ceph_commands::ceph_list_monitors,
        ceph_commands::ceph_get_quorum_status,
        ceph_commands::ceph_get_monitor_map,
        ceph_commands::ceph_compact_monitor_store,
        ceph_commands::ceph_list_mds_servers,
        ceph_commands::ceph_get_mds_perf,
        ceph_commands::ceph_failover_mds,
        ceph_commands::ceph_list_pgs,
        ceph_commands::ceph_get_pg_summary,
        ceph_commands::ceph_repair_pg,
        ceph_commands::ceph_scrub_pg,
        ceph_commands::ceph_deep_scrub_pg,
        ceph_commands::ceph_list_stuck_pgs,
        ceph_commands::ceph_get_perf_metrics,
        ceph_commands::ceph_get_slow_requests,
        ceph_commands::ceph_get_osd_perf,
        ceph_commands::ceph_get_pool_perf,
        ceph_commands::ceph_get_performance_counters,
        ceph_commands::ceph_get_recovery_progress,
        ceph_commands::ceph_list_health_checks,
        ceph_commands::ceph_get_health_detail,
        ceph_commands::ceph_mute_health_check,
        ceph_commands::ceph_unmute_health_check,
        ceph_commands::ceph_list_alerts,
        ceph_commands::ceph_acknowledge_alert,
        ceph_commands::ceph_clear_alert,
        ceph_commands::ceph_get_health_summary,
    ]
}

fn is_command_k(command: &str) -> bool {
    matches!(
        command,
        // ── Zabbix (53) ──
        "zabbix_connect"
            | "zabbix_disconnect"
            | "zabbix_list_connections"
            | "zabbix_get_dashboard"
            | "zabbix_list_hosts"
            | "zabbix_get_host"
            | "zabbix_create_host"
            | "zabbix_update_host"
            | "zabbix_delete_hosts"
            | "zabbix_list_templates"
            | "zabbix_get_template"
            | "zabbix_create_template"
            | "zabbix_delete_templates"
            | "zabbix_list_items"
            | "zabbix_get_item"
            | "zabbix_create_item"
            | "zabbix_delete_items"
            | "zabbix_list_triggers"
            | "zabbix_get_trigger"
            | "zabbix_create_trigger"
            | "zabbix_delete_triggers"
            | "zabbix_list_actions"
            | "zabbix_get_action"
            | "zabbix_create_action"
            | "zabbix_delete_actions"
            | "zabbix_list_alerts"
            | "zabbix_list_graphs"
            | "zabbix_create_graph"
            | "zabbix_delete_graphs"
            | "zabbix_list_discovery_rules"
            | "zabbix_create_discovery_rule"
            | "zabbix_delete_discovery_rules"
            | "zabbix_list_maintenance"
            | "zabbix_create_maintenance"
            | "zabbix_update_maintenance"
            | "zabbix_delete_maintenance"
            | "zabbix_list_users"
            | "zabbix_get_user"
            | "zabbix_create_user"
            | "zabbix_update_user"
            | "zabbix_delete_users"
            | "zabbix_list_media_types"
            | "zabbix_create_media_type"
            | "zabbix_delete_media_types"
            | "zabbix_list_host_groups"
            | "zabbix_create_host_group"
            | "zabbix_delete_host_groups"
            | "zabbix_list_proxies"
            | "zabbix_get_proxy"
            | "zabbix_create_proxy"
            | "zabbix_delete_proxies"
            | "zabbix_list_problems"
            | "zabbix_acknowledge_problem"
    )
}

fn build_k() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── Zabbix (53) ──
        zabbix_commands::zabbix_connect,
        zabbix_commands::zabbix_disconnect,
        zabbix_commands::zabbix_list_connections,
        zabbix_commands::zabbix_get_dashboard,
        zabbix_commands::zabbix_list_hosts,
        zabbix_commands::zabbix_get_host,
        zabbix_commands::zabbix_create_host,
        zabbix_commands::zabbix_update_host,
        zabbix_commands::zabbix_delete_hosts,
        zabbix_commands::zabbix_list_templates,
        zabbix_commands::zabbix_get_template,
        zabbix_commands::zabbix_create_template,
        zabbix_commands::zabbix_delete_templates,
        zabbix_commands::zabbix_list_items,
        zabbix_commands::zabbix_get_item,
        zabbix_commands::zabbix_create_item,
        zabbix_commands::zabbix_delete_items,
        zabbix_commands::zabbix_list_triggers,
        zabbix_commands::zabbix_get_trigger,
        zabbix_commands::zabbix_create_trigger,
        zabbix_commands::zabbix_delete_triggers,
        zabbix_commands::zabbix_list_actions,
        zabbix_commands::zabbix_get_action,
        zabbix_commands::zabbix_create_action,
        zabbix_commands::zabbix_delete_actions,
        zabbix_commands::zabbix_list_alerts,
        zabbix_commands::zabbix_list_graphs,
        zabbix_commands::zabbix_create_graph,
        zabbix_commands::zabbix_delete_graphs,
        zabbix_commands::zabbix_list_discovery_rules,
        zabbix_commands::zabbix_create_discovery_rule,
        zabbix_commands::zabbix_delete_discovery_rules,
        zabbix_commands::zabbix_list_maintenance,
        zabbix_commands::zabbix_create_maintenance,
        zabbix_commands::zabbix_update_maintenance,
        zabbix_commands::zabbix_delete_maintenance,
        zabbix_commands::zabbix_list_users,
        zabbix_commands::zabbix_get_user,
        zabbix_commands::zabbix_create_user,
        zabbix_commands::zabbix_update_user,
        zabbix_commands::zabbix_delete_users,
        zabbix_commands::zabbix_list_media_types,
        zabbix_commands::zabbix_create_media_type,
        zabbix_commands::zabbix_delete_media_types,
        zabbix_commands::zabbix_list_host_groups,
        zabbix_commands::zabbix_create_host_group,
        zabbix_commands::zabbix_delete_host_groups,
        zabbix_commands::zabbix_list_proxies,
        zabbix_commands::zabbix_get_proxy,
        zabbix_commands::zabbix_create_proxy,
        zabbix_commands::zabbix_delete_proxies,
        zabbix_commands::zabbix_list_problems,
        zabbix_commands::zabbix_acknowledge_problem,
    ]
}

fn is_command_l(command: &str) -> bool {
    matches!(
        command,
        // ── CI/CD (57) ──
        "cicd_connect"
            | "cicd_disconnect"
            | "cicd_list_connections"
            | "cicd_ping"
            | "cicd_get_dashboard"
            | "cicd_list_pipelines"
            | "cicd_get_pipeline"
            | "cicd_list_builds"
            | "cicd_get_build"
            | "cicd_trigger_build"
            | "cicd_cancel_build"
            | "cicd_restart_build"
            | "cicd_get_build_logs"
            | "cicd_list_artifacts"
            | "cicd_get_artifact"
            | "cicd_list_secrets"
            | "cicd_create_secret"
            | "cicd_delete_secret"
            | "cicd_drone_list_repos"
            | "cicd_drone_get_repo"
            | "cicd_drone_activate_repo"
            | "cicd_drone_deactivate_repo"
            | "cicd_drone_list_cron_jobs"
            | "cicd_drone_create_cron_job"
            | "cicd_drone_delete_cron_job"
            | "cicd_jenkins_list_jobs"
            | "cicd_jenkins_get_job"
            | "cicd_jenkins_create_job"
            | "cicd_jenkins_delete_job"
            | "cicd_jenkins_get_console_output"
            | "cicd_jenkins_list_queue"
            | "cicd_jenkins_cancel_queue"
            | "cicd_jenkins_list_nodes"
            | "cicd_jenkins_get_node"
            | "cicd_jenkins_get_system_info"
            | "cicd_jenkins_list_plugins"
            | "cicd_gha_list_workflows"
            | "cicd_gha_get_workflow"
            | "cicd_gha_dispatch_workflow"
            | "cicd_gha_enable_workflow"
            | "cicd_gha_disable_workflow"
            | "cicd_gha_list_workflow_runs"
            | "cicd_gha_get_workflow_run"
            | "cicd_gha_cancel_run"
            | "cicd_gha_rerun_run"
            | "cicd_gha_rerun_failed_jobs"
            | "cicd_gha_list_jobs"
            | "cicd_gha_get_job"
            | "cicd_gha_get_job_logs"
            | "cicd_gha_list_artifacts"
            | "cicd_gha_delete_artifact"
            | "cicd_gha_list_secrets"
            | "cicd_gha_create_or_update_secret"
            | "cicd_gha_delete_secret"
            | "cicd_gha_list_runners"
            | "cicd_gha_get_runner"
            | "cicd_gha_delete_runner"
    )
}

fn build_l() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── CI/CD (57) ──
        cicd_commands::cicd_connect,
        cicd_commands::cicd_disconnect,
        cicd_commands::cicd_list_connections,
        cicd_commands::cicd_ping,
        cicd_commands::cicd_get_dashboard,
        cicd_commands::cicd_list_pipelines,
        cicd_commands::cicd_get_pipeline,
        cicd_commands::cicd_list_builds,
        cicd_commands::cicd_get_build,
        cicd_commands::cicd_trigger_build,
        cicd_commands::cicd_cancel_build,
        cicd_commands::cicd_restart_build,
        cicd_commands::cicd_get_build_logs,
        cicd_commands::cicd_list_artifacts,
        cicd_commands::cicd_get_artifact,
        cicd_commands::cicd_list_secrets,
        cicd_commands::cicd_create_secret,
        cicd_commands::cicd_delete_secret,
        cicd_commands::cicd_drone_list_repos,
        cicd_commands::cicd_drone_get_repo,
        cicd_commands::cicd_drone_activate_repo,
        cicd_commands::cicd_drone_deactivate_repo,
        cicd_commands::cicd_drone_list_cron_jobs,
        cicd_commands::cicd_drone_create_cron_job,
        cicd_commands::cicd_drone_delete_cron_job,
        cicd_commands::cicd_jenkins_list_jobs,
        cicd_commands::cicd_jenkins_get_job,
        cicd_commands::cicd_jenkins_create_job,
        cicd_commands::cicd_jenkins_delete_job,
        cicd_commands::cicd_jenkins_get_console_output,
        cicd_commands::cicd_jenkins_list_queue,
        cicd_commands::cicd_jenkins_cancel_queue,
        cicd_commands::cicd_jenkins_list_nodes,
        cicd_commands::cicd_jenkins_get_node,
        cicd_commands::cicd_jenkins_get_system_info,
        cicd_commands::cicd_jenkins_list_plugins,
        cicd_commands::cicd_gha_list_workflows,
        cicd_commands::cicd_gha_get_workflow,
        cicd_commands::cicd_gha_dispatch_workflow,
        cicd_commands::cicd_gha_enable_workflow,
        cicd_commands::cicd_gha_disable_workflow,
        cicd_commands::cicd_gha_list_workflow_runs,
        cicd_commands::cicd_gha_get_workflow_run,
        cicd_commands::cicd_gha_cancel_run,
        cicd_commands::cicd_gha_rerun_run,
        cicd_commands::cicd_gha_rerun_failed_jobs,
        cicd_commands::cicd_gha_list_jobs,
        cicd_commands::cicd_gha_get_job,
        cicd_commands::cicd_gha_get_job_logs,
        cicd_commands::cicd_gha_list_artifacts,
        cicd_commands::cicd_gha_delete_artifact,
        cicd_commands::cicd_gha_list_secrets,
        cicd_commands::cicd_gha_create_or_update_secret,
        cicd_commands::cicd_gha_delete_secret,
        cicd_commands::cicd_gha_list_runners,
        cicd_commands::cicd_gha_get_runner,
        cicd_commands::cicd_gha_delete_runner,
    ]
}

fn is_command_m(command: &str) -> bool {
    matches!(
        command,
        // ── MySQL admin – delta: 66 previously unwired commands (t3-e57) ─────
        "mysql_admin_rename_user"
            | "mysql_admin_lock_user"
            | "mysql_admin_unlock_user"
            | "mysql_admin_list_grants"
            | "mysql_admin_grant"
            | "mysql_admin_revoke"
            | "mysql_admin_get_master_status"
            | "mysql_admin_configure_master"
            | "mysql_admin_get_gtid_executed"
            | "mysql_admin_get_gtid_purged"
            | "mysql_admin_set_read_only"
            | "mysql_admin_get_database"
            | "mysql_admin_get_database_charset"
            | "mysql_admin_alter_database_charset"
            | "mysql_admin_list_database_tables"
            | "mysql_admin_get_table"
            | "mysql_admin_list_indexes"
            | "mysql_admin_create_index"
            | "mysql_admin_drop_index"
            | "mysql_admin_truncate_table"
            | "mysql_admin_get_create_statement"
            | "mysql_admin_get_row_count"
            | "mysql_admin_is_slow_log_enabled"
            | "mysql_admin_enable_slow_log"
            | "mysql_admin_disable_slow_log"
            | "mysql_admin_get_slow_log_file"
            | "mysql_admin_get_long_query_time"
            | "mysql_admin_set_long_query_time"
            | "mysql_admin_list_slow_queries"
            | "mysql_admin_kill_query"
            | "mysql_admin_get_query_cache_status"
            | "mysql_admin_get_engine_status"
            | "mysql_admin_list_innodb_locks"
            | "mysql_admin_list_innodb_lock_waits"
            | "mysql_admin_get_deadlock_info"
            | "mysql_admin_get_innodb_io_stats"
            | "mysql_admin_get_innodb_row_operations"
            | "mysql_admin_innodb_force_recovery_check"
            | "mysql_admin_list_global_variables"
            | "mysql_admin_list_session_variables"
            | "mysql_admin_get_global_variable"
            | "mysql_admin_get_session_variable"
            | "mysql_admin_set_global_variable"
            | "mysql_admin_set_session_variable"
            | "mysql_admin_list_status_variables"
            | "mysql_admin_get_status_variable"
            | "mysql_admin_get_server_info"
            | "mysql_admin_get_backup_size"
            | "mysql_admin_verify_backup"
            | "mysql_admin_export_table"
            | "mysql_admin_import_sql"
            | "mysql_admin_get_process"
            | "mysql_admin_kill_process_query"
            | "mysql_admin_list_processes_by_user"
            | "mysql_admin_list_processes_by_db"
            | "mysql_admin_get_max_connections"
            | "mysql_admin_get_thread_stats"
            | "mysql_admin_get_current_binlog"
            | "mysql_admin_list_binlog_events"
            | "mysql_admin_purge_binlogs_to"
            | "mysql_admin_purge_binlogs_before"
            | "mysql_admin_get_binlog_format"
            | "mysql_admin_set_binlog_format"
            | "mysql_admin_get_binlog_expire_days"
            | "mysql_admin_set_binlog_expire_days"
            | "mysql_admin_flush_binlogs"
    )
}

fn build_m() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // MySQL admin commands (delta: 66 previously unwired, t3-e57)
        mysql_admin_commands::mysql_admin_rename_user,
        mysql_admin_commands::mysql_admin_lock_user,
        mysql_admin_commands::mysql_admin_unlock_user,
        mysql_admin_commands::mysql_admin_list_grants,
        mysql_admin_commands::mysql_admin_grant,
        mysql_admin_commands::mysql_admin_revoke,
        mysql_admin_commands::mysql_admin_get_master_status,
        mysql_admin_commands::mysql_admin_configure_master,
        mysql_admin_commands::mysql_admin_get_gtid_executed,
        mysql_admin_commands::mysql_admin_get_gtid_purged,
        mysql_admin_commands::mysql_admin_set_read_only,
        mysql_admin_commands::mysql_admin_get_database,
        mysql_admin_commands::mysql_admin_get_database_charset,
        mysql_admin_commands::mysql_admin_alter_database_charset,
        mysql_admin_commands::mysql_admin_list_database_tables,
        mysql_admin_commands::mysql_admin_get_table,
        mysql_admin_commands::mysql_admin_list_indexes,
        mysql_admin_commands::mysql_admin_create_index,
        mysql_admin_commands::mysql_admin_drop_index,
        mysql_admin_commands::mysql_admin_truncate_table,
        mysql_admin_commands::mysql_admin_get_create_statement,
        mysql_admin_commands::mysql_admin_get_row_count,
        mysql_admin_commands::mysql_admin_is_slow_log_enabled,
        mysql_admin_commands::mysql_admin_enable_slow_log,
        mysql_admin_commands::mysql_admin_disable_slow_log,
        mysql_admin_commands::mysql_admin_get_slow_log_file,
        mysql_admin_commands::mysql_admin_get_long_query_time,
        mysql_admin_commands::mysql_admin_set_long_query_time,
        mysql_admin_commands::mysql_admin_list_slow_queries,
        mysql_admin_commands::mysql_admin_kill_query,
        mysql_admin_commands::mysql_admin_get_query_cache_status,
        mysql_admin_commands::mysql_admin_get_engine_status,
        mysql_admin_commands::mysql_admin_list_innodb_locks,
        mysql_admin_commands::mysql_admin_list_innodb_lock_waits,
        mysql_admin_commands::mysql_admin_get_deadlock_info,
        mysql_admin_commands::mysql_admin_get_innodb_io_stats,
        mysql_admin_commands::mysql_admin_get_innodb_row_operations,
        mysql_admin_commands::mysql_admin_innodb_force_recovery_check,
        mysql_admin_commands::mysql_admin_list_global_variables,
        mysql_admin_commands::mysql_admin_list_session_variables,
        mysql_admin_commands::mysql_admin_get_global_variable,
        mysql_admin_commands::mysql_admin_get_session_variable,
        mysql_admin_commands::mysql_admin_set_global_variable,
        mysql_admin_commands::mysql_admin_set_session_variable,
        mysql_admin_commands::mysql_admin_list_status_variables,
        mysql_admin_commands::mysql_admin_get_status_variable,
        mysql_admin_commands::mysql_admin_get_server_info,
        mysql_admin_commands::mysql_admin_get_backup_size,
        mysql_admin_commands::mysql_admin_verify_backup,
        mysql_admin_commands::mysql_admin_export_table,
        mysql_admin_commands::mysql_admin_import_sql,
        mysql_admin_commands::mysql_admin_get_process,
        mysql_admin_commands::mysql_admin_kill_process_query,
        mysql_admin_commands::mysql_admin_list_processes_by_user,
        mysql_admin_commands::mysql_admin_list_processes_by_db,
        mysql_admin_commands::mysql_admin_get_max_connections,
        mysql_admin_commands::mysql_admin_get_thread_stats,
        mysql_admin_commands::mysql_admin_get_current_binlog,
        mysql_admin_commands::mysql_admin_list_binlog_events,
        mysql_admin_commands::mysql_admin_purge_binlogs_to,
        mysql_admin_commands::mysql_admin_purge_binlogs_before,
        mysql_admin_commands::mysql_admin_get_binlog_format,
        mysql_admin_commands::mysql_admin_set_binlog_format,
        mysql_admin_commands::mysql_admin_get_binlog_expire_days,
        mysql_admin_commands::mysql_admin_set_binlog_expire_days,
        mysql_admin_commands::mysql_admin_flush_binlogs,
    ]
}

fn is_command_r(command: &str) -> bool {
    matches!(
        command,
        // ── Consul (32) ── t5-e6 ─────────────────────────────────────
        "consul_connect"
            | "consul_disconnect"
            | "consul_list_connections"
            | "consul_get_dashboard"
            | "consul_kv_get"
            | "consul_kv_put"
            | "consul_kv_delete"
            | "consul_kv_list"
            | "consul_kv_get_tree"
            | "consul_list_services"
            | "consul_get_service"
            | "consul_register_service"
            | "consul_deregister_service"
            | "consul_list_nodes"
            | "consul_get_node"
            | "consul_list_datacenters"
            | "consul_node_health"
            | "consul_service_health"
            | "consul_agent_info"
            | "consul_agent_members"
            | "consul_agent_join"
            | "consul_agent_leave"
            | "consul_agent_metrics"
            | "consul_acl_list_tokens"
            | "consul_acl_create_token"
            | "consul_acl_list_policies"
            | "consul_acl_create_policy"
            | "consul_sessions_list"
            | "consul_sessions_create"
            | "consul_sessions_delete"
            | "consul_fire_event"
            | "consul_list_events"
    )
}

fn build_r() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Consul commands (32, t5-e6)
        consul_commands::consul_connect,
        consul_commands::consul_disconnect,
        consul_commands::consul_list_connections,
        consul_commands::consul_get_dashboard,
        consul_commands::consul_kv_get,
        consul_commands::consul_kv_put,
        consul_commands::consul_kv_delete,
        consul_commands::consul_kv_list,
        consul_commands::consul_kv_get_tree,
        consul_commands::consul_list_services,
        consul_commands::consul_get_service,
        consul_commands::consul_register_service,
        consul_commands::consul_deregister_service,
        consul_commands::consul_list_nodes,
        consul_commands::consul_get_node,
        consul_commands::consul_list_datacenters,
        consul_commands::consul_node_health,
        consul_commands::consul_service_health,
        consul_commands::consul_agent_info,
        consul_commands::consul_agent_members,
        consul_commands::consul_agent_join,
        consul_commands::consul_agent_leave,
        consul_commands::consul_agent_metrics,
        consul_commands::consul_acl_list_tokens,
        consul_commands::consul_acl_create_token,
        consul_commands::consul_acl_list_policies,
        consul_commands::consul_acl_create_policy,
        consul_commands::consul_sessions_list,
        consul_commands::consul_sessions_create,
        consul_commands::consul_sessions_delete,
        consul_commands::consul_fire_event,
        consul_commands::consul_list_events,
    ]
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    let a = build_a();
    let b = build_b();
    let c = build_c();
    let d = build_d();
    let e = build_e();
    let f = build_f();
    let g = build_g();
    let h = build_h();
    let i = build_i();
    let j = build_j();
    let k = build_k();
    let l = build_l();
    let m = build_m();
    let r = build_r();
    move |invoke| {
        let cmd = invoke.message.command();
        if is_command_a(cmd) { return a(invoke); }
        if is_command_b(cmd) { return b(invoke); }
        if is_command_c(cmd) { return c(invoke); }
        if is_command_d(cmd) { return d(invoke); }
        if is_command_e(cmd) { return e(invoke); }
        if is_command_f(cmd) { return f(invoke); }
        if is_command_g(cmd) { return g(invoke); }
        if is_command_h(cmd) { return h(invoke); }
        if is_command_i(cmd) { return i(invoke); }
        if is_command_j(cmd) { return j(invoke); }
        if is_command_k(cmd) { return k(invoke); }
        if is_command_l(cmd) { return l(invoke); }
        if is_command_m(cmd) { return m(invoke); }
        if is_command_r(cmd) { return r(invoke); }
        false
    }
}
