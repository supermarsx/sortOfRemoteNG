//! # System Agent Bridge
//!
//! Bridges to the native system SSH agent (OpenSSH agent on Unix via
//! SSH_AUTH_SOCK, or the OpenSSH Authentication Agent service / Pageant
//! on Windows via named pipes). Proxies requests to the system agent
//! and merges its keys with the built-in agent.

use crate::protocol::{self, AgentMessage, ProtocolIdentity};
use log::{info, warn};

#[cfg(unix)]
use std::path::PathBuf;

/// The bridge to the operating system's SSH agent.
pub struct SystemAgentBridge {
    /// Whether the bridge is connected.
    connected: bool,
    /// Socket path (Unix) or pipe name (Windows).
    socket_path: String,
    /// Cached identities from the system agent.
    cached_identities: Vec<ProtocolIdentity>,
    /// Last time the cache was refreshed.
    last_refresh: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether to auto-discover the system agent path.
    _auto_discover: bool,
    /// Cache TTL in seconds.
    cache_ttl: u64,
}

impl SystemAgentBridge {
    /// Create a new system agent bridge.
    pub fn new(auto_discover: bool, cache_ttl: u64) -> Self {
        let socket_path = if auto_discover {
            Self::discover_socket_path().unwrap_or_default()
        } else {
            String::new()
        };

        Self {
            connected: false,
            socket_path,
            cached_identities: Vec::new(),
            last_refresh: None,
            _auto_discover: auto_discover,
            cache_ttl,
        }
    }

    /// Create a bridge with an explicit socket path.
    pub fn with_socket(path: &str, cache_ttl: u64) -> Self {
        Self {
            connected: false,
            socket_path: path.to_string(),
            cached_identities: Vec::new(),
            last_refresh: None,
            _auto_discover: false,
            cache_ttl,
        }
    }

    /// Attempt to discover the system SSH agent socket path.
    pub fn discover_socket_path() -> Option<String> {
        // Unix: SSH_AUTH_SOCK environment variable
        #[cfg(unix)]
        {
            if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
                if std::path::Path::new(&sock).exists() {
                    return Some(sock);
                }
            }
            // Check common locations
            if let Ok(uid) = std::env::var("UID") {
                let path = format!("/tmp/ssh-agent-{}.sock", uid);
                if std::path::Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }

        // Windows: OpenSSH Authentication Agent pipe
        #[cfg(windows)]
        {
            let pipe = r"\\.\pipe\openssh-ssh-agent";
            // We can't easily check if the pipe exists without connecting
            // but we return the standard path
            Some(pipe.to_string())
        }

        #[cfg(not(any(unix, windows)))]
        {
            None
        }
    }

    /// Connect to the system agent.
    pub async fn connect(&mut self) -> Result<(), String> {
        if self.socket_path.is_empty() {
            return Err("No agent socket path configured".to_string());
        }

        info!("Connecting to system SSH agent at: {}", self.socket_path);

        // Verify the socket/pipe exists
        #[cfg(unix)]
        {
            if !std::path::Path::new(&self.socket_path).exists() {
                return Err(format!("Agent socket not found: {}", self.socket_path));
            }
        }

        // Try to send a request-identities to verify connectivity
        match self
            .send_raw_message(&protocol::encode_message(&AgentMessage::RequestIdentities))
            .await
        {
            Ok(response) => match protocol::decode_message(&response) {
                Ok(AgentMessage::IdentitiesAnswer { identities }) => {
                    info!(
                        "Connected to system agent, {} keys available",
                        identities.len()
                    );
                    self.cached_identities = identities;
                    self.last_refresh = Some(chrono::Utc::now());
                    self.connected = true;
                    Ok(())
                }
                Ok(_) => {
                    warn!("Unexpected response from system agent");
                    self.connected = true;
                    Ok(())
                }
                Err(e) => Err(format!("Failed to parse agent response: {}", e)),
            },
            Err(e) => Err(format!("Failed to connect to system agent: {}", e)),
        }
    }

    /// Disconnect from the system agent.
    pub fn disconnect(&mut self) {
        self.connected = false;
        self.cached_identities.clear();
        self.last_refresh = None;
        info!("Disconnected from system agent");
    }

    /// Whether we are connected.
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// Get the socket path.
    pub fn socket_path(&self) -> &str {
        &self.socket_path
    }

    /// Set the socket path.
    pub fn set_socket_path(&mut self, path: &str) {
        self.socket_path = path.to_string();
        self.connected = false;
        self.cached_identities.clear();
    }

