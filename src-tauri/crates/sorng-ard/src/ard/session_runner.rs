//! Main ARD session runner.
//!
//! Manages the lifecycle of a single ARD connection: handshake, authentication,
//! framebuffer update loop, input dispatch, and reconnection.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::auth;
use super::clipboard::{self, ClipboardContent};
use super::encoding::{self, DecodedRect, EncodingDecoder};
use super::errors::ArdError;
use super::file_transfer;
use super::input::{self, PointerState};
use super::pixel_format::PixelFormat;
use super::rfb::{self, RfbConnection, RfbVersion, ServerInit};
use super::types::{
    ArdCapabilities, ArdCommand, ArdInputAction, ArdSession, ArdSessionStats,
    ArdStatusEvent,
};

/// Default Remote Desktop port used by ARD / macOS Screen Sharing.
pub const DEFAULT_ARD_PORT: u16 = 5900;

/// Maximum reconnect attempts before giving up.
pub const MAX_RECONNECT_ATTEMPTS: u32 = 5;

/// Delay between reconnect attempts.
pub const RECONNECT_DELAY: Duration = Duration::from_secs(3);

/// Size of the command channel buffer.
const COMMAND_CHANNEL_SIZE: usize = 128;

/// Size of the event channel buffer.
const EVENT_CHANNEL_SIZE: usize = 64;

/// Size of the framebuffer channel buffer.
const FRAME_CHANNEL_SIZE: usize = 8;

/// Framebuffer update request interval.
const FB_REQUEST_INTERVAL: Duration = Duration::from_millis(33); // ~30 fps

/// Configuration for a new ARD session.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub connection_id: String,
    /// Preferred pixel format (or None to use server default).
    pub pixel_format: Option<PixelFormat>,
    /// Whether to request cursor pseudo-encoding.
    pub local_cursor: bool,
    /// Whether to enable the curtain mode on connect.
    pub curtain_on_connect: bool,
    /// Reconnect on disconnect.
    pub auto_reconnect: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: DEFAULT_ARD_PORT,
            username: String::new(),
            password: String::new(),
            connection_id: String::new(),
            pixel_format: None,
            local_cursor: true,
            curtain_on_connect: false,
            auto_reconnect: true,
        }
    }
}

/// Handle returned to the caller after launching a session.
pub struct SessionHandle {
    /// Unique session identifier.
    pub session_id: String,
    /// Send commands to the running session.
    pub command_tx: mpsc::Sender<ArdCommand>,
    /// Receive status events from the session.
    pub event_rx: mpsc::Receiver<ArdStatusEvent>,
    /// Receive decoded framebuffer rectangles.
    pub frame_rx: mpsc::Receiver<Vec<DecodedRect>>,
    /// Session statistics (atomics — safe to read from any thread).
    pub stats: Arc<ArdSessionStats>,
    /// Tokio join handle for the session task.
    pub join_handle: tokio::task::JoinHandle<()>,
}

/// Launch a new ARD session in a background task.
pub fn launch_session(config: SessionConfig) -> SessionHandle {
    let session_id = Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::channel(COMMAND_CHANNEL_SIZE);
    let (evt_tx, evt_rx) = mpsc::channel(EVENT_CHANNEL_SIZE);
    let (frame_tx, frame_rx) = mpsc::channel(FRAME_CHANNEL_SIZE);

    let stats = Arc::new(ArdSessionStats {
        bytes_sent: AtomicU64::new(0),
        bytes_received: AtomicU64::new(0),
        frames_decoded: AtomicU64::new(0),
        key_events_sent: AtomicU64::new(0),
        pointer_events_sent: AtomicU64::new(0),
    });

    let sid = session_id.clone();
    let st = stats.clone();
    let join_handle = tokio::spawn(async move {
        session_task(sid, config, cmd_rx, evt_tx, frame_tx, st).await;
    });

    SessionHandle {
        session_id,
        command_tx: cmd_tx,
        event_rx: evt_rx,
        frame_rx: frame_rx,
        stats,
        join_handle,
    }
}

