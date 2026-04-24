use sorng_rdp::rdp::session_runner::{effective_drive_redirections, should_register_rdpdr};
use sorng_rdp::rdp::settings::{ClipboardDirection, DriveRedirectionConfig, PrinterOutputMode, ResolvedSettings};
use sorng_rdp::rdp::RdpSettingsPayload;

fn base_settings() -> ResolvedSettings {
    ResolvedSettings::from_payload(&RdpSettingsPayload::default(), 1280, 720)
}

fn drive(name: &str, path: &str, read_only: bool, preferred_letter: Option<char>) -> DriveRedirectionConfig {
    DriveRedirectionConfig {
        name: name.to_string(),
        path: path.to_string(),
        read_only,
        preferred_letter,
    }
}

#[test]
fn disabled_drive_redirection_discards_configured_drives() {
    let mut settings = base_settings();
    settings.drive_redirection_enabled = false;
    settings.drive_redirections = vec![
        drive("Docs", "C:\\Docs", false, Some('D')),
        drive("Media", "D:\\Media", true, Some('M')),
    ];

    let drives = effective_drive_redirections(&settings);

    assert!(drives.is_empty(), "disabled drive redirection should drop configured drives");
    assert!(
        !should_register_rdpdr(&settings),
        "RDPDR should stay disabled when drives are configured but the drive flag is off"
    );
}

#[test]
fn enabled_drive_redirection_preserves_configured_drives() {
    let mut settings = base_settings();
    settings.drive_redirection_enabled = true;
    settings.drive_redirections = vec![
        drive("Docs", "C:\\Docs", false, Some('D')),
        drive("Media", "D:\\Media", true, Some('M')),
    ];

    let drives = effective_drive_redirections(&settings);

    assert_eq!(drives.len(), 2);
    assert_eq!(drives[0].name, "Docs");
    assert_eq!(drives[0].path, "C:\\Docs");
    assert!(!drives[0].read_only);
    assert_eq!(drives[0].preferred_letter, Some('D'));
    assert_eq!(drives[1].name, "Media");
    assert_eq!(drives[1].path, "D:\\Media");
    assert!(drives[1].read_only);
    assert_eq!(drives[1].preferred_letter, Some('M'));
    assert!(
        should_register_rdpdr(&settings),
        "enabled drive redirection with configured drives should register RDPDR"
    );
}

type FlagSetter = fn(&mut ResolvedSettings);

fn enable_printers(settings: &mut ResolvedSettings) {
    settings.printers_enabled = true;
}

fn enable_ports(settings: &mut ResolvedSettings) {
    settings.ports_enabled = true;
}

fn enable_smart_cards(settings: &mut ResolvedSettings) {
    settings.smart_cards_enabled = true;
}

#[test]
fn neighboring_device_flags_still_register_rdpdr_without_drives() {
    for (label, enable_flag) in [
        ("printers", enable_printers as FlagSetter),
        ("ports", enable_ports as FlagSetter),
        ("smart_cards", enable_smart_cards as FlagSetter),
    ] {
        let mut settings = base_settings();
        settings.drive_redirection_enabled = false;
        settings.drive_redirections = vec![drive("Docs", "C:\\Docs", false, Some('D'))];
        enable_flag(&mut settings);

        let drives = effective_drive_redirections(&settings);

        assert!(drives.is_empty(), "{label} should not preserve disabled drive mappings");
        assert!(
            should_register_rdpdr(&settings),
            "{label} should still cause RDPDR registration without enabled drives"
        );
    }
}

#[test]
fn clipboard_direction_defaults_to_bidirectional() {
    let settings = base_settings();

    assert!(settings.clipboard_enabled);
    assert_eq!(settings.clipboard_direction, ClipboardDirection::Bidirectional);
    assert!(settings.clipboard_direction.allows_client_to_server());
    assert!(settings.clipboard_direction.allows_server_to_client());
}

#[test]
fn disabled_clipboard_direction_turns_clipboard_channel_off() {
    let payload = serde_json::from_value::<RdpSettingsPayload>(serde_json::json!({
        "deviceRedirection": {
            "clipboard": true,
            "clipboardDirection": "disabled"
        }
    }))
    .expect("clipboard direction payload");

    let settings = ResolvedSettings::from_payload(&payload, 1280, 720);

    assert!(!settings.clipboard_enabled);
    assert_eq!(settings.clipboard_direction, ClipboardDirection::Disabled);
}

#[test]
fn one_way_clipboard_direction_preserves_channel_but_limits_flow() {
    let payload = serde_json::from_value::<RdpSettingsPayload>(serde_json::json!({
        "deviceRedirection": {
            "clipboard": true,
            "clipboardDirection": "server-to-client"
        }
    }))
    .expect("clipboard direction payload");

    let settings = ResolvedSettings::from_payload(&payload, 1280, 720);

    assert!(settings.clipboard_enabled);
    assert_eq!(settings.clipboard_direction, ClipboardDirection::ServerToClient);
    assert!(!settings.clipboard_direction.allows_client_to_server());
    assert!(settings.clipboard_direction.allows_server_to_client());
}

#[test]
fn printer_output_mode_defaults_to_spool_file() {
    let settings = base_settings();

    assert_eq!(settings.printer_output_mode, PrinterOutputMode::SpoolFile);
}

#[test]
fn printer_output_mode_roundtrips_from_payload() {
    let payload = serde_json::from_value::<RdpSettingsPayload>(serde_json::json!({
        "deviceRedirection": {
            "printers": true,
            "printerOutputMode": "native-print"
        }
    }))
    .expect("printer output mode payload");

    let settings = ResolvedSettings::from_payload(&payload, 1280, 720);

    assert!(settings.printers_enabled);
    assert_eq!(settings.printer_output_mode, PrinterOutputMode::NativePrint);
}

#[test]
fn audio_playback_defaults_to_local_output() {
    let settings = base_settings();

    assert!(settings.enable_audio_playback);
}

#[test]
fn remote_audio_playback_mode_disables_local_output() {
    let payload = serde_json::from_value::<RdpSettingsPayload>(serde_json::json!({
        "audio": {
            "playbackMode": "remote"
        }
    }))
    .expect("remote audio payload");

    let settings = ResolvedSettings::from_payload(&payload, 1280, 720);

    assert!(!settings.enable_audio_playback);
}

#[test]
fn disabled_audio_playback_mode_disables_local_output() {
    let payload = serde_json::from_value::<RdpSettingsPayload>(serde_json::json!({
        "audio": {
            "playbackMode": "disabled"
        }
    }))
    .expect("disabled audio payload");

    let settings = ResolvedSettings::from_payload(&payload, 1280, 720);

    assert!(!settings.enable_audio_playback);
}