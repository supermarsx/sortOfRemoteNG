//! VNC session — async TCP connection, RFB handshake, framebuffer loop.
//!
//! Each `VncSessionHandle` wraps a tokio `TcpStream` and drives the
//! full RFB handshake, then enters a server-message read loop,
//! dispatching framebuffer updates, bell, and clipboard events.

use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Duration};

use crate::vnc::auth;
use crate::vnc::encoding::{
    base64_encode_pixels, decode_copyrect, decode_hextile, decode_raw, decode_rre, DecodedRect,
};
use crate::vnc::protocol;
use crate::vnc::types::*;

/// Commands sent from the service layer to the session task.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send a key event.
    KeyEvent { down: bool, key: u32 },
    /// Send a pointer (mouse) event.
    PointerEvent { button_mask: u8, x: u16, y: u16 },
    /// Send client cut-text (clipboard).
    ClientCutText(String),
    /// Request a full or incremental framebuffer update.
    RequestUpdate { incremental: bool },
    /// Set the client pixel format.
    SetPixelFormat(PixelFormat),
    /// Set preferred encodings.
    SetEncodings(Vec<EncodingType>),
    /// Disconnect gracefully.
    Disconnect,
}

/// Events sent from the session task to the service.
#[derive(Debug)]
pub enum SessionEvent {
    /// Decoded framebuffer rectangle.
    Frame(DecodedRect),
    /// Server sent Bell.
    Bell,
    /// Server sent clipboard text.
    Clipboard(String),
    /// Desktop was resized.
    Resize { width: u16, height: u16 },
    /// Cursor pseudo-encoding update.
    Cursor {
        pixels: Vec<u8>,
        width: u16,
        height: u16,
        hotspot_x: u16,
        hotspot_y: u16,
    },
    /// Session metadata update.
    StateChanged(VncStateEvent),
    /// Session disconnected.
    Disconnected(Option<String>),
    /// Handshake succeeded — contains server init info.
    Connected {
        width: u16,
        height: u16,
        pixel_format: PixelFormat,
        server_name: String,
        protocol_version: String,
        security_type: String,
    },
}

/// State shared between the session task and the service.
#[derive(Debug)]
pub struct SharedSessionState {
    pub connected: bool,
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    pub pixel_format: PixelFormat,
    pub server_name: String,
    pub protocol_version: String,
    pub security_type: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub last_activity: String,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

/// Handle to a running VNC session.
///
/// The session is driven by an async task that communicates via channels.
pub struct VncSessionHandle {
    pub id: String,
    pub config: VncConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

impl VncSessionHandle {
    /// Spawn a new session task that connects and runs the RFB session.
    pub async fn connect(id: String, config: VncConfig) -> Result<Self, VncError> {
        let (cmd_tx, cmd_rx) = mpsc::channel(256);
        let (event_tx, event_rx) = mpsc::channel(512);

        let state = Arc::new(Mutex::new(SharedSessionState {
            connected: false,
            framebuffer_width: 0,
            framebuffer_height: 0,
            pixel_format: config.pixel_format.unwrap_or_default(),
            server_name: String::new(),
            protocol_version: String::new(),
            security_type: String::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: chrono::Utc::now().to_rfc3339(),
        }));

        let addr = format!("{}:{}", config.host, config.port);

        // TCP connect with timeout.
        let stream = timeout(
            Duration::from_secs(config.connect_timeout_secs),
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| VncError::timeout(format!("Connection to {} timed out", addr)))?
        .map_err(VncError::from)?;

        stream.set_nodelay(true).ok();

        let task_state = state.clone();
        let task_config = config.clone();
        let task_id = id.clone();

        tokio::spawn(async move {
            let result = session_task(task_id, task_config, stream, cmd_rx, event_tx.clone(), task_state).await;
            if let Err(e) = result {
                let _ = event_tx
                    .send(SessionEvent::Disconnected(Some(e.message)))
                    .await;
            }
        });

        Ok(Self {
            id,
            config,
            cmd_tx,
            event_rx,
            state,
        })
    }

