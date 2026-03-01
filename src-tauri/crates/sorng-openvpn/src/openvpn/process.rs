//! OpenVPN process lifecycle management – spawn, signal, kill, environment.

use crate::openvpn::types::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Process handle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tracks a spawned OpenVPN process.
pub struct ProcessHandle {
    /// Process ID (0 if not yet spawned).
    pub pid: AtomicU32,
    /// Whether the process is running.
    pub running: AtomicBool,
    /// The command-line args used to launch.
    pub args: RwLock<Vec<String>>,
    /// Path to the OpenVPN binary.
    pub binary_path: RwLock<PathBuf>,
    /// Path to the temporary config file written for this launch.
    pub temp_config_path: RwLock<Option<PathBuf>>,
    /// Path to the temporary auth file.
    pub temp_auth_path: RwLock<Option<PathBuf>>,
    /// Exit code from most recent run (None if still running).
    pub exit_code: RwLock<Option<i32>>,
    /// Stderr output captured so far.
    pub stderr_buf: RwLock<String>,
}

impl ProcessHandle {
    pub fn new() -> Self {
        Self {
            pid: AtomicU32::new(0),
            running: AtomicBool::new(false),
            args: RwLock::new(Vec::new()),
            binary_path: RwLock::new(PathBuf::new()),
            temp_config_path: RwLock::new(None),
            temp_auth_path: RwLock::new(None),
            exit_code: RwLock::new(None),
            stderr_buf: RwLock::new(String::new()),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn get_pid(&self) -> u32 {
        self.pid.load(Ordering::SeqCst)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Argument builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build the full command-line argument list from a config.
pub fn build_args(cfg: &OpenVpnConfig, mgmt_port: u16) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // If we have a config file, use it
    if let Some(ref path) = cfg.config_file {
        args.push("--config".into());
        args.push(path.clone());
    }

    // Always operate as client
    args.push("--client".into());

    // Device
    args.push("--dev".into());
    if let Some(ref name) = cfg.device_name {
        args.push(name.clone());
    } else {
        args.push(cfg.device_type.to_string());
    }

    // Remotes
    for r in &cfg.remotes {
        args.push("--remote".into());
        args.push(r.host.clone());
        args.push(r.port.to_string());
        args.push(r.protocol.to_string());
    }
    if cfg.remote_random && cfg.remotes.len() > 1 {
        args.push("--remote-random".into());
    }
    if cfg.resolve_retry_infinite {
        args.push("--resolv-retry".into());
        args.push("infinite".into());
    }

    // Cipher / data-ciphers
    args.push("--cipher".into());
    args.push(cfg.cipher.to_string());
    if !cfg.data_ciphers.is_empty() {
        args.push("--data-ciphers".into());
        let list: Vec<String> = cfg.data_ciphers.iter().map(|c| c.to_string()).collect();
        args.push(list.join(":"));
    }

    // Auth digest (only for non-AEAD ciphers)
    if !cfg.cipher.is_aead() {
        args.push("--auth".into());
        args.push(cfg.auth_digest.to_string());
    }

    // TLS
    match &cfg.tls_mode {
        TlsMode::None => {}
        TlsMode::TlsAuth { key_path, direction } => {
            if !key_path.is_empty() {
                args.push("--tls-auth".into());
                args.push(key_path.clone());
                if let Some(d) = direction {
                    args.push(d.to_string());
                }
            }
        }
        TlsMode::TlsCrypt { key_path } => {
            if !key_path.is_empty() {
                args.push("--tls-crypt".into());
                args.push(key_path.clone());
            }
        }
        TlsMode::TlsCryptV2 { key_path } => {
            if !key_path.is_empty() {
                args.push("--tls-crypt-v2".into());
                args.push(key_path.clone());
            }
        }
    }
    if let Some(ref ver) = cfg.tls_version_min {
        args.push("--tls-version-min".into());
        args.push(ver.clone());
    }
    if let Some(ref tc) = cfg.tls_cipher {
        args.push("--tls-cipher".into());
        args.push(tc.clone());
    }

    // Authentication
    if cfg.auth_user_pass {
        args.push("--auth-user-pass".into());
        if let Some(ref af) = cfg.auth_file {
            args.push(af.clone());
        }
    }
    if let Some(ref ca) = cfg.ca_cert {
        args.push("--ca".into());
        args.push(ca.clone());
    }
    if let Some(ref cert) = cfg.client_cert {
        args.push("--cert".into());
        args.push(cert.clone());
    }
    if let Some(ref key) = cfg.client_key {
        args.push("--key".into());
        args.push(key.clone());
    }
    if let Some(ref p12) = cfg.pkcs12 {
        args.push("--pkcs12".into());
        args.push(p12.clone());
    }
    if cfg.remote_cert_tls {
        args.push("--remote-cert-tls".into());
        args.push("server".into());
    }

    // Network tuning
    if let Some(mtu) = cfg.mtu {
        args.push("--tun-mtu".into());
        args.push(mtu.to_string());
    }
    if let Some(mss) = cfg.mss_fix {
        args.push("--mssfix".into());
        args.push(mss.to_string());
    }
    if let Some(frag) = cfg.fragment {
        args.push("--fragment".into());
        args.push(frag.to_string());
    }
    if let Some(sb) = cfg.sndbuf {
        args.push("--sndbuf".into());
        args.push(sb.to_string());
    }
    if let Some(rb) = cfg.rcvbuf {
        args.push("--rcvbuf".into());
        args.push(rb.to_string());
    }
    match cfg.compression {
        Compression::None => {}
        ref c => {
            args.push("--compress".into());
            args.push(c.to_string());
        }
    }

    // Keep-alive
    if let (Some(i), Some(t)) = (cfg.keepalive_interval, cfg.keepalive_timeout) {
        args.push("--keepalive".into());
        args.push(i.to_string());
        args.push(t.to_string());
    }
    if let Some(ct) = cfg.connect_timeout {
        args.push("--connect-timeout".into());
        args.push(ct.to_string());
    }
    if let Some(cr) = cfg.connect_retry {
        args.push("--connect-retry".into());
        args.push(cr.to_string());
    }

    // Routing
    if cfg.route_no_pull {
        args.push("--route-nopull".into());
    }
    if cfg.redirect_gateway {
        args.push("--redirect-gateway".into());
        args.push("def1".into());
    }
    for r in &cfg.routes {
        args.push("--route".into());
        args.push(r.network.clone());
        args.push(r.netmask.clone());
        if let Some(ref gw) = r.gateway {
            args.push(gw.clone());
        }
    }

    // DNS
    for dns in &cfg.dns_servers {
        args.push("--dhcp-option".into());
        args.push("DNS".into());
        args.push(dns.clone());
    }
    if cfg.block_outside_dns {
        args.push("--block-outside-dns".into());
    }

    // Proxy
    if let Some(ref hp) = cfg.http_proxy {
        args.push("--http-proxy".into());
        args.push(hp.host.clone());
        args.push(hp.port.to_string());
    }
    if let Some(ref sp) = cfg.socks_proxy {
        args.push("--socks-proxy".into());
        args.push(sp.host.clone());
        args.push(sp.port.to_string());
    }

    // Management interface
    args.push("--management".into());
    args.push(
        cfg.management_addr
            .clone()
            .unwrap_or_else(|| "127.0.0.1".into()),
    );
    args.push(mgmt_port.to_string());
    if cfg.management_password.is_some() {
        // Password is sent via management interface after connect
    }
    args.push("--management-query-passwords".into());
    args.push("--management-hold".into());

    // Logging
    args.push("--verb".into());
    args.push(cfg.verbosity.to_string());
    if let Some(m) = cfg.mute {
        args.push("--mute".into());
        args.push(m.to_string());
    }

    // Misc flags
    if cfg.persist_tun {
        args.push("--persist-tun".into());
    }
    if cfg.persist_key {
        args.push("--persist-key".into());
    }
    if cfg.nobind {
        args.push("--nobind".into());
    }
    if cfg.float {
        args.push("--float".into());
    }
    if cfg.fast_io {
        args.push("--fast-io".into());
    }

    // Custom
    for d in &cfg.custom_directives {
        for token in d.split_whitespace() {
            args.push(token.to_string());
        }
    }

    args
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Spawn helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Write a temporary config file and return its path.
pub async fn write_temp_config(cfg: &OpenVpnConfig) -> Result<PathBuf, OpenVpnError> {
    let dir = std::env::temp_dir().join("sorng-openvpn");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Failed to create temp dir")
            .with_detail(e.to_string())
    })?;

    let filename = format!("ovpn_{}.conf", uuid::Uuid::new_v4());
    let path = dir.join(&filename);
    let content = crate::openvpn::config::generate_ovpn(cfg);
    tokio::fs::write(&path, content).await.map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Failed to write temp config")
            .with_detail(e.to_string())
    })?;
    Ok(path)
}

