use std::collections::HashMap;
use std::io::{self};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use ironrdp::connector::{self, ClientConnector, ConnectionResult, Credentials};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp_blocking::{self, Framed};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub type RdpServiceState = Arc<Mutex<RdpService>>;

// ─── Events emitted to the frontend ────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct RdpFrameEvent {
    pub session_id: String,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// Base64-encoded RGBA pixel data for the dirty region
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct RdpStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_height: Option<u16>,
}

#[derive(Clone, Serialize)]
pub struct RdpPointerEvent {
    pub session_id: String,
    pub pointer_type: String, // "default", "hidden", "position", "bitmap"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<u16>,
}

// ─── Input events from the frontend ────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum RdpInputAction {
    MouseMove { x: u16, y: u16 },
    MouseButton { x: u16, y: u16, button: u8, pressed: bool },
    KeyboardKey { scancode: u16, pressed: bool, extended: bool },
    Wheel { x: u16, y: u16, delta: i16, horizontal: bool },
    Unicode { code: u16, pressed: bool },
}

// ─── Session and service types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub desktop_width: u16,
    pub desktop_height: u16,
}

enum RdpCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
}

struct RdpActiveConnection {
    session: RdpSession,
    cmd_tx: mpsc::UnboundedSender<RdpCommand>,
    _handle: tokio::task::JoinHandle<()>,
}

pub struct RdpService {
    connections: HashMap<String, RdpActiveConnection>,
}

impl RdpService {
    pub fn new() -> RdpServiceState {
        Arc::new(Mutex::new(RdpService {
            connections: HashMap::new(),
        }))
    }
}

// ─── Network client for CredSSP HTTP requests ──────────────────────────────

/// A minimal blocking NetworkClient using reqwest for CredSSP/Kerberos KDC
/// communication during NLA authentication.
struct BlockingNetworkClient {
    client: reqwest::blocking::Client,
}

impl BlockingNetworkClient {
    fn new() -> Self {
        Self {
            client: reqwest::blocking::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::blocking::Client::new()),
        }
    }
}

impl ironrdp::connector::sspi::network_client::NetworkClient for BlockingNetworkClient {
    fn send(
        &self,
        request: &ironrdp::connector::sspi::generator::NetworkRequest,
    ) -> ironrdp::connector::sspi::Result<Vec<u8>> {
        use ironrdp::connector::sspi::network_client::NetworkProtocol;

        let url = request.url.to_string();
        let data = request.data.clone();

        let response_bytes = match request.protocol {
            NetworkProtocol::Http | NetworkProtocol::Https => {
                let resp = self.client.post(&url)
                    .body(data)
                    .send()
                    .map_err(|e| {
                        ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::InternalError,
                            format!("HTTP request failed: {e}"),
                        )
                    })?;
                resp.bytes()
                    .map_err(|e| {
                        ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::InternalError,
                            format!("Failed to read response body: {e}"),
                        )
                    })?
                    .to_vec()
            }
            _ => {
                return Err(ironrdp::connector::sspi::Error::new(
                    ironrdp::connector::sspi::ErrorKind::InternalError,
                    format!("Unsupported protocol: {:?}", request.protocol),
                ));
            }
        };

        Ok(response_bytes)
    }
}

// ─── TLS upgrade helper ────────────────────────────────────────────────────

/// Performs TLS upgrade on a TCP stream and extracts the server public key
/// from the peer certificate (needed for CredSSP/NLA authentication).
fn tls_upgrade(
    stream: TcpStream,
    server_name: &str,
    leftover: ::bytes::BytesMut,
) -> Result<
    (Framed<native_tls::TlsStream<TcpStream>>, Vec<u8>),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let tls_connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .use_sni(false)
        .build()
        .map_err(|e| format!("TLS connector build error: {e}"))?;

    let tls_stream = tls_connector
        .connect(server_name, stream)
        .map_err(|e| format!("TLS handshake failed: {e}"))?;

    // Extract server public key from peer certificate
    let server_public_key = extract_server_public_key(&tls_stream)?;

    let framed = Framed::new_with_leftover(tls_stream, leftover);
    Ok((framed, server_public_key))
}