    /// Send a command to the session task.
    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), VncError> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| VncError::new(VncErrorKind::NotConnected, "Session task is gone"))
    }

    /// Request disconnect.
    pub async fn disconnect(&self) -> Result<(), VncError> {
        self.send_command(SessionCommand::Disconnect).await
    }
}

// ── Session task ────────────────────────────────────────────────────────

/// The main session loop: handshake → server message dispatch.
async fn session_task(
    _id: String,
    config: VncConfig,
    mut stream: TcpStream,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
) -> Result<(), VncError> {
    // ── 1. Version handshake ────────────────────────────────────────

    let mut version_buf = [0u8; 12];
    stream.read_exact(&mut version_buf).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 12;
    }

    let version_str = String::from_utf8_lossy(&version_buf);
    let rfb_version = RfbVersion::from_version_string(&version_str)
        .unwrap_or(RfbVersion::V3_8);

    // Respond with 3.8 (or the server's version if lower).
    let client_version = match rfb_version {
        RfbVersion::V3_3 => b"RFB 003.003\n",
        RfbVersion::V3_7 => b"RFB 003.007\n",
        RfbVersion::V3_8 => RfbVersion::client_version_string(),
    };
    stream.write_all(client_version).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += 12;
        st.protocol_version = rfb_version.to_string();
    }

    // ── 2. Security negotiation ─────────────────────────────────────

    let security_type = match rfb_version {
        RfbVersion::V3_3 => {
            // Server sends a single u32.
            let mut buf = [0u8; 4];
            stream.read_exact(&mut buf).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            let type_num = u32::from_be_bytes(buf);
            SecurityType::from_byte(type_num as u8)
                .ok_or_else(|| VncError::protocol(format!("Unsupported security type: {}", type_num)))?
        }
        _ => {
            // Server sends count + list of security types.
            let mut count_buf = [0u8; 1];
            stream.read_exact(&mut count_buf).await?;
            let count = count_buf[0] as usize;

            if count == 0 {
                // Server sends error reason.
                let mut len_buf = [0u8; 4];
                stream.read_exact(&mut len_buf).await?;
                let len = u32::from_be_bytes(len_buf) as usize;
                let mut reason_buf = vec![0u8; len];
                stream.read_exact(&mut reason_buf).await?;
                let reason = String::from_utf8_lossy(&reason_buf).into_owned();
                return Err(VncError::protocol(format!("Server refused: {}", reason)));
            }

            let mut type_buf = vec![0u8; count];
            stream.read_exact(&mut type_buf).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 1 + count as u64;
            }

            let types: Vec<SecurityType> = protocol::parse_security_types(count as u8, &type_buf)
                .into_iter()
                .filter_map(SecurityType::from_byte)
                .collect();

            let selected = auth::select_security_type(&types)
                .ok_or_else(|| VncError::new(VncErrorKind::AuthUnsupported, "No supported security types"))?;

            // Tell the server our choice.
            stream.write_all(&[selected.to_byte()]).await?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += 1;
            }

            selected
        }
    };

    {
        let mut st = state.lock().await;
        st.security_type = security_type.name().to_string();
    }

    // ── 3. Authentication ───────────────────────────────────────────

    match security_type {
        SecurityType::None => {
            // RFB 3.8 still has a SecurityResult after None auth.
            if rfb_version != RfbVersion::V3_3 {
                let mut result_buf = [0u8; 4];
                stream.read_exact(&mut result_buf).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += 4;
                }
                auth::parse_security_result(&result_buf)?;
            }
        }
        SecurityType::VncAuthentication => {
            let mut challenge = [0u8; 16];
            stream.read_exact(&mut challenge).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 16;
            }

            let password = config.password.as_deref().unwrap_or("");
            let response = auth::handle_vnc_auth(&challenge, password)?;
            stream.write_all(&response).await?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += 16;
            }

            // Read SecurityResult.
            let mut result_buf = [0u8; 4];
            stream.read_exact(&mut result_buf).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            auth::parse_security_result(&result_buf)?;
        }
        SecurityType::AppleRemoteDesktop => {
            // ARD (Diffie-Hellman Authentication, security type 30).
            // Server sends: generator(2) + key_length(2) + prime(key_length) + pub_key(key_length).
            // Read the 4-byte header first to learn key_length.
            let mut ard_header = [0u8; 4];
            stream.read_exact(&mut ard_header).await?;
            let key_length = u16::from_be_bytes([ard_header[2], ard_header[3]]) as usize;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }

            // Read prime + server public key.
            let mut ard_keys = vec![0u8; key_length * 2];
            stream.read_exact(&mut ard_keys).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += (key_length * 2) as u64;
            }

            // Combine into a single buffer for parsing.
            let mut ard_data = Vec::with_capacity(4 + key_length * 2);
            ard_data.extend_from_slice(&ard_header);
            ard_data.extend_from_slice(&ard_keys);

            let params = auth::parse_ard_server_params(&ard_data)?;

            let username = config.username.as_deref().unwrap_or("");
            let password = config.password.as_deref().unwrap_or("");
            let ard_response = auth::handle_ard_auth(&params, username, password)?;

            // Client sends: encrypted_credentials(128) + client_public_key(key_length).
            stream.write_all(&ard_response.encrypted_credentials).await?;
            stream.write_all(&ard_response.client_public_key).await?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += (128 + key_length) as u64;
            }

            // Read SecurityResult.
            let mut result_buf = [0u8; 4];
            stream.read_exact(&mut result_buf).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            auth::parse_security_result(&result_buf)?;
        }
        _ => {
            return Err(VncError::new(
                VncErrorKind::AuthUnsupported,
                format!("Authentication type '{}' is not yet implemented", security_type.name()),
            ));
        }
    }

    // ── 4. ClientInit → ServerInit ──────────────────────────────────

    let client_init = protocol::build_client_init(config.shared);
    stream.write_all(&client_init).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += client_init.len() as u64;
    }

    // ServerInit: 2(w) + 2(h) + 16(pf) + 4(name_len) + name
    let mut si_header = [0u8; 24]; // 2+2+16+4
    stream.read_exact(&mut si_header).await?;
    let name_len = u32::from_be_bytes([si_header[20], si_header[21], si_header[22], si_header[23]]) as usize;
    let mut name_buf = vec![0u8; name_len];
    stream.read_exact(&mut name_buf).await?;

    let fb_width = u16::from_be_bytes([si_header[0], si_header[1]]);
    let fb_height = u16::from_be_bytes([si_header[2], si_header[3]]);
    let server_pf = PixelFormat::from_bytes(
        &si_header[4..20].try_into().map_err(|_| VncError::protocol("Bad PixelFormat in ServerInit"))?,
    );
    let server_name = String::from_utf8_lossy(&name_buf).into_owned();

    // Use the client's preferred pixel format if specified.
    let active_pf = config.pixel_format.unwrap_or(server_pf);

    {
        let mut st = state.lock().await;
        st.bytes_received += 24 + name_len as u64;
        st.connected = true;
        st.framebuffer_width = fb_width;
        st.framebuffer_height = fb_height;
        st.pixel_format = active_pf;
        st.server_name = server_name.clone();
    }

    let _ = event_tx
        .send(SessionEvent::Connected {
            width: fb_width,
            height: fb_height,
            pixel_format: active_pf,
            server_name: server_name.clone(),
            protocol_version: rfb_version.to_string(),
            security_type: security_type.name().to_string(),
        })
        .await;

    // ── 5. Send SetPixelFormat + SetEncodings ───────────────────────

    if config.pixel_format.is_some() {
        let msg = protocol::build_set_pixel_format(&active_pf);
        stream.write_all(&msg).await?;
        let mut st = state.lock().await;
        st.bytes_sent += msg.len() as u64;
    }

    let encodings = protocol::resolve_encodings(&config.encodings, config.local_cursor);
    let enc_msg = protocol::build_set_encodings(&encodings);
    stream.write_all(&enc_msg).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += enc_msg.len() as u64;
    }

    // ── 6. Initial full framebuffer request ─────────────────────────

    let fbr = protocol::build_fb_update_request(false, 0, 0, fb_width, fb_height);
    stream.write_all(&fbr).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += fbr.len() as u64;
    }

    // ── 7. Main event loop ──────────────────────────────────────────

    let update_interval = Duration::from_millis(config.update_interval_ms.max(10));
    let keepalive_interval = if config.keepalive_interval_secs > 0 {
        Some(Duration::from_secs(config.keepalive_interval_secs))
    } else {
        None
    };

    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(Mutex::new(writer));
    let writer_cmd = writer.clone();

    // Periodic full-screen update request.
    let writer_update = writer.clone();
    let state_update = state.clone();
    let _update_task = {
        let fb_w = fb_width;
        let fb_h = fb_height;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(update_interval);
            loop {
                interval.tick().await;
                let fbr = protocol::build_fb_update_request(true, 0, 0, fb_w, fb_h);
                let mut w = writer_update.lock().await;
                if w.write_all(&fbr).await.is_err() {
                    break;
                }
                let mut st = state_update.lock().await;
                st.bytes_sent += fbr.len() as u64;
            }
        })
    };

    // Keepalive task.
    let _keepalive_task = keepalive_interval.map(|interval| {
        let writer_ka = writer.clone();
        let state_ka = state.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(interval);
            loop {
                timer.tick().await;
                let fbr = protocol::build_fb_update_request(true, 0, 0, 1, 1);
                let mut w = writer_ka.lock().await;
                if w.write_all(&fbr).await.is_err() {
                    break;
                }
                let mut st = state_ka.lock().await;
                st.bytes_sent += fbr.len() as u64;
            }
        })
    });

    // Command processing task.
    let cmd_event_tx = event_tx.clone();
    let cmd_state = state.clone();
    let _cmd_task = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                SessionCommand::KeyEvent { down, key } => {
                    if config.view_only {
                        continue;
                    }
                    let msg = protocol::build_key_event(down, key);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&msg).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::PointerEvent { button_mask, x, y } => {
                    if config.view_only {
                        continue;
                    }
                    let msg = protocol::build_pointer_event(button_mask, x, y);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&msg).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::ClientCutText(text) => {
                    let msg = protocol::build_client_cut_text(&text);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&msg).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::RequestUpdate { incremental } => {
                    let st = cmd_state.lock().await;
                    let fbr = protocol::build_fb_update_request(
                        incremental,
                        0,
                        0,
                        st.framebuffer_width,
                        st.framebuffer_height,
                    );
                    drop(st);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&fbr).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += fbr.len() as u64;
                }
                SessionCommand::SetPixelFormat(pf) => {
                    let msg = protocol::build_set_pixel_format(&pf);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&msg).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                    st.pixel_format = pf;
                }
                SessionCommand::SetEncodings(encs) => {
                    let msg = protocol::build_set_encodings(&encs);
                    let mut w = writer_cmd.lock().await;
                    if w.write_all(&msg).await.is_err() {
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::Disconnect => {
                    let _ = cmd_event_tx
                        .send(SessionEvent::Disconnected(None))
                        .await;
                    break;
                }
            }

            let mut st = cmd_state.lock().await;
            st.last_activity = chrono::Utc::now().to_rfc3339();
        }
    });

    // Server message read loop.
    loop {
        let mut msg_type_buf = [0u8; 1];
        match reader.read_exact(&mut msg_type_buf).await {
            Ok(_) => {}
            Err(e) => {
                let _ = event_tx
                    .send(SessionEvent::Disconnected(Some(e.to_string())))
                    .await;
                break;
            }
        }

        {
            let mut st = state.lock().await;
            st.bytes_received += 1;
        }

        let msg_type = ServerMessageType::from_byte(msg_type_buf[0]);

        match msg_type {
            Some(ServerMessageType::FramebufferUpdate) => {
                handle_fb_update(&mut reader, &event_tx, &state).await?;
            }
            Some(ServerMessageType::SetColourMapEntries) => {
                handle_colour_map(&mut reader, &state).await?;
            }
            Some(ServerMessageType::Bell) => {
                let _ = event_tx.send(SessionEvent::Bell).await;
            }
            Some(ServerMessageType::ServerCutText) => {
                handle_cut_text(&mut reader, &event_tx, &state).await?;
            }
            None => {
                // Unknown message type — try to skip.
                log::warn!("Unknown server message type: {}", msg_type_buf[0]);
            }
        }

        {
            let mut st = state.lock().await;
            st.last_activity = chrono::Utc::now().to_rfc3339();
        }
    }

    {
        let mut st = state.lock().await;
        st.connected = false;
    }

    Ok(())
}

