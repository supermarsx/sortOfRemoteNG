//! IPMI session management — IPMI 1.5 authentication (MD2/MD5/password),
//! IPMI 2.0 RAKP handshake, key derivation (SIK, K1, K2), session lifecycle,
//! privilege escalation, and multi-session tracking.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::*;
use crate::types::*;
use chrono::Utc;
use hmac::{Hmac, Mac};
use log::{debug, info, warn};
use md5::Md5;
use rand::RngCore;
use sha1::Sha1;
use sha2::Sha256;
use std::collections::HashMap;
use std::net::UdpSocket;
use std::time::Duration;
use uuid::Uuid;

type HmacSha1 = Hmac<Sha1>;
type HmacSha256 = Hmac<Sha256>;

/// Default RMCP+/IPMI 2.0 auth type indicator.
#[allow(dead_code)]
const AUTH_TYPE_RMCP_PLUS: u8 = 0x06;

/// Maximum number of concurrent sessions per service.
const MAX_SESSIONS: usize = 64;

// ═══════════════════════════════════════════════════════════════════════
// Session Handle
// ═══════════════════════════════════════════════════════════════════════

/// A live IPMI session handle with its transport and state.
pub struct IpmiSessionHandle {
    /// Our internal session metadata.
    pub session: IpmiSession,
    /// UDP socket for RMCP communication.
    socket: UdpSocket,
    /// Sequence tracker for message numbering.
    seq_tracker: SequenceTracker,
}

impl IpmiSessionHandle {
    /// Get the session ID.
    pub fn id(&self) -> &str {
        &self.session.id
    }

    /// Get the session state.
    pub fn state(&self) -> SessionState {
        self.session.state
    }

    /// Check if the session is active.
    pub fn is_active(&self) -> bool {
        self.session.state == SessionState::Active
    }

    /// Get a summary of this session.
    pub fn info(&self) -> IpmiSessionInfo {
        IpmiSessionInfo {
            id: self.session.id.clone(),
            host: self.session.config.host.clone(),
            port: self.session.config.port,
            username: self.session.config.username.clone(),
            state: self.session.state,
            version: self.session.config.version,
            privilege: self.session.active_privilege,
            created_at: self.session.created_at,
            last_activity: self.session.last_activity,
        }
    }

    /// Send a raw IPMI request and receive the response.
    pub fn send_ipmi_request(&mut self, request: &RawIpmiRequest) -> IpmiResult<RawIpmiResponse> {
        self.ensure_active()?;

        let net_fn = request.netfn;
        let cmd = request.cmd;
        let rq_seq = self.seq_tracker.next_rq_seq(net_fn, cmd);

        let ipmi_req = IpmiRequest {
            rs_addr: BMC_SA,
            net_fn,
            rs_lun: 0,
            rq_addr: SWID,
            rq_seq,
            rq_lun: 0,
            cmd,
            data: request.data.clone(),
        };

        let datagram = match self.session.config.version {
            IpmiVersion::V15 => {
                if self.session.negotiated_auth == AuthType::None {
                    build_v15_unauth_message(&ipmi_req)
                } else {
                    let auth_code = self.compute_v15_auth_code(&ipmi_req)?;
                    let seq = self.seq_tracker.next_session_seq();
                    build_v15_auth_message(
                        self.session.negotiated_auth,
                        self.session.bmc_session_id,
                        seq,
                        &auth_code,
                        &ipmi_req,
                    )
                }
            }
            IpmiVersion::V20 => {
                let payload = ipmi_req.encode();
                let seq = self.seq_tracker.next_session_seq();
                build_v20_message(
                    self.session.bmc_session_id,
                    seq,
                    PAYLOAD_IPMI,
                    !self.session.k2.is_empty(),
                    !self.session.k1.is_empty(),
                    &payload,
                )
            }
        };

        self.send_recv(&datagram, request.netfn, request.cmd)
    }