/// The main session task — runs until disconnected or shut down.
async fn session_task(
    session_id: String,
    config: SessionConfig,
    mut cmd_rx: mpsc::Receiver<ArdCommand>,
    evt_tx: mpsc::Sender<ArdStatusEvent>,
    frame_tx: mpsc::Sender<Vec<DecodedRect>>,
    stats: Arc<ArdSessionStats>,
) {
    let mut attempt = 0u32;

    loop {
        let _ = evt_tx
            .send(ArdStatusEvent {
                session_id: session_id.clone(),
                status: "connecting".into(),
                message: Some(format!(
                    "Connecting to {}:{}",
                    config.host, config.port
                )),
                timestamp: Utc::now().to_rfc3339(),
            })
            .await;

        match run_session(
            &session_id,
            &config,
            &mut cmd_rx,
            &evt_tx,
            &frame_tx,
            &stats,
        )
        .await
        {
            Ok(()) => {
                // Clean disconnect requested.
                let _ = evt_tx
                    .send(ArdStatusEvent {
                        session_id: session_id.clone(),
                        status: "disconnected".into(),
                        message: Some("Disconnected".into()),
                        timestamp: Utc::now().to_rfc3339(),
                    })
                    .await;
                break;
            }
            Err(e) => {
                log::error!("[ARD {session_id}] Session error: {e}");
                let _ = evt_tx
                    .send(ArdStatusEvent {
                        session_id: session_id.clone(),
                        status: "error".into(),
                        message: Some(format!("{e}")),
                        timestamp: Utc::now().to_rfc3339(),
                    })
                    .await;

                if !config.auto_reconnect || attempt >= MAX_RECONNECT_ATTEMPTS {
                    let _ = evt_tx
                        .send(ArdStatusEvent {
                            session_id: session_id.clone(),
                            status: "disconnected".into(),
                            message: Some("Giving up after max reconnect attempts".into()),
                            timestamp: Utc::now().to_rfc3339(),
                        })
                        .await;
                    break;
                }

                attempt += 1;
                let _ = evt_tx
                    .send(ArdStatusEvent {
                        session_id: session_id.clone(),
                        status: "reconnecting".into(),
                        message: Some(format!(
                            "Reconnecting ({attempt}/{MAX_RECONNECT_ATTEMPTS})…"
                        )),
                        timestamp: Utc::now().to_rfc3339(),
                    })
                    .await;

                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        }
    }
}

/// Single run of a connected session. Returns `Ok(())` for clean disconnect,
/// `Err(e)` on connection loss.
async fn run_session(
    session_id: &str,
    config: &SessionConfig,
    cmd_rx: &mut mpsc::Receiver<ArdCommand>,
    evt_tx: &mpsc::Sender<ArdStatusEvent>,
    frame_tx: &mpsc::Sender<Vec<DecodedRect>>,
    stats: &Arc<ArdSessionStats>,
) -> Result<(), ArdError> {
    // ── TCP connect ──────────────────────────────────────────────────
    let addr = format!("{}:{}", config.host, config.port);
    let stream = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| ArdError::Timeout("TCP connect timed out".into()))?
    .map_err(ArdError::Io)?;

    let std_stream = stream.into_std().map_err(ArdError::Io)?;
    std_stream
        .set_nonblocking(false)
        .map_err(ArdError::Io)?;
    std_stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .ok();

    let mut conn = RfbConnection::new(std_stream);

    // ── RFB handshake ────────────────────────────────────────────────
    let server_version = conn.read_version()?;
    let client_version = match server_version {
        RfbVersion::V3_3 => RfbVersion::V3_3,
        RfbVersion::V3_7 | RfbVersion::V3_8 => RfbVersion::V3_8,
    };
    conn.write_version(&client_version)?;

    log::info!(
        "[ARD {session_id}] RFB version: server={server_version:?}, client={client_version:?}"
    );

    // ── Security negotiation ─────────────────────────────────────────
    let security_type = negotiate_security(&mut conn, &client_version)?;
    log::info!("[ARD {session_id}] Security type: {security_type}");

    // ── Authentication ───────────────────────────────────────────────
    match security_type {
        rfb::security::NONE => {
            auth::auth_none(&mut conn)?;
        }
        rfb::security::VNC_AUTH => {
            auth::auth_vnc(&mut conn, &config.password)?;
        }
        rfb::security::ARD_AUTH => {
            auth::auth_ard(&mut conn, &config.username, &config.password)?;
        }
        other => {
            return Err(ArdError::UnsupportedSecurity(other));
        }
    }

    // Read security result (for versions >= 3.8).
    if matches!(client_version, RfbVersion::V3_8) {
        let result = conn.read_u32()?;
        if result != 0 {
            let reason = read_failure_reason(&mut conn);
            return Err(ArdError::Auth(format!(
                "Authentication failed: {reason}"
            )));
        }
    }

    let _ = evt_tx
        .send(ArdStatusEvent {
            session_id: session_id.into(),
            status: "authenticated".into(),
            message: Some("Authentication successful".into()),
            timestamp: Utc::now().to_rfc3339(),
        })
        .await;

    // ── ClientInit ───────────────────────────────────────────────────
    let shared_flag = 1u8; // Request shared session.
    conn.write_all(&[shared_flag])?;

    // ── ServerInit ───────────────────────────────────────────────────
    let server_init = conn.read_server_init()?;
    log::info!(
        "[ARD {session_id}] Desktop: {}x{} \"{}\"",
        server_init.width,
        server_init.height,
        server_init.name
    );

    // ── Set pixel format ─────────────────────────────────────────────
    let pf = config
        .pixel_format
        .clone()
        .unwrap_or(PixelFormat::ARGB8888);
    conn.send_set_pixel_format(&pf)?;

    // ── Set encodings ────────────────────────────────────────────────
    let encodings = encoding::preferred_encodings();
    conn.send_set_encodings(&encodings)?;

    let _ = evt_tx
        .send(ArdStatusEvent {
            session_id: session_id.into(),
            status: "connected".into(),
            message: Some(format!(
                "Connected to \"{}\" ({}x{})",
                server_init.name, server_init.width, server_init.height
            )),
            timestamp: Utc::now().to_rfc3339(),
        })
        .await;

    // ── Main message loop ────────────────────────────────────────────
    message_loop(
        session_id,
        config,
        &mut conn,
        &server_init,
        &pf,
        cmd_rx,
        evt_tx,
        frame_tx,
        stats,
    )
    .await
}

