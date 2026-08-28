use super::commands::*;
use secrecy::SecretString;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFilePayload {
    pub name: String,
    pub size: f64,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

const MAX_RDP_INPUT_ACTIONS: usize = 4_096;
const MAX_RDP_CLIPBOARD_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_RDP_CLIPBOARD_FILES: usize = 1_024;
const MAX_RDP_CLIPBOARD_FILE_NAME_BYTES: usize = 1_024;
const MAX_RDP_CLIPBOARD_FILE_PATH_BYTES: usize = 32 * 1024;
const MAX_RDP_CLIPBOARD_FILE_METADATA_BYTES: usize = 8 * 1024 * 1024;

fn enqueue_session_command(
    sender: &crate::rdp::wake_channel::WakeSender,
    command: RdpCommand,
) -> Result<(), String> {
    sender.send(command).map_err(|error| error.to_string())
}

fn validate_rdp_input_actions(events: &[RdpInputAction]) -> Result<(), String> {
    if events.len() > MAX_RDP_INPUT_ACTIONS {
        return Err(format!(
            "Too many RDP input actions: {} (maximum {MAX_RDP_INPUT_ACTIONS})",
            events.len()
        ));
    }

    Ok(())
}

fn validate_rdp_clipboard_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_RDP_CLIPBOARD_TEXT_BYTES {
        return Err(format!(
            "RDP clipboard text is too large: {} bytes (maximum {MAX_RDP_CLIPBOARD_TEXT_BYTES})",
            text.len()
        ));
    }

    Ok(())
}

fn validate_rdp_clipboard_files(files: &[ClipboardFilePayload]) -> Result<(), String> {
    if files.len() > MAX_RDP_CLIPBOARD_FILES {
        return Err(format!(
            "Too many RDP clipboard files: {} (maximum {MAX_RDP_CLIPBOARD_FILES})",
            files.len()
        ));
    }

    let mut metadata_bytes = 0usize;
    for (index, file) in files.iter().enumerate() {
        let name_bytes = file.name.len();
        let path_bytes = file.path.len();

        if name_bytes > MAX_RDP_CLIPBOARD_FILE_NAME_BYTES {
            return Err(format!(
                "RDP clipboard file {index} name is too large: {name_bytes} bytes (maximum {MAX_RDP_CLIPBOARD_FILE_NAME_BYTES})"
            ));
        }
        if path_bytes > MAX_RDP_CLIPBOARD_FILE_PATH_BYTES {
            return Err(format!(
                "RDP clipboard file {index} path is too large: {path_bytes} bytes (maximum {MAX_RDP_CLIPBOARD_FILE_PATH_BYTES})"
            ));
        }

        metadata_bytes = metadata_bytes
            .checked_add(name_bytes)
            .and_then(|total| total.checked_add(path_bytes))
            .ok_or_else(|| "RDP clipboard file metadata size overflow".to_string())?;
        if metadata_bytes > MAX_RDP_CLIPBOARD_FILE_METADATA_BYTES {
            return Err(format!(
                "RDP clipboard file metadata is too large: {metadata_bytes} bytes (maximum {MAX_RDP_CLIPBOARD_FILE_METADATA_BYTES})"
            ));
        }
    }

    Ok(())
}

#[derive(Clone, Copy, serde::Serialize)]
pub struct RdpDesktopSizePayload {
    pub width: u16,
    pub height: u16,
}

