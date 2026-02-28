use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio::process::Command;
use std::process::Stdio;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;
use tokio::io::{AsyncBufReadExt, BufReader};

pub type RustDeskServiceState = Arc<Mutex<RustDeskService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskSession {
    pub id: String,
    pub remote_id: String,
    pub password: Option<String>,
    pub connected: bool,
    pub quality: String,
    pub view_only: bool,
    pub enable_audio: bool,
    pub enable_clipboard: bool,
    pub enable_file_transfer: bool,
}

#[derive(Debug)]
struct RustDeskConnection {
    session: RustDeskSession,
    process_handle: Option<std::process::Child>,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

#[derive(Debug, Deserialize)]
pub struct RustDeskConfig {
    pub remote_id: String,
    pub password: Option<String>,
    pub quality: Option<String>,
    pub view_only: Option<bool>,
    pub enable_audio: Option<bool>,
    pub enable_clipboard: Option<bool>,
    pub enable_file_transfer: Option<bool>,
}

pub struct RustDeskService {
    connections: HashMap<String, RustDeskConnection>,
    rustdesk_path: Option<String>,
}

impl RustDeskService {
    pub fn new() -> RustDeskServiceState {
        Arc::new(Mutex::new(RustDeskService {
            connections: HashMap::new(),
            rustdesk_path: Self::find_rustdesk_binary(),
        }))
    }

    fn find_rustdesk_binary() -> Option<String> {
        // Try common RustDesk installation paths
        let possible_paths = vec![
            "C:\\Program Files\\RustDesk\\rustdesk.exe",
            "C:\\Program Files (x86)\\RustDesk\\rustdesk.exe",
            "/usr/bin/rustdesk",
            "/usr/local/bin/rustdesk",
            "/opt/rustdesk/rustdesk",
        ];

        for path in possible_paths {
            if std::path::Path::new(path).exists() {
                return Some(path.to_string());
            }
        }

        // Try to find in PATH
        if let Ok(output) = std::process::Command::new("which").arg("rustdesk").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }

        None
    }

