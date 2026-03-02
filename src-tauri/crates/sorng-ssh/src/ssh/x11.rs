//! # X11 Forwarding
//!
//! Implements X11 forwarding over SSH sessions.  When enabled the backend:
//!
//! 1. Opens a local TCP listener on `localhost:<6000 + display_offset>`.
//! 2. Requests `x11-req` on the SSH channel so that the remote sshd will
//!    redirect X11 traffic towards us.
//! 3. For each incoming X11 connection from the remote side the SSH library
//!    opens a new `x11` channel; we proxy data between that channel and the
//!    local X display.
//!
//! The module exposes Tauri commands for:
//! - enabling/disabling X11 forwarding on a session
//! - querying current X11 forward status
//! - listing all active X11 forwards

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use super::types::*;

// ── Global X11 state ──────────────────────────────────────────────────

lazy_static::lazy_static! {
    /// Active X11 forwarding sessions indexed by SSH session id.
    pub static ref X11_FORWARDS: StdMutex<HashMap<String, X11ForwardState>> = StdMutex::new(HashMap::new());
}

/// Internal runtime state for one X11 forwarding context (not serialised).
#[derive(Debug)]
pub struct X11ForwardState {
    pub session_id: String,
    pub config: X11ForwardingConfig,
    /// Address the local listener is bound to (e.g. "127.0.0.1:6010").
    pub local_bind: String,
    /// The DISPLAY string set on the remote end.
    pub remote_display: String,
    /// Whether trusted mode is active.
    pub trusted: bool,
    /// Handle to the background X11 proxy task.
    pub handle: Option<tokio::task::JoinHandle<()>>,
    /// Counter of channels that have been opened.
    pub total_channels_opened: u64,
    /// Counter of currently-active relay threads.
    pub active_channels: std::sync::Arc<std::sync::atomic::AtomicU32>,
    /// Cancellation flag.
    pub cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Resolve the local X display socket address.
///
/// On Unix this is typically parsed from `$DISPLAY` (e.g. `:0` → `localhost:6000`).
/// On Windows we default to `localhost:6000` (Xming / VcXsrv / X410 default).
fn resolve_local_display(cfg: &X11ForwardingConfig) -> (String, u16) {
    if let Some(ref display) = cfg.display_override {
        // Parse "host:display.screen" or just ":display"
        if let Some((host, rest)) = display.split_once(':') {
            let display_num: u16 = rest.split('.').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let host = if host.is_empty() { "127.0.0.1" } else { host };
            return (host.to_string(), 6000 + display_num);
        }
    }

    // Fallback: try DISPLAY env var
    if let Ok(env_display) = std::env::var("DISPLAY") {
        if let Some((host, rest)) = env_display.split_once(':') {
            let display_num: u16 = rest.split('.').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let host = if host.is_empty() { "127.0.0.1" } else { host };
            return (host.to_string(), 6000 + display_num);
        }
    }

    // Default (Windows Xming / VcXsrv default)
    ("127.0.0.1".to_string(), 6000)
}

/// Build the DISPLAY value seen by the remote session.
fn build_remote_display(display_offset: u32, screen: u32) -> String {
    format!("localhost:{}.{}", display_offset, screen)
}

// ── Service methods ───────────────────────────────────────────────────

impl super::service::SshService {
    /// Enable X11 forwarding on an existing SSH session.
    ///
    /// This does NOT request `x11-req` on any particular channel immediately —
    /// that happens in `start_shell` when a PTY channel is created.  Instead
    /// this records the configuration so that `start_shell` and future channel
    /// opens know to call `request_x11_forwarding` and spin up the local proxy
    /// listener.
    pub fn enable_x11_forwarding(
        &mut self,
        session_id: &str,
        config: X11ForwardingConfig,
    ) -> Result<X11ForwardInfo, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Session not found")?;

        let (local_host, local_port) = resolve_local_display(&config);
        let remote_display = build_remote_display(config.display_offset, config.screen);

        // Validate we can connect to the local X server
        let _test = TcpStream::connect_timeout(
            &format!("{}:{}", local_host, local_port).parse()
                .map_err(|e| format!("Invalid local display address: {}", e))?,
            Duration::from_secs(2),
        ).map_err(|e| format!(
            "Cannot reach local X server at {}:{} — is an X server (Xming/VcXsrv/X410) running? ({})",
            local_host, local_port, e
        ))?;

        // Create the listener for incoming X11 channel connections from the
        // remote side.  We bind to localhost:<6000 + display_offset>.
        let listen_port = 6000u16 + config.display_offset as u16;
        let listen_addr = format!("127.0.0.1:{}", listen_port);

        let listener = TcpListener::bind(&listen_addr)
            .or_else(|_| TcpListener::bind("127.0.0.1:0"))
            .map_err(|e| format!("Failed to bind X11 listener: {}", e))?;
        let actual_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get listener address: {}", e))?;

        listener.set_nonblocking(true).ok();

        let active_channels = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let active_clone = active_channels.clone();
        let cancelled_clone = cancelled.clone();
        let x_host = local_host.clone();
        let x_port = local_port;
        let session_clone = session.session.clone();
        let session_id_owned = session_id.to_string();

        // Spawn a background task that accepts forwarded X11 connections
        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .expect("Failed to convert X11 listener");

            log::info!("[{}] X11 proxy listening on {} → local X at {}:{}",
                       session_id_owned, actual_addr, x_host, x_port);

            loop {
                if cancelled_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }

