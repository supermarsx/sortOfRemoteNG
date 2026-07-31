use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio::task;
use uuid::Uuid;

pub type RustDeskServiceState = Arc<Mutex<RustDeskService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskSession {
    pub id: String,
    pub remote_id: String,
    #[serde(skip_serializing)]
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

const RUSTDESK_ARGV_SECRET_ERROR: &str =
    "Saved-password RustDesk launch is disabled because this client only accepts the password in the OS-visible process argument list. Launch without a stored password and authenticate in the RustDesk window.";

fn validate_rustdesk_target(remote_id: &str) -> Result<String, String> {
    let remote_id = remote_id.trim();
    if remote_id.is_empty()
        || remote_id.len() > 256
        || remote_id.starts_with('-')
        || remote_id.starts_with('/')
        || remote_id.chars().any(char::is_control)
    {
        return Err(
            "RustDesk target is empty, option-like, too long, or contains control characters"
                .to_string(),
        );
    }
    Ok(remote_id.to_string())
}

fn build_rustdesk_launch_args(remote_id: &str, has_password: bool) -> Result<Vec<String>, String> {
    if has_password {
        return Err(RUSTDESK_ARGV_SECRET_ERROR.to_string());
    }
    Ok(vec![
        "--connect".to_string(),
        validate_rustdesk_target(remote_id)?,
        "--view-only".to_string(),
    ])
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
            if std::path::Path::new(path).is_file() {
                return Some(path.to_string());
            }
        }

        None
    }

    pub async fn connect_rustdesk(&mut self, config: RustDeskConfig) -> Result<String, String> {
        let args = build_rustdesk_launch_args(&config.remote_id, config.password.is_some())?;
        let session_id = Uuid::new_v4().to_string();

        // Check if RustDesk is installed
        let rustdesk_path = self
            .rustdesk_path
            .as_ref()
            .ok_or_else(|| "RustDesk binary not found. Please install RustDesk.".to_string())?;

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = RustDeskSession {
            id: session_id.clone(),
            remote_id: validate_rustdesk_target(&config.remote_id)?,
            password: None,
            connected: false,
            quality: config.quality.unwrap_or_else(|| "balanced".to_string()),
            view_only: config.view_only.unwrap_or(false),
            enable_audio: config.enable_audio.unwrap_or(true),
            enable_clipboard: config.enable_clipboard.unwrap_or(true),
            enable_file_transfer: config.enable_file_transfer.unwrap_or(true),
        };

        // Spawn RustDesk process
        let rustdesk_path_clone = rustdesk_path.clone();

        let handle = task::spawn(async move {
            Self::run_rustdesk_connection(rustdesk_path_clone, args, shutdown_rx).await;
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
        args: Vec<String>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        match Command::new(&rustdesk_path)
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                // Wait for either shutdown signal or process completion
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        let _ = child.kill().await;
                    }
                    status = child.wait() => {
                        let _ = status;
                    }
                }
            }
            Err(_) => {}
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
        self.connections
            .get(session_id)
            .map(|conn| conn.session.clone())
    }

    pub async fn list_rustdesk_sessions(&self) -> Vec<RustDeskSession> {
        self.connections
            .values()
            .map(|conn| conn.session.clone())
            .collect()
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
            println!(
                "Sending {} input to RustDesk session {}: {:?}",
                input_type, session_id, data
            );
            Ok(())
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn get_rustdesk_screenshot(&self, session_id: &str) -> Result<Vec<u8>, String> {
        // The upstream RustDesk client binary (which this service spawns as a
        // subprocess) does not expose an IPC/CLI surface for capturing the
        // remote desktop framebuffer out-of-process. There is no public
        // `--screenshot` switch, no exposed gRPC endpoint, and no documented
        // client SDK that would let us extract a frame from a running
        // rustdesk.exe session.
        //
        // Rather than silently return a black image or leak a misleading
        // "not implemented" string, we fail fast with an actionable error so
        // the frontend can hide or grey out the relevant UI control. If the
        // upstream project ever exposes such an API, update this branch to
        // call into it instead.
        if self.connections.contains_key(session_id) {
            Err(
                "Screenshot capture is not supported by the upstream RustDesk client SDK. \
                 The RustDesk binary does not expose a public IPC/CLI for frame capture; \
                 use the session window's own screenshot feature instead."
                    .to_string(),
            )
        } else {
            Err(format!("RustDesk session {} not found", session_id))
        }
    }

    pub async fn is_rustdesk_available(&self) -> bool {
        self.rustdesk_path.is_some()
    }

    pub async fn get_rustdesk_version(&self) -> Result<String, String> {
        let rustdesk_path = self
            .rustdesk_path
            .as_ref()
            .ok_or_else(|| "RustDesk binary not found".to_string())?;

        match Command::new(rustdesk_path).arg("--version").output().await {
            Ok(output) if output.status.success() => {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }
            _ => Err("Failed to get RustDesk version".to_string()),
        }
    }
}

#[cfg(test)]
mod process_safety_tests {
    use super::*;

    #[test]
    fn password_bearing_launches_fail_before_argv_construction() {
        let error = build_rustdesk_launch_args("123456789", true)
            .expect_err("password must never enter argv");
        assert_eq!(error, RUSTDESK_ARGV_SECRET_ERROR);
        assert!(!error.contains("password-sentinel"));
    }

    #[test]
    fn passwordless_launch_uses_literal_non_option_target() {
        assert_eq!(
            build_rustdesk_launch_args("123 456 789", false)
                .expect("spaces are safe inside one argv element"),
            vec!["--connect", "123 456 789", "--view-only"]
        );
        for target in ["--password", "/option", "123\n456", ""] {
            assert!(build_rustdesk_launch_args(target, false).is_err());
        }
    }

    #[test]
    fn serialized_session_never_contains_a_password() {
        let sentinel = "rustdesk-password-sentinel";
        let session = RustDeskSession {
            id: "session-1".to_string(),
            remote_id: "123456789".to_string(),
            password: Some(sentinel.to_string()),
            connected: false,
            quality: "balanced".to_string(),
            view_only: true,
            enable_audio: true,
            enable_clipboard: true,
            enable_file_transfer: false,
        };
        let serialized = serde_json::to_string(&session).expect("serialize session");
        assert!(!serialized.contains(sentinel));
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
    service
        .get_rustdesk_session(&session_id)
        .await
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
    service
        .update_rustdesk_settings(
            &session_id,
            quality,
            view_only,
            enable_audio,
            enable_clipboard,
            enable_file_transfer,
        )
        .await
}

#[tauri::command]
pub async fn send_rustdesk_input(
    session_id: String,
    input_type: String,
    data: serde_json::Value,
    state: tauri::State<'_, RustDeskServiceState>,
) -> Result<(), String> {
    let service = state.lock().await;
    service
        .send_rustdesk_input(&session_id, input_type, data)
        .await
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
