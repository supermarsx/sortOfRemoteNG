use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;

pub type AnyDeskServiceState = Arc<Mutex<AnyDeskService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnyDeskSession {
    pub id: String,
    pub anydesk_id: String,
    pub password: Option<String>,
    pub connected: bool,
    pub start_time: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
struct AnyDeskConnection {
    session: AnyDeskSession,
}

pub struct AnyDeskService {
    connections: HashMap<String, AnyDeskConnection>,
}

impl AnyDeskService {
    pub fn new() -> AnyDeskServiceState {
        Arc::new(Mutex::new(AnyDeskService {
            connections: HashMap::new(),
        }))
    }

    pub async fn launch_anydesk(&mut self, anydesk_id: String, password: Option<String>) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create session info
        let session = AnyDeskSession {
            id: session_id.clone(),
            anydesk_id: anydesk_id.clone(),
            password: password.clone(),
            connected: false,
            start_time: chrono::Utc::now(),
        };

        // Store the connection
        let connection = AnyDeskConnection {
            session: session.clone(),
        };
        self.connections.insert(session_id.clone(), connection);

        // Try to launch AnyDesk
        // Note: This is a simplified implementation. In practice, you might need to:
        // 1. Check if AnyDesk is installed
        // 2. Use platform-specific commands to launch AnyDesk
        // 3. Handle AnyDesk's command-line interface

        #[cfg(target_os = "windows")]
        {
            // On Windows, try to launch AnyDesk with the ID
            let result = Command::new("anydesk.exe")
                .arg(anydesk_id)
                .spawn();

            match result {
                Ok(_) => {
                    // Mark as connected (simplified - in reality you'd monitor the process)
                    if let Some(conn) = self.connections.get_mut(&session_id) {
                        conn.session.connected = true;
                    }
                    Ok(session_id)
                }
                Err(e) => {
                    // Remove the connection on failure
                    self.connections.remove(&session_id);
                    Err(format!("Failed to launch AnyDesk: {}", e))
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            // On macOS, try to open AnyDesk with URL scheme
            let url = format!("anydesk://{}", anydesk_id);
            let result = Command::new("open")
                .arg(url)
                .spawn();

            match result {
                Ok(_) => {
                    if let Some(conn) = self.connections.get_mut(&session_id) {
                        conn.session.connected = true;
                    }
                    Ok(session_id)
                }
                Err(e) => {
                    self.connections.remove(&session_id);
                    Err(format!("Failed to launch AnyDesk: {}", e))
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            // On Linux, try various methods
            let result = Command::new("anydesk")
                .arg(anydesk_id)
                .spawn();

            match result {
                Ok(_) => {
                    if let Some(conn) = self.connections.get_mut(&session_id) {
                        conn.session.connected = true;
                    }
                    Ok(session_id)
                }
                Err(_) => {
                    // Try alternative method with URL scheme
                    let url = format!("anydesk://{}", anydesk_id);
                    let result = Command::new("xdg-open")
                        .arg(url)
                        .spawn();

                    match result {
                        Ok(_) => {
                            if let Some(conn) = self.connections.get_mut(&session_id) {
                                conn.session.connected = true;
                            }
                            Ok(session_id)
                        }
                        Err(e) => {
                            self.connections.remove(&session_id);
                            Err(format!("Failed to launch AnyDesk: {}", e))
                        }
                    }
                }
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            self.connections.remove(&session_id);
            Err("AnyDesk launching not supported on this platform".to_string())
        }
    }

    pub async fn disconnect_anydesk(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(_connection) = self.connections.remove(session_id) {
            // In a real implementation, you might need to terminate the AnyDesk process
            // For now, just remove from our tracking
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub async fn get_anydesk_sessions(&self) -> Vec<AnyDeskSession> {
        self.connections.values()
            .map(|conn| conn.session.clone())
            .collect()
    }

    pub fn get_anydesk_session(&self, session_id: &str) -> Option<AnyDeskSession> {
        self.connections.get(session_id)
            .map(|conn| conn.session.clone())
    }
}
#[command]
/// Launches AnyDesk with the specified ID and optional password.
///
/// Attempts to launch the AnyDesk application with the provided connection ID.
/// On Windows, it tries to execute anydesk.exe directly.
/// On macOS, it uses the anydesk:// URL scheme.
/// On Linux, it tries various methods to launch AnyDesk.
///
/// # Arguments
///
/// * `anydesk_id` - The AnyDesk ID to connect to
/// * `password` - Optional password for the connection
/// * `anydesk_service` - The AnyDesk service state
///
/// # Returns
///
/// `Ok(String)` containing the session ID if successful, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if:
/// - AnyDesk is not installed
/// - The platform is not supported
/// - Process execution fails
///
/// # Example
///
/// ```javascript
/// const sessionId = await invoke('launch_anydesk', {
///   anydeskId: '123456789',
///   password: 'optional_password'
/// });
/// ```
pub async fn launch_anydesk(
  anydesk_id: String,
  password: Option<String>,
  anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<String, String> {
  let mut service = anydesk_service.lock().await;
  service.launch_anydesk(anydesk_id, password).await
}

#[command]
/// Disconnects an AnyDesk session.
///
/// Removes the session from tracking. Note that this doesn't terminate
/// the actual AnyDesk process, just removes it from our internal tracking.
///
/// # Arguments
///
/// * `session_id` - The session ID to disconnect
/// * `anydesk_service` - The AnyDesk service state
///
/// # Returns
///
/// `Ok(())` if successful, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if the session doesn't exist
///
/// # Example
///
/// ```javascript
/// await invoke('disconnect_anydesk', {
///   sessionId: 'session-123'
/// });
/// ```
pub async fn disconnect_anydesk(
  session_id: String,
  anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<(), String> {
  let mut service = anydesk_service.lock().await;
  service.disconnect_anydesk(&session_id).await
}

#[command]
/// Gets information about a specific AnyDesk session.
///
/// # Arguments
///
/// * `session_id` - The session ID to query
/// * `anydesk_service` - The AnyDesk service state
///
/// # Returns
///
/// `Ok(AnyDeskSession)` if found, `Err(String)` if not found or error
///
/// # Example
///
/// ```javascript
/// const session = await invoke('get_anydesk_session', {
///   sessionId: 'session-123'
/// });
/// ```
pub async fn get_anydesk_session(
  session_id: String,
  anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<Option<AnyDeskSession>, String> {
  let service = anydesk_service.lock().await;
  Ok(service.get_anydesk_session(&session_id))
}

#[command]
/// Lists all active AnyDesk sessions.
///
/// # Arguments
///
/// * `anydesk_service` - The AnyDesk service state
///
/// # Returns
///
/// `Ok(Vec<AnyDeskSession>)` containing all sessions
///
/// # Example
///
/// ```javascript
/// const sessions = await invoke('list_anydesk_sessions');
/// ```
pub async fn list_anydesk_sessions(
  anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<Vec<AnyDeskSession>, String> {
  let service = anydesk_service.lock().await;
  Ok(service.get_anydesk_sessions().await)
}