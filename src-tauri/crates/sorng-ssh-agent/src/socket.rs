//! # Socket / Named Pipe Listener
//!
//! Provides a platform-abstracted listener that accepts incoming SSH agent
//! connections over Unix domain sockets (Linux/macOS), Windows named pipes,
//! or optional TCP sockets. Each accepted connection is dispatched to the
//! agent message handler.

use crate::protocol;
use log::{debug, error, info, warn};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

/// Abstraction over different socket types the agent can listen on.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ListenerType {
    /// Unix domain socket (path).
    #[cfg(unix)]
    Unix(String),
    /// Windows named pipe.
    #[cfg(windows)]
    NamedPipe(String),
    /// TCP socket (addr:port) — used for testing or special setups.
    Tcp(String),
}

/// Listener status.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ListenerStatus {
    /// The listener address/path.
    pub address: String,
    /// The type of listener.
    pub listener_type: String,
    /// Whether the listener is active.
    pub active: bool,
    /// Number of connections served.
    pub connections_served: u64,
    /// Current active connections.
    pub active_connections: u32,
}

/// Handle a single agent connection. Reads messages from the stream,
/// dispatches them to the processor, and writes responses.
pub async fn handle_connection<R, W>(
    mut reader: R,
    mut writer: W,
    processor: Arc<Mutex<dyn MessageProcessor + Send>>,
    connection_id: String,
) where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    debug!("New agent connection: {}", connection_id);

    loop {
        // Read 4-byte length prefix
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) => {
                if e.kind() != std::io::ErrorKind::UnexpectedEof {
                    warn!("Connection {} read error: {}", connection_id, e);
                }
                break;
            }
        }

        let msg_len = u32::from_be_bytes(len_buf) as usize;
        if msg_len == 0 || msg_len > 256 * 1024 {
            warn!(
                "Connection {} invalid message length: {}",
                connection_id, msg_len
            );
            break;
        }

        // Read message payload
        let mut payload = vec![0u8; msg_len];
        if let Err(e) = reader.read_exact(&mut payload).await {
            warn!(
                "Connection {} failed to read payload: {}",
                connection_id, e
            );
            break;
        }

        // Parse and process
        let request = match protocol::decode_message(&payload) {
            Ok(msg) => msg,
            Err(e) => {
                error!("Connection {} decode error: {}", connection_id, e);
                let resp = protocol::encode_message(&protocol::AgentMessage::Failure);
                let _ = writer.write_all(&resp).await;
                continue;
            }
        };

        let response = {
            let mut proc = processor.lock().await;
            proc.process(request).await
        };

        let encoded = protocol::encode_message(&response);
        if let Err(e) = writer.write_all(&encoded).await {
            warn!(
                "Connection {} write error: {}",
                connection_id, e
            );
            break;
        }
    }

    debug!("Connection {} closed", connection_id);
}

/// Trait for processing agent messages. Implemented by the service layer.
pub trait MessageProcessor {
    fn process(
        &mut self,
        msg: protocol::AgentMessage,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = protocol::AgentMessage> + Send + '_>>;
}

/// Start a TCP listener for testing/development.
pub async fn start_tcp_listener(
    addr: &str,
    processor: Arc<Mutex<dyn MessageProcessor + Send>>,
    shutdown: broadcast::Receiver<()>,
) -> Result<(), String> {
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind TCP listener: {}", e))?;

    info!("SSH agent TCP listener started on {}", addr);

    let mut shutdown = shutdown;
    let mut conn_counter: u64 = 0;

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, peer)) => {
                        conn_counter += 1;
                        let conn_id = format!("tcp-{}-{}", peer, conn_counter);
                        let proc = Arc::clone(&processor);
                        let (reader, writer) = tokio::io::split(stream);
                        tokio::spawn(async move {
                            handle_connection(reader, writer, proc, conn_id).await;
                        });
                    }
                    Err(e) => {
                        error!("Accept error: {}", e);
                    }
                }
            }
            _ = shutdown.recv() => {
                info!("TCP listener shutting down");
                break;
            }
        }
    }

    Ok(())
}

/// Start a Unix domain socket listener.
#[cfg(unix)]
pub async fn start_unix_listener(
    path: &str,
    processor: Arc<Mutex<dyn MessageProcessor + Send>>,
    shutdown: broadcast::Receiver<()>,
) -> Result<(), String> {
    use tokio::net::UnixListener;

    // Remove stale socket file
    let _ = std::fs::remove_file(path);

    let listener = UnixListener::bind(path)
        .map_err(|e| format!("Failed to bind Unix socket: {}", e))?;

    // Set appropriate permissions (owner-only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    info!("SSH agent Unix listener started on {}", path);

    let mut shutdown = shutdown;
    let mut conn_counter: u64 = 0;

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, _)) => {
                        conn_counter += 1;
                        let conn_id = format!("unix-{}", conn_counter);
                        let proc = Arc::clone(&processor);
                        let (reader, writer) = tokio::io::split(stream);
                        tokio::spawn(async move {
                            handle_connection(reader, writer, proc, conn_id).await;
                        });
                    }
                    Err(e) => {
                        error!("Unix accept error: {}", e);
                    }
                }
            }
            _ = shutdown.recv() => {
                info!("Unix listener shutting down");
                let _ = std::fs::remove_file(path);
                break;
            }
        }
    }

    Ok(())
}

/// Generate a unique socket path for the agent.
pub fn generate_socket_path(_base_dir: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    #[cfg(unix)]
    {
        format!("{}/sorng-ssh-agent-{}.sock", base_dir, &id[..8])
    }
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\sorng-ssh-agent-{}", &id[..8])
    }
    #[cfg(not(any(unix, windows)))]
    {
        format!("{}/sorng-ssh-agent-{}", base_dir, &id[..8])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_socket_path() {
        let path = generate_socket_path("/tmp");
        assert!(!path.is_empty());
        assert!(path.contains("sorng-ssh-agent"));
    }
}
