use std::sync::Arc;
use std::time::Duration;

use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::frame_store::SharedFrameStoreState;
use super::input::convert_input;
use super::session_runner::run_rdp_session;
use super::settings::{RdpSettingsPayload, ResolvedSettings};
use super::stats::RdpSessionStats;
use super::types::*;
use super::RdpServiceState;

// ---- Tauri commands ----

/// Detect the current Windows keyboard layout and return the HKL (low 16 bits
/// = keyboard layout ID which is the value IronRDP's `keyboard_layout` expects).
#[tauri::command]
pub fn detect_keyboard_layout() -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayout;

        // GetKeyboardLayout(0) returns the layout for the current thread's
        // foreground window.  The low 16 bits are the Language ID (LANGID),
        // which maps directly to the RDP keyboard layout value.
        let hkl = unsafe { GetKeyboardLayout(0) };
        let raw = hkl.0 as usize;
        // The low 16 bits hold the language identifier.
        let lang_id = (raw & 0xFFFF) as u32;
        // The full 32-bit value includes the layout in the high word.
        // For RDP we need the full layout identifier if available,
        // otherwise the language ID is sufficient.
        let layout = raw as u32;
        log::info!("Detected keyboard layout: HKL=0x{raw:08x} lang=0x{lang_id:04x} layout=0x{layout:08x}");
        Ok(layout)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On non-Windows platforms return US English as a safe default.
        Ok(0x0409)
    }
}

#[tauri::command]
pub async fn connect_rdp(
    state: tauri::State<'_, RdpServiceState>,
    frame_store: tauri::State<'_, SharedFrameStoreState>,
    app_handle: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: Option<u16>,
    height: Option<u16>,
    rdp_settings: Option<RdpSettingsPayload>,
    // Stable frontend connection slot ID.  When provided the backend
    // automatically evicts any prior session occupying the same slot.
    connection_id: Option<String>,
    // Channel for push-based frame delivery (binary RGBA streamed directly
    // from the session thread to JS -- no base64, no event+invoke round-trip).
    frame_channel: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    // -- Evict any previous session for this connection slot --
    {
        let mut service = state.lock().await;
        let old_id = if let Some(ref cid) = connection_id {
            // Primary: evict by connection_id (stable frontend slot)
            service
                .connections
                .values()
                .find(|c| c.session.connection_id.as_deref() == Some(cid))
                .map(|c| c.session.id.clone())
        } else {
            // Fallback: evict by host+port+user (for callers without connection_id)
            service
                .connections
                .values()
                .find(|c| {
                    c.session.host == host
                        && c.session.port == port
                        && c.session.username == username
                        && c.session.connected
                })
                .map(|c| c.session.id.clone())
        };
        if let Some(id) = old_id {
            log::info!(
                "Evicting previous session {id} (connection_id={:?}) for {host}:{port}",
                connection_id
            );
            if let Some(old) = service.connections.remove(&id) {
                let _ = old.cmd_tx.send(RdpCommand::Shutdown);
            }
        }
    }

    let session_id = Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<RdpCommand>();

    let requested_width = width.unwrap_or(1920);
    let requested_height = height.unwrap_or(1080);

    let payload = rdp_settings.unwrap_or_default();
    let settings = ResolvedSettings::from_payload(&payload, requested_width, requested_height);
    let actual_width = settings.width;
    let actual_height = settings.height;

    let session = RdpSession {
        id: session_id.clone(),
        connection_id: connection_id.clone(),
        host: host.clone(),
        port,
        username: username.clone(),
        connected: true,
        desktop_width: actual_width,
        desktop_height: actual_height,
        server_cert_fingerprint: None,
        viewer_attached: true,
        reconnect_count: 0,
        reconnecting: false,
    };

    let stats = Arc::new(RdpSessionStats::new());
    let stats_clone = Arc::clone(&stats);

    let sid = session_id.clone();
    let h = host.clone();
    let u = username.clone();
    let p = password.clone();
    let d = domain.clone();
    let ah = app_handle.clone();

    // Clone cached TLS connector & HTTP client from the service so the
    // blocking thread can use them without holding the service lock.
    let service = state.lock().await;
    let tls_conn = service.cached_tls_connector.clone();
    let http_client = service.cached_http_client.clone();
    drop(service);

    let fs = Arc::clone(&*frame_store);

    // Use spawn_blocking to run the entire RDP session on a dedicated OS thread
    let handle = tokio::task::spawn_blocking(move || {
        run_rdp_session(
            sid,
            h,
            port,
            u,
            p,
            d,
            settings,
            ah,
            cmd_rx,
            stats_clone,
            tls_conn,
            http_client,
            fs,
            frame_channel,
        );
    });

    let connection = RdpActiveConnection {
        session,
        cmd_tx,
        stats,
        _handle: handle,
        cached_password: password.clone(),
        cached_domain: domain.clone(),
    };

    let mut service = state.lock().await;
    service.push_log(
        "info",
        format!("Connecting to {host}:{port} as {username} (session {session_id})"),
        Some(session_id.clone()),
    );
    service.connections.insert(session_id.clone(), connection);

    Ok(session_id)
}

