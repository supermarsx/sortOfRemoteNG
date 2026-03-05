//! XDMCP session — async lifecycle: discovery → request → accept → manage → keepalive loop.

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::xdmcp::types::*;

// ── Commands & Events ───────────────────────────────────────────────────────

/// Commands from the service to the session task.
#[derive(Debug)]
pub enum SessionCommand {
    /// Disconnect gracefully.
    Disconnect,
    /// Resize the display.
    Resize { width: u32, height: u32 },
}

/// Events from the session task.
#[derive(Debug)]
pub enum SessionEvent {
    /// Discovery found a willing host.
    HostFound { hostname: String, status: String },
    /// Session accepted by the display manager.
    Accepted { session_id: u32 },
    /// Session is now running (X server started).
    Running { display_number: u32 },
    /// Session state changed.
    StateChanged(XdmcpSessionState),
    /// Session disconnected.
    Disconnected(Option<String>),
}

// ── Shared State ────────────────────────────────────────────────────────────

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
    pub last_activity: String,
    pub x_server_pid: Option<u32>,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

// ── Session Handle ──────────────────────────────────────────────────────────

pub struct XdmcpSessionHandle {
    pub id: String,
    pub config: XdmcpConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

impl XdmcpSessionHandle {
    pub async fn connect(id: String, config: XdmcpConfig) -> Result<Self, XdmcpError> {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let (event_tx, event_rx) = mpsc::channel(128);

        let state = Arc::new(Mutex::new(SharedSessionState {
            state: XdmcpSessionState::Discovering,
            display_number: config.display_number,
            session_id: None,
            display_manager: None,
            display_width: config.resolution_width.unwrap_or(1024),
            display_height: config.resolution_height.unwrap_or(768),
            bytes_sent: 0,
            bytes_received: 0,
            packets_sent: 0,
            packets_received: 0,
            keepalive_count: 0,
            last_activity: chrono::Utc::now().to_rfc3339(),
            x_server_pid: None,
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

    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), XdmcpError> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| XdmcpError::disconnected("session task is gone"))
    }

    pub async fn disconnect(&self) -> Result<(), XdmcpError> {
        self.send_command(SessionCommand::Disconnect).await
    }
}

// ── Session Task ────────────────────────────────────────────────────────────

async fn session_task(
    config: XdmcpConfig,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
) -> Result<(), XdmcpError> {
    use tokio::net::UdpSocket;
    use tokio::time::{interval, timeout, Duration};

    let connect_timeout = Duration::from_secs(config.connect_timeout.unwrap_or(30) as u64);

    // 1. Bind UDP socket
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(XdmcpError::from)?;

    let target = format!("{}:{}", config.host, config.port);

    // 2. Send Query
    let query = crate::xdmcp::protocol::build_query(&[]);
    socket.send_to(&query, &target).await.map_err(XdmcpError::from)?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += query.len() as u64;
        st.packets_sent += 1;
    }

    // 3. Wait for Willing
    let mut buf = vec![0u8; 1024];
    let (n, _from) = timeout(connect_timeout, socket.recv_from(&mut buf))
        .await
        .map_err(|_| XdmcpError::timeout("no Willing response received"))?
        .map_err(XdmcpError::from)?;

    {
        let mut st = state.lock().await;
        st.bytes_received += n as u64;
        st.packets_received += 1;
    }

    // Parse header
    let header = crate::xdmcp::protocol::XdmcpHeader::decode(&buf[..n])
        .ok_or_else(|| XdmcpError::protocol("invalid XDMCP header"))?;

    if header.opcode == XdmcpOpcode::Unwilling {
        return Err(XdmcpError::declined("display manager is unwilling"));
    }

    if header.opcode != XdmcpOpcode::Willing {
        return Err(XdmcpError::protocol(format!("expected Willing, got {:?}", header.opcode)));
    }

    let willing = crate::xdmcp::protocol::parse_willing(&buf[6..n])
        .ok_or_else(|| XdmcpError::protocol("failed to parse Willing response"))?;

    let _ = event_tx
        .send(SessionEvent::HostFound {
            hostname: willing.hostname.clone(),
            status: willing.status.clone(),
        })
        .await;

    {
        let mut st = state.lock().await;
        st.state = XdmcpSessionState::Requesting;
        st.display_manager = Some(willing.hostname);
    }

    // 4. Send Request
    let display_num = config.display_number.unwrap_or(
        crate::xdmcp::xserver::find_available_display(10)
    ) as u16;

    let local_addr = socket.local_addr().map_err(XdmcpError::from)?;
    let ip_bytes: Vec<u8> = match local_addr.ip() {
        std::net::IpAddr::V4(ip) => ip.octets().to_vec(),
        std::net::IpAddr::V6(ip) => ip.octets().to_vec(),
    };

