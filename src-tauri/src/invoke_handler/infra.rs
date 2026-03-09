use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
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

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        hyperv::commands::hyperv_check_module,
        hyperv::commands::hyperv_get_config,
        hyperv::commands::hyperv_set_config,
        // Hyper-V commands — VM Lifecycle
        hyperv::commands::hyperv_list_vms,
        hyperv::commands::hyperv_list_vms_summary,
        hyperv::commands::hyperv_get_vm,
        hyperv::commands::hyperv_get_vm_by_id,
        hyperv::commands::hyperv_create_vm,
        hyperv::commands::hyperv_start_vm,
        hyperv::commands::hyperv_stop_vm,
        hyperv::commands::hyperv_restart_vm,
        hyperv::commands::hyperv_pause_vm,
        hyperv::commands::hyperv_resume_vm,
        hyperv::commands::hyperv_save_vm,
        hyperv::commands::hyperv_remove_vm,
        hyperv::commands::hyperv_update_vm,
        hyperv::commands::hyperv_rename_vm,
        hyperv::commands::hyperv_export_vm,
        hyperv::commands::hyperv_import_vm,
        hyperv::commands::hyperv_live_migrate,
        hyperv::commands::hyperv_get_integration_services,
        hyperv::commands::hyperv_set_integration_service,
        hyperv::commands::hyperv_add_dvd_drive,
        hyperv::commands::hyperv_set_dvd_drive,
        hyperv::commands::hyperv_remove_dvd_drive,
        hyperv::commands::hyperv_add_hard_drive,
        hyperv::commands::hyperv_remove_hard_drive,
        // Hyper-V commands — Snapshots / Checkpoints
        hyperv::commands::hyperv_list_checkpoints,
        hyperv::commands::hyperv_get_checkpoint,
        hyperv::commands::hyperv_create_checkpoint,
        hyperv::commands::hyperv_restore_checkpoint,
        hyperv::commands::hyperv_restore_checkpoint_by_id,
        hyperv::commands::hyperv_remove_checkpoint,
        hyperv::commands::hyperv_remove_checkpoint_tree,
        hyperv::commands::hyperv_remove_all_checkpoints,
        hyperv::commands::hyperv_rename_checkpoint,
        hyperv::commands::hyperv_export_checkpoint,
        // Hyper-V commands — Networking
        hyperv::commands::hyperv_list_switches,
        hyperv::commands::hyperv_get_switch,
        hyperv::commands::hyperv_create_switch,
        hyperv::commands::hyperv_remove_switch,
        hyperv::commands::hyperv_rename_switch,
        hyperv::commands::hyperv_list_physical_adapters,
        hyperv::commands::hyperv_list_vm_adapters,
        hyperv::commands::hyperv_add_vm_adapter,
        hyperv::commands::hyperv_remove_vm_adapter,
        hyperv::commands::hyperv_connect_adapter,
        hyperv::commands::hyperv_disconnect_adapter,
        hyperv::commands::hyperv_set_adapter_vlan,
        hyperv::commands::hyperv_set_adapter_vlan_trunk,
        hyperv::commands::hyperv_remove_adapter_vlan,
        // Hyper-V commands — Storage (VHD/VHDX)
        hyperv::commands::hyperv_get_vhd,
        hyperv::commands::hyperv_test_vhd,
        hyperv::commands::hyperv_create_vhd,
        hyperv::commands::hyperv_resize_vhd,
        hyperv::commands::hyperv_convert_vhd,
        hyperv::commands::hyperv_compact_vhd,
        hyperv::commands::hyperv_optimize_vhd,
        hyperv::commands::hyperv_merge_vhd,
        hyperv::commands::hyperv_mount_vhd,
        hyperv::commands::hyperv_dismount_vhd,
        hyperv::commands::hyperv_delete_vhd,
        hyperv::commands::hyperv_list_vm_hard_drives,
        // Hyper-V commands — Metrics / Monitoring
        hyperv::commands::hyperv_get_vm_metrics,
        hyperv::commands::hyperv_get_all_vm_metrics,
        hyperv::commands::hyperv_enable_metering,
        hyperv::commands::hyperv_disable_metering,
        hyperv::commands::hyperv_reset_metering,
        hyperv::commands::hyperv_get_metering_report,
        hyperv::commands::hyperv_get_host_info,
        hyperv::commands::hyperv_get_events,
        hyperv::commands::hyperv_set_host_paths,
        hyperv::commands::hyperv_set_live_migration,
        hyperv::commands::hyperv_set_numa_spanning,
        // Hyper-V commands — Replication
        hyperv::commands::hyperv_get_replication,
        hyperv::commands::hyperv_list_replicated_vms,
        hyperv::commands::hyperv_enable_replication,
        hyperv::commands::hyperv_disable_replication,
        hyperv::commands::hyperv_start_initial_replication,
        hyperv::commands::hyperv_suspend_replication,
        hyperv::commands::hyperv_resume_replication,
        hyperv::commands::hyperv_planned_failover,
        hyperv::commands::hyperv_unplanned_failover,
        hyperv::commands::hyperv_complete_failover,
        hyperv::commands::hyperv_cancel_failover,
        hyperv::commands::hyperv_reverse_replication,
        hyperv::commands::hyperv_start_test_failover,
        hyperv::commands::hyperv_stop_test_failover,
        // MeshCentral commands — Connection
        meshcentral_dedicated::mc_connect,
        meshcentral_dedicated::mc_disconnect,
        meshcentral_dedicated::mc_disconnect_all,
        meshcentral_dedicated::mc_get_session_info,
        meshcentral_dedicated::mc_list_sessions,
        meshcentral_dedicated::mc_ping,
        // MeshCentral commands — Server
        meshcentral_dedicated::mc_get_server_info,
        meshcentral_dedicated::mc_get_server_version,
        meshcentral_dedicated::mc_health_check,
        // MeshCentral commands — Devices
        meshcentral_dedicated::mc_list_devices,
        meshcentral_dedicated::mc_get_device_info,
        meshcentral_dedicated::mc_add_local_device,
        meshcentral_dedicated::mc_add_amt_device,
        meshcentral_dedicated::mc_edit_device,
        meshcentral_dedicated::mc_remove_devices,
        meshcentral_dedicated::mc_move_device_to_group,
        // MeshCentral commands — Device Groups
        meshcentral_dedicated::mc_list_device_groups,
        meshcentral_dedicated::mc_create_device_group,
        meshcentral_dedicated::mc_edit_device_group,
        meshcentral_dedicated::mc_remove_device_group,
        // MeshCentral commands — Users
        meshcentral_dedicated::mc_list_users,
        meshcentral_dedicated::mc_add_user,
        meshcentral_dedicated::mc_edit_user,
        meshcentral_dedicated::mc_remove_user,
        // MeshCentral commands — User Groups
        meshcentral_dedicated::mc_list_user_groups,
        meshcentral_dedicated::mc_create_user_group,
        meshcentral_dedicated::mc_remove_user_group,
        // MeshCentral commands — Power
        meshcentral_dedicated::mc_power_action,
        meshcentral_dedicated::mc_wake_devices,
        // MeshCentral commands — Remote Commands
        meshcentral_dedicated::mc_run_commands,
        meshcentral_dedicated::mc_run_command_on_device,
        // MeshCentral commands — File Transfer
        meshcentral_dedicated::mc_upload_file,
        meshcentral_dedicated::mc_download_file,
        meshcentral_dedicated::mc_get_transfer_progress,
        meshcentral_dedicated::mc_get_active_transfers,
        meshcentral_dedicated::mc_cancel_transfer,
        // MeshCentral commands — Events
        meshcentral_dedicated::mc_list_events,
        // MeshCentral commands — Sharing
        meshcentral_dedicated::mc_create_device_share,
        meshcentral_dedicated::mc_list_device_shares,
        meshcentral_dedicated::mc_remove_device_share,
        // MeshCentral commands — Messaging
        meshcentral_dedicated::mc_send_toast,
        meshcentral_dedicated::mc_send_message_box,
        meshcentral_dedicated::mc_send_open_url,
        meshcentral_dedicated::mc_broadcast_message,
        // MeshCentral commands — Agents
        meshcentral_dedicated::mc_download_agent_to_file,
        meshcentral_dedicated::mc_send_invite_email,
        meshcentral_dedicated::mc_generate_invite_link,
        // MeshCentral commands — Reports & Relay
        meshcentral_dedicated::mc_generate_report,
        meshcentral_dedicated::mc_create_web_relay,
        // VMware commands — Connection
        vmware::commands::vmware_connect,
        vmware::commands::vmware_disconnect,
        vmware::commands::vmware_check_session,
        vmware::commands::vmware_is_connected,
        vmware::commands::vmware_get_config,
        // VMware commands — VM Lifecycle
        vmware::commands::vmware_list_vms,
        vmware::commands::vmware_list_running_vms,
        vmware::commands::vmware_get_vm,
        vmware::commands::vmware_create_vm,
        vmware::commands::vmware_delete_vm,
        vmware::commands::vmware_power_on,
        vmware::commands::vmware_power_off,
        vmware::commands::vmware_suspend,
        vmware::commands::vmware_reset,
        vmware::commands::vmware_shutdown_guest,
        vmware::commands::vmware_reboot_guest,
        vmware::commands::vmware_get_guest_identity,
        vmware::commands::vmware_update_cpu,
        vmware::commands::vmware_update_memory,
        vmware::commands::vmware_clone_vm,
        vmware::commands::vmware_relocate_vm,
        vmware::commands::vmware_find_vm_by_name,
        vmware::commands::vmware_get_power_state,
        // VMware commands — Snapshots
        vmware::commands::vmware_list_snapshots,
        vmware::commands::vmware_create_snapshot,
        vmware::commands::vmware_revert_snapshot,
        vmware::commands::vmware_delete_snapshot,
        vmware::commands::vmware_delete_all_snapshots,
        // VMware commands — Network
        vmware::commands::vmware_list_networks,
        vmware::commands::vmware_get_network,
        // VMware commands — Storage
        vmware::commands::vmware_list_datastores,
        vmware::commands::vmware_get_datastore,
        // VMware commands — Hosts
        vmware::commands::vmware_list_hosts,
        vmware::commands::vmware_get_host,
        vmware::commands::vmware_disconnect_host,
        vmware::commands::vmware_reconnect_host,
        vmware::commands::vmware_list_clusters,
        vmware::commands::vmware_list_datacenters,
        vmware::commands::vmware_list_folders,
        vmware::commands::vmware_list_resource_pools,
        // VMware commands — Metrics
        vmware::commands::vmware_get_vm_stats,
        vmware::commands::vmware_get_all_vm_stats,
        vmware::commands::vmware_get_inventory_summary,
        // VMware commands — Console (cross-platform WebSocket)
        vmware::commands::vmware_acquire_console_ticket,
        vmware::commands::vmware_open_console,
        vmware::commands::vmware_close_console,
        vmware::commands::vmware_close_all_consoles,
        vmware::commands::vmware_list_console_sessions,
        vmware::commands::vmware_get_console_session,
        // VMware commands — VMRC / Horizon (binary fallback)
        vmware::commands::vmware_launch_vmrc,
        vmware::commands::vmware_list_vmrc_sessions,
        vmware::commands::vmware_close_vmrc_session,
        vmware::commands::vmware_close_all_vmrc_sessions,
        vmware::commands::vmware_is_vmrc_available,
        vmware::commands::vmware_is_horizon_available,
        // Proxmox VE commands — Connection
        proxmox::commands::proxmox_connect,
        proxmox::commands::proxmox_disconnect,
        proxmox::commands::proxmox_check_session,
        proxmox::commands::proxmox_is_connected,
        proxmox::commands::proxmox_get_config,
        proxmox::commands::proxmox_get_version,
        // Proxmox VE commands — Nodes
        proxmox::commands::proxmox_list_nodes,
        proxmox::commands::proxmox_get_node_status,
        proxmox::commands::proxmox_list_node_services,
        proxmox::commands::proxmox_start_node_service,
        proxmox::commands::proxmox_stop_node_service,
        proxmox::commands::proxmox_restart_node_service,
        proxmox::commands::proxmox_get_node_dns,
        proxmox::commands::proxmox_get_node_syslog,
        proxmox::commands::proxmox_list_apt_updates,
        proxmox::commands::proxmox_reboot_node,
        proxmox::commands::proxmox_shutdown_node,
        // Proxmox VE commands — QEMU VMs
        proxmox::commands::proxmox_list_qemu_vms,
        proxmox::commands::proxmox_get_qemu_status,
        proxmox::commands::proxmox_get_qemu_config,
        proxmox::commands::proxmox_create_qemu_vm,
        proxmox::commands::proxmox_delete_qemu_vm,
        proxmox::commands::proxmox_start_qemu_vm,
        proxmox::commands::proxmox_stop_qemu_vm,
        proxmox::commands::proxmox_shutdown_qemu_vm,
        proxmox::commands::proxmox_reboot_qemu_vm,
        proxmox::commands::proxmox_suspend_qemu_vm,
        proxmox::commands::proxmox_resume_qemu_vm,
        proxmox::commands::proxmox_reset_qemu_vm,
        proxmox::commands::proxmox_resize_qemu_disk,
        proxmox::commands::proxmox_clone_qemu_vm,
        proxmox::commands::proxmox_migrate_qemu_vm,
        proxmox::commands::proxmox_convert_qemu_to_template,
        proxmox::commands::proxmox_qemu_agent_exec,
        proxmox::commands::proxmox_qemu_agent_network,
        proxmox::commands::proxmox_qemu_agent_osinfo,
        proxmox::commands::proxmox_get_next_vmid,
        // Proxmox VE commands — LXC Containers
        proxmox::commands::proxmox_list_lxc_containers,
        proxmox::commands::proxmox_get_lxc_status,
        proxmox::commands::proxmox_get_lxc_config,
        proxmox::commands::proxmox_create_lxc_container,
        proxmox::commands::proxmox_delete_lxc_container,
        proxmox::commands::proxmox_start_lxc_container,
        proxmox::commands::proxmox_stop_lxc_container,
        proxmox::commands::proxmox_shutdown_lxc_container,
        proxmox::commands::proxmox_reboot_lxc_container,
        proxmox::commands::proxmox_clone_lxc_container,
        proxmox::commands::proxmox_migrate_lxc_container,
        // Proxmox VE commands — Storage
        proxmox::commands::proxmox_list_storage,
        proxmox::commands::proxmox_list_storage_content,
        proxmox::commands::proxmox_delete_storage_volume,
        proxmox::commands::proxmox_download_to_storage,
        // Proxmox VE commands — Network
        proxmox::commands::proxmox_list_network_interfaces,
        proxmox::commands::proxmox_get_network_interface,
        proxmox::commands::proxmox_create_network_interface,
        proxmox::commands::proxmox_delete_network_interface,
        proxmox::commands::proxmox_apply_network_changes,
        proxmox::commands::proxmox_revert_network_changes,
        // Proxmox VE commands — Cluster
        proxmox::commands::proxmox_get_cluster_status,
        proxmox::commands::proxmox_list_cluster_resources,
        proxmox::commands::proxmox_get_cluster_next_id,
        proxmox::commands::proxmox_list_users,
        proxmox::commands::proxmox_list_roles,
        proxmox::commands::proxmox_list_groups,
        // Proxmox VE commands — Tasks
        proxmox::commands::proxmox_list_tasks,
        proxmox::commands::proxmox_get_task_status,
        proxmox::commands::proxmox_get_task_log,
        proxmox::commands::proxmox_stop_task,
        // Proxmox VE commands — Backups
        proxmox::commands::proxmox_list_backup_jobs,
        proxmox::commands::proxmox_vzdump,
        proxmox::commands::proxmox_restore_backup,
        proxmox::commands::proxmox_list_backups,
        // Proxmox VE commands — Firewall
        proxmox::commands::proxmox_get_cluster_firewall_options,
        proxmox::commands::proxmox_list_cluster_firewall_rules,
        proxmox::commands::proxmox_list_security_groups,
        proxmox::commands::proxmox_list_firewall_aliases,
        proxmox::commands::proxmox_list_firewall_ipsets,
        proxmox::commands::proxmox_list_guest_firewall_rules,
        // Proxmox VE commands — Pools
        proxmox::commands::proxmox_list_pools,
        proxmox::commands::proxmox_get_pool,
        proxmox::commands::proxmox_create_pool,
        proxmox::commands::proxmox_delete_pool,
        // Proxmox VE commands — HA
        proxmox::commands::proxmox_list_ha_resources,
        proxmox::commands::proxmox_list_ha_groups,
        // Proxmox VE commands — Ceph
        proxmox::commands::proxmox_get_ceph_status,
        proxmox::commands::proxmox_list_ceph_pools,
        proxmox::commands::proxmox_list_ceph_monitors,
        proxmox::commands::proxmox_list_ceph_osds,
        // Proxmox VE commands — SDN
        proxmox::commands::proxmox_list_sdn_zones,
        proxmox::commands::proxmox_list_sdn_vnets,
        // Proxmox VE commands — Console
        proxmox::commands::proxmox_qemu_vnc_proxy,
        proxmox::commands::proxmox_qemu_spice_proxy,
        proxmox::commands::proxmox_qemu_termproxy,
        proxmox::commands::proxmox_lxc_vnc_proxy,
        proxmox::commands::proxmox_lxc_spice_proxy,
        proxmox::commands::proxmox_lxc_termproxy,
        proxmox::commands::proxmox_node_termproxy,
        // Proxmox VE commands — Snapshots
        proxmox::commands::proxmox_list_qemu_snapshots,
        proxmox::commands::proxmox_create_qemu_snapshot,
        proxmox::commands::proxmox_rollback_qemu_snapshot,
        proxmox::commands::proxmox_delete_qemu_snapshot,
        proxmox::commands::proxmox_list_lxc_snapshots,
        proxmox::commands::proxmox_create_lxc_snapshot,
        proxmox::commands::proxmox_rollback_lxc_snapshot,
        proxmox::commands::proxmox_delete_lxc_snapshot,
        // Proxmox VE commands — Metrics / RRD
        proxmox::commands::proxmox_node_rrd,
        proxmox::commands::proxmox_qemu_rrd,
        proxmox::commands::proxmox_lxc_rrd,
        // Proxmox VE commands — Templates
        proxmox::commands::proxmox_list_appliance_templates,
        proxmox::commands::proxmox_download_appliance,
        proxmox::commands::proxmox_list_isos,
        proxmox::commands::proxmox_list_container_templates,
        // Dell iDRAC commands — Connection
        idrac::commands::idrac_connect,
        idrac::commands::idrac_disconnect,
        idrac::commands::idrac_check_session,
        idrac::commands::idrac_is_connected,
        idrac::commands::idrac_get_config,
        // Dell iDRAC commands — System
        idrac::commands::idrac_get_system_info,
        idrac::commands::idrac_get_idrac_info,
        idrac::commands::idrac_set_asset_tag,
        idrac::commands::idrac_set_indicator_led,
        // Dell iDRAC commands — Power
        idrac::commands::idrac_power_action,
        idrac::commands::idrac_get_power_state,
        idrac::commands::idrac_get_power_metrics,
        idrac::commands::idrac_list_power_supplies,
        idrac::commands::idrac_set_power_cap,
        // Dell iDRAC commands — Thermal
        idrac::commands::idrac_get_thermal_data,
        idrac::commands::idrac_get_thermal_summary,
        idrac::commands::idrac_set_fan_offset,
        // Dell iDRAC commands — Hardware
        idrac::commands::idrac_list_processors,
        idrac::commands::idrac_list_memory,
        idrac::commands::idrac_list_pcie_devices,
        idrac::commands::idrac_get_total_memory,
        idrac::commands::idrac_get_processor_count,
        // Dell iDRAC commands — Storage
        idrac::commands::idrac_list_storage_controllers,
        idrac::commands::idrac_list_virtual_disks,
        idrac::commands::idrac_list_physical_disks,
        idrac::commands::idrac_list_enclosures,
        idrac::commands::idrac_create_virtual_disk,
        idrac::commands::idrac_delete_virtual_disk,
        idrac::commands::idrac_assign_hotspare,
        idrac::commands::idrac_initialize_virtual_disk,
        // Dell iDRAC commands — Network
        idrac::commands::idrac_list_network_adapters,
        idrac::commands::idrac_list_network_ports,
        idrac::commands::idrac_get_network_config,
        idrac::commands::idrac_update_network_config,
        // Dell iDRAC commands — Firmware
        idrac::commands::idrac_list_firmware,
        idrac::commands::idrac_update_firmware,
        idrac::commands::idrac_get_component_version,
        // Dell iDRAC commands — Lifecycle
        idrac::commands::idrac_list_jobs,
        idrac::commands::idrac_get_job,
        idrac::commands::idrac_delete_job,
        idrac::commands::idrac_purge_job_queue,
        idrac::commands::idrac_export_scp,
        idrac::commands::idrac_import_scp,
        idrac::commands::idrac_get_lc_status,
        idrac::commands::idrac_wait_for_job,
        // Dell iDRAC commands — Virtual Media
        idrac::commands::idrac_list_virtual_media,
        idrac::commands::idrac_mount_virtual_media,
        idrac::commands::idrac_unmount_virtual_media,
        idrac::commands::idrac_boot_from_virtual_cd,
        // Dell iDRAC commands — Virtual Console
        idrac::commands::idrac_get_console_info,
        idrac::commands::idrac_set_console_enabled,
        idrac::commands::idrac_set_console_type,
        idrac::commands::idrac_set_vnc_enabled,
        idrac::commands::idrac_set_vnc_password,
        // Dell iDRAC commands — Event Log
        idrac::commands::idrac_get_sel_entries,
        idrac::commands::idrac_get_lc_log_entries,
        idrac::commands::idrac_clear_sel,
        idrac::commands::idrac_clear_lc_log,
        // Dell iDRAC commands — Users
        idrac::commands::idrac_list_users,
        idrac::commands::idrac_create_or_update_user,
        idrac::commands::idrac_delete_user,
        idrac::commands::idrac_unlock_user,
        idrac::commands::idrac_change_user_password,
        idrac::commands::idrac_get_ldap_config,
        idrac::commands::idrac_get_ad_config,
        // Dell iDRAC commands — BIOS
        idrac::commands::idrac_get_bios_attributes,
        idrac::commands::idrac_get_bios_attribute,
        idrac::commands::idrac_set_bios_attributes,
        idrac::commands::idrac_get_boot_order,
        idrac::commands::idrac_set_boot_order,
        idrac::commands::idrac_set_boot_once,
        idrac::commands::idrac_set_boot_mode,
        // Dell iDRAC commands — Certificates
        idrac::commands::idrac_list_certificates,
        idrac::commands::idrac_generate_csr,
        idrac::commands::idrac_import_certificate,
        idrac::commands::idrac_delete_certificate,
        idrac::commands::idrac_replace_ssl_certificate,
        // Dell iDRAC commands — Health
        idrac::commands::idrac_get_health_rollup,
        idrac::commands::idrac_get_component_health,
        idrac::commands::idrac_is_healthy,
        // Dell iDRAC commands — Telemetry
        idrac::commands::idrac_get_power_telemetry,
        idrac::commands::idrac_get_thermal_telemetry,
        idrac::commands::idrac_list_telemetry_reports,
        idrac::commands::idrac_get_telemetry_report,
        // Dell iDRAC commands — RACADM
        idrac::commands::idrac_racadm_execute,
        idrac::commands::idrac_reset,
        idrac::commands::idrac_get_attribute,
        idrac::commands::idrac_set_attribute,
        // Dell iDRAC commands — Dashboard
        idrac::commands::idrac_get_dashboard,
        // HP iLO commands — Connection
        ilo::commands::ilo_connect,
        ilo::commands::ilo_disconnect,
        ilo::commands::ilo_check_session,
        ilo::commands::ilo_is_connected,
        ilo::commands::ilo_get_config,
        // HP iLO commands — System
        ilo::commands::ilo_get_system_info,
        ilo::commands::ilo_get_ilo_info,
        ilo::commands::ilo_set_asset_tag,
        ilo::commands::ilo_set_indicator_led,
        // HP iLO commands — Power
        ilo::commands::ilo_power_action,
        ilo::commands::ilo_get_power_state,
        ilo::commands::ilo_get_power_metrics,
        // HP iLO commands — Thermal
        ilo::commands::ilo_get_thermal_data,
        ilo::commands::ilo_get_thermal_summary,
        // HP iLO commands — Hardware
        ilo::commands::ilo_get_processors,
        ilo::commands::ilo_get_memory,
        // HP iLO commands — Storage
        ilo::commands::ilo_get_storage_controllers,
        ilo::commands::ilo_get_virtual_disks,
        ilo::commands::ilo_get_physical_disks,
        // HP iLO commands — Network
        ilo::commands::ilo_get_network_adapters,
        ilo::commands::ilo_get_ilo_network,
        // HP iLO commands — Firmware
        ilo::commands::ilo_get_firmware_inventory,
        // HP iLO commands — Virtual Media
        ilo::commands::ilo_get_virtual_media_status,
        ilo::commands::ilo_insert_virtual_media,
        ilo::commands::ilo_eject_virtual_media,
        ilo::commands::ilo_set_vm_boot_once,
        // HP iLO commands — Virtual Console
        ilo::commands::ilo_get_console_info,
        ilo::commands::ilo_get_html5_launch_url,
        // HP iLO commands — Event Log
        ilo::commands::ilo_get_iml,
        ilo::commands::ilo_get_ilo_event_log,
        ilo::commands::ilo_clear_iml,
        ilo::commands::ilo_clear_ilo_event_log,
        // HP iLO commands — Users
        ilo::commands::ilo_get_users,
        ilo::commands::ilo_create_user,
        ilo::commands::ilo_update_password,
        ilo::commands::ilo_delete_user,
        ilo::commands::ilo_set_user_enabled,
        // HP iLO commands — BIOS
        ilo::commands::ilo_get_bios_attributes,
        ilo::commands::ilo_set_bios_attributes,
        ilo::commands::ilo_get_boot_config,
        ilo::commands::ilo_set_boot_override,
        // HP iLO commands — Certificates
        ilo::commands::ilo_get_certificate,
        ilo::commands::ilo_generate_csr,
        ilo::commands::ilo_import_certificate,
        // HP iLO commands — Health
        ilo::commands::ilo_get_health_rollup,
        ilo::commands::ilo_get_dashboard,
        // HP iLO commands — License
        ilo::commands::ilo_get_license,
        ilo::commands::ilo_activate_license,
        ilo::commands::ilo_deactivate_license,
        // HP iLO commands — Security
        ilo::commands::ilo_get_security_status,
        ilo::commands::ilo_set_min_tls_version,
        ilo::commands::ilo_set_ipmi_over_lan,
        // HP iLO commands — Federation
        ilo::commands::ilo_get_federation_groups,
        ilo::commands::ilo_get_federation_peers,
        ilo::commands::ilo_add_federation_group,
        ilo::commands::ilo_remove_federation_group,
        // HP iLO commands — Reset
        ilo::commands::ilo_reset,
        // Lenovo XCC commands — Connection
        lenovo::commands::lenovo_connect,
        lenovo::commands::lenovo_disconnect,
        lenovo::commands::lenovo_check_session,
        lenovo::commands::lenovo_is_connected,
        lenovo::commands::lenovo_get_config,
        // Lenovo XCC commands — System
        lenovo::commands::lenovo_get_system_info,
        lenovo::commands::lenovo_get_xcc_info,
        lenovo::commands::lenovo_set_asset_tag,
        lenovo::commands::lenovo_set_indicator_led,
        // Lenovo XCC commands — Power
        lenovo::commands::lenovo_power_action,
        lenovo::commands::lenovo_get_power_state,
        lenovo::commands::lenovo_get_power_metrics,
        // Lenovo XCC commands — Thermal
        lenovo::commands::lenovo_get_thermal_data,
        lenovo::commands::lenovo_get_thermal_summary,
        // Lenovo XCC commands — Hardware
        lenovo::commands::lenovo_get_processors,
        lenovo::commands::lenovo_get_memory,
        // Lenovo XCC commands — Storage
        lenovo::commands::lenovo_get_storage_controllers,
        lenovo::commands::lenovo_get_virtual_disks,
        lenovo::commands::lenovo_get_physical_disks,
        // Lenovo XCC commands — Network
        lenovo::commands::lenovo_get_network_adapters,
        lenovo::commands::lenovo_get_xcc_network,
        // Lenovo XCC commands — Firmware
        lenovo::commands::lenovo_get_firmware_inventory,
        // Lenovo XCC commands — Virtual Media
        lenovo::commands::lenovo_get_virtual_media_status,
        lenovo::commands::lenovo_insert_virtual_media,
        lenovo::commands::lenovo_eject_virtual_media,
        // Lenovo XCC commands — Console
        lenovo::commands::lenovo_get_console_info,
        lenovo::commands::lenovo_get_html5_launch_url,
        // Lenovo XCC commands — Event Log
        lenovo::commands::lenovo_get_event_log,
        lenovo::commands::lenovo_get_audit_log,
        lenovo::commands::lenovo_clear_event_log,
        // Lenovo XCC commands — Users
        lenovo::commands::lenovo_get_users,
        lenovo::commands::lenovo_create_user,
        lenovo::commands::lenovo_update_password,
        lenovo::commands::lenovo_delete_user,
        // Lenovo XCC commands — BIOS
        lenovo::commands::lenovo_get_bios_attributes,
        lenovo::commands::lenovo_set_bios_attributes,
        lenovo::commands::lenovo_get_boot_config,
        lenovo::commands::lenovo_set_boot_override,
        // Lenovo XCC commands — Certificates
        lenovo::commands::lenovo_get_certificate,
        lenovo::commands::lenovo_generate_csr,
        lenovo::commands::lenovo_import_certificate,
        // Lenovo XCC commands — Health
        lenovo::commands::lenovo_get_health_rollup,
        lenovo::commands::lenovo_get_dashboard,
        // Lenovo XCC commands — License
        lenovo::commands::lenovo_get_license,
        // Lenovo XCC commands — OneCLI
        lenovo::commands::lenovo_onecli_execute,
        // Lenovo XCC commands — Reset
        lenovo::commands::lenovo_reset_controller,
        // Supermicro BMC commands — Connection
        supermicro::commands::smc_connect,
        supermicro::commands::smc_disconnect,
        supermicro::commands::smc_check_session,
        supermicro::commands::smc_is_connected,
        supermicro::commands::smc_get_config,
        // Supermicro BMC commands — System
        supermicro::commands::smc_get_system_info,
        supermicro::commands::smc_get_bmc_info,
        supermicro::commands::smc_set_asset_tag,
        supermicro::commands::smc_set_indicator_led,
        // Supermicro BMC commands — Power
        supermicro::commands::smc_power_action,
        supermicro::commands::smc_get_power_state,
        supermicro::commands::smc_get_power_metrics,
        // Supermicro BMC commands — Thermal
        supermicro::commands::smc_get_thermal_data,
        supermicro::commands::smc_get_thermal_summary,
        // Supermicro BMC commands — Hardware
        supermicro::commands::smc_get_processors,
        supermicro::commands::smc_get_memory,
        // Supermicro BMC commands — Storage
        supermicro::commands::smc_get_storage_controllers,
        supermicro::commands::smc_get_virtual_disks,
        supermicro::commands::smc_get_physical_disks,
        // Supermicro BMC commands — Network
        supermicro::commands::smc_get_network_adapters,
        supermicro::commands::smc_get_bmc_network,
        // Supermicro BMC commands — Firmware
        supermicro::commands::smc_get_firmware_inventory,
        // Supermicro BMC commands — Virtual Media
        supermicro::commands::smc_get_virtual_media_status,
        supermicro::commands::smc_insert_virtual_media,
        supermicro::commands::smc_eject_virtual_media,
        // Supermicro BMC commands — Console / iKVM
        supermicro::commands::smc_get_console_info,
        supermicro::commands::smc_get_html5_ikvm_url,
        // Supermicro BMC commands — Event Log
        supermicro::commands::smc_get_event_log,
        supermicro::commands::smc_get_audit_log,
        supermicro::commands::smc_clear_event_log,
        // Supermicro BMC commands — Users
        supermicro::commands::smc_get_users,
        supermicro::commands::smc_create_user,
        supermicro::commands::smc_update_password,
        supermicro::commands::smc_delete_user,
        // Supermicro BMC commands — BIOS
        supermicro::commands::smc_get_bios_attributes,
        supermicro::commands::smc_set_bios_attributes,
        supermicro::commands::smc_get_boot_config,
        supermicro::commands::smc_set_boot_override,
        // Supermicro BMC commands — Certificates
        supermicro::commands::smc_get_certificate,
        supermicro::commands::smc_generate_csr,
        supermicro::commands::smc_import_certificate,
        // Supermicro BMC commands — Health
        supermicro::commands::smc_get_health_rollup,
        supermicro::commands::smc_get_dashboard,
        // Supermicro BMC commands — Security
        supermicro::commands::smc_get_security_status,
        // Supermicro BMC commands — License
        supermicro::commands::smc_get_licenses,
        supermicro::commands::smc_activate_license,
        // Supermicro BMC commands — Node Manager
        supermicro::commands::smc_get_node_manager_policies,
        supermicro::commands::smc_get_node_manager_stats,
        // Supermicro BMC commands — Reset
        supermicro::commands::smc_reset_bmc,
        // Synology NAS commands — Connection
        synology::commands::syn_connect,
        synology::commands::syn_disconnect,
        synology::commands::syn_is_connected,
        synology::commands::syn_check_session,
        synology::commands::syn_get_config,
        // Synology NAS commands — System
        synology::commands::syn_get_system_info,
        synology::commands::syn_get_utilization,
        synology::commands::syn_list_processes,
        synology::commands::syn_reboot,
        synology::commands::syn_shutdown,
        synology::commands::syn_check_update,
        // Synology NAS commands — Storage
        synology::commands::syn_get_storage_overview,
        synology::commands::syn_list_disks,
        synology::commands::syn_list_volumes,
        synology::commands::syn_get_smart_info,
        synology::commands::syn_list_iscsi_luns,
        synology::commands::syn_list_iscsi_targets,
        // Synology NAS commands — File Station
        synology::commands::syn_get_file_station_info,
        synology::commands::syn_list_files,
        synology::commands::syn_list_file_shared_folders,
        synology::commands::syn_search_files,
        synology::commands::syn_upload_file,
        synology::commands::syn_download_file,
        synology::commands::syn_create_folder,
        synology::commands::syn_delete_files,
        synology::commands::syn_rename_file,
        synology::commands::syn_create_share_link,
        // Synology NAS commands — Shared Folders
        synology::commands::syn_list_shared_folders,
        synology::commands::syn_get_share_permissions,
        synology::commands::syn_create_shared_folder,
        synology::commands::syn_delete_shared_folder,
        synology::commands::syn_mount_encrypted_share,
        synology::commands::syn_unmount_encrypted_share,
        // Synology NAS commands — Network
        synology::commands::syn_get_network_overview,
        synology::commands::syn_list_network_interfaces,
        synology::commands::syn_list_firewall_rules,
        synology::commands::syn_list_dhcp_leases,
        // Synology NAS commands — Users & Groups
        synology::commands::syn_list_users,
        synology::commands::syn_create_user,
        synology::commands::syn_delete_user,
        synology::commands::syn_list_groups,
        // Synology NAS commands — Packages
        synology::commands::syn_list_packages,
        synology::commands::syn_start_package,
        synology::commands::syn_stop_package,
        synology::commands::syn_install_package,
        synology::commands::syn_uninstall_package,
        // Synology NAS commands — Services
        synology::commands::syn_list_services,
        synology::commands::syn_get_smb_config,
        synology::commands::syn_get_nfs_config,
        synology::commands::syn_get_ssh_config,
        synology::commands::syn_set_ssh_enabled,
        // Synology NAS commands — Docker
        synology::commands::syn_list_docker_containers,
        synology::commands::syn_start_docker_container,
        synology::commands::syn_stop_docker_container,
        synology::commands::syn_restart_docker_container,
        synology::commands::syn_delete_docker_container,
        synology::commands::syn_list_docker_images,
        synology::commands::syn_pull_docker_image,
        synology::commands::syn_list_docker_networks,
        synology::commands::syn_list_docker_projects,
        synology::commands::syn_start_docker_project,
        synology::commands::syn_stop_docker_project,
        // Synology NAS commands — VMs
        synology::commands::syn_list_vms,
        synology::commands::syn_vm_power_on,
        synology::commands::syn_vm_shutdown,
        synology::commands::syn_vm_force_shutdown,
        synology::commands::syn_list_vm_snapshots,
        synology::commands::syn_take_vm_snapshot,
        // Synology NAS commands — Download Station
        synology::commands::syn_get_download_station_info,
        synology::commands::syn_list_download_tasks,
        synology::commands::syn_create_download_task,
        synology::commands::syn_pause_download,
        synology::commands::syn_resume_download,
        synology::commands::syn_delete_download,
        synology::commands::syn_get_download_stats,
        // Synology NAS commands — Surveillance
        synology::commands::syn_get_surveillance_info,
        synology::commands::syn_list_cameras,
        synology::commands::syn_get_camera_snapshot,
        synology::commands::syn_list_recordings,
        // Synology NAS commands — Backup
        synology::commands::syn_list_backup_tasks,
        synology::commands::syn_start_backup_task,
        synology::commands::syn_cancel_backup_task,
        synology::commands::syn_list_backup_versions,
        synology::commands::syn_list_active_backup_devices,
        // Synology NAS commands — Security
        synology::commands::syn_get_security_overview,
        synology::commands::syn_list_blocked_ips,
        synology::commands::syn_unblock_ip,
        synology::commands::syn_list_certificates,
        synology::commands::syn_get_auto_block_config,
        // Synology NAS commands — Hardware
        synology::commands::syn_get_hardware_info,
        synology::commands::syn_get_ups_info,
        synology::commands::syn_get_power_schedule,
        // Synology NAS commands — Logs
        synology::commands::syn_get_system_logs,
        synology::commands::syn_get_connection_logs,
        synology::commands::syn_get_active_connections,
        // Synology NAS commands — Notifications
        synology::commands::syn_get_notification_config,
        synology::commands::syn_test_email_notification,
        // Synology NAS commands — Dashboard
        synology::commands::syn_get_dashboard,
    ]
}
