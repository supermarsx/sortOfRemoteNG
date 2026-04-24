macro_rules! disabled_commands {
    ($($name:ident),* $(,)?) => {
        $(
            #[tauri::command]
            pub async fn $name() -> Result<(), String> {
                Err("RDP feature is not enabled. Rebuild with --features rdp".into())
            }
        )*
    };
}

disabled_commands!(
    connect_rdp,
    disconnect_rdp,
    attach_rdp_session,
    detach_rdp_session,
    rdp_send_input,
    rdp_get_frame_data,
    get_rdp_session_info,
    list_rdp_sessions,
    get_rdp_stats,
    detect_keyboard_layout,
    diagnose_rdp_connection,
    rdp_sign_out,
    rdp_force_reboot,
    reconnect_rdp_session,
    rdp_get_thumbnail,
    rdp_save_screenshot,
    get_rdp_logs,
    rdp_cert_trust_respond,
    rdp_clipboard_copy,
    rdp_clipboard_copy_files,
    rdp_clipboard_paste,
    rdp_toggle_feature,
);
