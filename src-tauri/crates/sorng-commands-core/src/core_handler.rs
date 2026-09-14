use crate::*;
use connection_clone_cmds as connection_clone_commands;
#[cfg(feature = "opkssh")]
use opkssh_commands::inner as opkssh_inner_commands;
use sorng_encryption::commands as encryption_commands;
use sorng_encryption::master_recovery as master_recovery_commands;
use sorng_probes::commands as probe_commands;

mod runtime_capability_commands {
    #[derive(Debug, Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RuntimeCapabilities {
        pub cloud: bool,
        pub ops: bool,
        pub rdp: bool,
        pub serial: bool,
        pub mysql: bool,
        pub postgresql: bool,
        pub mongodb: bool,
        pub mssql: bool,
        pub sqlite: bool,
        pub redis: bool,
        pub platform: bool,
        pub collab: bool,
        pub softether: bool,
        pub script_engine: bool,
        pub opkssh: bool,
    }

    #[tauri::command]
    pub fn get_runtime_capabilities() -> RuntimeCapabilities {
        RuntimeCapabilities {
            cloud: cfg!(feature = "cloud"),
            ops: cfg!(feature = "ops"),
            rdp: cfg!(feature = "rdp"),
            serial: cfg!(any(
                feature = "protocol-serial",
                feature = "protocol-serial-dynamic"
            )),
            mysql: cfg!(feature = "db-mysql"),
            postgresql: cfg!(feature = "db-postgres"),
            mongodb: cfg!(feature = "db-mongo"),
            mssql: cfg!(feature = "db-mssql"),
            sqlite: cfg!(any(feature = "db-sqlite", feature = "db-sqlite-dynamic")),
            redis: cfg!(feature = "db-redis"),
            platform: cfg!(feature = "platform"),
            collab: cfg!(any(feature = "collab", feature = "platform")),
            softether: cfg!(feature = "vpn-softether"),
            script_engine: cfg!(feature = "script-engine"),
            opkssh: cfg!(feature = "opkssh"),
        }
    }
}

pub fn is_command(command: &str) -> bool {
    crate::llm_handler::is_command(command)
        || crate::telegram_handler::is_command(command)
        || sorng_commands_vpn::is_command(command)
        || is_command_a(command)
        || is_command_j(command)
        || is_command_b(command)
        || is_command_c(command)
        || is_command_d(command)
        || is_command_e(command)
        || is_command_f(command)
        || is_command_g(command)
        || is_command_h(command)
        || is_command_i(command)
}

type InvokeHandler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