// ── Message handlers ────────────────────────────────────────────────────

async fn handle_fb_update(
    reader: &mut (impl AsyncReadExt + Unpin),
    event_tx: &mpsc::Sender<SessionEvent>,
    state: &SharedState,
) -> Result<(), VncError> {
    // 1 byte padding + 2 bytes rect count
    let mut header = [0u8; 3];
    reader.read_exact(&mut header).await?;
    let num_rects = u16::from_be_bytes([header[1], header[2]]) as usize;

    {
        let mut st = state.lock().await;
        st.bytes_received += 3;
    }

    let pixel_format = {
        let st = state.lock().await;
        st.pixel_format
    };

    for _ in 0..num_rects {
        // Rect header: x(2) + y(2) + w(2) + h(2) + encoding(4) = 12 bytes
        let mut rect_header = [0u8; 12];
        reader.read_exact(&mut rect_header).await?;
        {
            let mut st = state.lock().await;
            st.bytes_received += 12;
        }

        let x = u16::from_be_bytes([rect_header[0], rect_header[1]]);
        let y = u16::from_be_bytes([rect_header[2], rect_header[3]]);
        let w = u16::from_be_bytes([rect_header[4], rect_header[5]]);
        let h = u16::from_be_bytes([rect_header[6], rect_header[7]]);
        let enc_val = i32::from_be_bytes([rect_header[8], rect_header[9], rect_header[10], rect_header[11]]);
        let encoding = EncodingType::from_i32(enc_val);

        match encoding {
            EncodingType::Raw => {
                let bpp = pixel_format.bytes_per_pixel();
                let data_len = w as usize * h as usize * bpp;
                let mut data = vec![0u8; data_len];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += data_len as u64;
                    st.frame_count += 1;
                }
                if let Ok(decoded) = decode_raw(x, y, w, h, &data, &pixel_format) {
                    let _ = event_tx.send(SessionEvent::Frame(decoded)).await;
                }
            }
            EncodingType::CopyRect => {
                let mut data = [0u8; 4];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += 4;
                    st.frame_count += 1;
                }
                if let Ok((_src_x, _src_y)) = decode_copyrect(&data) {
                    // CopyRect is handled at the framebuffer level.
                    // The frontend needs to copy from src to dest.
                    let decoded = DecodedRect {
                        x,
                        y,
                        width: w,
                        height: h,
                        pixels: Vec::new(), // Empty = CopyRect.
                    };
                    let _ = event_tx.send(SessionEvent::Frame(decoded)).await;
                }
            }
            EncodingType::RRE => {
                // Read subrect count + background pixel to determine total size.
                let bpp = pixel_format.bytes_per_pixel();
                let mut header_data = vec![0u8; 4 + bpp];
                reader.read_exact(&mut header_data).await?;
                let num_sub = u32::from_be_bytes([header_data[0], header_data[1], header_data[2], header_data[3]]) as usize;
                let subrect_size = bpp + 8;
                let remaining = num_sub * subrect_size;
                let mut sub_data = vec![0u8; remaining];
                reader.read_exact(&mut sub_data).await?;

                let mut full_data = header_data;
                full_data.extend_from_slice(&sub_data);
                {
                    let mut st = state.lock().await;
                    st.bytes_received += full_data.len() as u64;
                    st.frame_count += 1;
                }

                if let Ok(decoded) = decode_rre(x, y, w, h, &full_data, &pixel_format) {
                    let _ = event_tx.send(SessionEvent::Frame(decoded)).await;
                }
            }
            EncodingType::Hextile => {
                // Hextile is variable-length; we need to read tile by tile.
                // For simplicity, we read a generous buffer and decode.
                let max_possible = w as usize * h as usize * pixel_format.bytes_per_pixel() + 1024;
                let mut data = Vec::with_capacity(max_possible);
                // Read raw data into a buffer until we can decode.
                // Since Hextile is tricky with variable-length tiles,
                // we read tile-by-tile from the stream.
                read_hextile_data(reader, &mut data, w, h, &pixel_format, state).await?;

                if let Ok(decoded) = decode_hextile(x, y, w, h, &data, &pixel_format) {
                    {
                        let mut st = state.lock().await;
                        st.frame_count += 1;
                    }
                    let _ = event_tx.send(SessionEvent::Frame(decoded)).await;
                }
            }
            EncodingType::CursorPseudo => {
                // Cursor pseudo-encoding: pixel data + bitmask.
                let bpp = pixel_format.bytes_per_pixel();
                let pixel_len = w as usize * h as usize * bpp;
                let mask_len = ((w as usize + 7) / 8) * h as usize;
                let total = pixel_len + mask_len;
                let mut data = vec![0u8; total];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += total as u64;
                }

                // Convert cursor pixels to RGBA.
                let pixels = crate::vnc::encoding::convert_to_rgba(&data[..pixel_len], &pixel_format);
                let _ = event_tx
                    .send(SessionEvent::Cursor {
                        pixels,
                        width: w,
                        height: h,
                        hotspot_x: x,
                        hotspot_y: y,
                    })
                    .await;
            }
            EncodingType::DesktopSizePseudo => {
                // No data to read — just means the framebuffer was resized.
                {
                    let mut st = state.lock().await;
                    st.framebuffer_width = w;
                    st.framebuffer_height = h;
                }
                let _ = event_tx
                    .send(SessionEvent::Resize { width: w, height: h })
                    .await;
            }
            EncodingType::LastRectPseudo => {
                // This indicates the last rectangle in the update.
                break;
            }
            _ => {
                // Skip unknown encodings — read raw data size if Raw-compatible.
                let skip_size = w as usize * h as usize * pixel_format.bytes_per_pixel();
                if skip_size > 0 && skip_size < 64 * 1024 * 1024 {
                    let mut skip_buf = vec![0u8; skip_size];
                    reader.read_exact(&mut skip_buf).await?;
                    let mut st = state.lock().await;
                    st.bytes_received += skip_size as u64;
                }
            }
        }
    }

    Ok(())
}