    pub async fn connect_rustdesk(&mut self, config: RustDeskConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Check if RustDesk is installed
        let rustdesk_path = self.rustdesk_path.as_ref()
            .ok_or_else(|| "RustDesk binary not found. Please install RustDesk.".to_string())?;

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = RustDeskSession {
            id: session_id.clone(),
            remote_id: config.remote_id.clone(),
            password: config.password.clone(),
            connected: false,
            quality: config.quality.unwrap_or_else(|| "balanced".to_string()),
            view_only: config.view_only.unwrap_or(false),
            enable_audio: config.enable_audio.unwrap_or(true),
            enable_clipboard: config.enable_clipboard.unwrap_or(true),
            enable_file_transfer: config.enable_file_transfer.unwrap_or(true),
        };

        // Spawn RustDesk process
        let rustdesk_path_clone = rustdesk_path.clone();
        let remote_id = config.remote_id.clone();
        let password = config.password.clone();

        let handle = task::spawn(async move {
            Self::run_rustdesk_connection(
                rustdesk_path_clone,
                remote_id,
                password,
                shutdown_rx,
            ).await;
        });

        let connection = RustDeskConnection {
            session: session.clone(),
            process_handle: None, // Will be set by the spawned task
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    async fn run_rustdesk_connection(
        rustdesk_path: String,
        remote_id: String,
        password: Option<String>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        let mut args = vec!["--connect", &remote_id];

        if let Some(pwd) = &password {
            args.push("--password");
            args.push(pwd);
        }

        // Add additional connection options
        args.push("--view-only"); // Start in view-only mode, can be changed later

        match Command::new(&rustdesk_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                println!("RustDesk process started for remote ID: {}", remote_id);

                // Monitor the process
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                // Spawn tasks to monitor output
                if let Some(stdout) = stdout {
                    let remote_id_clone = remote_id.clone();
                    task::spawn(async move {
                        let mut reader = BufReader::new(stdout);
                        let mut line = String::new();
                        while let Ok(bytes_read) = reader.read_line(&mut line).await {
                            if bytes_read == 0 {
                                break;
                            }
                            println!("RustDesk [{}]: {}", remote_id_clone, line.trim_end());
                            line.clear();
                        }
                    });
                }

                if let Some(stderr) = stderr {
                    let remote_id_clone = remote_id.clone();
                    task::spawn(async move {
                        let mut reader = BufReader::new(stderr);
                        let mut line = String::new();
                        while let Ok(bytes_read) = reader.read_line(&mut line).await {
                            if bytes_read == 0 {
                                break;
                            }
                            eprintln!("RustDesk [{}]: {}", remote_id_clone, line.trim_end());
                            line.clear();
                        }
                    });
                }

                // Wait for either shutdown signal or process completion
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        println!("Shutting down RustDesk connection to {}", remote_id);
                        let _ = child.kill();
                    }
                    status = child.wait() => {
                        match status {
                            Ok(exit_status) => {
                                println!("RustDesk process for {} exited with: {:?}", remote_id, exit_status);
                            }
                            Err(e) => {
                                eprintln!("Error waiting for RustDesk process: {}", e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to start RustDesk process: {}", e);
            }
        }
    }

    pub async fn disconnect_rustdesk(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(session_id) {
            // Send shutdown signal
            let _ = connection.shutdown_tx.send(()).await;

            // Kill process if still running
            if let Some(mut process) = connection.process_handle {
                let _ = process.kill();
            }

            Ok(())
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn get_rustdesk_session(&self, session_id: &str) -> Option<RustDeskSession> {
        self.connections.get(session_id).map(|conn| conn.session.clone())
    }

    pub async fn list_rustdesk_sessions(&self) -> Vec<RustDeskSession> {
        self.connections.values().map(|conn| conn.session.clone()).collect()
    }

    pub async fn update_rustdesk_settings(
        &mut self,
        session_id: &str,
        quality: Option<String>,
        view_only: Option<bool>,
        enable_audio: Option<bool>,
        enable_clipboard: Option<bool>,
        enable_file_transfer: Option<bool>,
    ) -> Result<(), String> {
        if let Some(connection) = self.connections.get_mut(session_id) {
            if let Some(q) = quality {
                connection.session.quality = q;
            }
            if let Some(vo) = view_only {
                connection.session.view_only = vo;
            }
            if let Some(audio) = enable_audio {
                connection.session.enable_audio = audio;
            }
            if let Some(clipboard) = enable_clipboard {
                connection.session.enable_clipboard = clipboard;
            }
            if let Some(file_transfer) = enable_file_transfer {
                connection.session.enable_file_transfer = file_transfer;
            }
            Ok(())
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn send_rustdesk_input(
        &self,
        session_id: &str,
        input_type: String,
        data: serde_json::Value,
    ) -> Result<(), String> {
        // This would require more advanced integration with RustDesk
        // For now, we'll return a placeholder implementation
        if self.connections.contains_key(session_id) {
            println!("Sending {} input to RustDesk session {}: {:?}", input_type, session_id, data);
            Ok(())
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn get_rustdesk_screenshot(&self, session_id: &str) -> Result<Vec<u8>, String> {
        // This would require RustDesk API integration
        // For now, return a placeholder
        if self.connections.contains_key(session_id) {
            Err("Screenshot functionality not yet implemented".to_string())
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn is_rustdesk_available(&self) -> bool {
        self.rustdesk_path.is_some()
    }

    pub async fn get_rustdesk_version(&self) -> Result<String, String> {
        let rustdesk_path = self.rustdesk_path.as_ref()
            .ok_or_else(|| "RustDesk binary not found".to_string())?;

        match Command::new(rustdesk_path)
            .arg("--version")
            .output().await
        {
            Ok(output) if output.status.success() => {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }
            _ => Err("Failed to get RustDesk version".to_string()),
        }
    }
}

// Tauri commands
#[tauri::command]
pub async fn connect_rustdesk(
    config: RustDeskConfig,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_rustdesk(config).await
}

#[tauri::command]
pub async fn disconnect_rustdesk(
    session_id: String,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_rustdesk(&session_id).await
}

#[tauri::command]
pub async fn get_rustdesk_session(
    session_id: String,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<RustDeskSession, String> {
    let service = state.lock().await;
    service.get_rustdesk_session(&session_id).await
        .ok_or_else(|| format!("Session {} not found", session_id))
}

#[tauri::command]
pub async fn list_rustdesk_sessions(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<RustDeskSession>, String> {
    let service = state.lock().await;
    Ok(service.list_rustdesk_sessions().await)
}

#[tauri::command]
pub async fn update_rustdesk_settings(
    session_id: String,
    quality: Option<String>,
    view_only: Option<bool>,
    enable_audio: Option<bool>,
    enable_clipboard: Option<bool>,
    enable_file_transfer: Option<bool>,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_rustdesk_settings(
        &session_id,
        quality,
        view_only,
        enable_audio,
        enable_clipboard,
        enable_file_transfer,
    ).await
}

#[tauri::command]
pub async fn send_rustdesk_input(
    session_id: String,
    input_type: String,
    data: serde_json::Value,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let service = state.lock().await;
    service.send_rustdesk_input(&session_id, input_type, data).await
}

#[tauri::command]
pub async fn get_rustdesk_screenshot(
    session_id: String,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<Vec<u8>, String> {
    let service = state.lock().await;
    service.get_rustdesk_screenshot(&session_id).await
}

#[tauri::command]
pub async fn is_rustdesk_available(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(service.is_rustdesk_available().await)
}

#[tauri::command]
pub async fn get_rustdesk_version(
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<String, String> {
    let service = state.lock().await;
    service.get_rustdesk_version().await
}