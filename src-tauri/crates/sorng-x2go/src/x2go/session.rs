//! X2Go session — async lifecycle: SSH → list sessions → start/resume agent → nxproxy → event loop.

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::x2go::types::*;

// ── Commands & Events ───────────────────────────────────────────────────────

#[derive(Debug)]
pub enum SessionCommand {
    /// Suspend the session (detachable).
    Suspend,
    /// Terminate the session permanently.
    Terminate,
    /// Disconnect (kill local side only, session may keep running).
    Disconnect,
    /// Send clipboard data to the remote session.
    SendClipboard(String),
    /// Resize the display.
    Resize { width: u32, height: u32 },
    /// Mount a shared folder.
    MountFolder { local_path: String, remote_name: String },
    /// Unmount a shared folder.
    UnmountFolder { remote_name: String },
}

#[derive(Debug)]
pub enum SessionEvent {
    /// SSH connected
    SshConnected,
    /// Found existing sessions on the server
    ExistingSessions(Vec<X2goRemoteSession>),
    /// Agent started or resumed
    AgentReady {
        session_id: String,
        display: u32,
        gr_port: u16,
        snd_port: u16,
    },
    /// Session state changed
    StateChanged(X2goSessionState),
    /// Clipboard data received
    Clipboard(String),
    /// Session suspended
    Suspended,
    /// Session terminated
    Terminated,
    /// Session disconnected
    Disconnected(Option<String>),
    /// File sharing event
    FolderMounted { remote_name: String },
    /// Folder unmounted
    FolderUnmounted { remote_name: String },
    /// Audio forwarding started
    AudioStarted,
    /// Print job received
    PrintJobReceived { job_id: String, title: String },
}

// ── Shared State ────────────────────────────────────────────────────────────

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

// ── Session Handle ──────────────────────────────────────────────────────────

pub struct X2goSessionHandle {
    pub id: String,
    pub config: X2goConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

impl X2goSessionHandle {
    pub async fn connect(id: String, config: X2goConfig) -> Result<Self, X2goError> {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let (event_tx, event_rx) = mpsc::channel(128);

        let (width, height) = match &config.display {
            X2goDisplayMode::Window { width, height } => (*width, *height),
            X2goDisplayMode::Fullscreen => (0, 0),
            X2goDisplayMode::SingleApplication { .. } => (800, 600),
        };

        let state = Arc::new(Mutex::new(SharedSessionState {
            state: X2goSessionState::Connecting,
            remote_session_id: None,
            display_number: None,
            agent_pid: None,
            gr_port: None,
            snd_port: None,
            fs_port: None,
            ssh_pid: None,
            nxproxy_pid: None,
            display_width: width,
            display_height: height,
            bytes_sent: 0,
            bytes_received: 0,
            audio_active: false,
            mounted_folders: Vec::new(),
            last_activity: chrono::Utc::now().to_rfc3339(),
            server_version: None,
            server_features: Vec::new(),
        }));

        let shared = state.clone();
        let session_config = config.clone();

        tokio::spawn(async move {
            let result = session_task(session_config, cmd_rx, event_tx.clone(), shared).await;
            if let Err(e) = result {
                let _ = event_tx
                    .send(SessionEvent::Disconnected(Some(e.message)))
                    .await;
            }
        });

        Ok(Self {
            id,
            config,
            cmd_tx,
            event_rx,
            state,
        })
    }

    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), X2goError> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| X2goError::disconnected("session task is gone"))
    }

    pub async fn suspend(&self) -> Result<(), X2goError> {
        self.send_command(SessionCommand::Suspend).await
    }

    pub async fn terminate(&self) -> Result<(), X2goError> {
        self.send_command(SessionCommand::Terminate).await
    }

    pub async fn disconnect(&self) -> Result<(), X2goError> {
        self.send_command(SessionCommand::Disconnect).await
    }
}

// ── Session Task ────────────────────────────────────────────────────────────

