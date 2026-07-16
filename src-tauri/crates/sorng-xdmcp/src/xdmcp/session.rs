//! Native XDMCP session lifecycle.
//!
//! XDMCP is initiated by an X server, not by a framebuffer widget. The session
//! therefore launches a real local X server (`Xephyr`, `VcXsrv`, `Xming`, or an
//! explicitly configured compatible binary) and lets that implementation own
//! the complete RFC 1198 exchange and rendering lifecycle.

use crate::xdmcp::types::*;
use crate::xdmcp::xserver::{build_x_server_args, find_available_display, find_x_server};
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

const STARTUP_PROBE_MILLIS: u64 = 650;

enum SessionCommand {
    Disconnect(oneshot::Sender<()>),
}

#[derive(Debug)]
pub struct SharedSessionState {
    pub state: XdmcpSessionState,
    pub display_number: Option<u32>,
    pub session_id: Option<u32>,
    pub display_manager: Option<String>,
    pub display_width: u32,
    pub display_height: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub keepalive_count: u64,
    pub started_at: String,
    pub last_activity: String,
    pub x_server_pid: Option<u32>,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

pub struct XdmcpSessionHandle {
    pub id: String,
    pub config: XdmcpConfig,
    command_tx: mpsc::Sender<SessionCommand>,
    pub state: SharedState,
}

fn validate_host(host: &str) -> Result<(), XdmcpError> {
    let normalized_host = host.trim();
    if normalized_host.is_empty() {
        return Err(XdmcpError::connection_failed(
            "An XDMCP display-manager host is required",
        ));
    }
    if normalized_host.starts_with('-')
        || host.chars().any(char::is_control)
        || normalized_host.chars().any(char::is_whitespace)
    {
        return Err(XdmcpError::connection_failed(
            "The XDMCP display-manager host contains unsafe option or control syntax",
        ));
    }
    Ok(())
}

fn validate_native_launch(config: &XdmcpConfig) -> Result<(), XdmcpError> {
    if !config.acknowledge_insecure_transport {
        return Err(XdmcpError::new(
            XdmcpErrorKind::AuthenticationFailed,
            "XDMCP is unauthenticated and unencrypted. Explicitly acknowledge the insecure transport before launching this session.",
        ));
    }
    validate_host(&config.host)?;
    if config.port == 0 {
        return Err(XdmcpError::connection_failed(
            "The XDMCP UDP port must be between 1 and 65535",
        ));
    }
    if !matches!(config.auth_type, None | Some(XdmcpAuthType::None))
        || config
            .auth_data
            .as_ref()
            .is_some_and(|data| !data.is_empty())
    {
        return Err(XdmcpError::new(
            XdmcpErrorKind::AuthenticationFailed,
            "XDM-AUTHORIZATION and MIT-MAGIC-COOKIE launch data are not supported because placing their secret material in process arguments would expose it",
        ));
    }
    if config.broadcast_address.is_some() {
        return Err(XdmcpError::x_server(
            "A specific XDMCP broadcast address cannot be enforced by the native X server; use its standard broadcast mode or a direct host",
        ));
    }
    if config
        .x_server_extra_args
        .as_ref()
        .is_some_and(|args| !args.is_empty())
    {
        return Err(XdmcpError::x_server(
            "Arbitrary X server arguments are disabled for saved sessions because process arguments are system-visible",
        ));
    }
    if config.connect_timeout.unwrap_or(30) != 30 {
        return Err(XdmcpError::x_server(
            "A custom XDMCP connect timeout cannot be observed through the native X server process contract",
        ));
    }
    if config.keepalive_interval.unwrap_or(60) != 60 {
        return Err(XdmcpError::x_server(
            "A custom XDMCP keepalive interval cannot be enforced by the native X server handoff",
        ));
    }
    if config.retry_count.unwrap_or(3) != 3 {
        return Err(XdmcpError::x_server(
            "A custom XDMCP retry count cannot be enforced by the native X server handoff",
        ));
    }
    if config.color_depth.unwrap_or(24) != 24 {
        return Err(XdmcpError::x_server(
            "A non-default XDMCP colour depth cannot be enforced by the supported visible native X servers",
        ));
    }

    let server_type = config
        .x_server_type
        .as_ref()
        .unwrap_or(&XServerType::Xephyr);
    match server_type {
        XServerType::Xephyr => {
            #[cfg(target_os = "windows")]
            return Err(XdmcpError::x_server(
                "Xephyr is not supported on Windows; select VcXsrv, Xming, or a compatible custom X server",
            ));
        }
        XServerType::VcXsrv | XServerType::Xming => {
            #[cfg(not(target_os = "windows"))]
            return Err(XdmcpError::x_server(
                "VcXsrv and Xming are Windows X servers; select Xephyr or a compatible custom X server on this platform",
            ));
        }
        XServerType::Custom(_) => {}
        XServerType::Xorg => {
            return Err(XdmcpError::x_server(
                "Launching a full Xorg server requires privileged display-device ownership and is not supported by the in-app session lifecycle",
            ));
        }
        XServerType::XWayland => {
            return Err(XdmcpError::x_server(
                "XWayland does not provide the required XDMCP query lifecycle",
            ));
        }
        XServerType::Xvfb => {
            return Err(XdmcpError::x_server(
                "Xvfb is headless and cannot provide the required user-visible XDMCP session",
            ));
        }
        XServerType::MobaXterm => {
            return Err(XdmcpError::x_server(
                "MobaXterm does not expose a stable standalone XDMCP process contract; use VcXsrv, Xming, or a compatible custom X server",
            ));
        }
    }
    Ok(())
}

impl XdmcpSessionHandle {
    pub async fn connect(id: String, config: XdmcpConfig) -> Result<Self, XdmcpError> {
        validate_native_launch(&config)?;

        let server_type = config.x_server_type.clone().unwrap_or(XServerType::Xephyr);
        let executable = find_x_server(&server_type, config.x_server_path.as_deref())?;
        let display_number = config
            .display_number
            .unwrap_or_else(|| find_available_display(10));
        let width = config.resolution_width.unwrap_or(1024).clamp(320, 16_384);
        let height = config.resolution_height.unwrap_or(768).clamp(200, 16_384);
        let depth = config.color_depth.unwrap_or(24);
        if !matches!(depth, 8 | 16 | 24 | 32) {
            return Err(XdmcpError::x_server(
                "XDMCP colour depth must be 8, 16, 24, or 32 bits",
            ));
        }
        let query_type = config.query_type.unwrap_or(QueryType::Direct);
        let args = build_x_server_args(
            &server_type,
            display_number,
            width,
            height,
            depth,
            config.host.trim(),
            config.port,
            query_type,
            config.fullscreen.unwrap_or(false),
            &[],
        );

        // Arguments contain only display geometry, host, and port. Secrets are
        // categorically rejected above and are never placed in argv or logs.
        let mut child = Command::new(executable)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                XdmcpError::x_server(format!("Unable to launch the local X server: {error}"))
            })?;

