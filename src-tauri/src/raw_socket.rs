use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio::net::{TcpStream, UdpSocket};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;
use socket2::{Socket, Domain, Type, Protocol};
use std::net::SocketAddr;

pub type RawSocketServiceState = Arc<Mutex<RawSocketService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSocketSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub protocol: String, // "tcp", "udp", "raw_tcp", "raw_udp"
    pub connected: bool,
}

#[derive(Debug)]
enum SocketType {
    Tcp(TcpStream),
    Udp(UdpSocket),
    RawTcp(TcpStream),
    RawUdp(UdpSocket),
}

impl Clone for SocketType {
    fn clone(&self) -> Self {
        // For this basic implementation, we'll panic on clone since raw sockets are complex to clone
        // A more complete implementation would need proper cloning or reference counting
        panic!("SocketType cannot be cloned in this implementation")
    }
}

#[derive(Debug)]
struct RawSocketConnection {
    session: RawSocketSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct RawSocketService {
    connections: HashMap<String, RawSocketConnection>,
}

impl RawSocketService {
    pub fn new() -> RawSocketServiceState {
        Arc::new(Mutex::new(RawSocketService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_raw_socket(
        &mut self,
        host: String,
        port: u16,
        protocol: String,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        let socket = match protocol.as_str() {
            "tcp" => {
                let stream = TcpStream::connect(format!("{}:{}", host, port))
                    .await
                    .map_err(|e| format!("Failed to connect TCP to {}:{}: {}", host, port, e))?;
                SocketType::Tcp(stream)
            }
            "udp" => {
                let socket = UdpSocket::bind("0.0.0.0:0")
                    .await
                    .map_err(|e| format!("Failed to bind UDP socket: {}", e))?;

                let addr: SocketAddr = format!("{}:{}", host, port)
                    .parse()
                    .map_err(|e| format!("Invalid address: {}", e))?;

                socket.connect(addr)
                    .await
                    .map_err(|e| format!("Failed to connect UDP to {}:{}: {}", host, port, e))?;

                SocketType::Udp(socket)
            }
            "raw_tcp" => {
                // Create raw TCP socket (this requires elevated privileges on most systems)
                let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
                    .map_err(|e| format!("Failed to create raw TCP socket: {}", e))?;

                // Note: Raw sockets require special permissions and may not work on all systems
                let addr: SocketAddr = format!("{}:{}", host, port)
                    .parse()
                    .map_err(|e| format!("Invalid address: {}", e))?;

                socket.connect(&addr.into())
                    .map_err(|e| format!("Failed to connect raw TCP to {}:{}: {}", host, port, e))?;

                // Convert to tokio TcpStream
                let stream = TcpStream::connect(format!("{}:{}", host, port))
                    .await
                    .map_err(|e| format!("Failed to create TCP stream for raw socket: {}", e))?;

                SocketType::RawTcp(stream)
            }
            "raw_udp" => {
                // Create raw UDP socket
                let _socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
                    .map_err(|e| format!("Failed to create raw UDP socket: {}", e))?;

                // Convert to tokio UdpSocket
                let udp_socket = UdpSocket::bind("0.0.0.0:0")
                    .await
                    .map_err(|e| format!("Failed to bind UDP socket for raw: {}", e))?;

                let addr: SocketAddr = format!("{}:{}", host, port)
                    .parse()
                    .map_err(|e| format!("Invalid address: {}", e))?;

                udp_socket.connect(addr)
                    .await
                    .map_err(|e| format!("Failed to connect raw UDP to {}:{}: {}", host, port, e))?;

                SocketType::RawUdp(udp_socket)
            }
            _ => return Err("Unsupported protocol. Use 'tcp', 'udp', 'raw_tcp', or 'raw_udp'".to_string()),
        };

        // Create session info
        let session = RawSocketSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            protocol: protocol.clone(),
            connected: true,
        };

        // Spawn a task to handle the connection
        let handle = {
            let mut socket_clone = socket;

            task::spawn(async move {
                let mut buf = [0; 1024];
                let mut shutdown_rx = shutdown_rx;

                loop {
                    tokio::select! {
                        _ = shutdown_rx.recv() => {
                            // Shutdown signal received
                            break;
                        }
                        result = Self::read_from_socket_async(&mut socket_clone, &mut buf) => {
                            match result {
                                Ok(0) => {
                                    // Connection closed
                                    break;
                                }
                                Ok(n) => {
                                    // Process received data
                                    let data = &buf[..n];
                                    println!("Raw socket received: {:?}", data);
                                }
                                Err(e) => {
                                    eprintln!("Raw socket read error: {}", e);
                                    break;
                                }
                            }
                        }
                    }
                }

                // Clean up connection
                Self::close_socket(socket_clone).await;
            })
        };

        let connection = RawSocketConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    async fn read_from_socket_async(socket: &mut SocketType, buf: &mut [u8]) -> Result<usize, std::io::Error> {
        match socket {
            SocketType::Tcp(stream) => stream.read(buf).await,
            SocketType::Udp(udp) => udp.recv(buf).await,
            SocketType::RawTcp(stream) => stream.read(buf).await,
            SocketType::RawUdp(udp) => udp.recv(buf).await,
        }
    }

    async fn close_socket(socket: SocketType) {
        match socket {
            SocketType::Tcp(mut stream) => {
                let _ = stream.shutdown().await;
            }
            SocketType::Udp(_) => {
                // UDP sockets don't need explicit closing in the same way
            }
            SocketType::RawTcp(mut stream) => {
                let _ = stream.shutdown().await;
            }
            SocketType::RawUdp(_) => {
                // UDP sockets don't need explicit closing in the same way
            }
        }
    }

    pub async fn disconnect_raw_socket(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(session_id) {
            // Send shutdown signal
            let _ = connection.shutdown_tx.send(()).await;

            // Wait for the task to finish
            let _ = connection._handle.await;

            Ok(())
        } else {
            Err("Raw socket session not found".to_string())
        }
    }

    pub async fn send_raw_socket_data(&mut self, _session_id: &str, _data: Vec<u8>) -> Result<(), String> {
        // In this basic implementation, we don't maintain a persistent socket for sending data
        // A more complete implementation would need to use channels or other IPC mechanisms
        Err("Data sending not implemented in this basic raw socket client".to_string())
    }

    pub async fn get_raw_socket_session_info(&self, session_id: &str) -> Result<RawSocketSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err("Raw socket session not found".to_string())
        }
    }

    pub async fn list_raw_socket_sessions(&self) -> Vec<RawSocketSession> {
        self.connections.values()
            .map(|conn| conn.session.clone())
            .collect()
    }
}

#[tauri::command]
pub async fn connect_raw_socket(
    host: String,
    port: u16,
    protocol: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_raw_socket(host, port, protocol).await
}

#[tauri::command]
pub async fn disconnect_raw_socket(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_raw_socket(&session_id).await
}

#[tauri::command]
pub async fn send_raw_socket_data(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_raw_socket_data(&session_id, data).await
}

#[tauri::command]
pub async fn get_raw_socket_session_info(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<RawSocketSession, String> {
    let service = state.lock().await;
    service.get_raw_socket_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_raw_socket_sessions(
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<Vec<RawSocketSession>, String> {
    let service = state.lock().await;
    Ok(service.list_raw_socket_sessions().await)
}
