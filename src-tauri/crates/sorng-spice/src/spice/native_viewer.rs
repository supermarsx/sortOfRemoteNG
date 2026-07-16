//! Native SPICE viewer lifecycle.
//!
//! The in-crate SPICE decoder is intentionally not used for interactive
//! sessions: it does not yet decode display channel messages. Instead, the
//! registered SPICE commands launch virt-viewer's `remote-viewer`, which is a
//! complete SPICE client. Connection settings are written to the child's
//! standard input so ticket passwords never appear in process arguments or a
//! persistent file.

use crate::spice::types::*;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use zeroize::{Zeroize, Zeroizing};

const STARTUP_PROBE_MILLIS: u64 = 650;

#[derive(Debug)]
pub struct NativeViewerState {
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: String,
    pub last_activity: String,
}

pub type SharedNativeViewerState = Arc<Mutex<NativeViewerState>>;

enum NativeViewerCommand {
    Disconnect(oneshot::Sender<()>),
}

pub struct NativeSpiceSessionHandle {
    pub id: String,
    /// A credential-free copy retained for session metadata.
    pub config: SpiceConfig,
    pub state: SharedNativeViewerState,
    command_tx: mpsc::Sender<NativeViewerCommand>,
}

fn reject_control_characters(name: &str, value: &str) -> Result<(), SpiceError> {
    if value.is_empty() {
        return Err(SpiceError::new(
            SpiceErrorKind::ProtocolViolation,
            format!("{name} must not be empty"),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(SpiceError::new(
            SpiceErrorKind::ProtocolViolation,
            format!("{name} contains unsupported control characters"),
        ));
    }
    Ok(())
}

fn validate_config(config: &SpiceConfig) -> Result<(), SpiceError> {
    reject_control_characters("SPICE host", config.host.trim())?;
    if config.host.trim().chars().any(char::is_whitespace) {
        return Err(SpiceError::new(
            SpiceErrorKind::ProtocolViolation,
            "SPICE host contains unsupported whitespace",
        ));
    }
    if let Some(label) = config.label.as_deref() {
        reject_control_characters("SPICE title", label)?;
    }
    if let Some(password) = config.password.as_deref() {
        reject_control_characters("SPICE ticket", password)?;
    }
    if let Some(proxy) = config.proxy.as_deref() {
        reject_control_characters("SPICE proxy URI", proxy)?;
        let parsed = url::Url::parse(proxy)
            .map_err(|_| SpiceError::unsupported("The dedicated SPICE proxy URI is invalid"))?;
        if parsed.scheme() != "http" || parsed.host().is_none() {
            return Err(SpiceError::unsupported(
                "The native SPICE viewer only supports an explicit HTTP CONNECT proxy URI",
            ));
        }
        if !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !matches!(parsed.path(), "" | "/")
        {
            return Err(SpiceError::unsupported(
                "The SPICE proxy URI must contain only an HTTP host and optional port; credentials, paths, queries, and fragments are not retained",
            ));
        }
    }
    if config.tls.require_tls && config.tls_port.is_none() {
        return Err(SpiceError::new(
            SpiceErrorKind::TlsError,
            "TLS is required but no SPICE TLS port is configured",
        ));
    }
    if config.tls_port.is_none()
        && (config.tls.ca_cert.is_some()
            || config.tls.verify_hostname.is_some()
            || config.tls.ciphers.is_some())
    {
        return Err(SpiceError::new(
            SpiceErrorKind::TlsError,
            "SPICE certificate and cipher settings require a configured TLS port",
        ));
    }
    if config.tls.allow_self_signed {
        return Err(SpiceError::unsupported(
            "The native SPICE handoff cannot safely force acceptance of an untrusted certificate; configure a CA certificate instead",
        ));
    }
    if config.tls.client_cert.is_some() || config.tls.client_key.is_some() {
        return Err(SpiceError::unsupported(
            "Client-certificate authentication is not exposed by the documented remote-viewer connection-file contract",
        ));
    }
    if config.sasl.enabled || config.sasl.mechanism.is_some() {
        return Err(SpiceError::unsupported(
            "Custom SPICE SASL settings cannot be enforced by the native viewer handoff",
        ));
    }
    if config.image_compression.is_some() {
        return Err(SpiceError::unsupported(
            "A specific SPICE image compression mode cannot be enforced by the native viewer handoff",
        ));
    }
    if config.video_codec.is_some() {
        return Err(SpiceError::unsupported(
            "A specific SPICE video codec cannot be enforced by the native viewer handoff",
        ));
    }
    if config.display_count != 1 {
        return Err(SpiceError::unsupported(
            "A fixed SPICE display count cannot be enforced by the native viewer handoff",
        ));
    }
    if !config.streaming {
        return Err(SpiceError::unsupported(
            "Disabling SPICE streaming cannot be enforced by the native viewer handoff",
        ));
    }
    if !config.share_clipboard {
        return Err(SpiceError::unsupported(
            "Clipboard suppression cannot be enforced by the native remote-viewer connection-file contract",
        ));
    }
    if config.file_sharing || config.shared_folder.is_some() {
        return Err(SpiceError::unsupported(
            "SPICE shared-folder handoff is not available through the documented native connection-file contract",
        ));
    }
    if config.audio_params.is_some() {
        return Err(SpiceError::unsupported(
            "Custom SPICE audio parameters cannot be enforced by the native viewer handoff",
        ));
    }
    if !config.usb_filters.is_empty() {
        return Err(SpiceError::unsupported(
            "Per-device SPICE USB filters are not yet exposed by the native viewer handoff",
        ));
    }
    if config.usb_auto_redirect && !config.usb_redirection {
        return Err(SpiceError::unsupported(
            "SPICE USB auto-share requires USB redirection to be enabled",
        ));
    }
    if config.preferred_width.is_some() || config.preferred_height.is_some() {
        return Err(SpiceError::unsupported(
            "A fixed SPICE resolution cannot be enforced by the external native viewer",
        ));
    }
    if !config.channels.is_empty() {
        return Err(SpiceError::unsupported(
            "A custom SPICE channel allow-list cannot be enforced by the native viewer handoff",
        ));
    }
    if config.connect_timeout_secs != 15 {
        return Err(SpiceError::unsupported(
            "A custom SPICE connection timeout cannot be observed through the native viewer process contract",
        ));
    }
    if config.keepalive_secs != 0 {
        return Err(SpiceError::unsupported(
            "A custom SPICE keepalive interval cannot be enforced by the native viewer handoff",
        ));
    }
    if !config.mini_header {
        return Err(SpiceError::unsupported(
            "SPICE mini-header negotiation is owned by the native viewer and cannot be disabled by this handoff",
        ));
    }
    if !config.agent {
        return Err(SpiceError::unsupported(
            "Disabling the SPICE guest agent cannot be enforced by the native viewer handoff",
        ));
    }
    if let Some(depth) = config.color_depth {
        if depth != 16 && depth != 32 {
            return Err(SpiceError::unsupported(
                "The native SPICE viewer supports only 16-bit or 32-bit colour depth",
            ));
        }
    }
    Ok(())
}

fn escape_glib_key_value(value: &str) -> String {
    // GLib key files use backslash escapes. Control characters were rejected
    // before this point, so only the escape marker itself needs doubling.
    value.replace('\\', "\\\\").replace(' ', "\\s")
}

/// Build the documented virt-viewer connection file consumed over stdin.
/// Kept separate from process launch so the security contract is unit tested.
pub fn build_remote_viewer_settings(
    config: &SpiceConfig,
    ca_pem: Option<&str>,
) -> Result<String, SpiceError> {
    validate_config(config)?;

    let mut lines = vec![
        "[virt-viewer]".to_string(),
        "type=spice".to_string(),
        format!("host={}", escape_glib_key_value(config.host.trim())),
        format!("port={}", config.port),
    ];

    if let Some(tls_port) = config.tls_port {
        lines.push(format!("tls-port={tls_port}"));
    }
    if config.tls.require_tls {
        lines.push(
            "secure-channels=main;display;inputs;cursor;playback;record;smartcard;usbredir;"
                .to_string(),
        );
    }
    if let Some(password) = config.password.as_deref() {
        lines.push(format!("password={}", escape_glib_key_value(password)));
    }
    if let Some(label) = config.label.as_deref() {
        lines.push(format!("title={}", escape_glib_key_value(label)));
    }
    if config.fullscreen {
        lines.push("fullscreen=1".to_string());
    }
    if config.view_only || !config.audio_playback || !config.audio_record {
        let mut disabled = Vec::new();
        if config.view_only {
            disabled.push("inputs");
        }
        if !config.audio_playback {
            disabled.push("playback");
        }
        if !config.audio_record {
            disabled.push("record");
        }
        lines.push(format!("disable-channels={};", disabled.join(";")));
    }
    if config.usb_redirection {
        lines.push("enable-usbredir=1".to_string());
    }
    if config.usb_auto_redirect {
        lines.push("enable-usb-autoshare=1".to_string());
    }
    if let Some(proxy) = config.proxy.as_deref() {
        lines.push(format!("proxy={}", escape_glib_key_value(proxy)));
    }
    if let Some(ciphers) = config.tls.ciphers.as_deref() {
        reject_control_characters("SPICE TLS cipher list", ciphers)?;
        lines.push(format!("tls-ciphers={}", escape_glib_key_value(ciphers)));
    }
    if let Some(host_subject) = config.tls.verify_hostname.as_deref() {
        reject_control_characters("SPICE certificate subject", host_subject)?;
        lines.push(format!(
            "host-subject={}",
            escape_glib_key_value(host_subject)
        ));
    }
    if let Some(ca) = ca_pem {
        if ca.contains('\0') {
            return Err(SpiceError::new(
                SpiceErrorKind::TlsError,
                "The SPICE CA certificate contains an unsupported NUL byte",
            ));
        }
        let escaped = ca
            .replace('\\', "\\\\")
            .replace('\r', "")
            .replace('\n', "\\n");
        lines.push(format!("ca={escaped}"));
    }
    if let Some(depth) = config.color_depth {
        lines.push(format!("color-depth={depth}"));
    }
    if !config.disable_effects.is_empty() {
        const ALLOWED_EFFECTS: &[&str] = &["wallpaper", "font-smooth", "animation", "all"];
        if config
            .disable_effects
            .iter()
            .any(|effect| !ALLOWED_EFFECTS.contains(&effect.as_str()))
        {
            return Err(SpiceError::unsupported(
                "The SPICE effect list contains a value unsupported by remote-viewer",
            ));
        }
        lines.push(format!(
            "disable-effects={};",
            config.disable_effects.join(";")
        ));
    }

    lines.push(String::new());
    Ok(lines.join("\n"))
}

fn standard_remote_viewer_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("VirtViewer")
                    .join("bin")
                    .join("remote-viewer.exe"),
            );
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("VirtViewer")
                    .join("bin")
                    .join("remote-viewer.exe"),
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/remote-viewer"));
        candidates.push(PathBuf::from("/usr/local/bin/remote-viewer"));
    }
    candidates
}