#[tauri::command]
pub async fn disconnect_rdp(
    state: tauri::State<'_, RdpServiceState>,
    session_id: Option<String>,
    // Disconnect by stable frontend connection slot ID (preferred).
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut service = state.lock().await;

    // 1) Try by session_id first
    if let Some(ref sid) = session_id {
        if let Some(conn) = service.connections.remove(sid) {
            service.push_log("info", format!("Disconnecting session {sid}"), Some(sid.clone()));
            let _ = conn.cmd_tx.send(RdpCommand::Shutdown);
            tokio::time::sleep(Duration::from_millis(100)).await;
            return Ok(());
        }
    }

    // 2) Fall back to connection_id (scan values)
    if let Some(ref cid) = connection_id {
        let old_id = service
            .connections
            .values()
            .find(|c| c.session.connection_id.as_deref() == Some(cid.as_str()))
            .map(|c| c.session.id.clone());
        if let Some(id) = old_id {
            if let Some(conn) = service.connections.remove(&id) {
                service.push_log("info", format!("Disconnecting session {id} (connection_id={cid})"), Some(id.clone()));
                let _ = conn.cmd_tx.send(RdpCommand::Shutdown);
                tokio::time::sleep(Duration::from_millis(100)).await;
                return Ok(());
            }
        }
    }

    // Nothing to disconnect -- this is not an error (the session may
    // have already been evicted by a racing connect_rdp call).
    Ok(())
}

/// Detach the viewer from an active RDP session without killing it.
/// The session continues running headless (no frame streaming).
#[tauri::command]
pub async fn detach_rdp_session(
    state: tauri::State<'_, RdpServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut service = state.lock().await;

    let target_id = if let Some(ref sid) = session_id {
        Some(sid.clone())
    } else if let Some(ref cid) = connection_id {
        service
            .connections
            .values()
            .find(|c| c.session.connection_id.as_deref() == Some(cid.as_str()))
            .map(|c| c.session.id.clone())
    } else {
        None
    };

    let mut did_detach = None;
    if let Some(id) = target_id {
        if let Some(conn) = service.connections.get_mut(&id) {
            let _ = conn.cmd_tx.send(RdpCommand::DetachViewer);
            conn.session.viewer_attached = false;
            did_detach = Some(id);
        }
    }
    if let Some(id) = did_detach {
        service.push_log("info", format!("Viewer detached from session {id}"), Some(id));
    }
    Ok(())
}

/// Attach a new frame channel viewer to an existing RDP session.
/// Returns the session info so the frontend can restore its state.
#[tauri::command]
pub async fn attach_rdp_session(
    state: tauri::State<'_, RdpServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
    frame_channel: Channel<InvokeResponseBody>,
) -> Result<RdpSession, String> {
    let mut service = state.lock().await;

    let target_id = if let Some(ref sid) = session_id {
        Some(sid.clone())
    } else if let Some(ref cid) = connection_id {
        service
            .connections
            .values()
            .find(|c| c.session.connection_id.as_deref() == Some(cid.as_str()))
            .map(|c| c.session.id.clone())
    } else {
        None
    };

    let id = target_id.ok_or("No session_id or connection_id provided")?;
    let conn = service
        .connections
        .get_mut(&id)
        .ok_or_else(|| format!("Session {id} not found"))?;

    conn.cmd_tx
        .send(RdpCommand::AttachViewer(frame_channel))
        .map_err(|_| "Session command channel closed".to_string())?;

    conn.session.viewer_attached = true;
    let session_clone = conn.session.clone();
    service.push_log("info", format!("Viewer attached to session {id}"), Some(id));
    Ok(session_clone)
}

