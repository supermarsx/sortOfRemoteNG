// Tauri command handlers for ARD sessions.
//
// Every public function in this module is a `#[tauri::command]` that the
// frontend can invoke.  They follow the project convention of returning
// `Result<T, String>` and accepting `tauri::State<ArdServiceState>`.

use std::sync::atomic::Ordering;
use std::time::Duration;

use chrono::Utc;
use tauri::ipc::{Channel, InvokeResponseBody};
use uuid::Uuid;

use super::session_runner::{self, SessionConfig};
use super::types::*;
use super::ArdServiceState;

// ── Connect / Disconnect ─────────────────────────────────────────────────

/// Establish a new ARD connection.
///
/// Returns the unique session ID.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_ard(
    state: tauri::State<'_, ArdServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    connection_id: Option<String>,
    authentication_mode: Option<ArdAuthenticationMode>,
    auto_reconnect: Option<bool>,
    curtain_on_connect: Option<bool>,
    local_cursor: Option<bool>,
    frame_data_channel: Channel<InvokeResponseBody>,
    frame_metadata_channel: Channel<ArdFrameMetadata>,
    status_channel: Channel<ArdStatusEvent>,
) -> Result<String, String> {
    let ard_port = port.unwrap_or(session_runner::DEFAULT_ARD_PORT);
    let auth_mode = authentication_mode.unwrap_or_default();
    let conn_id = connection_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let config = SessionConfig {
        host: host.clone(),
        port: ard_port,
        username: username.clone(),
        password,
        connection_id: conn_id.clone(),
        authentication_mode: auth_mode,
        auto_reconnect: auto_reconnect.unwrap_or(true),
        curtain_on_connect: curtain_on_connect.unwrap_or(false),
        local_cursor: local_cursor.unwrap_or(true),
        ..Default::default()
    };
    session_runner::validate_session_config(&config).map_err(|error| error.to_string())?;

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

    let handle = session_runner::launch_session(config);
    let session_id = handle.session_id.clone();
    let session_runner::SessionHandle {
        session_id: _,
        command_tx,
        mut event_rx,
        mut frame_rx,
        stats,
        join_handle,
    } = handle;

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
                authentication_mode: auth_mode,
                connected_at: Utc::now().to_rfc3339(),
                command_tx,
                stats,
            },
        );
        service.push_log(
            "info",
            format!("ARD session {session_id} connecting to {host}:{ard_port}"),
            Some(session_id.clone()),
        );
    }

    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if status_channel.send(event).is_err() {
                break;
            }
        }
    });

    let frame_session_id = session_id.clone();
    tokio::spawn(async move {
        let mut sequence = 0u64;
        while let Some(rectangles) = frame_rx.recv().await {
            for rectangle in rectangles {
                sequence = sequence.saturating_add(1);
                let kind = match rectangle.kind {
                    session_runner::DecodedRectKind::Framebuffer => ArdFrameKind::Framebuffer,
                    session_runner::DecodedRectKind::CopyRect { source_x, source_y } => {
                        ArdFrameKind::CopyRect { source_x, source_y }
                    }
                    session_runner::DecodedRectKind::Cursor => ArdFrameKind::Cursor,
                    session_runner::DecodedRectKind::DesktopSize => ArdFrameKind::DesktopSize,
                };
                let metadata = ArdFrameMetadata {
                    session_id: frame_session_id.clone(),
                    sequence,
                    x: rectangle.x,
                    y: rectangle.y,
                    width: rectangle.width,
                    height: rectangle.height,
                    byte_length: rectangle.pixels.len(),
                    kind,
                };
                if frame_data_channel
                    .send(InvokeResponseBody::Raw(rectangle.pixels))
                    .is_err()
                {
                    return;
                }
                if frame_metadata_channel.send(metadata).is_err() {
                    return;
                }
            }
        }
    });

    let cleanup_state = state.inner().clone();
    let cleanup_session_id = session_id.clone();
    tokio::spawn(async move {
        let _ = join_handle.await;
        let mut service = cleanup_state.lock().await;
        if service.connections.remove(&cleanup_session_id).is_some() {
            service.push_log(
                "info",
                format!("ARD session {cleanup_session_id} ended"),
                Some(cleanup_session_id),
            );
        }
    });

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

/// Disconnect every active ARD session and return the number signalled.
#[tauri::command]
pub async fn disconnect_all_ard(state: tauri::State<'_, ArdServiceState>) -> Result<usize, String> {
    let connections = {
        let mut service = state.lock().await;
        service
            .connections
            .drain()
            .map(|(_, connection)| connection)
            .collect::<Vec<_>>()
    };
    let count = connections.len();
    for connection in connections {
        let _ = connection.command_tx.send(ArdCommand::Shutdown).await;
    }
    Ok(count)
}

/// Report whether a session or saved connection currently has a live runner.
#[tauri::command]
pub async fn is_ard_connected(
    state: tauri::State<'_, ArdServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(resolve_session_id(&service, session_id.as_deref(), connection_id.as_deref()).is_some())
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
    let conn = service.connections.get(&id).ok_or("Session not found")?;

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
        authentication_mode: conn.authentication_mode,
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
            authentication_mode: conn.authentication_mode,
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
    let entries: Vec<ArdLogEntry> = service.log_buffer.iter().rev().take(max).cloned().collect();
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

/// Return build/platform capabilities without accepting any credentials.
#[tauri::command]
pub async fn get_ard_runtime_capabilities() -> Result<ArdRuntimeCapabilities, String> {
    Ok(ArdRuntimeCapabilities::current())
}

/// Hand Apple Account Screen Sharing off to Apple's native macOS app.
///
/// No Apple Account identifier or password is accepted by this command. The
/// user completes identity selection, authentication, and approval inside
/// Screen Sharing.app.
#[tauri::command]
pub async fn launch_apple_account_screen_sharing() -> Result<(), String> {
    launch_native_screen_sharing()
}

#[cfg(target_os = "macos")]
fn launch_native_screen_sharing() -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", "Screen Sharing"])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open Apple's Screen Sharing app: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn launch_native_screen_sharing() -> Result<(), String> {
    Err("Apple Account Screen Sharing is available only through Apple's Screen Sharing app on macOS. Use remote macOS account or dedicated VNC-password authentication for the embedded ARD viewer on this platform.".into())
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
    pub authentication_mode: ArdAuthenticationMode,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_capability_command_never_accepts_apple_account_passwords() {
        let capabilities = ArdRuntimeCapabilities::current();
        assert!(!capabilities.embedded_rfb.accepts_apple_account_credentials);
        assert!(!capabilities.apple_account_native.accepts_password);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn native_apple_account_handoff_fails_explicitly_off_macos() {
        let error = launch_native_screen_sharing().unwrap_err();
        assert!(error.contains("only"));
        assert!(error.contains("macOS"));
    }
}
