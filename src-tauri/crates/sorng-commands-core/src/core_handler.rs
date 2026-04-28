use crate::*;

pub fn is_command(command: &str) -> bool {
    matches!(
        command,
        "greet"
            | "open_devtools"
            | "open_url_external"
            | "get_launch_args"
            | "add_user"
            | "verify_user"
            | "list_users"
            | "remove_user"
            | "update_password"
            | "auth_hash_password"
            | "auth_verify_password"
            | "has_stored_data"
            | "is_storage_encrypted"
            | "save_data"
            | "load_data"
            | "clear_storage"
            | "set_storage_password"
            | "read_app_data"
            | "write_app_data"
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
            | "ssh_respond_to_host_key_prompt"
            | "start_shell"
            | "execute_command"
            | "execute_command_interactive"
            | "execute_script"
            | "transfer_file_scp"
            | "get_system_info"
            | "monitor_process"
            | "reattach_session"
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
            | "connect_rdp"
            | "disconnect_rdp"
            | "attach_rdp_session"
            | "detach_rdp_session"
            | "rdp_send_input"
            | "rdp_set_desktop_size"
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
            | "rdp_cert_trust_respond"
            | "rdp_clipboard_copy"
            | "rdp_clipboard_copy_files"
            | "rdp_clipboard_paste"
            | "rdp_toggle_feature"
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
            | "update_openvpn_connection"
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
            | "update_wireguard_connection"
            | "create_zerotier_connection"
            | "connect_zerotier"
            | "disconnect_zerotier"
            | "get_zerotier_connection"
            | "list_zerotier_connections"
            | "delete_zerotier_connection"
            | "update_zerotier_connection"
            | "create_tailscale_connection"
            | "connect_tailscale"
            | "disconnect_tailscale"
            | "get_tailscale_connection"
            | "list_tailscale_connections"
            | "delete_tailscale_connection"
            | "update_tailscale_connection"
            | "create_pptp_connection"
            | "connect_pptp"
            | "disconnect_pptp"
            | "get_pptp_connection"
            | "list_pptp_connections"
            | "delete_pptp_connection"
            | "update_pptp_connection"
            | "create_l2tp_connection"
            | "connect_l2tp"
            | "disconnect_l2tp"
            | "get_l2tp_connection"
            | "list_l2tp_connections"
            | "delete_l2tp_connection"
            | "update_l2tp_connection"
            | "create_ikev2_connection"
            | "connect_ikev2"
            | "disconnect_ikev2"
            | "get_ikev2_connection"
            | "list_ikev2_connections"
            | "delete_ikev2_connection"
            | "update_ikev2_connection"
            | "create_ipsec_connection"
            | "connect_ipsec"
            | "disconnect_ipsec"
            | "get_ipsec_connection"
            | "list_ipsec_connections"
            | "delete_ipsec_connection"
            | "update_ipsec_connection"
            | "create_sstp_connection"
            | "connect_sstp"
            | "disconnect_sstp"
            | "get_sstp_connection"
            | "list_sstp_connections"
            | "delete_sstp_connection"
            | "update_sstp_connection"
            | "create_connection_chain"
            | "connect_connection_chain"
            | "disconnect_connection_chain"
            | "get_connection_chain"
            | "list_connection_chains"
            | "delete_connection_chain"
            | "update_connection_chain_layers"
            | "ensure_vpn_connected"
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
            | "start_ssh3_shell"
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
            | "crypto_legacy_decrypt_cryptojs"
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
            | "close_splash"
            // ── SFTP (62) ────────────────────────────────────────────
            | "sftp_connect"
            | "sftp_disconnect"
            | "sftp_get_session_info"
            | "sftp_list_sessions"
            | "sftp_ping"
            | "sftp_set_directory"
            | "sftp_realpath"
            | "sftp_list_directory"
            | "sftp_mkdir"
            | "sftp_mkdir_p"
            | "sftp_rmdir"
            | "sftp_disk_usage"
            | "sftp_search"
            | "sftp_stat"
            | "sftp_lstat"
            | "sftp_rename"
            | "sftp_delete_file"
            | "sftp_delete_recursive"
            | "sftp_chmod"
            | "sftp_chown"
            | "sftp_create_symlink"
            | "sftp_read_link"
            | "sftp_touch"
            | "sftp_truncate"
            | "sftp_read_text_file"
            | "sftp_write_text_file"
            | "sftp_checksum"
            | "sftp_exists"
            | "sftp_upload"
            | "sftp_download"
            | "sftp_upload_begin"
            | "sftp_upload_chunk"
            | "sftp_upload_finish"
            | "sftp_upload_abort"
            | "sftp_batch_transfer"
            | "sftp_get_transfer_progress"
            | "sftp_list_active_transfers"
            | "sftp_cancel_transfer"
            | "sftp_pause_transfer"
            | "sftp_clear_completed_transfers"
            | "sftp_queue_add"
            | "sftp_queue_remove"
            | "sftp_queue_list"
            | "sftp_queue_status"
            | "sftp_queue_start"
            | "sftp_queue_stop"
            | "sftp_queue_retry_failed"
            | "sftp_queue_clear_done"
            | "sftp_queue_set_priority"
            | "sftp_watch_start"
            | "sftp_watch_stop"
            | "sftp_watch_list"
            | "sftp_sync_pull"
            | "sftp_sync_push"
            | "sftp_bookmark_add"
            | "sftp_bookmark_remove"
            | "sftp_bookmark_update"
            | "sftp_bookmark_list"
            | "sftp_bookmark_touch"
            | "sftp_bookmark_import"
            | "sftp_bookmark_export"
            | "sftp_diagnose"
            // ── RustDesk (92) ────────────────────────────────────────
            | "rustdesk_is_available"
            | "rustdesk_get_binary_info"
            | "rustdesk_detect_version"
            | "rustdesk_get_local_id"
            | "rustdesk_check_service_running"
            | "rustdesk_install_service"
            | "rustdesk_silent_install"
            | "rustdesk_set_permanent_password"
            | "rustdesk_configure_server"
            | "rustdesk_get_server_config"
            | "rustdesk_set_client_config"
            | "rustdesk_get_client_config"
            | "rustdesk_connect"
            | "rustdesk_connect_direct_ip"
            | "rustdesk_disconnect"
            | "rustdesk_shutdown"
            | "rustdesk_get_session"
            | "rustdesk_list_sessions"
            | "rustdesk_update_session_settings"
            | "rustdesk_send_input"
            | "rustdesk_active_session_count"
            | "rustdesk_create_tunnel"
            | "rustdesk_close_tunnel"
            | "rustdesk_list_tunnels"
            | "rustdesk_get_tunnel"
            | "rustdesk_start_file_transfer"
            | "rustdesk_upload_file"
            | "rustdesk_download_file"
            | "rustdesk_list_file_transfers"
            | "rustdesk_get_file_transfer"
            | "rustdesk_active_file_transfers"
            | "rustdesk_transfer_progress"
            | "rustdesk_record_file_transfer"
            | "rustdesk_update_transfer_progress"
            | "rustdesk_cancel_file_transfer"
            | "rustdesk_list_remote_files"
            | "rustdesk_file_transfer_stats"
            | "rustdesk_assign_via_cli"
            | "rustdesk_api_list_devices"
            | "rustdesk_api_get_device"
            | "rustdesk_api_device_action"
            | "rustdesk_api_assign_device"
            | "rustdesk_api_list_users"
            | "rustdesk_api_create_user"
            | "rustdesk_api_user_action"
            | "rustdesk_api_list_user_groups"
            | "rustdesk_api_create_user_group"
            | "rustdesk_api_update_user_group"
            | "rustdesk_api_delete_user_group"
            | "rustdesk_api_add_users_to_group"
            | "rustdesk_api_list_device_groups"
            | "rustdesk_api_create_device_group"
            | "rustdesk_api_update_device_group"
            | "rustdesk_api_delete_device_group"
            | "rustdesk_api_add_devices_to_group"
            | "rustdesk_api_remove_devices_from_group"
            | "rustdesk_api_list_strategies"
            | "rustdesk_api_get_strategy"
            | "rustdesk_api_enable_strategy"
            | "rustdesk_api_disable_strategy"
            | "rustdesk_api_assign_strategy"
            | "rustdesk_api_unassign_strategy"
            | "rustdesk_api_list_address_books"
            | "rustdesk_api_get_personal_address_book"
            | "rustdesk_api_create_address_book"
            | "rustdesk_api_update_address_book"
            | "rustdesk_api_delete_address_book"
            | "rustdesk_api_list_ab_peers"
            | "rustdesk_api_add_ab_peer"
            | "rustdesk_api_update_ab_peer"
            | "rustdesk_api_remove_ab_peer"
            | "rustdesk_api_import_ab_peers"
            | "rustdesk_api_list_ab_tags"
            | "rustdesk_api_add_ab_tag"
            | "rustdesk_api_delete_ab_tag"
            | "rustdesk_api_list_ab_rules"
            | "rustdesk_api_add_ab_rule"
            | "rustdesk_api_delete_ab_rule"
            | "rustdesk_api_connection_audits"
            | "rustdesk_api_file_audits"
            | "rustdesk_api_alarm_audits"
            | "rustdesk_api_console_audits"
            | "rustdesk_api_peer_audit_summary"
            | "rustdesk_api_operator_audit_summary"
            | "rustdesk_api_login"
            | "rustdesk_diagnostics_report"
            | "rustdesk_quick_health_check"
            | "rustdesk_server_health"
            | "rustdesk_server_latency"
            | "rustdesk_server_config_summary"
            | "rustdesk_client_config_summary"
            | "rustdesk_session_summary"
            // ── t5-e7: Connection Clone (secrets stripped by default) ─
            | "clone_connection"
            // ── t5-e7b: Probes (TCP / SSH / RDP) + bulk check run ──────
            | "tcp_probe"
            | "ssh_probe"
            | "rdp_probe"
            | "check_all_connections"
            | "cancel_check_run"
    ) || {
        #[cfg(feature = "vpn-softether")]
        {
            matches!(
                command,
                // ── SoftEther (7) ────────────────────────────────────────
                "create_softether_connection"
                    | "connect_softether"
                    | "disconnect_softether"
                    | "get_softether_connection"
                    | "list_softether_connections"
                    | "delete_softether_connection"
                    | "update_softether_connection"
            )
        }
        #[cfg(not(feature = "vpn-softether"))]
        {
            false
        }
    } || matches!(
        command,
        // ── SMB (16) ─────────────────────────────────────────────
        "smb_connect"
            | "smb_disconnect"
            | "smb_disconnect_all"
            | "smb_list_sessions"
            | "smb_get_session_info"
            | "smb_list_shares"
            | "smb_list_directory"
            | "smb_stat"
            | "smb_read_file"
            | "smb_write_file"
            | "smb_download_file"
            | "smb_upload_file"
            | "smb_mkdir"
            | "smb_rmdir"
            | "smb_delete_file"
            | "smb_rename"
            // ── SPICE (16) – t3-e55 ─────────────────────────────────
            | "connect_spice"
            | "disconnect_spice"
            | "disconnect_all_spice"
            | "is_spice_connected"
            | "get_spice_session_info"
            | "list_spice_sessions"
            | "get_spice_session_stats"
            | "send_spice_key_event"
            | "send_spice_pointer_event"
            | "send_spice_clipboard"
            | "request_spice_update"
            | "set_spice_resolution"
            | "spice_redirect_usb"
            | "spice_unredirect_usb"
            | "prune_spice_sessions"
            | "get_spice_session_count"
            // ── X2Go (15) – t3-e55 ──────────────────────────────────
            | "connect_x2go"
            | "suspend_x2go"
            | "terminate_x2go"
            | "disconnect_x2go"
            | "disconnect_all_x2go"
            | "is_x2go_connected"
            | "get_x2go_session_info"
            | "list_x2go_sessions"
            | "get_x2go_session_stats"
            | "send_x2go_clipboard"
            | "resize_x2go_display"
            | "mount_x2go_folder"
            | "unmount_x2go_folder"
            | "prune_x2go_sessions"
            | "get_x2go_session_count"
            // ── ARD (14) – t3-e55 ───────────────────────────────────
            | "connect_ard"
            | "disconnect_ard"
            | "send_ard_input"
            | "set_ard_clipboard"
            | "get_ard_clipboard"
            | "set_ard_curtain_mode"
            | "upload_ard_file"
            | "download_ard_file"
            | "list_ard_remote_dir"
            | "get_ard_session_info"
            | "list_ard_sessions"
            | "get_ard_stats"
            | "get_ard_logs"
            | "reconnect_ard"
            // ── NX (14) – t3-e55 ────────────────────────────────────
            | "connect_nx"
            | "disconnect_nx"
            | "disconnect_all_nx"
            | "suspend_nx"
            | "is_nx_connected"
            | "get_nx_session_info"
            | "list_nx_sessions"
            | "get_nx_session_stats"
            | "send_nx_key_event"
            | "send_nx_pointer_event"
            | "send_nx_clipboard"
            | "resize_nx_display"
            | "prune_nx_sessions"
            | "get_nx_session_count"
            // ── XDMCP (10) – t3-e55 ─────────────────────────────────
            | "connect_xdmcp"
            | "disconnect_xdmcp"
            | "disconnect_all_xdmcp"
            | "discover_xdmcp"
            | "is_xdmcp_connected"
            | "get_xdmcp_session_info"
            | "list_xdmcp_sessions"
            | "get_xdmcp_session_stats"
            | "prune_xdmcp_sessions"
            | "get_xdmcp_session_count"
            // ── sorng-openvpn dedicated crate (37) ───────────────────
            | "openvpn_create_connection"
            | "openvpn_connect"
            | "openvpn_connect_with_events"
            | "openvpn_create_and_connect"
            | "openvpn_disconnect"
            | "openvpn_disconnect_all"
            | "openvpn_remove_connection"
            | "openvpn_list_connections"
            | "openvpn_get_connection_info"
            | "openvpn_get_status"
            | "openvpn_get_stats"
            | "openvpn_send_auth"
            | "openvpn_send_otp"
            | "openvpn_import_config"
            | "openvpn_export_config"
            | "openvpn_validate_config"
            | "openvpn_get_config_templates"
            | "openvpn_set_routing_policy"
            | "openvpn_get_routing_policy"
            | "openvpn_capture_route_table"
            | "openvpn_set_dns_config"
            | "openvpn_get_dns_config"
            | "openvpn_check_dns_leak"
            | "openvpn_flush_dns"
            | "openvpn_check_health"
            | "openvpn_get_logs"
            | "openvpn_search_logs"
            | "openvpn_export_logs"
            | "openvpn_clear_logs"
            | "openvpn_mgmt_command"
            | "openvpn_detect_version"
            | "openvpn_find_binary"
            | "openvpn_get_binary_paths"
            | "openvpn_set_default_reconnect"
            | "openvpn_get_default_reconnect"
            | "openvpn_set_default_routing"
            | "openvpn_set_default_dns"
    ) || {
        // ── Serial / RS-232 (31) ─────────────────────────────────
        // Gated behind the `protocol-serial` (static/vendored) and
        // `protocol-serial-dynamic` (runtime driver probe, default
        // release) features per t3-e4. When neither is enabled the
        // commands are not registered and `is_command` returns false,
        // which routes the invoke to the "unknown command" fallback
        // with an actionable error.
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        {
            matches!(
                command,
                "serial_scan_ports"
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
        #[cfg(not(any(feature = "protocol-serial", feature = "protocol-serial-dynamic")))]
        {
            false
        }
    } || matches!(
        command,
        // ── TOTP (36) ─────────────────────────────────────────────
        "totp_add_entry"
            | "totp_create_entry"
            | "totp_get_entry"
            | "totp_update_entry"
            | "totp_remove_entry"
            | "totp_list_entries"
            | "totp_search_entries"
            | "totp_filter_entries"
            | "totp_generate_code"
            | "totp_generate_all_codes"
            | "totp_verify_code"
            | "totp_add_group"
            | "totp_list_groups"
            | "totp_remove_group"
            | "totp_move_entry_to_group"
            | "totp_toggle_favourite"
            | "totp_list_favourites"
            | "totp_reorder_entry"
            | "totp_import_entries"
            | "totp_import_as"
            | "totp_import_uri"
            | "totp_export_entries"
            | "totp_entry_qr_png"
            | "totp_entry_qr_data_uri"
            | "totp_entry_uri"
            | "totp_set_password"
            | "totp_lock"
            | "totp_unlock"
            | "totp_is_locked"
            | "totp_save_vault"
            | "totp_load_vault"
            | "totp_generate_secret"
            | "totp_password_strength"
            | "totp_deduplicate"
            | "totp_vault_stats"
            | "totp_all_tags"
            // ── t5-e9: stateless TOTP helpers ─────────────────────────
            | "totp_compute_code"
            | "totp_build_otpauth_uri"
            | "totp_generate_backup_codes"
    ) || {
        // ── PowerShell Remoting (53) ─────────────────────────────────
        // Gated behind the `ops` feature because `sorng_powershell` is
        // re-exported via `sorng-app-domains-ops`.
        #[cfg(feature = "ops")]
        {
            matches!(
                command,
                "ps_new_session"
                    | "ps_get_session"
                    | "ps_list_sessions"
                    | "ps_disconnect_session"
                    | "ps_reconnect_session"
                    | "ps_remove_session"
                    | "ps_remove_all_sessions"
                    | "ps_invoke_command"
                    | "ps_invoke_command_fanout"
                    | "ps_stop_command"
                    | "ps_enter_session"
                    | "ps_execute_interactive_line"
                    | "ps_tab_complete"
                    | "ps_exit_session"
                    | "ps_copy_to_session"
                    | "ps_copy_from_session"
                    | "ps_get_transfer_progress"
                    | "ps_cancel_transfer"
                    | "ps_list_transfers"
                    | "ps_new_cim_session"
                    | "ps_get_cim_instances"
                    | "ps_invoke_cim_method"
                    | "ps_remove_cim_session"
                    | "ps_test_dsc_configuration"
                    | "ps_get_dsc_configuration"
                    | "ps_start_dsc_configuration"
                    | "ps_get_dsc_resources"
                    | "ps_register_jea_endpoint"
                    | "ps_unregister_jea_endpoint"
                    | "ps_list_jea_endpoints"
                    | "ps_create_jea_role_capability"
                    | "ps_list_vms"
                    | "ps_invoke_command_vm"
                    | "ps_copy_to_vm"
                    | "ps_get_session_configurations"
                    | "ps_register_session_configuration"
                    | "ps_unregister_session_configuration"
                    | "ps_enable_session_configuration"
                    | "ps_disable_session_configuration"
                    | "ps_set_session_configuration"
                    | "ps_get_winrm_config"
                    | "ps_get_trusted_hosts"
                    | "ps_set_trusted_hosts"
                    | "ps_test_wsman"
                    | "ps_diagnose_connection"
                    | "ps_check_winrm_service"
                    | "ps_check_firewall_rules"
                    | "ps_measure_latency"
                    | "ps_get_certificate_info"
                    | "ps_get_stats"
                    | "ps_get_events"
                    | "ps_clear_events"
                    | "ps_cleanup"
            )
        }
        #[cfg(not(feature = "ops"))]
        {
            false
        }
    } || {
        // ── Backup Verify (35) ────────────────────────────────────────
        // Gated behind `ops` because `sorng_backup_verify` is re-exported
        // via `sorng-app-domains-ops`.
        #[cfg(feature = "ops")]
        {
            matches!(
                command,
                "backup_verify_get_overview"
                    | "backup_verify_list_policies"
                    | "backup_verify_get_policy"
                    | "backup_verify_create_policy"
                    | "backup_verify_update_policy"
                    | "backup_verify_delete_policy"
                    | "backup_verify_list_catalog"
                    | "backup_verify_get_catalog_entry"
                    | "backup_verify_add_catalog_entry"
                    | "backup_verify_delete_catalog_entry"
                    | "backup_verify_verify_backup"
                    | "backup_verify_trigger_backup"
                    | "backup_verify_cancel_job"
                    | "backup_verify_list_running_jobs"
                    | "backup_verify_list_queued_jobs"
                    | "backup_verify_get_job_history"
                    | "backup_verify_compute_sha256"
                    | "backup_verify_generate_manifest"
                    | "backup_verify_run_dr_drill"
                    | "backup_verify_get_drill_history"
                    | "backup_verify_generate_compliance_report"
                    | "backup_verify_get_compliance_history"
                    | "backup_verify_list_replicas"
                    | "backup_verify_add_replica"
                    | "backup_verify_remove_replica"
                    | "backup_verify_start_replication"
                    | "backup_verify_get_replication_status"
                    | "backup_verify_get_replication_overview"
                    | "backup_verify_enforce_retention"
                    | "backup_verify_get_retention_forecast"
                    | "backup_verify_set_immutability_lock"
                    | "backup_verify_check_immutability"
                    | "backup_verify_configure_notifications"
                    | "backup_verify_send_test_notification"
                    | "backup_verify_test_channel"
            )
        }
        #[cfg(not(feature = "ops"))]
        {
            false
        }
    }
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        app_shell_commands::greet,
        app_shell_commands::open_devtools,
        app_shell_commands::open_url_external,
        app_shell_commands::get_launch_args,
        app_auth_commands::add_user,
        app_auth_commands::verify_user,
        app_auth_commands::list_users,
        app_auth_commands::remove_user,
        app_auth_commands::update_password,
        app_auth_commands::auth_hash_password,
        app_auth_commands::auth_verify_password,
        storage_commands::has_stored_data,
        storage_commands::is_storage_encrypted,
        storage_commands::save_data,
        storage_commands::load_data,
        storage_commands::clear_storage,
        storage_commands::set_storage_password,
        storage_commands::read_app_data,
        storage_commands::write_app_data,
        // Trust store commands
        trust_store_commands::trust_verify_identity,
        trust_store_commands::trust_store_identity,
        trust_store_commands::trust_store_identity_with_reason,
        trust_store_commands::trust_remove_identity,
        trust_store_commands::trust_get_identity,
        trust_store_commands::trust_get_all_records,
        trust_store_commands::trust_clear_all,
        trust_store_commands::trust_update_nickname,
        trust_store_commands::trust_get_policy,
        trust_store_commands::trust_set_policy,
        trust_store_commands::trust_get_policy_config,
        trust_store_commands::trust_set_policy_config,
        trust_store_commands::trust_set_host_policy,
        trust_store_commands::trust_revoke_identity,
        trust_store_commands::trust_reinstate_identity,
        trust_store_commands::trust_set_record_tags,
        trust_store_commands::trust_get_identity_history,
        trust_store_commands::trust_get_verification_stats,
        trust_store_commands::trust_get_summary,
        ssh_commands::connect_ssh,
        ssh_commands::ssh_respond_to_host_key_prompt,
        ssh_commands::start_shell,
        ssh_commands::execute_command,
        ssh_commands::execute_command_interactive,
        ssh_commands::execute_script,
        ssh_commands::transfer_file_scp,
        ssh_commands::get_system_info,
        ssh_commands::monitor_process,
        ssh_commands::reattach_session,
        ssh_commands::send_ssh_input,
        ssh_commands::resize_ssh_shell,
        ssh_commands::setup_port_forward,
        ssh_commands::list_directory,
        ssh_commands::upload_file,
        ssh_commands::download_file,
        ssh_commands::disconnect_ssh,
        ssh_commands::get_session_info,
        ssh_commands::list_sessions,
        ssh_commands::validate_mixed_chain,
        ssh_commands::jump_hosts_to_mixed_chain,
        ssh_commands::proxy_chain_to_mixed_chain,
        ssh_commands::test_mixed_chain_connection,
        rdp_commands::connect_rdp,
        rdp_commands::disconnect_rdp,
        rdp_commands::attach_rdp_session,
        rdp_commands::detach_rdp_session,
        rdp_commands::rdp_send_input,
        rdp_commands::rdp_set_desktop_size,
        rdp_commands::rdp_get_frame_data,
        rdp_commands::get_rdp_session_info,
        rdp_commands::list_rdp_sessions,
        rdp_commands::get_rdp_stats,
        rdp_commands::detect_keyboard_layout,
        rdp_commands::diagnose_rdp_connection,
        rdp_commands::rdp_sign_out,
        rdp_commands::rdp_force_reboot,
        rdp_commands::reconnect_rdp_session,
        rdp_commands::rdp_get_thumbnail,
        rdp_commands::rdp_save_screenshot,
        rdp_commands::rdp_cert_trust_respond,
        rdp_commands::rdp_clipboard_copy,
        rdp_commands::rdp_clipboard_copy_files,
        rdp_commands::rdp_clipboard_paste,
        rdp_commands::rdp_toggle_feature,
        rdp_commands::get_rdp_logs,
        vnc_commands::connect_vnc,
        vnc_commands::disconnect_vnc,
        vnc_commands::disconnect_all_vnc,
        vnc_commands::is_vnc_connected,
        vnc_commands::get_vnc_session_info,
        vnc_commands::list_vnc_sessions,
        vnc_commands::get_vnc_session_stats,
        vnc_commands::send_vnc_key_event,
        vnc_commands::send_vnc_pointer_event,
        vnc_commands::send_vnc_clipboard,
        vnc_commands::request_vnc_update,
        vnc_commands::set_vnc_pixel_format,
        vnc_commands::prune_vnc_sessions,
        vnc_commands::get_vnc_session_count,
        anydesk_commands::launch_anydesk,
        anydesk_commands::disconnect_anydesk,
        anydesk_commands::get_anydesk_session,
        anydesk_commands::list_anydesk_sessions,
        db_commands::connect_mysql,
        db_commands::execute_query,
        db_commands::disconnect_db,
        db_commands::get_databases,
        db_commands::get_tables,
        db_commands::get_table_structure,
        db_commands::create_database,
        db_commands::drop_database,
        db_commands::create_table,
        db_commands::drop_table,
        db_commands::get_table_data,
        db_commands::insert_row,
        db_commands::update_row,
        db_commands::delete_row,
        db_commands::export_table,
        db_commands::export_table_chunked,
        db_commands::export_database,
        db_commands::export_database_chunked,
        db_commands::import_sql,
        db_commands::import_csv,
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
        network_commands::ping_host,
        network_commands::ping_host_detailed,
        network_commands::ping_gateway,
        network_commands::check_port,
        network_commands::dns_lookup,
        network_commands::classify_ip,
        network_commands::traceroute,
        network_commands::scan_network,
        network_commands::scan_network_comprehensive,
        network_commands::tcp_connection_timing,
        network_commands::check_mtu,
        network_commands::detect_icmp_blockade,
        network_commands::check_tls,
        network_commands::fingerprint_service,
        network_commands::detect_asymmetric_routing,
        network_commands::probe_udp_port,
        network_commands::lookup_ip_geo,
        network_commands::detect_proxy_leakage,
        security_commands::generate_totp_secret,
        security_commands::verify_totp,
        wol_commands::wake_on_lan,
        wol_commands::wake_multiple_hosts,
        wol_commands::discover_wol_devices,
        wol_commands::add_wol_schedule,
        wol_commands::remove_wol_schedule,
        wol_commands::list_wol_schedules,
        wol_commands::update_wol_schedule,
        ssh_commands::execute_user_script,
        openvpn_commands::create_openvpn_connection,
        openvpn_commands::connect_openvpn,
        openvpn_commands::disconnect_openvpn,
        openvpn_commands::get_openvpn_connection,
        openvpn_commands::list_openvpn_connections,
        openvpn_commands::delete_openvpn_connection,
        openvpn_commands::get_openvpn_status,
        openvpn_commands::update_openvpn_connection,
        proxy_commands::create_proxy_connection,
        proxy_commands::connect_via_proxy,
        proxy_commands::disconnect_proxy,
        proxy_commands::get_proxy_connection,
        proxy_commands::list_proxy_connections,
        proxy_commands::delete_proxy_connection,
        proxy_commands::create_proxy_chain,
        proxy_commands::connect_proxy_chain,
        proxy_commands::disconnect_proxy_chain,
        proxy_commands::get_proxy_chain,
        proxy_commands::list_proxy_chains,
        proxy_commands::delete_proxy_chain,
        proxy_commands::get_proxy_chain_health,
        wireguard_commands::create_wireguard_connection,
        wireguard_commands::connect_wireguard,
        wireguard_commands::disconnect_wireguard,
        wireguard_commands::get_wireguard_connection,
        wireguard_commands::list_wireguard_connections,
        wireguard_commands::delete_wireguard_connection,
        wireguard_commands::update_wireguard_connection,
        zerotier_commands::create_zerotier_connection,
        zerotier_commands::connect_zerotier,
        zerotier_commands::disconnect_zerotier,
        zerotier_commands::get_zerotier_connection,
        zerotier_commands::list_zerotier_connections,
        zerotier_commands::delete_zerotier_connection,
        zerotier_commands::update_zerotier_connection,
        tailscale_commands::create_tailscale_connection,
        tailscale_commands::connect_tailscale,
        tailscale_commands::disconnect_tailscale,
        tailscale_commands::get_tailscale_connection,
        tailscale_commands::list_tailscale_connections,
        tailscale_commands::delete_tailscale_connection,
        tailscale_commands::update_tailscale_connection,
        pptp_commands::create_pptp_connection,
        pptp_commands::connect_pptp,
        pptp_commands::disconnect_pptp,
        pptp_commands::get_pptp_connection,
        pptp_commands::list_pptp_connections,
        pptp_commands::delete_pptp_connection,
        pptp_commands::update_pptp_connection,
        l2tp_commands::create_l2tp_connection,
        l2tp_commands::connect_l2tp,
        l2tp_commands::disconnect_l2tp,
        l2tp_commands::get_l2tp_connection,
        l2tp_commands::list_l2tp_connections,
        l2tp_commands::delete_l2tp_connection,
        l2tp_commands::update_l2tp_connection,
        ikev2_commands::create_ikev2_connection,
        ikev2_commands::connect_ikev2,
        ikev2_commands::disconnect_ikev2,
        ikev2_commands::get_ikev2_connection,
        ikev2_commands::list_ikev2_connections,
        ikev2_commands::delete_ikev2_connection,
        ikev2_commands::update_ikev2_connection,
        ipsec_commands::create_ipsec_connection,
        ipsec_commands::connect_ipsec,
        ipsec_commands::disconnect_ipsec,
        ipsec_commands::get_ipsec_connection,
        ipsec_commands::list_ipsec_connections,
        ipsec_commands::delete_ipsec_connection,
        ipsec_commands::update_ipsec_connection,
        sstp_commands::create_sstp_connection,
        sstp_commands::connect_sstp,
        sstp_commands::disconnect_sstp,
        sstp_commands::get_sstp_connection,
        sstp_commands::list_sstp_connections,
        sstp_commands::delete_sstp_connection,
        sstp_commands::update_sstp_connection,
        chaining_commands::create_connection_chain,
        chaining_commands::connect_connection_chain,
        chaining_commands::disconnect_connection_chain,
        chaining_commands::get_connection_chain,
        chaining_commands::list_connection_chains,
        chaining_commands::delete_connection_chain,
        chaining_commands::update_connection_chain_layers,
        chaining_commands::ensure_vpn_connected,
        qr_commands::generate_qr_code,
        qr_commands::generate_qr_code_png,
        wmi_commands::connect_wmi,
        wmi_commands::disconnect_wmi,
        wmi_commands::execute_wmi_query,
        wmi_commands::get_wmi_session,
        wmi_commands::list_wmi_sessions,
        wmi_commands::get_wmi_classes,
        wmi_commands::get_wmi_namespaces,
        rpc_commands::connect_rpc,
        rpc_commands::disconnect_rpc,
        rpc_commands::call_rpc_method,
        rpc_commands::get_rpc_session,
        rpc_commands::list_rpc_sessions,
        rpc_commands::discover_rpc_methods,
        rpc_commands::batch_rpc_calls,
        meshcentral_commands::connect_meshcentral,
        meshcentral_commands::disconnect_meshcentral,
        meshcentral_commands::get_meshcentral_devices,
        meshcentral_commands::get_meshcentral_groups,
        meshcentral_commands::execute_meshcentral_command,
        meshcentral_commands::get_meshcentral_command_result,
        meshcentral_commands::get_meshcentral_session,
        meshcentral_commands::list_meshcentral_sessions,
        meshcentral_commands::get_meshcentral_server_info,
        agent_commands::connect_agent,
        agent_commands::disconnect_agent,
        agent_commands::get_agent_metrics,
        agent_commands::get_agent_logs,
        agent_commands::execute_agent_command,
        agent_commands::get_agent_command_result,
        agent_commands::get_agent_session,
        agent_commands::list_agent_sessions,
        agent_commands::update_agent_status,
        agent_commands::get_agent_info,
        commander_commands::connect_commander,
        commander_commands::disconnect_commander,
        commander_commands::execute_commander_command,
        commander_commands::get_commander_command_result,
        commander_commands::upload_commander_file,
        commander_commands::download_commander_file,
        commander_commands::get_commander_file_transfer,
        commander_commands::list_commander_directory,
        commander_commands::get_commander_session,
        commander_commands::list_commander_sessions,
        commander_commands::update_commander_status,
        commander_commands::get_commander_system_info,
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
        vercel_commands::connect_vercel,
        vercel_commands::disconnect_vercel,
        vercel_commands::list_vercel_sessions,
        vercel_commands::get_vercel_session,
        vercel_commands::list_vercel_projects,
        vercel_commands::list_vercel_deployments,
        vercel_commands::list_vercel_domains,
        vercel_commands::list_vercel_teams,
        vercel_commands::create_vercel_deployment,
        vercel_commands::redeploy_vercel_project,
        vercel_commands::add_vercel_domain,
        vercel_commands::set_vercel_env_var,
        cloudflare_commands::connect_cloudflare,
        cloudflare_commands::disconnect_cloudflare,
        cloudflare_commands::list_cloudflare_sessions,
        cloudflare_commands::get_cloudflare_session,
        cloudflare_commands::list_cloudflare_zones,
        cloudflare_commands::list_cloudflare_dns_records,
        cloudflare_commands::create_cloudflare_dns_record,
        cloudflare_commands::update_cloudflare_dns_record,
        cloudflare_commands::delete_cloudflare_dns_record,
        cloudflare_commands::list_cloudflare_workers,
        cloudflare_commands::deploy_cloudflare_worker,
        cloudflare_commands::list_cloudflare_page_rules,
        cloudflare_commands::get_cloudflare_analytics,
        cloudflare_commands::purge_cloudflare_cache,
        openvpn_commands::create_openvpn_connection_from_ovpn,
        openvpn_commands::update_openvpn_connection_auth,
        openvpn_commands::set_openvpn_connection_key_files,
        openvpn_commands::validate_ovpn_config,
        ssh_commands::update_ssh_session_auth,
        ssh_commands::validate_ssh_key_file,
        ssh_commands::test_ssh_connection,
        ssh_commands::generate_ssh_key,
        // FIDO2 / Security Key commands
        ssh_commands::check_fido2_support,
        ssh_commands::list_fido2_devices,
        ssh_commands::generate_sk_ssh_key,
        ssh_commands::list_fido2_resident_credentials,
        ssh_commands::detect_sk_key_type,
        ssh_commands::validate_ssh_key_file_extended,
        ssh_commands::get_terminal_buffer,
        ssh_commands::clear_terminal_buffer,
        ssh_commands::is_session_alive,
        ssh_commands::get_shell_info,
        // SSH compression commands
        ssh_commands::get_ssh_compression_info,
        ssh_commands::update_ssh_compression_config,
        ssh_commands::reset_ssh_compression_stats,
        ssh_commands::list_ssh_compression_algorithms,
        ssh_commands::should_compress_sftp,
        // SSH session recording commands
        ssh_commands::start_session_recording,
        ssh_commands::stop_session_recording,
        ssh_commands::is_session_recording,
        ssh_commands::get_recording_status,
        ssh_commands::export_recording_asciicast,
        ssh_commands::export_recording_script,
        ssh_commands::list_active_recordings,
        // SSH terminal automation commands
        ssh_commands::start_automation,
        ssh_commands::stop_automation,
        ssh_commands::is_automation_active,
        ssh_commands::get_automation_status,
        ssh_commands::list_active_automations,
        ssh_commands::expect_and_send,
        ssh_commands::execute_command_sequence,
        // SSH terminal regex highlighting commands
        ssh_commands::set_highlight_rules,
        ssh_commands::get_highlight_rules,
        ssh_commands::add_highlight_rule,
        ssh_commands::remove_highlight_rule,
        ssh_commands::update_highlight_rule,
        ssh_commands::clear_highlight_rules,
        ssh_commands::get_highlight_status,
        ssh_commands::list_highlighted_sessions,
        ssh_commands::test_highlight_rules,
        // FTP over SSH tunnel commands
        ssh_commands::setup_ftp_tunnel,
        ssh_commands::stop_ftp_tunnel,
        ssh_commands::get_ftp_tunnel_status,
        ssh_commands::list_ftp_tunnels,
        ssh_commands::list_session_ftp_tunnels,
        // RDP over SSH tunnel commands
        ssh_commands::setup_rdp_tunnel,
        ssh_commands::stop_rdp_tunnel,
        ssh_commands::get_rdp_tunnel_status,
        ssh_commands::list_rdp_tunnels,
        ssh_commands::list_session_rdp_tunnels,
        ssh_commands::setup_bulk_rdp_tunnels,
        ssh_commands::stop_session_rdp_tunnels,
        ssh_commands::generate_rdp_file,
        // VNC over SSH tunnel commands
        ssh_commands::setup_vnc_tunnel,
        ssh_commands::stop_vnc_tunnel,
        ssh_commands::get_vnc_tunnel_status,
        ssh_commands::list_vnc_tunnels,
        ssh_commands::list_session_vnc_tunnels,
        // SSH3 (SSH over HTTP/3 QUIC) commands
        ssh_commands::connect_ssh3,
        ssh_commands::disconnect_ssh3,
        ssh_commands::start_ssh3_shell,
        ssh_commands::send_ssh3_input,
        ssh_commands::resize_ssh3_shell,
        ssh_commands::execute_ssh3_command,
        ssh_commands::setup_ssh3_port_forward,
        ssh_commands::stop_ssh3_port_forward,
        ssh_commands::close_ssh3_channel,
        ssh_commands::get_ssh3_session_info,
        ssh_commands::list_ssh3_sessions,
        ssh_commands::test_ssh3_connection,
        // NOTE: pause_shell and resume_shell removed - buffer always captures full session
        ssh_commands::get_ssh_host_key_info,
        ssh_commands::diagnose_ssh_connection,
        // X11 forwarding
        ssh_commands::enable_x11_forwarding,
        ssh_commands::disable_x11_forwarding,
        ssh_commands::get_x11_forward_status,
        ssh_commands::list_x11_forwards,
        // ProxyCommand
        ssh_commands::get_proxy_command_info,
        ssh_commands::stop_proxy_command_cmd,
        ssh_commands::test_proxy_command,
        ssh_commands::expand_proxy_command,
        http_commands::http_fetch,
        http_commands::http_get,
        http_commands::http_post,
        http_commands::diagnose_http_connection,
        http_commands::start_basic_auth_proxy,
        http_commands::stop_basic_auth_proxy,
        http_commands::list_proxy_sessions,
        http_commands::get_proxy_session_details,
        http_commands::get_proxy_request_log,
        http_commands::clear_proxy_request_log,
        http_commands::stop_all_proxy_sessions,
        http_commands::check_proxy_health,
        http_commands::restart_proxy_session,
        http_commands::get_tls_certificate_info,
        // Web session recording commands
        http_commands::start_web_recording,
        http_commands::stop_web_recording,
        http_commands::is_web_recording,
        http_commands::get_web_recording_status,
        http_commands::export_web_recording_har,
        passkey_commands::passkey_is_available,
        passkey_commands::passkey_authenticate,
        passkey_commands::passkey_register,
        passkey_commands::passkey_list_credentials,
        passkey_commands::passkey_remove_credential,
        // Biometrics (native OS)
        biometrics_commands::biometric_check_availability,
        biometrics_commands::biometric_is_available,
        biometrics_commands::biometric_verify,
        biometrics_commands::biometric_verify_and_derive_key,
        // Vault (native OS keychain)
        vault_commands::vault_status,
        vault_commands::vault_is_available,
        vault_commands::vault_backend_name,
        vault_commands::vault_store_secret,
        vault_commands::vault_read_secret,
        vault_commands::vault_delete_secret,
        vault_commands::vault_ensure_dek,
        vault_commands::vault_envelope_encrypt,
        vault_commands::vault_envelope_decrypt,
        vault_commands::vault_biometric_store,
        vault_commands::vault_biometric_read,
        vault_commands::vault_needs_migration,
        vault_commands::vault_migrate,
        vault_commands::vault_load_storage,
        vault_commands::vault_save_storage,
        // Certificate generation commands
        cert_gen_commands::cert_gen_self_signed,
        cert_gen_commands::cert_gen_ca,
        cert_gen_commands::cert_gen_csr,
        cert_gen_commands::cert_sign_csr,
        cert_gen_commands::cert_gen_issue,
        cert_gen_commands::cert_gen_export_pem,
        cert_gen_commands::cert_gen_export_der,
        cert_gen_commands::cert_gen_export_chain,
        cert_gen_commands::cert_gen_list,
        cert_gen_commands::cert_gen_get,
        cert_gen_commands::cert_gen_delete,
        cert_gen_commands::cert_gen_list_csrs,
        cert_gen_commands::cert_gen_delete_csr,
        cert_gen_commands::cert_gen_update_label,
        cert_gen_commands::cert_gen_get_chain,
        // Legacy crypto policy commands
        legacy_crypto_commands::get_legacy_crypto_policy,
        legacy_crypto_commands::set_legacy_crypto_policy,
        legacy_crypto_commands::get_legacy_crypto_warnings,
        legacy_crypto_commands::get_legacy_ssh_ciphers,
        legacy_crypto_commands::get_legacy_ssh_kex,
        legacy_crypto_commands::get_legacy_ssh_macs,
        legacy_crypto_commands::get_legacy_ssh_host_key_algorithms,
        legacy_crypto_commands::is_legacy_algorithm_allowed,
        cryptojs_compat_commands::crypto_legacy_decrypt_cryptojs,
        // Certificate authentication commands
        cert_auth_commands::parse_certificate,
        cert_auth_commands::validate_certificate,
        cert_auth_commands::authenticate_with_cert,
        cert_auth_commands::register_certificate,
        cert_auth_commands::list_certificates,
        cert_auth_commands::revoke_certificate,
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
        // ── Serial (COM / RS-232) — gated on protocol-serial{,-dynamic} (t3-e4) ──
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_scan_ports,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_connect,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_disconnect,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_disconnect_all,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_raw,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_line,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_char,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_hex,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_break,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_dtr,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_rts,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_read_control_lines,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_reconfigure,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_line_ending,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_local_echo,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_flush,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_session_info,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_list_sessions,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_stats,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_at_command,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_modem_info,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_signal_quality,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_init,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_dial,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_hangup,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_modem_profiles,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_start_logging,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_stop_logging,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_baud_rates,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_hex_to_bytes,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_bytes_to_hex,
        splash::close_splash,
        // ── SFTP (62) ────────────────────────────────────────────────
        sftp_commands::sftp_connect,
        sftp_commands::sftp_disconnect,
        sftp_commands::sftp_get_session_info,
        sftp_commands::sftp_list_sessions,
        sftp_commands::sftp_ping,
        sftp_commands::sftp_set_directory,
        sftp_commands::sftp_realpath,
        sftp_commands::sftp_list_directory,
        sftp_commands::sftp_mkdir,
        sftp_commands::sftp_mkdir_p,
        sftp_commands::sftp_rmdir,
        sftp_commands::sftp_disk_usage,
        sftp_commands::sftp_search,
        sftp_commands::sftp_stat,
        sftp_commands::sftp_lstat,
        sftp_commands::sftp_rename,
        sftp_commands::sftp_delete_file,
        sftp_commands::sftp_delete_recursive,
        sftp_commands::sftp_chmod,
        sftp_commands::sftp_chown,
        sftp_commands::sftp_create_symlink,
        sftp_commands::sftp_read_link,
        sftp_commands::sftp_touch,
        sftp_commands::sftp_truncate,
        sftp_commands::sftp_read_text_file,
        sftp_commands::sftp_write_text_file,
        sftp_commands::sftp_checksum,
        sftp_commands::sftp_exists,
        sftp_commands::sftp_upload,
        sftp_commands::sftp_download,
        sftp_commands::sftp_upload_begin,
        sftp_commands::sftp_upload_chunk,
        sftp_commands::sftp_upload_finish,
        sftp_commands::sftp_upload_abort,
        sftp_commands::sftp_batch_transfer,
        sftp_commands::sftp_get_transfer_progress,
        sftp_commands::sftp_list_active_transfers,
        sftp_commands::sftp_cancel_transfer,
        sftp_commands::sftp_pause_transfer,
        sftp_commands::sftp_clear_completed_transfers,
        sftp_commands::sftp_queue_add,
        sftp_commands::sftp_queue_remove,
        sftp_commands::sftp_queue_list,
        sftp_commands::sftp_queue_status,
        sftp_commands::sftp_queue_start,
        sftp_commands::sftp_queue_stop,
        sftp_commands::sftp_queue_retry_failed,
        sftp_commands::sftp_queue_clear_done,
        sftp_commands::sftp_queue_set_priority,
        sftp_commands::sftp_watch_start,
        sftp_commands::sftp_watch_stop,
        sftp_commands::sftp_watch_list,
        sftp_commands::sftp_sync_pull,
        sftp_commands::sftp_sync_push,
        sftp_commands::sftp_bookmark_add,
        sftp_commands::sftp_bookmark_remove,
        sftp_commands::sftp_bookmark_update,
        sftp_commands::sftp_bookmark_list,
        sftp_commands::sftp_bookmark_touch,
        sftp_commands::sftp_bookmark_import,
        sftp_commands::sftp_bookmark_export,
        sftp_commands::sftp_diagnose,
        // ── RustDesk (92) ────────────────────────────────────────────
        rustdesk_commands::rustdesk_is_available,
        rustdesk_commands::rustdesk_get_binary_info,
        rustdesk_commands::rustdesk_detect_version,
        rustdesk_commands::rustdesk_get_local_id,
        rustdesk_commands::rustdesk_check_service_running,
        rustdesk_commands::rustdesk_install_service,
        rustdesk_commands::rustdesk_silent_install,
        rustdesk_commands::rustdesk_set_permanent_password,
        rustdesk_commands::rustdesk_configure_server,
        rustdesk_commands::rustdesk_get_server_config,
        rustdesk_commands::rustdesk_set_client_config,
        rustdesk_commands::rustdesk_get_client_config,
        rustdesk_commands::rustdesk_connect,
        rustdesk_commands::rustdesk_connect_direct_ip,
        rustdesk_commands::rustdesk_disconnect,
        rustdesk_commands::rustdesk_shutdown,
        rustdesk_commands::rustdesk_get_session,
        rustdesk_commands::rustdesk_list_sessions,
        rustdesk_commands::rustdesk_update_session_settings,
        rustdesk_commands::rustdesk_send_input,
        rustdesk_commands::rustdesk_active_session_count,
        rustdesk_commands::rustdesk_create_tunnel,
        rustdesk_commands::rustdesk_close_tunnel,
        rustdesk_commands::rustdesk_list_tunnels,
        rustdesk_commands::rustdesk_get_tunnel,
        rustdesk_commands::rustdesk_start_file_transfer,
        rustdesk_commands::rustdesk_upload_file,
        rustdesk_commands::rustdesk_download_file,
        rustdesk_commands::rustdesk_list_file_transfers,
        rustdesk_commands::rustdesk_get_file_transfer,
        rustdesk_commands::rustdesk_active_file_transfers,
        rustdesk_commands::rustdesk_transfer_progress,
        rustdesk_commands::rustdesk_record_file_transfer,
        rustdesk_commands::rustdesk_update_transfer_progress,
        rustdesk_commands::rustdesk_cancel_file_transfer,
        rustdesk_commands::rustdesk_list_remote_files,
        rustdesk_commands::rustdesk_file_transfer_stats,
        rustdesk_commands::rustdesk_assign_via_cli,
        rustdesk_commands::rustdesk_api_list_devices,
        rustdesk_commands::rustdesk_api_get_device,
        rustdesk_commands::rustdesk_api_device_action,
        rustdesk_commands::rustdesk_api_assign_device,
        rustdesk_commands::rustdesk_api_list_users,
        rustdesk_commands::rustdesk_api_create_user,
        rustdesk_commands::rustdesk_api_user_action,
        rustdesk_commands::rustdesk_api_list_user_groups,
        rustdesk_commands::rustdesk_api_create_user_group,
        rustdesk_commands::rustdesk_api_update_user_group,
        rustdesk_commands::rustdesk_api_delete_user_group,
        rustdesk_commands::rustdesk_api_add_users_to_group,
        rustdesk_commands::rustdesk_api_list_device_groups,
        rustdesk_commands::rustdesk_api_create_device_group,
        rustdesk_commands::rustdesk_api_update_device_group,
        rustdesk_commands::rustdesk_api_delete_device_group,
        rustdesk_commands::rustdesk_api_add_devices_to_group,
        rustdesk_commands::rustdesk_api_remove_devices_from_group,
        rustdesk_commands::rustdesk_api_list_strategies,
        rustdesk_commands::rustdesk_api_get_strategy,
        rustdesk_commands::rustdesk_api_enable_strategy,
        rustdesk_commands::rustdesk_api_disable_strategy,
        rustdesk_commands::rustdesk_api_assign_strategy,
        rustdesk_commands::rustdesk_api_unassign_strategy,
        rustdesk_commands::rustdesk_api_list_address_books,
        rustdesk_commands::rustdesk_api_get_personal_address_book,
        rustdesk_commands::rustdesk_api_create_address_book,
        rustdesk_commands::rustdesk_api_update_address_book,
        rustdesk_commands::rustdesk_api_delete_address_book,
        rustdesk_commands::rustdesk_api_list_ab_peers,
        rustdesk_commands::rustdesk_api_add_ab_peer,
        rustdesk_commands::rustdesk_api_update_ab_peer,
        rustdesk_commands::rustdesk_api_remove_ab_peer,
        rustdesk_commands::rustdesk_api_import_ab_peers,
        rustdesk_commands::rustdesk_api_list_ab_tags,
        rustdesk_commands::rustdesk_api_add_ab_tag,
        rustdesk_commands::rustdesk_api_delete_ab_tag,
        rustdesk_commands::rustdesk_api_list_ab_rules,
        rustdesk_commands::rustdesk_api_add_ab_rule,
        rustdesk_commands::rustdesk_api_delete_ab_rule,
        rustdesk_commands::rustdesk_api_connection_audits,
        rustdesk_commands::rustdesk_api_file_audits,
        rustdesk_commands::rustdesk_api_alarm_audits,
        rustdesk_commands::rustdesk_api_console_audits,
        rustdesk_commands::rustdesk_api_peer_audit_summary,
        rustdesk_commands::rustdesk_api_operator_audit_summary,
        rustdesk_commands::rustdesk_api_login,
        rustdesk_commands::rustdesk_diagnostics_report,
        rustdesk_commands::rustdesk_quick_health_check,
        rustdesk_commands::rustdesk_server_health,
        rustdesk_commands::rustdesk_server_latency,
        rustdesk_commands::rustdesk_server_config_summary,
        rustdesk_commands::rustdesk_client_config_summary,
        rustdesk_commands::rustdesk_session_summary,
        // ── SoftEther (7) ────────────────────────────────────────────
        #[cfg(feature = "vpn-softether")]
        softether_commands::create_softether_connection,
        #[cfg(feature = "vpn-softether")]
        softether_commands::connect_softether,
        #[cfg(feature = "vpn-softether")]
        softether_commands::disconnect_softether,
        #[cfg(feature = "vpn-softether")]
        softether_commands::get_softether_connection,
        #[cfg(feature = "vpn-softether")]
        softether_commands::list_softether_connections,
        #[cfg(feature = "vpn-softether")]
        softether_commands::delete_softether_connection,
        #[cfg(feature = "vpn-softether")]
        softether_commands::update_softether_connection,
        // ── SMB (16) ─────────────────────────────────────────────────
        smb_commands::smb_connect,
        smb_commands::smb_disconnect,
        smb_commands::smb_disconnect_all,
        smb_commands::smb_list_sessions,
        smb_commands::smb_get_session_info,
        smb_commands::smb_list_shares,
        smb_commands::smb_list_directory,
        smb_commands::smb_stat,
        smb_commands::smb_read_file,
        smb_commands::smb_write_file,
        smb_commands::smb_download_file,
        smb_commands::smb_upload_file,
        smb_commands::smb_mkdir,
        smb_commands::smb_rmdir,
        smb_commands::smb_delete_file,
        smb_commands::smb_rename,
        // ── SPICE (16) – t3-e55 ──────────────────────────────────
        spice_commands::connect_spice,
        spice_commands::disconnect_spice,
        spice_commands::disconnect_all_spice,
        spice_commands::is_spice_connected,
        spice_commands::get_spice_session_info,
        spice_commands::list_spice_sessions,
        spice_commands::get_spice_session_stats,
        spice_commands::send_spice_key_event,
        spice_commands::send_spice_pointer_event,
        spice_commands::send_spice_clipboard,
        spice_commands::request_spice_update,
        spice_commands::set_spice_resolution,
        spice_commands::spice_redirect_usb,
        spice_commands::spice_unredirect_usb,
        spice_commands::prune_spice_sessions,
        spice_commands::get_spice_session_count,
        // ── X2Go (15) – t3-e55 ───────────────────────────────────
        x2go_commands::connect_x2go,
        x2go_commands::suspend_x2go,
        x2go_commands::terminate_x2go,
        x2go_commands::disconnect_x2go,
        x2go_commands::disconnect_all_x2go,
        x2go_commands::is_x2go_connected,
        x2go_commands::get_x2go_session_info,
        x2go_commands::list_x2go_sessions,
        x2go_commands::get_x2go_session_stats,
        x2go_commands::send_x2go_clipboard,
        x2go_commands::resize_x2go_display,
        x2go_commands::mount_x2go_folder,
        x2go_commands::unmount_x2go_folder,
        x2go_commands::prune_x2go_sessions,
        x2go_commands::get_x2go_session_count,
        // ── ARD (14) – t3-e55 ────────────────────────────────────
        ard_commands::connect_ard,
        ard_commands::disconnect_ard,
        ard_commands::send_ard_input,
        ard_commands::set_ard_clipboard,
        ard_commands::get_ard_clipboard,
        ard_commands::set_ard_curtain_mode,
        ard_commands::upload_ard_file,
        ard_commands::download_ard_file,
        ard_commands::list_ard_remote_dir,
        ard_commands::get_ard_session_info,
        ard_commands::list_ard_sessions,
        ard_commands::get_ard_stats,
        ard_commands::get_ard_logs,
        ard_commands::reconnect_ard,
        // ── NX (14) – t3-e55 ─────────────────────────────────────
        nx_commands::connect_nx,
        nx_commands::disconnect_nx,
        nx_commands::disconnect_all_nx,
        nx_commands::suspend_nx,
        nx_commands::is_nx_connected,
        nx_commands::get_nx_session_info,
        nx_commands::list_nx_sessions,
        nx_commands::get_nx_session_stats,
        nx_commands::send_nx_key_event,
        nx_commands::send_nx_pointer_event,
        nx_commands::send_nx_clipboard,
        nx_commands::resize_nx_display,
        nx_commands::prune_nx_sessions,
        nx_commands::get_nx_session_count,
        // ── XDMCP (10) – t3-e55 ──────────────────────────────────
        xdmcp_commands::connect_xdmcp,
        xdmcp_commands::disconnect_xdmcp,
        xdmcp_commands::disconnect_all_xdmcp,
        xdmcp_commands::discover_xdmcp,
        xdmcp_commands::is_xdmcp_connected,
        xdmcp_commands::get_xdmcp_session_info,
        xdmcp_commands::list_xdmcp_sessions,
        xdmcp_commands::get_xdmcp_session_stats,
        xdmcp_commands::prune_xdmcp_sessions,
        xdmcp_commands::get_xdmcp_session_count,
        // ── sorng-openvpn dedicated crate (37) ────────────────────────
        openvpn_dedicated_commands::openvpn_create_connection,
        openvpn_dedicated_commands::openvpn_connect,
        openvpn_dedicated_commands::openvpn_connect_with_events,
        openvpn_dedicated_commands::openvpn_create_and_connect,
        openvpn_dedicated_commands::openvpn_disconnect,
        openvpn_dedicated_commands::openvpn_disconnect_all,
        openvpn_dedicated_commands::openvpn_remove_connection,
        openvpn_dedicated_commands::openvpn_list_connections,
        openvpn_dedicated_commands::openvpn_get_connection_info,
        openvpn_dedicated_commands::openvpn_get_status,
        openvpn_dedicated_commands::openvpn_get_stats,
        openvpn_dedicated_commands::openvpn_send_auth,
        openvpn_dedicated_commands::openvpn_send_otp,
        openvpn_dedicated_commands::openvpn_import_config,
        openvpn_dedicated_commands::openvpn_export_config,
        openvpn_dedicated_commands::openvpn_validate_config,
        openvpn_dedicated_commands::openvpn_get_config_templates,
        openvpn_dedicated_commands::openvpn_set_routing_policy,
        openvpn_dedicated_commands::openvpn_get_routing_policy,
        openvpn_dedicated_commands::openvpn_capture_route_table,
        openvpn_dedicated_commands::openvpn_set_dns_config,
        openvpn_dedicated_commands::openvpn_get_dns_config,
        openvpn_dedicated_commands::openvpn_check_dns_leak,
        openvpn_dedicated_commands::openvpn_flush_dns,
        openvpn_dedicated_commands::openvpn_check_health,
        openvpn_dedicated_commands::openvpn_get_logs,
        openvpn_dedicated_commands::openvpn_search_logs,
        openvpn_dedicated_commands::openvpn_export_logs,
        openvpn_dedicated_commands::openvpn_clear_logs,
        openvpn_dedicated_commands::openvpn_mgmt_command,
        openvpn_dedicated_commands::openvpn_detect_version,
        openvpn_dedicated_commands::openvpn_find_binary,
        openvpn_dedicated_commands::openvpn_get_binary_paths,
        openvpn_dedicated_commands::openvpn_set_default_reconnect,
        openvpn_dedicated_commands::openvpn_get_default_reconnect,
        openvpn_dedicated_commands::openvpn_set_default_routing,
        openvpn_dedicated_commands::openvpn_set_default_dns,
        // ── t5-e9: stateless TOTP helpers ──────────────────────────
        totp_commands::totp_compute_code,
        totp_commands::totp_build_otpauth_uri,
        totp_commands::totp_generate_backup_codes,
        // ── t5-e13: Vault TOTP (36 commands — from sorng-totp) ─────
        totp_commands::totp_add_entry,
        totp_commands::totp_create_entry,
        totp_commands::totp_get_entry,
        totp_commands::totp_update_entry,
        totp_commands::totp_remove_entry,
        totp_commands::totp_list_entries,
        totp_commands::totp_search_entries,
        totp_commands::totp_filter_entries,
        totp_commands::totp_generate_code,
        totp_commands::totp_generate_all_codes,
        totp_commands::totp_verify_code,
        totp_commands::totp_add_group,
        totp_commands::totp_list_groups,
        totp_commands::totp_remove_group,
        totp_commands::totp_move_entry_to_group,
        totp_commands::totp_toggle_favourite,
        totp_commands::totp_list_favourites,
        totp_commands::totp_reorder_entry,
        totp_commands::totp_import_entries,
        totp_commands::totp_import_as,
        totp_commands::totp_import_uri,
        totp_commands::totp_export_entries,
        totp_commands::totp_entry_qr_png,
        totp_commands::totp_entry_qr_data_uri,
        totp_commands::totp_entry_uri,
        totp_commands::totp_set_password,
        totp_commands::totp_lock,
        totp_commands::totp_unlock,
        totp_commands::totp_is_locked,
        totp_commands::totp_save_vault,
        totp_commands::totp_load_vault,
        totp_commands::totp_generate_secret,
        totp_commands::totp_password_strength,
        totp_commands::totp_deduplicate,
        totp_commands::totp_vault_stats,
        totp_commands::totp_all_tags,
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
        // ── t5-e7: Connection Clone ────────────────────────────────
        crate::connection_clone_cmds::clone_connection,
        // ── t5-e7b: Probes ─────────────────────────────────────────
        sorng_probes::commands::tcp_probe,
        sorng_probes::commands::ssh_probe,
        sorng_probes::commands::rdp_probe,
        sorng_probes::commands::check_all_connections,
        sorng_probes::commands::cancel_check_run,
    ]
}
