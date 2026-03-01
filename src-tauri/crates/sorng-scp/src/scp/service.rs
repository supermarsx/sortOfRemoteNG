// ── ScpService – session lifecycle management ───────────────────────────────

use crate::scp::types::*;
use chrono::Utc;
use log::{info, warn};
use sha2::{Digest, Sha256};
use ssh2::Session;
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Internal session handle ──────────────────────────────────────────────────

pub(crate) struct ScpSessionHandle {
    pub info: ScpSessionInfo,
    pub session: Session,
    #[allow(dead_code)]
    pub tcp: TcpStream,
    pub keepalive_tx: Option<tokio::sync::mpsc::Sender<()>>,
}

// ── Service struct ───────────────────────────────────────────────────────────

pub struct ScpService {
    pub(crate) sessions: HashMap<String, ScpSessionHandle>,
    pub(crate) queue: Vec<ScpQueueEntry>,
    pub(crate) queue_running: bool,
}

impl ScpService {
    /// Create a new ScpService wrapped in the managed state type.
    pub fn new() -> ScpServiceState {
        Arc::new(Mutex::new(ScpService {
            sessions: HashMap::new(),
            queue: Vec::new(),
            queue_running: false,
        }))
    }

    // ── Connect ──────────────────────────────────────────────────────────────

    /// Establish an SSH session for SCP transfers.
    pub async fn connect(&mut self, config: ScpConnectionConfig) -> Result<ScpSessionInfo, String> {
        let addr = format!("{}:{}", config.host, config.port);
        info!("SCP connecting to {}", addr);

        // TCP connection with timeout
        let tcp = TcpStream::connect_timeout(
            &addr
                .parse()
                .map_err(|e| format!("Invalid address '{}': {}", addr, e))?,
            std::time::Duration::from_secs(config.timeout_secs),
        )
        .map_err(|e| format!("TCP connection to {} failed: {}", addr, e))?;

        tcp.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        // SSH handshake
        let mut session =
            Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;

        if config.compress {
            session.set_compress(true);
        }

        // Set cipher/kex/mac preferences if provided
        if let Some(ref ciphers) = config.preferred_ciphers {
            let _ = session.method_pref(ssh2::MethodType::CryptCs, ciphers);
            let _ = session.method_pref(ssh2::MethodType::CryptSc, ciphers);
        }
        if let Some(ref macs) = config.preferred_macs {
            let _ = session.method_pref(ssh2::MethodType::MacCs, macs);
            let _ = session.method_pref(ssh2::MethodType::MacSc, macs);
        }
        if let Some(ref kex) = config.preferred_kex {
            let _ = session.method_pref(ssh2::MethodType::Kex, kex);
        }

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Server banner
        let banner = session.banner().map(|b| b.to_string());

        // Host key fingerprint
        let fingerprint = session
            .host_key_hash(ssh2::HashType::Sha256)
            .map(|bytes| {
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    bytes,
                );
                format!("SHA256:{}", encoded)
            });

        // Authenticate
        let auth_method = self
            .authenticate(&mut session, &config)
            .map_err(|e| format!("Authentication failed: {}", e))?;

        if !session.authenticated() {
            return Err("Authentication failed – not authenticated after auth attempt".into());
        }

        info!("SCP authenticated to {} via {}", addr, auth_method);

        // Probe remote home directory
        let remote_home = self.probe_remote_home(&session);

        // Keep-alive
        let keepalive_interval = config.keepalive_interval_secs;
        session.set_keepalive(keepalive_interval > 0, keepalive_interval as u32);

        let session_id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let info = ScpSessionInfo {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            auth_method: auth_method.clone(),
            connected: true,
            label: config.label.clone(),
            color_tag: config.color_tag.clone(),
            server_banner: banner,
            remote_home: remote_home.clone(),
            connected_at: now,
            last_activity: now,
            bytes_uploaded: 0,
            bytes_downloaded: 0,
            transfers_count: 0,
            server_fingerprint: fingerprint,
        };

        self.sessions.insert(
            session_id.clone(),
            ScpSessionHandle {
                info: info.clone(),
                session,
                tcp,
                keepalive_tx: None,
            },
        );