/// Negotiate security type with the server.
fn negotiate_security(
    conn: &mut RfbConnection,
    version: &RfbVersion,
) -> Result<u8, ArdError> {
    match version {
        RfbVersion::V3_3 => {
            // Server selects security type.
            let sec = conn.read_u32()?;
            Ok(sec as u8)
        }
        _ => {
            // Read list of supported types.
            let n = conn.read_u8()?;
            if n == 0 {
                let reason = read_failure_reason(conn);
                return Err(ArdError::Protocol(format!(
                    "Server rejected connection: {reason}"
                )));
            }
            let mut types = Vec::with_capacity(n as usize);
            for _ in 0..n {
                types.push(conn.read_u8()?);
            }

            // Prefer ARD auth, then VNC, then None.
            let preferred = [
                rfb::security::ARD_AUTH,
                rfb::security::VNC_AUTH,
                rfb::security::NONE,
            ];
            for &pref in &preferred {
                if types.contains(&pref) {
                    conn.write_all(&[pref])?;
                    return Ok(pref);
                }
            }

            Err(ArdError::UnsupportedSecurity(types[0]))
        }
    }
}

/// Read a failure reason string (u32 length-prefixed).
fn read_failure_reason(conn: &mut RfbConnection) -> String {
    match conn.read_u32() {
        Ok(len) => {
            let mut buf = vec![0u8; len as usize];
            if conn.read_exact(&mut buf).is_ok() {
                String::from_utf8_lossy(&buf).into_owned()
            } else {
                "(could not read reason)".into()
            }
        }
        Err(_) => "(no reason provided)".into(),
    }
}

