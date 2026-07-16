//! X2Go native-client session lifecycle.
//!
//! The installed X2Go Client owns the real SSH/NX/authentication/display
//! channel. This crate tracks only the local client process; `Running` means
//! that process is alive, not that remote authentication has succeeded.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use zeroize::Zeroize;

use crate::x2go::native_client::{cleanup_temp_paths, prepare_native_launch};
use crate::x2go::types::*;

#[derive(Debug)]
pub enum SessionCommand {
    Suspend,
    Terminate,
    Disconnect,
    SendClipboard(String),
    Resize {
        width: u32,
        height: u32,
    },
    MountFolder {
        local_path: String,
        remote_name: String,
    },
    UnmountFolder {
        remote_name: String,
    },
}

#[derive(Debug)]
pub enum SessionEvent {
    /// The native client process is alive. Authentication still happens in
    /// that client's window and is not asserted by this event.
    SshConnected,
    ExistingSessions(Vec<X2goRemoteSession>),
    AgentReady {
        session_id: String,
        display: u32,
        gr_port: u16,
        snd_port: u16,
    },
    StateChanged(X2goSessionState),
    Clipboard(String),
    Suspended,
    Terminated,
    Disconnected(Option<String>),
    FolderMounted {
        remote_name: String,
    },
    FolderUnmounted {
        remote_name: String,
    },
    AudioStarted,
    PrintJobReceived {
        job_id: String,
        title: String,
    },
}

#[derive(Debug)]
pub struct SharedSessionState {
    pub state: X2goSessionState,
    pub remote_session_id: Option<String>,
    pub display_number: Option<u32>,
    pub agent_pid: Option<u32>,
    pub gr_port: Option<u16>,
    pub snd_port: Option<u16>,
    pub fs_port: Option<u16>,
    pub ssh_pid: Option<u32>,
    /// PID of the local native X2Go Client process.
    pub native_client_pid: Option<u32>,
    /// Retained for wire compatibility. Embedded nxproxy is no longer used.
    pub nxproxy_pid: Option<u32>,
    pub display_width: u32,
    pub display_height: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub audio_active: bool,
    pub mounted_folders: Vec<String>,
    pub last_activity: String,
    pub server_version: Option<String>,
    pub server_features: Vec<String>,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

pub struct X2goSessionHandle {
    pub id: String,
    pub config: X2goConfig,
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

impl X2goSessionHandle {
    pub async fn connect(id: String, mut config: X2goConfig) -> Result<Self, X2goError> {
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
                return Err(X2goError::session_start(format!(
                    "Failed to launch X2Go Client: {error}"
                )));
            }
        };