/// Write a temporary auth-user-pass file.
pub async fn write_temp_auth(
    username: &str,
    password: &str,
) -> Result<PathBuf, OpenVpnError> {
    let dir = std::env::temp_dir().join("sorng-openvpn");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Failed to create temp dir")
            .with_detail(e.to_string())
    })?;

    let filename = format!("auth_{}.txt", uuid::Uuid::new_v4());
    let path = dir.join(&filename);
    let content = format!("{}\n{}\n", username, password);
    tokio::fs::write(&path, content).await.map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Failed to write auth file")
            .with_detail(e.to_string())
    })?;
    Ok(path)
}

/// Clean up temporary files for a session.
pub async fn cleanup_temp_files(handle: &ProcessHandle) {
    if let Some(p) = handle.temp_config_path.read().await.as_ref() {
        let _ = tokio::fs::remove_file(p).await;
    }
    if let Some(p) = handle.temp_auth_path.read().await.as_ref() {
        let _ = tokio::fs::remove_file(p).await;
    }
}

/// Spawn the OpenVPN process. Returns the process handle (does NOT wait for connection).
pub async fn spawn_openvpn(
    binary: &PathBuf,
    cfg: &OpenVpnConfig,
    mgmt_port: u16,
) -> Result<(Arc<ProcessHandle>, tokio::process::Child), OpenVpnError> {
    let args = build_args(cfg, mgmt_port);

    let child = tokio::process::Command::new(binary)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            OpenVpnError::new(
                OpenVpnErrorKind::ProcessSpawnFailed,
                format!("Failed to spawn OpenVPN: {}", e),
            )
        })?;

    let pid = child.id().unwrap_or(0);
    let handle = Arc::new(ProcessHandle::new());
    handle.pid.store(pid, Ordering::SeqCst);
    handle.running.store(true, Ordering::SeqCst);
    *handle.binary_path.write().await = binary.clone();
    *handle.args.write().await = args;

    Ok((handle, child))
}

