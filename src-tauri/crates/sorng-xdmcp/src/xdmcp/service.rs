//! XDMCP service — multi-session manager.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::xdmcp::session::XdmcpSessionHandle;
use crate::xdmcp::types::*;

pub type XdmcpServiceState = Arc<Mutex<XdmcpService>>;

pub struct XdmcpService {
    sessions: HashMap<String, XdmcpSessionHandle>,
}

impl XdmcpService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Connect to an XDMCP display manager.
    pub async fn connect(
        &mut self,
        session_id: String,
        config: XdmcpConfig,
    ) -> Result<(), XdmcpError> {
        if self.sessions.contains_key(&session_id) {
            return Err(XdmcpError::already_exists(format!(
                "session '{}' already exists",
                session_id
            )));
        }

        let handle = XdmcpSessionHandle::connect(session_id.clone(), config).await?;
        self.sessions.insert(session_id, handle);
        Ok(())
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), XdmcpError> {
        let handle = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| XdmcpError::not_found(format!("session '{}' not found", session_id)))?;
        let _ = handle.disconnect().await;
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Some(handle) = self.sessions.remove(&id) {
                let _ = handle.disconnect().await;
            }
        }
    }

    /// Discover XDMCP hosts via broadcast query.
    pub async fn discover(
        &self,
        broadcast_address: &str,
        timeout_ms: u64,
    ) -> Result<Vec<serde_json::Value>, XdmcpError> {
        use tokio::net::UdpSocket;
        use tokio::time::{timeout, Duration};

        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(XdmcpError::from)?;
        socket.set_broadcast(true).map_err(XdmcpError::from)?;

        let target = format!("{}:{}", broadcast_address, XDMCP_PORT);
        let query = crate::xdmcp::protocol::build_broadcast_query(&[]);
        socket
            .send_to(&query, &target)
            .await
            .map_err(XdmcpError::from)?;

        let mut hosts = Vec::new();
        let deadline = Duration::from_millis(timeout_ms);
        let mut buf = vec![0u8; 1024];

        let start = tokio::time::Instant::now();
        loop {
            let remaining = deadline
                .checked_sub(start.elapsed())
                .unwrap_or(Duration::ZERO);
            if remaining.is_zero() {
                break;
            }

            match timeout(remaining, socket.recv_from(&mut buf)).await {
                Ok(Ok((n, addr))) => {
                    let header = crate::xdmcp::protocol::XdmcpHeader::decode(&buf[..n]);
                    if let Some(h) = header {
                        if h.opcode == XdmcpOpcode::Willing {
                            if let Some(w) = crate::xdmcp::protocol::parse_willing(&buf[6..n]) {
                                hosts.push(serde_json::json!({
                                    "address": addr.to_string(),
                                    "hostname": w.hostname,
                                    "status": w.status,
                                }));
                            }
                        }
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => break, // timeout
            }
        }

        Ok(hosts)
    }

    /// Check if a session is connected / running.
    pub async fn is_connected(&self, session_id: &str) -> bool {
        if let Some(handle) = self.sessions.get(session_id) {
            let st = handle.state.lock().await;
            matches!(
                st.state,
                XdmcpSessionState::Running
                    | XdmcpSessionState::Accepted
                    | XdmcpSessionState::Requesting
                    | XdmcpSessionState::Discovering
            )
        } else {
            false
        }
    }

    /// Get session info as JSON.
    pub async fn get_session_info(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, XdmcpError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| XdmcpError::not_found(format!("session '{}' not found", session_id)))?;
        let st = handle.state.lock().await;
        Ok(serde_json::json!({
            "id": session_id,
            "host": handle.config.host,
            "port": handle.config.port,
            "state": format!("{:?}", st.state),
            "display_number": st.display_number,
            "session_id": st.session_id,
            "display_manager": st.display_manager,
            "display_width": st.display_width,
            "display_height": st.display_height,
            "bytes_sent": st.bytes_sent,
            "bytes_received": st.bytes_received,
            "packets_sent": st.packets_sent,
            "packets_received": st.packets_received,
            "keepalive_count": st.keepalive_count,
            "last_activity": st.last_activity,
            "x_server_pid": st.x_server_pid,
        }))
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<serde_json::Value> {
        let mut list = Vec::new();
        for (id, handle) in &self.sessions {
            let st = handle.state.lock().await;
            list.push(serde_json::json!({
                "id": id,
                "host": handle.config.host,
                "state": format!("{:?}", st.state),
                "display_number": st.display_number,
            }));
        }
        list
    }

    /// Get stats for a session.
    pub async fn get_session_stats(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, XdmcpError> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| XdmcpError::not_found(format!("session '{}' not found", session_id)))?;
        let st = handle.state.lock().await;
        Ok(serde_json::json!({
            "bytes_sent": st.bytes_sent,
            "bytes_received": st.bytes_received,
            "packets_sent": st.packets_sent,
            "packets_received": st.packets_received,
            "keepalive_count": st.keepalive_count,
            "last_activity": st.last_activity,
        }))
    }

    /// Number of active sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Remove ended / failed sessions.
    pub async fn prune_ended(&mut self) -> Vec<String> {
        let mut pruned = Vec::new();
        let mut to_remove = Vec::new();

        for (id, handle) in &self.sessions {
            let st = handle.state.lock().await;
            if matches!(
                st.state,
                XdmcpSessionState::Ended | XdmcpSessionState::Failed
            ) {
                to_remove.push(id.clone());
            }
        }

        for id in to_remove {
            self.sessions.remove(&id);
            pruned.push(id);
        }

        pruned
    }
}

impl Default for XdmcpService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new() {
        let svc = XdmcpService::new();
        assert_eq!(svc.session_count(), 0);
    }

    #[tokio::test]
    async fn service_list_empty() {
        let svc = XdmcpService::new();
        assert!(svc.list_sessions().await.is_empty());
    }
}