/// Send a graceful sign-out command to the remote RDP session.
/// Injects keystrokes to run "logoff" via the Run dialog.
#[tauri::command]
pub async fn rdp_sign_out(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    let conn = service
        .connections
        .get(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found"))?;
    conn.cmd_tx
        .send(RdpCommand::SignOut)
        .map_err(|_| "Session command channel closed".to_string())?;
    service.push_log("info", format!("Sign-out requested for session {session_id}"), Some(session_id));
    Ok(())
}

/// Force reboot the remote machine via "shutdown /r /t 0 /f".
/// Injects keystrokes to run the command via the Run dialog.
#[tauri::command]
pub async fn rdp_force_reboot(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    let conn = service
        .connections
        .get(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found"))?;
    conn.cmd_tx
        .send(RdpCommand::ForceReboot)
        .map_err(|_| "Session command channel closed".to_string())?;
    service.push_log("warn", format!("Force reboot requested for session {session_id}"), Some(session_id));
    Ok(())
}

/// Trigger a manual reconnect for an active RDP session.
/// The session drops its current TCP connection and re-establishes from scratch.
#[tauri::command]
pub async fn reconnect_rdp_session(
    state: tauri::State<'_, RdpServiceState>,
    session_id: Option<String>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let service = state.lock().await;

    let target_id = if let Some(ref sid) = session_id {
        Some(sid.clone())
    } else if let Some(ref cid) = connection_id {
        service
            .connections
            .values()
            .find(|c| c.session.connection_id.as_deref() == Some(cid.as_str()))
            .map(|c| c.session.id.clone())
    } else {
        None
    };

    let id = target_id.ok_or("No session_id or connection_id provided")?;
    let conn = service
        .connections
        .get(&id)
        .ok_or_else(|| format!("Session {id} not found"))?;

    conn.cmd_tx
        .send(RdpCommand::Reconnect)
        .map_err(|_| "Session command channel closed".to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn rdp_send_input(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    events: Vec<RdpInputAction>,
) -> Result<(), String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        let fp_events: Vec<FastPathInputEvent> = events.iter().flat_map(convert_input).collect();
        conn.cmd_tx
            .send(RdpCommand::Input(fp_events))
            .map_err(|_| "Session command channel closed".to_string())?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

/// Fetch raw RGBA pixel data for a rectangular region of the RDP session's
/// framebuffer.  Returns an `ArrayBuffer` on the JS side -- no base64
/// encoding or JSON serialisation of pixel data.
#[tauri::command]
pub fn rdp_get_frame_data(
    frame_store: tauri::State<'_, SharedFrameStoreState>,
    session_id: String,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> Result<tauri::ipc::Response, String> {
    let bytes = frame_store
        .extract_region(&session_id, x, y, width, height)
        .ok_or_else(|| format!("No framebuffer for session {session_id}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Return a downscaled RGBA thumbnail of the full framebuffer.
/// This avoids transferring multi-megabyte frames for preview purposes.
#[tauri::command]
pub fn rdp_get_thumbnail(
    frame_store: tauri::State<'_, SharedFrameStoreState>,
    session_id: String,
    thumb_width: u32,
    thumb_height: u32,
) -> Result<tauri::ipc::Response, String> {
    let slots = frame_store.slots.read().unwrap();
    let slot = slots
        .get(&session_id)
        .ok_or_else(|| format!("No framebuffer for session {session_id}"))?;

    let src_w = slot.width as u32;
    let src_h = slot.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty framebuffer".to_string());
    }

    let src = image::RgbaImage::from_raw(src_w, src_h, slot.data.clone())
        .ok_or("Invalid framebuffer data")?;

    let thumb = image::imageops::resize(
        &src,
        thumb_width,
        thumb_height,
        image::imageops::FilterType::Nearest,
    );

    Ok(tauri::ipc::Response::new(thumb.into_raw()))
}

/// Save a screenshot of the RDP session framebuffer to a file.
#[tauri::command]
pub fn rdp_save_screenshot(
    frame_store: tauri::State<'_, SharedFrameStoreState>,
    session_id: String,
    file_path: String,
) -> Result<(), String> {
    let slots = frame_store.slots.read().unwrap();
    let slot = slots
        .get(&session_id)
        .ok_or_else(|| format!("No framebuffer for session {session_id}"))?;

    let src_w = slot.width as u32;
    let src_h = slot.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty framebuffer".to_string());
    }

    let img = image::RgbaImage::from_raw(src_w, src_h, slot.data.clone())
        .ok_or("Invalid framebuffer data")?;

    img.save(&file_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_rdp_session_info(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<RdpSession, String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        Ok(conn.session.clone())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

#[tauri::command]
pub async fn list_rdp_sessions(
    state: tauri::State<'_, RdpServiceState>,
) -> Result<Vec<RdpSession>, String> {
    let service = state.lock().await;
    Ok(service
        .connections
        .values()
        .map(|c| c.session.clone())
        .collect())
}

#[tauri::command]
pub async fn get_rdp_stats(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<RdpStatsEvent, String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        Ok(conn.stats.to_event(&session_id))
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

/// Retrieve RDP log entries, optionally filtered by timestamp.
#[tauri::command]
pub async fn get_rdp_logs(
    state: tauri::State<'_, RdpServiceState>,
    since_timestamp: Option<u64>,
) -> Result<Vec<RdpLogEntry>, String> {
    let service = state.lock().await;
    if let Some(since) = since_timestamp {
        Ok(service
            .log_buffer
            .iter()
            .filter(|e| e.timestamp > since)
            .cloned()
            .collect())
    } else {
        Ok(service.log_buffer.clone())
    }
}