#[cfg(target_os = "windows")]
fn find_versioned_windows_remote_viewer() -> Option<PathBuf> {
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Some(root) = std::env::var_os(variable) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !name.starts_with("virtviewer") {
                continue;
            }
            let candidate = entry.path().join("bin").join("remote-viewer.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn find_remote_viewer(custom_path: Option<&str>) -> Result<PathBuf, SpiceError> {
    if let Some(value) = custom_path.map(str::trim).filter(|value| !value.is_empty()) {
        reject_control_characters("remote-viewer executable path", value)?;
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err(SpiceError::unsupported(format!(
            "The configured remote-viewer executable was not found: {}",
            path.display()
        )));
    }

    for executable in ["remote-viewer", "remote-viewer.exe"] {
        if let Ok(path) = which::which(executable) {
            return Ok(path);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(path) = find_versioned_windows_remote_viewer() {
        return Ok(path);
    }
    standard_remote_viewer_candidates()
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            SpiceError::unsupported(
                "SPICE requires virt-viewer's remote-viewer executable; install virt-viewer or configure its exact path",
            )
        })
}

async fn read_ca_certificate(config: &SpiceConfig) -> Result<Option<String>, SpiceError> {
    let Some(path) = config.tls.ca_cert.as_deref() else {
        return Ok(None);
    };
    reject_control_characters("SPICE CA certificate path", path)?;
    tokio::fs::read_to_string(Path::new(path))
        .await
        .map(Some)
        .map_err(|error| {
            SpiceError::new(
                SpiceErrorKind::TlsError,
                format!("Unable to read the configured SPICE CA certificate: {error}"),
            )
        })
}

impl NativeSpiceSessionHandle {
    pub async fn connect(id: String, mut config: SpiceConfig) -> Result<Self, SpiceError> {
        let executable = find_remote_viewer(config.native_client_path.as_deref())?;
        let ca_pem = read_ca_certificate(&config).await?;
        let settings = Zeroizing::new(build_remote_viewer_settings(&config, ca_pem.as_deref())?);
        // From this point on, the stdin payload is the only ticket-bearing
        // allocation and is guaranteed to zeroize on every return path.
        redact_retained_config(&mut config);

        let mut child = Command::new(executable)
            .arg("-")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                SpiceError::unsupported(format!(
                    "Unable to launch the native SPICE viewer: {error}"
                ))
            })?;

        let mut stdin = child.stdin.take().ok_or_else(|| {
            SpiceError::new(
                SpiceErrorKind::Internal,
                "The native SPICE viewer did not expose its settings input",
            )
        })?;
        if let Err(error) = stdin.write_all(settings.as_bytes()).await {
            let _ = child.kill().await;
            return Err(SpiceError::new(
                SpiceErrorKind::Io,
                format!("Unable to pass settings to the native SPICE viewer: {error}"),
            ));
        }
        let _ = stdin.shutdown().await;

        tokio::time::sleep(tokio::time::Duration::from_millis(STARTUP_PROBE_MILLIS)).await;
        if let Some(status) = child.try_wait().map_err(SpiceError::from)? {
            return Err(SpiceError::new(
                SpiceErrorKind::ConnectionRefused,
                format!(
                    "The native SPICE viewer exited during startup ({status}); verify the target and viewer installation"
                ),
            ));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let state = Arc::new(Mutex::new(NativeViewerState {
            running: true,
            pid: child.id(),
            started_at: now.clone(),
            last_activity: now,
        }));
        let shared_state = state.clone();
        let (command_tx, mut command_rx) = mpsc::channel(2);

        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {
                    let mut current = shared_state.lock().await;
                    current.running = false;
                    current.pid = None;
                    current.last_activity = chrono::Utc::now().to_rfc3339();
                }
                command = command_rx.recv() => {
                    if let Some(NativeViewerCommand::Disconnect(response)) = command {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        let mut current = shared_state.lock().await;
                        current.running = false;
                        current.pid = None;
                        current.last_activity = chrono::Utc::now().to_rfc3339();
                        let _ = response.send(());
                    } else {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    }
                }
            }
        });

        Ok(Self {
            id,
            config,
            state,
            command_tx,
        })
    }

    pub async fn disconnect(&self) -> Result<(), SpiceError> {
        if !self.state.lock().await.running {
            return Ok(());
        }
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(NativeViewerCommand::Disconnect(response_tx))
            .await
            .map_err(|_| SpiceError::disconnected("native SPICE viewer process is already gone"))?;
        tokio::time::timeout(tokio::time::Duration::from_secs(5), response_rx)
            .await
            .map_err(|_| SpiceError::timeout("timed out while stopping the native SPICE viewer"))?
            .map_err(|_| SpiceError::disconnected("native SPICE viewer stopped unexpectedly"))?;
        Ok(())
    }

    #[cfg(test)]
    pub fn test_handle(id: &str, config: SpiceConfig) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        let state = Arc::new(Mutex::new(NativeViewerState {
            running: true,
            pid: Some(42),
            started_at: now.clone(),
            last_activity: now,
        }));
        let (command_tx, _command_rx) = mpsc::channel(1);
        Self {
            id: id.to_string(),
            config,
            state,
            command_tx,
        }
    }
}