/// The inner message loop: request framebuffer updates, process server
/// messages, and handle commands from the UI.
async fn message_loop(
    session_id: &str,
    _config: &SessionConfig,
    conn: &mut RfbConnection,
    server_init: &ServerInit,
    pixel_format: &PixelFormat,
    cmd_rx: &mut mpsc::Receiver<ArdCommand>,
    evt_tx: &mpsc::Sender<ArdStatusEvent>,
    frame_tx: &mpsc::Sender<Vec<DecodedRect>>,
    stats: &Arc<ArdSessionStats>,
) -> Result<(), ArdError> {
    let mut decoder = EncodingDecoder::new(pixel_format.clone());
    let mut pointer = PointerState::default();
    let mut fb_width = server_init.width;
    let mut fb_height = server_init.height;
    let mut last_clipboard: Option<ClipboardContent> = None;

    // Request initial full framebuffer.
    conn.send_framebuffer_update_request(false, 0, 0, fb_width, fb_height)?;

    let mut fb_timer = tokio::time::interval(FB_REQUEST_INTERVAL);

    loop {
        // We use a non-blocking peek to check for server messages,
        // then check commands from the UI.
        tokio::select! {
            _ = fb_timer.tick() => {
                // Request incremental framebuffer update.
                if let Err(e) = conn.send_framebuffer_update_request(true, 0, 0, fb_width, fb_height) {
                    log::warn!("[ARD {session_id}] FB request error: {e}");
                    return Err(e);
                }

                // Process any pending server messages.
                match process_server_messages(
                    session_id,
                    conn,
                    &mut decoder,
                    &mut fb_width,
                    &mut fb_height,
                    &mut last_clipboard,
                    evt_tx,
                    frame_tx,
                    stats,
                ).await {
                    Ok(true) => {} // Messages processed
                    Ok(false) => {} // No messages
                    Err(e) => {
                        log::warn!("[ARD {session_id}] Server message error: {e}");
                        return Err(e);
                    }
                }
            }

            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(ArdCommand::Shutdown) | None => {
                        log::info!("[ARD {session_id}] Shutdown requested");
                        return Ok(());
                    }

                    Some(ArdCommand::Input(action)) => {
                        handle_input_command(conn, &action, &mut pointer, stats)?;
                    }

                    Some(ArdCommand::SetClipboard { text }) => {
                        let content = ClipboardContent::plain(&text);
                        if let Err(e) = clipboard::send_client_clipboard(conn, &content, true) {
                            log::warn!("[ARD {session_id}] Clipboard send error: {e}");
                        }
                    }

                    Some(ArdCommand::GetClipboard) => {
                        if let Some(ref cb) = last_clipboard {
                            let text = cb.text.clone().unwrap_or_default();
                            let _ = evt_tx.send(ArdStatusEvent {
                                session_id: session_id.into(),
                                status: "clipboard".into(),
                                message: Some(text),
                                timestamp: Utc::now().to_rfc3339(),
                            }).await;
                        }
                    }

                    Some(ArdCommand::SetCurtainMode { enabled }) => {
                        if let Err(e) = send_curtain_mode(conn, enabled) {
                            log::warn!("[ARD {session_id}] Curtain mode error: {e}");
                        }
                    }

                    Some(ArdCommand::UploadFile { local_path, remote_path }) => {
                        if let Err(e) = handle_upload(conn, &local_path, &remote_path, stats, session_id, evt_tx).await {
                            log::warn!("[ARD {session_id}] Upload error: {e}");
                        }
                    }

                    Some(ArdCommand::DownloadFile { remote_path, local_path }) => {
                        if let Err(e) = handle_download(conn, &remote_path, &local_path, stats, session_id, evt_tx).await {
                            log::warn!("[ARD {session_id}] Download error: {e}");
                        }
                    }

                    Some(ArdCommand::ListRemoteDir { path }) => {
                        match handle_list_dir(conn, &path) {
                            Ok(entries) => {
                                if let Ok(json) = serde_json::to_string(&entries) {
                                    let _ = evt_tx.send(ArdStatusEvent {
                                        session_id: session_id.into(),
                                        status: "directory_listing".into(),
                                        message: Some(json),
                                        timestamp: Utc::now().to_rfc3339(),
                                    }).await;
                                }
                            }
                            Err(e) => {
                                log::warn!("[ARD {session_id}] List dir error: {e}");
                            }
                        }
                    }

                    Some(ArdCommand::Reconnect) => {
                        log::info!("[ARD {session_id}] Reconnect requested");
                        return Err(ArdError::Protocol("Reconnect requested".into()));
                    }

                    Some(ArdCommand::AttachViewer) => {
                        // Request full framebuffer update.
                        conn.send_framebuffer_update_request(false, 0, 0, fb_width, fb_height)?;
                    }

                    Some(ArdCommand::DetachViewer) => {
                        // Nothing special needed — stop requesting updates.
                        log::info!("[ARD {session_id}] Viewer detached");
                    }
                }
            }
        }
    }
}