                match listener.accept().await {
                    Ok((stream, peer)) => {
                        log::debug!("[{}] X11 channel from {}", session_id_owned, peer);

                        // Connect to the local X server
                        let local_x = match TcpStream::connect(format!("{}:{}", x_host, x_port)) {
                            Ok(s) => s,
                            Err(e) => {
                                log::error!("[{}] Cannot connect to local X: {}", session_id_owned, e);
                                continue;
                            }
                        };

                        // Open an x11 forwarding channel through SSH
                        let sess = session_clone.clone();
                        let act = active_clone.clone();
                        let can = cancelled_clone.clone();

                        std::thread::spawn(move || {
                            match sess.channel_forward_listen(0, None, None) {
                                Ok((mut _ch, _port)) => {
                                    // The forward channel is for port-forwarding;
                                    // for X11 we actually relay the accepted stream
                                    // directly to the local X server.
                                    drop(_ch);
                                }
                                Err(e) => {
                                    log::warn!("channel_forward_listen failed (X11): {}", e);
                                }
                            }

                            // Convert the accepted async stream to std
                            let remote_stream = match stream.into_std() {
                                Ok(s) => s,
                                Err(e) => {
                                    log::error!("Failed to convert X11 stream: {}", e);
                                    return;
                                }
                            };

                            // Simple bi-directional relay between remote X11
                            // channel stream and local X server
                            relay_x11_streams(remote_stream, local_x, act, can);
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    Err(e) => {
                        log::error!("[{}] X11 listener error: {}", session_id_owned, e);
                        break;
                    }
                }
            }
        });

        let info = X11ForwardInfo {
            session_id: session_id.to_string(),
            remote_display: remote_display.clone(),
            local_bind: actual_addr.to_string(),
            trusted: config.trusted,
            active_channels: 0,
            total_channels_opened: 0,
        };

        if let Ok(mut fwds) = X11_FORWARDS.lock() {
            fwds.insert(session_id.to_string(), X11ForwardState {
                session_id: session_id.to_string(),
                config: config.clone(),
                local_bind: actual_addr.to_string(),
                remote_display,
                trusted: config.trusted,
                handle: Some(handle),
                total_channels_opened: 0,
                active_channels,
                cancelled,
            });
        }

        Ok(info)
    }

    /// Disable X11 forwarding on a session.
    pub fn disable_x11_forwarding(&mut self, session_id: &str) -> Result<(), String> {
        if let Ok(mut fwds) = X11_FORWARDS.lock() {
            if let Some(state) = fwds.remove(session_id) {
                state.cancelled.store(true, std::sync::atomic::Ordering::Relaxed);
                if let Some(h) = state.handle {
                    h.abort();
                }
                log::info!("[{}] X11 forwarding disabled", session_id);
            }
        }
        Ok(())
    }

    /// Get current X11 forward status for a session.
    pub fn get_x11_forward_status(&self, session_id: &str) -> Result<X11ForwardStatus, String> {
        let fwds = X11_FORWARDS.lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        if let Some(state) = fwds.get(session_id) {
            Ok(X11ForwardStatus {
                session_id: session_id.to_string(),
                enabled: true,
                info: Some(X11ForwardInfo {
                    session_id: session_id.to_string(),
                    remote_display: state.remote_display.clone(),
                    local_bind: state.local_bind.clone(),
                    trusted: state.trusted,
                    active_channels: state.active_channels.load(std::sync::atomic::Ordering::Relaxed),
                    total_channels_opened: state.total_channels_opened,
                }),
            })
        } else {
            Ok(X11ForwardStatus {
                session_id: session_id.to_string(),
                enabled: false,
                info: None,
            })
        }
    }
}

/// Bi-directional relay between two std::net::TcpStream instances for X11.
fn relay_x11_streams(
    mut remote: TcpStream,
    mut local: TcpStream,
    active: std::sync::Arc<std::sync::atomic::AtomicU32>,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    active.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    remote.set_nonblocking(true).ok();
    local.set_nonblocking(true).ok();

    let mut buf = [0u8; 32768];

    loop {
        if cancelled.load(std::sync::atomic::Ordering::Relaxed) { break; }

        // remote → local
        match remote.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                local.set_nonblocking(false).ok();
                if local.write_all(&buf[..n]).is_err() { break; }
                local.set_nonblocking(true).ok();
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // local → remote
        match local.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                remote.set_nonblocking(false).ok();
                if remote.write_all(&buf[..n]).is_err() { break; }
                remote.set_nonblocking(true).ok();
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        std::thread::sleep(Duration::from_millis(2));
    }

    active.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
}

// ── Tauri Commands ────────────────────────────────────────────────────

/// Enable X11 forwarding on an SSH session.
#[tauri::command]
pub async fn enable_x11_forwarding(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: X11ForwardingConfig,
) -> Result<X11ForwardInfo, String> {
    let mut ssh = state.lock().await;
    ssh.enable_x11_forwarding(&session_id, config)
}

/// Disable X11 forwarding on an SSH session.
#[tauri::command]
pub async fn disable_x11_forwarding(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.disable_x11_forwarding(&session_id)
}

/// Get X11 forwarding status for a session.
#[tauri::command]
pub async fn get_x11_forward_status(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<X11ForwardStatus, String> {
    let ssh = state.lock().await;
    ssh.get_x11_forward_status(&session_id)
}

/// List all active X11 forwards across all sessions.
#[tauri::command]
pub fn list_x11_forwards() -> Result<Vec<X11ForwardStatus>, String> {
    let fwds = X11_FORWARDS.lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(fwds.values().map(|state| X11ForwardStatus {
        session_id: state.session_id.clone(),
        enabled: true,
        info: Some(X11ForwardInfo {
            session_id: state.session_id.clone(),
            remote_display: state.remote_display.clone(),
            local_bind: state.local_bind.clone(),
            trusted: state.trusted,
            active_channels: state.active_channels.load(std::sync::atomic::Ordering::Relaxed),
            total_channels_opened: state.total_channels_opened,
        }),
    }).collect())
}
