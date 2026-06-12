//! SSH3 port forwarding — local forward over QUIC bidirectional streams.
//!
//! Each accepted local TCP connection is bridged to a QUIC bidirectional stream
//! opened off the session's live `quinn::Connection` (`connection.open_bi()` —
//! the exact `sorng-vpn/src/proxy.rs::connect_quic_tunnel_static` pattern), with
//! bytes copied both ways via `tokio::io::copy`. Per SSH3 semantics, the forward
//! tunnels TCP through the already-established QUIC/H3 session; the forward
//! target (`host:port`) is sent as a small framed header at the head of the
//! stream so the SSH3 server knows where to `direct-tcpip` connect.
//!
//! ## Loopback-bind policy (security parity with t22-A8 / classic SSH)
//! [`Ssh3Service::resolve_forward_bind`] mirrors the classic SSH
//! `service.rs::resolve_forward_bind`: an empty `local_host` defaults to
//! `127.0.0.1`; a loopback bind is always allowed; a non-loopback / wildcard
//! bind (`0.0.0.0`, `::`, a LAN/public interface) is REJECTED unless the
//! forward config explicitly sets `allow_non_loopback_bind = true`. This keeps
//! the SSH3 tunnel reachable only from this machine by default.
//!
//! ## Forward-target framing
//! [`forward_target_frame`] encodes the target as
//! `b"SSH3-FWD " + host + ":" + port + "\n"` — a host-independent, testable
//! header written first on each bidi stream. The exact wire detail that a live
//! upstream `ssh3` server expects can only be confirmed against a real server
//! (host-gated, like the classic SSH golden path); the framing is isolated here
//! so it is the single place to adjust once a live server is available.
//!
//! ## Status
//! - **Local forward**: REAL — binds (policy-checked), accepts, opens a QUIC
//!   bidi stream per connection, writes the target frame, bridges both ways.
//! - **Remote / Dynamic**: explicit not-implemented errors (out of e5 scope:
//!   local forwarding). They never silently drop accepted streams.

use chrono::Utc;
use uuid::Uuid;

use super::{
    Ssh3ConnectionState, Ssh3PortForwardConfig, Ssh3PortForwardDirection, Ssh3PortForwardHandle,
    Ssh3Service,
};

/// Encode the forward target (`host:port`) as the stream header written at the
/// head of each forwarded QUIC bidi stream.
///
/// Host-independent and pure so it can be unit-tested without a live server.
/// Format: `SSH3-FWD <host>:<port>\n`.
pub(super) fn forward_target_frame(host: &str, port: u16) -> Vec<u8> {
    format!("SSH3-FWD {host}:{port}\n").into_bytes()
}

impl Ssh3Service {
    /// Set up a port forward (local / remote / dynamic).
    ///
    /// Validates session liveness, resolves+validates the bind address (loopback
    /// policy), clones the live `quinn::Connection` off the session transport,
    /// spawns the direction handler, and stores the abort handle. The handler
    /// runs on a tokio task so the command thread is never blocked.
    pub async fn setup_port_forward(
        &mut self,
        session_id: &str,
        config: Ssh3PortForwardConfig,
    ) -> Result<String, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if session.connection_state != Ssh3ConnectionState::Connected {
            return Err("Session not connected".to_string());
        }

        // The live QUIC connection raw bidi streams open off. Without a live
        // transport there is nothing to forward over — fail honestly.
        let connection = session
            .transport
            .as_ref()
            .map(|t| t.connection.clone())
            .ok_or("Session has no live QUIC transport")?;

        let forward_id = Uuid::new_v4().to_string();
        let config_clone = config.clone();
        let forward_id_clone = forward_id.clone();

        let handle = match config.direction {
            Ssh3PortForwardDirection::Local => tokio::spawn(async move {
                Self::handle_local_forward(connection, config_clone, forward_id_clone).await
            }),
            Ssh3PortForwardDirection::Remote => tokio::spawn(async move {
                Self::handle_remote_forward(config_clone, forward_id_clone).await
            }),
            Ssh3PortForwardDirection::Dynamic => tokio::spawn(async move {
                Self::handle_dynamic_forward(config_clone, forward_id_clone).await
            }),
        };

        self.port_forwards.insert(
            forward_id.clone(),
            Ssh3PortForwardHandle {
                id: forward_id.clone(),
                config,
                handle,
            },
        );

