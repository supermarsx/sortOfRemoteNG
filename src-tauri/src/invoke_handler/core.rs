use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "greet"
            | "open_url_external"
            | "get_launch_args"
            | "add_user"
            | "verify_user"
            | "list_users"
            | "remove_user"
            | "update_password"
            | "has_stored_data"
            | "is_storage_encrypted"
            | "save_data"
            | "load_data"
            | "clear_storage"
            | "set_storage_password"
            | "trust_verify_identity"
            | "trust_store_identity"
            | "trust_store_identity_with_reason"
            | "trust_remove_identity"
            | "trust_get_identity"
            | "trust_get_all_records"
            | "trust_clear_all"
            | "trust_update_nickname"
            | "trust_get_policy"
            | "trust_set_policy"
            | "trust_get_policy_config"
            | "trust_set_policy_config"
            | "trust_set_host_policy"
            | "trust_revoke_identity"
            | "trust_reinstate_identity"
            | "trust_set_record_tags"
            | "trust_get_identity_history"
            | "trust_get_verification_stats"
            | "trust_get_summary"
            | "connect_ssh"
            | "execute_command"
            | "execute_command_interactive"
            | "send_ssh_input"
            | "resize_ssh_shell"
            | "setup_port_forward"
            | "list_directory"
            | "upload_file"
            | "download_file"
            | "disconnect_ssh"
            | "get_session_info"
            | "list_sessions"
            | "validate_mixed_chain"
            | "jump_hosts_to_mixed_chain"
            | "proxy_chain_to_mixed_chain"
            | "test_mixed_chain_connection"
            | "disconnect_rdp"
            | "attach_rdp_session"
            | "detach_rdp_session"
            | "rdp_send_input"
            | "rdp_get_frame_data"
            | "get_rdp_session_info"
            | "list_rdp_sessions"
            | "get_rdp_stats"
            | "detect_keyboard_layout"
            | "diagnose_rdp_connection"
            | "rdp_sign_out"
            | "rdp_force_reboot"
            | "reconnect_rdp_session"
            | "rdp_get_thumbnail"
            | "rdp_save_screenshot"
            | "get_rdp_logs"
            | "connect_vnc"
            | "disconnect_vnc"
            | "disconnect_all_vnc"
            | "is_vnc_connected"
            | "get_vnc_session_info"
            | "list_vnc_sessions"
            | "get_vnc_session_stats"
            | "send_vnc_key_event"
            | "send_vnc_pointer_event"
            | "send_vnc_clipboard"
            | "request_vnc_update"
            | "set_vnc_pixel_format"
            | "prune_vnc_sessions"
            | "get_vnc_session_count"
            | "launch_anydesk"
            | "disconnect_anydesk"
            | "get_anydesk_session"
            | "list_anydesk_sessions"
            | "connect_mysql"
            | "execute_query"
            | "disconnect_db"
            | "get_databases"
            | "get_tables"
            | "get_table_structure"
            | "create_database"
            | "drop_database"
            | "create_table"
            | "drop_table"
            | "get_table_data"
            | "insert_row"
            | "update_row"
            | "delete_row"
            | "export_table"
            | "export_table_chunked"
            | "export_database"
            | "export_database_chunked"
            | "import_sql"
            | "import_csv"
            | "ftp_connect"
            | "ftp_disconnect"
            | "ftp_disconnect_all"
            | "ftp_get_session_info"
            | "ftp_list_sessions"
            | "ftp_ping"
            | "ftp_list_directory"
            | "ftp_set_directory"
            | "ftp_get_current_directory"
            | "ftp_mkdir"
            | "ftp_mkdir_all"
            | "ftp_rmdir"
            | "ftp_rmdir_recursive"
            | "ftp_rename"
            | "ftp_delete_file"
            | "ftp_chmod"
            | "ftp_get_file_size"
            | "ftp_get_modified_time"
            | "ftp_stat_entry"
            | "ftp_upload_file"
            | "ftp_download_file"
            | "ftp_append_file"
            | "ftp_resume_upload"
            | "ftp_resume_download"
            | "ftp_enqueue_transfer"
            | "ftp_cancel_transfer"
            | "ftp_list_transfers"
            | "ftp_get_transfer_progress"
            | "ftp_get_all_progress"
            | "ftp_get_diagnostics"
            | "ftp_get_pool_stats"
            | "ftp_list_bookmarks"
            | "ftp_add_bookmark"
            | "ftp_remove_bookmark"
            | "ftp_update_bookmark"
            | "ftp_site_command"
            | "ftp_raw_command"
            | "ping_host"
            | "ping_host_detailed"
            | "ping_gateway"
            | "check_port"
            | "dns_lookup"
            | "classify_ip"
            | "traceroute"
            | "scan_network"
            | "scan_network_comprehensive"
            | "tcp_connection_timing"
            | "check_mtu"
            | "detect_icmp_blockade"
            | "check_tls"
            | "fingerprint_service"
            | "detect_asymmetric_routing"
            | "probe_udp_port"
            | "lookup_ip_geo"
            | "detect_proxy_leakage"
            | "generate_totp_secret"
            | "verify_totp"
            | "wake_on_lan"
            | "wake_multiple_hosts"
            | "discover_wol_devices"
            | "add_wol_schedule"
            | "remove_wol_schedule"
            | "list_wol_schedules"
            | "update_wol_schedule"
            | "execute_user_script"
            | "create_openvpn_connection"
            | "connect_openvpn"
            | "disconnect_openvpn"
            | "get_openvpn_connection"
            | "list_openvpn_connections"
            | "delete_openvpn_connection"
            | "get_openvpn_status"
            | "create_proxy_connection"
            | "connect_via_proxy"
            | "disconnect_proxy"
            | "get_proxy_connection"
            | "list_proxy_connections"
            | "delete_proxy_connection"
            | "create_proxy_chain"
            | "connect_proxy_chain"
            | "disconnect_proxy_chain"
            | "get_proxy_chain"
            | "list_proxy_chains"
            | "delete_proxy_chain"
            | "get_proxy_chain_health"
            | "create_wireguard_connection"
            | "connect_wireguard"
            | "disconnect_wireguard"
            | "get_wireguard_connection"
            | "list_wireguard_connections"
            | "delete_wireguard_connection"
            | "create_zerotier_connection"
            | "connect_zerotier"
            | "disconnect_zerotier"
            | "get_zerotier_connection"
            | "list_zerotier_connections"
            | "delete_zerotier_connection"
            | "create_tailscale_connection"
            | "connect_tailscale"
            | "disconnect_tailscale"
            | "get_tailscale_connection"
            | "list_tailscale_connections"
            | "delete_tailscale_connection"
            | "create_connection_chain"
            | "connect_connection_chain"
            | "disconnect_connection_chain"
            | "get_connection_chain"
            | "list_connection_chains"
            | "delete_connection_chain"
            | "update_connection_chain_layers"
            | "generate_qr_code"
            | "generate_qr_code_png"
            | "connect_wmi"
            | "disconnect_wmi"
            | "execute_wmi_query"
            | "get_wmi_session"
            | "list_wmi_sessions"
            | "get_wmi_classes"
            | "get_wmi_namespaces"
            | "connect_rpc"
            | "disconnect_rpc"
            | "call_rpc_method"
            | "get_rpc_session"
            | "list_rpc_sessions"
            | "discover_rpc_methods"
            | "batch_rpc_calls"
            | "connect_meshcentral"
            | "disconnect_meshcentral"
            | "get_meshcentral_devices"
            | "get_meshcentral_groups"
            | "execute_meshcentral_command"
            | "get_meshcentral_command_result"
            | "get_meshcentral_session"
            | "list_meshcentral_sessions"
            | "get_meshcentral_server_info"
            | "connect_agent"
            | "disconnect_agent"
            | "get_agent_metrics"
            | "get_agent_logs"
            | "execute_agent_command"
            | "get_agent_command_result"
            | "get_agent_session"
            | "list_agent_sessions"
            | "update_agent_status"
            | "get_agent_info"
            | "connect_commander"
            | "disconnect_commander"
            | "execute_commander_command"
            | "get_commander_command_result"
            | "upload_commander_file"
            | "download_commander_file"
            | "get_commander_file_transfer"
            | "list_commander_directory"
            | "get_commander_session"
            | "list_commander_sessions"
            | "update_commander_status"
            | "get_commander_system_info"
            | "connect_aws"
            | "disconnect_aws"
            | "list_aws_sessions"
            | "get_aws_session"
            | "list_ec2_instances"
            | "list_s3_buckets"
            | "get_s3_objects"
            | "list_rds_instances"
            | "list_lambda_functions"
            | "get_cloudwatch_metrics"
            | "execute_ec2_action"
            | "create_s3_bucket"
            | "invoke_lambda_function"
            | "list_iam_users"
            | "list_iam_roles"
            | "get_caller_identity"
            | "get_ssm_parameter"
            | "get_secret_value"
            | "list_secrets"
            | "list_ecs_clusters"
            | "list_ecs_services"
            | "list_hosted_zones"
            | "list_sns_topics"
            | "list_sqs_queues"
            | "list_cloudformation_stacks"
            | "connect_vercel"
            | "disconnect_vercel"
            | "list_vercel_sessions"
            | "get_vercel_session"
            | "list_vercel_projects"
            | "list_vercel_deployments"
            | "list_vercel_domains"
            | "list_vercel_teams"
            | "create_vercel_deployment"
            | "redeploy_vercel_project"
            | "add_vercel_domain"
            | "set_vercel_env_var"
            | "connect_cloudflare"
            | "disconnect_cloudflare"
            | "list_cloudflare_sessions"
            | "get_cloudflare_session"
            | "list_cloudflare_zones"
            | "list_cloudflare_dns_records"
            | "create_cloudflare_dns_record"
            | "update_cloudflare_dns_record"
            | "delete_cloudflare_dns_record"
            | "list_cloudflare_workers"
            | "deploy_cloudflare_worker"
            | "list_cloudflare_page_rules"
            | "get_cloudflare_analytics"
            | "purge_cloudflare_cache"
            | "create_openvpn_connection_from_ovpn"
            | "update_openvpn_connection_auth"
            | "set_openvpn_connection_key_files"
            | "validate_ovpn_config"
            | "update_ssh_session_auth"
            | "validate_ssh_key_file"
            | "test_ssh_connection"
            | "generate_ssh_key"
            | "check_fido2_support"
            | "list_fido2_devices"
            | "generate_sk_ssh_key"
            | "list_fido2_resident_credentials"
            | "detect_sk_key_type"
            | "validate_ssh_key_file_extended"
            | "get_terminal_buffer"
            | "clear_terminal_buffer"
            | "is_session_alive"
            | "get_shell_info"
            | "get_ssh_compression_info"
            | "update_ssh_compression_config"
            | "reset_ssh_compression_stats"
            | "list_ssh_compression_algorithms"
            | "should_compress_sftp"
            | "start_session_recording"
            | "stop_session_recording"
            | "is_session_recording"
            | "get_recording_status"
            | "export_recording_asciicast"
            | "export_recording_script"
            | "list_active_recordings"
            | "start_automation"
            | "stop_automation"
            | "is_automation_active"
            | "get_automation_status"
            | "list_active_automations"
            | "expect_and_send"
            | "execute_command_sequence"
            | "set_highlight_rules"
            | "get_highlight_rules"
            | "add_highlight_rule"
            | "remove_highlight_rule"
            | "update_highlight_rule"
            | "clear_highlight_rules"
            | "get_highlight_status"
            | "list_highlighted_sessions"
            | "test_highlight_rules"
            | "setup_ftp_tunnel"
            | "stop_ftp_tunnel"
            | "get_ftp_tunnel_status"
            | "list_ftp_tunnels"
            | "list_session_ftp_tunnels"
            | "setup_rdp_tunnel"
            | "stop_rdp_tunnel"
            | "get_rdp_tunnel_status"
            | "list_rdp_tunnels"
            | "list_session_rdp_tunnels"
            | "setup_bulk_rdp_tunnels"
            | "stop_session_rdp_tunnels"
            | "generate_rdp_file"
            | "setup_vnc_tunnel"
            | "stop_vnc_tunnel"
            | "get_vnc_tunnel_status"
            | "list_vnc_tunnels"
            | "list_session_vnc_tunnels"
            | "connect_ssh3"
            | "disconnect_ssh3"
            | "send_ssh3_input"
            | "resize_ssh3_shell"
            | "execute_ssh3_command"
            | "setup_ssh3_port_forward"
            | "stop_ssh3_port_forward"
            | "close_ssh3_channel"
            | "get_ssh3_session_info"
            | "list_ssh3_sessions"
            | "test_ssh3_connection"
            | "get_ssh_host_key_info"
            | "diagnose_ssh_connection"
            | "enable_x11_forwarding"
            | "disable_x11_forwarding"
            | "get_x11_forward_status"
            | "list_x11_forwards"
            | "get_proxy_command_info"
            | "stop_proxy_command_cmd"
            | "test_proxy_command"
            | "expand_proxy_command"
            | "http_fetch"
            | "http_get"
            | "http_post"
            | "diagnose_http_connection"
            | "start_basic_auth_proxy"
            | "stop_basic_auth_proxy"
            | "list_proxy_sessions"
            | "get_proxy_session_details"
            | "get_proxy_request_log"
            | "clear_proxy_request_log"
            | "stop_all_proxy_sessions"
            | "check_proxy_health"
            | "restart_proxy_session"
            | "get_tls_certificate_info"
            | "start_web_recording"
            | "stop_web_recording"
            | "is_web_recording"
            | "get_web_recording_status"
            | "export_web_recording_har"
            | "passkey_is_available"
            | "passkey_authenticate"
            | "passkey_register"
            | "passkey_list_credentials"
            | "passkey_remove_credential"
            | "biometric_check_availability"
            | "biometric_is_available"
            | "biometric_verify"
            | "biometric_verify_and_derive_key"
            | "vault_status"
            | "vault_is_available"
            | "vault_backend_name"
            | "vault_store_secret"
            | "vault_read_secret"
            | "vault_delete_secret"
            | "vault_ensure_dek"
            | "vault_envelope_encrypt"
            | "vault_envelope_decrypt"
            | "vault_biometric_store"
            | "vault_biometric_read"
            | "vault_needs_migration"
            | "vault_migrate"
            | "vault_load_storage"
            | "vault_save_storage"
            | "cert_gen_self_signed"
            | "cert_gen_ca"
            | "cert_gen_csr"
            | "cert_sign_csr"
            | "cert_gen_issue"
            | "cert_gen_export_pem"
            | "cert_gen_export_der"
            | "cert_gen_export_chain"
            | "cert_gen_list"
            | "cert_gen_get"
            | "cert_gen_delete"
            | "cert_gen_list_csrs"
            | "cert_gen_delete_csr"
            | "cert_gen_update_label"
            | "cert_gen_get_chain"
            | "get_legacy_crypto_policy"
            | "set_legacy_crypto_policy"
            | "get_legacy_crypto_warnings"
            | "get_legacy_ssh_ciphers"
            | "get_legacy_ssh_kex"
            | "get_legacy_ssh_macs"
            | "get_legacy_ssh_host_key_algorithms"
            | "is_legacy_algorithm_allowed"
            | "parse_certificate"
            | "validate_certificate"
            | "authenticate_with_cert"
            | "register_certificate"
            | "list_certificates"
            | "revoke_certificate"
            | "connect_telnet"
            | "disconnect_telnet"
            | "send_telnet_command"
            | "send_telnet_raw"
            | "send_telnet_break"
            | "send_telnet_ayt"
            | "resize_telnet"
            | "get_telnet_session_info"
            | "list_telnet_sessions"
            | "disconnect_all_telnet"
            | "is_telnet_connected"
            | "serial_scan_ports"
            | "serial_connect"
            | "serial_disconnect"
            | "serial_disconnect_all"
            | "serial_send_raw"
            | "serial_send_line"
            | "serial_send_char"
            | "serial_send_hex"
            | "serial_send_break"
            | "serial_set_dtr"
            | "serial_set_rts"
            | "serial_read_control_lines"
            | "serial_reconfigure"
            | "serial_set_line_ending"
            | "serial_set_local_echo"
            | "serial_flush"
            | "serial_get_session_info"
            | "serial_list_sessions"
            | "serial_get_stats"
            | "serial_send_at_command"
            | "serial_get_modem_info"
            | "serial_get_signal_quality"
            | "serial_modem_init"
            | "serial_modem_dial"
            | "serial_modem_hangup"
            | "serial_get_modem_profiles"
            | "serial_start_logging"
            | "serial_stop_logging"
            | "serial_get_baud_rates"
            | "serial_hex_to_bytes"
            | "serial_bytes_to_hex"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        app_shell_commands::greet,
        app_shell_commands::open_url_external,
        app_shell_commands::get_launch_args,
        app_auth_commands::add_user,
        app_auth_commands::verify_user,
        app_auth_commands::list_users,
        app_auth_commands::remove_user,
        app_auth_commands::update_password,
        storage::has_stored_data,
        storage::is_storage_encrypted,
        storage::save_data,
        storage::load_data,
        storage::clear_storage,
        storage::set_storage_password,
        // Trust store commands
        trust_store::trust_verify_identity,
        trust_store::trust_store_identity,
        trust_store::trust_store_identity_with_reason,
        trust_store::trust_remove_identity,
        trust_store::trust_get_identity,
        trust_store::trust_get_all_records,
        trust_store::trust_clear_all,
        trust_store::trust_update_nickname,
        trust_store::trust_get_policy,
        trust_store::trust_set_policy,
        trust_store::trust_get_policy_config,
        trust_store::trust_set_policy_config,
        trust_store::trust_set_host_policy,
        trust_store::trust_revoke_identity,
        trust_store::trust_reinstate_identity,
        trust_store::trust_set_record_tags,
        trust_store::trust_get_identity_history,
        trust_store::trust_get_verification_stats,
        trust_store::trust_get_summary,
        ssh::connect_ssh,
        ssh::execute_command,
        ssh::execute_command_interactive,
        ssh::send_ssh_input,
        ssh::resize_ssh_shell,
        ssh::setup_port_forward,
        ssh::list_directory,
        ssh::upload_file,
        ssh::download_file,
        ssh::disconnect_ssh,
        ssh::get_session_info,
        ssh::list_sessions,
        ssh::validate_mixed_chain,
        ssh::jump_hosts_to_mixed_chain,
        ssh::proxy_chain_to_mixed_chain,
        ssh::test_mixed_chain_connection,
        rdp::disconnect_rdp,
        rdp::attach_rdp_session,
        rdp::detach_rdp_session,
        rdp::rdp_send_input,
        rdp::rdp_get_frame_data,
        rdp::get_rdp_session_info,
        rdp::list_rdp_sessions,
        rdp::get_rdp_stats,
        rdp::detect_keyboard_layout,
        rdp::diagnose_rdp_connection,
        rdp::rdp_sign_out,
        rdp::rdp_force_reboot,
        rdp::reconnect_rdp_session,
        rdp::rdp_get_thumbnail,
        rdp::rdp_save_screenshot,
        rdp::get_rdp_logs,
        vnc::connect_vnc,
        vnc::disconnect_vnc,
        vnc::disconnect_all_vnc,
        vnc::is_vnc_connected,
        vnc::get_vnc_session_info,
        vnc::list_vnc_sessions,
        vnc::get_vnc_session_stats,
        vnc::send_vnc_key_event,
        vnc::send_vnc_pointer_event,
        vnc::send_vnc_clipboard,
        vnc::request_vnc_update,
        vnc::set_vnc_pixel_format,
        vnc::prune_vnc_sessions,
        vnc::get_vnc_session_count,
        anydesk::launch_anydesk,
        anydesk::disconnect_anydesk,
        anydesk::get_anydesk_session,
        anydesk::list_anydesk_sessions,
        db::connect_mysql,
        db::execute_query,
        db::disconnect_db,
        db::get_databases,
        db::get_tables,
        db::get_table_structure,
        db::create_database,
        db::drop_database,
        db::create_table,
        db::drop_table,
        db::get_table_data,
        db::insert_row,
        db::update_row,
        db::delete_row,
        db::export_table,
        db::export_table_chunked,
        db::export_database,
        db::export_database_chunked,
        db::import_sql,
        db::import_csv,
        ftp_commands::ftp_connect,
        ftp_commands::ftp_disconnect,
        ftp_commands::ftp_disconnect_all,
        ftp_commands::ftp_get_session_info,
        ftp_commands::ftp_list_sessions,
        ftp_commands::ftp_ping,
        ftp_commands::ftp_list_directory,
        ftp_commands::ftp_set_directory,
        ftp_commands::ftp_get_current_directory,
        ftp_commands::ftp_mkdir,
        ftp_commands::ftp_mkdir_all,
        ftp_commands::ftp_rmdir,
        ftp_commands::ftp_rmdir_recursive,
        ftp_commands::ftp_rename,
        ftp_commands::ftp_delete_file,
        ftp_commands::ftp_chmod,
        ftp_commands::ftp_get_file_size,
        ftp_commands::ftp_get_modified_time,
        ftp_commands::ftp_stat_entry,
        ftp_commands::ftp_upload_file,
        ftp_commands::ftp_download_file,
        ftp_commands::ftp_append_file,
        ftp_commands::ftp_resume_upload,
        ftp_commands::ftp_resume_download,
        ftp_commands::ftp_enqueue_transfer,
        ftp_commands::ftp_cancel_transfer,
        ftp_commands::ftp_list_transfers,
        ftp_commands::ftp_get_transfer_progress,
        ftp_commands::ftp_get_all_progress,
        ftp_commands::ftp_get_diagnostics,
        ftp_commands::ftp_get_pool_stats,
        ftp_commands::ftp_list_bookmarks,
        ftp_commands::ftp_add_bookmark,
        ftp_commands::ftp_remove_bookmark,
        ftp_commands::ftp_update_bookmark,
        ftp_commands::ftp_site_command,
        ftp_commands::ftp_raw_command,
        network::ping_host,
        network::ping_host_detailed,
        network::ping_gateway,
        network::check_port,
        network::dns_lookup,
        network::classify_ip,
        network::traceroute,
        network::scan_network,
        network::scan_network_comprehensive,
        network::tcp_connection_timing,
        network::check_mtu,
        network::detect_icmp_blockade,
        network::check_tls,
        network::fingerprint_service,
        network::detect_asymmetric_routing,
        network::probe_udp_port,
        network::lookup_ip_geo,
        network::detect_proxy_leakage,
        security::generate_totp_secret,
        security::verify_totp,
        wol::wake_on_lan,
        wol::wake_multiple_hosts,
        wol::discover_wol_devices,
        wol::add_wol_schedule,
        wol::remove_wol_schedule,
        wol::list_wol_schedules,
        wol::update_wol_schedule,
        script::execute_user_script,
        openvpn::create_openvpn_connection,
        openvpn::connect_openvpn,
        openvpn::disconnect_openvpn,
        openvpn::get_openvpn_connection,
        openvpn::list_openvpn_connections,
        openvpn::delete_openvpn_connection,
        openvpn::get_openvpn_status,
        proxy::create_proxy_connection,
        proxy::connect_via_proxy,
        proxy::disconnect_proxy,
        proxy::get_proxy_connection,
        proxy::list_proxy_connections,
        proxy::delete_proxy_connection,
        proxy::create_proxy_chain,
        proxy::connect_proxy_chain,
        proxy::disconnect_proxy_chain,
        proxy::get_proxy_chain,
        proxy::list_proxy_chains,
        proxy::delete_proxy_chain,
        proxy::get_proxy_chain_health,
        wireguard::create_wireguard_connection,
        wireguard::connect_wireguard,
        wireguard::disconnect_wireguard,
        wireguard::get_wireguard_connection,
        wireguard::list_wireguard_connections,
        wireguard::delete_wireguard_connection,
        zerotier::create_zerotier_connection,
        zerotier::connect_zerotier,
        zerotier::disconnect_zerotier,
        zerotier::get_zerotier_connection,
        zerotier::list_zerotier_connections,
        zerotier::delete_zerotier_connection,
        tailscale::create_tailscale_connection,
        tailscale::connect_tailscale,
        tailscale::disconnect_tailscale,
        tailscale::get_tailscale_connection,
        tailscale::list_tailscale_connections,
        tailscale::delete_tailscale_connection,
        chaining::create_connection_chain,
        chaining::connect_connection_chain,
        chaining::disconnect_connection_chain,
        chaining::get_connection_chain,
        chaining::list_connection_chains,
        chaining::delete_connection_chain,
        chaining::update_connection_chain_layers,
        qr::generate_qr_code,
        qr::generate_qr_code_png,
        wmi::connect_wmi,
        wmi::disconnect_wmi,
        wmi::execute_wmi_query,
        wmi::get_wmi_session,
        wmi::list_wmi_sessions,
        wmi::get_wmi_classes,
        wmi::get_wmi_namespaces,
        rpc::connect_rpc,
        rpc::disconnect_rpc,
        rpc::call_rpc_method,
        rpc::get_rpc_session,
        rpc::list_rpc_sessions,
        rpc::discover_rpc_methods,
        rpc::batch_rpc_calls,
        meshcentral::connect_meshcentral,
        meshcentral::disconnect_meshcentral,
        meshcentral::get_meshcentral_devices,
        meshcentral::get_meshcentral_groups,
        meshcentral::execute_meshcentral_command,
        meshcentral::get_meshcentral_command_result,
        meshcentral::get_meshcentral_session,
        meshcentral::list_meshcentral_sessions,
        meshcentral::get_meshcentral_server_info,
        agent::connect_agent,
        agent::disconnect_agent,
        agent::get_agent_metrics,
        agent::get_agent_logs,
        agent::execute_agent_command,
        agent::get_agent_command_result,
        agent::get_agent_session,
        agent::list_agent_sessions,
        agent::update_agent_status,
        agent::get_agent_info,
        commander::connect_commander,
        commander::disconnect_commander,
        commander::execute_commander_command,
        commander::get_commander_command_result,
        commander::upload_commander_file,
        commander::download_commander_file,
        commander::get_commander_file_transfer,
        commander::list_commander_directory,
        commander::get_commander_session,
        commander::list_commander_sessions,
        commander::update_commander_status,
        commander::get_commander_system_info,
        aws_commands::connect_aws,
        aws_commands::disconnect_aws,
        aws_commands::list_aws_sessions,
        aws_commands::get_aws_session,
        aws_commands::list_ec2_instances,
        aws_commands::list_s3_buckets,
        aws_commands::get_s3_objects,
        aws_commands::list_rds_instances,
        aws_commands::list_lambda_functions,
        aws_commands::get_cloudwatch_metrics,
        aws_commands::execute_ec2_action,
        aws_commands::create_s3_bucket,
        aws_commands::invoke_lambda_function,
        aws_commands::list_iam_users,
        aws_commands::list_iam_roles,
        aws_commands::get_caller_identity,
        aws_commands::get_ssm_parameter,
        aws_commands::get_secret_value,
        aws_commands::list_secrets,
        aws_commands::list_ecs_clusters,
        aws_commands::list_ecs_services,
        aws_commands::list_hosted_zones,
        aws_commands::list_sns_topics,
        aws_commands::list_sqs_queues,
        aws_commands::list_cloudformation_stacks,
        vercel::connect_vercel,
        vercel::disconnect_vercel,
        vercel::list_vercel_sessions,
        vercel::get_vercel_session,
        vercel::list_vercel_projects,
        vercel::list_vercel_deployments,
        vercel::list_vercel_domains,
        vercel::list_vercel_teams,
        vercel::create_vercel_deployment,
        vercel::redeploy_vercel_project,
        vercel::add_vercel_domain,
        vercel::set_vercel_env_var,
        cloudflare::connect_cloudflare,
        cloudflare::disconnect_cloudflare,
        cloudflare::list_cloudflare_sessions,
        cloudflare::get_cloudflare_session,
        cloudflare::list_cloudflare_zones,
        cloudflare::list_cloudflare_dns_records,
        cloudflare::create_cloudflare_dns_record,
        cloudflare::update_cloudflare_dns_record,
        cloudflare::delete_cloudflare_dns_record,
        cloudflare::list_cloudflare_workers,
        cloudflare::deploy_cloudflare_worker,
        cloudflare::list_cloudflare_page_rules,
        cloudflare::get_cloudflare_analytics,
        cloudflare::purge_cloudflare_cache,
        openvpn::create_openvpn_connection_from_ovpn,
        openvpn::update_openvpn_connection_auth,
        openvpn::set_openvpn_connection_key_files,
        openvpn::validate_ovpn_config,
        ssh::update_ssh_session_auth,
        ssh::validate_ssh_key_file,
        ssh::test_ssh_connection,
        ssh::generate_ssh_key,
        // FIDO2 / Security Key commands
        ssh::check_fido2_support,
        ssh::list_fido2_devices,
        ssh::generate_sk_ssh_key,
        ssh::list_fido2_resident_credentials,
        ssh::detect_sk_key_type,
        ssh::validate_ssh_key_file_extended,
        ssh::get_terminal_buffer,
        ssh::clear_terminal_buffer,
        ssh::is_session_alive,
        ssh::get_shell_info,
        // SSH compression commands
        ssh::get_ssh_compression_info,
        ssh::update_ssh_compression_config,
        ssh::reset_ssh_compression_stats,
        ssh::list_ssh_compression_algorithms,
        ssh::should_compress_sftp,
        // SSH session recording commands
        ssh::start_session_recording,
        ssh::stop_session_recording,
        ssh::is_session_recording,
        ssh::get_recording_status,
        ssh::export_recording_asciicast,
        ssh::export_recording_script,
        ssh::list_active_recordings,
        // SSH terminal automation commands
        ssh::start_automation,
        ssh::stop_automation,
        ssh::is_automation_active,
        ssh::get_automation_status,
        ssh::list_active_automations,
        ssh::expect_and_send,
        ssh::execute_command_sequence,
        // SSH terminal regex highlighting commands
        ssh::set_highlight_rules,
        ssh::get_highlight_rules,
        ssh::add_highlight_rule,
        ssh::remove_highlight_rule,
        ssh::update_highlight_rule,
        ssh::clear_highlight_rules,
        ssh::get_highlight_status,
        ssh::list_highlighted_sessions,
        ssh::test_highlight_rules,
        // FTP over SSH tunnel commands
        ssh::setup_ftp_tunnel,
        ssh::stop_ftp_tunnel,
        ssh::get_ftp_tunnel_status,
        ssh::list_ftp_tunnels,
        ssh::list_session_ftp_tunnels,
        // RDP over SSH tunnel commands
        ssh::setup_rdp_tunnel,
        ssh::stop_rdp_tunnel,
        ssh::get_rdp_tunnel_status,
        ssh::list_rdp_tunnels,
        ssh::list_session_rdp_tunnels,
        ssh::setup_bulk_rdp_tunnels,
        ssh::stop_session_rdp_tunnels,
        ssh::generate_rdp_file,
        // VNC over SSH tunnel commands
        ssh::setup_vnc_tunnel,
        ssh::stop_vnc_tunnel,
        ssh::get_vnc_tunnel_status,
        ssh::list_vnc_tunnels,
        ssh::list_session_vnc_tunnels,
        // SSH3 (SSH over HTTP/3 QUIC) commands
        ssh3::connect_ssh3,
        ssh3::disconnect_ssh3,
        ssh3::send_ssh3_input,
        ssh3::resize_ssh3_shell,
        ssh3::execute_ssh3_command,
        ssh3::setup_ssh3_port_forward,
        ssh3::stop_ssh3_port_forward,
        ssh3::close_ssh3_channel,
        ssh3::get_ssh3_session_info,
        ssh3::list_ssh3_sessions,
        ssh3::test_ssh3_connection,
        // NOTE: pause_shell and resume_shell removed - buffer always captures full session
        ssh::get_ssh_host_key_info,
        ssh::diagnose_ssh_connection,
        // X11 forwarding
        ssh::enable_x11_forwarding,
        ssh::disable_x11_forwarding,
        ssh::get_x11_forward_status,
        ssh::list_x11_forwards,
        // ProxyCommand
        ssh::get_proxy_command_info,
        ssh::stop_proxy_command_cmd,
        ssh::test_proxy_command,
        ssh::expand_proxy_command,
        http::http_fetch,
        http::http_get,
        http::http_post,
        http::diagnose_http_connection,
        http::start_basic_auth_proxy,
        http::stop_basic_auth_proxy,
        http::list_proxy_sessions,
        http::get_proxy_session_details,
        http::get_proxy_request_log,
        http::clear_proxy_request_log,
        http::stop_all_proxy_sessions,
        http::check_proxy_health,
        http::restart_proxy_session,
        http::get_tls_certificate_info,
        // Web session recording commands
        http::start_web_recording,
        http::stop_web_recording,
        http::is_web_recording,
        http::get_web_recording_status,
        http::export_web_recording_har,
        passkey::passkey_is_available,
        passkey::passkey_authenticate,
        passkey::passkey_register,
        passkey::passkey_list_credentials,
        passkey::passkey_remove_credential,
        // Biometrics (native OS)
        biometrics::commands::biometric_check_availability,
        biometrics::commands::biometric_is_available,
        biometrics::commands::biometric_verify,
        biometrics::commands::biometric_verify_and_derive_key,
        // Vault (native OS keychain)
        vault::commands::vault_status,
        vault::commands::vault_is_available,
        vault::commands::vault_backend_name,
        vault::commands::vault_store_secret,
        vault::commands::vault_read_secret,
        vault::commands::vault_delete_secret,
        vault::commands::vault_ensure_dek,
        vault::commands::vault_envelope_encrypt,
        vault::commands::vault_envelope_decrypt,
        vault::commands::vault_biometric_store,
        vault::commands::vault_biometric_read,
        vault::commands::vault_needs_migration,
        vault::commands::vault_migrate,
        vault::commands::vault_load_storage,
        vault::commands::vault_save_storage,
        // Certificate generation commands
        cert_gen::cert_gen_self_signed,
        cert_gen::cert_gen_ca,
        cert_gen::cert_gen_csr,
        cert_gen::cert_sign_csr,
        cert_gen::cert_gen_issue,
        cert_gen::cert_gen_export_pem,
        cert_gen::cert_gen_export_der,
        cert_gen::cert_gen_export_chain,
        cert_gen::cert_gen_list,
        cert_gen::cert_gen_get,
        cert_gen::cert_gen_delete,
        cert_gen::cert_gen_list_csrs,
        cert_gen::cert_gen_delete_csr,
        cert_gen::cert_gen_update_label,
        cert_gen::cert_gen_get_chain,
        // Legacy crypto policy commands
        legacy_crypto::get_legacy_crypto_policy,
        legacy_crypto::set_legacy_crypto_policy,
        legacy_crypto::get_legacy_crypto_warnings,
        legacy_crypto::get_legacy_ssh_ciphers,
        legacy_crypto::get_legacy_ssh_kex,
        legacy_crypto::get_legacy_ssh_macs,
        legacy_crypto::get_legacy_ssh_host_key_algorithms,
        legacy_crypto::is_legacy_algorithm_allowed,
        // Certificate authentication commands
        cert_auth::parse_certificate,
        cert_auth::validate_certificate,
        cert_auth::authenticate_with_cert,
        cert_auth::register_certificate,
        cert_auth::list_certificates,
        cert_auth::revoke_certificate,
        // two_factor::enable_totp,
        // two_factor::verify_2fa,
        // two_factor::confirm_2fa_setup,
        // two_factor::regenerate_backup_codes,
        // two_factor::disable_2fa,
        // bearer_auth::authenticate_user,
        // bearer_auth::validate_token,
        // bearer_auth::refresh_token,
        // bearer_auth::initiate_oauth_flow,
        // bearer_auth::complete_oauth_flow,
        // bearer_auth::list_providers,
        // auto_lock::record_activity,
        // auto_lock::lock_application,
        // auto_lock::get_time_until_lock,
        // auto_lock::should_lock,
        // auto_lock::set_lock_timeout,
        // auto_lock::get_lock_timeout,
        // gpo::get_policy,
        // gpo::set_policy,
        // gpo::list_policies,
        // gpo::reset_policy,
        // gpo::export_policies,
        // gpo::import_policies,
        // login_detection::analyze_page,
        // login_detection::submit_login_form,
        telnet_commands::connect_telnet,
        telnet_commands::disconnect_telnet,
        telnet_commands::send_telnet_command,
        telnet_commands::send_telnet_raw,
        telnet_commands::send_telnet_break,
        telnet_commands::send_telnet_ayt,
        telnet_commands::resize_telnet,
        telnet_commands::get_telnet_session_info,
        telnet_commands::list_telnet_sessions,
        telnet_commands::disconnect_all_telnet,
        telnet_commands::is_telnet_connected,
        // ── Serial (COM / RS-232) ────────────────────────────────
        serial::serial_scan_ports,
        serial::serial_connect,
        serial::serial_disconnect,
        serial::serial_disconnect_all,
        serial::serial_send_raw,
        serial::serial_send_line,
        serial::serial_send_char,
        serial::serial_send_hex,
        serial::serial_send_break,
        serial::serial_set_dtr,
        serial::serial_set_rts,
        serial::serial_read_control_lines,
        serial::serial_reconfigure,
        serial::serial_set_line_ending,
        serial::serial_set_local_echo,
        serial::serial_flush,
        serial::serial_get_session_info,
        serial::serial_list_sessions,
        serial::serial_get_stats,
        serial::serial_send_at_command,
        serial::serial_get_modem_info,
        serial::serial_get_signal_quality,
        serial::serial_modem_init,
        serial::serial_modem_dial,
        serial::serial_modem_hangup,
        serial::serial_get_modem_profiles,
        serial::serial_start_logging,
        serial::serial_stop_logging,
        serial::serial_get_baud_rates,
        serial::serial_hex_to_bytes,
        serial::serial_bytes_to_hex,
        // rlogin::connect_rlogin,
        // rlogin::disconnect_rlogin,
        // rlogin::send_rlogin_command,
        // rlogin::get_rlogin_session_info,
        // rlogin::list_rlogin_sessions,
        // raw_socket::connect_raw_socket,
        // raw_socket::disconnect_raw_socket,
        // raw_socket::send_raw_socket_data,
        // raw_socket::get_raw_socket_session_info,
        // raw_socket::list_raw_socket_sessions,
    ]
}
