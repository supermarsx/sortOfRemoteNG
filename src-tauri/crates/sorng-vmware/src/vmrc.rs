//! Cross-platform VM console access via WebSocket console tickets
//! and a local TLS-terminating TCP proxy.
//!
//! ## Architecture
//!
//! ### Primary mode — HTML5 console (cross-platform)
//!
//! 1. **Acquire a console ticket** from the vSphere REST API:
//!    `POST /api/vcenter/vm/{vm}/console/tickets  {"type":"WEBMKS"}`
//! 2. **Start a local TCP proxy** on `localhost:<port>` that bridges the
//!    Tauri webview (plain TCP) to the ESXi host (TLS), transparently
//!    handling self-signed certificates common in lab environments.
//! 3. **Frontend connects** to `ws://localhost:<port>/ticket/{ticket}`
//!    and renders the desktop using a WMKS-compatible (or noVNC) canvas.
//!
//! The proxy is a thin TCP relay — it does *not* parse WebSocket frames.
//! The HTTP Upgrade handshake flows through to ESXi, and from that point
//! on it is a bidirectional byte stream.
//!
//! ### Fallback — native client launcher (binary bridge)
//!
//! If VMware Remote Console (`vmrc`) or Horizon Client is installed, we
//! can still launch it as an external process.
//!
//! ## Ticket types
//!
//! | Type     | Protocol            | Notes                          |
//! |----------|---------------------|--------------------------------|
//! | `WEBMKS` | WebSocket + VMware MKS | Preferred, cross-platform    |
//! | `VNC`    | WebSocket + RFB     | Standard VNC, widely supported |
//! | `MKS`    | Raw TCP + MKS       | Legacy, for vmrc.exe only      |

use crate::error::{VmwareError, VmwareResult};
use crate::types::{
    ConsoleSession, ConsoleTicket, ConsoleTicketType,
    OpenConsoleRequest, VmrcConnectionConfig, VmrcSession,
};
use crate::vsphere::VsphereClient;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::sync::{watch, Mutex};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Default search paths for VMRC executable (Windows).
#[cfg(target_os = "windows")]
static VMRC_SEARCH_PATHS: &[&str] = &[
    r"C:\Program Files (x86)\VMware\VMware Remote Console\vmrc.exe",
    r"C:\Program Files\VMware\VMware Remote Console\vmrc.exe",
    r"C:\Program Files (x86)\VMware\VMware Workstation\vmrc.exe",
    r"C:\Program Files\VMware\VMware Workstation\vmrc.exe",
];

#[cfg(not(target_os = "windows"))]
static VMRC_SEARCH_PATHS: &[&str] = &[
    "/usr/bin/vmrc",
    "/usr/local/bin/vmrc",
    "/opt/vmware/bin/vmrc",
];

/// Default search paths for Horizon View client.
#[cfg(target_os = "windows")]
static HORIZON_SEARCH_PATHS: &[&str] = &[
    r"C:\Program Files (x86)\VMware\VMware Horizon View Client\vmware-view.exe",
    r"C:\Program Files\VMware\VMware Horizon View Client\vmware-view.exe",
    r"C:\Program Files (x86)\VMware\VMware Horizon Client\vmware-view.exe",
    r"C:\Program Files\VMware\VMware Horizon Client\vmware-view.exe",
];

#[cfg(not(target_os = "windows"))]
static HORIZON_SEARCH_PATHS: &[&str] = &[
    "/usr/bin/vmware-view",
    "/usr/local/bin/vmware-view",
    "/opt/vmware/bin/vmware-view",
];

/// Executable name (platform-specific).
#[cfg(target_os = "windows")]
const VMRC_EXE: &str = "vmrc.exe";
#[cfg(not(target_os = "windows"))]
const VMRC_EXE: &str = "vmrc";

#[cfg(target_os = "windows")]
const HORIZON_EXE: &str = "vmware-view.exe";
#[cfg(not(target_os = "windows"))]
const HORIZON_EXE: &str = "vmware-view";

/// PATH separator.
#[cfg(target_os = "windows")]
const PATH_SEP: char = ';';
#[cfg(not(target_os = "windows"))]
const PATH_SEP: char = ':';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Internal session types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A console session backed by a local TCP proxy.
struct ProxySessionInner {
    pub info: ConsoleSession,
    /// Sends `true` to shut down the proxy task.
    pub shutdown_tx: watch::Sender<bool>,
}

