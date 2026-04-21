use crate::*;

pub fn is_command(command: &str) -> bool {
    matches!(
        command,
        "hyperv_check_module"
            | "hyperv_get_config"
            | "hyperv_set_config"
            | "hyperv_list_vms"
            | "hyperv_list_vms_summary"
            | "hyperv_get_vm"
            | "hyperv_get_vm_by_id"
            | "hyperv_create_vm"
            | "hyperv_start_vm"
            | "hyperv_stop_vm"
            | "hyperv_restart_vm"
            | "hyperv_pause_vm"
            | "hyperv_resume_vm"
            | "hyperv_save_vm"
            | "hyperv_remove_vm"
            | "hyperv_update_vm"
            | "hyperv_rename_vm"
            | "hyperv_export_vm"
            | "hyperv_import_vm"
            | "hyperv_live_migrate"
            | "hyperv_get_integration_services"
            | "hyperv_set_integration_service"
            | "hyperv_add_dvd_drive"
            | "hyperv_set_dvd_drive"
            | "hyperv_remove_dvd_drive"
            | "hyperv_add_hard_drive"
            | "hyperv_remove_hard_drive"
            | "hyperv_list_checkpoints"
            | "hyperv_get_checkpoint"
            | "hyperv_create_checkpoint"
            | "hyperv_restore_checkpoint"
            | "hyperv_restore_checkpoint_by_id"
            | "hyperv_remove_checkpoint"
            | "hyperv_remove_checkpoint_tree"
            | "hyperv_remove_all_checkpoints"
            | "hyperv_rename_checkpoint"
            | "hyperv_export_checkpoint"
            | "hyperv_list_switches"
            | "hyperv_get_switch"
            | "hyperv_create_switch"
            | "hyperv_remove_switch"
            | "hyperv_rename_switch"
            | "hyperv_list_physical_adapters"
            | "hyperv_list_vm_adapters"
            | "hyperv_add_vm_adapter"
            | "hyperv_remove_vm_adapter"
            | "hyperv_connect_adapter"
            | "hyperv_disconnect_adapter"
            | "hyperv_set_adapter_vlan"
            | "hyperv_set_adapter_vlan_trunk"
            | "hyperv_remove_adapter_vlan"
            | "hyperv_get_vhd"
            | "hyperv_test_vhd"
            | "hyperv_create_vhd"
            | "hyperv_resize_vhd"
            | "hyperv_convert_vhd"
            | "hyperv_compact_vhd"
            | "hyperv_optimize_vhd"
            | "hyperv_merge_vhd"
            | "hyperv_mount_vhd"
            | "hyperv_dismount_vhd"
            | "hyperv_delete_vhd"
            | "hyperv_list_vm_hard_drives"
            | "hyperv_get_vm_metrics"
            | "hyperv_get_all_vm_metrics"
            | "hyperv_enable_metering"
            | "hyperv_disable_metering"
            | "hyperv_reset_metering"
            | "hyperv_get_metering_report"
            | "hyperv_get_host_info"
            | "hyperv_get_events"
            | "hyperv_set_host_paths"
            | "hyperv_set_live_migration"
            | "hyperv_set_numa_spanning"
            | "hyperv_get_replication"
            | "hyperv_list_replicated_vms"
            | "hyperv_enable_replication"
            | "hyperv_disable_replication"
            | "hyperv_start_initial_replication"
            | "hyperv_suspend_replication"
            | "hyperv_resume_replication"
            | "hyperv_planned_failover"
            | "hyperv_unplanned_failover"
            | "hyperv_complete_failover"
            | "hyperv_cancel_failover"
            | "hyperv_reverse_replication"
            | "hyperv_start_test_failover"
            | "hyperv_stop_test_failover"
            | "mc_connect"
            | "mc_disconnect"
            | "mc_disconnect_all"
            | "mc_get_session_info"
            | "mc_list_sessions"
            | "mc_ping"
            | "mc_get_server_info"
            | "mc_get_server_version"
            | "mc_health_check"
            | "mc_list_devices"
            | "mc_get_device_info"
            | "mc_add_local_device"
            | "mc_add_amt_device"
            | "mc_edit_device"
            | "mc_remove_devices"
            | "mc_move_device_to_group"
            | "mc_list_device_groups"
            | "mc_create_device_group"
            | "mc_edit_device_group"
            | "mc_remove_device_group"
            | "mc_list_users"
            | "mc_add_user"
            | "mc_edit_user"
            | "mc_remove_user"
            | "mc_list_user_groups"
            | "mc_create_user_group"
            | "mc_remove_user_group"
            | "mc_power_action"
            | "mc_wake_devices"
            | "mc_run_commands"
            | "mc_run_command_on_device"
            | "mc_upload_file"
            | "mc_download_file"
            | "mc_get_transfer_progress"
            | "mc_get_active_transfers"
            | "mc_cancel_transfer"
            | "mc_list_events"
            | "mc_create_device_share"
            | "mc_list_device_shares"
            | "mc_remove_device_share"
            | "mc_send_toast"
            | "mc_send_message_box"
            | "mc_send_open_url"
            | "mc_broadcast_message"
            | "mc_download_agent_to_file"
            | "mc_send_invite_email"
            | "mc_generate_invite_link"
            | "mc_generate_report"
            | "mc_create_web_relay"
            | "vmware_connect"
            | "vmware_disconnect"
            | "vmware_check_session"
            | "vmware_is_connected"
            | "vmware_get_config"
            | "vmware_list_vms"
            | "vmware_list_running_vms"
            | "vmware_get_vm"
            | "vmware_create_vm"
            | "vmware_delete_vm"
            | "vmware_power_on"
            | "vmware_power_off"
            | "vmware_suspend"
            | "vmware_reset"
            | "vmware_shutdown_guest"
            | "vmware_reboot_guest"
            | "vmware_get_guest_identity"
            | "vmware_update_cpu"
            | "vmware_update_memory"
            | "vmware_clone_vm"
            | "vmware_relocate_vm"
            | "vmware_find_vm_by_name"
            | "vmware_get_power_state"
            | "vmware_list_snapshots"
            | "vmware_create_snapshot"
            | "vmware_revert_snapshot"
            | "vmware_delete_snapshot"
            | "vmware_delete_all_snapshots"
            | "vmware_list_networks"
            | "vmware_get_network"
            | "vmware_list_datastores"
            | "vmware_get_datastore"
            | "vmware_list_hosts"
            | "vmware_get_host"
            | "vmware_disconnect_host"
            | "vmware_reconnect_host"
            | "vmware_list_clusters"
            | "vmware_list_datacenters"
            | "vmware_list_folders"
            | "vmware_list_resource_pools"
            | "vmware_get_vm_stats"
            | "vmware_get_all_vm_stats"
            | "vmware_get_inventory_summary"
            | "vmware_acquire_console_ticket"
            | "vmware_open_console"
            | "vmware_close_console"
            | "vmware_close_all_consoles"
            | "vmware_list_console_sessions"
            | "vmware_get_console_session"
            | "vmware_launch_vmrc"
            | "vmware_list_vmrc_sessions"
            | "vmware_close_vmrc_session"
            | "vmware_close_all_vmrc_sessions"
            | "vmware_is_vmrc_available"
            | "vmware_is_horizon_available"
            | "proxmox_connect"
            | "proxmox_disconnect"
            | "proxmox_check_session"
            | "proxmox_is_connected"
            | "proxmox_get_config"
            | "proxmox_get_version"
            | "proxmox_list_nodes"
            | "proxmox_get_node_status"
            | "proxmox_list_node_services"
            | "proxmox_start_node_service"
            | "proxmox_stop_node_service"
            | "proxmox_restart_node_service"
            | "proxmox_get_node_dns"
            | "proxmox_get_node_syslog"
            | "proxmox_list_apt_updates"
            | "proxmox_reboot_node"
            | "proxmox_shutdown_node"
            | "proxmox_list_qemu_vms"
            | "proxmox_get_qemu_status"
            | "proxmox_get_qemu_config"
            | "proxmox_create_qemu_vm"
            | "proxmox_delete_qemu_vm"
            | "proxmox_start_qemu_vm"
            | "proxmox_stop_qemu_vm"
            | "proxmox_shutdown_qemu_vm"
            | "proxmox_reboot_qemu_vm"
            | "proxmox_suspend_qemu_vm"
            | "proxmox_resume_qemu_vm"
            | "proxmox_reset_qemu_vm"
            | "proxmox_resize_qemu_disk"
            | "proxmox_clone_qemu_vm"
            | "proxmox_migrate_qemu_vm"
            | "proxmox_convert_qemu_to_template"
            | "proxmox_qemu_agent_exec"
            | "proxmox_qemu_agent_network"
            | "proxmox_qemu_agent_osinfo"
            | "proxmox_get_next_vmid"
            | "proxmox_list_lxc_containers"
            | "proxmox_get_lxc_status"
            | "proxmox_get_lxc_config"
            | "proxmox_create_lxc_container"
            | "proxmox_delete_lxc_container"
            | "proxmox_start_lxc_container"
            | "proxmox_stop_lxc_container"
            | "proxmox_shutdown_lxc_container"
            | "proxmox_reboot_lxc_container"
            | "proxmox_clone_lxc_container"
            | "proxmox_migrate_lxc_container"
            | "proxmox_list_storage"
            | "proxmox_list_storage_content"
            | "proxmox_delete_storage_volume"
            | "proxmox_download_to_storage"
            | "proxmox_list_network_interfaces"
            | "proxmox_get_network_interface"
            | "proxmox_create_network_interface"
            | "proxmox_delete_network_interface"
            | "proxmox_apply_network_changes"
            | "proxmox_revert_network_changes"
            | "proxmox_get_cluster_status"
            | "proxmox_list_cluster_resources"
            | "proxmox_get_cluster_next_id"
            | "proxmox_list_users"
            | "proxmox_list_roles"
            | "proxmox_list_groups"
            | "proxmox_list_tasks"
            | "proxmox_get_task_status"
            | "proxmox_get_task_log"
            | "proxmox_stop_task"
            | "proxmox_list_backup_jobs"
            | "proxmox_vzdump"
            | "proxmox_restore_backup"
            | "proxmox_list_backups"
            | "proxmox_get_cluster_firewall_options"
            | "proxmox_list_cluster_firewall_rules"
            | "proxmox_list_security_groups"
            | "proxmox_list_firewall_aliases"
            | "proxmox_list_firewall_ipsets"
            | "proxmox_list_guest_firewall_rules"
            | "proxmox_list_pools"
            | "proxmox_get_pool"
            | "proxmox_create_pool"
            | "proxmox_delete_pool"
            | "proxmox_list_ha_resources"
            | "proxmox_list_ha_groups"
            | "proxmox_get_ceph_status"
            | "proxmox_list_ceph_pools"
            | "proxmox_list_ceph_monitors"
            | "proxmox_list_ceph_osds"
            | "proxmox_list_sdn_zones"
            | "proxmox_list_sdn_vnets"
            | "proxmox_qemu_vnc_proxy"
            | "proxmox_qemu_spice_proxy"
            | "proxmox_qemu_termproxy"
            | "proxmox_lxc_vnc_proxy"
            | "proxmox_lxc_spice_proxy"
            | "proxmox_lxc_termproxy"
            | "proxmox_node_termproxy"
            | "proxmox_list_qemu_snapshots"
            | "proxmox_create_qemu_snapshot"
            | "proxmox_rollback_qemu_snapshot"
            | "proxmox_delete_qemu_snapshot"
            | "proxmox_list_lxc_snapshots"
            | "proxmox_create_lxc_snapshot"
            | "proxmox_rollback_lxc_snapshot"
            | "proxmox_delete_lxc_snapshot"
            | "proxmox_node_rrd"
            | "proxmox_qemu_rrd"
            | "proxmox_lxc_rrd"
            | "proxmox_list_appliance_templates"
            | "proxmox_download_appliance"
            | "proxmox_list_isos"
            | "proxmox_list_container_templates"
            | "idrac_connect"
            | "idrac_disconnect"
            | "idrac_check_session"
            | "idrac_is_connected"
            | "idrac_get_config"
            | "idrac_get_system_info"
            | "idrac_get_idrac_info"
            | "idrac_set_asset_tag"
            | "idrac_set_indicator_led"
            | "idrac_power_action"
            | "idrac_get_power_state"
            | "idrac_get_power_metrics"
            | "idrac_list_power_supplies"
            | "idrac_set_power_cap"
            | "idrac_get_thermal_data"
            | "idrac_get_thermal_summary"
            | "idrac_set_fan_offset"
            | "idrac_list_processors"
            | "idrac_list_memory"
            | "idrac_list_pcie_devices"
            | "idrac_get_total_memory"
            | "idrac_get_processor_count"
            | "idrac_list_storage_controllers"
            | "idrac_list_virtual_disks"
            | "idrac_list_physical_disks"
            | "idrac_list_enclosures"
            | "idrac_create_virtual_disk"
            | "idrac_delete_virtual_disk"
            | "idrac_assign_hotspare"
            | "idrac_initialize_virtual_disk"
            | "idrac_list_network_adapters"
            | "idrac_list_network_ports"
            | "idrac_get_network_config"
            | "idrac_update_network_config"
            | "idrac_list_firmware"
            | "idrac_update_firmware"
            | "idrac_get_component_version"
            | "idrac_list_jobs"
            | "idrac_get_job"
            | "idrac_delete_job"
            | "idrac_purge_job_queue"
            | "idrac_export_scp"
            | "idrac_import_scp"
            | "idrac_get_lc_status"
            | "idrac_wait_for_job"
            | "idrac_list_virtual_media"
            | "idrac_mount_virtual_media"
            | "idrac_unmount_virtual_media"
            | "idrac_boot_from_virtual_cd"
            | "idrac_get_console_info"
            | "idrac_set_console_enabled"
            | "idrac_set_console_type"
            | "idrac_set_vnc_enabled"
            | "idrac_set_vnc_password"
            | "idrac_get_sel_entries"
            | "idrac_get_lc_log_entries"
            | "idrac_clear_sel"
            | "idrac_clear_lc_log"
            | "idrac_list_users"
            | "idrac_create_or_update_user"
            | "idrac_delete_user"
            | "idrac_unlock_user"
            | "idrac_change_user_password"
            | "idrac_get_ldap_config"
            | "idrac_get_ad_config"
            | "idrac_get_bios_attributes"
            | "idrac_get_bios_attribute"
            | "idrac_set_bios_attributes"
            | "idrac_get_boot_order"
            | "idrac_set_boot_order"
            | "idrac_set_boot_once"
            | "idrac_set_boot_mode"
            | "idrac_list_certificates"
            | "idrac_generate_csr"
            | "idrac_import_certificate"
            | "idrac_delete_certificate"
            | "idrac_replace_ssl_certificate"
            | "idrac_get_health_rollup"
            | "idrac_get_component_health"
            | "idrac_is_healthy"
            | "idrac_get_power_telemetry"
            | "idrac_get_thermal_telemetry"
            | "idrac_list_telemetry_reports"
            | "idrac_get_telemetry_report"
            | "idrac_racadm_execute"
            | "idrac_reset"
            | "idrac_get_attribute"
            | "idrac_set_attribute"
            | "idrac_get_dashboard"
            | "ilo_connect"
            | "ilo_disconnect"
            | "ilo_check_session"
            | "ilo_is_connected"
            | "ilo_get_config"
            | "ilo_get_system_info"
            | "ilo_get_ilo_info"
            | "ilo_set_asset_tag"
            | "ilo_set_indicator_led"
            | "ilo_power_action"
            | "ilo_get_power_state"
            | "ilo_get_power_metrics"
            | "ilo_get_thermal_data"
            | "ilo_get_thermal_summary"
            | "ilo_get_processors"
            | "ilo_get_memory"
            | "ilo_get_storage_controllers"
            | "ilo_get_virtual_disks"
            | "ilo_get_physical_disks"
            | "ilo_get_network_adapters"
            | "ilo_get_ilo_network"
            | "ilo_get_firmware_inventory"
            | "ilo_get_virtual_media_status"
            | "ilo_insert_virtual_media"
            | "ilo_eject_virtual_media"
            | "ilo_set_vm_boot_once"
            | "ilo_get_console_info"
            | "ilo_get_html5_launch_url"
            | "ilo_get_iml"
            | "ilo_get_ilo_event_log"
            | "ilo_clear_iml"
            | "ilo_clear_ilo_event_log"
            | "ilo_get_users"
            | "ilo_create_user"
            | "ilo_update_password"
            | "ilo_delete_user"
            | "ilo_set_user_enabled"
            | "ilo_get_bios_attributes"
            | "ilo_set_bios_attributes"
            | "ilo_get_boot_config"
            | "ilo_set_boot_override"
            | "ilo_get_certificate"
            | "ilo_generate_csr"
            | "ilo_import_certificate"
            | "ilo_get_health_rollup"
            | "ilo_get_dashboard"
            | "ilo_get_license"
            | "ilo_activate_license"
            | "ilo_deactivate_license"
            | "ilo_get_security_status"
            | "ilo_set_min_tls_version"
            | "ilo_set_ipmi_over_lan"
            | "ilo_get_federation_groups"
            | "ilo_get_federation_peers"
            | "ilo_add_federation_group"
            | "ilo_remove_federation_group"
            | "ilo_reset"
            | "lenovo_connect"
            | "lenovo_disconnect"
            | "lenovo_check_session"
            | "lenovo_is_connected"
            | "lenovo_get_config"
            | "lenovo_get_system_info"
            | "lenovo_get_xcc_info"
            | "lenovo_set_asset_tag"
            | "lenovo_set_indicator_led"
            | "lenovo_power_action"
            | "lenovo_get_power_state"
            | "lenovo_get_power_metrics"
            | "lenovo_get_thermal_data"
            | "lenovo_get_thermal_summary"
            | "lenovo_get_processors"
            | "lenovo_get_memory"
            | "lenovo_get_storage_controllers"
            | "lenovo_get_virtual_disks"
            | "lenovo_get_physical_disks"
            | "lenovo_get_network_adapters"
            | "lenovo_get_xcc_network"
            | "lenovo_get_firmware_inventory"
            | "lenovo_get_virtual_media_status"
            | "lenovo_insert_virtual_media"
            | "lenovo_eject_virtual_media"
            | "lenovo_get_console_info"
            | "lenovo_get_html5_launch_url"
            | "lenovo_get_event_log"
            | "lenovo_get_audit_log"
            | "lenovo_clear_event_log"
            | "lenovo_get_users"
            | "lenovo_create_user"
            | "lenovo_update_password"
            | "lenovo_delete_user"
            | "lenovo_get_bios_attributes"
            | "lenovo_set_bios_attributes"
            | "lenovo_get_boot_config"
            | "lenovo_set_boot_override"
            | "lenovo_get_certificate"
            | "lenovo_generate_csr"
            | "lenovo_import_certificate"
            | "lenovo_get_health_rollup"
            | "lenovo_get_dashboard"
            | "lenovo_get_license"
            | "lenovo_onecli_execute"
            | "lenovo_reset_controller"
            | "smc_connect"
            | "smc_disconnect"
            | "smc_check_session"
            | "smc_is_connected"
            | "smc_get_config"
            | "smc_get_system_info"
            | "smc_get_bmc_info"
            | "smc_set_asset_tag"
            | "smc_set_indicator_led"
            | "smc_power_action"
            | "smc_get_power_state"
            | "smc_get_power_metrics"
            | "smc_get_thermal_data"
            | "smc_get_thermal_summary"
            | "smc_get_processors"
            | "smc_get_memory"
            | "smc_get_storage_controllers"
            | "smc_get_virtual_disks"
            | "smc_get_physical_disks"
            | "smc_get_network_adapters"
            | "smc_get_bmc_network"
            | "smc_get_firmware_inventory"
            | "smc_get_virtual_media_status"
            | "smc_insert_virtual_media"
            | "smc_eject_virtual_media"
            | "smc_get_console_info"
            | "smc_get_html5_ikvm_url"
            | "smc_get_event_log"
            | "smc_get_audit_log"
            | "smc_clear_event_log"
            | "smc_get_users"
            | "smc_create_user"
            | "smc_update_password"
            | "smc_delete_user"
            | "smc_get_bios_attributes"
            | "smc_set_bios_attributes"
            | "smc_get_boot_config"
            | "smc_set_boot_override"
            | "smc_get_certificate"
            | "smc_generate_csr"
            | "smc_import_certificate"
            | "smc_get_health_rollup"
            | "smc_get_dashboard"
            | "smc_get_security_status"
            | "smc_get_licenses"
            | "smc_activate_license"
            | "smc_get_node_manager_policies"
            | "smc_get_node_manager_stats"
            | "smc_reset_bmc"
            | "syn_connect"
            | "syn_disconnect"
            | "syn_is_connected"
            | "syn_check_session"
            | "syn_get_config"
            | "syn_get_system_info"
            | "syn_get_utilization"
            | "syn_list_processes"
            | "syn_reboot"
            | "syn_shutdown"
            | "syn_check_update"
            | "syn_get_storage_overview"
            | "syn_list_disks"
            | "syn_list_volumes"
            | "syn_get_smart_info"
            | "syn_list_iscsi_luns"
            | "syn_list_iscsi_targets"
            | "syn_get_file_station_info"
            | "syn_list_files"
            | "syn_list_file_shared_folders"
            | "syn_search_files"
            | "syn_upload_file"
            | "syn_download_file"
            | "syn_create_folder"
            | "syn_delete_files"
            | "syn_rename_file"
            | "syn_create_share_link"
            | "syn_list_shared_folders"
            | "syn_get_share_permissions"
            | "syn_create_shared_folder"
            | "syn_delete_shared_folder"
            | "syn_mount_encrypted_share"
            | "syn_unmount_encrypted_share"
            | "syn_get_network_overview"
            | "syn_list_network_interfaces"
            | "syn_list_firewall_rules"
            | "syn_list_dhcp_leases"
            | "syn_list_users"
            | "syn_create_user"
            | "syn_delete_user"
            | "syn_list_groups"
            | "syn_list_packages"
            | "syn_start_package"
            | "syn_stop_package"
            | "syn_install_package"
            | "syn_uninstall_package"
            | "syn_list_services"
            | "syn_get_smb_config"
            | "syn_get_nfs_config"
            | "syn_get_ssh_config"
            | "syn_set_ssh_enabled"
            | "syn_list_docker_containers"
            | "syn_start_docker_container"
            | "syn_stop_docker_container"
            | "syn_restart_docker_container"
            | "syn_delete_docker_container"
            | "syn_list_docker_images"
            | "syn_pull_docker_image"
            | "syn_list_docker_networks"
            | "syn_list_docker_projects"
            | "syn_start_docker_project"
            | "syn_stop_docker_project"
            | "syn_list_vms"
            | "syn_vm_power_on"
            | "syn_vm_shutdown"
            | "syn_vm_force_shutdown"
            | "syn_list_vm_snapshots"
            | "syn_take_vm_snapshot"
            | "syn_get_download_station_info"
            | "syn_list_download_tasks"
            | "syn_create_download_task"
            | "syn_pause_download"
            | "syn_resume_download"
            | "syn_delete_download"
            | "syn_get_download_stats"
            | "syn_get_surveillance_info"
            | "syn_list_cameras"
            | "syn_get_camera_snapshot"
            | "syn_list_recordings"
            | "syn_list_backup_tasks"
            | "syn_start_backup_task"
            | "syn_cancel_backup_task"
            | "syn_list_backup_versions"
            | "syn_list_active_backup_devices"
            | "syn_get_security_overview"
            | "syn_list_blocked_ips"
            | "syn_unblock_ip"
            | "syn_list_certificates"
            | "syn_get_auto_block_config"
            | "syn_get_hardware_info"
            | "syn_get_ups_info"
            | "syn_get_power_schedule"
            | "syn_get_system_logs"
            | "syn_get_connection_logs"
            | "syn_get_active_connections"
            | "syn_get_notification_config"
            | "syn_test_email_notification"
            | "syn_get_dashboard"
    )
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        hyperv_commands::hyperv_check_module,
        hyperv_commands::hyperv_get_config,
        hyperv_commands::hyperv_set_config,
        // Hyper-V commands — VM Lifecycle
        hyperv_commands::hyperv_list_vms,
        hyperv_commands::hyperv_list_vms_summary,
        hyperv_commands::hyperv_get_vm,
        hyperv_commands::hyperv_get_vm_by_id,
        hyperv_commands::hyperv_create_vm,
        hyperv_commands::hyperv_start_vm,
        hyperv_commands::hyperv_stop_vm,
        hyperv_commands::hyperv_restart_vm,
        hyperv_commands::hyperv_pause_vm,
        hyperv_commands::hyperv_resume_vm,
        hyperv_commands::hyperv_save_vm,
        hyperv_commands::hyperv_remove_vm,
        hyperv_commands::hyperv_update_vm,
        hyperv_commands::hyperv_rename_vm,
        hyperv_commands::hyperv_export_vm,
        hyperv_commands::hyperv_import_vm,
        hyperv_commands::hyperv_live_migrate,
        hyperv_commands::hyperv_get_integration_services,
        hyperv_commands::hyperv_set_integration_service,
        hyperv_commands::hyperv_add_dvd_drive,
        hyperv_commands::hyperv_set_dvd_drive,
        hyperv_commands::hyperv_remove_dvd_drive,
        hyperv_commands::hyperv_add_hard_drive,
        hyperv_commands::hyperv_remove_hard_drive,
        // Hyper-V commands — Snapshots / Checkpoints
        hyperv_commands::hyperv_list_checkpoints,
        hyperv_commands::hyperv_get_checkpoint,
        hyperv_commands::hyperv_create_checkpoint,
        hyperv_commands::hyperv_restore_checkpoint,
        hyperv_commands::hyperv_restore_checkpoint_by_id,
        hyperv_commands::hyperv_remove_checkpoint,
        hyperv_commands::hyperv_remove_checkpoint_tree,
        hyperv_commands::hyperv_remove_all_checkpoints,
        hyperv_commands::hyperv_rename_checkpoint,
        hyperv_commands::hyperv_export_checkpoint,
        // Hyper-V commands — Networking
        hyperv_commands::hyperv_list_switches,
        hyperv_commands::hyperv_get_switch,
        hyperv_commands::hyperv_create_switch,
        hyperv_commands::hyperv_remove_switch,
        hyperv_commands::hyperv_rename_switch,
        hyperv_commands::hyperv_list_physical_adapters,
        hyperv_commands::hyperv_list_vm_adapters,
        hyperv_commands::hyperv_add_vm_adapter,
        hyperv_commands::hyperv_remove_vm_adapter,
        hyperv_commands::hyperv_connect_adapter,
        hyperv_commands::hyperv_disconnect_adapter,
        hyperv_commands::hyperv_set_adapter_vlan,
        hyperv_commands::hyperv_set_adapter_vlan_trunk,
        hyperv_commands::hyperv_remove_adapter_vlan,
        // Hyper-V commands — Storage (VHD/VHDX)
        hyperv_commands::hyperv_get_vhd,
        hyperv_commands::hyperv_test_vhd,
        hyperv_commands::hyperv_create_vhd,
        hyperv_commands::hyperv_resize_vhd,
        hyperv_commands::hyperv_convert_vhd,
        hyperv_commands::hyperv_compact_vhd,
        hyperv_commands::hyperv_optimize_vhd,
        hyperv_commands::hyperv_merge_vhd,
        hyperv_commands::hyperv_mount_vhd,
        hyperv_commands::hyperv_dismount_vhd,
        hyperv_commands::hyperv_delete_vhd,
        hyperv_commands::hyperv_list_vm_hard_drives,
        // Hyper-V commands — Metrics / Monitoring
        hyperv_commands::hyperv_get_vm_metrics,
        hyperv_commands::hyperv_get_all_vm_metrics,
        hyperv_commands::hyperv_enable_metering,
        hyperv_commands::hyperv_disable_metering,
        hyperv_commands::hyperv_reset_metering,
        hyperv_commands::hyperv_get_metering_report,
        hyperv_commands::hyperv_get_host_info,
        hyperv_commands::hyperv_get_events,
        hyperv_commands::hyperv_set_host_paths,
        hyperv_commands::hyperv_set_live_migration,
        hyperv_commands::hyperv_set_numa_spanning,
        // Hyper-V commands — Replication
        hyperv_commands::hyperv_get_replication,
        hyperv_commands::hyperv_list_replicated_vms,
        hyperv_commands::hyperv_enable_replication,
        hyperv_commands::hyperv_disable_replication,
        hyperv_commands::hyperv_start_initial_replication,
        hyperv_commands::hyperv_suspend_replication,
        hyperv_commands::hyperv_resume_replication,
        hyperv_commands::hyperv_planned_failover,
        hyperv_commands::hyperv_unplanned_failover,
        hyperv_commands::hyperv_complete_failover,
        hyperv_commands::hyperv_cancel_failover,
        hyperv_commands::hyperv_reverse_replication,
        hyperv_commands::hyperv_start_test_failover,
        hyperv_commands::hyperv_stop_test_failover,
        // MeshCentral commands — Connection
        meshcentral_dedicated_commands::mc_connect,
        meshcentral_dedicated_commands::mc_disconnect,
        meshcentral_dedicated_commands::mc_disconnect_all,
        meshcentral_dedicated_commands::mc_get_session_info,
        meshcentral_dedicated_commands::mc_list_sessions,
        meshcentral_dedicated_commands::mc_ping,
        // MeshCentral commands — Server
        meshcentral_dedicated_commands::mc_get_server_info,
        meshcentral_dedicated_commands::mc_get_server_version,
        meshcentral_dedicated_commands::mc_health_check,
        // MeshCentral commands — Devices
        meshcentral_dedicated_commands::mc_list_devices,
        meshcentral_dedicated_commands::mc_get_device_info,
        meshcentral_dedicated_commands::mc_add_local_device,
        meshcentral_dedicated_commands::mc_add_amt_device,
        meshcentral_dedicated_commands::mc_edit_device,
        meshcentral_dedicated_commands::mc_remove_devices,
        meshcentral_dedicated_commands::mc_move_device_to_group,
        // MeshCentral commands — Device Groups
        meshcentral_dedicated_commands::mc_list_device_groups,
        meshcentral_dedicated_commands::mc_create_device_group,
        meshcentral_dedicated_commands::mc_edit_device_group,
        meshcentral_dedicated_commands::mc_remove_device_group,
        // MeshCentral commands — Users
        meshcentral_dedicated_commands::mc_list_users,
        meshcentral_dedicated_commands::mc_add_user,
        meshcentral_dedicated_commands::mc_edit_user,
        meshcentral_dedicated_commands::mc_remove_user,
        // MeshCentral commands — User Groups
        meshcentral_dedicated_commands::mc_list_user_groups,
        meshcentral_dedicated_commands::mc_create_user_group,
        meshcentral_dedicated_commands::mc_remove_user_group,
        // MeshCentral commands — Power
        meshcentral_dedicated_commands::mc_power_action,
        meshcentral_dedicated_commands::mc_wake_devices,
        // MeshCentral commands — Remote Commands
        meshcentral_dedicated_commands::mc_run_commands,
        meshcentral_dedicated_commands::mc_run_command_on_device,
        // MeshCentral commands — File Transfer
        meshcentral_dedicated_commands::mc_upload_file,
        meshcentral_dedicated_commands::mc_download_file,
        meshcentral_dedicated_commands::mc_get_transfer_progress,
        meshcentral_dedicated_commands::mc_get_active_transfers,
        meshcentral_dedicated_commands::mc_cancel_transfer,
        // MeshCentral commands — Events
        meshcentral_dedicated_commands::mc_list_events,
        // MeshCentral commands — Sharing
        meshcentral_dedicated_commands::mc_create_device_share,
        meshcentral_dedicated_commands::mc_list_device_shares,
        meshcentral_dedicated_commands::mc_remove_device_share,
        // MeshCentral commands — Messaging
        meshcentral_dedicated_commands::mc_send_toast,
        meshcentral_dedicated_commands::mc_send_message_box,
        meshcentral_dedicated_commands::mc_send_open_url,
        meshcentral_dedicated_commands::mc_broadcast_message,
        // MeshCentral commands — Agents
        meshcentral_dedicated_commands::mc_download_agent_to_file,
        meshcentral_dedicated_commands::mc_send_invite_email,
        meshcentral_dedicated_commands::mc_generate_invite_link,
        // MeshCentral commands — Reports & Relay
        meshcentral_dedicated_commands::mc_generate_report,
        meshcentral_dedicated_commands::mc_create_web_relay,
        // VMware commands — Connection
        vmware_commands::vmware_connect,
        vmware_commands::vmware_disconnect,
        vmware_commands::vmware_check_session,
        vmware_commands::vmware_is_connected,
        vmware_commands::vmware_get_config,
        // VMware commands — VM Lifecycle
        vmware_commands::vmware_list_vms,
        vmware_commands::vmware_list_running_vms,
        vmware_commands::vmware_get_vm,
        vmware_commands::vmware_create_vm,
        vmware_commands::vmware_delete_vm,
        vmware_commands::vmware_power_on,
        vmware_commands::vmware_power_off,
        vmware_commands::vmware_suspend,
        vmware_commands::vmware_reset,
        vmware_commands::vmware_shutdown_guest,
        vmware_commands::vmware_reboot_guest,
        vmware_commands::vmware_get_guest_identity,
        vmware_commands::vmware_update_cpu,
        vmware_commands::vmware_update_memory,
        vmware_commands::vmware_clone_vm,
        vmware_commands::vmware_relocate_vm,
        vmware_commands::vmware_find_vm_by_name,
        vmware_commands::vmware_get_power_state,
        // VMware commands — Snapshots
        vmware_commands::vmware_list_snapshots,
        vmware_commands::vmware_create_snapshot,
        vmware_commands::vmware_revert_snapshot,
        vmware_commands::vmware_delete_snapshot,
        vmware_commands::vmware_delete_all_snapshots,
        // VMware commands — Network
        vmware_commands::vmware_list_networks,
        vmware_commands::vmware_get_network,
        // VMware commands — Storage
        vmware_commands::vmware_list_datastores,
        vmware_commands::vmware_get_datastore,
        // VMware commands — Hosts
        vmware_commands::vmware_list_hosts,
        vmware_commands::vmware_get_host,
        vmware_commands::vmware_disconnect_host,
        vmware_commands::vmware_reconnect_host,
        vmware_commands::vmware_list_clusters,
        vmware_commands::vmware_list_datacenters,
        vmware_commands::vmware_list_folders,
        vmware_commands::vmware_list_resource_pools,
        // VMware commands — Metrics
        vmware_commands::vmware_get_vm_stats,
        vmware_commands::vmware_get_all_vm_stats,
        vmware_commands::vmware_get_inventory_summary,
        // VMware commands — Console (cross-platform WebSocket)
        vmware_commands::vmware_acquire_console_ticket,
        vmware_commands::vmware_open_console,
        vmware_commands::vmware_close_console,
        vmware_commands::vmware_close_all_consoles,
        vmware_commands::vmware_list_console_sessions,
        vmware_commands::vmware_get_console_session,
        // VMware commands — VMRC / Horizon (binary fallback)
        vmware_commands::vmware_launch_vmrc,
        vmware_commands::vmware_list_vmrc_sessions,
        vmware_commands::vmware_close_vmrc_session,
        vmware_commands::vmware_close_all_vmrc_sessions,
        vmware_commands::vmware_is_vmrc_available,
        vmware_commands::vmware_is_horizon_available,
        // Proxmox VE commands — Connection
        proxmox_commands::proxmox_connect,
        proxmox_commands::proxmox_disconnect,
        proxmox_commands::proxmox_check_session,
        proxmox_commands::proxmox_is_connected,
        proxmox_commands::proxmox_get_config,
        proxmox_commands::proxmox_get_version,
        // Proxmox VE commands — Nodes
        proxmox_commands::proxmox_list_nodes,
        proxmox_commands::proxmox_get_node_status,
        proxmox_commands::proxmox_list_node_services,
        proxmox_commands::proxmox_start_node_service,
        proxmox_commands::proxmox_stop_node_service,
        proxmox_commands::proxmox_restart_node_service,
        proxmox_commands::proxmox_get_node_dns,
        proxmox_commands::proxmox_get_node_syslog,
        proxmox_commands::proxmox_list_apt_updates,
        proxmox_commands::proxmox_reboot_node,
        proxmox_commands::proxmox_shutdown_node,
        // Proxmox VE commands — QEMU VMs
        proxmox_commands::proxmox_list_qemu_vms,
        proxmox_commands::proxmox_get_qemu_status,
        proxmox_commands::proxmox_get_qemu_config,
        proxmox_commands::proxmox_create_qemu_vm,
        proxmox_commands::proxmox_delete_qemu_vm,
        proxmox_commands::proxmox_start_qemu_vm,
        proxmox_commands::proxmox_stop_qemu_vm,
        proxmox_commands::proxmox_shutdown_qemu_vm,
        proxmox_commands::proxmox_reboot_qemu_vm,
        proxmox_commands::proxmox_suspend_qemu_vm,
        proxmox_commands::proxmox_resume_qemu_vm,
        proxmox_commands::proxmox_reset_qemu_vm,
        proxmox_commands::proxmox_resize_qemu_disk,
        proxmox_commands::proxmox_clone_qemu_vm,
        proxmox_commands::proxmox_migrate_qemu_vm,
        proxmox_commands::proxmox_convert_qemu_to_template,
        proxmox_commands::proxmox_qemu_agent_exec,
        proxmox_commands::proxmox_qemu_agent_network,
        proxmox_commands::proxmox_qemu_agent_osinfo,
        proxmox_commands::proxmox_get_next_vmid,
        // Proxmox VE commands — LXC Containers
        proxmox_commands::proxmox_list_lxc_containers,
        proxmox_commands::proxmox_get_lxc_status,
        proxmox_commands::proxmox_get_lxc_config,
        proxmox_commands::proxmox_create_lxc_container,
        proxmox_commands::proxmox_delete_lxc_container,
        proxmox_commands::proxmox_start_lxc_container,
        proxmox_commands::proxmox_stop_lxc_container,
        proxmox_commands::proxmox_shutdown_lxc_container,
        proxmox_commands::proxmox_reboot_lxc_container,
        proxmox_commands::proxmox_clone_lxc_container,
        proxmox_commands::proxmox_migrate_lxc_container,
        // Proxmox VE commands — Storage
        proxmox_commands::proxmox_list_storage,
        proxmox_commands::proxmox_list_storage_content,
        proxmox_commands::proxmox_delete_storage_volume,
        proxmox_commands::proxmox_download_to_storage,
        // Proxmox VE commands — Network
        proxmox_commands::proxmox_list_network_interfaces,
        proxmox_commands::proxmox_get_network_interface,
        proxmox_commands::proxmox_create_network_interface,
        proxmox_commands::proxmox_delete_network_interface,
        proxmox_commands::proxmox_apply_network_changes,
        proxmox_commands::proxmox_revert_network_changes,
        // Proxmox VE commands — Cluster
        proxmox_commands::proxmox_get_cluster_status,
        proxmox_commands::proxmox_list_cluster_resources,
        proxmox_commands::proxmox_get_cluster_next_id,
        proxmox_commands::proxmox_list_users,
        proxmox_commands::proxmox_list_roles,
        proxmox_commands::proxmox_list_groups,
        // Proxmox VE commands — Tasks
        proxmox_commands::proxmox_list_tasks,
        proxmox_commands::proxmox_get_task_status,
        proxmox_commands::proxmox_get_task_log,
        proxmox_commands::proxmox_stop_task,
        // Proxmox VE commands — Backups
        proxmox_commands::proxmox_list_backup_jobs,
        proxmox_commands::proxmox_vzdump,
        proxmox_commands::proxmox_restore_backup,
        proxmox_commands::proxmox_list_backups,
        // Proxmox VE commands — Firewall
        proxmox_commands::proxmox_get_cluster_firewall_options,
        proxmox_commands::proxmox_list_cluster_firewall_rules,
        proxmox_commands::proxmox_list_security_groups,
        proxmox_commands::proxmox_list_firewall_aliases,
        proxmox_commands::proxmox_list_firewall_ipsets,
        proxmox_commands::proxmox_list_guest_firewall_rules,
        // Proxmox VE commands — Pools
        proxmox_commands::proxmox_list_pools,
        proxmox_commands::proxmox_get_pool,
        proxmox_commands::proxmox_create_pool,
        proxmox_commands::proxmox_delete_pool,
        // Proxmox VE commands — HA
        proxmox_commands::proxmox_list_ha_resources,
        proxmox_commands::proxmox_list_ha_groups,
        // Proxmox VE commands — Ceph
        proxmox_commands::proxmox_get_ceph_status,
        proxmox_commands::proxmox_list_ceph_pools,
        proxmox_commands::proxmox_list_ceph_monitors,
        proxmox_commands::proxmox_list_ceph_osds,
        // Proxmox VE commands — SDN
        proxmox_commands::proxmox_list_sdn_zones,
        proxmox_commands::proxmox_list_sdn_vnets,
        // Proxmox VE commands — Console
        proxmox_commands::proxmox_qemu_vnc_proxy,
        proxmox_commands::proxmox_qemu_spice_proxy,
        proxmox_commands::proxmox_qemu_termproxy,
        proxmox_commands::proxmox_lxc_vnc_proxy,
        proxmox_commands::proxmox_lxc_spice_proxy,
        proxmox_commands::proxmox_lxc_termproxy,
        proxmox_commands::proxmox_node_termproxy,
        // Proxmox VE commands — Snapshots
        proxmox_commands::proxmox_list_qemu_snapshots,
        proxmox_commands::proxmox_create_qemu_snapshot,
        proxmox_commands::proxmox_rollback_qemu_snapshot,
        proxmox_commands::proxmox_delete_qemu_snapshot,
        proxmox_commands::proxmox_list_lxc_snapshots,
        proxmox_commands::proxmox_create_lxc_snapshot,
        proxmox_commands::proxmox_rollback_lxc_snapshot,
        proxmox_commands::proxmox_delete_lxc_snapshot,
        // Proxmox VE commands — Metrics / RRD
        proxmox_commands::proxmox_node_rrd,
        proxmox_commands::proxmox_qemu_rrd,
        proxmox_commands::proxmox_lxc_rrd,
        // Proxmox VE commands — Templates
        proxmox_commands::proxmox_list_appliance_templates,
        proxmox_commands::proxmox_download_appliance,
        proxmox_commands::proxmox_list_isos,
        proxmox_commands::proxmox_list_container_templates,
        // Dell iDRAC commands — Connection
        idrac_commands::idrac_connect,
        idrac_commands::idrac_disconnect,
        idrac_commands::idrac_check_session,
        idrac_commands::idrac_is_connected,
        idrac_commands::idrac_get_config,
        // Dell iDRAC commands — System
        idrac_commands::idrac_get_system_info,
        idrac_commands::idrac_get_idrac_info,
        idrac_commands::idrac_set_asset_tag,
        idrac_commands::idrac_set_indicator_led,
        // Dell iDRAC commands — Power
        idrac_commands::idrac_power_action,
        idrac_commands::idrac_get_power_state,
        idrac_commands::idrac_get_power_metrics,
        idrac_commands::idrac_list_power_supplies,
        idrac_commands::idrac_set_power_cap,
        // Dell iDRAC commands — Thermal
        idrac_commands::idrac_get_thermal_data,
        idrac_commands::idrac_get_thermal_summary,
        idrac_commands::idrac_set_fan_offset,
        // Dell iDRAC commands — Hardware
        idrac_commands::idrac_list_processors,
        idrac_commands::idrac_list_memory,
        idrac_commands::idrac_list_pcie_devices,
        idrac_commands::idrac_get_total_memory,
        idrac_commands::idrac_get_processor_count,
        // Dell iDRAC commands — Storage
        idrac_commands::idrac_list_storage_controllers,
        idrac_commands::idrac_list_virtual_disks,
        idrac_commands::idrac_list_physical_disks,
        idrac_commands::idrac_list_enclosures,
        idrac_commands::idrac_create_virtual_disk,
        idrac_commands::idrac_delete_virtual_disk,
        idrac_commands::idrac_assign_hotspare,
        idrac_commands::idrac_initialize_virtual_disk,
        // Dell iDRAC commands — Network
        idrac_commands::idrac_list_network_adapters,
        idrac_commands::idrac_list_network_ports,
        idrac_commands::idrac_get_network_config,
        idrac_commands::idrac_update_network_config,
        // Dell iDRAC commands — Firmware
        idrac_commands::idrac_list_firmware,
        idrac_commands::idrac_update_firmware,
        idrac_commands::idrac_get_component_version,
        // Dell iDRAC commands — Lifecycle
        idrac_commands::idrac_list_jobs,
        idrac_commands::idrac_get_job,
        idrac_commands::idrac_delete_job,
        idrac_commands::idrac_purge_job_queue,
        idrac_commands::idrac_export_scp,
        idrac_commands::idrac_import_scp,
        idrac_commands::idrac_get_lc_status,
        idrac_commands::idrac_wait_for_job,
        // Dell iDRAC commands — Virtual Media
        idrac_commands::idrac_list_virtual_media,
        idrac_commands::idrac_mount_virtual_media,
        idrac_commands::idrac_unmount_virtual_media,
        idrac_commands::idrac_boot_from_virtual_cd,
        // Dell iDRAC commands — Virtual Console
        idrac_commands::idrac_get_console_info,
        idrac_commands::idrac_set_console_enabled,
        idrac_commands::idrac_set_console_type,
        idrac_commands::idrac_set_vnc_enabled,
        idrac_commands::idrac_set_vnc_password,
        // Dell iDRAC commands — Event Log
        idrac_commands::idrac_get_sel_entries,
        idrac_commands::idrac_get_lc_log_entries,
        idrac_commands::idrac_clear_sel,
        idrac_commands::idrac_clear_lc_log,
        // Dell iDRAC commands — Users
        idrac_commands::idrac_list_users,
        idrac_commands::idrac_create_or_update_user,
        idrac_commands::idrac_delete_user,
        idrac_commands::idrac_unlock_user,
        idrac_commands::idrac_change_user_password,
        idrac_commands::idrac_get_ldap_config,
        idrac_commands::idrac_get_ad_config,
        // Dell iDRAC commands — BIOS
        idrac_commands::idrac_get_bios_attributes,
        idrac_commands::idrac_get_bios_attribute,
        idrac_commands::idrac_set_bios_attributes,
        idrac_commands::idrac_get_boot_order,
        idrac_commands::idrac_set_boot_order,
        idrac_commands::idrac_set_boot_once,
        idrac_commands::idrac_set_boot_mode,
        // Dell iDRAC commands — Certificates
        idrac_commands::idrac_list_certificates,
        idrac_commands::idrac_generate_csr,
        idrac_commands::idrac_import_certificate,
        idrac_commands::idrac_delete_certificate,
        idrac_commands::idrac_replace_ssl_certificate,
        // Dell iDRAC commands — Health
        idrac_commands::idrac_get_health_rollup,
        idrac_commands::idrac_get_component_health,
        idrac_commands::idrac_is_healthy,
        // Dell iDRAC commands — Telemetry
        idrac_commands::idrac_get_power_telemetry,
        idrac_commands::idrac_get_thermal_telemetry,
        idrac_commands::idrac_list_telemetry_reports,
        idrac_commands::idrac_get_telemetry_report,
        // Dell iDRAC commands — RACADM
        idrac_commands::idrac_racadm_execute,
        idrac_commands::idrac_reset,
        idrac_commands::idrac_get_attribute,
        idrac_commands::idrac_set_attribute,
        // Dell iDRAC commands — Dashboard
        idrac_commands::idrac_get_dashboard,
        // HP iLO commands — Connection
        ilo_commands::ilo_connect,
        ilo_commands::ilo_disconnect,
        ilo_commands::ilo_check_session,
        ilo_commands::ilo_is_connected,
        ilo_commands::ilo_get_config,
        // HP iLO commands — System
        ilo_commands::ilo_get_system_info,
        ilo_commands::ilo_get_ilo_info,
        ilo_commands::ilo_set_asset_tag,
        ilo_commands::ilo_set_indicator_led,
        // HP iLO commands — Power
        ilo_commands::ilo_power_action,
        ilo_commands::ilo_get_power_state,
        ilo_commands::ilo_get_power_metrics,
        // HP iLO commands — Thermal
        ilo_commands::ilo_get_thermal_data,
        ilo_commands::ilo_get_thermal_summary,
        // HP iLO commands — Hardware
        ilo_commands::ilo_get_processors,
        ilo_commands::ilo_get_memory,
        // HP iLO commands — Storage
        ilo_commands::ilo_get_storage_controllers,
        ilo_commands::ilo_get_virtual_disks,
        ilo_commands::ilo_get_physical_disks,
        // HP iLO commands — Network
        ilo_commands::ilo_get_network_adapters,
        ilo_commands::ilo_get_ilo_network,
        // HP iLO commands — Firmware
        ilo_commands::ilo_get_firmware_inventory,
        // HP iLO commands — Virtual Media
        ilo_commands::ilo_get_virtual_media_status,
        ilo_commands::ilo_insert_virtual_media,
        ilo_commands::ilo_eject_virtual_media,
        ilo_commands::ilo_set_vm_boot_once,
        // HP iLO commands — Virtual Console
        ilo_commands::ilo_get_console_info,
        ilo_commands::ilo_get_html5_launch_url,
        // HP iLO commands — Event Log
        ilo_commands::ilo_get_iml,
        ilo_commands::ilo_get_ilo_event_log,
        ilo_commands::ilo_clear_iml,
        ilo_commands::ilo_clear_ilo_event_log,
        // HP iLO commands — Users
        ilo_commands::ilo_get_users,
        ilo_commands::ilo_create_user,
        ilo_commands::ilo_update_password,
        ilo_commands::ilo_delete_user,
        ilo_commands::ilo_set_user_enabled,
        // HP iLO commands — BIOS
        ilo_commands::ilo_get_bios_attributes,
        ilo_commands::ilo_set_bios_attributes,
        ilo_commands::ilo_get_boot_config,
        ilo_commands::ilo_set_boot_override,
        // HP iLO commands — Certificates
        ilo_commands::ilo_get_certificate,
        ilo_commands::ilo_generate_csr,
        ilo_commands::ilo_import_certificate,
        // HP iLO commands — Health
        ilo_commands::ilo_get_health_rollup,
        ilo_commands::ilo_get_dashboard,
        // HP iLO commands — License
        ilo_commands::ilo_get_license,
        ilo_commands::ilo_activate_license,
        ilo_commands::ilo_deactivate_license,
        // HP iLO commands — Security
        ilo_commands::ilo_get_security_status,
        ilo_commands::ilo_set_min_tls_version,
        ilo_commands::ilo_set_ipmi_over_lan,
        // HP iLO commands — Federation
        ilo_commands::ilo_get_federation_groups,
        ilo_commands::ilo_get_federation_peers,
        ilo_commands::ilo_add_federation_group,
        ilo_commands::ilo_remove_federation_group,
        // HP iLO commands — Reset
        ilo_commands::ilo_reset,
        // Lenovo XCC commands — Connection
        lenovo_commands::lenovo_connect,
        lenovo_commands::lenovo_disconnect,
        lenovo_commands::lenovo_check_session,
        lenovo_commands::lenovo_is_connected,
        lenovo_commands::lenovo_get_config,
        // Lenovo XCC commands — System
        lenovo_commands::lenovo_get_system_info,
        lenovo_commands::lenovo_get_xcc_info,
        lenovo_commands::lenovo_set_asset_tag,
        lenovo_commands::lenovo_set_indicator_led,
        // Lenovo XCC commands — Power
        lenovo_commands::lenovo_power_action,
        lenovo_commands::lenovo_get_power_state,
        lenovo_commands::lenovo_get_power_metrics,
        // Lenovo XCC commands — Thermal
        lenovo_commands::lenovo_get_thermal_data,
        lenovo_commands::lenovo_get_thermal_summary,
        // Lenovo XCC commands — Hardware
        lenovo_commands::lenovo_get_processors,
        lenovo_commands::lenovo_get_memory,
        // Lenovo XCC commands — Storage
        lenovo_commands::lenovo_get_storage_controllers,
        lenovo_commands::lenovo_get_virtual_disks,
        lenovo_commands::lenovo_get_physical_disks,
        // Lenovo XCC commands — Network
        lenovo_commands::lenovo_get_network_adapters,
        lenovo_commands::lenovo_get_xcc_network,
        // Lenovo XCC commands — Firmware
        lenovo_commands::lenovo_get_firmware_inventory,
        // Lenovo XCC commands — Virtual Media
        lenovo_commands::lenovo_get_virtual_media_status,
        lenovo_commands::lenovo_insert_virtual_media,
        lenovo_commands::lenovo_eject_virtual_media,
        // Lenovo XCC commands — Console
        lenovo_commands::lenovo_get_console_info,
        lenovo_commands::lenovo_get_html5_launch_url,
        // Lenovo XCC commands — Event Log
        lenovo_commands::lenovo_get_event_log,
        lenovo_commands::lenovo_get_audit_log,
        lenovo_commands::lenovo_clear_event_log,
        // Lenovo XCC commands — Users
        lenovo_commands::lenovo_get_users,
        lenovo_commands::lenovo_create_user,
        lenovo_commands::lenovo_update_password,
        lenovo_commands::lenovo_delete_user,
        // Lenovo XCC commands — BIOS
        lenovo_commands::lenovo_get_bios_attributes,
        lenovo_commands::lenovo_set_bios_attributes,
        lenovo_commands::lenovo_get_boot_config,
        lenovo_commands::lenovo_set_boot_override,
        // Lenovo XCC commands — Certificates
        lenovo_commands::lenovo_get_certificate,
        lenovo_commands::lenovo_generate_csr,
        lenovo_commands::lenovo_import_certificate,
        // Lenovo XCC commands — Health
        lenovo_commands::lenovo_get_health_rollup,
        lenovo_commands::lenovo_get_dashboard,
        // Lenovo XCC commands — License
        lenovo_commands::lenovo_get_license,
        // Lenovo XCC commands — OneCLI
        lenovo_commands::lenovo_onecli_execute,
        // Lenovo XCC commands — Reset
        lenovo_commands::lenovo_reset_controller,
        // Supermicro BMC commands — Connection
        supermicro_commands::smc_connect,
        supermicro_commands::smc_disconnect,
        supermicro_commands::smc_check_session,
        supermicro_commands::smc_is_connected,
        supermicro_commands::smc_get_config,
        // Supermicro BMC commands — System
        supermicro_commands::smc_get_system_info,
        supermicro_commands::smc_get_bmc_info,
        supermicro_commands::smc_set_asset_tag,
        supermicro_commands::smc_set_indicator_led,
        // Supermicro BMC commands — Power
        supermicro_commands::smc_power_action,
        supermicro_commands::smc_get_power_state,
        supermicro_commands::smc_get_power_metrics,
        // Supermicro BMC commands — Thermal
        supermicro_commands::smc_get_thermal_data,
        supermicro_commands::smc_get_thermal_summary,
        // Supermicro BMC commands — Hardware
        supermicro_commands::smc_get_processors,
        supermicro_commands::smc_get_memory,
        // Supermicro BMC commands — Storage
        supermicro_commands::smc_get_storage_controllers,
        supermicro_commands::smc_get_virtual_disks,
        supermicro_commands::smc_get_physical_disks,
        // Supermicro BMC commands — Network
        supermicro_commands::smc_get_network_adapters,
        supermicro_commands::smc_get_bmc_network,
        // Supermicro BMC commands — Firmware
        supermicro_commands::smc_get_firmware_inventory,
        // Supermicro BMC commands — Virtual Media
        supermicro_commands::smc_get_virtual_media_status,
        supermicro_commands::smc_insert_virtual_media,
        supermicro_commands::smc_eject_virtual_media,
        // Supermicro BMC commands — Console / iKVM
        supermicro_commands::smc_get_console_info,
        supermicro_commands::smc_get_html5_ikvm_url,
        // Supermicro BMC commands — Event Log
        supermicro_commands::smc_get_event_log,
        supermicro_commands::smc_get_audit_log,
        supermicro_commands::smc_clear_event_log,
        // Supermicro BMC commands — Users
        supermicro_commands::smc_get_users,
        supermicro_commands::smc_create_user,
        supermicro_commands::smc_update_password,
        supermicro_commands::smc_delete_user,
        // Supermicro BMC commands — BIOS
        supermicro_commands::smc_get_bios_attributes,
        supermicro_commands::smc_set_bios_attributes,
        supermicro_commands::smc_get_boot_config,
        supermicro_commands::smc_set_boot_override,
        // Supermicro BMC commands — Certificates
        supermicro_commands::smc_get_certificate,
        supermicro_commands::smc_generate_csr,
        supermicro_commands::smc_import_certificate,
        // Supermicro BMC commands — Health
        supermicro_commands::smc_get_health_rollup,
        supermicro_commands::smc_get_dashboard,
        // Supermicro BMC commands — Security
        supermicro_commands::smc_get_security_status,
        // Supermicro BMC commands — License
        supermicro_commands::smc_get_licenses,
        supermicro_commands::smc_activate_license,
        // Supermicro BMC commands — Node Manager
        supermicro_commands::smc_get_node_manager_policies,
        supermicro_commands::smc_get_node_manager_stats,
        // Supermicro BMC commands — Reset
        supermicro_commands::smc_reset_bmc,
        // Synology NAS commands — Connection
        synology_commands::syn_connect,
        synology_commands::syn_disconnect,
        synology_commands::syn_is_connected,
        synology_commands::syn_check_session,
        synology_commands::syn_get_config,
        // Synology NAS commands — System
        synology_commands::syn_get_system_info,
        synology_commands::syn_get_utilization,
        synology_commands::syn_list_processes,
        synology_commands::syn_reboot,
        synology_commands::syn_shutdown,
        synology_commands::syn_check_update,
        // Synology NAS commands — Storage
        synology_commands::syn_get_storage_overview,
        synology_commands::syn_list_disks,
        synology_commands::syn_list_volumes,
        synology_commands::syn_get_smart_info,
        synology_commands::syn_list_iscsi_luns,
        synology_commands::syn_list_iscsi_targets,
        // Synology NAS commands — File Station
        synology_commands::syn_get_file_station_info,
        synology_commands::syn_list_files,
        synology_commands::syn_list_file_shared_folders,
        synology_commands::syn_search_files,
        synology_commands::syn_upload_file,
        synology_commands::syn_download_file,
        synology_commands::syn_create_folder,
        synology_commands::syn_delete_files,
        synology_commands::syn_rename_file,
        synology_commands::syn_create_share_link,
        // Synology NAS commands — Shared Folders
        synology_commands::syn_list_shared_folders,
        synology_commands::syn_get_share_permissions,
        synology_commands::syn_create_shared_folder,
        synology_commands::syn_delete_shared_folder,
        synology_commands::syn_mount_encrypted_share,
        synology_commands::syn_unmount_encrypted_share,
        // Synology NAS commands — Network
        synology_commands::syn_get_network_overview,
        synology_commands::syn_list_network_interfaces,
        synology_commands::syn_list_firewall_rules,
        synology_commands::syn_list_dhcp_leases,
        // Synology NAS commands — Users & Groups
        synology_commands::syn_list_users,
        synology_commands::syn_create_user,
        synology_commands::syn_delete_user,
        synology_commands::syn_list_groups,
        // Synology NAS commands — Packages
        synology_commands::syn_list_packages,
        synology_commands::syn_start_package,
        synology_commands::syn_stop_package,
        synology_commands::syn_install_package,
        synology_commands::syn_uninstall_package,
        // Synology NAS commands — Services
        synology_commands::syn_list_services,
        synology_commands::syn_get_smb_config,
        synology_commands::syn_get_nfs_config,
        synology_commands::syn_get_ssh_config,
        synology_commands::syn_set_ssh_enabled,
        // Synology NAS commands — Docker
        synology_commands::syn_list_docker_containers,
        synology_commands::syn_start_docker_container,
        synology_commands::syn_stop_docker_container,
        synology_commands::syn_restart_docker_container,
        synology_commands::syn_delete_docker_container,
        synology_commands::syn_list_docker_images,
        synology_commands::syn_pull_docker_image,
        synology_commands::syn_list_docker_networks,
        synology_commands::syn_list_docker_projects,
        synology_commands::syn_start_docker_project,
        synology_commands::syn_stop_docker_project,
        // Synology NAS commands — VMs
        synology_commands::syn_list_vms,
        synology_commands::syn_vm_power_on,
        synology_commands::syn_vm_shutdown,
        synology_commands::syn_vm_force_shutdown,
        synology_commands::syn_list_vm_snapshots,
        synology_commands::syn_take_vm_snapshot,
        // Synology NAS commands — Download Station
        synology_commands::syn_get_download_station_info,
        synology_commands::syn_list_download_tasks,
        synology_commands::syn_create_download_task,
        synology_commands::syn_pause_download,
        synology_commands::syn_resume_download,
        synology_commands::syn_delete_download,
        synology_commands::syn_get_download_stats,
        // Synology NAS commands — Surveillance
        synology_commands::syn_get_surveillance_info,
        synology_commands::syn_list_cameras,
        synology_commands::syn_get_camera_snapshot,
        synology_commands::syn_list_recordings,
        // Synology NAS commands — Backup
        synology_commands::syn_list_backup_tasks,
        synology_commands::syn_start_backup_task,
        synology_commands::syn_cancel_backup_task,
        synology_commands::syn_list_backup_versions,
        synology_commands::syn_list_active_backup_devices,
        // Synology NAS commands — Security
        synology_commands::syn_get_security_overview,
        synology_commands::syn_list_blocked_ips,
        synology_commands::syn_unblock_ip,
        synology_commands::syn_list_certificates,
        synology_commands::syn_get_auto_block_config,
        // Synology NAS commands — Hardware
        synology_commands::syn_get_hardware_info,
        synology_commands::syn_get_ups_info,
        synology_commands::syn_get_power_schedule,
        // Synology NAS commands — Logs
        synology_commands::syn_get_system_logs,
        synology_commands::syn_get_connection_logs,
        synology_commands::syn_get_active_connections,
        // Synology NAS commands — Notifications
        synology_commands::syn_get_notification_config,
        synology_commands::syn_test_email_notification,
        // Synology NAS commands — Dashboard
        synology_commands::syn_get_dashboard,
    ]
}