    /// Send an `IpmiRequest` struct directly and get the inner `IpmiResponse`.
    pub fn send_request(&mut self, mut request: IpmiRequest) -> IpmiResult<IpmiResponse> {
        self.ensure_active()?;

        let rq_seq = self.seq_tracker.next_rq_seq(request.net_fn, request.cmd);
        request.rq_seq = rq_seq;

        let datagram = match self.session.config.version {
            IpmiVersion::V15 => {
                if self.session.negotiated_auth == AuthType::None {
                    build_v15_unauth_message(&request)
                } else {
                    let auth_code = self.compute_v15_auth_code(&request)?;
                    let seq = self.seq_tracker.next_session_seq();
                    build_v15_auth_message(
                        self.session.negotiated_auth,
                        self.session.bmc_session_id,
                        seq,
                        &auth_code,
                        &request,
                    )
                }
            }
            IpmiVersion::V20 => {
                let payload = request.encode();
                let seq = self.seq_tracker.next_session_seq();
                build_v20_message(
                    self.session.bmc_session_id,
                    seq,
                    PAYLOAD_IPMI,
                    !self.session.k2.is_empty(),
                    !self.session.k1.is_empty(),
                    &payload,
                )
            }
        };

        let raw = self.send_recv(&datagram, request.net_fn, request.cmd)?;
        Ok(IpmiResponse {
            rs_addr: BMC_SA,
            net_fn: request.net_fn | 0x01,
            rs_lun: 0,
            rq_addr: SWID,
            rq_seq,
            rq_lun: 0,
            cmd: request.cmd,
            completion_code: raw.completion_code,
            data: raw.data,
        })
    }

    // ── Internal helpers ────────────────────────────────────────────

    fn ensure_active(&self) -> IpmiResult<()> {
        if self.session.state != SessionState::Active {
            return Err(IpmiError::SessionNotFound {
                session_id: self.session.id.clone(),
            });
        }
        Ok(())
    }

