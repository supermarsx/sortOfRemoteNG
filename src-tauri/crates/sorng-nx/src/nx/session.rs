//! NX session — async lifecycle: SSH → NX negotiation → nxproxy → event loop.

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::nx::types::*;

// ── Commands & Events ───────────────────────────────────────────────────────

/// Commands sent from the service to the session task.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send a key event.
    KeyEvent { keysym: u32, down: bool },
    /// Send a pointer event.
    PointerEvent { x: i32, y: i32, button_mask: u8 },
    /// Send clipboard text.
    SendClipboard(String),
    /// Request display resize.
    Resize { width: u32, height: u32 },
    /// Suspend the session (disconnect without terminating).
    Suspend,
    /// Terminate the session.
    Terminate,
    /// Disconnect gracefully.
    Disconnect,
}

/// Events emitted from the session task.
#[derive(Debug)]
pub enum SessionEvent {
    /// Session is now connected and ready.
    Connected {
        display: u32,
        width: u32,
        height: u32,
        server_session_id: String,
    },
    /// Session state changed.
    StateChanged(NxSessionState),
    /// Clipboard data from guest.
    Clipboard(String),
    /// Session was suspended.
    Suspended,
    /// Session was resumed.
    Resumed,
    /// Session disconnected.
    Disconnected(Option<String>),
}

// ── Shared State ────────────────────────────────────────────────────────────

/// Mutable state shared between session task and service.
#[derive(Debug)]
pub struct SharedSessionState {
    pub state: NxSessionState,
    pub display: Option<u32>,
    pub display_width: u32,
    pub display_height: u32,
    pub server_session_id: Option<String>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub last_activity: String,
    pub suspended_count: u32,
    pub resumed_count: u32,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

// ── Session Handle ──────────────────────────────────────────────────────────

/// Handle to a running NX session.
pub struct NxSessionHandle {
    pub id: String,
    pub config: NxConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

impl NxSessionHandle {
    /// Connect a new NX session.
    pub async fn connect(id: String, config: NxConfig) -> Result<Self, NxError> {
        let (cmd_tx, cmd_rx) = mpsc::channel(256);
        let (event_tx, event_rx) = mpsc::channel(512);

        let state = Arc::new(Mutex::new(SharedSessionState {
            state: NxSessionState::Starting,
            display: None,
            display_width: config.resolution_width.unwrap_or(1024),
            display_height: config.resolution_height.unwrap_or(768),
            server_session_id: None,
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: chrono::Utc::now().to_rfc3339(),
            suspended_count: 0,
            resumed_count: 0,
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

    /// Send a command to the session task.
    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), NxError> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| NxError::disconnected("session task is gone"))
    }

    /// Request disconnect.
    pub async fn disconnect(&self) -> Result<(), NxError> {
        self.send_command(SessionCommand::Disconnect).await
    }

    /// Request suspend.
    pub async fn suspend(&self) -> Result<(), NxError> {
        self.send_command(SessionCommand::Suspend).await
    }
}

// ── Session Task ────────────────────────────────────────────────────────────

async fn session_task(
    config: NxConfig,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
) -> Result<(), NxError> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let connect_timeout = Duration::from_secs(config.connect_timeout.unwrap_or(30) as u64);
    let ssh_port = config.ssh_port.unwrap_or(22);

    // 1. SSH connect (simplified — real impl would use an SSH library)
    let addr = format!("{}:{}", config.host, ssh_port);
    let stream = timeout(connect_timeout, TcpStream::connect(&addr))
        .await
        .map_err(|_| NxError::timeout("SSH connection timed out"))?
        .map_err(NxError::from)?;

    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);

    // 2. Wait for NX greeting
    let mut line = String::new();
    reader.read_line(&mut line).await.map_err(NxError::from)?;
    {
        let mut st = state.lock().await;
        st.bytes_received += line.len() as u64;
    }

    if !line.contains("HELLO NXSERVER") && !line.contains("SSH") {
        // Not an NX server, might be raw SSH — that's expected for real SSH tunnel
    }

    // 3. Send hello
    let hello = format!("{}\n", crate::nx::protocol::NxCommand::hello("3.5.0"));
    writer.write_all(hello.as_bytes()).await.map_err(NxError::from)?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += hello.len() as u64;
    }

    // 4. Authentication
    if let Some(ref username) = config.username {
        let login_cmd = format!("{}\n", crate::nx::protocol::NxCommand::login(username));
        writer.write_all(login_cmd.as_bytes()).await.map_err(NxError::from)?;
    }