/// A binary-launcher session (VMRC / Horizon process).
struct BinarySessionInner {
    pub info: VmrcSession,
    pub child: Option<tokio::process::Child>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VmrcManager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Manages both cross-platform console sessions (WebSocket proxy) and
/// legacy binary-launcher sessions (VMRC / Horizon View).
pub struct VmrcManager {
    /// Active console proxy sessions.
    consoles: Arc<Mutex<HashMap<String, ProxySessionInner>>>,
    /// Active binary-launcher sessions.
    binaries: Arc<Mutex<HashMap<String, BinarySessionInner>>>,
}

impl VmrcManager {
    pub fn new() -> Self {
        Self {
            consoles: Arc::new(Mutex::new(HashMap::new())),
            binaries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // ────────────────────────────────────────────────────────────────
    //  Console ticket acquisition
    // ────────────────────────────────────────────────────────────────

    /// Acquire a console ticket from the vSphere REST API.
    ///
    /// This is a one-time-use ticket that expires after a few minutes.
    /// The caller must establish a WebSocket connection to the ESXi host
    /// before the ticket expires.
    ///
    /// **Endpoint**: `POST /api/vcenter/vm/{vm}/console/tickets`
    ///
    /// Requires vSphere 7.0+ REST API (vcenter Automation API).
    pub async fn acquire_console_ticket(
        &self,
        client: &VsphereClient,
        vm_id: &str,
        ticket_type: ConsoleTicketType,
    ) -> VmwareResult<ConsoleTicket> {
        let path = format!("/api/vcenter/vm/{}/console/tickets", vm_id);

        #[derive(serde::Serialize)]
        struct CreateSpec {
            r#type: String,
        }

        let body = CreateSpec {
            r#type: ticket_type.as_api_str().to_string(),
        };

        let ticket: ConsoleTicket = client.post(&path, &body).await.map_err(|e| {
            VmwareError::vmrc(format!(
                "Failed to acquire {} console ticket for VM '{}': {}",
                ticket_type.as_api_str(),
                vm_id,
                e
            ))
        })?;

        log::info!(
            "Acquired {} console ticket for VM '{}' → host={:?} port={:?}",
            ticket_type.as_api_str(),
            vm_id,
            ticket.host,
            ticket.port
        );

        Ok(ticket)
    }

    // ────────────────────────────────────────────────────────────────
    //  Console proxy sessions
    // ────────────────────────────────────────────────────────────────

    /// Open a cross-platform console for a VM.
    ///
    /// 1. Acquires a console ticket from vSphere.
    /// 2. Starts a local TCP proxy on `localhost:<random_port>`.
    /// 3. Returns a [`ConsoleSession`] with the proxy URL for the frontend.
    ///
    /// The frontend should connect with:
    /// ```js
    /// const ws = new WebSocket(session.proxyUrl + "/ticket/" + ticket);
    /// ```
    pub async fn open_console(
        &self,
        client: &VsphereClient,
        req: &OpenConsoleRequest,
    ) -> VmwareResult<ConsoleSession> {
        // 1. Acquire ticket
        let ticket = self
            .acquire_console_ticket(client, &req.vm_id, req.ticket_type.clone())
            .await?;

        // 2. Determine the remote host/port
        let remote_host = ticket
            .host
            .clone()
            .unwrap_or_else(|| client.config().host.clone());
        let remote_port = ticket.port.unwrap_or(443);

        // 3. Build the direct URL
        let direct_url = format!(
            "wss://{}:{}/ticket/{}",
            remote_host, remote_port, ticket.ticket
        );

        // 4. Start local TCP proxy
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| VmwareError::vmrc(format!("Failed to bind local proxy: {e}")))?;

        let local_addr = listener
            .local_addr()
            .map_err(|e| VmwareError::vmrc(format!("Failed to get proxy address: {e}")))?;
        let proxy_port = local_addr.port();

        let proxy_url = format!("ws://127.0.0.1:{}", proxy_port);

        // 5. Shutdown channel
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // 6. Spawn the proxy task
        let rh = remote_host.clone();
        let rp = remote_port;
        let insecure = req.insecure;
        tokio::spawn(async move {
            run_proxy_loop(listener, rh, rp, insecure, shutdown_rx).await;
        });

        // 7. Build session
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let session = ConsoleSession {
            session_id: session_id.clone(),
            vm_id: req.vm_id.clone(),
            ticket_type: req.ticket_type.as_api_str().to_string(),
            direct_url,
            proxy_url: Some(proxy_url),
            proxy_port: Some(proxy_port),
            started_at: now,
        };

        self.consoles.lock().await.insert(
            session_id,
            ProxySessionInner {
                info: session.clone(),
                shutdown_tx,
            },
        );

        log::info!(
            "Console proxy for VM '{}' listening on 127.0.0.1:{}",
            req.vm_id,
            proxy_port
        );

        Ok(session)
    }

    /// Close a console proxy session.
    pub async fn close_console(&self, session_id: &str) -> VmwareResult<()> {
        let mut consoles = self.consoles.lock().await;
        if let Some(inner) = consoles.remove(session_id) {
            // Signal the proxy task to stop
            let _ = inner.shutdown_tx.send(true);
            log::info!("Closed console session '{}'", session_id);
            Ok(())
        } else {
            Err(VmwareError::not_found(format!(
                "Console session '{}' not found",
                session_id
            )))
        }
    }

    /// Close all console proxy sessions.
    pub async fn close_all_consoles(&self) -> u32 {
        let mut consoles = self.consoles.lock().await;
        let count = consoles.len() as u32;
        for (_, inner) in consoles.drain() {
            let _ = inner.shutdown_tx.send(true);
        }
        count
    }

    /// List active console proxy sessions.
    pub async fn list_console_sessions(&self) -> Vec<ConsoleSession> {
        let consoles = self.consoles.lock().await;
        consoles.values().map(|s| s.info.clone()).collect()
    }

    /// Get a specific console session.
    pub async fn get_console_session(
        &self,
        session_id: &str,
    ) -> VmwareResult<ConsoleSession> {
        let consoles = self.consoles.lock().await;
        consoles
            .get(session_id)
            .map(|s| s.info.clone())
            .ok_or_else(|| {
                VmwareError::not_found(format!(
                    "Console session '{}' not found",
                    session_id
                ))
            })
    }

    // ────────────────────────────────────────────────────────────────
    //  Binary launcher (fallback)
    // ────────────────────────────────────────────────────────────────

    /// Launch a native VMRC or Horizon View client.
    pub async fn launch(&self, config: &VmrcConnectionConfig) -> VmwareResult<VmrcSession> {
        if config.use_horizon {
            self.launch_horizon(config).await
        } else {
            self.launch_vmrc(config).await
        }
    }

    async fn launch_vmrc(&self, config: &VmrcConnectionConfig) -> VmwareResult<VmrcSession> {
        let exe = Self::find_vmrc().ok_or_else(|| {
            VmwareError::vmrc(
                "VMRC executable not found. Install VMware Remote Console \
                 or use the cross-platform HTML5 console instead.",
            )
        })?;

        let mut cmd = Command::new(&exe);

        if let Some(ref user) = config.username {
            let uri = format!(
                "vmrc://{}@{}:{}/?moid={}",
                user, config.host, config.port, config.vm_moid
            );
            cmd.arg(uri);
        } else {
            let uri = format!(
                "vmrc://{}:{}/?moid={}",
                config.host, config.port, config.vm_moid
            );
            cmd.arg(uri);
        }

        self.spawn_and_track(cmd, config, false).await
    }

    async fn launch_horizon(
        &self,
        config: &VmrcConnectionConfig,
    ) -> VmwareResult<VmrcSession> {
        let exe = Self::find_horizon().ok_or_else(|| {
            VmwareError::vmrc(
                "VMware Horizon Client not found. Install VMware Horizon Client \
                 or use the cross-platform HTML5 console instead.",
            )
        })?;

        let mut cmd = Command::new(&exe);
        cmd.arg("-serverURL").arg(&config.host);

        if let Some(ref desktop) = config.desktop_name {
            cmd.arg("-desktopName").arg(desktop);
        }
        if let Some(ref user) = config.username {
            cmd.arg("-userName").arg(user);
        }
        if let Some(ref domain) = config.domain {
            cmd.arg("-domainName").arg(domain);
        }
        if let Some(ref pw) = config.password {
            cmd.arg("-password").arg(pw);
        }

        self.spawn_and_track(cmd, config, true).await
    }

    async fn spawn_and_track(
        &self,
        mut cmd: Command,
        config: &VmrcConnectionConfig,
        is_horizon: bool,
    ) -> VmwareResult<VmrcSession> {
        let child = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| VmwareError::vmrc(format!("Failed to launch process: {e}")))?;

        let pid = child.id().unwrap_or(0);
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let session = VmrcSession {
            session_id: session_id.clone(),
            vm_moid: config.vm_moid.clone(),
            host: config.host.clone(),
            process_id: pid,
            started_at: now,
            use_horizon: is_horizon,
        };

        let inner = BinarySessionInner {
            info: session.clone(),
            child: Some(child),
        };

        self.binaries.lock().await.insert(session_id, inner);

        Ok(session)
    }