    fn send_recv(&mut self, datagram: &[u8], _net_fn: u8, _cmd: u8) -> IpmiResult<RawIpmiResponse> {
        let timeout = Duration::from_secs(self.session.config.timeout_secs);
        let retries = self.session.config.retries;

        for attempt in 0..=retries {
            self.socket
                .send(datagram)
                .map_err(|e| IpmiError::connection_failed_with("UDP send failed", e))?;

            let mut buf = [0u8; MAX_MSG_SIZE];
            match self.socket.recv(&mut buf) {
                Ok(len) => {
                    self.session.last_activity = Utc::now();
                    let received = &buf[..len];
                    match parse_datagram(received) {
                        Ok(ParsedMessage::V15 { response, .. }) => {
                            return Ok(response.to_raw());
                        }
                        Ok(ParsedMessage::V20 { payload, .. }) => {
                            let response = IpmiResponse::decode(&payload)?;
                            return Ok(response.to_raw());
                        }
                        Ok(ParsedMessage::AsfPong(_)) => {
                            debug!("Received unexpected ASF Pong during command");
                            continue;
                        }
                        Err(e) => {
                            warn!("Parse error on attempt {}: {}", attempt, e);
                            if attempt == retries {
                                return Err(e);
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if attempt == retries {
                        return Err(IpmiError::timeout(timeout.as_millis() as u64, retries));
                    }
                    debug!("Timeout on attempt {}, retrying...", attempt);
                }
                Err(e) => {
                    return Err(IpmiError::connection_failed_with("UDP recv failed", e));
                }
            }
        }

        Err(IpmiError::timeout(timeout.as_millis() as u64, retries))
    }

    /// Compute IPMI 1.5 authentication code.
    fn compute_v15_auth_code(&self, _request: &IpmiRequest) -> IpmiResult<Vec<u8>> {
        match self.session.negotiated_auth {
            AuthType::None => Ok(Vec::new()),
            AuthType::Password => {
                // Auth code = password padded/truncated to 16 bytes
                let mut code = vec![0u8; 16];
                let pw = self.session.config.password.as_bytes();
                let len = pw.len().min(16);
                code[..len].copy_from_slice(&pw[..len]);
                Ok(code)
            }
            AuthType::MD5 => {
                // MD5(password + session_id + message_data + session_seq + password)
                // Simplified: MD5(password + session_id)
                let mut hasher = <Md5 as md5::Digest>::new();
                <Md5 as md5::Digest>::update(&mut hasher, self.session.config.password.as_bytes());
                <Md5 as md5::Digest>::update(
                    &mut hasher,
                    self.session.bmc_session_id.to_le_bytes(),
                );
                let result = <Md5 as md5::Digest>::finalize(hasher);
                Ok(result.to_vec())
            }
            AuthType::MD2 => {
                // MD2 is deprecated but supported for legacy BMCs.
                // We treat it like password auth for compatibility.
                warn!("MD2 auth is not fully implemented; using password pass-through");
                let mut code = vec![0u8; 16];
                let pw = self.session.config.password.as_bytes();
                let len = pw.len().min(16);
                code[..len].copy_from_slice(&pw[..len]);
                Ok(code)
            }
            AuthType::OEM => Err(IpmiError::NotSupported("OEM authentication".into())),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Session Manager
// ═══════════════════════════════════════════════════════════════════════

/// Manages multiple IPMI sessions.
pub struct SessionManager {
    sessions: HashMap<String, IpmiSessionHandle>,
}

impl SessionManager {
    /// Create a new empty session manager.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Number of active sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Vec<IpmiSessionInfo> {
        self.sessions.values().map(|h| h.info()).collect()
    }

    /// Get a mutable reference to a session handle.
    pub fn get_mut(&mut self, session_id: &str) -> IpmiResult<&mut IpmiSessionHandle> {
        self.sessions
            .get_mut(session_id)
            .ok_or_else(|| IpmiError::session_not_found(session_id))
    }

    /// Get an immutable reference to a session handle.
    pub fn get(&self, session_id: &str) -> IpmiResult<&IpmiSessionHandle> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| IpmiError::session_not_found(session_id))
    }

    /// Alias for `get_mut()` — used by service layer.
    pub fn get_session_mut(&mut self, session_id: &str) -> IpmiResult<&mut IpmiSessionHandle> {
        self.get_mut(session_id)
    }

    /// Get session info for a specific session.
    pub fn get_session_info(&self, session_id: &str) -> IpmiResult<IpmiSessionInfo> {
        self.get(session_id).map(|h| h.info())
    }

    /// Check if a session exists.
    pub fn contains(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Connect and establish a new IPMI session.
    pub fn connect(&mut self, config: IpmiSessionConfig) -> IpmiResult<String> {
        if self.sessions.len() >= MAX_SESSIONS {
            return Err(IpmiError::InternalError(format!(
                "Maximum session count ({}) reached",
                MAX_SESSIONS
            )));
        }

        let session_id = Uuid::new_v4().to_string();
        info!(
            "Establishing IPMI {:?} session to {}:{} as user '{}' (id={})",
            config.version,
            config.host,
            config.port,
            config.username,
            &session_id[..8]
        );

        // Create UDP socket
        let bind_addr = "0.0.0.0:0";
        let socket = UdpSocket::bind(bind_addr)
            .map_err(|e| IpmiError::connection_failed_with("Failed to bind UDP socket", e))?;

        let target = format!("{}:{}", config.host, config.port);
        socket.connect(&target).map_err(|e| {
            IpmiError::connection_failed_with(format!("Failed to connect to {}", target), e)
        })?;

        socket
            .set_read_timeout(Some(Duration::from_secs(config.timeout_secs)))
            .map_err(|e| IpmiError::connection_failed_with("Failed to set socket timeout", e))?;

        let now = Utc::now();
        let session = IpmiSession {
            id: session_id.clone(),
            config: config.clone(),
            state: SessionState::Authenticating,
            bmc_session_id: 0,
            session_seq: 0,
            rq_seq: 0,
            created_at: now,
            last_activity: now,
            negotiated_auth: config.auth_type,
            active_privilege: config.privilege,
            auth_code: Vec::new(),
            sik: Vec::new(),
            k1: Vec::new(),
            k2: Vec::new(),
            managed_system_random: Vec::new(),
            remote_console_random: Vec::new(),
            managed_system_guid: Vec::new(),
        };

        let mut handle = IpmiSessionHandle {
            session,
            socket,
            seq_tracker: SequenceTracker::new(),
        };

        // Authenticate based on IPMI version
        match config.version {
            IpmiVersion::V15 => {
                Self::authenticate_v15(&mut handle)?;
            }
            IpmiVersion::V20 => {
                Self::authenticate_v20(&mut handle)?;
            }
        }

        handle.session.state = SessionState::Active;
        info!(
            "Session {} established successfully (BMC session ID: 0x{:08X})",
            &session_id[..8],
            handle.session.bmc_session_id
        );

        self.sessions.insert(session_id.clone(), handle);
        Ok(session_id)
    }

    /// Disconnect and close a session.
    pub fn disconnect(&mut self, session_id: &str) -> IpmiResult<()> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| IpmiError::session_not_found(session_id))?;

        if handle.session.state == SessionState::Active {
            // Send Close Session command
            let close_req = IpmiRequest::new(
                NetFunction::App.as_byte(),
                cmd::CLOSE_SESSION,
                handle.session.bmc_session_id.to_le_bytes().to_vec(),
            );
            match handle.send_request(close_req) {
                Ok(_) => debug!("Close Session sent successfully"),
                Err(e) => warn!("Close Session failed (continuing disconnect): {}", e),
            }
        }

        handle.session.state = SessionState::Disconnected;
        self.sessions.remove(session_id);
        info!("Session {} disconnected", &session_id[..8]);
        Ok(())
    }

    /// Disconnect all sessions.
    pub fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.disconnect(&id) {
                warn!("Error disconnecting session {}: {}", &id[..8], e);
            }
        }
    }