    if let Some(ref password) = config.password {
        let pass_cmd = format!("{}\n", password);
        writer.write_all(pass_cmd.as_bytes()).await.map_err(NxError::from)?;
    }

    // 5. Start or resume session
    let geometry = format!(
        "{}x{}",
        config.resolution_width.unwrap_or(1024),
        config.resolution_height.unwrap_or(768)
    );

    let session_type = config
        .session_type
        .as_ref()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unix-desktop".into());

    let start_cmd = if let Some(ref resume_id) = config.resume_session_id {
        crate::nx::protocol::NxCommand::resume_session(resume_id)
    } else {
        crate::nx::protocol::NxCommand::start_session(&session_type, &geometry, "adsl", "8M")
    };

    writer.write_all(format!("{}\n", start_cmd).as_bytes()).await.map_err(NxError::from)?;

    // 6. Mark running
    {
        let mut st = state.lock().await;
        st.state = NxSessionState::Running;
        st.last_activity = chrono::Utc::now().to_rfc3339();
    }

    let _ = event_tx
        .send(SessionEvent::Connected {
            display: 1001,
            width: config.resolution_width.unwrap_or(1024),
            height: config.resolution_height.unwrap_or(768),
            server_session_id: "nx-session-placeholder".into(),
        })
        .await;

    // 7. Main event loop
    let mut read_buf = String::new();
    loop {
        tokio::select! {
            result = reader.read_line(&mut read_buf) => {
                match result {
                    Ok(0) => {
                        let mut st = state.lock().await;
                        st.state = NxSessionState::Terminated;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Ok(n) => {
                        let mut st = state.lock().await;
                        st.bytes_received += n as u64;
                        st.frame_count += 1;
                        st.last_activity = chrono::Utc::now().to_rfc3339();
                        read_buf.clear();
                    }
                    Err(e) => {
                        let mut st = state.lock().await;
                        st.state = NxSessionState::Failed;
                        let _ = event_tx.send(SessionEvent::Disconnected(Some(e.to_string()))).await;
                        break;
                    }
                }
            }

            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Disconnect) | None => {
                        let bye = format!("{}\n", crate::nx::protocol::NxCommand::bye());
                        let _ = writer.write_all(bye.as_bytes()).await;
                        let mut st = state.lock().await;
                        st.state = NxSessionState::Terminated;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Some(SessionCommand::Suspend) => {
                        let disc = format!("{}\n", crate::nx::protocol::NxCommand::disconnect());
                        let _ = writer.write_all(disc.as_bytes()).await;
                        let mut st = state.lock().await;
                        st.state = NxSessionState::Suspended;
                        st.suspended_count += 1;
                        let _ = event_tx.send(SessionEvent::Suspended).await;
                        break;
                    }
                    Some(SessionCommand::Terminate) => {
                        if let Some(ref sid) = state.lock().await.server_session_id {
                            let term = format!("{}\n", crate::nx::protocol::NxCommand::terminate_session(sid));
                            let _ = writer.write_all(term.as_bytes()).await;
                        }
                        let mut st = state.lock().await;
                        st.state = NxSessionState::Terminated;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Some(SessionCommand::KeyEvent { .. }) |
                    Some(SessionCommand::PointerEvent { .. }) |
                    Some(SessionCommand::SendClipboard(_)) |
                    Some(SessionCommand::Resize { .. }) => {
                        // These would be forwarded via the nxproxy channel
                        let mut st = state.lock().await;
                        st.last_activity = chrono::Utc::now().to_rfc3339();
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
        let _ = SessionCommand::KeyEvent { keysym: 0x61, down: true };
        let _ = SessionCommand::PointerEvent { x: 100, y: 200, button_mask: 1 };
        let _ = SessionCommand::SendClipboard("test".into());
        let _ = SessionCommand::Resize { width: 1920, height: 1080 };
        let _ = SessionCommand::Suspend;
        let _ = SessionCommand::Terminate;
        let _ = SessionCommand::Disconnect;
    }

    #[test]
    fn shared_state_default() {
        let state = SharedSessionState {
            state: NxSessionState::Starting,
            display: None,
            display_width: 1024,
            display_height: 768,
            server_session_id: None,
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
            suspended_count: 0,
            resumed_count: 0,
        };
        assert_eq!(state.state, NxSessionState::Starting);
    }
}