    let request = crate::xdmcp::protocol::build_request(
        display_num,
        &[0], // Internet
        &[&ip_bytes],
        "",
        &[],
        "sorng-xdmcp",
    );
    socket.send_to(&request, &target).await.map_err(XdmcpError::from)?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += request.len() as u64;
        st.packets_sent += 1;
    }

    // 5. Wait for Accept/Decline
    let (n, _) = timeout(connect_timeout, socket.recv_from(&mut buf))
        .await
        .map_err(|_| XdmcpError::timeout("no Accept/Decline response"))?
        .map_err(XdmcpError::from)?;

    {
        let mut st = state.lock().await;
        st.bytes_received += n as u64;
        st.packets_received += 1;
    }

    let resp_header = crate::xdmcp::protocol::XdmcpHeader::decode(&buf[..n])
        .ok_or_else(|| XdmcpError::protocol("invalid response header"))?;

    if resp_header.opcode == XdmcpOpcode::Decline {
        let decline = crate::xdmcp::protocol::parse_decline(&buf[6..n]);
        let reason = decline.map(|d| d.status).unwrap_or_else(|| "declined".into());
        return Err(XdmcpError::declined(reason));
    }

    if resp_header.opcode != XdmcpOpcode::Accept {
        return Err(XdmcpError::protocol(format!("expected Accept, got {:?}", resp_header.opcode)));
    }

    let accept = crate::xdmcp::protocol::parse_accept(&buf[6..n])
        .ok_or_else(|| XdmcpError::protocol("failed to parse Accept"))?;

    {
        let mut st = state.lock().await;
        st.state = XdmcpSessionState::Accepted;
        st.session_id = Some(accept.session_id);
        st.display_number = Some(display_num as u32);
    }

    let _ = event_tx
        .send(SessionEvent::Accepted { session_id: accept.session_id })
        .await;

    // 6. Send Manage
    let manage = crate::xdmcp::protocol::build_manage(
        accept.session_id,
        display_num,
        "MIT-unspecified",
    );
    socket.send_to(&manage, &target).await.map_err(XdmcpError::from)?;

    // 7. Mark running
    {
        let mut st = state.lock().await;
        st.state = XdmcpSessionState::Running;
        st.last_activity = chrono::Utc::now().to_rfc3339();
    }

    let _ = event_tx
        .send(SessionEvent::Running {
            display_number: display_num as u32,
        })
        .await;

    // 8. KeepAlive loop
    let keepalive_secs = config.keepalive_interval.unwrap_or(60);
    let mut keepalive_timer = interval(Duration::from_secs(keepalive_secs as u64));

    loop {
        tokio::select! {
            _ = keepalive_timer.tick() => {
                let ka = crate::xdmcp::protocol::build_keepalive(
                    display_num,
                    accept.session_id,
                );
                if socket.send_to(&ka, &target).await.is_ok() {
                    let mut st = state.lock().await;
                    st.bytes_sent += ka.len() as u64;
                    st.packets_sent += 1;
                    st.keepalive_count += 1;
                    st.last_activity = chrono::Utc::now().to_rfc3339();
                }
            }

            result = socket.recv_from(&mut buf) => {
                match result {
                    Ok((n, _)) => {
                        let mut st = state.lock().await;
                        st.bytes_received += n as u64;
                        st.packets_received += 1;
                        st.last_activity = chrono::Utc::now().to_rfc3339();
                        // Parse Alive/Refuse/Failed responses
                    }
                    Err(e) => {
                        let mut st = state.lock().await;
                        st.state = XdmcpSessionState::Failed;
                        let _ = event_tx.send(SessionEvent::Disconnected(Some(e.to_string()))).await;
                        break;
                    }
                }
            }

            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Disconnect) | None => {
                        let mut st = state.lock().await;
                        st.state = XdmcpSessionState::Ended;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Some(SessionCommand::Resize { width, height }) => {
                        let mut st = state.lock().await;
                        st.display_width = width;
                        st.display_height = height;
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
        let _ = SessionCommand::Disconnect;
        let _ = SessionCommand::Resize { width: 1920, height: 1080 };
    }

    #[test]
    fn shared_state_init() {
        let state = SharedSessionState {
            state: XdmcpSessionState::Discovering,
            display_number: None,
            session_id: None,
            display_manager: None,
            display_width: 1024,
            display_height: 768,
            bytes_sent: 0,
            bytes_received: 0,
            packets_sent: 0,
            packets_received: 0,
            keepalive_count: 0,
            last_activity: String::new(),
            x_server_pid: None,
        };
        assert_eq!(state.state, XdmcpSessionState::Discovering);
    }
}