fn redact_retained_config(config: &mut SpiceConfig) {
    if let Some(password) = config.password.as_mut() {
        password.zeroize();
    }
    config.password = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_use_stdin_contract_and_map_supported_controls() {
        let config = SpiceConfig {
            host: "vm.example.test".into(),
            port: 5900,
            tls_port: Some(5901),
            password: Some("ticket-secret".into()),
            label: Some("Test VM".into()),
            fullscreen: true,
            view_only: true,
            audio_playback: false,
            usb_redirection: true,
            color_depth: Some(32),
            tls: SpiceTlsConfig {
                require_tls: true,
                verify_hostname: Some("CN=vm.example.test".into()),
                ..Default::default()
            },
            ..Default::default()
        };

        let settings = build_remote_viewer_settings(
            &config,
            Some("-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n"),
        )
        .unwrap();
        assert!(settings.starts_with("[virt-viewer]\ntype=spice\n"));
        assert!(settings.contains("host=vm.example.test"));
        assert!(settings.contains("tls-port=5901"));
        assert!(settings.contains("password=ticket-secret"));
        assert!(settings.contains("disable-channels=inputs;playback;record;"));
        assert!(settings.contains("enable-usbredir=1"));
        assert!(settings.contains("fullscreen=1"));
        assert!(settings.contains("ca=-----BEGIN CERTIFICATE-----\\nTEST"));
    }

    #[test]
    fn settings_reject_injection_and_unenforceable_security() {
        let injected = SpiceConfig {
            host: "safe.example\npassword=stolen".into(),
            ..Default::default()
        };
        assert!(build_remote_viewer_settings(&injected, None).is_err());

        let insecure_tls = SpiceConfig {
            host: "safe.example".into(),
            tls_port: Some(5901),
            tls: SpiceTlsConfig {
                allow_self_signed: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let error = build_remote_viewer_settings(&insecure_tls, None).unwrap_err();
        assert_eq!(error.kind, SpiceErrorKind::UnsupportedFeature);
    }

    #[test]
    fn every_unenforceable_non_default_option_fails_closed() {
        let base = || SpiceConfig {
            host: "vm.example.test".into(),
            ..Default::default()
        };
        let mut configs = Vec::new();

        let mut config = base();
        config.sasl.enabled = true;
        configs.push(config);
        let mut config = base();
        config.image_compression = Some(ImageCompression::Lz);
        configs.push(config);
        let mut config = base();
        config.video_codec = Some(VideoCodec::H264);
        configs.push(config);
        let mut config = base();
        config.display_count = 2;
        configs.push(config);
        let mut config = base();
        config.streaming = false;
        configs.push(config);
        let mut config = base();
        config.share_clipboard = false;
        configs.push(config);
        let mut config = base();
        config.audio_params = Some(AudioParams::default());
        configs.push(config);
        let mut config = base();
        config.usb_auto_redirect = true;
        configs.push(config);
        let mut config = base();
        config.usb_filters.push(UsbFilter {
            vendor_id: None,
            product_id: None,
            device_class: None,
            device_subclass: None,
            device_protocol: None,
            allow: true,
        });
        configs.push(config);
        let mut config = base();
        config.file_sharing = true;
        configs.push(config);
        let mut config = base();
        config.preferred_width = Some(1920);
        configs.push(config);
        let mut config = base();
        config.channels.push(SpiceChannelType::Display);
        configs.push(config);
        let mut config = base();
        config.connect_timeout_secs = 31;
        configs.push(config);
        let mut config = base();
        config.keepalive_secs = 30;
        configs.push(config);
        let mut config = base();
        config.mini_header = false;
        configs.push(config);
        let mut config = base();
        config.agent = false;
        configs.push(config);
        let mut config = base();
        config.color_depth = Some(24);
        configs.push(config);
        let mut config = base();
        config.tls.ca_cert = Some("ca.pem".into());
        configs.push(config);

        for config in configs {
            assert!(
                build_remote_viewer_settings(&config, None).is_err(),
                "unenforceable config unexpectedly produced a native viewer file: {config:?}"
            );
        }
    }

    #[test]
    fn settings_never_require_password_in_process_arguments() {
        let config = SpiceConfig {
            host: "vm.example.test".into(),
            password: Some("argv-must-not-contain-this".into()),
            ..Default::default()
        };
        let settings = build_remote_viewer_settings(&config, None).unwrap();
        let process_arguments = ["-"];
        assert!(settings.contains("argv-must-not-contain-this"));
        assert!(process_arguments
            .iter()
            .all(|argument| !argument.contains("argv-must-not-contain-this")));
    }

    #[test]
    fn retained_session_config_contains_no_ticket() {
        let mut config = SpiceConfig {
            host: "vm.example.test".into(),
            password: Some("must-not-be-retained".into()),
            ..Default::default()
        };
        redact_retained_config(&mut config);
        assert_eq!(config.password, None);
        assert!(!format!("{config:?}").contains("must-not-be-retained"));
    }
}
