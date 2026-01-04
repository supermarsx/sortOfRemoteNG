use std::sync::Arc;
use tokio::sync::Mutex;
use suppaftp::FtpStream;
use tokio::fs;
use std::collections::HashMap;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;
use ssh2::Session;
use std::net::TcpStream;

pub type FtpServiceState = Arc<Mutex<FtpService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub auth_method: String, // "password" or "key"
}

#[derive(Debug)]
struct FtpConnection {
    session: FtpSession,
    stream: Option<FtpStream>,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

#[allow(dead_code)]
struct SftpConnection {
    session: SftpSession,
    session_handle: Option<Session>,
    tcp_stream: Option<TcpStream>,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct FtpService {
    ftp_connections: HashMap<String, FtpConnection>,
    sftp_connections: HashMap<String, SftpConnection>,
}

impl FtpService {
    pub fn new() -> FtpServiceState {
        Arc::new(Mutex::new(FtpService {
            ftp_connections: HashMap::new(),
            sftp_connections: HashMap::new(),
        }))
    }

    pub async fn connect_ftp(&mut self, host: String, port: u16, username: String, password: String) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = FtpSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            username: username.clone(),
            connected: true,
        };

        // Establish FTP connection
        let mut ftp_stream = FtpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| e.to_string())?;
        ftp_stream.login(&username, &password)
            .map_err(|e| e.to_string())?;

        // Clone session for the connection handler
        let session_clone = session.clone();

        // Spawn a dedicated task for this FTP connection
        let handle = task::spawn(async move {
            Self::handle_ftp_connection(session_clone, shutdown_rx).await;
        });

        let connection = FtpConnection {
            session: session.clone(),
            stream: Some(ftp_stream),
            shutdown_tx,
            _handle: handle,
        };

        self.ftp_connections.insert(session_id.clone(), connection);

        Ok(format!("FTP session {} connected and running on dedicated thread", session_id))
    }

    async fn handle_ftp_connection(session: FtpSession, mut shutdown_rx: mpsc::Receiver<()>) {
        println!("FTP connection handler started for session {}", session.id);

        // Connection maintenance loop
        loop {
            tokio::select! {
                // Check for shutdown signal
                _ = shutdown_rx.recv() => {
                    println!("FTP session {} received shutdown signal", session.id);
                    break;
                }
                // Keep connection alive
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                    // Could send NOOP command to keep connection alive
                    println!("FTP session {} keep-alive", session.id);
                }
            }
        }

        println!("FTP connection handler ending for session {}", session.id);
    }

    pub async fn list_files(&mut self, session_id: String, path: String) -> Result<Vec<String>, String> {
        if let Some(connection) = self.ftp_connections.get_mut(&session_id) {
            if let Some(stream) = &mut connection.stream {
                let files = stream.list(Some(&path))
                    .map_err(|e| e.to_string())?;
                Ok(files)
            } else {
                Err("No FTP stream for session".to_string())
            }
        } else {
            Err(format!("FTP session {} not found", session_id))
        }
    }

    pub async fn upload_file(&mut self, session_id: String, local_path: String, remote_path: String) -> Result<String, String> {
        if let Some(connection) = self.ftp_connections.get_mut(&session_id) {
            if let Some(stream) = &mut connection.stream {
                // Read local file
                let data = fs::read(&local_path).await
                    .map_err(|e| format!("Failed to read local file: {}", e))?;

                // Upload to FTP server
                let mut reader = std::io::Cursor::new(data);
                stream.put_file(&remote_path, &mut reader)
                    .map_err(|e| format!("Failed to upload file: {}", e))?;

                Ok(format!("File uploaded successfully: {} -> {}", local_path, remote_path))
            } else {
                Err("No FTP stream for session".to_string())
            }
        } else {
            Err(format!("FTP session {} not found", session_id))
        }
    }

    pub async fn download_file(&mut self, session_id: String, remote_path: String, local_path: String) -> Result<String, String> {
        if let Some(connection) = self.ftp_connections.get_mut(&session_id) {
            if let Some(stream) = &mut connection.stream {
                // Download from FTP server
                let cursor = stream.retr_as_buffer(&remote_path)
                    .map_err(|e| format!("Failed to download file: {}", e))?;

                // Get the data from the cursor
                let data = cursor.into_inner();

                // Write to local file
                fs::write(&local_path, data).await
                    .map_err(|e| format!("Failed to write local file: {}", e))?;

                Ok(format!("File downloaded successfully: {} -> {}", remote_path, local_path))
            } else {
                Err("No FTP stream for session".to_string())
            }
        } else {
            Err(format!("FTP session {} not found", session_id))
        }
    }

    pub async fn disconnect_ftp(&mut self, session_id: String) -> Result<(), String> {
        if let Some(connection) = self.ftp_connections.remove(&session_id) {
            // Send shutdown signal to the connection handler
            let _ = connection.shutdown_tx.send(()).await;

            // Close the FTP stream
            if let Some(mut stream) = connection.stream {
                let _ = stream.quit();
            }

            // Wait a bit for graceful shutdown
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            Ok(())
        } else {
            Err(format!("FTP session {} not found", session_id))
        }
    }
    // SFTP Methods
    pub async fn connect_sftp(&mut self, host: String, port: u16, username: String, password: Option<String>, private_key: Option<String>) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create TCP connection
        let tcp = TcpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| format!("Failed to connect to {}:{}: {}", host, port, e))?;

        // Create SSH session
        let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Authenticate
        let auth_method = if password.is_some() {
            sess.userauth_password(&username, &password.unwrap())
                .map_err(|e| format!("Password authentication failed: {}", e))?;
            "password"
        } else if let Some(_private_key) = private_key {
            // For private _key auth, we'd need to parse the key
            // This is a simplified implementation
            return Err("Private key authentication not yet implemented".to_string());
        } else {
            return Err("No authentication method provided".to_string());
        };

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = SftpSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            username: username.clone(),
            connected: true,
            auth_method: auth_method.to_string(),
        };

        // Start connection handler
        let session_clone = session.clone();
        let handle = task::spawn(async move {
            Self::handle_sftp_connection(session_clone, shutdown_rx).await;
        });

        let connection = SftpConnection {
            session: session.clone(),
            session_handle: Some(sess),
            tcp_stream: None, // TCP stream is now owned by the session
            shutdown_tx,
            _handle: handle,
        };

        self.sftp_connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    pub async fn list_sftp_files(&mut self, session_id: String, path: String) -> Result<Vec<String>, String> {
        if let Some(connection) = self.sftp_connections.get_mut(&session_id) {
            if let Some(sess) = &connection.session_handle {
                let sftp = sess.sftp().map_err(|e| format!("Failed to create SFTP channel: {}", e))?;
                let entries = sftp.readdir(std::path::Path::new(&path))
                    .map_err(|e| format!("Failed to list directory {}: {}", path, e))?;

                let filenames: Vec<String> = entries.iter()
                    .map(|(path, _)| path.to_string_lossy().to_string())
                    .collect();

                Ok(filenames)
            } else {
                Err(format!("SFTP session {} not connected", session_id))
            }
        } else {
            Err(format!("SFTP session {} not found", session_id))
        }
    }

    pub async fn disconnect_sftp(&mut self, session_id: String) -> Result<(), String> {
        if let Some(connection) = self.sftp_connections.remove(&session_id) {
            // Send shutdown signal to the connection handler
            let _ = connection.shutdown_tx.send(()).await;

            // The session will be dropped, which should close the connection
            Ok(())
        } else {
            Err(format!("SFTP session {} not found", session_id))
        }
    }

    async fn handle_sftp_connection(session: SftpSession, mut shutdown_rx: mpsc::Receiver<()>) {
        println!("SFTP connection handler started for session {}", session.id);

        // Connection maintenance loop
        loop {
            tokio::select! {
                // Check for shutdown signal
                _ = shutdown_rx.recv() => {
                    println!("SFTP session {} received shutdown signal", session.id);
                    break;
                }
                // Keep connection alive
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                    println!("SFTP session {} keep-alive", session.id);
                }
            }
        }
    }
    pub async fn get_session_info(&self, session_id: &str) -> Result<FtpSession, String> {
        if let Some(connection) = self.ftp_connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err(format!("FTP session {} not found", session_id))
        }
    }

    pub async fn list_sessions(&self) -> Vec<FtpSession> {
        self.ftp_connections.values().map(|conn| conn.session.clone()).collect()
    }
}