    // ────────────────────────────────────────────────────────────────
    //  Binary session management
    // ────────────────────────────────────────────────────────────────

    /// List all binary-launcher sessions.
    pub async fn list_sessions(&self) -> Vec<VmrcSession> {
        let sessions = self.binaries.lock().await;
        sessions.values().map(|s| s.info.clone()).collect()
    }

    /// Get a specific binary session.
    pub async fn get_session(&self, session_id: &str) -> VmwareResult<VmrcSession> {
        let sessions = self.binaries.lock().await;
        sessions
            .get(session_id)
            .map(|s| s.info.clone())
            .ok_or_else(|| {
                VmwareError::not_found(format!(
                    "VMRC session '{}' not found",
                    session_id
                ))
            })
    }

    /// Check if a binary session's process is still running.
    pub async fn is_session_alive(&self, session_id: &str) -> VmwareResult<bool> {
        let mut sessions = self.binaries.lock().await;
        if let Some(inner) = sessions.get_mut(session_id) {
            if let Some(ref mut child) = inner.child {
                match child.try_wait() {
                    Ok(Some(_)) => Ok(false),
                    Ok(None) => Ok(true),
                    Err(_) => Ok(false),
                }
            } else {
                Ok(false)
            }
        } else {
            Err(VmwareError::not_found(format!(
                "VMRC session '{}' not found",
                session_id
            )))
        }
    }