/// Read Hextile-encoded data from the stream tile by tile.
async fn read_hextile_data(
    reader: &mut (impl AsyncReadExt + Unpin),
    data: &mut Vec<u8>,
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
    state: &SharedState,
) -> Result<(), VncError> {
    let bpp = pixel_format.bytes_per_pixel();
    let w = width as usize;
    let h = height as usize;
    let tiles_x = (w + 15) / 16;
    let tiles_y = (h + 15) / 16;

    const RAW: u8 = 1;
    const BG_SPECIFIED: u8 = 2;
    const FG_SPECIFIED: u8 = 4;
    const ANY_SUBRECTS: u8 = 8;
    const SUBRECTS_COLOURED: u8 = 16;

    for _ty in 0..tiles_y {
        for _tx in 0..tiles_x {
            let tile_w = std::cmp::min(16, w - _tx * 16);
            let tile_h = std::cmp::min(16, h - _ty * 16);

            // Read sub-encoding byte.
            let mut flag_buf = [0u8; 1];
            reader.read_exact(&mut flag_buf).await?;
            data.push(flag_buf[0]);
            let flags = flag_buf[0];

            let mut tile_bytes = 0u64;

            if flags & RAW != 0 {
                let raw_size = tile_w * tile_h * bpp;
                let start = data.len();
                data.resize(start + raw_size, 0);
                reader.read_exact(&mut data[start..]).await?;
                tile_bytes += raw_size as u64;
            } else {
                if flags & BG_SPECIFIED != 0 {
                    let start = data.len();
                    data.resize(start + bpp, 0);
                    reader.read_exact(&mut data[start..]).await?;
                    tile_bytes += bpp as u64;
                }
                if flags & FG_SPECIFIED != 0 {
                    let start = data.len();
                    data.resize(start + bpp, 0);
                    reader.read_exact(&mut data[start..]).await?;
                    tile_bytes += bpp as u64;
                }
                if flags & ANY_SUBRECTS != 0 {
                    let mut count_buf = [0u8; 1];
                    reader.read_exact(&mut count_buf).await?;
                    data.push(count_buf[0]);
                    tile_bytes += 1;

                    let num_subrects = count_buf[0] as usize;
                    for _ in 0..num_subrects {
                        if flags & SUBRECTS_COLOURED != 0 {
                            let start = data.len();
                            data.resize(start + bpp, 0);
                            reader.read_exact(&mut data[start..]).await?;
                            tile_bytes += bpp as u64;
                        }
                        // xy + wh (2 bytes).
                        let start = data.len();
                        data.resize(start + 2, 0);
                        reader.read_exact(&mut data[start..]).await?;
                        tile_bytes += 2;
                    }
                }
            }

            {
                let mut st = state.lock().await;
                st.bytes_received += 1 + tile_bytes;
            }
        }
    }

    Ok(())
}