    /// Refresh the cached identities from the system agent.
    pub async fn refresh_identities(&mut self) -> Result<Vec<ProtocolIdentity>, String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::RequestIdentities);
        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::IdentitiesAnswer { identities } => {
                self.cached_identities = identities.clone();
                self.last_refresh = Some(chrono::Utc::now());
                Ok(identities)
            }
            _ => Err("Unexpected response to identity request".to_string()),
        }
    }

    /// Get cached identities (optionally refreshing if stale).
    pub fn cached_identities(&self) -> &[ProtocolIdentity] {
        &self.cached_identities
    }

    /// Check if the cache is stale.
    pub fn is_cache_stale(&self) -> bool {
        match self.last_refresh {
            None => true,
            Some(t) => {
                let elapsed = (chrono::Utc::now() - t).num_seconds() as u64;
                elapsed > self.cache_ttl
            }
        }
    }

    /// Forward a sign request to the system agent.
    pub async fn sign(&self, key_blob: &[u8], data: &[u8], flags: u32) -> Result<Vec<u8>, String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::SignRequest {
            key_blob: key_blob.to_vec(),
            data: data.to_vec(),
            flags,
        });

        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::SignResponse { signature } => Ok(signature),
            AgentMessage::Failure => Err("System agent refused to sign".to_string()),
            _ => Err("Unexpected response to sign request".to_string()),
        }
    }

    /// Forward an add-key request to the system agent.
    pub async fn add_key(
        &self,
        key_type: &str,
        key_data: &[u8],
        comment: &str,
    ) -> Result<(), String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::AddIdentity {
            key_type: key_type.to_string(),
            key_data: key_data.to_vec(),
            comment: comment.to_string(),
        });

        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::Success => Ok(()),
            _ => Err("System agent refused to add key".to_string()),
        }
    }

    /// Forward a remove-key request to the system agent.
    pub async fn remove_key(&self, key_blob: &[u8]) -> Result<(), String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::RemoveIdentity {
            key_blob: key_blob.to_vec(),
        });

        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::Success => Ok(()),
            _ => Err("System agent refused to remove key".to_string()),
        }
    }

    /// Forward a lock request to the system agent.
    pub async fn lock(&self, passphrase: &str) -> Result<(), String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::Lock {
            passphrase: passphrase.to_string(),
        });

        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::Success => Ok(()),
            _ => Err("System agent refused to lock".to_string()),
        }
    }

    /// Forward an unlock request to the system agent.
    pub async fn unlock(&self, passphrase: &str) -> Result<(), String> {
        if !self.connected {
            return Err("Not connected to system agent".to_string());
        }

        let msg = protocol::encode_message(&AgentMessage::Unlock {
            passphrase: passphrase.to_string(),
        });

        let response = self.send_raw_message(&msg).await?;
        let decoded = protocol::decode_message(&response)?;

        match decoded {
            AgentMessage::Success => Ok(()),
            _ => Err("System agent refused to unlock".to_string()),
        }
    }

    /// Send a raw message to the system agent and return the response payload
    /// (without the 4-byte length prefix).
    async fn send_raw_message(&self, message: &[u8]) -> Result<Vec<u8>, String> {
        #[cfg(unix)]
        {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            use tokio::net::UnixStream;

            let mut stream = UnixStream::connect(&self.socket_path)
                .await
                .map_err(|e| format!("Failed to connect to agent socket: {}", e))?;

            stream
                .write_all(message)
                .await
                .map_err(|e| format!("Failed to write to agent: {}", e))?;

            // Read 4-byte length prefix
            let mut len_buf = [0u8; 4];
            stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| format!("Failed to read agent response length: {}", e))?;

            let len = u32::from_be_bytes(len_buf) as usize;
            if len > 256 * 1024 {
                return Err("Agent response too large".to_string());
            }

            let mut payload = vec![0u8; len];
            stream
                .read_exact(&mut payload)
                .await
                .map_err(|e| format!("Failed to read agent response: {}", e))?;

            Ok(payload)
        }

        #[cfg(windows)]
        {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            use tokio::net::windows::named_pipe::ClientOptions;

            let mut client = ClientOptions::new()
                .open(&self.socket_path)
                .map_err(|e| format!("Failed to open agent pipe: {}", e))?;

            client
                .write_all(message)
                .await
                .map_err(|e| format!("Failed to write to agent pipe: {}", e))?;

            let mut len_buf = [0u8; 4];
            client
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| format!("Failed to read agent response length: {}", e))?;

            let len = u32::from_be_bytes(len_buf) as usize;
            if len > 256 * 1024 {
                return Err("Agent response too large".to_string());
            }

            let mut payload = vec![0u8; len];
            client
                .read_exact(&mut payload)
                .await
                .map_err(|e| format!("Failed to read agent response: {}", e))?;

            Ok(payload)
        }

        #[cfg(not(any(unix, windows)))]
        {
            Err("Platform not supported for agent communication".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_creates_bridge() {
        let bridge = SystemAgentBridge::new(true, 300);
        // On CI/test, there may not be an actual agent
        // Just confirm it doesn't panic
        assert!(!bridge.is_connected());
    }

    #[test]
    fn test_with_explicit_socket() {
        let bridge = SystemAgentBridge::with_socket("/tmp/test.sock", 60);
        assert_eq!(bridge.socket_path(), "/tmp/test.sock");
        assert!(!bridge.is_connected());
    }

    #[test]
    fn test_cache_stale_initially() {
        let bridge = SystemAgentBridge::new(false, 300);
        assert!(bridge.is_cache_stale());
    }

    #[test]
    fn test_set_socket_path() {
        let mut bridge = SystemAgentBridge::new(false, 300);
        bridge.set_socket_path("/new/path");
        assert_eq!(bridge.socket_path(), "/new/path");
    }
}