fn normalize_desktop_size(width: u32, height: u32) -> RdpDesktopSizePayload {
    let (width, height) =
        ironrdp_displaycontrol::pdu::MonitorLayoutEntry::adjust_display_size(width, height);

    RdpDesktopSizePayload {
        width: width as u16,
        height: height as u16,
    }
}

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
        log::info!(
            "Detected keyboard layout: HKL=0x{raw:08x} lang=0x{lang_id:04x} layout=0x{layout:08x}"
        );
        Ok(layout)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On non-Windows platforms return US English as a safe default.
        Ok(0x0409)
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let replacement_selector = if let Some(ref connection_id) = connection_id {
        RdpConnectionSelector::ConnectionId(connection_id.clone())
    } else {
        RdpConnectionSelector::Endpoint {
            host: host.clone(),
            port,
            username: username.clone(),
        }
    };

    let session_id = Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = crate::rdp::wake_channel::create_wake_channel()
        .map_err(|e| format!("Failed to create wake channel: {e}"))?;
    let activity_control = Arc::new(RdpSessionActivityControl::default());
    let worker_activity_control = Arc::clone(&activity_control);

    let requested_width = width.unwrap_or(1920);
    let requested_height = height.unwrap_or(1080);

    let payload = rdp_settings.unwrap_or_default();
    let settings = ResolvedSettings::from_payload(&payload, requested_width, requested_height);
    let actual_width = settings.width;
    let actual_height = settings.height;
    let cert_validation_mode =
        crate::rdp::cert_trust::ServerCertValidationMode::from_payload(&payload);

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
    let password = SecretString::from(password);

    let sid = session_id.clone();
    let h = host.clone();
    let u = username.clone();
    let p = password.clone();
    let d = domain.clone();
    let ah = app_handle.clone();

    let fs = Arc::clone(&*frame_store);

    // Wrap the Tauri AppHandle as a DynEventEmitter for the crate-layer API.
    let emitter = app_handle_to_emitter(&ah);
    let trust_context = crate::rdp::cert_trust::SessionPromptContext::new(
        session_id.clone(),
        cert_validation_mode,
        crate::rdp::cert_trust::default_prompt_timeout(),
        emitter.clone(),
    );
    // Wrap the Tauri Channel as a DynFrameChannel.
    let dyn_frame_channel: DynFrameChannel = std::sync::Arc::new(TauriFrameChannel(frame_channel));

    // Log sink channel: the session runner pushes log entries through this
    // channel and a background task drains them into the service's log buffer.
    let (log_tx, log_rx) = std::sync::mpsc::sync_channel::<RdpLogEntry>(
        super::session_runner::RDP_LOG_CHANNEL_CAPACITY,
    );
    let log_state = Arc::clone(&*state);

    loop {
        match close_rdp_connection(
            &state,
            &replacement_selector,
            "replaced by a newer connect request",
            RDP_WORKER_SHUTDOWN_GRACE,
        )
        .await
        {
            RdpCloseOutcome::StillClosing {
                session_id: previous_session_id,
                generation,
            } => {
                return Err(format!(
                    "Previous RDP worker {previous_session_id} (generation {generation}) is still closing; retry after cleanup completes"
                ));
            }
            RdpCloseOutcome::NotFound | RdpCloseOutcome::Closed { .. } => {}
        }

        // The service lock is held from the final stable-slot check through
        // reserve/spawn/insert. There are no awaits in this section, so two
        // racing connect calls cannot both claim the same slot.
        let mut service = state.lock().await;
        if find_rdp_connection_id(&service, &replacement_selector).is_some() {
            drop(service);
            continue;
        }

        let session_slot = service.try_reserve_session_slot()?;
        let generation = service.allocate_worker_generation();
        let tls_conn = service.cached_tls_connector.clone();
        let http_client = service.cached_http_client.clone();
        tokio::spawn(async move {
            // Drain in a non-blocking loop with small sleeps so we don't
            // spin-lock. Exits when the sender is dropped (session ends).
            loop {
                let mut batch = Vec::with_capacity(super::session_runner::RDP_LOG_DRAIN_BATCH_SIZE);
                while batch.len() < super::session_runner::RDP_LOG_DRAIN_BATCH_SIZE {
                    match log_rx.try_recv() {
                        Ok(entry) => batch.push(entry),
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                            if !batch.is_empty() {
                                let mut svc = log_state.lock().await;
                                for entry in batch {
                                    svc.log_buffer.push_back(entry);
                                    while svc.log_buffer.len() > 1000 {
                                        svc.log_buffer.pop_front();
                                    }
                                }
                            }
                            return;
                        }
                    }
                }
                if !batch.is_empty() {
                    let mut svc = log_state.lock().await;
                    for entry in batch {
                        svc.log_buffer.push_back(entry);
                        while svc.log_buffer.len() > 1000 {
                            svc.log_buffer.pop_front();
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });

        // `spawn_blocking` binds the admission permit inside the worker and
        // releases it only after this closure returns on every exit path.
        let worker = RdpWorkerRuntime::spawn_blocking(generation, session_slot, move || {
            let _trust_guard = crate::rdp::cert_trust::bind_session_prompt_context(trust_context);
            run_rdp_session(
                sid,
                h,
                port,
                u,
                p,
                d,
                settings,
                emitter,
                cmd_rx,
                stats_clone,
                tls_conn,
                http_client,
                fs,
                dyn_frame_channel,
                log_tx,
                worker_activity_control,
            );
        });

        let connection = RdpActiveConnection {
            session,
            cmd_tx,
            activity_control,
            stats,
            worker,
            cached_password: password,
            cached_domain: domain.clone(),
        };

        service.push_log(
            "info",
            format!(
                "Connecting to {host}:{port} as {username} (session {session_id}, generation {generation})"
            ),
            Some(session_id.clone()),
        );
        service.connections.insert(session_id.clone(), connection);

        return Ok(session_id);
    }
}

#[tauri::command]
pub async fn disconnect_rdp(
    state: tauri::State<'_, RdpServiceState>,
    session_id: Option<String>,
    // Disconnect by stable frontend connection slot ID (preferred).
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut outcome = RdpCloseOutcome::NotFound;
    if let Some(session_id) = session_id {
        outcome = close_rdp_connection(
            &state,
            &RdpConnectionSelector::SessionId(session_id),
            "disconnect requested",
            RDP_WORKER_SHUTDOWN_GRACE,
        )
        .await;
    }

    if matches!(outcome, RdpCloseOutcome::NotFound) {
        if let Some(connection_id) = connection_id {
            outcome = close_rdp_connection(
                &state,
                &RdpConnectionSelector::ConnectionId(connection_id),
                "disconnect requested",
                RDP_WORKER_SHUTDOWN_GRACE,
            )
            .await;
        }
    }

    match outcome {
        RdpCloseOutcome::StillClosing {
            session_id,
            generation,
        } => Err(format!(
            "RDP worker {session_id} (generation {generation}) is still closing; cleanup continues in the background"
        )),
        // A missing record is an idempotent success: another disconnect or
        // generation-scoped reaper may already have completed cleanup.
        RdpCloseOutcome::NotFound | RdpCloseOutcome::Closed { .. } => Ok(()),
    }
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
            enqueue_session_command(&conn.cmd_tx, RdpCommand::DetachViewer)?;
            conn.session.viewer_attached = false;
            did_detach = Some(id);
        }
    }
    if let Some(id) = did_detach {
        service.push_log(
            "info",
            format!("Viewer detached from session {id}"),
            Some(id),
        );
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

    let dyn_frame_channel: DynFrameChannel = std::sync::Arc::new(TauriFrameChannel(frame_channel));
    let attach_command = RdpCommand::AttachViewer(dyn_frame_channel);
    // Reserve before advancing the generation fence. A saturated command
    // surface therefore rejects the attach without consuming an epoch.
    let command_permit = conn
        .cmd_tx
        .reserve_regular_command(&attach_command)
        .map_err(|error| error.to_string())?;
    // Move replacement viewers into a disjoint JS-safe generation epoch before
    // their attach is observable. Delayed commands from every earlier viewer
    // epoch are then below the authoritative watermark.
    conn.activity_control.fence_for_viewer_attach()?;
    conn.cmd_tx
        .send_reserved(attach_command, command_permit)
        .map_err(|error| error.to_string())?;

    conn.session.viewer_attached = true;
    let session_clone = conn.session.clone();
    service.push_log("info", format!("Viewer attached to session {id}"), Some(id));
    Ok(session_clone)
}

/// Suppress or resume an RDP session's output without changing viewer
/// ownership or stopping the underlying transport. Activity generations are
/// scoped to the concrete `session_id` and must increase strictly.
#[tauri::command]
pub async fn rdp_set_session_activity(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    generation: u64,
    active: bool,
) -> Result<RdpSessionActivityResult, String> {
    let service = state.lock().await;
    let connection = service
        .connections
        .get(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found"))?;
    let result = connection
        .activity_control
        .request(&session_id, generation, active)?;
    if result.applied {
        // ActivityChanged is a coalesced out-of-band wake edge and cannot be
        // blocked by the bounded normal command budget.
        enqueue_session_command(&connection.cmd_tx, RdpCommand::ActivityChanged)?;
    }
    Ok(result)
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
    enqueue_session_command(&conn.cmd_tx, RdpCommand::SignOut)?;
    service.push_log(
        "info",
        format!("Sign-out requested for session {session_id}"),
        Some(session_id),
    );
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
    enqueue_session_command(&conn.cmd_tx, RdpCommand::ForceReboot)?;
    service.push_log(
        "warn",
        format!("Force reboot requested for session {session_id}"),
        Some(session_id),
    );
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

    enqueue_session_command(&conn.cmd_tx, RdpCommand::Reconnect)?;

    Ok(())
}

#[tauri::command]
pub async fn rdp_send_input(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    events: Vec<RdpInputAction>,
) -> Result<(), String> {
    validate_rdp_input_actions(&events)?;

    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        let fp_events: Vec<FastPathInputEvent> = events.iter().flat_map(convert_input).collect();
        enqueue_session_command(&conn.cmd_tx, RdpCommand::Input(fp_events))?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

#[tauri::command]
pub async fn rdp_set_desktop_size(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    width: u32,
    height: u32,
) -> Result<RdpDesktopSizePayload, String> {
    let normalized = normalize_desktop_size(width, height);

    let mut service = state.lock().await;
    let conn = service
        .connections
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found"))?;

    enqueue_session_command(
        &conn.cmd_tx,
        RdpCommand::SetDesktopSize {
            width: normalized.width,
            height: normalized.height,
        },
    )?;

    conn.session.desktop_width = normalized.width;
    conn.session.desktop_height = normalized.height;

    Ok(normalized)
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
    validate_rdp_thumbnail_dimensions(thumb_width, thumb_height)?;

    let slots = frame_store.slots.read().expect("lock poisoned");
    let slot_arc = slots
        .get(&session_id)
        .ok_or_else(|| format!("No framebuffer for session {session_id}"))?;
    let slot = slot_arc.inner.read().expect("lock poisoned");

    let src_w = slot.width as u32;
    let src_h = slot.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty framebuffer".to_string());
    }

    let thumb = resize_rgba_nearest(&slot.data, src_w, src_h, thumb_width, thumb_height)?;

    Ok(tauri::ipc::Response::new(thumb))
}

/// Save a screenshot of the RDP session framebuffer to a file.
#[tauri::command]
pub fn rdp_save_screenshot(
    frame_store: tauri::State<'_, SharedFrameStoreState>,
    session_id: String,
    file_path: String,
) -> Result<(), String> {
    let slots = frame_store.slots.read().expect("lock poisoned");
    let slot_arc = slots
        .get(&session_id)
        .ok_or_else(|| format!("No framebuffer for session {session_id}"))?;
    let slot = slot_arc.inner.read().expect("lock poisoned");

    let src_w = slot.width as u32;
    let src_h = slot.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty framebuffer".to_string());
    }

    let path = std::path::Path::new(&file_path);
    let is_png = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
    if !is_png {
        return Err("Only .png screenshots are supported".to_string());
    }

    let png = encode_rgba_png(&slot.data, src_w, src_h)?;
    std::fs::write(path, png).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub async fn rdp_report_frame_telemetry(
    state: tauri::State<'_, RdpServiceState>,
    payload: RdpFrameTelemetryEvent,
) -> Result<(), String> {
    if payload
        .average_render_ms
        .is_some_and(|average_render_ms| !average_render_ms.is_finite() || average_render_ms < 0.0)
    {
        return Err("averageRenderMs must be a finite non-negative number".to_string());
    }

    let stats = {
        let service = state.lock().await;
        service
            .connections
            .get(&payload.session_id)
            .map(|conn| Arc::clone(&conn.stats))
            .ok_or_else(|| format!("RDP session {} not found", payload.session_id))?
    };

    let mut frame_flow_summary = stats
        .lifecycle_snapshot(&payload.session_id)
        .frame_flow_summary;
    frame_flow_summary.queued_frames = payload.queued_frames;
    frame_flow_summary.dropped_frames = payload.dropped_frames;
    // `coalesced_frames` is now owned by the backend `FrameFlowController`
    // (which actually measures coalescing on the frame path); the frontend does
    // not, so do not let its report clobber the authoritative backend count.
    frame_flow_summary.average_render_ms = payload.average_render_ms;
    stats.set_frame_flow_summary(frame_flow_summary);

    Ok(())
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
        Ok(service.log_buffer.iter().cloned().collect())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpCertTrustResponsePayload {
    pub session_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub decision: String,
    #[serde(default)]
    pub remember: bool,
}

#[tauri::command]
pub async fn rdp_cert_trust_respond(payload: RdpCertTrustResponsePayload) -> Result<(), String> {
    let approve = match payload.decision.trim().to_ascii_lowercase().as_str() {
        "approve" | "accept" | "trust" | "yes" => true,
        "reject" | "deny" | "no" => false,
        _ => {
            return Err(
                "decision must be one of: approve, accept, trust, yes, reject, deny, no"
                    .to_string(),
            )
        }
    };

    crate::rdp::cert_trust::submit_prompt_response(
        payload.session_id,
        payload.host,
        payload.port,
        payload.fingerprint,
        approve,
        payload.remember,
    )
}

/// Advertise local clipboard text to the remote RDP session via CLIPRDR.
/// The text is stored and will be sent to the server when it requests
/// the clipboard contents.
#[tauri::command]
pub async fn rdp_clipboard_copy(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    validate_rdp_clipboard_text(&text)?;

    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        enqueue_session_command(&conn.cmd_tx, RdpCommand::ClipboardCopy(text))?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

/// Stage local files for CLIPRDR file transfer to the remote RDP session.
/// Files are read from disk by the session runner when the server requests
/// their contents via the FileContentsRequest/Response protocol.
#[tauri::command]
pub async fn rdp_clipboard_copy_files(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    files: Vec<ClipboardFilePayload>,
) -> Result<(), String> {
    validate_rdp_clipboard_files(&files)?;

    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        let entries: Vec<ClipboardFileEntry> = files
            .into_iter()
            .map(|f| ClipboardFileEntry {
                name: f.name,
                size: f.size as u64,
                path: f.path,
                is_directory: f.is_directory,
            })
            .collect();
        enqueue_session_command(&conn.cmd_tx, RdpCommand::ClipboardCopyFiles(entries))?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

/// Request clipboard text from the remote RDP session via CLIPRDR.
/// The response will arrive asynchronously as an `rdp://clipboard-data` event.
#[tauri::command]
pub async fn rdp_clipboard_paste(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        enqueue_session_command(&conn.cmd_tx, RdpCommand::ClipboardPaste)?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

/// Toggle a session feature (audio, clipboard) on/off at runtime.
#[tauri::command]
pub async fn rdp_toggle_feature(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    feature: String,
    enabled: bool,
) -> Result<(), String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        enqueue_session_command(&conn.cmd_tx, RdpCommand::ToggleFeature { feature, enabled })?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

#[cfg(test)]
mod command_queue_surface_tests {
    use super::*;

    #[test]
    fn saturated_command_surface_reports_full_instead_of_disconnected() {
        let (sender, _receiver) =
            crate::rdp::wake_channel::create_wake_channel().expect("wake channel");
        for _ in 0..crate::rdp::wake_channel::MAX_PENDING_COMMANDS {
            enqueue_session_command(&sender, RdpCommand::Reconnect).expect("within bound");
        }

        let full = enqueue_session_command(&sender, RdpCommand::ClipboardPaste)
            .expect_err("saturated surface must reject explicitly");
        assert_eq!(full, "RDP command queue is full");
    }

    #[test]
    fn disconnected_command_surface_reports_closed() {
        let (sender, receiver) =
            crate::rdp::wake_channel::create_wake_channel().expect("wake channel");
        drop(receiver);

        let closed = enqueue_session_command(&sender, RdpCommand::Reconnect)
            .expect_err("closed surface must reject explicitly");
        assert_eq!(closed, "RDP command channel is closed");
    }
}