        // Catch a missing runtime dependency or malformed profile without
        // claiming a live handoff. We cannot and do not infer remote auth.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        match child.try_wait() {
            Ok(Some(status)) => {
                cleanup_temp_paths(&temp_paths);
                return Err(X2goError::session_start(format!(
                    "X2Go Client exited during startup ({status})"
                )));
            }
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill().await;
                cleanup_temp_paths(&temp_paths);
                return Err(X2goError::session_start(format!(
                    "Could not verify the X2Go Client process: {error}"
                )));
            }
        }

        let (cmd_tx, cmd_rx) = mpsc::channel(16);
        let (event_tx, event_rx) = mpsc::channel(32);
        let (display_width, display_height) = match config.display {
            X2goDisplayMode::Window { width, height } => (width, height),
            X2goDisplayMode::Fullscreen => (0, 0),
            X2goDisplayMode::SingleApplication { .. } => (800, 600),
        };
        let pid = child.id();
        let state = Arc::new(Mutex::new(SharedSessionState {
            state: X2goSessionState::Running,
            remote_session_id: None,
            display_number: None,
            agent_pid: None,
            gr_port: None,
            snd_port: None,
            fs_port: None,
            ssh_pid: None,
            native_client_pid: pid,
            nxproxy_pid: None,
            display_width,
            display_height,
            bytes_sent: 0,
            bytes_received: 0,
            audio_active: false,
            mounted_folders: Vec::new(),
            last_activity: chrono::Utc::now().to_rfc3339(),
            server_version: None,
            server_features: vec!["native-x2goclient-handoff".into()],
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

    pub async fn send_command(&self, command: SessionCommand) -> Result<(), X2goError> {
        self.cmd_tx
            .send(command)
            .await
            .map_err(|_| X2goError::disconnected("X2Go Client process is no longer tracked"))
    }

    pub async fn suspend(&self) -> Result<(), X2goError> {
        Err(X2goError::new(
            X2goErrorKind::SessionSuspendFailed,
            "Suspend/resume is controlled by the native X2Go Client window",
        ))
    }

    pub async fn terminate(&self) -> Result<(), X2goError> {
        Err(X2goError::new(
            X2goErrorKind::SessionTerminateFailed,
            "Remote session termination is controlled by the native X2Go Client window",
        ))
    }

    pub async fn disconnect(&self) -> Result<(), X2goError> {
        self.send_command(SessionCommand::Disconnect).await
    }
}

fn strip_config_secrets(config: &mut X2goConfig) {
    match &mut config.ssh.auth {
        X2goSshAuth::Password { password } => password.zeroize(),
        X2goSshAuth::PrivateKey { passphrase, .. } => {
            if let Some(value) = passphrase {
                value.zeroize();
            }
            *passphrase = None;
        }
        X2goSshAuth::InlinePrivateKey {
            private_key,
            passphrase,
        } => {
            private_key.zeroize();
            if let Some(value) = passphrase {
                value.zeroize();
            }
            *passphrase = None;
        }
        X2goSshAuth::Agent | X2goSshAuth::Gssapi => {}
    }
}

async fn mark_ended(state: &SharedState, failed: bool) {
    let mut session = state.lock().await;
    session.state = if failed {
        X2goSessionState::Failed
    } else {
        X2goSessionState::Ended
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
    // The guard also runs if the Tokio task is aborted during application
    // shutdown, preventing staged key/profile files from lingering.
    let _temp_files = TempFilesGuard(temp_paths);
    let _ = event_tx.send(SessionEvent::SshConnected).await;
    let _ = event_tx
        .send(SessionEvent::StateChanged(X2goSessionState::Running))
        .await;

    loop {
        tokio::select! {
            result = child.wait() => {
                let failure = match result {
                    Ok(status) if status.success() => None,
                    Ok(status) => Some(format!("X2Go Client exited with {status}")),
                    Err(error) => Some(format!("X2Go Client process error: {error}")),
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
                    // These variants remain for command-surface compatibility,
                    // but the service rejects them before they reach this task.
                    Some(SessionCommand::Suspend)
                    | Some(SessionCommand::Terminate)
                    | Some(SessionCommand::SendClipboard(_))
                    | Some(SessionCommand::Resize { .. })
                    | Some(SessionCommand::MountFolder { .. })
                    | Some(SessionCommand::UnmountFolder { .. }) => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_variants_remain_available_for_wire_compatibility() {
        let _ = SessionCommand::Disconnect;
        let _ = SessionCommand::Suspend;
        let _ = SessionCommand::Terminate;
        let _ = SessionCommand::SendClipboard("text".into());
        let _ = SessionCommand::Resize {
            width: 1280,
            height: 720,
        };
    }

    #[test]
    fn native_state_does_not_invent_remote_session_details() {
        let state = SharedSessionState {
            state: X2goSessionState::Running,
            remote_session_id: None,
            display_number: None,
            agent_pid: None,
            gr_port: None,
            snd_port: None,
            fs_port: None,
            ssh_pid: None,
            native_client_pid: Some(123),
            nxproxy_pid: None,
            display_width: 1024,
            display_height: 768,
            bytes_sent: 0,
            bytes_received: 0,
            audio_active: false,
            mounted_folders: Vec::new(),
            last_activity: String::new(),
            server_version: None,
            server_features: vec!["native-x2goclient-handoff".into()],
        };
        assert!(state.remote_session_id.is_none());
        assert!(state.display_number.is_none());
        assert_eq!(state.bytes_received, 0);
    }

    #[test]
    fn retained_config_zeroizes_password_and_key_secrets() {
        let mut password = X2goConfig {
            ssh: X2goSshConfig {
                auth: X2goSshAuth::Password {
                    password: "secret".into(),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        strip_config_secrets(&mut password);
        assert!(matches!(
            password.ssh.auth,
            X2goSshAuth::Password { ref password } if password.is_empty()
        ));

        let mut inline = X2goConfig {
            ssh: X2goSshConfig {
                auth: X2goSshAuth::InlinePrivateKey {
                    private_key: "private material".into(),
                    passphrase: Some("passphrase".into()),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        strip_config_secrets(&mut inline);
        assert!(matches!(
            inline.ssh.auth,
            X2goSshAuth::InlinePrivateKey {
                ref private_key,
                passphrase: None
            } if private_key.is_empty()
        ));
    }
}