async fn session_task(
    config: X2goConfig,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
) -> Result<(), X2goError> {
    use std::process::Stdio;
    use tokio::process::Command;

    let ssh_timeout = config.ssh.connect_timeout;

    // 1. Build SSH command
    let mut ssh_args = vec![
        "-o".to_string(),
        format!("ConnectTimeout={}", ssh_timeout),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-p".to_string(),
        config.ssh.port.to_string(),
    ];

    if !config.ssh.strict_host_key {
        ssh_args.push("-o".into());
        ssh_args.push("StrictHostKeyChecking=no".into());
        ssh_args.push("-o".into());
        ssh_args.push("UserKnownHostsFile=/dev/null".into());
    }

    if let Some(ref proxy) = config.ssh.proxy_command {
        ssh_args.push("-o".into());
        ssh_args.push(format!("ProxyCommand={}", proxy));
    }

    match &config.ssh.auth {
        X2goSshAuth::PrivateKey { key_path, .. } => {
            ssh_args.push("-i".into());
            ssh_args.push(key_path.clone());
        }
        _ => {}
    }

    let target = format!("{}@{}", config.username, config.host);

    // 2. Check server version
    {
        let version_cmd = crate::x2go::protocol::build_version_cmd(None);
        let output = Command::new("ssh")
            .args(&ssh_args)
            .arg(&target)
            .arg(&version_cmd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .map_err(X2goError::from)?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(ver) = crate::x2go::protocol::parse_version(&stdout) {
                let mut st = state.lock().await;
                st.server_version = Some(ver.full);
            }
        }
    }

    let _ = event_tx.send(SessionEvent::SshConnected).await;

    {
        let mut st = state.lock().await;
        st.state = X2goSessionState::Authenticating;
        st.last_activity = chrono::Utc::now().to_rfc3339();
    }

    // 3. List existing sessions
    let list_cmd = crate::x2go::protocol::build_list_sessions_cmd(None);
    let output = Command::new("ssh")
        .args(&ssh_args)
        .arg(&target)
        .arg(&list_cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(X2goError::from)?;

    let remote_sessions = if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        crate::x2go::types::parse_session_list(&stdout)
    } else {
        Vec::new()
    };

    if !remote_sessions.is_empty() {
        let _ = event_tx
            .send(SessionEvent::ExistingSessions(remote_sessions.clone()))
            .await;
    }

    // 4. Start or resume
    let agent_cmd = if let Some(ref resume_id) = config.resume_session {
        // Try to resume a specific session
        {
            let mut st = state.lock().await;
            st.state = X2goSessionState::Resuming;
        }
        crate::x2go::protocol::build_resume_session_cmd(resume_id, &config, None)
    } else if let Some(suspended) = remote_sessions.iter().find(|s| s.suspended) {
        // Auto-resume first suspended session
        {
            let mut st = state.lock().await;
            st.state = X2goSessionState::Resuming;
        }
        crate::x2go::protocol::build_resume_session_cmd(&suspended.session_id, &config, None)
    } else {
        // Start new session
        {
            let mut st = state.lock().await;
            st.state = X2goSessionState::Starting;
        }
        crate::x2go::protocol::build_start_agent_cmd(&config, None)
    };

    let agent_output = Command::new("ssh")
        .args(&ssh_args)
        .arg(&target)
        .arg(&agent_cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(X2goError::from)?;

    if !agent_output.status.success() {
        let stderr = String::from_utf8_lossy(&agent_output.stderr);
        return Err(X2goError::session_start(format!(
            "agent command failed: {}",
            stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&agent_output.stdout);
    let agent_info = crate::x2go::protocol::parse_agent_start(&stdout)
        .ok_or_else(|| X2goError::session_start("failed to parse agent response"))?;

    {
        let mut st = state.lock().await;
        st.remote_session_id = Some(agent_info.session_id.clone());
        st.display_number = Some(agent_info.display);
        st.agent_pid = Some(agent_info.agent_pid);
        st.gr_port = Some(agent_info.gr_port);
        st.snd_port = Some(agent_info.snd_port);
        st.fs_port = Some(agent_info.fs_port);
    }

    let _ = event_tx
        .send(SessionEvent::AgentReady {
            session_id: agent_info.session_id.clone(),
            display: agent_info.display,
            gr_port: agent_info.gr_port,
            snd_port: agent_info.snd_port,
        })
        .await;

    // 5. Start nxproxy
    let nxproxy_path = crate::x2go::protocol::find_nxproxy();
    let nxproxy_cmd_str = crate::x2go::protocol::build_nxproxy_cmd(
        &agent_info.session_id,
        &config,
        agent_info.gr_port,
        nxproxy_path.as_deref(),
    );

    let parts: Vec<&str> = nxproxy_cmd_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err(X2goError::proxy("empty nxproxy command"));
    }

    let mut nxproxy = Command::new(parts[0])
        .args(&parts[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| X2goError::proxy(format!("failed to start nxproxy: {}", e)))?;

    if let Some(pid) = nxproxy.id() {
        let mut st = state.lock().await;
        st.nxproxy_pid = Some(pid);
    }

    // 6. Mark running
    {
        let mut st = state.lock().await;
        st.state = X2goSessionState::Running;
        st.last_activity = chrono::Utc::now().to_rfc3339();
    }

    let _ = event_tx
        .send(SessionEvent::StateChanged(X2goSessionState::Running))
        .await;

    // 7. Auto-mount shared folders
    for folder in &config.shared_folders {
        if folder.auto_mount {
            let mount_cmd = crate::x2go::protocol::build_mount_dirs_cmd(
                &agent_info.session_id,
                None,
            );
            let _ = Command::new("ssh")
                .args(&ssh_args)
                .arg(&target)
                .arg(&mount_cmd)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .await;

            let _ = event_tx
                .send(SessionEvent::FolderMounted {
                    remote_name: folder.remote_name.clone(),
                })
                .await;
        }
    }

    // 8. Event loop
    loop {
        tokio::select! {
            // nxproxy exit
            exit_status = nxproxy.wait() => {
                let msg = match exit_status {
                    Ok(status) if status.success() => None,
                    Ok(status) => Some(format!("nxproxy exited with {}", status)),
                    Err(e) => Some(format!("nxproxy error: {}", e)),
                };
                let mut st = state.lock().await;
                st.state = X2goSessionState::Ended;
                let _ = event_tx.send(SessionEvent::Disconnected(msg)).await;
                break;
            }

            // Commands from service
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Suspend) => {
                        let remote_id = {
                            let st = state.lock().await;
                            st.remote_session_id.clone()
                        };
                        if let Some(ref rid) = remote_id {
                            let suspend_cmd = crate::x2go::protocol::build_suspend_session_cmd(rid, None);
                            let _ = Command::new("ssh")
                                .args(&ssh_args)
                                .arg(&target)
                                .arg(&suspend_cmd)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .output()
                                .await;
                        }
                        // Kill nxproxy
                        let _ = nxproxy.kill().await;
                        let mut st = state.lock().await;
                        st.state = X2goSessionState::Suspended;
                        let _ = event_tx.send(SessionEvent::Suspended).await;
                        break;
                    }

                    Some(SessionCommand::Terminate) => {
                        let remote_id = {
                            let st = state.lock().await;
                            st.remote_session_id.clone()
                        };
                        if let Some(ref rid) = remote_id {
                            let term_cmd = crate::x2go::protocol::build_terminate_session_cmd(rid, None);
                            let _ = Command::new("ssh")
                                .args(&ssh_args)
                                .arg(&target)
                                .arg(&term_cmd)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .output()
                                .await;
                        }
                        let _ = nxproxy.kill().await;
                        let mut st = state.lock().await;
                        st.state = X2goSessionState::Ended;
                        let _ = event_tx.send(SessionEvent::Terminated).await;
                        break;
                    }

                    Some(SessionCommand::Disconnect) | None => {
                        let _ = nxproxy.kill().await;
                        let mut st = state.lock().await;
                        st.state = X2goSessionState::Ended;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }

                    Some(SessionCommand::Resize { width, height }) => {
                        let mut st = state.lock().await;
                        st.display_width = width;
                        st.display_height = height;
                    }

                    Some(SessionCommand::SendClipboard(_data)) => {
                        // Clipboard forwarding handled by nxproxy/NX protocol
                    }

                    Some(SessionCommand::MountFolder { local_path: _, remote_name }) => {
                        let remote_id = {
                            let st = state.lock().await;
                            st.remote_session_id.clone()
                        };
                        if let Some(ref rid) = remote_id {
                            let mount_cmd = crate::x2go::protocol::build_mount_dirs_cmd(rid, None);
                            let _ = Command::new("ssh")
                                .args(&ssh_args)
                                .arg(&target)
                                .arg(&mount_cmd)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .output()
                                .await;
                            let mut st = state.lock().await;
                            st.mounted_folders.push(remote_name.clone());
                        }
                        let _ = event_tx.send(SessionEvent::FolderMounted { remote_name }).await;
                    }

                    Some(SessionCommand::UnmountFolder { remote_name }) => {
                        let remote_id = {
                            let st = state.lock().await;
                            st.remote_session_id.clone()
                        };
                        if let Some(ref rid) = remote_id {
                            let umount_cmd = crate::x2go::protocol::build_umount_session_cmd(rid, None);
                            let _ = Command::new("ssh")
                                .args(&ssh_args)
                                .arg(&target)
                                .arg(&umount_cmd)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .output()
                                .await;
                            let mut st = state.lock().await;
                            st.mounted_folders.retain(|f| f != &remote_name);
                        }
                        let _ = event_tx.send(SessionEvent::FolderUnmounted { remote_name }).await;
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_command_variants() {
        let _ = SessionCommand::Suspend;
        let _ = SessionCommand::Terminate;
        let _ = SessionCommand::Disconnect;
        let _ = SessionCommand::SendClipboard("text".into());
        let _ = SessionCommand::Resize { width: 1920, height: 1080 };
        let _ = SessionCommand::MountFolder {
            local_path: "/home".into(),
            remote_name: "home".into(),
        };
    }

    #[test]
    fn session_event_variants() {
        let _ = SessionEvent::SshConnected;
        let _ = SessionEvent::ExistingSessions(vec![]);
        let _ = SessionEvent::Suspended;
        let _ = SessionEvent::Terminated;
    }

    #[test]
    fn shared_state_default() {
        let state = SharedSessionState {
            state: X2goSessionState::Connecting,
            remote_session_id: None,
            display_number: None,
            agent_pid: None,
            gr_port: None,
            snd_port: None,
            fs_port: None,
            ssh_pid: None,
            nxproxy_pid: None,
            display_width: 1024,
            display_height: 768,
            bytes_sent: 0,
            bytes_received: 0,
            audio_active: false,
            mounted_folders: Vec::new(),
            last_activity: String::new(),
            server_version: None,
            server_features: Vec::new(),
        };
        assert_eq!(state.state, X2goSessionState::Connecting);
    }
}