/// Process server messages from the RFB connection.
async fn process_server_messages(
    session_id: &str,
    conn: &mut RfbConnection,
    decoder: &mut EncodingDecoder,
    fb_width: &mut u16,
    fb_height: &mut u16,
    last_clipboard: &mut Option<ClipboardContent>,
    evt_tx: &mpsc::Sender<ArdStatusEvent>,
    frame_tx: &mpsc::Sender<Vec<DecodedRect>>,
    stats: &Arc<ArdSessionStats>,
) -> Result<bool, ArdError> {
    // Peek at the next byte to determine message type.
    let msg_type = match conn.try_read_u8() {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(false), // No data available
        Err(e) => return Err(e),
    };

    match msg_type {
        rfb::server_msg::FRAMEBUFFER_UPDATE => {
            conn.read_u8()?; // padding
            let num_rects = conn.read_u16()?;

            let mut rects = Vec::with_capacity(num_rects as usize);
            for _ in 0..num_rects {
                let header = conn.read_rect_header()?;

                // Check for Apple clipboard pseudo-encoding.
                if header.encoding == rfb::encoding::APPLE_CLIPBOARD {
                    match clipboard::read_server_clipboard(conn) {
                        Ok(content) => {
                            *last_clipboard = Some(content.clone());
                            if let Some(ref text) = content.text {
                                let _ = evt_tx
                                    .send(ArdStatusEvent {
                                        session_id: session_id.into(),
                                        status: "clipboard_update".into(),
                                        message: Some(text.clone()),
                                        timestamp: Utc::now().to_rfc3339(),
                                    })
                                    .await;
                            }
                        }
                        Err(e) => log::warn!("[ARD {session_id}] Clipboard read: {e}"),
                    }
                    continue;
                }

                // Check for desktop resize pseudo-encoding.
                if header.encoding == rfb::encoding::DESKTOP_SIZE {
                    *fb_width = header.width;
                    *fb_height = header.height;
                    let _ = evt_tx
                        .send(ArdStatusEvent {
                            session_id: session_id.into(),
                            status: "desktop_resize".into(),
                            message: Some(format!("{}x{}", header.width, header.height)),
                            timestamp: Utc::now().to_rfc3339(),
                        })
                        .await;
                    continue;
                }

                match decoder.decode_rect(conn, &header) {
                    Ok(rect) => rects.push(rect),
                    Err(e) => {
                        log::warn!(
                            "[ARD {session_id}] Decode rect error (enc=0x{:08x}): {e}",
                            header.encoding
                        );
                    }
                }
            }

            if !rects.is_empty() {
                stats.frames_decoded.fetch_add(1, Ordering::Relaxed);
                let _ = frame_tx.send(rects).await;
            }
        }

        rfb::server_msg::SET_COLOUR_MAP_ENTRIES => {
            // Read and discard colour map entries.
            conn.read_u8()?; // padding
            let _first_colour = conn.read_u16()?;
            let num_colours = conn.read_u16()?;
            for _ in 0..num_colours {
                conn.read_u16()?; // red
                conn.read_u16()?; // green
                conn.read_u16()?; // blue
            }
        }

        rfb::server_msg::BELL => {
            let _ = evt_tx
                .send(ArdStatusEvent {
                    session_id: session_id.into(),
                    status: "bell".into(),
                    message: None,
                    timestamp: Utc::now().to_rfc3339(),
                })
                .await;
        }

        rfb::server_msg::SERVER_CUT_TEXT => {
            conn.read_u8()?; // padding
            conn.read_u8()?;
            conn.read_u8()?;
            let text_len = conn.read_u32()? as usize;
            let mut text_bytes = vec![0u8; text_len];
            conn.read_exact(&mut text_bytes)?;
            let text = String::from_utf8_lossy(&text_bytes).into_owned();
            *last_clipboard = Some(ClipboardContent::plain(&text));
            let _ = evt_tx
                .send(ArdStatusEvent {
                    session_id: session_id.into(),
                    status: "clipboard_update".into(),
                    message: Some(text),
                    timestamp: Utc::now().to_rfc3339(),
                })
                .await;
        }

        unknown => {
            log::warn!("[ARD {session_id}] Unknown server message type: {unknown}");
        }
    }

    Ok(true)
}