    /// Kill a binary session's process and remove it.
    pub async fn close_session(&self, session_id: &str) -> VmwareResult<()> {
        let mut sessions = self.binaries.lock().await;
        if let Some(mut inner) = sessions.remove(session_id) {
            if let Some(ref mut child) = inner.child {
                let _ = child.kill().await;
            }
            Ok(())
        } else {
            Err(VmwareError::not_found(format!(
                "VMRC session '{}' not found",
                session_id
            )))
        }
    }

    /// Close all binary sessions.
    pub async fn close_all_sessions(&self) -> u32 {
        let mut sessions = self.binaries.lock().await;
        let count = sessions.len() as u32;
        for (_, mut inner) in sessions.drain() {
            if let Some(ref mut child) = inner.child {
                let _ = child.kill().await;
            }
        }
        count
    }

    /// Prune dead binary sessions (process already exited).
    pub async fn prune_dead_sessions(&self) -> u32 {
        let mut sessions = self.binaries.lock().await;
        let mut dead_ids = Vec::new();

        for (id, inner) in sessions.iter_mut() {
            let is_dead = if let Some(ref mut child) = inner.child {
                matches!(child.try_wait(), Ok(Some(_)) | Err(_))
            } else {
                true
            };
            if is_dead {
                dead_ids.push(id.clone());
            }
        }

        let count = dead_ids.len() as u32;
        for id in dead_ids {
            sessions.remove(&id);
        }
        count
    }

    // ────────────────────────────────────────────────────────────────
    //  Executable discovery (cross-platform)
    // ────────────────────────────────────────────────────────────────

    /// Find the VMRC executable on this system.
    pub fn find_vmrc() -> Option<String> {
        Self::find_executable(VMRC_SEARCH_PATHS, VMRC_EXE)
    }