/// Try to gracefully stop via management, then kill.
pub async fn stop_process(handle: &ProcessHandle) {
    handle.running.store(false, Ordering::SeqCst);
    let pid = handle.pid.load(Ordering::SeqCst);
    if pid == 0 {
        return;
    }

    // On Windows, use taskkill; on Unix, SIGTERM
    #[cfg(target_os = "windows")]
    {
        let _ = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
            .await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = tokio::process::Command::new("kill")
            .arg("-SIGTERM")
            .arg(pid.to_string())
            .output()
            .await;
    }
}

/// Get the version of the OpenVPN binary.
pub async fn get_openvpn_version(binary: &PathBuf) -> Result<String, OpenVpnError> {
    let output = tokio::process::Command::new(binary)
        .arg("--version")
        .output()
        .await
        .map_err(|e| {
            OpenVpnError::new(
                OpenVpnErrorKind::ProcessSpawnFailed,
                format!("Failed to run openvpn --version: {}", e),
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);

    parse_version_string(&combined)
        .ok_or_else(|| OpenVpnError::new(OpenVpnErrorKind::ParseError, "Could not parse version"))
}

/// Find a free TCP port for the management interface.
pub fn find_free_mgmt_port() -> Result<u16, OpenVpnError> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Cannot bind to ephemeral port")
            .with_detail(e.to_string())
    })?;
    let port = listener.local_addr().map_err(|e| {
        OpenVpnError::new(OpenVpnErrorKind::IoError, "Cannot get local addr")
            .with_detail(e.to_string())
    })?.port();
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_contains_client() {
        let cfg = OpenVpnConfig::default();
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--client".to_string()));
    }

    #[test]
    fn build_args_contains_remote() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.example.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--remote".to_string()));
        assert!(args.contains(&"vpn.example.com".to_string()));
    }

    #[test]
    fn build_args_management_port() {
        let cfg = OpenVpnConfig::default();
        let args = build_args(&cfg, 12345);
        assert!(args.contains(&"12345".to_string()));
        assert!(args.contains(&"--management".to_string()));
    }

    #[test]
    fn build_args_cipher() {
        let mut cfg = OpenVpnConfig::default();
        cfg.cipher = Cipher::Aes128Cbc;
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"AES-128-CBC".to_string()));
        // Non-AEAD should also have --auth
        assert!(args.contains(&"--auth".to_string()));
    }

    #[test]
    fn build_args_aead_no_auth() {
        let cfg = OpenVpnConfig::default(); // AES-256-GCM
        let args = build_args(&cfg, 7505);
        assert!(!args.contains(&"--auth".to_string()));
    }

    #[test]
    fn build_args_tls_crypt() {
        let mut cfg = OpenVpnConfig::default();
        cfg.tls_mode = TlsMode::TlsCrypt {
            key_path: "tc.key".into(),
        };
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--tls-crypt".to_string()));
        assert!(args.contains(&"tc.key".to_string()));
    }

    #[test]
    fn build_args_routes() {
        let mut cfg = OpenVpnConfig::default();
        cfg.routes.push(RouteEntry {
            network: "10.0.0.0".into(),
            netmask: "255.0.0.0".into(),
            gateway: None,
            metric: None,
        });
        cfg.redirect_gateway = true;
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--route".to_string()));
        assert!(args.contains(&"10.0.0.0".to_string()));
        assert!(args.contains(&"--redirect-gateway".to_string()));
    }

    #[test]
    fn build_args_dns() {
        let mut cfg = OpenVpnConfig::default();
        cfg.dns_servers.push("8.8.8.8".into());
        cfg.block_outside_dns = true;
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"8.8.8.8".to_string()));
        assert!(args.contains(&"--block-outside-dns".to_string()));
    }

    #[test]
    fn build_args_proxy() {
        let mut cfg = OpenVpnConfig::default();
        cfg.http_proxy = Some(ProxyConfig {
            host: "proxy.local".into(),
            port: 8080,
            username: None,
            password: None,
        });
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--http-proxy".to_string()));
        assert!(args.contains(&"proxy.local".to_string()));
    }

    #[test]
    fn build_args_persist_flags() {
        let cfg = OpenVpnConfig::default();
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--persist-tun".to_string()));
        assert!(args.contains(&"--persist-key".to_string()));
        assert!(args.contains(&"--nobind".to_string()));
    }

    #[test]
    fn build_args_compression() {
        let mut cfg = OpenVpnConfig::default();
        cfg.compression = Compression::Lz4;
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--compress".to_string()));
        assert!(args.contains(&"lz4".to_string()));
    }

    #[test]
    fn build_args_data_ciphers() {
        let cfg = OpenVpnConfig::default();
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--data-ciphers".to_string()));
    }

    #[test]
    fn build_args_verbosity() {
        let mut cfg = OpenVpnConfig::default();
        cfg.verbosity = 5;
        let args = build_args(&cfg, 7505);
        let idx = args.iter().position(|a| a == "--verb").unwrap();
        assert_eq!(args[idx + 1], "5");
    }

    #[test]
    fn build_args_connect_timeout() {
        let mut cfg = OpenVpnConfig::default();
        cfg.connect_timeout = Some(60);
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--connect-timeout".to_string()));
        assert!(args.contains(&"60".to_string()));
    }

    #[test]
    fn build_args_auth_user_pass_with_file() {
        let mut cfg = OpenVpnConfig::default();
        cfg.auth_user_pass = true;
        cfg.auth_file = Some("/path/to/auth.txt".into());
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--auth-user-pass".to_string()));
        assert!(args.contains(&"/path/to/auth.txt".to_string()));
    }

    #[test]
    fn build_args_remote_random() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remote_random = true;
        cfg.remotes.push(RemoteEndpoint {
            host: "a.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        cfg.remotes.push(RemoteEndpoint {
            host: "b.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--remote-random".to_string()));
    }

    #[test]
    fn build_args_mtu() {
        let mut cfg = OpenVpnConfig::default();
        cfg.mtu = Some(1400);
        cfg.mss_fix = Some(1300);
        cfg.fragment = Some(1200);
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--tun-mtu".to_string()));
        assert!(args.contains(&"--mssfix".to_string()));
        assert!(args.contains(&"--fragment".to_string()));
    }

    #[test]
    fn build_args_custom_directives() {
        let mut cfg = OpenVpnConfig::default();
        cfg.custom_directives.push("script-security 2".into());
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"script-security".to_string()));
        assert!(args.contains(&"2".to_string()));
    }

    #[test]
    fn process_handle_initial_state() {
        let h = ProcessHandle::new();
        assert!(!h.is_running());
        assert_eq!(h.get_pid(), 0);
    }

    #[test]
    fn find_free_mgmt_port_returns_nonzero() {
        let port = find_free_mgmt_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn build_args_tls_auth_with_direction() {
        let mut cfg = OpenVpnConfig::default();
        cfg.tls_mode = TlsMode::TlsAuth {
            key_path: "ta.key".into(),
            direction: Some(1),
        };
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--tls-auth".to_string()));
        assert!(args.contains(&"ta.key".to_string()));
        assert!(args.contains(&"1".to_string()));
    }

    #[test]
    fn build_args_pkcs12() {
        let mut cfg = OpenVpnConfig::default();
        cfg.pkcs12 = Some("client.p12".into());
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--pkcs12".to_string()));
        assert!(args.contains(&"client.p12".to_string()));
    }

    #[test]
    fn build_args_socks_proxy() {
        let mut cfg = OpenVpnConfig::default();
        cfg.socks_proxy = Some(ProxyConfig {
            host: "socks.local".into(),
            port: 1080,
            username: None,
            password: None,
        });
        let args = build_args(&cfg, 7505);
        assert!(args.contains(&"--socks-proxy".to_string()));
        assert!(args.contains(&"socks.local".to_string()));
    }
}