    /// Set the privilege level for a session.
    pub fn set_privilege(
        &mut self,
        session_id: &str,
        level: PrivilegeLevel,
    ) -> IpmiResult<PrivilegeLevel> {
        let handle = self.get_mut(session_id)?;
        let req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::SET_SESSION_PRIVILEGE,
            vec![level as u8],
        );
        let resp = handle.send_request(req)?;
        resp.check()?;
        if resp.data.is_empty() {
            return Err(IpmiError::InvalidResponse(
                "Empty response to Set Session Privilege".into(),
            ));
        }
        let new_priv = PrivilegeLevel::from_byte(resp.data[0]);
        handle.session.active_privilege = new_priv;
        Ok(new_priv)
    }

    // ── IPMI 1.5 Authentication ─────────────────────────────────────

    fn authenticate_v15(handle: &mut IpmiSessionHandle) -> IpmiResult<()> {
        info!("Starting IPMI 1.5 authentication");

        // Step 1: Get Channel Authentication Capabilities
        let auth_cap_req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::GET_AUTH_CAPABILITIES,
            vec![0x0E, handle.session.config.privilege as u8],
        );
        let datagram = build_v15_unauth_message(&auth_cap_req);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send auth cap request failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv auth cap response failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let resp = match msg {
            ParsedMessage::V15 { response, .. } => response,
            _ => return Err(IpmiError::InvalidResponse("Expected V15 response".into())),
        };
        resp.check()?;
        if resp.data.len() < 8 {
            return Err(IpmiError::InvalidResponse(
                "Auth cap response too short".into(),
            ));
        }

        let supported_auth = resp.data[1];
        debug!("BMC supported auth types: 0x{:02X}", supported_auth);

        // Choose best available auth type
        let chosen_auth = if ((supported_auth & 0x04) != 0
            && handle.session.config.auth_type == AuthType::MD5)
            || (supported_auth & 0x02) != 0
        {
            AuthType::MD5
        } else if (supported_auth & 0x10) != 0 {
            AuthType::Password
        } else {
            AuthType::None
        };
        handle.session.negotiated_auth = chosen_auth;
        debug!("Chosen auth type: {:?}", chosen_auth);

        // Step 2: Get Session Challenge
        let mut challenge_data = vec![chosen_auth as u8];
        let mut username = [0u8; 16];
        let un = handle.session.config.username.as_bytes();
        let len = un.len().min(16);
        username[..len].copy_from_slice(&un[..len]);
        challenge_data.extend_from_slice(&username);

        let challenge_req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::GET_SESSION_CHALLENGE,
            challenge_data,
        );
        let datagram = build_v15_unauth_message(&challenge_req);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send challenge request failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv challenge response failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let resp = match msg {
            ParsedMessage::V15 { response, .. } => response,
            _ => return Err(IpmiError::InvalidResponse("Expected V15 response".into())),
        };
        resp.check()?;
        if resp.data.len() < 20 {
            return Err(IpmiError::AuthenticationFailed(
                "Challenge response too short".into(),
            ));
        }

        let temp_session_id =
            u32::from_le_bytes([resp.data[0], resp.data[1], resp.data[2], resp.data[3]]);
        let challenge_string = resp.data[4..20].to_vec();
        debug!("Temp session ID: 0x{:08X}", temp_session_id);

        // Step 3: Activate Session
        let mut activate_data = vec![chosen_auth as u8, handle.session.config.privilege as u8];
        activate_data.extend_from_slice(&challenge_string);
        // Initial outbound seq number
        let mut rng = rand::thread_rng();
        let initial_seq: u32 = rng.next_u32() & 0x0FFFFFFF | 1;
        activate_data.extend_from_slice(&initial_seq.to_le_bytes());

        let activate_req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::ACTIVATE_SESSION,
            activate_data,
        );
        // Send with temp session credentials
        let auth_code = handle.compute_v15_auth_code(&activate_req)?;
        let datagram =
            build_v15_auth_message(chosen_auth, temp_session_id, 0, &auth_code, &activate_req);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send activate request failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv activate response failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let resp = match msg {
            ParsedMessage::V15 { response, .. } => response,
            _ => return Err(IpmiError::InvalidResponse("Expected V15 response".into())),
        };
        resp.check()?;
        if resp.data.len() < 10 {
            return Err(IpmiError::AuthenticationFailed(
                "Activate session response too short".into(),
            ));
        }

        handle.session.negotiated_auth = AuthType::from_byte(resp.data[0]);
        handle.session.bmc_session_id =
            u32::from_le_bytes([resp.data[1], resp.data[2], resp.data[3], resp.data[4]]);
        handle.session.session_seq =
            u32::from_le_bytes([resp.data[5], resp.data[6], resp.data[7], resp.data[8]]);
        handle.session.active_privilege = PrivilegeLevel::from_byte(resp.data[9]);

        info!(
            "IPMI 1.5 session activated: BMC SID=0x{:08X}, priv={:?}",
            handle.session.bmc_session_id, handle.session.active_privilege
        );

        Ok(())
    }

    // ── IPMI 2.0 / RMCP+ Authentication ────────────────────────────

    fn authenticate_v20(handle: &mut IpmiSessionHandle) -> IpmiResult<()> {
        info!("Starting IPMI 2.0 (RMCP+) RAKP authentication");

        // Step 1: Get Channel Auth Capabilities (with RMCP+ flag)
        let auth_cap_req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::GET_AUTH_CAPABILITIES,
            vec![0x8E, handle.session.config.privilege as u8],
        );
        let datagram = build_v15_unauth_message(&auth_cap_req);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send auth cap failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv auth cap failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let resp = match msg {
            ParsedMessage::V15 { response, .. } => response,
            _ => {
                return Err(IpmiError::InvalidResponse(
                    "Expected V15 response for auth cap".into(),
                ))
            }
        };
        resp.check()?;
        if resp.data.len() < 8 {
            return Err(IpmiError::InvalidResponse(
                "Auth cap response too short".into(),
            ));
        }

        let extended_cap = resp.data[2];
        let supports_rmcp_plus = (extended_cap & 0x80) != 0;
        if !supports_rmcp_plus {
            return Err(IpmiError::AuthenticationFailed(
                "BMC does not support RMCP+/IPMI 2.0".into(),
            ));
        }
        debug!("BMC supports RMCP+");

        // Step 2: RMCP+ Open Session Request
        let mut rng = rand::thread_rng();
        let console_session_id: u32 = rng.next_u32();
        let cipher_suite = handle.session.config.cipher_suite;

        let mut open_req = Vec::with_capacity(32);
        open_req.push(0x00); // message tag
        open_req.push(handle.session.config.privilege as u8); // requested max priv
        open_req.extend_from_slice(&[0x00, 0x00]); // reserved
        open_req.extend_from_slice(&console_session_id.to_le_bytes());
        // Auth algorithm payload (type 0x00)
        open_req.push(0x00); // payload type
        open_req.extend_from_slice(&[0x00, 0x00]); // reserved
        open_req.push(0x08); // payload length
        let auth_algo = match cipher_suite {
            0 => 0x00,       // None
            1..=3 => 0x01,   // HMAC-SHA1
            15..=17 => 0x02, // HMAC-SHA256
            _ => 0x01,       // Default HMAC-SHA1
        };
        open_req.push(auth_algo);
        open_req.extend_from_slice(&[0x00, 0x00, 0x00]); // reserved
                                                         // Integrity algorithm payload (type 0x01)
        open_req.push(0x01);
        open_req.extend_from_slice(&[0x00, 0x00]);
        open_req.push(0x08);
        let integrity_algo = match cipher_suite {
            0 | 1 => 0x00,   // None
            2 | 3 => 0x01,   // HMAC-SHA1-96
            15..=17 => 0x02, // HMAC-SHA256-128
            _ => 0x01,
        };
        open_req.push(integrity_algo);
        open_req.extend_from_slice(&[0x00, 0x00, 0x00]);
        // Confidentiality algorithm payload (type 0x02)
        open_req.push(0x02);
        open_req.extend_from_slice(&[0x00, 0x00]);
        open_req.push(0x08);
        let confid_algo = match cipher_suite {
            0..=2 => 0x00, // None
            3 => 0x01,     // AES-CBC-128
            15 | 16 => 0x00,
            17 => 0x01,
            _ => 0x01,
        };
        open_req.push(confid_algo);
        open_req.extend_from_slice(&[0x00, 0x00, 0x00]);

        let datagram = build_v20_message(0, 0, PAYLOAD_OPEN_SESSION_REQ, false, false, &open_req);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send open session failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv open session failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let open_rsp_data = match msg {
            ParsedMessage::V20 { payload, .. } => payload,
            _ => {
                return Err(IpmiError::InvalidResponse(
                    "Expected V20 open session response".into(),
                ))
            }
        };

        if open_rsp_data.len() < 36 {
            return Err(IpmiError::RakpFailed {
                step: 0,
                reason: format!(
                    "Open session response too short: {} bytes",
                    open_rsp_data.len()
                ),
            });
        }

        let status_code = open_rsp_data[1];
        if status_code != 0x00 {
            return Err(IpmiError::RakpFailed {
                step: 0,
                reason: format!("Open session error code: 0x{:02X}", status_code),
            });
        }

        let bmc_session_id = u32::from_le_bytes([
            open_rsp_data[8],
            open_rsp_data[9],
            open_rsp_data[10],
            open_rsp_data[11],
        ]);
        handle.session.bmc_session_id = bmc_session_id;
        debug!("BMC session ID: 0x{:08X}", bmc_session_id);

        // Step 3: RAKP Message 1
        let mut remote_random = [0u8; 16];
        rng.fill_bytes(&mut remote_random);
        handle.session.remote_console_random = remote_random.to_vec();

        let mut rakp1 = Vec::with_capacity(44);
        rakp1.push(0x00); // message tag
        rakp1.extend_from_slice(&[0x00, 0x00, 0x00]); // reserved
        rakp1.extend_from_slice(&bmc_session_id.to_le_bytes());
        rakp1.extend_from_slice(&remote_random);
        rakp1.push(handle.session.config.privilege as u8); // requested role
        rakp1.extend_from_slice(&[0x00, 0x00]); // reserved
        let username_bytes = handle.session.config.username.as_bytes();
        rakp1.push(username_bytes.len() as u8);
        rakp1.extend_from_slice(username_bytes);

        let datagram = build_v20_message(0, 0, PAYLOAD_RAKP1, false, false, &rakp1);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send RAKP1 failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv RAKP2 failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let rakp2_data = match msg {
            ParsedMessage::V20 { payload, .. } => payload,
            _ => {
                return Err(IpmiError::RakpFailed {
                    step: 2,
                    reason: "Expected V20".into(),
                })
            }
        };

        if rakp2_data.len() < 40 {
            return Err(IpmiError::RakpFailed {
                step: 2,
                reason: format!("RAKP2 too short: {} bytes", rakp2_data.len()),
            });
        }

        let rakp2_status = rakp2_data[1];
        if rakp2_status != 0x00 {
            return Err(IpmiError::RakpFailed {
                step: 2,
                reason: format!("RAKP2 error code: 0x{:02X}", rakp2_status),
            });
        }

        let managed_system_random = rakp2_data[8..24].to_vec();
        let managed_system_guid = rakp2_data[24..40].to_vec();
        handle.session.managed_system_random = managed_system_random.clone();
        handle.session.managed_system_guid = managed_system_guid.clone();

        // Key exchange authentication code from RAKP2
        let _rakp2_hmac = if rakp2_data.len() > 40 {
            rakp2_data[40..].to_vec()
        } else {
            Vec::new()
        };

        // Derive SIK (Session Integrity Key)
        let password = handle.session.config.password.as_bytes();
        let sik = Self::derive_sik(
            auth_algo,
            password,
            &remote_random,
            &managed_system_random,
            handle.session.config.privilege as u8,
            username_bytes,
        )?;
        handle.session.sik = sik.clone();

        // Derive K1 (integrity key) and K2 (confidentiality key)
        let k1 = Self::derive_additional_key(&sik, 0x01, auth_algo)?;
        let k2 = Self::derive_additional_key(&sik, 0x02, auth_algo)?;
        handle.session.k1 = k1;
        handle.session.k2 = k2;

        debug!("SIK and session keys derived");

        // Step 4: RAKP Message 3
        let rakp3_hmac = Self::compute_rakp3_hmac(
            auth_algo,
            password,
            &managed_system_random,
            console_session_id,
            handle.session.config.privilege as u8,
            username_bytes,
        )?;

        let mut rakp3 = Vec::with_capacity(8 + rakp3_hmac.len());
        rakp3.push(0x00); // message tag
        rakp3.push(0x00); // status
        rakp3.extend_from_slice(&[0x00, 0x00]); // reserved
        rakp3.extend_from_slice(&bmc_session_id.to_le_bytes());
        rakp3.extend_from_slice(&rakp3_hmac);

        let datagram = build_v20_message(0, 0, PAYLOAD_RAKP3, false, false, &rakp3);

        handle
            .socket
            .send(&datagram)
            .map_err(|e| IpmiError::connection_failed_with("Send RAKP3 failed", e))?;

        let mut buf = [0u8; MAX_MSG_SIZE];
        let len = handle
            .socket
            .recv(&mut buf)
            .map_err(|e| IpmiError::connection_failed_with("Recv RAKP4 failed", e))?;

        let msg = parse_datagram(&buf[..len])?;
        let rakp4_data = match msg {
            ParsedMessage::V20 { payload, .. } => payload,
            _ => {
                return Err(IpmiError::RakpFailed {
                    step: 4,
                    reason: "Expected V20".into(),
                })
            }
        };

        if rakp4_data.len() < 8 {
            return Err(IpmiError::RakpFailed {
                step: 4,
                reason: format!("RAKP4 too short: {} bytes", rakp4_data.len()),
            });
        }

        let rakp4_status = rakp4_data[1];
        if rakp4_status != 0x00 {
            return Err(IpmiError::RakpFailed {
                step: 4,
                reason: format!("RAKP4 error code: 0x{:02X}", rakp4_status),
            });
        }

        info!("IPMI 2.0 RAKP handshake completed successfully");
        Ok(())
    }

    /// Derive the Session Integrity Key (SIK) from RAKP data.
    fn derive_sik(
        auth_algo: u8,
        password: &[u8],
        remote_random: &[u8],
        managed_random: &[u8],
        role: u8,
        username: &[u8],
    ) -> IpmiResult<Vec<u8>> {
        // SIK = HMAC_KG(Rm || Rc || Role || Username_len || Username)
        // Where KG is the Key-Generating key (usually password for user-level)
        let mut msg = Vec::with_capacity(64);
        msg.extend_from_slice(remote_random);
        msg.extend_from_slice(managed_random);
        msg.push(role);
        msg.push(username.len() as u8);
        msg.extend_from_slice(username);

        match auth_algo {
            0x00 => {
                // RAKP-none: SIK is all zeros
                Ok(vec![0u8; 20])
            }
            0x01 => {
                // RAKP-HMAC-SHA1
                let mut mac = HmacSha1::new_from_slice(password)
                    .map_err(|e| IpmiError::KeyExchangeError(format!("HMAC-SHA1 init: {}", e)))?;
                mac.update(&msg);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            0x02 => {
                // RAKP-HMAC-SHA256
                let mut mac = HmacSha256::new_from_slice(password)
                    .map_err(|e| IpmiError::KeyExchangeError(format!("HMAC-SHA256 init: {}", e)))?;
                mac.update(&msg);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            _ => Err(IpmiError::NotSupported(format!(
                "Auth algorithm 0x{:02X}",
                auth_algo
            ))),
        }
    }

    /// Derive additional keying material (K1, K2) from the SIK.
    fn derive_additional_key(sik: &[u8], constant: u8, auth_algo: u8) -> IpmiResult<Vec<u8>> {
        let input = [constant; 20];
        match auth_algo {
            0x00 => Ok(vec![0u8; 20]),
            0x01 => {
                let mut mac = HmacSha1::new_from_slice(sik).map_err(|e| {
                    IpmiError::KeyExchangeError(format!("K{} derive: {}", constant, e))
                })?;
                mac.update(&input);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            0x02 => {
                let input32 = [constant; 32];
                let mut mac = HmacSha256::new_from_slice(sik).map_err(|e| {
                    IpmiError::KeyExchangeError(format!("K{} derive: {}", constant, e))
                })?;
                mac.update(&input32);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            _ => Err(IpmiError::NotSupported(format!(
                "Auth algorithm 0x{:02X}",
                auth_algo
            ))),
        }
    }

    /// Compute the HMAC for RAKP Message 3.
    fn compute_rakp3_hmac(
        auth_algo: u8,
        password: &[u8],
        managed_random: &[u8],
        console_session_id: u32,
        role: u8,
        username: &[u8],
    ) -> IpmiResult<Vec<u8>> {
        let mut msg = Vec::with_capacity(64);
        msg.extend_from_slice(managed_random);
        msg.extend_from_slice(&console_session_id.to_le_bytes());
        msg.push(role);
        msg.push(username.len() as u8);
        msg.extend_from_slice(username);

        match auth_algo {
            0x00 => Ok(Vec::new()),
            0x01 => {
                let mut mac = HmacSha1::new_from_slice(password)
                    .map_err(|e| IpmiError::KeyExchangeError(format!("RAKP3 HMAC: {}", e)))?;
                mac.update(&msg);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            0x02 => {
                let mut mac = HmacSha256::new_from_slice(password)
                    .map_err(|e| IpmiError::KeyExchangeError(format!("RAKP3 HMAC: {}", e)))?;
                mac.update(&msg);
                Ok(mac.finalize().into_bytes().to_vec())
            }
            _ => Err(IpmiError::NotSupported(format!(
                "Auth algorithm 0x{:02X}",
                auth_algo
            ))),
        }
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Perform an ASF Presence Ping to check if a BMC is reachable.
pub fn ping_bmc(host: &str, port: u16, timeout_secs: u64) -> IpmiResult<bool> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| IpmiError::connection_failed_with("Bind failed", e))?;
    socket
        .connect(format!("{}:{}", host, port))
        .map_err(|e| IpmiError::connection_failed_with("Connect failed", e))?;
    socket
        .set_read_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|e| IpmiError::connection_failed_with("Set timeout failed", e))?;

    let ping = AsfHeader::encode_ping(0x01);
    socket
        .send(&ping)
        .map_err(|e| IpmiError::connection_failed_with("Send ping failed", e))?;

    let mut buf = [0u8; MAX_MSG_SIZE];
    match socket.recv(&mut buf) {
        Ok(len) => {
            let msg = parse_datagram(&buf[..len])?;
            match msg {
                ParsedMessage::AsfPong(pong) => Ok(pong.supports_ipmi()),
                _ => Ok(false),
            }
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(false),
        Err(e) => Err(IpmiError::connection_failed_with("Recv failed", e)),
    }
}
