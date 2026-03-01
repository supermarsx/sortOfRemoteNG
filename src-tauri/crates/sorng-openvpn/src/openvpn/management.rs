//! OpenVPN management interface client.
//!
//! Implements the real-time TCP management protocol that OpenVPN exposes
//! when started with `--management <addr> <port>`.

use crate::openvpn::types::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Management client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Handle to the management interface connection.
pub struct MgmtClient {
    writer: tokio::io::WriteHalf<TcpStream>,
    /// Channel that receives parsed real-time messages.
    pub event_rx: mpsc::Receiver<MgmtMessage>,
    /// Whether the TCP connection is still alive.
    connected: bool,
}

impl MgmtClient {
    /// Connect to the management interface at the given address.
    pub async fn connect(addr: &str, port: u16) -> Result<Self, OpenVpnError> {
        let stream = TcpStream::connect(format!("{}:{}", addr, port))
            .await
            .map_err(|e| {
                OpenVpnError::new(
                    OpenVpnErrorKind::ManagementConnectFailed,
                    format!("Cannot connect to management interface at {}:{}", addr, port),
                )
                .with_detail(e.to_string())
            })?;

        let (reader, writer) = tokio::io::split(stream);
        let (event_tx, event_rx) = mpsc::channel(256);

        // Spawn reader task
        tokio::spawn(async move {
            let mut buf_reader = BufReader::new(reader);
            let mut line = String::new();
            loop {
                line.clear();
                match buf_reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            if let Some(msg) = parse_mgmt_line(trimmed) {
                                if event_tx.send(msg).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            writer,
            event_rx,
            connected: true,
        })
    }

    /// Send a raw command string to the management interface.
    pub async fn send_command(&mut self, cmd: &str) -> Result<(), OpenVpnError> {
        if !self.connected {
            return Err(OpenVpnError::new(
                OpenVpnErrorKind::ManagementConnectFailed,
                "Management interface not connected",
            ));
        }
        let data = format!("{}\n", cmd);
        self.writer.write_all(data.as_bytes()).await.map_err(|e| {
            self.connected = false;
            OpenVpnError::new(
                OpenVpnErrorKind::ManagementCommandFailed,
                format!("Failed to send command: {}", cmd),
            )
            .with_detail(e.to_string())
        })?;
        Ok(())
    }

    /// Send the `hold release` command to let the connection proceed.
    pub async fn hold_release(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("hold release").await
    }

    /// Request current state.
    pub async fn state(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("state").await
    }

    /// Request byte count notifications at the given interval (seconds).
    pub async fn bytecount(&mut self, interval_secs: u32) -> Result<(), OpenVpnError> {
        self.send_command(&format!("bytecount {}", interval_secs))
            .await
    }

    /// Signal the process (e.g. SIGTERM, SIGUSR1, SIGHUP).
    pub async fn signal(&mut self, sig: &str) -> Result<(), OpenVpnError> {
        self.send_command(&format!("signal {}", sig)).await
    }

    /// Gracefully disconnect.
    pub async fn signal_sigterm(&mut self) -> Result<(), OpenVpnError> {
        self.signal("SIGTERM").await
    }

    /// Force reconnect.
    pub async fn signal_sigusr1(&mut self) -> Result<(), OpenVpnError> {
        self.signal("SIGUSR1").await
    }

    /// Soft restart (re-read config).
    pub async fn signal_sighup(&mut self) -> Result<(), OpenVpnError> {
        self.signal("SIGHUP").await
    }

    /// Respond with username/password for interactive auth.
    pub async fn send_auth(
        &mut self,
        auth_type: &str,
        username: &str,
        password: &str,
    ) -> Result<(), OpenVpnError> {
        self.send_command(&format!("username \"{}\" {}", auth_type, username))
            .await?;
        self.send_command(&format!("password \"{}\" {}", auth_type, password))
            .await
    }

    /// Request log output.
    pub async fn log_on(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("log on all").await
    }

    /// Disable real-time log output.
    pub async fn log_off(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("log off").await
    }

    /// Enable state change notifications.
    pub async fn state_on(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("state on all").await
    }

    /// Get current process status.
    pub async fn status(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("status 2").await
    }

    /// Request the PID of the running OpenVPN process.
    pub async fn pid(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("pid").await
    }

    /// Trigger a clean exit.
    pub async fn exit(&mut self) -> Result<(), OpenVpnError> {
        let _ = self.send_command("exit").await;
        self.connected = false;
        Ok(())
    }

    /// Kill the OpenVPN process via management.
    pub async fn kill(&mut self) -> Result<(), OpenVpnError> {
        let _ = self.send_command("signal SIGTERM").await;
        self.connected = false;
        Ok(())
    }

    /// Respond to NEED-OK prompt.
    pub async fn need_ok(&mut self, response: &str) -> Result<(), OpenVpnError> {
        self.send_command(&format!("needok '{}'", response)).await
    }

    /// Set echo mode.
    pub async fn echo_on(&mut self) -> Result<(), OpenVpnError> {
        self.send_command("echo on all").await
    }

    /// Proxy auth response.
    pub async fn proxy_auth(
        &mut self,
        username: &str,
        password: &str,
    ) -> Result<(), OpenVpnError> {
        self.send_command(&format!("username \"HTTP Proxy\" {}", username))
            .await?;
        self.send_command(&format!("password \"HTTP Proxy\" {}", password))
            .await
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Line parser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse a single management-interface output line into a `MgmtMessage`.
pub fn parse_mgmt_line(line: &str) -> Option<MgmtMessage> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // Real-time notifications start with >
    if let Some(rest) = line.strip_prefix('>') {
        return parse_realtime_message(rest);
    }

    // Success / error responses
    if line.starts_with("SUCCESS:") || line.starts_with("ERROR:") {
        return Some(MgmtMessage::Info(line.to_string()));
    }

    // Anything else is informational
    Some(MgmtMessage::Info(line.to_string()))
}

/// Parse a real-time (>...) message.
fn parse_realtime_message(rest: &str) -> Option<MgmtMessage> {
    // Format: >TYPE:payload
    let (msg_type, payload) = rest.split_once(':')?;
    let msg_type = msg_type.trim();
    let payload = payload.trim();

    match msg_type {
        "INFO" => Some(MgmtMessage::Info(payload.to_string())),

        "STATE" => {
            let fields: Vec<&str> = payload.split(',').collect();
            if fields.len() >= 2 {
                Some(MgmtMessage::State(MgmtState {
                    timestamp: fields[0].parse().unwrap_or(0),
                    state_name: fields[1].to_string(),
                    description: fields.get(2).unwrap_or(&"").to_string(),
                    local_ip: fields.get(3).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    remote_ip: fields.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    local_port: fields.get(5).and_then(|s| s.parse().ok()),
                    remote_port: fields.get(6).and_then(|s| s.parse().ok()),
                }))
            } else {
                Some(MgmtMessage::Unknown(rest.to_string()))
            }
        }

        "BYTECOUNT" => {
            let parts: Vec<&str> = payload.split(',').collect();
            if parts.len() >= 2 {
                Some(MgmtMessage::ByteCount {
                    rx: parts[0].parse().unwrap_or(0),
                    tx: parts[1].parse().unwrap_or(0),
                })
            } else {
                None
            }
        }

        "HOLD" => Some(MgmtMessage::Hold(payload.to_string())),

        "PASSWORD" => Some(MgmtMessage::PasswordNeeded(payload.to_string())),

        "LOG" => {
            let parts: Vec<&str> = payload.splitn(3, ',').collect();
            if parts.len() >= 3 {
                Some(MgmtMessage::Log(MgmtLogEntry {
                    timestamp: parts[0].parse().unwrap_or(0),
                    flags: parts[1].to_string(),
                    message: parts[2].to_string(),
                }))
            } else {
                Some(MgmtMessage::Log(MgmtLogEntry {
                    timestamp: 0,
                    flags: String::new(),
                    message: payload.to_string(),
                }))
            }
        }

        "CLIENT" => Some(MgmtMessage::ClientEvent(payload.to_string())),

        "FATAL" => Some(MgmtMessage::Fatal(payload.to_string())),

        "REMOTE" => {
            let parts: Vec<&str> = payload.split(',').collect();
            if parts.len() >= 3 {
                Some(MgmtMessage::Remote {
                    host: parts[0].to_string(),
                    port: parts[1].parse().unwrap_or(0),
                    proto: parts[2].to_string(),
                })
            } else {
                Some(MgmtMessage::Unknown(rest.to_string()))
            }
        }

        "RST" => Some(MgmtMessage::Restart),

        "NEED-OK" => Some(MgmtMessage::NeedOk(payload.to_string())),

        "ECHO" => Some(MgmtMessage::Echo(payload.to_string())),

        _ => Some(MgmtMessage::Unknown(rest.to_string())),
    }
}

/// Map a management STATE name to our ConnectionStatus.
pub fn state_name_to_status(state_name: &str) -> ConnectionStatus {
    match state_name.to_uppercase().as_str() {
        "CONNECTING" => ConnectionStatus::Connecting,
        "WAIT" => ConnectionStatus::Connecting,
        "AUTH" => ConnectionStatus::Authenticating,
        "GET_CONFIG" => ConnectionStatus::GettingConfig,
        "ASSIGN_IP" => ConnectionStatus::AssigningIp,
        "ADD_ROUTES" => ConnectionStatus::AddingRoutes,
        "CONNECTED" => ConnectionStatus::Connected,
        "RECONNECTING" => ConnectionStatus::Reconnecting,
        "EXITING" => ConnectionStatus::Disconnecting,
        "RESOLVE" => ConnectionStatus::Connecting,
        "TCP_CONNECT" => ConnectionStatus::Connecting,
        _ => ConnectionStatus::Connecting,
    }
}

/// Extract local IP from a STATE message.
pub fn extract_tunnel_ip(state: &MgmtState) -> Option<String> {
    state.local_ip.clone().filter(|ip| !ip.is_empty())
}

/// Extract remote (server) IP from a STATE message.
pub fn extract_remote_ip(state: &MgmtState) -> Option<String> {
    state.remote_ip.clone().filter(|ip| !ip.is_empty())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Management command builders (for manual invocation)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Well-known management commands.
pub struct MgmtCommands;

impl MgmtCommands {
    pub const HOLD_RELEASE: &'static str = "hold release";
    pub const STATE: &'static str = "state";
    pub const STATE_ON: &'static str = "state on all";
    pub const STATUS: &'static str = "status 2";
    pub const LOG_ON: &'static str = "log on all";
    pub const LOG_OFF: &'static str = "log off";
    pub const PID: &'static str = "pid";
    pub const EXIT: &'static str = "exit";
    pub const ECHO_ON: &'static str = "echo on all";

    pub fn bytecount(interval: u32) -> String {
        format!("bytecount {}", interval)
    }

    pub fn signal(name: &str) -> String {
        format!("signal {}", name)
    }

    pub fn username(auth_type: &str, user: &str) -> String {
        format!("username \"{}\" {}", auth_type, user)
    }

    pub fn password(auth_type: &str, pass: &str) -> String {
        format!("password \"{}\" {}", auth_type, pass)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Line parsing ─────────────────────────────────────────────

    #[test]
    fn parse_info() {
        let msg = parse_mgmt_line(">INFO:OpenVPN Management Interface").unwrap();
        if let MgmtMessage::Info(s) = msg {
            assert!(s.contains("Management Interface"));
        } else {
            panic!("Expected Info");
        }
    }

    #[test]
    fn parse_state() {
        let line = ">STATE:1234567890,CONNECTED,SUCCESS,10.8.0.6,1.2.3.4,,";
        let msg = parse_mgmt_line(line).unwrap();
        if let MgmtMessage::State(s) = msg {
            assert_eq!(s.state_name, "CONNECTED");
            assert_eq!(s.local_ip, Some("10.8.0.6".into()));
            assert_eq!(s.remote_ip, Some("1.2.3.4".into()));
        } else {
            panic!("Expected State");
        }
    }

    #[test]
    fn parse_bytecount() {
        let msg = parse_mgmt_line(">BYTECOUNT:123456,789012").unwrap();
        if let MgmtMessage::ByteCount { rx, tx } = msg {
            assert_eq!(rx, 123456);
            assert_eq!(tx, 789012);
        } else {
            panic!("Expected ByteCount");
        }
    }

    #[test]
    fn parse_hold() {
        let msg = parse_mgmt_line(">HOLD:Waiting for hold release").unwrap();
        assert!(matches!(msg, MgmtMessage::Hold(_)));
    }

    #[test]
    fn parse_password_needed() {
        let msg =
            parse_mgmt_line(">PASSWORD:Need 'Auth' username/password").unwrap();
        if let MgmtMessage::PasswordNeeded(s) = msg {
            assert!(s.contains("Auth"));
        } else {
            panic!("Expected PasswordNeeded");
        }
    }

    #[test]
    fn parse_log() {
        let msg = parse_mgmt_line(">LOG:1234567890,I,Initialization Sequence Completed")
            .unwrap();
        if let MgmtMessage::Log(entry) = msg {
            assert_eq!(entry.flags, "I");
            assert!(entry.message.contains("Initialization"));
        } else {
            panic!("Expected Log");
        }
    }

    #[test]
    fn parse_fatal() {
        let msg = parse_mgmt_line(">FATAL:Cannot open TUN/TAP dev").unwrap();
        if let MgmtMessage::Fatal(s) = msg {
            assert!(s.contains("TUN/TAP"));
        } else {
            panic!("Expected Fatal");
        }
    }

    #[test]
    fn parse_remote() {
        let msg = parse_mgmt_line(">REMOTE:vpn.example.com,1194,udp").unwrap();
        if let MgmtMessage::Remote { host, port, proto } = msg {
            assert_eq!(host, "vpn.example.com");
            assert_eq!(port, 1194);
            assert_eq!(proto, "udp");
        } else {
            panic!("Expected Remote");
        }
    }

    #[test]
    fn parse_restart() {
        let msg = parse_mgmt_line(">RST:restart").unwrap();
        assert!(matches!(msg, MgmtMessage::Restart));
    }

    #[test]
    fn parse_need_ok() {
        let msg = parse_mgmt_line(">NEED-OK:Need 'net' command").unwrap();
        assert!(matches!(msg, MgmtMessage::NeedOk(_)));
    }

    #[test]
    fn parse_echo() {
        let msg = parse_mgmt_line(">ECHO:test echo").unwrap();
        if let MgmtMessage::Echo(s) = msg {
            assert_eq!(s, "test echo");
        } else {
            panic!("Expected Echo");
        }
    }

    #[test]
    fn parse_unknown_realtime() {
        let msg = parse_mgmt_line(">FOOBAR:something").unwrap();
        assert!(matches!(msg, MgmtMessage::Unknown(_)));
    }

    #[test]
    fn parse_success_line() {
        let msg = parse_mgmt_line("SUCCESS: hold release succeeded").unwrap();
        if let MgmtMessage::Info(s) = msg {
            assert!(s.contains("SUCCESS"));
        } else {
            panic!("Expected Info");
        }
    }

    #[test]
    fn parse_empty_line() {
        assert!(parse_mgmt_line("").is_none());
        assert!(parse_mgmt_line("   ").is_none());
    }

    #[test]
    fn parse_client_event() {
        let msg = parse_mgmt_line(">CLIENT:ESTABLISHED,123").unwrap();
        if let MgmtMessage::ClientEvent(s) = msg {
            assert!(s.contains("ESTABLISHED"));
        } else {
            panic!("Expected ClientEvent");
        }
    }

    // ── State mapping ────────────────────────────────────────────

    #[test]
    fn state_name_mapping() {
        assert_eq!(
            state_name_to_status("CONNECTED"),
            ConnectionStatus::Connected
        );
        assert_eq!(
            state_name_to_status("AUTH"),
            ConnectionStatus::Authenticating
        );
        assert_eq!(
            state_name_to_status("RECONNECTING"),
            ConnectionStatus::Reconnecting
        );
        assert_eq!(
            state_name_to_status("EXITING"),
            ConnectionStatus::Disconnecting
        );
        assert_eq!(
            state_name_to_status("GET_CONFIG"),
            ConnectionStatus::GettingConfig
        );
        assert_eq!(
            state_name_to_status("ASSIGN_IP"),
            ConnectionStatus::AssigningIp
        );
        assert_eq!(
            state_name_to_status("ADD_ROUTES"),
            ConnectionStatus::AddingRoutes
        );
    }

    #[test]
    fn extract_tunnel_ip_some() {
        let s = MgmtState {
            timestamp: 0,
            state_name: "CONNECTED".into(),
            description: String::new(),
            local_ip: Some("10.8.0.2".into()),
            remote_ip: Some("10.8.0.1".into()),
            local_port: None,
            remote_port: None,
        };
        assert_eq!(extract_tunnel_ip(&s), Some("10.8.0.2".into()));
        assert_eq!(extract_remote_ip(&s), Some("10.8.0.1".into()));
    }

    #[test]
    fn extract_tunnel_ip_none_when_empty() {
        let s = MgmtState {
            timestamp: 0,
            state_name: "CONNECTING".into(),
            description: String::new(),
            local_ip: Some(String::new()),
            remote_ip: None,
            local_port: None,
            remote_port: None,
        };
        assert!(extract_tunnel_ip(&s).is_none());
        assert!(extract_remote_ip(&s).is_none());
    }

    // ── Command builders ─────────────────────────────────────────

    #[test]
    fn mgmt_commands_constants() {
        assert_eq!(MgmtCommands::HOLD_RELEASE, "hold release");
        assert_eq!(MgmtCommands::bytecount(5), "bytecount 5");
        assert_eq!(MgmtCommands::signal("SIGTERM"), "signal SIGTERM");
    }

    #[test]
    fn mgmt_username_password() {
        assert_eq!(
            MgmtCommands::username("Auth", "user1"),
            "username \"Auth\" user1"
        );
        assert_eq!(
            MgmtCommands::password("Auth", "pass1"),
            "password \"Auth\" pass1"
        );
    }

    // ── State with all fields ────────────────────────────────────

    #[test]
    fn parse_state_full_fields() {
        let line = ">STATE:1234567890,ASSIGN_IP,,10.8.0.2,,1194,443";
        let msg = parse_mgmt_line(line).unwrap();
        if let MgmtMessage::State(s) = msg {
            assert_eq!(s.state_name, "ASSIGN_IP");
            assert_eq!(s.local_ip, Some("10.8.0.2".into()));
            assert_eq!(s.local_port, Some(1194));
            assert_eq!(s.remote_port, Some(443));
        } else {
            panic!("Expected State");
        }
    }

    #[test]
    fn parse_state_minimal_fields() {
        let line = ">STATE:0,CONNECTING";
        let msg = parse_mgmt_line(line).unwrap();
        if let MgmtMessage::State(s) = msg {
            assert_eq!(s.state_name, "CONNECTING");
            assert!(s.local_ip.is_none());
        } else {
            panic!("Expected State");
        }
    }
}