/// Handle an input command by dispatching to RFB wire messages.
fn handle_input_command(
    conn: &mut RfbConnection,
    action: &ArdInputAction,
    pointer: &mut PointerState,
    stats: &Arc<ArdSessionStats>,
) -> Result<(), ArdError> {
    match action {
        ArdInputAction::KeyboardKey { .. } => {
            stats.key_events_sent.fetch_add(1, Ordering::Relaxed);
        }
        ArdInputAction::MouseMove { .. }
        | ArdInputAction::MouseButton { .. }
        | ArdInputAction::Scroll { .. } => {
            stats.pointer_events_sent.fetch_add(1, Ordering::Relaxed);
        }
    }
    input::send_input(conn, action, pointer)
}

/// Send a curtain mode toggle to the server.
fn send_curtain_mode(conn: &mut RfbConnection, enabled: bool) -> Result<(), ArdError> {
    // Apple curtain mode is set via a pseudo-encoding request.
    // We send a SetEncodings message including/excluding the curtain encoding.
    let mut encodings = encoding::preferred_encodings();
    if enabled {
        if !encodings.contains(&rfb::encoding::APPLE_CURTAIN) {
            encodings.push(rfb::encoding::APPLE_CURTAIN);
        }
    } else {
        encodings.retain(|&e| e != rfb::encoding::APPLE_CURTAIN);
    }
    conn.send_set_encodings(&encodings)?;
    Ok(())
}

/// Handle a file upload from local path to remote path.
async fn handle_upload(
    conn: &mut RfbConnection,
    local_path: &str,
    remote_path: &str,
    stats: &Arc<ArdSessionStats>,
    session_id: &str,
    evt_tx: &mpsc::Sender<ArdStatusEvent>,
) -> Result<(), ArdError> {
    let data = tokio::fs::read(local_path)
        .await
        .map_err(|e| ArdError::FileTransfer(format!("Read local file: {e}")))?;

    let total = data.len() as u64;
    file_transfer::request_upload(conn, remote_path, total)?;

    // Send in 64 KB chunks.
    let chunk_size = 65536;
    let mut offset = 0usize;
    while offset < data.len() {
        let end = (offset + chunk_size).min(data.len());
        let _is_last = end >= data.len();
        file_transfer::send_upload_chunk(conn, &data[offset..end])?;
        stats
            .bytes_sent
            .fetch_add((end - offset) as u64, Ordering::Relaxed);
        offset = end;
    }

    file_transfer::read_upload_response(conn)?;

    let _ = evt_tx
        .send(ArdStatusEvent {
            session_id: session_id.into(),
            status: "upload_complete".into(),
            message: Some(format!("Uploaded {remote_path} ({total} bytes)")),
            timestamp: Utc::now().to_rfc3339(),
        })
        .await;

    Ok(())
}