        session.last_activity = Utc::now();
        Ok(forward_id)
    }

    /// Resolve and validate the bind address for a local/dynamic SSH3 forward.
    ///
    /// Secure-by-default policy mirrored from the classic SSH path
    /// (`ssh/service.rs::resolve_forward_bind`, t6 finding #10 / t22-A8):
    /// - An empty `local_host` defaults to loopback (`127.0.0.1`).
    /// - A loopback bind (`127.0.0.1`, `::1`, `localhost`) is always allowed.
    /// - A non-loopback / wildcard bind (`0.0.0.0`, `::`, a LAN/public
    ///   interface) is REJECTED unless `allow_non_loopback_bind` is explicitly
    ///   set on the forward config.
    ///
    /// Returns the effective bind host string, or an actionable error.
    pub(super) fn resolve_forward_bind(config: &Ssh3PortForwardConfig) -> Result<String, String> {
        let requested = config.local_host.trim();
        let host = if requested.is_empty() {
            "127.0.0.1"
        } else {
            requested
        };

        let is_loopback = match host.parse::<std::net::IpAddr>() {
            Ok(ip) => ip.is_loopback(),
            // Non-IP literals: only the conventional loopback hostname is
            // treated as loopback. Anything else is considered non-loopback.
            Err(_) => host.eq_ignore_ascii_case("localhost"),
        };

        if is_loopback || config.allow_non_loopback_bind {
            Ok(host.to_string())
        } else {
            Err(format!(
                "Refusing to bind SSH3 port forward to non-loopback address '{}'. \
                 Port forwards default to loopback (127.0.0.1) so the tunnel is only \
                 reachable from this machine. To deliberately expose this forward to \
                 other hosts on the network, set `allow_non_loopback_bind = true` on \
                 the port-forward configuration.",
                host
            ))
        }
    }

    /// Local forward: listen on the (policy-checked) local address, and for each
    /// accepted TCP connection open a QUIC bidi stream to the SSH3 server,
    /// announce the forward target, and bridge bytes both directions.
    ///
    /// Per-connection work runs on its own spawned task so a slow/long-lived
    /// tunnel never blocks the accept loop. The accept loop itself runs on the
    /// forward's task (spawned by [`setup_port_forward`]); aborting that task
    /// (via [`stop_port_forward`]) tears the listener and all bridges down.
    pub(super) async fn handle_local_forward(
        connection: quinn::Connection,
        config: Ssh3PortForwardConfig,
        id: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let bind_host = Self::resolve_forward_bind(&config)?;
        let bind_addr = format!("{}:{}", bind_host, config.local_port);

        let listener = tokio::net::TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("SSH3[{id}]: failed to bind local listener {bind_addr}: {e}"))?;

        log::info!(
            "SSH3[{id}]: local forward listening on {bind_addr} -> {}:{} (over QUIC)",
            config.remote_host,
            config.remote_port
        );

        loop {
            let (mut tcp_stream, peer) = match listener.accept().await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("SSH3[{id}]: accept error, stopping forward: {e}");
                    break;
                }
            };

            let conn = connection.clone();
            let remote_host = config.remote_host.clone();
            let remote_port = config.remote_port;
            let id_clone = id.clone();

            // Bridge this connection on its own task; never block the accept loop.
            tokio::spawn(async move {
                match conn.open_bi().await {
                    Ok((mut send, mut recv)) => {
                        // Announce the forward target so the SSH3 server knows
                        // where to direct-tcpip connect this stream.
                        let frame = forward_target_frame(&remote_host, remote_port);
                        if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut send, &frame).await {
                            log::warn!(
                                "SSH3[{id_clone}]: failed to send forward target frame for {peer}: {e}"
                            );
                            return;
                        }

                        let (mut tcp_read, mut tcp_write) = tcp_stream.split();
                        // Bridge both directions; either side finishing ends the
                        // pair (the join completes when both copies resolve).
                        let _ = tokio::join!(
                            tokio::io::copy(&mut tcp_read, &mut send),
                            tokio::io::copy(&mut recv, &mut tcp_write),
                        );
                        log::debug!("SSH3[{id_clone}]: forward bridge for {peer} closed");
                    }
                    Err(e) => {
                        log::warn!(
                            "SSH3[{id_clone}]: QUIC open_bi failed for {peer}, dropping: {e}"
                        );
                    }
                }
            });
        }

        Ok(())
    }

    /// Remote forward (out of e5 scope: local forwarding). Honest error — never
    /// binds-and-drops.
    pub(super) async fn handle_remote_forward(
        config: Ssh3PortForwardConfig,
        id: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        log::info!(
            "SSH3[{id}]: remote forward {}:{} -> {}:{} requested (not implemented)",
            config.remote_host,
            config.remote_port,
            config.local_host,
            config.local_port
        );
        Err("SSH3 remote port-forward not yet implemented".into())
    }

    /// Dynamic (SOCKS5) forward (out of e5 scope: local forwarding). Honest
    /// error — never binds-and-drops.
    pub(super) async fn handle_dynamic_forward(
        config: Ssh3PortForwardConfig,
        id: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        log::info!(
            "SSH3[{id}]: SOCKS5 dynamic forward on {}:{} requested (not implemented)",
            config.local_host,
            config.local_port
        );
        Err("SSH3 dynamic port-forward not yet implemented".into())
    }

    /// Stop a port forward: abort the handler task (tears down the listener and
    /// all per-connection bridges) and drop the handle.
    pub async fn stop_port_forward(&mut self, forward_id: &str) -> Result<(), String> {
        if let Some(handle) = self.port_forwards.remove(forward_id) {
            handle.handle.abort();
            log::info!("SSH3: stopped port forward {forward_id}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forward_config(
        local_host: &str,
        allow_non_loopback_bind: bool,
    ) -> Ssh3PortForwardConfig {
        Ssh3PortForwardConfig {
            local_host: local_host.to_string(),
            local_port: 0,
            remote_host: "example.com".to_string(),
            remote_port: 80,
            direction: Ssh3PortForwardDirection::Local,
            allow_non_loopback_bind,
        }
    }

    // ---- loopback bind policy (parity with classic SSH t22-A8) ----

    #[test]
    fn forward_bind_defaults_empty_host_to_loopback() {
        let host = Ssh3Service::resolve_forward_bind(&forward_config("", false))
            .expect("empty host defaults to loopback");
        assert_eq!(host, "127.0.0.1");
    }

    #[test]
    fn forward_bind_loopback_ip_allowed_without_optin() {
        let host = Ssh3Service::resolve_forward_bind(&forward_config("127.0.0.1", false))
            .expect("loopback IP allowed");
        assert_eq!(host, "127.0.0.1");
    }

    #[test]
    fn forward_bind_loopback_v6_allowed_without_optin() {
        let host = Ssh3Service::resolve_forward_bind(&forward_config("::1", false))
            .expect("loopback v6 allowed");
        assert_eq!(host, "::1");
    }

    #[test]
    fn forward_bind_localhost_name_allowed_without_optin() {
        let host = Ssh3Service::resolve_forward_bind(&forward_config("localhost", false))
            .expect("localhost name allowed");
        assert_eq!(host, "localhost");
    }

    #[test]
    fn forward_bind_non_loopback_rejected_without_optin() {
        let err = Ssh3Service::resolve_forward_bind(&forward_config("0.0.0.0", false))
            .expect_err("non-loopback bind without opt-in must be rejected");
        assert!(
            err.contains("allow_non_loopback_bind"),
            "error should explain the opt-in: {err}"
        );
        assert!(err.contains("0.0.0.0"), "error should name the address: {err}");
    }

    #[test]
    fn forward_bind_lan_address_rejected_without_optin() {
        let err = Ssh3Service::resolve_forward_bind(&forward_config("192.168.1.50", false))
            .expect_err("LAN bind without opt-in must be rejected");
        assert!(err.contains("allow_non_loopback_bind"), "got: {err}");
    }

    #[test]
    fn forward_bind_non_loopback_allowed_with_optin() {
        let host = Ssh3Service::resolve_forward_bind(&forward_config("0.0.0.0", true))
            .expect("non-loopback allowed once opted in");
        assert_eq!(host, "0.0.0.0");
    }

    // ---- forward-target framing (host-independent) ----

    #[test]
    fn forward_target_frame_encodes_host_and_port() {
        let frame = forward_target_frame("example.com", 443);
        assert_eq!(frame, b"SSH3-FWD example.com:443\n".to_vec());
    }

    #[test]
    fn forward_target_frame_is_newline_terminated() {
        let frame = forward_target_frame("10.0.0.1", 22);
        assert_eq!(frame.last(), Some(&b'\n'));
        let s = String::from_utf8(frame).expect("frame is utf8");
        assert!(s.starts_with("SSH3-FWD "));
        assert!(s.contains("10.0.0.1:22"));
    }
}