        Ok(info)
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(mut handle) = self.sessions.remove(session_id) {
            info!("SCP disconnecting session {}", session_id);
            if let Some(tx) = handle.keepalive_tx.take() {
                let _ = tx.send(()).await;
            }
            let _ = handle.session.disconnect(None, "Client disconnecting", None);
            Ok(())
        } else {
            Err(format!("Session '{}' not found", session_id))
        }
    }

    /// Disconnect all active sessions.
    pub async fn disconnect_all(&mut self) -> Result<u32, String> {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        let count = ids.len() as u32;
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
        Ok(count)
    }

    // ── Session queries ──────────────────────────────────────────────────────

    pub async fn get_session_info(&self, session_id: &str) -> Result<ScpSessionInfo, String> {
        self.sessions
            .get(session_id)
            .map(|h| h.info.clone())
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }

    pub async fn list_sessions(&self) -> Vec<ScpSessionInfo> {
        self.sessions.values().map(|h| h.info.clone()).collect()
    }

    pub async fn ping(&mut self, session_id: &str) -> Result<bool, String> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        match handle.session.keepalive_send() {
            Ok(_) => {
                handle.info.last_activity = Utc::now();
                Ok(true)
            }
            Err(_) => {
                handle.info.connected = false;
                Ok(false)
            }
        }
    }

    // ── Authentication ───────────────────────────────────────────────────────

    pub(crate) fn authenticate(
        &self,
        session: &mut Session,
        config: &ScpConnectionConfig,
    ) -> Result<String, String> {
        // 1. Agent auth
        if config.use_agent {
            if session.userauth_agent(&config.username).is_ok() && session.authenticated() {
                return Ok("agent".into());
            }
            warn!("SCP agent auth failed for {}, trying other methods", config.username);
        }

        // 2. Private key from memory (write to temp file, then use pubkey_file)
        if let Some(ref key_data) = config.private_key_data {
            let passphrase = config.private_key_passphrase.as_deref();
            // Write the key data to a temporary file for ssh2
            let tmp_dir = std::env::temp_dir();
            let tmp_key = tmp_dir.join(format!("sorng_scp_key_{}", uuid::Uuid::new_v4()));
            if let Ok(()) = std::fs::write(&tmp_key, key_data) {
                let result = session.userauth_pubkey_file(
                    &config.username,
                    None,
                    &tmp_key,
                    passphrase,
                );
                let _ = std::fs::remove_file(&tmp_key);
                if result.is_ok() && session.authenticated() {
                    return Ok("publickey-memory".into());
                }
            }
            warn!("SCP publickey-memory auth failed for {}", config.username);
        }

        // 3. Private key from file
        if let Some(ref key_path) = config.private_key_path {
            let path = Path::new(key_path);
            if path.exists() {
                let passphrase = config.private_key_passphrase.as_deref();
                if session
                    .userauth_pubkey_file(&config.username, None, path, passphrase)
                    .is_ok()
                    && session.authenticated()
                {
                    return Ok("publickey-file".into());
                }
                warn!("SCP publickey-file auth failed for {}", config.username);
            }
        }

        // 4. Try default key files (~/.ssh/id_rsa, id_ed25519, etc.)
        if let Some(home) = dirs::home_dir() {
            let ssh_dir = home.join(".ssh");
            for key_name in &["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
                let key_path = ssh_dir.join(key_name);
                if key_path.exists() {
                    let passphrase = config.private_key_passphrase.as_deref();
                    if session
                        .userauth_pubkey_file(&config.username, None, &key_path, passphrase)
                        .is_ok()
                        && session.authenticated()
                    {
                        return Ok(format!("publickey-default({})", key_name));
                    }
                }
            }
        }

        // 5. Password auth
        if let Some(ref password) = config.password {
            if session
                .userauth_password(&config.username, password)
                .is_ok()
                && session.authenticated()
            {
                return Ok("password".into());
            }
            warn!("SCP password auth failed for {}", config.username);
        }

        Err(format!(
            "All authentication methods exhausted for user '{}'",
            config.username
        ))
    }

    // ── Remote home probe ────────────────────────────────────────────────────

    fn probe_remote_home(&self, session: &Session) -> Option<String> {
        let mut channel = session.channel_session().ok()?;
        channel.exec("echo $HOME").ok()?;
        let mut output = String::new();
        std::io::Read::read_to_string(&mut channel, &mut output).ok()?;
        channel.wait_close().ok()?;
        let trimmed = output.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    // ── Execute remote command (helper) ──────────────────────────────────────

    pub(crate) fn exec_remote(
        &self,
        session_id: &str,
        command: &str,
    ) -> Result<String, String> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let mut channel = handle
            .session
            .channel_session()
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        channel
            .exec(command)
            .map_err(|e| format!("Failed to execute command '{}': {}", command, e))?;

        let mut output = String::new();
        std::io::Read::read_to_string(&mut channel, &mut output)
            .map_err(|e| format!("Failed to read command output: {}", e))?;
        channel.wait_close().ok();

        Ok(output.trim().to_string())
    }

    // ── Remote file helpers ──────────────────────────────────────────────────

    /// Check if a remote path exists.
    pub fn remote_exists(&self, session_id: &str, path: &str) -> Result<bool, String> {
        let result = self.exec_remote(session_id, &format!("test -e {} && echo yes || echo no", shell_escape(path)));
        match result {
            Ok(output) => Ok(output.trim() == "yes"),
            Err(_) => Ok(false),
        }
    }

    /// Check if a remote path is a directory.
    pub fn remote_is_dir(&self, session_id: &str, path: &str) -> Result<bool, String> {
        let result = self.exec_remote(session_id, &format!("test -d {} && echo yes || echo no", shell_escape(path)));
        match result {
            Ok(output) => Ok(output.trim() == "yes"),
            Err(_) => Ok(false),
        }
    }

    /// Get the size of a remote file.
    pub fn remote_file_size(&self, session_id: &str, path: &str) -> Result<u64, String> {
        let output = self.exec_remote(session_id, &format!("stat -c %s {} 2>/dev/null || stat -f %z {} 2>/dev/null", shell_escape(path), shell_escape(path)))?;
        output
            .trim()
            .parse::<u64>()
            .map_err(|e| format!("Failed to parse file size '{}': {}", output.trim(), e))
    }

    /// Create remote directories recursively.
    pub fn remote_mkdir_p(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("mkdir -p {}", shell_escape(path)))?;
        Ok(())
    }

    /// Delete a remote file.
    pub fn remote_rm(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("rm -f {}", shell_escape(path)))?;
        Ok(())
    }

    /// Delete a remote directory recursively.
    pub fn remote_rm_rf(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("rm -rf {}", shell_escape(path)))?;
        Ok(())
    }

    /// List a remote directory.
    pub fn remote_ls(&self, session_id: &str, path: &str) -> Result<Vec<ScpRemoteDirEntry>, String> {
        let output = self.exec_remote(
            session_id,
            &format!(
                "ls -la --time-style=long-iso {} 2>/dev/null || ls -la {}",
                shell_escape(path),
                shell_escape(path)
            ),
        )?;

        let mut entries = Vec::new();
        for line in output.lines().skip(1) {
            // skip "total ..." line
            if line.starts_with("total ") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 8 {
                continue;
            }

            let mode_str = parts[0].to_string();
            let is_dir = mode_str.starts_with('d');
            let is_symlink = mode_str.starts_with('l');
            let is_file = mode_str.starts_with('-');
            let owner = Some(parts[2].to_string());
            let group = Some(parts[3].to_string());
            let size: u64 = parts[4].parse().unwrap_or(0);

            // Name is everything after the date/time columns
            let name = if parts.len() >= 9 {
                parts[8..].join(" ")
            } else {
                parts[7..].join(" ")
            };

            // Strip symlink target
            let display_name = if is_symlink {
                name.split(" -> ").next().unwrap_or(&name).to_string()
            } else {
                name.clone()
            };

            if display_name == "." || display_name == ".." {
                continue;
            }

            let entry_path = if path.ends_with('/') {
                format!("{}{}", path, display_name)
            } else {
                format!("{}/{}", path, display_name)
            };

            // Try to extract mtime from date columns
            let mtime = if parts.len() >= 8 {
                Some(format!("{} {}", parts[5], parts[6]))
            } else {
                None
            };

            entries.push(ScpRemoteDirEntry {
                name: display_name,
                path: entry_path,
                size,
                is_dir,
                is_file,
                is_symlink,
                mode: Some(mode_str),
                mtime,
                owner,
                group,
            });
        }

        Ok(entries)
    }

    /// Get detailed info about a remote file.
    pub fn remote_stat(&self, session_id: &str, path: &str) -> Result<ScpRemoteFileInfo, String> {
        let escaped = shell_escape(path);
        // Use stat with format specifiers; fallback for macOS stat syntax
        let output = self.exec_remote(
            session_id,
            &format!(
                "stat -c '%s %f %Y %X %U %G' {} 2>/dev/null || stat -f '%z %Xp %m %a %Su %Sg' {}",
                escaped, escaped
            ),
        )?;

        let parts: Vec<&str> = output.trim().split_whitespace().collect();
        if parts.len() < 4 {
            return Err(format!("Unexpected stat output: {}", output));
        }

        let size: u64 = parts[0].parse().unwrap_or(0);
        let raw_mode = u32::from_str_radix(parts[1], 16).unwrap_or(0o100644);
        let mode = (raw_mode & 0o777) as i32;
        let is_dir = (raw_mode & 0o40000) != 0;
        let is_symlink = (raw_mode & 0o120000) == 0o120000;
        let is_file = !is_dir && !is_symlink;
        let mtime_ts: i64 = parts[2].parse().unwrap_or(0);
        let atime_ts: i64 = parts[3].parse().unwrap_or(0);
        let owner = parts.get(4).map(|s| s.to_string());
        let group = parts.get(5).map(|s| s.to_string());

        let mtime = chrono::DateTime::from_timestamp(mtime_ts, 0);
        let atime = chrono::DateTime::from_timestamp(atime_ts, 0);

        Ok(ScpRemoteFileInfo {
            path: path.to_string(),
            size,
            mode,
            is_dir,
            is_file,
            is_symlink,
            mtime,
            atime,
            owner,
            group,
        })
    }

    /// Compute SHA-256 checksum of a remote file.
    pub fn remote_checksum(&self, session_id: &str, path: &str) -> Result<String, String> {
        let output = self.exec_remote(
            session_id,
            &format!(
                "sha256sum {} 2>/dev/null || shasum -a 256 {} 2>/dev/null",
                shell_escape(path),
                shell_escape(path)
            ),
        )?;

        output
            .split_whitespace()
            .next()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Failed to parse checksum output: {}", output))
    }

    /// Compute SHA-256 checksum of a local file.
    pub fn local_checksum(path: &str) -> Result<String, String> {
        let mut file = std::fs::File::open(path)
            .map_err(|e| format!("Cannot open '{}': {}", path, e))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1_048_576];
        loop {
            let n = std::io::Read::read(&mut file, &mut buffer)
                .map_err(|e| format!("Read error: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    }

    // ── Update session activity stats ────────────────────────────────────────

    pub(crate) fn update_activity(
        &mut self,
        session_id: &str,
        uploaded: u64,
        downloaded: u64,
    ) {
        if let Some(handle) = self.sessions.get_mut(session_id) {
            handle.info.last_activity = Utc::now();
            handle.info.bytes_uploaded += uploaded;
            handle.info.bytes_downloaded += downloaded;
            handle.info.transfers_count += 1;
        }
    }

    // ── Get raw SSH session (for transfer engine) ────────────────────────────

    pub(crate) fn get_session(&self, session_id: &str) -> Result<&Session, String> {
        self.sessions
            .get(session_id)
            .map(|h| &h.session)
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }
}

// ── Utility: shell-escape a path for remote commands ─────────────────────────

pub(crate) fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape_simple() {
        assert_eq!(shell_escape("/home/user/file.txt"), "'/home/user/file.txt'");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        assert_eq!(
            shell_escape("it's a file"),
            "'it'\\''s a file'"
        );
    }

    #[test]
    fn test_shell_escape_spaces() {
        assert_eq!(
            shell_escape("/path/to/my file.txt"),
            "'/path/to/my file.txt'"
        );
    }

    #[test]
    fn test_shell_escape_special_chars() {
        assert_eq!(
            shell_escape("/path/$HOME/file"),
            "'/path/$HOME/file'"
        );
    }

    #[tokio::test]
    async fn test_new_service_creates_empty_state() {
        let state = ScpService::new();
        let svc = state.lock().await;
        assert!(svc.sessions.is_empty());
        assert!(svc.queue.is_empty());
        assert!(!svc.queue_running);
    }

    #[tokio::test]
    async fn test_list_sessions_empty() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let sessions = svc.list_sessions().await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_get_session_not_found() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let result = svc.get_session_info("nonexistent").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_local_checksum_missing_file() {
        let result = ScpService::local_checksum("/nonexistent/file.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_local_checksum_valid() {
        let tmp = std::env::temp_dir().join("sorng_scp_test_checksum.txt");
        std::fs::write(&tmp, b"hello world").unwrap();
        let result = ScpService::local_checksum(tmp.to_str().unwrap());
        assert!(result.is_ok());
        let hash = result.unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        std::fs::remove_file(&tmp).ok();
    }
}
