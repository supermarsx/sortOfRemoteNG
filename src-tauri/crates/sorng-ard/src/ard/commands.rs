//! Tauri command handlers for ARD sessions.
//!
//! Every public function in this module is a `#[tauri::command]` that the
//! frontend can invoke.  They follow the project convention of returning
//! `Result<T, String>` and accepting `tauri::State<ArdServiceState>`.

use std::sync::atomic::Ordering;
use std::time::Duration;

use chrono::Utc;
use tauri::AppHandle;
use uuid::Uuid;

use super::session_runner::{self, SessionConfig};
use super::types::*;
use super::ArdServiceState;

// ── Connect / Disconnect ─────────────────────────────────────────────────

/// Establish a new ARD connection.
///
/// Returns the unique session ID.
#[tauri::command]
pub async fn connect_ard(
    state: tauri::State<'_, ArdServiceState>,
    _app_handle: AppHandle,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    connection_id: Option<String>,
    auto_reconnect: Option<bool>,
    curtain_on_connect: Option<bool>,
) -> Result<String, String> {
    let ard_port = port.unwrap_or(session_runner::DEFAULT_ARD_PORT);
    let conn_id = connection_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Evict any existing session for this connection slot.
    {
        let mut service = state.lock().await;
        let old_id = service
            .connections
            .values()
            .find(|c| c.connection_id == conn_id)
            .map(|c| c.session_id.clone());

        if let Some(id) = old_id {
            if let Some(old) = service.connections.remove(&id) {
                let _ = old.command_tx.send(ArdCommand::Shutdown).await;
                tokio::time::sleep(Duration::from_millis(100)).await;
                service.push_log(
                    "info",
                    format!("Evicted previous ARD session {id} for connection {conn_id}"),
                    Some(id),
                );
            }
        }
    }

    let config = SessionConfig {
        host: host.clone(),
        port: ard_port,
        username: username.clone(),
        password,
        connection_id: conn_id.clone(),
        auto_reconnect: auto_reconnect.unwrap_or(true),
        curtain_on_connect: curtain_on_connect.unwrap_or(false),
        ..Default::default()
    };

    let handle = session_runner::launch_session(config);
    let session_id = handle.session_id.clone();

    // Register in global state.
    {
        let mut service = state.lock().await;
        service.connections.insert(
            session_id.clone(),
            ArdActiveConnection {
                session_id: session_id.clone(),
                connection_id: conn_id.clone(),
                host: host.clone(),
                port: ard_port,
                username: username.clone(),
                connected_at: Utc::now().to_rfc3339(),
                command_tx: handle.command_tx,
                stats: handle.stats,
            },
        );
        service.push_log(
            "info",
            format!("ARD session {session_id} connecting to {host}:{ard_port}"),
            Some(session_id.clone()),
        );
    }

    Ok(session_id)
}