// `tauri::generate_handler!` expands every command into one match arm. Keep
// each expansion bounded so rustc never has to lower and codegen the previous
// 1,117-arm closure as a single unit. The generated predicate is built from
// the exact same command list, which keeps routing and registration in lockstep.
macro_rules! define_command_group {
    (
        $predicate:ident,
        $builder:ident,
        $commands:ident,
        [
            $(
                $(#[$attribute:meta])*
                $module:ident::$command:ident
            ),* $(,)?
        ]
    ) => {
        fn $predicate(command: &str) -> bool {
            $commands.binary_search(&command).is_ok()
        }

        fn $builder() -> InvokeHandler {
            Box::new(tauri::generate_handler![
                $(
                    $(#[$attribute])*
                    $module::$command,
                )*
            ])
        }

        const $commands: &[&str] = &[
            $(
                $(#[$attribute])*
                stringify!($command),
            )*
        ];
    };
}

define_command_group!(
    is_command_a,
    build_a,
    GROUP_A_COMMANDS,
    [
        app_auth_commands::add_user,
        api_server_commands::api_regenerate_key,
        api_server_commands::api_reveal_key,
        api_server_commands::api_secret_status,
        api_server_commands::api_server_restart,
        api_server_commands::api_server_start,
        api_server_commands::api_server_status,
        api_server_commands::api_server_stop,
        app_auth_commands::auth_hash_password,
        app_auth_commands::auth_verify_password,
        backup_commands::backup_delete,
        backup_commands::backup_get_config,
        backup_commands::backup_get_status,
        backup_commands::backup_list,
        backup_commands::backup_list_all_targets,
        backup_commands::backup_restore,
        backup_commands::backup_run_now,
        backup_commands::backup_update_config,
        database_files::change_database_security,
        app_shell_commands::check_shortcut,
        app_shell_commands::clear_app_data,
        storage_commands::clear_storage,
        app_shell_commands::close_all_windows,
        storage_commands::compare_and_swap_app_data,
        database_protection::database_protection_capabilities,
        database_protection::database_protection_change,
        database_protection::database_protection_load,
        database_protection::database_protection_lock,
        database_protection::database_protection_release_session,
        database_protection::database_protection_save,
        database_protection::database_protection_status,
        database_protection::database_protection_unlock,
        database_files::databases_encryption_status,
        database_files::databases_list,
        database_files::databases_save_index,
        database_files::delete_database_data,
        app_shell_commands::delete_shortcut,
        artifact_encryption_commands::encryption_apply_artifact_policy,
        encryption_commands::encryption_audit_clear,
        encryption_commands::encryption_audit_read,
        artifact_encryption_commands::encryption_cancel_artifact_policy,
        master_recovery_commands::encryption_cancel_master_recovery,
        encryption_commands::encryption_change_password,
        master_recovery_commands::encryption_commit_master_recovery,
        encryption_commands::encryption_disable_settings,
        encryption_commands::encryption_export_portable_dek,
        artifact_encryption_commands::encryption_get_artifact_status,
        encryption_commands::encryption_import_portable_dek,
        encryption_commands::encryption_lock,
        encryption_commands::encryption_lockout_state,
        master_recovery_commands::encryption_master_key_health,
        encryption_commands::encryption_migrate_settings,
        master_recovery_commands::encryption_prepare_master_recovery,
        artifact_encryption_commands::encryption_preview_artifact_policy,
        artifact_encryption_commands::encryption_recover_artifact_transition,
        artifact_encryption_commands::encryption_release_artifact_preview,
        encryption_rotation_commands::encryption_rotate_master_key_full,
        encryption_commands::encryption_setup,
        encryption_commands::encryption_status,
        encryption_commands::encryption_unlock,
        encryption_commands::encryption_validate_new_password,
        app_shell_commands::factory_reset,
        api_capability_commands::get_api_capabilities,
        cpu_commands::get_cpu_aes_capabilities,
        app_shell_commands::get_launch_args,
        runtime_capability_commands::get_runtime_capabilities,
        app_shell_commands::get_system_memory_info,
        app_shell_commands::greet,
        storage_commands::has_stored_data,
        storage_commands::is_storage_encrypted,
        app_auth_commands::list_users,
        storage_commands::load_data,
        database_files::load_database_data,
        // DevTools command is registered ONLY in debug builds. In a release
        // (`--release`) build `open_devtools` is not part of the IPC handler,
        // so it cannot be invoked even though the function still exists as an
        // inert no-op (and Tauri's own DevTools machinery is absent without
        // the `devtools` feature).
        #[cfg(debug_assertions)]
        app_shell_commands::open_devtools,
        app_shell_commands::open_url_external,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_await_login,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_add_identity_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_add_provider_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_audit_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_env_string,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_install_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_remove_identity_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_build_remove_provider_cmd,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_cancel_login,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_check_binary,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_audit_results,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_client_config,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_download_url,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_login_operation,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_server_config,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_get_status,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_list_keys,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_login,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_parse_audit_output,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_parse_server_config,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_remove_key,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_server_read_config_script,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_start_login,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_update_client_config,
        #[cfg(feature = "opkssh")]
        opkssh_inner_commands::opkssh_well_known_providers,
        storage_commands::read_app_data,
        app_settings_commands::read_app_settings,
        app_auth_commands::remove_user,
        app_shell_commands::restart_app,
        storage_commands::save_data,
        database_files::save_database_data,
        app_shell_commands::scan_shortcuts,
        api_capability_commands::set_api_disabled_capabilities,
        trust_store_commands::trust_apply_reviewed_batch,
        trust_store_commands::trust_cancel_force_delete_legacy,
        trust_store_commands::trust_clear_all,
        trust_store_commands::trust_delete_database_store,
        trust_store_commands::trust_delete_legacy_stores,
        trust_store_commands::trust_export_database,
        trust_store_commands::trust_force_delete_legacy,
        trust_store_commands::trust_get_active_database,
        trust_store_commands::trust_get_all_records,
        trust_store_commands::trust_get_effective_identity,
        trust_store_commands::trust_get_identity,
        trust_store_commands::trust_get_identity_history,
        trust_store_commands::trust_get_policy,
        trust_store_commands::trust_get_policy_config,
        trust_store_commands::trust_get_summary,
        trust_store_commands::trust_get_verification_stats,
        trust_store_commands::trust_import_database,
        trust_store_commands::trust_legacy_status,
        database_protection::trust_migrate_legacy_database,
        trust_store_commands::trust_preview_force_delete_legacy,
        database_protection::trust_reassign_reviewed_scope,
        trust_store_commands::trust_reinstate_identity,
        trust_store_commands::trust_remove_identity,
        trust_store_commands::trust_revoke_identity,
        trust_store_commands::trust_set_active_database,
        trust_store_commands::trust_set_host_policy,
        trust_store_commands::trust_set_policy,
        trust_store_commands::trust_set_policy_config,
        trust_store_commands::trust_set_record_tags,
        trust_store_commands::trust_store_identity,
        trust_store_commands::trust_store_identity_with_reason,
        trust_store_commands::trust_update_nickname,
        // Trust store commands
        trust_store_commands::trust_verify_identity,
        app_auth_commands::update_password,
        updater_commands::updater_check,
        updater_commands::updater_download_and_install,
        updater_commands::updater_get_settings,
        updater_commands::updater_get_status,
        updater_commands::updater_install_unsigned,
        updater_commands::updater_relaunch,
        updater_commands::updater_save_settings,
        https_trust_commands::verify_https_certificate_trust,
        app_auth_commands::verify_user,
        storage_commands::write_app_data,
        app_settings_commands::write_app_settings,
    ]
);

define_command_group!(
    is_command_j,
    build_j,
    GROUP_J_COMMANDS,
    [
        vnc_commands::acknowledge_vnc_frame,
        rdp_commands::attach_rdp_session,
        ssh_commands::cancel_script_execution,
        rdp_commands::connect_rdp,
        // Interactive session protocols share this group so the foundational
        // app-shell group remains below the bounded Tauri macro expansion.
        ssh_commands::connect_ssh,
        vnc_commands::connect_vnc,
        rdp_commands::detach_rdp_session,
        rdp_commands::detect_keyboard_layout,
        rdp_commands::diagnose_rdp_connection,
        vnc_commands::disconnect_all_vnc,
        rdp_commands::disconnect_rdp,
        ssh_commands::disconnect_ssh,
        vnc_commands::disconnect_vnc,
        ssh_commands::download_file,
        ssh_commands::execute_command,
        ssh_commands::execute_command_interactive,
        ssh_commands::execute_script,
        ssh_commands::execute_script_stream,
        rdp_commands::get_rdp_logs,
        rdp_commands::get_rdp_session_info,
        rdp_commands::get_rdp_stats,
        ssh_commands::get_session_info,
        ssh_commands::get_system_info,
        vnc_commands::get_vnc_session_count,
        vnc_commands::get_vnc_session_info,
        vnc_commands::get_vnc_session_stats,
        vnc_commands::is_vnc_connected,
        ssh_commands::jump_hosts_to_mixed_chain,
        ssh_commands::list_directory,
        rdp_commands::list_rdp_sessions,
        ssh_commands::list_sessions,
        vnc_commands::list_vnc_sessions,
        ssh_commands::monitor_process,
        ssh_commands::proxy_chain_to_mixed_chain,
        vnc_commands::prune_vnc_sessions,
        rdp_commands::rdp_ack_frame_delivery,
        rdp_commands::rdp_binary_ipc_preflight,
        rdp_commands::rdp_cert_trust_respond,
        rdp_commands::rdp_clipboard_copy,
        rdp_commands::rdp_clipboard_copy_files,
        rdp_commands::rdp_clipboard_paste,
        rdp_commands::rdp_force_reboot,
        rdp_commands::rdp_get_frame_data,
        rdp_commands::rdp_get_thumbnail,
        rdp_commands::rdp_report_frame_telemetry,
        rdp_commands::rdp_save_screenshot,
        rdp_commands::rdp_send_input,
        rdp_commands::rdp_set_desktop_size,
        rdp_commands::rdp_set_session_activity,
        rdp_commands::rdp_sign_out,
        rdp_commands::rdp_toggle_feature,
        ssh_commands::reattach_session,
        rdp_commands::reconnect_rdp_session,
        vnc_commands::request_vnc_update,
        ssh_commands::resize_ssh_shell,
        ssh_commands::send_ssh_input,
        vnc_commands::send_vnc_clipboard,
        vnc_commands::send_vnc_key_event,
        vnc_commands::send_vnc_pointer_event,
        vnc_commands::set_vnc_pixel_format,
        vnc_commands::set_vnc_session_activity,
        ssh_commands::setup_port_forward,
        ssh_commands::ssh_respond_to_host_key_prompt,
        ssh_commands::start_shell,
        ssh_commands::test_mixed_chain_connection,
        ssh_commands::transfer_file_scp,
        // t62: the Trust Center's known_hosts importer lives beside the
        // host-key prompt because it needs libssh2's known_hosts parser.
        ssh_commands::trust_import_known_hosts,
        ssh_commands::trust_preview_known_hosts,
        ssh_commands::upload_file,
        ssh_commands::validate_mixed_chain,
    ]
);

define_command_group!(
    is_command_b,
    build_b,
    GROUP_B_COMMANDS,
    [
        wol_commands::add_wol_schedule,
        network_commands::check_mtu,
        network_commands::check_port,
        network_commands::check_tls,
        network_commands::classify_ip,
        db_commands::connect_mysql,
        db_commands::create_database,
        db_commands::create_table,
        db_commands::delete_row,
        network_commands::detect_asymmetric_routing,
        network_commands::detect_icmp_blockade,
        network_commands::detect_proxy_leakage,
        anydesk_commands::disconnect_anydesk,
        db_commands::disconnect_db,
        wol_commands::discover_wol_devices,
        network_commands::dns_lookup,
        db_commands::drop_database,
        db_commands::drop_table,
        db_commands::execute_query,
        ssh_commands::execute_user_script,
        db_commands::export_database,
        db_commands::export_database_chunked,
        db_commands::export_table,
        db_commands::export_table_chunked,
        network_commands::fingerprint_service,
        ftp_commands::ftp_add_bookmark,
        ftp_commands::ftp_append_file,
        ftp_commands::ftp_cancel_transfer,
        ftp_commands::ftp_chmod,
        ftp_commands::ftp_connect,
        ftp_commands::ftp_delete_file,
        ftp_commands::ftp_disconnect,
        ftp_commands::ftp_disconnect_all,
        ftp_commands::ftp_download_file,
        ftp_commands::ftp_enqueue_transfer,
        ftp_commands::ftp_get_all_progress,
        ftp_commands::ftp_get_current_directory,
        ftp_commands::ftp_get_diagnostics,
        ftp_commands::ftp_get_file_size,
        ftp_commands::ftp_get_modified_time,
        ftp_commands::ftp_get_pool_stats,
        ftp_commands::ftp_get_session_info,
        ftp_commands::ftp_get_transfer_progress,
        ftp_commands::ftp_list_bookmarks,
        ftp_commands::ftp_list_directory,
        ftp_commands::ftp_list_sessions,
        ftp_commands::ftp_list_transfers,
        ftp_commands::ftp_mkdir,
        ftp_commands::ftp_mkdir_all,
        ftp_commands::ftp_ping,
        ftp_commands::ftp_remove_bookmark,
        ftp_commands::ftp_rename,
        ftp_commands::ftp_resume_download,
        ftp_commands::ftp_resume_upload,
        ftp_commands::ftp_rmdir,
        ftp_commands::ftp_rmdir_recursive,
        ftp_commands::ftp_set_directory,
        ftp_commands::ftp_stat_entry,
        ftp_commands::ftp_update_bookmark,
        ftp_commands::ftp_upload_file,
        security_commands::generate_totp_secret,
        anydesk_commands::get_anydesk_session,
        db_commands::get_databases,
        db_commands::get_table_data,
        db_commands::get_table_structure,
        db_commands::get_tables,
        db_commands::import_csv,
        db_commands::import_sql,
        db_commands::insert_row,
        anydesk_commands::launch_anydesk,
        anydesk_commands::list_anydesk_sessions,
        wol_commands::list_wol_schedules,
        network_commands::lookup_ip_geo,
        network_commands::ping_gateway,
        network_commands::ping_host,
        network_commands::ping_host_detailed,
        network_commands::probe_udp_port,
        network_commands::probe_vnc_rfb,
        wol_commands::remove_wol_schedule,
        network_commands::scan_network,
        network_commands::scan_network_comprehensive,
        network_commands::tcp_connection_timing,
        network_commands::traceroute,
        db_commands::update_row,
        wol_commands::update_wol_schedule,
        security_commands::verify_totp,
        wol_commands::wake_multiple_hosts,
        wol_commands::wake_on_lan,
    ]
);

define_command_group!(
    is_command_c,
    build_c,
    GROUP_C_COMMANDS,
    [
        vercel_commands::add_vercel_domain,
        rpc_commands::batch_rpc_calls,
        rpc_commands::call_rpc_method,
        agent_commands::connect_agent,
        aws_commands::connect_aws,
        commander_commands::connect_commander,
        meshcentral_commands::connect_meshcentral,
        rpc_commands::connect_rpc,
        vercel_commands::connect_vercel,
        wmi_commands::connect_wmi,
        aws_commands::create_s3_bucket,
        vercel_commands::create_vercel_deployment,
        agent_commands::disconnect_agent,
        aws_commands::disconnect_aws,
        commander_commands::disconnect_commander,
        meshcentral_commands::disconnect_meshcentral,
        rpc_commands::disconnect_rpc,
        vercel_commands::disconnect_vercel,
        wmi_commands::disconnect_wmi,
        rpc_commands::discover_rpc_methods,
        commander_commands::download_commander_file,
        agent_commands::execute_agent_command,
        commander_commands::execute_commander_command,
        aws_commands::execute_ec2_action,
        meshcentral_commands::execute_meshcentral_command,
        wmi_commands::execute_wmi_query,
        qr_commands::generate_qr_code,
        qr_commands::generate_qr_code_png,
        agent_commands::get_agent_command_result,
        agent_commands::get_agent_info,
        agent_commands::get_agent_logs,
        agent_commands::get_agent_metrics,
        agent_commands::get_agent_session,
        aws_commands::get_aws_session,
        aws_commands::get_caller_identity,
        aws_commands::get_cloudwatch_metrics,
        commander_commands::get_commander_command_result,
        commander_commands::get_commander_file_transfer,
        commander_commands::get_commander_session,
        commander_commands::get_commander_system_info,
        meshcentral_commands::get_meshcentral_command_result,
        meshcentral_commands::get_meshcentral_devices,
        meshcentral_commands::get_meshcentral_groups,
        meshcentral_commands::get_meshcentral_server_info,
        meshcentral_commands::get_meshcentral_session,
        rpc_commands::get_rpc_session,
        aws_commands::get_s3_objects,
        aws_commands::get_secret_value,
        aws_commands::get_ssm_parameter,
        vercel_commands::get_vercel_session,
        wmi_commands::get_wmi_classes,
        wmi_commands::get_wmi_namespaces,
        wmi_commands::get_wmi_session,
        aws_commands::invoke_lambda_function,
        agent_commands::list_agent_sessions,
        aws_commands::list_aws_sessions,
        aws_commands::list_cloudformation_stacks,
        commander_commands::list_commander_directory,
        commander_commands::list_commander_sessions,
        aws_commands::list_ec2_instances,
        aws_commands::list_ecs_clusters,
        aws_commands::list_ecs_services,
        aws_commands::list_hosted_zones,
        aws_commands::list_iam_roles,
        aws_commands::list_iam_users,
        aws_commands::list_lambda_functions,
        meshcentral_commands::list_meshcentral_sessions,
        aws_commands::list_rds_instances,
        rpc_commands::list_rpc_sessions,
        aws_commands::list_s3_buckets,
        aws_commands::list_secrets,
        aws_commands::list_sns_topics,
        aws_commands::list_sqs_queues,
        vercel_commands::list_vercel_deployments,
        vercel_commands::list_vercel_domains,
        vercel_commands::list_vercel_projects,
        vercel_commands::list_vercel_sessions,
        vercel_commands::list_vercel_teams,
        wmi_commands::list_wmi_sessions,
        vercel_commands::redeploy_vercel_project,
        vercel_commands::set_vercel_env_var,
        agent_commands::update_agent_status,
        commander_commands::update_commander_status,
        commander_commands::upload_commander_file,
    ]
);

define_command_group!(
    is_command_d,
    build_d,
    GROUP_D_COMMANDS,
    [
        http_commands::activate_proxy_network_document,
        ssh_commands::add_highlight_rule,
        // Biometrics (native OS)
        biometrics_commands::biometric_check_availability,
        biometrics_commands::biometric_cleanup_legacy,
        biometrics_commands::biometric_is_available,
        biometrics_commands::biometric_needs_migration,
        biometrics_commands::biometric_platform_info,
        biometrics_commands::biometric_verify,
        biometrics_commands::biometric_verify_and_derive_key,
        http_commands::cancel_proxy_continuation,
        // FIDO2 / Security Key commands
        ssh_commands::check_fido2_support,
        http_commands::check_proxy_health,
        ssh_commands::clear_highlight_rules,
        http_commands::clear_proxy_request_log,
        ssh_commands::clear_terminal_buffer,
        ssh_commands::close_ssh3_channel,
        ssh_commands::confirm_proxy_command,
        cloudflare_commands::connect_cloudflare,
        // SSH3 (SSH over HTTP/3 QUIC) commands
        ssh_commands::connect_ssh3,
        cloudflare_commands::create_cloudflare_dns_record,
        cloudflare_commands::delete_cloudflare_dns_record,
        cloudflare_commands::deploy_cloudflare_worker,
        ssh_commands::detect_sk_key_type,
        http_commands::diagnose_http_connection,
        ssh_commands::diagnose_ssh_connection,
        ssh_commands::disable_x11_forwarding,
        cloudflare_commands::disconnect_cloudflare,
        ssh_commands::disconnect_ssh3,
        // X11 forwarding
        ssh_commands::enable_x11_forwarding,
        ssh_commands::execute_command_sequence,
        ssh_commands::execute_ssh3_command,
        ssh_commands::expand_proxy_command,
        ssh_commands::expect_and_send,
        ssh_commands::export_recording_asciicast,
        ssh_commands::export_recording_script,
        http_commands::export_web_recording_har,
        ssh_commands::generate_rdp_file,
        ssh_commands::generate_sk_ssh_key,
        ssh_commands::generate_ssh_key,
        ssh_commands::get_automation_status,
        cloudflare_commands::get_cloudflare_analytics,
        cloudflare_commands::get_cloudflare_session,
        ssh_commands::get_ftp_tunnel_status,
        ssh_commands::get_highlight_rules,
        ssh_commands::get_highlight_status,
        // ProxyCommand
        ssh_commands::get_proxy_command_info,
        http_commands::get_proxy_request_log,
        http_commands::get_proxy_session_details,
        ssh_commands::get_rdp_tunnel_status,
        ssh_commands::get_recording_status,
        ssh_commands::get_shell_info,
        ssh_commands::get_ssh3_session_info,
        // SSH compression commands
        ssh_commands::get_ssh_compression_info,
        // NOTE: pause_shell and resume_shell removed - buffer always captures full session
        ssh_commands::get_ssh_host_key_info,
        ssh_commands::get_terminal_buffer,
        ssh_commands::get_terminal_buffer_snapshot,
        http_commands::get_tls_certificate_info,
        ssh_commands::get_vnc_tunnel_status,
        http_commands::get_web_recording_status,
        ssh_commands::get_x11_forward_status,
        http_commands::http_fetch,
        http_commands::http_get,
        http_commands::http_post,
        ssh_commands::is_automation_active,
        ssh_commands::is_session_alive,
        ssh_commands::is_session_recording,
        http_commands::is_web_recording,
        ssh_commands::list_active_automations,
        ssh_commands::list_active_recordings,
        cloudflare_commands::list_cloudflare_dns_records,
        cloudflare_commands::list_cloudflare_page_rules,
        cloudflare_commands::list_cloudflare_sessions,
        cloudflare_commands::list_cloudflare_workers,
        cloudflare_commands::list_cloudflare_zones,
        ssh_commands::list_fido2_devices,
        ssh_commands::list_fido2_resident_credentials,
        ssh_commands::list_ftp_tunnels,
        ssh_commands::list_highlighted_sessions,
        http_commands::list_proxy_sessions,
        ssh_commands::list_rdp_tunnels,
        ssh_commands::list_session_ftp_tunnels,
        ssh_commands::list_session_rdp_tunnels,
        ssh_commands::list_session_vnc_tunnels,
        ssh_commands::list_ssh3_sessions,
        ssh_commands::list_ssh_compression_algorithms,
        ssh_commands::list_vnc_tunnels,
        ssh_commands::list_x11_forwards,
        passkey_commands::passkey_authenticate,
        passkey_commands::passkey_is_available,
        passkey_commands::passkey_list_credentials,
        passkey_commands::passkey_register,
        passkey_commands::passkey_remove_credential,
        cloudflare_commands::purge_cloudflare_cache,
        ssh_commands::remove_highlight_rule,
        ssh_commands::reset_ssh_compression_stats,
        ssh_commands::resize_ssh3_shell,
        http_commands::restart_proxy_session,
        http_commands::review_proxy_redirect,
        ssh_commands::send_ssh3_input,
        // SSH terminal regex highlighting commands
        ssh_commands::set_highlight_rules,
        http_commands::set_proxy_request_log_capacity,
        ssh_commands::setup_bulk_rdp_tunnels,
        // FTP over SSH tunnel commands
        ssh_commands::setup_ftp_tunnel,
        // RDP over SSH tunnel commands
        ssh_commands::setup_rdp_tunnel,
        ssh_commands::setup_ssh3_port_forward,
        // VNC over SSH tunnel commands
        ssh_commands::setup_vnc_tunnel,
        ssh_commands::should_compress_sftp,
        // SSH terminal automation commands
        ssh_commands::start_automation,
        http_commands::start_basic_auth_proxy,
        // SSH session recording commands
        ssh_commands::start_session_recording,
        ssh_commands::start_ssh3_shell,
        // Web session recording commands
        http_commands::start_web_recording,
        http_commands::stop_all_proxy_sessions,
        ssh_commands::stop_automation,
        http_commands::stop_basic_auth_proxy,
        ssh_commands::stop_ftp_tunnel,
        ssh_commands::stop_proxy_command_cmd,
        ssh_commands::stop_rdp_tunnel,
        ssh_commands::stop_session_rdp_tunnels,
        ssh_commands::stop_session_recording,
        ssh_commands::stop_ssh3_port_forward,
        ssh_commands::stop_vnc_tunnel,
        http_commands::stop_web_recording,
        ssh_commands::test_highlight_rules,
        ssh_commands::test_ssh3_connection,
        ssh_commands::test_ssh_connection,
        cloudflare_commands::update_cloudflare_dns_record,
        ssh_commands::update_highlight_rule,
        ssh_commands::update_ssh_compression_config,
        ssh_commands::update_ssh_session_auth,
        ssh_commands::validate_ssh_key_file,
        ssh_commands::validate_ssh_key_file_extended,
    ]
);

define_command_group!(
    is_command_e,
    build_e,
    GROUP_E_COMMANDS,
    [
        cert_auth_commands::authenticate_with_cert,
        cert_gen_commands::cert_gen_ca,
        cert_gen_commands::cert_gen_csr,
        cert_gen_commands::cert_gen_delete,
        cert_gen_commands::cert_gen_delete_csr,
        cert_gen_commands::cert_gen_export_chain,
        cert_gen_commands::cert_gen_export_der,
        cert_gen_commands::cert_gen_export_pem,
        cert_gen_commands::cert_gen_get,
        cert_gen_commands::cert_gen_get_chain,
        cert_gen_commands::cert_gen_issue,
        cert_gen_commands::cert_gen_list,
        cert_gen_commands::cert_gen_list_csrs,
        // Certificate generation commands
        cert_gen_commands::cert_gen_self_signed,
        cert_gen_commands::cert_gen_update_label,
        cert_gen_commands::cert_sign_csr,
        splash::close_splash,
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
        cryptojs_compat_commands::crypto_legacy_decrypt_cryptojs,
        xlsx_crypto_commands::crypto_xlsx_decrypt,
        xlsx_crypto_commands::crypto_xlsx_encrypt,
        telnet_commands::disconnect_all_telnet,
        telnet_commands::disconnect_telnet,
        // Legacy crypto policy commands
        legacy_crypto_commands::get_legacy_crypto_policy,
        legacy_crypto_commands::get_legacy_crypto_warnings,
        legacy_crypto_commands::get_legacy_ssh_ciphers,
        legacy_crypto_commands::get_legacy_ssh_host_key_algorithms,
        legacy_crypto_commands::get_legacy_ssh_kex,
        legacy_crypto_commands::get_legacy_ssh_macs,
        telnet_commands::get_telnet_session_info,
        legacy_crypto_commands::is_legacy_algorithm_allowed,
        telnet_commands::is_telnet_connected,
        cert_auth_commands::list_certificates,
        telnet_commands::list_telnet_sessions,
        // Certificate authentication commands
        cert_auth_commands::parse_certificate,
        cert_auth_commands::register_certificate,
        telnet_commands::resize_telnet,
        cert_auth_commands::revoke_certificate,
        telnet_commands::send_telnet_ayt,
        telnet_commands::send_telnet_break,
        telnet_commands::send_telnet_command,
        telnet_commands::send_telnet_raw,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_bytes_to_hex,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_connect,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_disconnect,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_disconnect_all,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_flush,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_baud_rates,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_modem_info,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_modem_profiles,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_session_info,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_signal_quality,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_get_stats,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_hex_to_bytes,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_list_sessions,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_dial,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_hangup,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_modem_init,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_read_control_lines,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_reconfigure,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_resolve_port,
        // ── Serial (COM / RS-232) — gated on protocol-serial{,-dynamic} (t3-e4) ──
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_scan_ports,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_at_command,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_break,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_char,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_hex,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_line,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_send_raw,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_dtr,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_line_ending,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_local_echo,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_set_rts,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_start_logging,
        #[cfg(any(feature = "protocol-serial", feature = "protocol-serial-dynamic"))]
        serial_commands::serial_stop_logging,
        legacy_crypto_commands::set_legacy_crypto_policy,
        cert_auth_commands::validate_certificate,
        vault_commands::vault_backend_name,
        vault_commands::vault_biometric_read,
        vault_commands::vault_biometric_store,
        vault_commands::vault_delete_secret,
        vault_commands::vault_ensure_dek,
        vault_commands::vault_envelope_decrypt,
        vault_commands::vault_envelope_encrypt,
        vault_commands::vault_is_available,
        vault_commands::vault_load_storage,
        vault_commands::vault_migrate,
        vault_commands::vault_needs_migration,
        vault_commands::vault_read_secret,
        vault_commands::vault_save_storage,
        // Vault (native OS keychain)
        vault_commands::vault_status,
        vault_commands::vault_store_secret,
    ]
);

define_command_group!(
    is_command_f,
    build_f,
    GROUP_F_COMMANDS,
    [
        sftp_commands::sftp_batch_transfer,
        sftp_commands::sftp_bookmark_add,
        sftp_commands::sftp_bookmark_export,
        sftp_commands::sftp_bookmark_import,
        sftp_commands::sftp_bookmark_list,
        sftp_commands::sftp_bookmark_remove,
        sftp_commands::sftp_bookmark_touch,
        sftp_commands::sftp_bookmark_update,
        sftp_commands::sftp_cancel_transfer,
        sftp_commands::sftp_checksum,
        sftp_commands::sftp_chmod,
        sftp_commands::sftp_chown,
        sftp_commands::sftp_clear_completed_transfers,
        // ── SFTP (62) ────────────────────────────────────────────────
        sftp_commands::sftp_connect,
        sftp_commands::sftp_create_symlink,
        sftp_commands::sftp_delete_file,
        sftp_commands::sftp_delete_recursive,
        sftp_commands::sftp_diagnose,
        sftp_commands::sftp_disconnect,
        sftp_commands::sftp_disk_usage,
        sftp_commands::sftp_download,
        sftp_commands::sftp_exists,
        sftp_commands::sftp_get_session_info,
        sftp_commands::sftp_get_transfer_progress,
        sftp_commands::sftp_list_active_transfers,
        sftp_commands::sftp_list_directory,
        sftp_commands::sftp_list_sessions,
        sftp_commands::sftp_lstat,
        sftp_commands::sftp_mkdir,
        sftp_commands::sftp_mkdir_p,
        sftp_commands::sftp_pause_transfer,
        sftp_commands::sftp_ping,
        sftp_commands::sftp_queue_add,
        sftp_commands::sftp_queue_clear_done,
        sftp_commands::sftp_queue_list,
        sftp_commands::sftp_queue_remove,
        sftp_commands::sftp_queue_retry_failed,
        sftp_commands::sftp_queue_set_priority,
        sftp_commands::sftp_queue_start,
        sftp_commands::sftp_queue_status,
        sftp_commands::sftp_queue_stop,
        sftp_commands::sftp_read_link,
        sftp_commands::sftp_read_text_file,
        sftp_commands::sftp_realpath,
        sftp_commands::sftp_rename,
        sftp_commands::sftp_rmdir,
        sftp_commands::sftp_search,
        sftp_commands::sftp_set_directory,
        sftp_commands::sftp_stat,
        sftp_commands::sftp_sync_pull,
        sftp_commands::sftp_sync_push,
        sftp_commands::sftp_touch,
        sftp_commands::sftp_truncate,
        sftp_commands::sftp_upload,
        sftp_commands::sftp_upload_abort,
        sftp_commands::sftp_upload_begin,
        sftp_commands::sftp_upload_chunk,
        sftp_commands::sftp_upload_finish,
        sftp_commands::sftp_watch_list,
        sftp_commands::sftp_watch_start,
        sftp_commands::sftp_watch_stop,
        sftp_commands::sftp_write_text_file,
    ]
);

define_command_group!(
    is_command_g,
    build_g,
    GROUP_G_COMMANDS,
    [
        // ── SPICE (16) – t3-e55 ──────────────────────────────────
        spice_commands::connect_spice,
        spice_commands::disconnect_all_spice,
        spice_commands::disconnect_spice,
        spice_commands::get_spice_session_count,
        spice_commands::get_spice_session_info,
        spice_commands::get_spice_session_stats,
        spice_commands::is_spice_connected,
        spice_commands::list_spice_sessions,
        spice_commands::prune_spice_sessions,
        spice_commands::request_spice_update,
        rustdesk_commands::rustdesk_active_file_transfers,
        rustdesk_commands::rustdesk_active_session_count,
        rustdesk_commands::rustdesk_api_add_ab_peer,
        rustdesk_commands::rustdesk_api_add_ab_rule,
        rustdesk_commands::rustdesk_api_add_ab_tag,
        rustdesk_commands::rustdesk_api_add_devices_to_group,
        rustdesk_commands::rustdesk_api_add_users_to_group,
        rustdesk_commands::rustdesk_api_alarm_audits,
        rustdesk_commands::rustdesk_api_assign_device,
        rustdesk_commands::rustdesk_api_assign_strategy,
        rustdesk_commands::rustdesk_api_connection_audits,
        rustdesk_commands::rustdesk_api_console_audits,
        rustdesk_commands::rustdesk_api_create_address_book,
        rustdesk_commands::rustdesk_api_create_device_group,
        rustdesk_commands::rustdesk_api_create_user,
        rustdesk_commands::rustdesk_api_create_user_group,
        rustdesk_commands::rustdesk_api_delete_ab_rule,
        rustdesk_commands::rustdesk_api_delete_ab_tag,
        rustdesk_commands::rustdesk_api_delete_address_book,
        rustdesk_commands::rustdesk_api_delete_device_group,
        rustdesk_commands::rustdesk_api_delete_user_group,
        rustdesk_commands::rustdesk_api_device_action,
        rustdesk_commands::rustdesk_api_disable_strategy,
        rustdesk_commands::rustdesk_api_enable_strategy,
        rustdesk_commands::rustdesk_api_file_audits,
        rustdesk_commands::rustdesk_api_get_device,
        rustdesk_commands::rustdesk_api_get_personal_address_book,
        rustdesk_commands::rustdesk_api_get_strategy,
        rustdesk_commands::rustdesk_api_import_ab_peers,
        rustdesk_commands::rustdesk_api_list_ab_peers,
        rustdesk_commands::rustdesk_api_list_ab_rules,
        rustdesk_commands::rustdesk_api_list_ab_tags,
        rustdesk_commands::rustdesk_api_list_address_books,
        rustdesk_commands::rustdesk_api_list_device_groups,
        rustdesk_commands::rustdesk_api_list_devices,
        rustdesk_commands::rustdesk_api_list_strategies,
        rustdesk_commands::rustdesk_api_list_user_groups,
        rustdesk_commands::rustdesk_api_list_users,
        rustdesk_commands::rustdesk_api_login,
        rustdesk_commands::rustdesk_api_operator_audit_summary,
        rustdesk_commands::rustdesk_api_peer_audit_summary,
        rustdesk_commands::rustdesk_api_remove_ab_peer,
        rustdesk_commands::rustdesk_api_remove_devices_from_group,
        rustdesk_commands::rustdesk_api_unassign_strategy,
        rustdesk_commands::rustdesk_api_update_ab_peer,
        rustdesk_commands::rustdesk_api_update_address_book,
        rustdesk_commands::rustdesk_api_update_device_group,
        rustdesk_commands::rustdesk_api_update_user_group,
        rustdesk_commands::rustdesk_api_user_action,
        rustdesk_commands::rustdesk_assign_via_cli,
        rustdesk_commands::rustdesk_cancel_file_transfer,
        rustdesk_commands::rustdesk_check_service_running,
        rustdesk_commands::rustdesk_client_config_summary,
        rustdesk_commands::rustdesk_close_tunnel,
        rustdesk_commands::rustdesk_configure_server,
        rustdesk_commands::rustdesk_connect,
        rustdesk_commands::rustdesk_connect_direct_ip,
        rustdesk_commands::rustdesk_create_tunnel,
        rustdesk_commands::rustdesk_detect_version,
        rustdesk_commands::rustdesk_diagnostics_report,
        rustdesk_commands::rustdesk_disconnect,
        rustdesk_commands::rustdesk_download_file,
        rustdesk_commands::rustdesk_file_transfer_stats,
        rustdesk_commands::rustdesk_get_binary_info,
        rustdesk_commands::rustdesk_get_client_config,
        rustdesk_commands::rustdesk_get_file_transfer,
        rustdesk_commands::rustdesk_get_local_id,
        rustdesk_commands::rustdesk_get_server_config,
        rustdesk_commands::rustdesk_get_session,
        rustdesk_commands::rustdesk_get_tunnel,
        rustdesk_commands::rustdesk_install_service,
        // ── RustDesk (92) ────────────────────────────────────────────
        rustdesk_commands::rustdesk_is_available,
        rustdesk_commands::rustdesk_list_file_transfers,
        rustdesk_commands::rustdesk_list_remote_files,
        rustdesk_commands::rustdesk_list_sessions,
        rustdesk_commands::rustdesk_list_tunnels,
        rustdesk_commands::rustdesk_quick_health_check,
        rustdesk_commands::rustdesk_record_file_transfer,
        rustdesk_commands::rustdesk_send_input,
        rustdesk_commands::rustdesk_server_config_summary,
        rustdesk_commands::rustdesk_server_health,
        rustdesk_commands::rustdesk_server_latency,
        rustdesk_commands::rustdesk_session_summary,
        rustdesk_commands::rustdesk_set_client_config,
        rustdesk_commands::rustdesk_set_permanent_password,
        rustdesk_commands::rustdesk_shutdown,
        rustdesk_commands::rustdesk_silent_install,
        rustdesk_commands::rustdesk_start_file_transfer,
        rustdesk_commands::rustdesk_transfer_progress,
        rustdesk_commands::rustdesk_update_session_settings,
        rustdesk_commands::rustdesk_update_transfer_progress,
        rustdesk_commands::rustdesk_upload_file,
        spice_commands::send_spice_clipboard,
        spice_commands::send_spice_key_event,
        spice_commands::send_spice_pointer_event,
        spice_commands::set_spice_resolution,
        // ── SMB (16) ─────────────────────────────────────────────────
        smb_commands::smb_connect,
        smb_commands::smb_delete_file,
        smb_commands::smb_disconnect,
        smb_commands::smb_disconnect_all,
        smb_commands::smb_download_file,
        smb_commands::smb_get_session_info,
        smb_commands::smb_list_directory,
        smb_commands::smb_list_sessions,
        smb_commands::smb_list_shares,
        smb_commands::smb_mkdir,
        smb_commands::smb_read_file,
        smb_commands::smb_rename,
        smb_commands::smb_rmdir,
        smb_commands::smb_stat,
        smb_commands::smb_upload_file,
        smb_commands::smb_write_file,
        spice_commands::spice_redirect_usb,
        spice_commands::spice_unredirect_usb,
    ]
);

define_command_group!(
    is_command_h,
    build_h,
    GROUP_H_COMMANDS,
    [
        // ── ARD (18) – embedded RFB plus native macOS handoff ───
        ard_commands::connect_ard,
        // ── NX (14) – t3-e55 ─────────────────────────────────────
        nx_commands::connect_nx,
        // ── X2Go (15) – t3-e55 ───────────────────────────────────
        x2go_commands::connect_x2go,
        // ── XDMCP (10) – t3-e55 ──────────────────────────────────
        xdmcp_commands::connect_xdmcp,
        ard_commands::disconnect_all_ard,
        nx_commands::disconnect_all_nx,
        x2go_commands::disconnect_all_x2go,
        xdmcp_commands::disconnect_all_xdmcp,
        ard_commands::disconnect_ard,
        nx_commands::disconnect_nx,
        x2go_commands::disconnect_x2go,
        xdmcp_commands::disconnect_xdmcp,
        xdmcp_commands::discover_xdmcp,
        ard_commands::download_ard_file,
        ard_commands::get_ard_clipboard,
        ard_commands::get_ard_logs,
        ard_commands::get_ard_runtime_capabilities,
        ard_commands::get_ard_session_info,
        ard_commands::get_ard_stats,
        nx_commands::get_nx_session_count,
        nx_commands::get_nx_session_info,
        nx_commands::get_nx_session_stats,
        x2go_commands::get_x2go_session_count,
        x2go_commands::get_x2go_session_info,
        x2go_commands::get_x2go_session_stats,
        xdmcp_commands::get_xdmcp_session_count,
        xdmcp_commands::get_xdmcp_session_info,
        xdmcp_commands::get_xdmcp_session_stats,
        ard_commands::is_ard_connected,
        nx_commands::is_nx_connected,
        x2go_commands::is_x2go_connected,
        xdmcp_commands::is_xdmcp_connected,
        ard_commands::launch_apple_account_screen_sharing,
        ard_commands::list_ard_remote_dir,
        ard_commands::list_ard_sessions,
        nx_commands::list_nx_sessions,
        x2go_commands::list_x2go_sessions,
        xdmcp_commands::list_xdmcp_sessions,
        x2go_commands::mount_x2go_folder,
        nx_commands::prune_nx_sessions,
        x2go_commands::prune_x2go_sessions,
        xdmcp_commands::prune_xdmcp_sessions,
        ard_commands::reconnect_ard,
        nx_commands::resize_nx_display,
        x2go_commands::resize_x2go_display,
        ard_commands::send_ard_input,
        nx_commands::send_nx_clipboard,
        nx_commands::send_nx_key_event,
        nx_commands::send_nx_pointer_event,
        x2go_commands::send_x2go_clipboard,
        ard_commands::set_ard_clipboard,
        ard_commands::set_ard_curtain_mode,
        nx_commands::suspend_nx,
        x2go_commands::suspend_x2go,
        x2go_commands::terminate_x2go,
        // ── t5-e13: Vault TOTP (36 commands — from sorng-totp) ─────
        totp_commands::totp_add_entry,
        totp_commands::totp_add_group,
        totp_commands::totp_all_tags,
        totp_commands::totp_build_otpauth_uri,
        // ── t5-e9: stateless TOTP helpers ──────────────────────────
        totp_commands::totp_compute_code,
        totp_commands::totp_create_entry,
        totp_commands::totp_deduplicate,
        totp_commands::totp_entry_qr_data_uri,
        totp_commands::totp_entry_qr_png,
        totp_commands::totp_entry_uri,
        totp_commands::totp_export_entries,
        totp_commands::totp_filter_entries,
        totp_commands::totp_generate_all_codes,
        totp_commands::totp_generate_backup_codes,
        totp_commands::totp_generate_code,
        totp_commands::totp_generate_secret,
        totp_commands::totp_get_entry,
        totp_commands::totp_import_as,
        totp_commands::totp_import_entries,
        totp_commands::totp_import_uri,
        totp_commands::totp_is_locked,
        totp_commands::totp_list_entries,
        totp_commands::totp_list_favourites,
        totp_commands::totp_list_groups,
        totp_commands::totp_load_vault,
        totp_commands::totp_lock,
        totp_commands::totp_move_entry_to_group,
        totp_commands::totp_password_strength,
        totp_commands::totp_remove_entry,
        totp_commands::totp_remove_group,
        totp_commands::totp_reorder_entry,
        totp_commands::totp_save_vault,
        totp_commands::totp_search_entries,
        totp_commands::totp_set_password,
        totp_commands::totp_toggle_favourite,
        totp_commands::totp_unlock,
        totp_commands::totp_update_entry,
        totp_commands::totp_vault_stats,
        totp_commands::totp_verify_code,
        x2go_commands::unmount_x2go_folder,
        ard_commands::upload_ard_file,
    ]
);

define_command_group!(
    is_command_i,
    build_i,
    GROUP_I_COMMANDS,
    [
        #[cfg(feature = "ops")]
        powershell_session_commands::attach_powershell_session,
        raw_socket_commands::attach_raw_socket,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_add_catalog_entry,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_add_replica,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_cancel_job,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_check_immutability,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_compute_sha256,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_configure_notifications,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_create_policy,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_delete_catalog_entry,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_delete_policy,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_enforce_retention,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_generate_compliance_report,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_generate_manifest,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_catalog_entry,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_compliance_history,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_drill_history,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_job_history,
        // ── Backup Verify (35) — t40-e3-F1 ────────────────────────────
        // Gated behind `ops` (module declared `#[cfg(feature = "ops")]`
        // in lib.rs). Mirrors the `backup_verify_*` arm in `is_command`
        // exactly; keep the two in sync.
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_overview,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_policy,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_replication_overview,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_replication_status,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_get_retention_forecast,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_list_catalog,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_list_policies,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_list_queued_jobs,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_list_replicas,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_list_running_jobs,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_remove_replica,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_run_dr_drill,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_send_test_notification,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_set_immutability_lock,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_start_replication,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_test_channel,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_trigger_backup,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_update_policy,
        #[cfg(feature = "ops")]
        backup_verify_commands::backup_verify_verify_backup,
        probe_commands::cancel_check_run,
        #[cfg(feature = "ops")]
        powershell_session_commands::cancel_powershell_pipeline,
        probe_commands::check_all_connections,
        // ── t5-e7: Connection Clone ────────────────────────────────
        connection_clone_commands::clone_connection,
        #[cfg(feature = "ops")]
        powershell_session_commands::close_all_powershell_sessions,
        #[cfg(feature = "ops")]
        powershell_session_commands::close_powershell_session,
        // ── Raw TCP/UDP sockets ─────────────────────────────────────
        raw_socket_commands::connect_raw_socket,
        // ── RLogin ──────────────────────────────────────────────────
        rlogin_commands::connect_rlogin,
        #[cfg(feature = "ops")]
        powershell_session_commands::detach_powershell_session,
        raw_socket_commands::detach_raw_socket,
        rlogin_commands::diagnose_rlogin_connection,
        raw_socket_commands::disconnect_all_raw_sockets,
        rlogin_commands::disconnect_all_rlogin_sessions,
        raw_socket_commands::disconnect_raw_socket,
        rlogin_commands::disconnect_rlogin,
        #[cfg(feature = "ops")]
        powershell_session_commands::end_powershell_pipeline_input,
        #[cfg(feature = "ops")]
        powershell_session_commands::get_powershell_session,
        #[cfg(feature = "ops")]
        powershell_session_commands::get_powershell_session_capabilities,
        #[cfg(feature = "ops")]
        powershell_session_commands::get_powershell_session_diagnostics,
        #[cfg(feature = "ops")]
        powershell_session_commands::get_powershell_session_replay,
        #[cfg(feature = "ops")]
        powershell_session_commands::get_powershell_session_stats,
        raw_socket_commands::get_raw_socket_replay,
        raw_socket_commands::get_raw_socket_session_info,
        rlogin_commands::get_rlogin_output_snapshot,
        rlogin_commands::get_rlogin_session_info,
        #[cfg(feature = "ops")]
        powershell_session_commands::list_powershell_sessions,
        raw_socket_commands::list_raw_socket_sessions,
        rlogin_commands::list_rlogin_sessions,
        // ── Live PowerShell PSRP sessions (SSH, 15) ──────────────────
        #[cfg(feature = "ops")]
        powershell_session_commands::open_powershell_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_cancel_transfer,
        #[cfg(feature = "ops")]
        powershell_commands::ps_check_firewall_rules,
        #[cfg(feature = "ops")]
        powershell_commands::ps_check_winrm_service,
        #[cfg(feature = "ops")]
        powershell_commands::ps_cleanup,
        #[cfg(feature = "ops")]
        powershell_commands::ps_clear_events,
        #[cfg(feature = "ops")]
        powershell_commands::ps_copy_from_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_copy_to_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_copy_to_vm,
        #[cfg(feature = "ops")]
        powershell_commands::ps_create_jea_role_capability,
        #[cfg(feature = "ops")]
        powershell_commands::ps_diagnose_connection,
        #[cfg(feature = "ops")]
        powershell_commands::ps_disable_session_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_disconnect_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_enable_session_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_enter_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_execute_interactive_line,
        #[cfg(feature = "ops")]
        powershell_commands::ps_exit_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_certificate_info,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_cim_instances,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_dsc_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_dsc_resources,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_events,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_session_configurations,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_stats,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_transfer_progress,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_trusted_hosts,
        #[cfg(feature = "ops")]
        powershell_commands::ps_get_winrm_config,
        #[cfg(feature = "ops")]
        powershell_commands::ps_invoke_cim_method,
        #[cfg(feature = "ops")]
        powershell_commands::ps_invoke_command,
        #[cfg(feature = "ops")]
        powershell_commands::ps_invoke_command_fanout,
        #[cfg(feature = "ops")]
        powershell_commands::ps_invoke_command_vm,
        #[cfg(feature = "ops")]
        powershell_commands::ps_list_jea_endpoints,
        #[cfg(feature = "ops")]
        powershell_commands::ps_list_sessions,
        #[cfg(feature = "ops")]
        powershell_commands::ps_list_transfers,
        #[cfg(feature = "ops")]
        powershell_commands::ps_list_vms,
        #[cfg(feature = "ops")]
        powershell_commands::ps_measure_latency,
        #[cfg(feature = "ops")]
        powershell_commands::ps_new_cim_session,
        // ── PowerShell Remoting (53) — t40-e3-F1 ──────────────────────
        // Gated behind `ops` (module declared `#[cfg(feature = "ops")]`
        // in lib.rs). Mirrors the `ps_*` arm in `is_command` exactly;
        // keep the two in sync.
        #[cfg(feature = "ops")]
        powershell_commands::ps_new_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_reconnect_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_register_jea_endpoint,
        #[cfg(feature = "ops")]
        powershell_commands::ps_register_session_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_remove_all_sessions,
        #[cfg(feature = "ops")]
        powershell_commands::ps_remove_cim_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_remove_session,
        #[cfg(feature = "ops")]
        powershell_commands::ps_set_session_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_set_trusted_hosts,
        #[cfg(feature = "ops")]
        powershell_commands::ps_start_dsc_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_stop_command,
        #[cfg(feature = "ops")]
        powershell_commands::ps_tab_complete,
        #[cfg(feature = "ops")]
        powershell_commands::ps_test_dsc_configuration,
        #[cfg(feature = "ops")]
        powershell_commands::ps_test_wsman,
        #[cfg(feature = "ops")]
        powershell_commands::ps_unregister_jea_endpoint,
        #[cfg(feature = "ops")]
        powershell_commands::ps_unregister_session_configuration,
        probe_commands::rdp_probe,
        rlogin_commands::resize_rlogin,
        raw_socket_commands::send_raw_socket_data,
        rlogin_commands::send_rlogin_input,
        raw_socket_commands::shutdown_raw_socket_write,
        probe_commands::ssh_probe,
        #[cfg(feature = "ops")]
        powershell_session_commands::start_powershell_pipeline,
        // ── t5-e7b: Probes ─────────────────────────────────────────
        probe_commands::tcp_probe,
        #[cfg(feature = "ops")]
        powershell_session_commands::write_powershell_pipeline_input,
    ]
);

pub fn build() -> InvokeHandler {
    let llm = crate::llm_handler::build();
    let telegram = crate::telegram_handler::build();
    let vpn = sorng_commands_vpn::build();
    let a = build_a();
    let j = build_j();
    let b = build_b();
    let c = build_c();
    let d = build_d();
    let e = build_e();
    let f = build_f();
    let g = build_g();
    let h = build_h();
    let i = build_i();

    Box::new(move |invoke| {
        let command = invoke.message.command();
        if crate::llm_handler::is_command(command) {
            return llm(invoke);
        }
        if crate::telegram_handler::is_command(command) {
            return telegram(invoke);
        }
        if sorng_commands_vpn::is_command(command) {
            return vpn(invoke);
        }
        if is_command_a(command) {
            return a(invoke);
        }
        if is_command_j(command) {
            return j(invoke);
        }
        if is_command_b(command) {
            return b(invoke);
        }
        if is_command_c(command) {
            return c(invoke);
        }
        if is_command_d(command) {
            return d(invoke);
        }
        if is_command_e(command) {
            return e(invoke);
        }
        if is_command_f(command) {
            return f(invoke);
        }
        if is_command_g(command) {
            return g(invoke);
        }
        if is_command_h(command) {
            return h(invoke);
        }
        if is_command_i(command) {
            return i(invoke);
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::{
        is_command, is_command_a, is_command_b, is_command_c, is_command_d, is_command_e,
        is_command_f, is_command_g, is_command_h, is_command_i, is_command_j, GROUP_A_COMMANDS,
        GROUP_B_COMMANDS, GROUP_C_COMMANDS, GROUP_D_COMMANDS, GROUP_E_COMMANDS, GROUP_F_COMMANDS,
        GROUP_G_COMMANDS, GROUP_H_COMMANDS, GROUP_I_COMMANDS, GROUP_J_COMMANDS,
    };
    use std::collections::HashSet;

    const COMMAND_ROUTES: [fn(&str) -> bool; 13] = [
        is_command_a,
        is_command_j,
        is_command_b,
        is_command_c,
        is_command_d,
        is_command_e,
        is_command_f,
        is_command_g,
        is_command_h,
        is_command_i,
        sorng_commands_vpn::is_command,
        crate::telegram_handler::is_command,
        crate::llm_handler::is_command,
    ];

    const FOUNDATIONAL_SSH_COMMANDS: &[&str] = &[
        "connect_ssh",
        "ssh_respond_to_host_key_prompt",
        "start_shell",
        "execute_command",
        "execute_command_interactive",
        "execute_script",
        "execute_script_stream",
        "cancel_script_execution",
        "transfer_file_scp",
        "get_system_info",
        "monitor_process",
        "reattach_session",
        "send_ssh_input",
        "resize_ssh_shell",
        "setup_port_forward",
        "list_directory",
        "upload_file",
        "download_file",
        "disconnect_ssh",
        "get_session_info",
        "list_sessions",
        "validate_mixed_chain",
        "jump_hosts_to_mixed_chain",
        "proxy_chain_to_mixed_chain",
        "test_mixed_chain_connection",
    ];

    fn command_route_count(command: &str) -> usize {
        COMMAND_ROUTES.iter().filter(|route| route(command)).count()
    }

    #[test]
    fn runtime_capabilities_are_always_recognized_and_registered() {
        assert!(is_command("get_runtime_capabilities"));
        assert!(GROUP_A_COMMANDS.contains(&"get_runtime_capabilities"));
    }

    #[test]
    fn vnc_activity_and_ack_commands_are_recognized_and_registered() {
        for command in ["set_vnc_session_activity", "acknowledge_vnc_frame"] {
            assert!(is_command(command), "{command} is not publicly recognized");
            assert!(
                GROUP_J_COMMANDS.contains(&command),
                "{command} is not registered in the VNC command group"
            );
        }
    }

    #[test]
    fn app_data_compare_and_swap_is_recognized_and_registered() {
        assert!(is_command("compare_and_swap_app_data"));
        assert!(include_str!("core_handler.rs")
            .contains("storage_commands::compare_and_swap_app_data,"));
    }

    /// t74-e3. The `databases_encryption_status` probe is what makes
    /// encryption-at-rest visible in the Database Center and the
    /// Security panel. A command that is recognised but not registered
    /// (or vice versa) fails only at runtime, in the hands of a user
    /// who is already trying to find out whether their data is safe —
    /// so pin both halves here rather than relying on the frontend
    /// scanner, which cannot see a command no TS file calls yet.
    #[test]
    fn databases_encryption_probe_is_recognized_and_registered() {
        assert!(is_command("change_database_security"));
        assert!(GROUP_A_COMMANDS.contains(&"change_database_security"));
        assert_eq!(command_route_count("change_database_security"), 1);
        assert!(
            is_command("databases_encryption_status"),
            "the encryption-status probe is not publicly recognized"
        );
        assert!(
            GROUP_A_COMMANDS.contains(&"databases_encryption_status"),
            "the encryption-status probe is not in the generated handler list"
        );
        assert_eq!(
            command_route_count("databases_encryption_status"),
            1,
            "the encryption-status probe must route to exactly one handler"
        );
    }

    #[test]
    fn shortcut_ipc_is_scoped_recognized_and_registered() {
        for command in ["scan_shortcuts", "check_shortcut", "delete_shortcut"] {
            assert!(is_command(command), "{command} is not publicly recognized");
            assert!(
                GROUP_A_COMMANDS.contains(&command),
                "{command} is not registered in the core app-shell group"
            );
        }
        assert!(!is_command("delete_file"));
        assert!(!GROUP_A_COMMANDS.contains(&"delete_file"));
    }

    #[test]
    fn foundational_ssh_commands_are_exactly_routed_to_the_session_group() {
        for command in FOUNDATIONAL_SSH_COMMANDS {
            assert!(is_command(command), "{command} is not publicly recognized");
            assert!(
                !GROUP_A_COMMANDS.contains(command),
                "{command} leaked back into the foundational app-shell group"
            );
            assert!(
                GROUP_J_COMMANDS.contains(command),
                "{command} is not registered in the interactive-session group"
            );
            assert!(
                is_command_j(command),
                "{command} does not route to the interactive-session handler"
            );
            assert_eq!(
                command_route_count(command),
                1,
                "{command} must route to exactly one generated handler"
            );
        }
    }

    #[test]
    fn generated_command_groups_are_unique_recognized_and_exactly_routed() {
        let groups = [
            GROUP_A_COMMANDS,
            GROUP_J_COMMANDS,
            GROUP_B_COMMANDS,
            GROUP_C_COMMANDS,
            GROUP_D_COMMANDS,
            GROUP_E_COMMANDS,
            GROUP_F_COMMANDS,
            GROUP_G_COMMANDS,
            GROUP_H_COMMANDS,
            GROUP_I_COMMANDS,
            sorng_commands_vpn::COMMAND_NAMES,
        ];
        let mut seen = HashSet::new();

        for (expected_route, commands) in groups.iter().enumerate() {
            assert!(
                commands.len() <= 250,
                "command group {expected_route} exceeded the bounded macro size"
            );
            assert!(commands.windows(2).all(|pair| pair[0] < pair[1]));
            for command in *commands {
                assert!(
                    seen.insert(*command),
                    "{command} is registered in more than one command group"
                );
                assert!(is_command(command), "{command} is not publicly recognized");
                assert!(
                    COMMAND_ROUTES[expected_route](command),
                    "{command} was not routed to its registration group"
                );
                assert_eq!(
                    command_route_count(command),
                    1,
                    "{command} must route to exactly one generated handler"
                );
            }
        }

        let registered_count: usize = groups.iter().map(|commands| commands.len()).sum();
        assert_eq!(seen.len(), registered_count);

        let unknown = "__not_a_registered_core_command__";
        assert!(!is_command(unknown));
        assert_eq!(command_route_count(unknown), 0);
    }

    const RLOGIN_COMMANDS: &[&str] = &[
        "connect_rlogin",
        "send_rlogin_input",
        "resize_rlogin",
        "get_rlogin_output_snapshot",
        "get_rlogin_session_info",
        "list_rlogin_sessions",
        "disconnect_rlogin",
        "disconnect_all_rlogin_sessions",
        "diagnose_rlogin_connection",
    ];

    const RAW_SOCKET_COMMANDS: &[&str] = &[
        "connect_raw_socket",
        "attach_raw_socket",
        "detach_raw_socket",
        "disconnect_raw_socket",
        "disconnect_all_raw_sockets",
        "send_raw_socket_data",
        "shutdown_raw_socket_write",
        "get_raw_socket_session_info",
        "get_raw_socket_replay",
        "list_raw_socket_sessions",
    ];

    const ARD_COMMANDS: &[&str] = &[
        "connect_ard",
        "disconnect_ard",
        "disconnect_all_ard",
        "is_ard_connected",
        "send_ard_input",
        "set_ard_clipboard",
        "get_ard_clipboard",
        "set_ard_curtain_mode",
        "upload_ard_file",
        "download_ard_file",
        "list_ard_remote_dir",
        "get_ard_session_info",
        "list_ard_sessions",
        "get_ard_stats",
        "get_ard_logs",
        "reconnect_ard",
        "get_ard_runtime_capabilities",
        "launch_apple_account_screen_sharing",
    ];

    const SPICE_COMMANDS: &[&str] = &[
        "connect_spice",
        "disconnect_spice",
        "disconnect_all_spice",
        "is_spice_connected",
        "get_spice_session_info",
        "list_spice_sessions",
        "get_spice_session_stats",
        "send_spice_key_event",
        "send_spice_pointer_event",
        "send_spice_clipboard",
        "request_spice_update",
        "set_spice_resolution",
        "spice_redirect_usb",
        "spice_unredirect_usb",
        "prune_spice_sessions",
        "get_spice_session_count",
    ];

    const XDMCP_COMMANDS: &[&str] = &[
        "connect_xdmcp",
        "disconnect_xdmcp",
        "disconnect_all_xdmcp",
        "discover_xdmcp",
        "is_xdmcp_connected",
        "get_xdmcp_session_info",
        "list_xdmcp_sessions",
        "get_xdmcp_session_stats",
        "prune_xdmcp_sessions",
        "get_xdmcp_session_count",
    ];

    const X2GO_COMMANDS: &[&str] = &[
        "connect_x2go",
        "suspend_x2go",
        "terminate_x2go",
        "disconnect_x2go",
        "disconnect_all_x2go",
        "is_x2go_connected",
        "get_x2go_session_info",
        "list_x2go_sessions",
        "get_x2go_session_stats",
        "send_x2go_clipboard",
        "resize_x2go_display",
        "mount_x2go_folder",
        "unmount_x2go_folder",
        "prune_x2go_sessions",
        "get_x2go_session_count",
    ];

    const NX_COMMANDS: &[&str] = &[
        "connect_nx",
        "disconnect_nx",
        "disconnect_all_nx",
        "suspend_nx",
        "is_nx_connected",
        "get_nx_session_info",
        "list_nx_sessions",
        "get_nx_session_stats",
        "send_nx_key_event",
        "send_nx_pointer_event",
        "send_nx_clipboard",
        "resize_nx_display",
        "prune_nx_sessions",
        "get_nx_session_count",
    ];

    #[test]
    fn proxy_request_log_capacity_command_is_registered() {
        let command = "set_proxy_request_log_capacity";
        assert!(is_command(command));
        let registration = format!("http_commands::{command},");
        assert!(include_str!("core_handler.rs").contains(&registration));
    }

    #[test]
    fn only_full_master_key_rotation_is_exposed_and_used_by_the_frontend() {
        let source = include_str!("core_handler.rs");
        let legacy = "encryption_rotate_master_key";
        let full = "encryption_rotate_master_key_full";

        assert!(
            !is_command(legacy),
            "legacy partial rotation must remain unavailable"
        );
        assert!(!GROUP_A_COMMANDS.contains(&legacy));
        let legacy_registration = format!("encryption_commands::{legacy},");
        assert!(!source.contains(&legacy_registration));

        assert!(
            is_command(full),
            "full transactional rotation must be recognized"
        );
        assert!(GROUP_A_COMMANDS.contains(&full));
        let full_registration = format!("encryption_rotation_commands::{full},");
        assert!(source.contains(&full_registration));

        let hook = include_str!("../../../../src/hooks/settings/useEncryption.ts");
        assert_eq!(
            hook.matches("\"encryption_rotate_master_key_full\"")
                .count(),
            1,
            "the production hook must invoke the full command exactly once"
        );
        assert!(
            !hook.contains("\"encryption_rotate_master_key\""),
            "the production hook must not invoke the retired partial command"
        );
    }

    #[cfg(feature = "ops")]
    const POWERSHELL_SESSION_COMMANDS: &[&str] = &[
        "open_powershell_session",
        "attach_powershell_session",
        "detach_powershell_session",
        "close_powershell_session",
        "close_all_powershell_sessions",
        "start_powershell_pipeline",
        "write_powershell_pipeline_input",
        "end_powershell_pipeline_input",
        "cancel_powershell_pipeline",
        "get_powershell_session",
        "get_powershell_session_replay",
        "list_powershell_sessions",
        "get_powershell_session_capabilities",
        "get_powershell_session_stats",
        "get_powershell_session_diagnostics",
    ];

    #[test]
    fn raw_rlogin_and_ard_command_recognition_matches_handler_registration() {
        let source = include_str!("core_handler.rs");
        for (module, commands) in [
            ("rlogin_commands", RLOGIN_COMMANDS),
            ("raw_socket_commands", RAW_SOCKET_COMMANDS),
            ("ard_commands", ARD_COMMANDS),
        ] {
            for command in commands {
                assert!(is_command(command), "{command} missing from is_command");
                let registration = format!("{module}::{command},");
                assert!(
                    source.contains(&registration),
                    "{command} missing from generate_handler"
                );
            }
        }
    }

    #[test]
    fn ssh_terminal_replay_commands_preserve_legacy_and_register_snapshot() {
        let source = include_str!("core_handler.rs");
        for command in [
            "get_terminal_buffer",
            "clear_terminal_buffer",
            "get_terminal_buffer_snapshot",
        ] {
            assert!(is_command(command), "{command} missing from is_command");
            let registration = format!("ssh_commands::{command},");
            assert!(
                source.contains(&registration),
                "{command} missing from generate_handler"
            );
        }
    }

    #[test]
    fn unsigned_updater_command_is_recognized_and_registered() {
        let command = "updater_install_unsigned";
        assert!(is_command(command), "{command} missing from is_command");
        assert!(
            include_str!("core_handler.rs").contains("updater_commands::updater_install_unsigned,"),
            "{command} missing from generate_handler"
        );
    }

    #[test]
    fn rdp_binary_delivery_commands_are_recognized_and_registered() {
        let source = include_str!("core_handler.rs");
        for command in ["rdp_binary_ipc_preflight", "rdp_ack_frame_delivery"] {
            assert!(is_command(command), "{command} missing from is_command");
            let registration = format!("rdp_commands::{command},");
            assert!(
                source.contains(&registration),
                "{command} missing from generate_handler"
            );
        }
    }

    #[test]
    fn advanced_native_protocol_command_recognition_matches_handler_registration() {
        let source = include_str!("core_handler.rs");
        for (module, commands) in [
            ("spice_commands", SPICE_COMMANDS),
            ("xdmcp_commands", XDMCP_COMMANDS),
            ("x2go_commands", X2GO_COMMANDS),
            ("nx_commands", NX_COMMANDS),
        ] {
            for command in commands {
                assert!(is_command(command), "{command} missing from is_command");
                let registration = format!("{module}::{command},");
                assert!(
                    source.contains(&registration),
                    "{command} missing from generate_handler"
                );
            }
        }
        assert_eq!(SPICE_COMMANDS.len(), 16);
        assert_eq!(XDMCP_COMMANDS.len(), 10);
        assert_eq!(X2GO_COMMANDS.len(), 15);
        assert_eq!(NX_COMMANDS.len(), 14);
    }

    #[cfg(feature = "ops")]
    #[test]
    fn powershell_session_commands_are_recognized_and_registered_separately() {
        let source = include_str!("core_handler.rs");
        for command in POWERSHELL_SESSION_COMMANDS {
            assert!(is_command(command), "{command} missing from is_command");
            let registration = format!("powershell_session_commands::{command},");
            assert!(
                source.contains(&registration),
                "{command} missing from generate_handler"
            );
        }
        assert_eq!(POWERSHELL_SESSION_COMMANDS.len(), 15);
    }
}