/// Handle a file download from remote path to local path.
async fn handle_download(
    conn: &mut RfbConnection,
    remote_path: &str,
    local_path: &str,
    stats: &Arc<ArdSessionStats>,
    session_id: &str,
    evt_tx: &mpsc::Sender<ArdStatusEvent>,
) -> Result<(), ArdError> {
    file_transfer::request_download(conn, remote_path)?;

    let mut file_data = Vec::new();
    loop {
        match file_transfer::read_download_chunk(conn)? {
            file_transfer::DownloadChunk::Data { total_size: _, data } => {
                stats
                    .bytes_received
                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                file_data.extend_from_slice(&data);
            }
            file_transfer::DownloadChunk::Complete => break,
        }
    }

    tokio::fs::write(local_path, &file_data)
        .await
        .map_err(|e| ArdError::FileTransfer(format!("Write local file: {e}")))?;

    let _ = evt_tx
        .send(ArdStatusEvent {
            session_id: session_id.into(),
            status: "download_complete".into(),
            message: Some(format!(
                "Downloaded {remote_path} → {local_path} ({} bytes)",
                file_data.len()
            )),
            timestamp: Utc::now().to_rfc3339(),
        })
        .await;

    Ok(())
}

/// Handle a remote directory listing request.
fn handle_list_dir(
    conn: &mut RfbConnection,
    path: &str,
) -> Result<Vec<file_transfer::RemoteFileEntry>, ArdError> {
    file_transfer::request_list_dir(conn, path)?;
    file_transfer::read_list_dir_response(conn)
}

/// Build an `ArdSession` snapshot from a running session.
pub fn build_session_snapshot(
    session_id: &str,
    config: &SessionConfig,
    server_init: &ServerInit,
    pixel_format: &PixelFormat,
    connected: bool,
) -> ArdSession {
    ArdSession {
        id: session_id.into(),
        connection_id: config.connection_id.clone(),
        host: config.host.clone(),
        port: config.port,
        username: config.username.clone(),
        connected,
        desktop_width: server_init.width,
        desktop_height: server_init.height,
        desktop_name: Some(server_init.name.clone()),
        viewer_attached: true,
        reconnect_attempts: 0,
        max_reconnect_attempts: MAX_RECONNECT_ATTEMPTS,
        capabilities: ArdCapabilities {
            rfb_version: "3.8".into(),
            security_type: rfb::security::ARD_AUTH,
            supports_clipboard: true,
            supports_file_transfer: true,
            supports_curtain_mode: true,
            supports_retina: true,
            pixel_format: pixel_format.label(),
            framebuffer_width: server_init.width,
            framebuffer_height: server_init.height,
            accepted_encodings: encoding::preferred_encodings()
                .iter()
                .map(|e| format!("0x{e:08x}"))
                .collect(),
        },
        curtain_active: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_config_defaults() {
        let cfg = SessionConfig::default();
        assert_eq!(cfg.port, DEFAULT_ARD_PORT);
        assert!(cfg.auto_reconnect);
        assert!(cfg.host.is_empty());
    }

    #[test]
    fn max_reconnect_attempts_value() {
        assert!(MAX_RECONNECT_ATTEMPTS >= 3);
    }

    #[test]
    fn fb_request_interval_reasonable() {
        assert!(FB_REQUEST_INTERVAL.as_millis() >= 16);
        assert!(FB_REQUEST_INTERVAL.as_millis() <= 100);
    }

    #[test]
    fn build_session_snapshot_fields() {
        let config = SessionConfig {
            host: "10.0.0.1".into(),
            port: 5900,
            username: "admin".into(),
            password: "secret".into(),
            connection_id: "conn-1".into(),
            ..Default::default()
        };

        let server_init = ServerInit {
            width: 1920,
            height: 1080,
            pixel_format: PixelFormat::ARGB8888,
            name: "Mac Desktop".into(),
        };

        let snap = build_session_snapshot(
            "sess-123",
            &config,
            &server_init,
            &PixelFormat::ARGB8888,
            true,
        );

        assert_eq!(snap.id, "sess-123");
        assert_eq!(snap.host, "10.0.0.1");
        assert_eq!(snap.desktop_width, 1920);
        assert_eq!(snap.desktop_height, 1080);
        assert!(snap.connected);
        assert!(snap.capabilities.supports_clipboard);
        assert!(snap.capabilities.supports_file_transfer);
    }
}