async fn handle_colour_map(
    reader: &mut (impl AsyncReadExt + Unpin),
    state: &SharedState,
) -> Result<(), VncError> {
    // Header: 1 byte padding + 2 bytes first_colour + 2 bytes num_colours
    let mut header = [0u8; 5];
    reader.read_exact(&mut header).await?;
    let num_colours = u16::from_be_bytes([header[3], header[4]]) as usize;
    // Each colour entry is 6 bytes (R, G, B each 2 bytes).
    let data_len = num_colours * 6;
    let mut data = vec![0u8; data_len];
    reader.read_exact(&mut data).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 5 + data_len as u64;
    }
    Ok(())
}

async fn handle_cut_text(
    reader: &mut (impl AsyncReadExt + Unpin),
    event_tx: &mpsc::Sender<SessionEvent>,
    state: &SharedState,
) -> Result<(), VncError> {
    // 3 bytes padding + 4 bytes length.
    let mut header = [0u8; 7];
    reader.read_exact(&mut header).await?;
    let text_len = u32::from_be_bytes([header[3], header[4], header[5], header[6]]) as usize;
    let mut text_buf = vec![0u8; text_len];
    reader.read_exact(&mut text_buf).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 7 + text_len as u64;
    }
    let text = String::from_utf8_lossy(&text_buf).into_owned();
    let _ = event_tx.send(SessionEvent::Clipboard(text)).await;
    Ok(())
}