    /// Find the Horizon View executable on this system.
    pub fn find_horizon() -> Option<String> {
        Self::find_executable(HORIZON_SEARCH_PATHS, HORIZON_EXE)
    }

    fn find_executable(known_paths: &[&str], exe_name: &str) -> Option<String> {
        for path in known_paths {
            if Path::new(path).exists() {
                return Some(path.to_string());
            }
        }

        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(PATH_SEP) {
                let candidate = Path::new(dir.trim()).join(exe_name);
                if candidate.exists() {
                    return candidate.to_string_lossy().into_owned().into();
                }
            }
        }

        None
    }

    /// Check whether a native VMRC client is available.
    pub fn is_vmrc_available() -> bool {
        Self::find_vmrc().is_some()
    }

    /// Check whether a native Horizon client is available.
    pub fn is_horizon_available() -> bool {
        Self::find_horizon().is_some()
    }

    /// Build a `vmrc://` URI for a given VM.
    pub fn build_vmrc_uri(
        host: &str,
        port: u16,
        moid: &str,
        username: Option<&str>,
    ) -> String {
        if let Some(user) = username {
            format!("vmrc://{}@{}:{}/?moid={}", user, host, port, moid)
        } else {
            format!("vmrc://{}:{}/?moid={}", host, port, moid)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TCP proxy — TLS termination for WebSocket console
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Main proxy loop: accept local connections and bridge to the remote
/// ESXi host over TLS.
async fn run_proxy_loop(
    listener: TcpListener,
    remote_host: String,
    remote_port: u16,
    accept_invalid_certs: bool,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            biased;

            // Shutdown signal
            result = shutdown_rx.changed() => {
                if result.is_err() || *shutdown_rx.borrow() {
                    log::debug!(
                        "Console proxy shutting down (→ {}:{})",
                        remote_host, remote_port
                    );
                    break;
                }
            }

            // Accept a new local connection
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((local_stream, peer)) => {
                        log::debug!("Console proxy: accepted connection from {}", peer);
                        let host = remote_host.clone();
                        let port = remote_port;
                        tokio::spawn(async move {
                            if let Err(e) =
                                relay_connection(local_stream, &host, port, accept_invalid_certs)
                                    .await
                            {
                                log::warn!(
                                    "Console proxy relay error (→ {}:{}): {}",
                                    host, port, e
                                );
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!("Console proxy accept error: {}", e);
                    }
                }
            }
        }
    }
}

/// Relay bytes bidirectionally between a local TCP stream and a remote
/// TLS-encrypted connection to the ESXi host.
async fn relay_connection(
    local_stream: tokio::net::TcpStream,
    remote_host: &str,
    remote_port: u16,
    accept_invalid_certs: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Build TLS connector
    let tls_connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(accept_invalid_certs)
        .build()
        .map_err(|e| format!("TLS connector build failed: {e}"))?;

    let tls_connector = tokio_native_tls::TlsConnector::from(tls_connector);

    // Connect to remote ESXi host
    let remote_tcp =
        tokio::net::TcpStream::connect((remote_host, remote_port))
            .await
            .map_err(|e| format!("Failed to connect to {}:{}: {}", remote_host, remote_port, e))?;

    let remote_tls = tls_connector
        .connect(remote_host, remote_tcp)
        .await
        .map_err(|e| format!("TLS handshake with {}:{} failed: {}", remote_host, remote_port, e))?;

    // Split both streams and relay
    let (mut local_read, mut local_write) = tokio::io::split(local_stream);
    let (mut remote_read, mut remote_write) = tokio::io::split(remote_tls);

    // Bidirectional copy — when either direction ends, we're done
    let client_to_server = tokio::io::copy(&mut local_read, &mut remote_write);
    let server_to_client = tokio::io::copy(&mut remote_read, &mut local_write);

    tokio::select! {
        result = client_to_server => {
            if let Err(e) = result {
                log::debug!("Client→Server relay ended: {}", e);
            }
        }
        result = server_to_client => {
            if let Err(e) = result {
                log::debug!("Server→Client relay ended: {}", e);
            }
        }
    }

    Ok(())
}