/// Disconnect an active ARD session.
#[tauri::command]
pub async fn disconnect_ard(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut service = state.lock().await;

    // Find the target session.
    let target_id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref());

    if let Some(id) = target_id {
        if let Some(conn) = service.connections.remove(&id) {
            service.push_log(
                "info",
                format!("Disconnecting ARD session {id}"),
                Some(id.clone()),
            );
            let _ = conn.command_tx.send(ArdCommand::Shutdown).await;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    Ok(())
}

// ── Input ────────────────────────────────────────────────────────────────

/// Send an input action (mouse/keyboard) to an ARD session.
#[tauri::command]
pub async fn send_ard_input(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    action: ArdInputAction,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service
        .connections
        .get(&id)
        .ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::Input(action))
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

// ── Clipboard ────────────────────────────────────────────────────────────

/// Set the remote clipboard text.
#[tauri::command]
pub async fn set_ard_clipboard(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    text: String,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::SetClipboard { text })
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

/// Request the remote clipboard text.
#[tauri::command]
pub async fn get_ard_clipboard(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::GetClipboard)
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

// ── Curtain Mode ─────────────────────────────────────────────────────────

/// Toggle curtain mode (blanks the remote display).
#[tauri::command]
pub async fn set_ard_curtain_mode(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::SetCurtainMode { enabled })
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

// ── File Transfer ────────────────────────────────────────────────────────

/// Upload a file to the remote Mac.
#[tauri::command]
pub async fn upload_ard_file(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::UploadFile {
            local_path,
            remote_path,
        })
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

/// Download a file from the remote Mac.
#[tauri::command]
pub async fn download_ard_file(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::DownloadFile {
            remote_path,
            local_path,
        })
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

/// List a remote directory on the Mac.
#[tauri::command]
pub async fn list_ard_remote_dir(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    path: String,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::ListRemoteDir { path })
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

// ── Session Info ─────────────────────────────────────────────────────────

/// Get information about a specific ARD session.
#[tauri::command]
pub async fn get_ard_session_info(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<ArdSessionInfo, String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    Ok(ArdSessionInfo {
        session_id: conn.session_id.clone(),
        connection_id: conn.connection_id.clone(),
        host: conn.host.clone(),
        port: conn.port,
        username: conn.username.clone(),
        connected_at: conn.connected_at.clone(),
        stats: ArdStatsSnapshot {
            bytes_sent: conn.stats.bytes_sent.load(Ordering::Relaxed),
            bytes_received: conn.stats.bytes_received.load(Ordering::Relaxed),
            frames_decoded: conn.stats.frames_decoded.load(Ordering::Relaxed),
            key_events_sent: conn.stats.key_events_sent.load(Ordering::Relaxed),
            pointer_events_sent: conn.stats.pointer_events_sent.load(Ordering::Relaxed),
        },
    })
}

/// List all active ARD sessions.
#[tauri::command]
pub async fn list_ard_sessions(
    state: tauri::State<'_, ArdServiceState>,
) -> Result<Vec<ArdSessionInfo>, String> {
    let service = state.lock().await;
    let sessions: Vec<ArdSessionInfo> = service
        .connections
        .values()
        .map(|conn| ArdSessionInfo {
            session_id: conn.session_id.clone(),
            connection_id: conn.connection_id.clone(),
            host: conn.host.clone(),
            port: conn.port,
            username: conn.username.clone(),
            connected_at: conn.connected_at.clone(),
            stats: ArdStatsSnapshot {
                bytes_sent: conn.stats.bytes_sent.load(Ordering::Relaxed),
                bytes_received: conn.stats.bytes_received.load(Ordering::Relaxed),
                frames_decoded: conn.stats.frames_decoded.load(Ordering::Relaxed),
                key_events_sent: conn.stats.key_events_sent.load(Ordering::Relaxed),
                pointer_events_sent: conn.stats.pointer_events_sent.load(Ordering::Relaxed),
            },
        })
        .collect();

    Ok(sessions)
}

/// Get ARD session statistics.
#[tauri::command]
pub async fn get_ard_stats(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<ArdStatsSnapshot, String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    Ok(ArdStatsSnapshot {
        bytes_sent: conn.stats.bytes_sent.load(Ordering::Relaxed),
        bytes_received: conn.stats.bytes_received.load(Ordering::Relaxed),
        frames_decoded: conn.stats.frames_decoded.load(Ordering::Relaxed),
        key_events_sent: conn.stats.key_events_sent.load(Ordering::Relaxed),
        pointer_events_sent: conn.stats.pointer_events_sent.load(Ordering::Relaxed),
    })
}

/// Get the ARD log buffer.
#[tauri::command]
pub async fn get_ard_logs(
    state: tauri::State<'_, ArdServiceState>,
    limit: Option<usize>,
) -> Result<Vec<ArdLogEntry>, String> {
    let service = state.lock().await;
    let max = limit.unwrap_or(200);
    let entries: Vec<ArdLogEntry> = service
        .log_buffer
        .iter()
        .rev()
        .take(max)
        .cloned()
        .collect();
    Ok(entries)
}

/// Force a reconnection of an ARD session.
#[tauri::command]
pub async fn reconnect_ard(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let service = state.lock().await;
    let id = resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref())
        .ok_or("No matching ARD session found")?;
    let conn = service.connections.get(&id).ok_or("Session not found")?;

    conn.command_tx
        .send(ArdCommand::Reconnect)
        .await
        .map_err(|_| "Session command channel closed".to_string())
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Resolve a session by explicit session_id or by connection_id lookup.
fn resolve_session_id(
    service: &ArdService,
    session_id: Option<&str>,
    connection_id: Option<&str>,
) -> Option<String> {
    if let Some(sid) = session_id {
        if service.connections.contains_key(sid) {
            return Some(sid.to_string());
        }
    }
    if let Some(cid) = connection_id {
        return service
            .connections
            .values()
            .find(|c| c.connection_id == cid)
            .map(|c| c.session_id.clone());
    }
    None
}

/// Session info DTO returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdSessionInfo {
    pub session_id: String,
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected_at: String,
    pub stats: ArdStatsSnapshot,
}

/// Snapshot of session statistics returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdStatsSnapshot {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frames_decoded: u64,
    pub key_events_sent: u64,
    pub pointer_events_sent: u64,
}