#[tauri::command]
pub async fn connect_ftp(state: tauri::State<'_, FtpServiceState>, host: String, port: u16, username: String, password: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.connect_ftp(host, port, username, password).await
}

#[tauri::command]
pub async fn list_files(state: tauri::State<'_, FtpServiceState>, session_id: String, path: String) -> Result<Vec<String>, String> {
    let mut ftp = state.lock().await;
    ftp.list_files(session_id, path).await
}

#[tauri::command]
pub async fn ftp_upload_file(state: tauri::State<'_, FtpServiceState>, session_id: String, local_path: String, remote_path: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.upload_file(session_id, local_path, remote_path).await
}

#[tauri::command]
pub async fn ftp_download_file(state: tauri::State<'_, FtpServiceState>, session_id: String, remote_path: String, local_path: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.download_file(session_id, remote_path, local_path).await
}

#[tauri::command]
pub async fn disconnect_ftp(state: tauri::State<'_, FtpServiceState>, session_id: String) -> Result<(), String> {
    let mut ftp = state.lock().await;
    ftp.disconnect_ftp(session_id).await
}

#[tauri::command]
pub async fn get_ftp_session_info(state: tauri::State<'_, FtpServiceState>, session_id: String) -> Result<FtpSession, String> {
    let ftp = state.lock().await;
    ftp.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_ftp_sessions(state: tauri::State<'_, FtpServiceState>) -> Result<Vec<FtpSession>, String> {
    let ftp = state.lock().await;
    Ok(ftp.list_sessions().await)
}

// SFTP Commands
#[tauri::command]
pub async fn connect_sftp(state: tauri::State<'_, FtpServiceState>, host: String, port: u16, username: String, password: Option<String>, private_key: Option<String>) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.connect_sftp(host, port, username, password, private_key).await
}

#[tauri::command]
pub async fn list_sftp_files(state: tauri::State<'_, FtpServiceState>, session_id: String, path: String) -> Result<Vec<String>, String> {
    let mut ftp = state.lock().await;
    ftp.list_sftp_files(session_id, path).await
}

#[tauri::command]
pub async fn disconnect_sftp(state: tauri::State<'_, FtpServiceState>, session_id: String) -> Result<(), String> {
    let mut ftp = state.lock().await;
    ftp.disconnect_sftp(session_id).await
}
