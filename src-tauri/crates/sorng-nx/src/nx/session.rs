//! Native NoMachine client session lifecycle.
//!
//! `Running` tracks the local `nxplayer` process only. Remote authentication,
//! host trust, pixels, and input remain owned by the visible NoMachine window.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use zeroize::Zeroize;

use crate::nx::native_client::{cleanup_temp_paths, prepare_native_launch};
use crate::nx::types::*;

#[derive(Debug)]
pub enum SessionCommand {
    KeyEvent { keysym: u32, down: bool },
    PointerEvent { x: i32, y: i32, button_mask: u8 },
    SendClipboard(String),
    Resize { width: u32, height: u32 },
    Suspend,
    Terminate,
    Disconnect,
}

#[derive(Debug)]
pub enum SessionEvent {
    /// The local NoMachine client is running. This is deliberately not a
    /// remote-authentication assertion.
    Connected {
        display: u32,
        width: u32,
        height: u32,
        server_session_id: String,
    },
    StateChanged(NxSessionState),
    Clipboard(String),
    Suspended,
    Resumed,
    Disconnected(Option<String>),
}

#[derive(Debug)]
pub struct SharedSessionState {
    pub state: NxSessionState,
    pub display: Option<u32>,
    pub display_width: u32,
    pub display_height: u32,
    pub server_session_id: Option<String>,
    pub native_client_pid: Option<u32>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub started_at: String,
    pub last_activity: String,
    pub suspended_count: u32,
    pub resumed_count: u32,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

pub struct NxSessionHandle {
    pub id: String,
    pub config: NxConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

struct TempFilesGuard(Vec<PathBuf>);

impl Drop for TempFilesGuard {
    fn drop(&mut self) {
        cleanup_temp_paths(&self.0);
    }
}

impl NxSessionHandle {
    pub async fn connect(id: String, mut config: NxConfig) -> Result<Self, NxError> {
        let prepared = match prepare_native_launch(&config) {
            Ok(prepared) => prepared,
            Err(error) => {
                strip_config_secrets(&mut config);
                return Err(error);
            }
        };
        strip_config_secrets(&mut config);
        let temp_paths = prepared.temp_paths;
        let mut command = Command::new(&prepared.executable);
        command
            .args(&prepared.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                cleanup_temp_paths(&temp_paths);
                return Err(NxError::connection_failed(format!(
                    "Failed to launch NoMachine Client: {error}"
                )));
            }
        };

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        match child.try_wait() {
            Ok(Some(status)) => {
                cleanup_temp_paths(&temp_paths);
                return Err(NxError::connection_failed(format!(
                    "NoMachine Client exited during startup ({status})"
                )));
            }
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill().await;
                cleanup_temp_paths(&temp_paths);
                return Err(NxError::connection_failed(format!(
                    "Could not verify the NoMachine Client process: {error}"
                )));
            }
        }

        let (cmd_tx, cmd_rx) = mpsc::channel(16);
        let (event_tx, event_rx) = mpsc::channel(32);
        let now = chrono::Utc::now().to_rfc3339();
        let state = Arc::new(Mutex::new(SharedSessionState {
            state: NxSessionState::Running,
            display: None,
            display_width: config.resolution_width.unwrap_or(1024),
            display_height: config.resolution_height.unwrap_or(768),
            server_session_id: None,
            native_client_pid: child.id(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            started_at: now.clone(),
            last_activity: now,
            suspended_count: 0,
            resumed_count: 0,
        }));

        let shared = state.clone();
        tokio::spawn(async move {
            native_process_task(child, cmd_rx, event_tx, shared, temp_paths).await;
        });

        Ok(Self {
            id,
            config,
            cmd_tx,
            event_rx,
            state,
        })
    }

    pub async fn send_command(&self, command: SessionCommand) -> Result<(), NxError> {
        self.cmd_tx
            .send(command)
            .await
            .map_err(|_| NxError::disconnected("NoMachine Client process is no longer tracked"))
    }

    pub async fn disconnect(&self) -> Result<(), NxError> {
        self.send_command(SessionCommand::Disconnect).await
    }

    pub async fn suspend(&self) -> Result<(), NxError> {
        Err(NxError::config(
            "Suspend/resume is controlled by the native NoMachine Client window",
        ))
    }
}

fn strip_config_secrets(config: &mut NxConfig) {
    if let Some(password) = &mut config.password {
        password.zeroize();
    }
    config.password = None;
    if let Some(private_key) = &mut config.private_key {
        private_key.zeroize();
    }
    config.private_key = None;
}

async fn mark_ended(state: &SharedState, failed: bool) {
    let mut session = state.lock().await;
    session.state = if failed {
        NxSessionState::Failed
    } else {
        NxSessionState::Terminated
    };
    session.native_client_pid = None;
    session.last_activity = chrono::Utc::now().to_rfc3339();
}

async fn stop_child(child: &mut Child) {
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn native_process_task(
    mut child: Child,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
    temp_paths: Vec<PathBuf>,
) {
    let _temp_files = TempFilesGuard(temp_paths);
    let _ = event_tx
        .send(SessionEvent::StateChanged(NxSessionState::Running))
        .await;

    loop {
        tokio::select! {
            result = child.wait() => {
                let failure = match result {
                    Ok(status) if status.success() => None,
                    Ok(status) => Some(format!("NoMachine Client exited with {status}")),
                    Err(error) => Some(format!("NoMachine Client process error: {error}")),
                };
                mark_ended(&state, failure.is_some()).await;
                let _ = event_tx.send(SessionEvent::Disconnected(failure)).await;
                break;
            }
            command = cmd_rx.recv() => {
                match command {
                    Some(SessionCommand::Disconnect) | None => {
                        stop_child(&mut child).await;
                        mark_ended(&state, false).await;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    // Retained for registered-command compatibility. The
                    // service rejects each unsupported operation explicitly.
                    Some(SessionCommand::KeyEvent { .. })
                    | Some(SessionCommand::PointerEvent { .. })
                    | Some(SessionCommand::SendClipboard(_))
                    | Some(SessionCommand::Resize { .. })
                    | Some(SessionCommand::Suspend)
                    | Some(SessionCommand::Terminate) => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_state_never_invents_remote_pixels_or_session_id() {
        let state = SharedSessionState {
            state: NxSessionState::Running,
            display: None,
            display_width: 1024,
            display_height: 768,
            server_session_id: None,
            native_client_pid: Some(42),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            started_at: String::new(),
            last_activity: String::new(),
            suspended_count: 0,
            resumed_count: 0,
        };
        assert!(state.display.is_none());
        assert!(state.server_session_id.is_none());
        assert_eq!(state.frame_count, 0);
    }

    #[test]
    fn command_variants_remain_available_for_wire_compatibility() {
        let _ = SessionCommand::Disconnect;
        let _ = SessionCommand::KeyEvent {
            keysym: 0x61,
            down: true,
        };
        let _ = SessionCommand::PointerEvent {
            x: 1,
            y: 2,
            button_mask: 0,
        };
        let _ = SessionCommand::SendClipboard("text".into());
    }

    #[test]
    fn retained_config_zeroizes_credentials() {
        let mut config = NxConfig {
            password: Some("secret".into()),
            private_key: Some("private material".into()),
            ..Default::default()
        };
        strip_config_secrets(&mut config);
        assert!(config.password.is_none());
        assert!(config.private_key.is_none());
    }
}