/// Extracts the SubjectPublicKeyInfo from the peer certificate.
fn extract_server_public_key(
    tls_stream: &native_tls::TlsStream<TcpStream>,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    use x509_cert::der::Decode;

    let peer_cert = tls_stream
        .peer_certificate()
        .map_err(|e| format!("Failed to get peer certificate: {e}"))?
        .ok_or("Peer certificate is missing")?;

    let der = peer_cert
        .to_der()
        .map_err(|e| format!("Failed to convert certificate to DER: {e}"))?;

    let cert = x509_cert::Certificate::from_der(&der)
        .map_err(|e| format!("Failed to parse X.509 certificate: {e}"))?;

    let spki_bytes = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .ok_or("No public key bytes in certificate")?
        .to_vec();

    Ok(spki_bytes)
}

// ─── Convert frontend input to IronRDP FastPathInputEvent ──────────────────

fn convert_input(action: &RdpInputAction) -> Vec<FastPathInputEvent> {
    use ironrdp::pdu::input::fast_path::KeyboardFlags;
    use ironrdp::pdu::input::mouse::PointerFlags;
    use ironrdp::pdu::input::mouse_x::PointerXFlags;
    use ironrdp::pdu::input::{MousePdu, MouseXPdu};

    match action {
        RdpInputAction::MouseMove { x, y } => {
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::MOVE,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::MouseButton {
            x,
            y,
            button,
            pressed,
        } => {
            let (_is_extended, flags) = match button {
                0 => (false, PointerFlags::LEFT_BUTTON),
                1 => (false, PointerFlags::MIDDLE_BUTTON_OR_WHEEL),
                2 => (false, PointerFlags::RIGHT_BUTTON),
                3 => return vec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                    flags: if *pressed { PointerXFlags::DOWN | PointerXFlags::BUTTON1 } else { PointerXFlags::BUTTON1 },
                    x_position: *x,
                    y_position: *y,
                })],
                4 => return vec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                    flags: if *pressed { PointerXFlags::DOWN | PointerXFlags::BUTTON2 } else { PointerXFlags::BUTTON2 },
                    x_position: *x,
                    y_position: *y,
                })],
                _ => (false, PointerFlags::LEFT_BUTTON),
            };
            let mouse_flags = if *pressed { PointerFlags::DOWN | flags } else { flags };
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: mouse_flags,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::Wheel {
            x: _,
            y: _,
            delta,
            horizontal,
        } => {
            let flags = if *horizontal {
                PointerFlags::HORIZONTAL_WHEEL
            } else {
                PointerFlags::VERTICAL_WHEEL
            };
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: *delta,
                x_position: 0,
                y_position: 0,
            })]
        }
        RdpInputAction::KeyboardKey {
            scancode,
            pressed,
            extended,
        } => {
            let mut flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            if *extended {
                flags |= KeyboardFlags::EXTENDED;
            }
            vec![FastPathInputEvent::KeyboardEvent(flags, *scancode as u8)]
        }
        RdpInputAction::Unicode { code, pressed } => {
            let flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            vec![FastPathInputEvent::UnicodeKeyboardEvent(flags, *code)]
        }
    }
}

// ─── Blocking RDP session runner ───────────────────────────────────────────

/// Runs the entire RDP session lifecycle on a blocking thread:
/// TCP → TLS → IronRDP Connector → Active Session with frame streaming.
fn run_rdp_session(
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: u16,
    height: u16,
    app_handle: AppHandle,
    mut cmd_rx: mpsc::UnboundedReceiver<RdpCommand>,
) {
    let result = run_rdp_session_inner(
        &session_id,
        &host,
        port,
        &username,
        &password,
        domain.as_deref(),
        width,
        height,
        &app_handle,
        &mut cmd_rx,
    );

    match result {
        Ok(()) => {
            log::info!("RDP session {session_id} ended normally");
        }
        Err(e) => {
            log::error!("RDP session {session_id} error: {e}");
            let _ = app_handle.emit(
                "rdp://status",
                RdpStatusEvent {
                    session_id: session_id.clone(),
                    status: "error".to_string(),
                    message: format!("{e}"),
                    desktop_width: None,
                    desktop_height: None,
                },
            );
        }
    }

    let _ = app_handle.emit(
        "rdp://status",
        RdpStatusEvent {
            session_id,
            status: "disconnected".to_string(),
            message: "Session ended".to_string(),
            desktop_width: None,
            desktop_height: None,
        },
    );
}