        tokio::time::sleep(tokio::time::Duration::from_millis(STARTUP_PROBE_MILLIS)).await;
        if let Some(status) = child.try_wait().map_err(XdmcpError::from)? {
            return Err(XdmcpError::x_server(format!(
                "The local X server exited during startup ({status}); verify the selected binary, local display environment, and XDMCP target"
            )));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let state = Arc::new(Mutex::new(SharedSessionState {
            state: XdmcpSessionState::Running,
            display_number: Some(display_number),
            // The native X server owns the XDMCP Accept session id and does not
            // expose it through the process contract.
            session_id: None,
            display_manager: Some(config.host.trim().to_string()),
            display_width: width,
            display_height: height,
            // Native process telemetry is intentionally not fabricated.
            bytes_sent: 0,
            bytes_received: 0,
            packets_sent: 0,
            packets_received: 0,
            keepalive_count: 0,
            started_at: now.clone(),
            last_activity: now,
            x_server_pid: child.id(),
        }));
        let shared_state = state.clone();
        let (command_tx, mut command_rx) = mpsc::channel(2);

        tokio::spawn(async move {
            tokio::select! {
                status = child.wait() => {
                    let mut current = shared_state.lock().await;
                    current.state = match status {
                        Ok(exit) if exit.success() => XdmcpSessionState::Ended,
                        _ => XdmcpSessionState::Failed,
                    };
                    current.x_server_pid = None;
                    current.last_activity = chrono::Utc::now().to_rfc3339();
                }
                command = command_rx.recv() => {
                    if let Some(SessionCommand::Disconnect(response)) = command {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        let mut current = shared_state.lock().await;
                        current.state = XdmcpSessionState::Ended;
                        current.x_server_pid = None;
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
            command_tx,
            state,
        })
    }

    pub async fn disconnect(&self) -> Result<(), XdmcpError> {
        if !matches!(self.state.lock().await.state, XdmcpSessionState::Running) {
            return Ok(());
        }
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(SessionCommand::Disconnect(response_tx))
            .await
            .map_err(|_| XdmcpError::disconnected("the local X server process is already gone"))?;
        tokio::time::timeout(tokio::time::Duration::from_secs(5), response_rx)
            .await
            .map_err(|_| XdmcpError::timeout("timed out while stopping the local X server"))?
            .map_err(|_| XdmcpError::disconnected("the local X server stopped unexpectedly"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_silent_insecure_launch() {
        let config = XdmcpConfig {
            host: "display.example.test".into(),
            ..Default::default()
        };
        let error = validate_native_launch(&config).unwrap_err();
        assert_eq!(error.kind, XdmcpErrorKind::AuthenticationFailed);
        assert!(error.message.contains("unauthenticated and unencrypted"));
    }

    #[test]
    fn rejects_secret_auth_and_system_visible_extra_arguments() {
        let auth = XdmcpConfig {
            host: "display.example.test".into(),
            acknowledge_insecure_transport: true,
            auth_type: Some(XdmcpAuthType::XdmAuthorization),
            auth_data: Some(vec![1, 2, 3]),
            ..Default::default()
        };
        assert_eq!(
            validate_native_launch(&auth).unwrap_err().kind,
            XdmcpErrorKind::AuthenticationFailed
        );

        let args = XdmcpConfig {
            host: "display.example.test".into(),
            acknowledge_insecure_transport: true,
            x_server_extra_args: Some(vec!["-cookie".into(), "secret".into()]),
            ..Default::default()
        };
        assert_eq!(
            validate_native_launch(&args).unwrap_err().kind,
            XdmcpErrorKind::XServerError
        );
    }

    #[test]
    fn rejects_option_like_and_control_bearing_hosts_before_launch() {
        for host in [
            "-query",
            "--help",
            "display.example\ttest",
            "display.example\ntest",
            "display.example.test\n",
            "display.example\0test",
        ] {
            let error = validate_host(host).unwrap_err();
            assert_eq!(error.kind, XdmcpErrorKind::ConnectionFailed);
            assert!(error.message.contains("unsafe option or control syntax"));
        }

        for host in [
            "display-manager.example.test",
            "192.0.2.25",
            "2001:db8::25",
            "[2001:db8::25]",
        ] {
            validate_host(host).unwrap();
        }
    }

    #[test]
    fn rejects_headless_and_unsupported_servers() {
        for server_type in [
            XServerType::Xvfb,
            XServerType::Xorg,
            XServerType::XWayland,
            XServerType::MobaXterm,
        ] {
            let config = XdmcpConfig {
                host: "display.example.test".into(),
                acknowledge_insecure_transport: true,
                x_server_type: Some(server_type),
                ..Default::default()
            };
            assert_eq!(
                validate_native_launch(&config).unwrap_err().kind,
                XdmcpErrorKind::XServerError
            );
        }
    }

    #[test]
    fn rejects_unenforceable_native_process_tuning() {
        let base = || XdmcpConfig {
            host: "display.example.test".into(),
            acknowledge_insecure_transport: true,
            x_server_type: Some(XServerType::Custom("test-xserver".into())),
            ..Default::default()
        };

        let mut broadcast_address = base();
        broadcast_address.broadcast_address = Some("192.0.2.255".into());
        assert!(validate_native_launch(&broadcast_address).is_err());

        let mut timeout = base();
        timeout.connect_timeout = Some(12);
        assert!(validate_native_launch(&timeout).is_err());

        let mut keepalive = base();
        keepalive.keepalive_interval = Some(15);
        assert!(validate_native_launch(&keepalive).is_err());

        let mut retries = base();
        retries.retry_count = Some(9);
        assert!(validate_native_launch(&retries).is_err());

        let mut color_depth = base();
        color_depth.color_depth = Some(16);
        let error = validate_native_launch(&color_depth).unwrap_err();
        assert_eq!(error.kind, XdmcpErrorKind::XServerError);
        assert!(error.message.contains("colour depth"));
    }
}