// ── Utility function for event payload construction ─────────────────────

/// Build a `VncFrameEvent` from a decoded rect for Tauri event emission.
pub fn frame_to_event(session_id: &str, rect: &DecodedRect) -> VncFrameEvent {
    VncFrameEvent {
        session_id: session_id.to_string(),
        data: base64_encode_pixels(&rect.pixels),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── SessionCommand ──────────────────────────────────────────────

    #[test]
    fn session_command_disconnect_variant() {
        let cmd = SessionCommand::Disconnect;
        assert!(matches!(cmd, SessionCommand::Disconnect));
    }

    #[test]
    fn session_command_key_event() {
        let cmd = SessionCommand::KeyEvent {
            down: true,
            key: keysym::RETURN,
        };
        assert!(matches!(cmd, SessionCommand::KeyEvent { down: true, .. }));
    }

    #[test]
    fn session_command_pointer_event() {
        let cmd = SessionCommand::PointerEvent {
            button_mask: mouse_button::LEFT,
            x: 100,
            y: 200,
        };
        assert!(matches!(cmd, SessionCommand::PointerEvent { .. }));
    }

    #[test]
    fn session_command_cut_text() {
        let cmd = SessionCommand::ClientCutText("hello".into());
        assert!(matches!(cmd, SessionCommand::ClientCutText(_)));
    }

    #[test]
    fn session_command_request_update() {
        let cmd = SessionCommand::RequestUpdate { incremental: true };
        assert!(matches!(
            cmd,
            SessionCommand::RequestUpdate { incremental: true }
        ));
    }

    #[test]
    fn session_command_set_pixel_format() {
        let cmd = SessionCommand::SetPixelFormat(PixelFormat::rgba32());
        assert!(matches!(cmd, SessionCommand::SetPixelFormat(_)));
    }

    #[test]
    fn session_command_set_encodings() {
        let cmd = SessionCommand::SetEncodings(vec![EncodingType::Raw]);
        assert!(matches!(cmd, SessionCommand::SetEncodings(_)));
    }

    // ── SessionEvent ────────────────────────────────────────────────

    #[test]
    fn session_event_bell() {
        let ev = SessionEvent::Bell;
        assert!(matches!(ev, SessionEvent::Bell));
    }

    #[test]
    fn session_event_clipboard() {
        let ev = SessionEvent::Clipboard("test".into());
        assert!(matches!(ev, SessionEvent::Clipboard(_)));
    }

    #[test]
    fn session_event_resize() {
        let ev = SessionEvent::Resize {
            width: 1920,
            height: 1080,
        };
        assert!(matches!(ev, SessionEvent::Resize { width: 1920, .. }));
    }

    #[test]
    fn session_event_disconnected() {
        let ev = SessionEvent::Disconnected(Some("error".into()));
        assert!(matches!(ev, SessionEvent::Disconnected(Some(_))));
    }

    #[test]
    fn session_event_connected() {
        let ev = SessionEvent::Connected {
            width: 1024,
            height: 768,
            pixel_format: PixelFormat::rgba32(),
            server_name: "Desktop".into(),
            protocol_version: "3.8".into(),
            security_type: "None".into(),
        };
        assert!(matches!(ev, SessionEvent::Connected { width: 1024, .. }));
    }

    #[test]
    fn session_event_cursor() {
        let ev = SessionEvent::Cursor {
            pixels: vec![255; 16],
            width: 2,
            height: 2,
            hotspot_x: 0,
            hotspot_y: 0,
        };
        assert!(matches!(ev, SessionEvent::Cursor { .. }));
    }

    // ── SharedSessionState ──────────────────────────────────────────

    #[test]
    fn shared_state_defaults() {
        let st = SharedSessionState {
            connected: false,
            framebuffer_width: 0,
            framebuffer_height: 0,
            pixel_format: PixelFormat::rgba32(),
            server_name: String::new(),
            protocol_version: String::new(),
            security_type: String::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
        };
        assert!(!st.connected);
        assert_eq!(st.framebuffer_width, 0);
    }

    // ── frame_to_event ──────────────────────────────────────────────

    #[test]
    fn frame_to_event_basic() {
        let rect = DecodedRect {
            x: 10,
            y: 20,
            width: 2,
            height: 2,
            pixels: vec![0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255],
        };
        let ev = frame_to_event("sess1", &rect);
        assert_eq!(ev.session_id, "sess1");
        assert_eq!(ev.x, 10);
        assert_eq!(ev.y, 20);
        assert_eq!(ev.width, 2);
        assert_eq!(ev.height, 2);
        assert!(!ev.data.is_empty());
    }

    #[test]
    fn frame_to_event_empty_pixels() {
        let rect = DecodedRect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            pixels: Vec::new(),
        };
        let ev = frame_to_event("s2", &rect);
        assert_eq!(ev.data, "");
    }
}