fn run_rdp_session_inner(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    width: u16,
    height: u16,
    app_handle: &AppHandle,
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // ── 1. TCP connect ──────────────────────────────────────────────────

    let addr = format!("{host}:{port}");
    log::info!("RDP session {session_id}: connecting to {addr}");

    let _ = app_handle.emit(
        "rdp://status",
        RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: format!("Connecting to {addr}..."),
            desktop_width: None,
            desktop_height: None,
        },
    );

    let tcp_stream = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("Invalid address: {e}"))?,
        Duration::from_secs(15),
    )?;
    tcp_stream.set_nodelay(true)?;

    let mut framed = Framed::new(tcp_stream);

    // ── 2. Build IronRDP connector config ───────────────────────────────

    let config = connector::Config {
        credentials: Credentials::UsernamePassword {
            username: username.to_string(),
            password: password.to_string(),
        },
        domain: domain.map(String::from),
        enable_tls: true,
        enable_credssp: true,
        keyboard_type: ironrdp::pdu::gcc::KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_functional_keys_count: 12,
        keyboard_layout: 0x0409, // US English
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width, height },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: true,
            color_depth: 32,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: 0,
        client_name: String::from("SortOfRemoteNG"),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: false,
        enable_audio_playback: true,
        performance_flags: ironrdp::pdu::rdp::client_info::PerformanceFlags::empty(),
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: true,
        pointer_software_rendering: true,
    };

    let server_addr = std::net::SocketAddr::new(
        addr.parse::<std::net::SocketAddr>()
            .map(|a| a.ip())
            .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)),
        port,
    );

    let mut connector = ClientConnector::new(config, server_addr);

    // ── 3. Connection begin (pre-TLS phase) ─────────────────────────────

    log::info!("RDP session {session_id}: starting connection sequence");
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .map_err(|e| format!("connect_begin failed: {e}"))?;

    // ── 4. TLS upgrade ──────────────────────────────────────────────────

    log::info!("RDP session {session_id}: upgrading to TLS");

    let (tcp_stream, leftover) = framed.into_inner();

    let (mut tls_framed, server_public_key) = tls_upgrade(tcp_stream, host, leftover)?;

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

    // ── 5. Finalize connection (CredSSP / NLA + remaining handshake) ────

    log::info!("RDP session {session_id}: finalizing connection (CredSSP/NLA)");

    let _ = app_handle.emit(
        "rdp://status",
        RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: "Authenticating...".to_string(),
            desktop_width: None,
            desktop_height: None,
        },
    );

    let mut network_client = BlockingNetworkClient::new();
    let server_name = ironrdp::connector::ServerName::new(host);

    let connection_result: ConnectionResult = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut tls_framed,
        &mut network_client,
        server_name,
        server_public_key,
        None, // kerberos_config
    )
    .map_err(|e| format!("connect_finalize failed: {e}"))?;

    // ── 6. Enter active session ─────────────────────────────────────────

    let desktop_width = connection_result.desktop_size.width;
    let desktop_height = connection_result.desktop_size.height;

    log::info!(
        "RDP session {session_id}: connected! Desktop: {desktop_width}x{desktop_height}"
    );

    let _ = app_handle.emit(
        "rdp://status",
        RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connected".to_string(),
            message: format!("Connected ({desktop_width}x{desktop_height})"),
            desktop_width: Some(desktop_width),
            desktop_height: Some(desktop_height),
        },
    );

    let mut image = DecodedImage::new(PixelFormat::RgbA32, desktop_width, desktop_height);
    let mut active_stage = ActiveStage::new(connection_result);

    // Set a short read timeout so we can interleave input handling
    if let Some(inner_stream) = get_inner_tcp(&tls_framed) {
        let _ = inner_stream.set_read_timeout(Some(Duration::from_millis(50)));
    }

    // ── 7. Main session loop ────────────────────────────────────────────

    let b64 = base64::engine::general_purpose::STANDARD;
    let mut frame_counter: u64 = 0;

    loop {
        // Check for commands from the frontend (non-blocking)
        match cmd_rx.try_recv() {
            Ok(RdpCommand::Shutdown) => {
                log::info!("RDP session {session_id}: shutdown requested");
                break;
            }
            Ok(RdpCommand::Input(events)) => {
                // Process input and send to server
                match active_stage.process_fastpath_input(&mut image, &events) {
                    Ok(outputs) => {
                        for output in outputs {
                            match output {
                                ActiveStageOutput::ResponseFrame(data) => {
                                    if let Err(e) = tls_framed.write_all(&data) {
                                        log::error!("RDP {session_id}: failed to send input: {e}");
                                        break;
                                    }
                                }
                                ActiveStageOutput::GraphicsUpdate(_) => {}
                                _ => {}
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("RDP {session_id}: input processing error: {e}");
                    }
                }
            }
            Err(mpsc::error::TryRecvError::Empty) => {}
            Err(mpsc::error::TryRecvError::Disconnected) => {
                log::info!("RDP session {session_id}: command channel closed");
                break;
            }
        }

        // Try to read an RDP PDU
        let pdu_result = tls_framed.read_pdu();
        match pdu_result {
            Ok((action, payload)) => {
                // Process PDU through the active stage
                let outputs = active_stage
                    .process(&mut image, action, payload.as_ref())
                    .map_err(|e| format!("Session process error: {e}"))?;

                for output in outputs {
                    match output {
                        ActiveStageOutput::ResponseFrame(data) => {
                            tls_framed
                                .write_all(&data)
                                .map_err(|e| format!("Failed to send response frame: {e}"))?;
                        }
                        ActiveStageOutput::GraphicsUpdate(region) => {
                            frame_counter += 1;
                            // Extract the dirty region pixel data from the framebuffer
                            let region_data = extract_region_rgba(
                                image.data(),
                                desktop_width,
                                &region,
                            );

                            let encoded = b64.encode(&region_data);

                            let _ = app_handle.emit(
                                "rdp://frame",
                                RdpFrameEvent {
                                    session_id: session_id.to_string(),
                                    x: region.left,
                                    y: region.top,
                                    width: region.right.saturating_sub(region.left) + 1,
                                    height: region.bottom.saturating_sub(region.top) + 1,
                                    data: encoded,
                                },
                            );

                            // Send full frame periodically for sync
                            if frame_counter % 120 == 0 {
                                send_full_frame(
                                    session_id,
                                    &image,
                                    desktop_width,
                                    desktop_height,
                                    app_handle,
                                    &b64,
                                );
                            }
                        }
                        ActiveStageOutput::PointerDefault => {
                            let _ = app_handle.emit(
                                "rdp://pointer",
                                RdpPointerEvent {
                                    session_id: session_id.to_string(),
                                    pointer_type: "default".to_string(),
                                    x: None,
                                    y: None,
                                },
                            );
                        }
                        ActiveStageOutput::PointerHidden => {
                            let _ = app_handle.emit(
                                "rdp://pointer",
                                RdpPointerEvent {
                                    session_id: session_id.to_string(),
                                    pointer_type: "hidden".to_string(),
                                    x: None,
                                    y: None,
                                },
                            );
                        }
                        ActiveStageOutput::PointerPosition { x, y } => {
                            let _ = app_handle.emit(
                                "rdp://pointer",
                                RdpPointerEvent {
                                    session_id: session_id.to_string(),
                                    pointer_type: "position".to_string(),
                                    x: Some(x),
                                    y: Some(y),
                                },
                            );
                        }
                        ActiveStageOutput::PointerBitmap(_bitmap) => {
                            // TODO: send custom cursor bitmap to frontend
                        }
                        ActiveStageOutput::Terminate(reason) => {
                            log::info!("RDP session {session_id}: server terminated session: {reason}");
                            break;
                        }
                        ActiveStageOutput::DeactivateAll(_connection_activation) => {
                            log::info!(
                                "RDP session {session_id}: deactivate-all received"
                            );
                            let _ = app_handle.emit(
                                "rdp://status",
                                RdpStatusEvent {
                                    session_id: session_id.to_string(),
                                    status: "connected".to_string(),
                                    message: format!("Deactivate-all received ({desktop_width}x{desktop_height})"),
                                    desktop_width: Some(desktop_width),
                                    desktop_height: Some(desktop_height),
                                },
                            );
                        }
                    }
                }
            }
            Err(e) if is_timeout_error(&e) => {
                // Read timeout — no data available, loop around to handle input
                continue;
            }
            Err(e) => {
                log::error!("RDP session {session_id}: read error: {e}");
                break;
            }
        }
    }

    Ok(())
}

// ─── Helper functions ──────────────────────────────────────────────────────

fn is_timeout_error(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

/// Extracts RGBA pixel data for a rectangular region from the full framebuffer.
/// The DecodedImage stores pixel data as u32 (RGBA packed).
fn extract_region_rgba(
    framebuffer: &[u8],
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
) -> Vec<u8> {
    let bytes_per_pixel = 4usize; // RGBA32
    let stride = fb_width as usize * bytes_per_pixel;
    let left = region.left as usize;
    let top = region.top as usize;
    let right = region.right as usize;
    let bottom = region.bottom as usize;
    let region_w = right.saturating_sub(left) + 1;
    let region_h = bottom.saturating_sub(top) + 1;

    let mut rgba = Vec::with_capacity(region_w * region_h * bytes_per_pixel);

    for row in top..=bottom {
        let row_start = row * stride + left * bytes_per_pixel;
        let row_end = row_start + region_w * bytes_per_pixel;
        if row_end > framebuffer.len() {
            break;
        }
        rgba.extend_from_slice(&framebuffer[row_start..row_end]);
    }

    rgba
}

fn send_full_frame(
    session_id: &str,
    image: &DecodedImage,
    width: u16,
    height: u16,
    app_handle: &AppHandle,
    b64: &base64::engine::GeneralPurpose,
) {
    let data = image.data();
    let encoded = b64.encode(data);
    let _ = app_handle.emit(
        "rdp://frame",
        RdpFrameEvent {
            session_id: session_id.to_string(),
            x: 0,
            y: 0,
            width,
            height,
            data: encoded,
        },
    );
}

/// Helper to access the underlying TcpStream inside the TLS wrapper
/// for setting socket options (like read timeout).
fn get_inner_tcp(
    framed: &Framed<native_tls::TlsStream<TcpStream>>,
) -> Option<&TcpStream> {
    let (tls_stream, _) = framed.get_inner();
    Some(tls_stream.get_ref())
}

// ─── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn connect_rdp(
    state: tauri::State<'_, RdpServiceState>,
    app_handle: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: Option<u16>,
    height: Option<u16>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<RdpCommand>();

    let requested_width = width.unwrap_or(1920);
    let requested_height = height.unwrap_or(1080);

    let session = RdpSession {
        id: session_id.clone(),
        host: host.clone(),
        port,
        username: username.clone(),
        connected: true,
        desktop_width: requested_width,
        desktop_height: requested_height,
    };

    let sid = session_id.clone();
    let h = host.clone();
    let u = username.clone();
    let p = password.clone();
    let d = domain.clone();
    let ah = app_handle.clone();

    let handle = tokio::task::spawn_blocking(move || {
        run_rdp_session(
            sid,
            h,
            port,
            u,
            p,
            d,
            requested_width,
            requested_height,
            ah,
            cmd_rx,
        );
    });

    let connection = RdpActiveConnection {
        session,
        cmd_tx,
        _handle: handle,
    };

    let mut service = state.lock().await;
    service.connections.insert(session_id.clone(), connection);

    Ok(session_id)
}

#[tauri::command]
pub async fn disconnect_rdp(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    if let Some(conn) = service.connections.remove(&session_id) {
        let _ = conn.cmd_tx.send(RdpCommand::Shutdown);
        // Give the session thread a moment to clean up
        tokio::time::sleep(Duration::from_millis(200)).await;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
}

#[tauri::command]
pub async fn rdp_send_input(
    state: tauri::State<'_, RdpServiceState>,
    session_id: String,
    events: Vec<RdpInputAction>,
) -> Result<(), String> {
    let service = state.lock().await;
    if let Some(conn) = service.connections.get(&session_id) {
        let fp_events: Vec<FastPathInputEvent> =
            events.iter().flat_map(convert_input).collect();
        conn.cmd_tx
            .send(RdpCommand::Input(fp_events))
            .map_err(|_| "Session command channel closed".to_string())?;
        Ok(())
    } else {
        Err(format!("RDP session {session_id} not found"))
    }
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