use std::collections::HashMap;
use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine as _;
use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::{self, ClientConnector, ConnectionResult, Credentials, Sequence, State as _};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::pdu::rdp::client_info::PerformanceFlags;
use ironrdp_blocking::Framed;
use ironrdp::core::WriteBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};

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

#[derive(Clone, Serialize)]
pub struct RdpStatsEvent {
    pub session_id: String,
    pub uptime_secs: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub pdus_received: u64,
    pub pdus_sent: u64,
    pub frame_count: u64,
    pub fps: f64,
    pub input_events: u64,
    pub errors_recovered: u64,
    pub reactivations: u64,
    pub phase: String,
    pub last_error: Option<String>,
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

// ─── Frontend RDP settings (mirrors TypeScript RdpConnectionSettings) ──────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpSettingsPayload {
    #[serde(default)]
    pub display: Option<RdpDisplayPayload>,
    #[serde(default)]
    pub audio: Option<RdpAudioPayload>,
    #[serde(default)]
    pub input: Option<RdpInputPayload>,
    #[serde(default)]
    pub device_redirection: Option<RdpDeviceRedirectionPayload>,
    #[serde(default)]
    pub performance: Option<RdpPerformancePayload>,
    #[serde(default)]
    pub security: Option<RdpSecurityPayload>,
    #[serde(default)]
    pub advanced: Option<RdpAdvancedPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpDisplayPayload {
    pub width: Option<u16>,
    pub height: Option<u16>,
    pub resize_to_window: Option<bool>,
    pub color_depth: Option<u32>,
    pub desktop_scale_factor: Option<u32>,
    pub lossy_compression: Option<bool>,
    pub magnifier_enabled: Option<bool>,
    pub magnifier_zoom: Option<u32>,
    pub smart_sizing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpAudioPayload {
    pub playback_mode: Option<String>,
    pub recording_mode: Option<String>,
    pub audio_quality: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpInputPayload {
    pub mouse_mode: Option<String>,
    pub keyboard_layout: Option<u32>,
    pub keyboard_type: Option<String>,
    pub keyboard_function_keys: Option<u32>,
    pub ime_file_name: Option<String>,
    pub enable_unicode_input: Option<bool>,
    pub input_priority: Option<String>,
    pub batch_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpDeviceRedirectionPayload {
    pub clipboard: Option<bool>,
    pub printers: Option<bool>,
    pub ports: Option<bool>,
    pub smart_cards: Option<bool>,
    pub web_authn: Option<bool>,
    pub video_capture: Option<bool>,
    pub usb_devices: Option<bool>,
    pub audio_input: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpPerformancePayload {
    pub disable_wallpaper: Option<bool>,
    pub disable_full_window_drag: Option<bool>,
    pub disable_menu_animations: Option<bool>,
    pub disable_theming: Option<bool>,
    pub disable_cursor_shadow: Option<bool>,
    pub disable_cursor_settings: Option<bool>,
    pub enable_font_smoothing: Option<bool>,
    pub enable_desktop_composition: Option<bool>,
    pub persistent_bitmap_caching: Option<bool>,
    pub connection_speed: Option<String>,
    pub target_fps: Option<u32>,
    pub frame_batching: Option<bool>,
    pub frame_batch_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpSecurityPayload {
    pub enable_tls: Option<bool>,
    pub enable_nla: Option<bool>,
    pub auto_logon: Option<bool>,
    pub enable_server_pointer: Option<bool>,
    pub pointer_software_rendering: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpAdvancedPayload {
    pub client_name: Option<String>,
    pub client_build: Option<u32>,
    pub read_timeout_ms: Option<u64>,
    pub full_frame_sync_interval: Option<u64>,
    pub max_consecutive_errors: Option<u32>,
    pub stats_interval_secs: Option<u64>,
}

/// Build IronRDP PerformanceFlags from the frontend settings
fn build_performance_flags(perf: &RdpPerformancePayload) -> PerformanceFlags {
    let mut flags = PerformanceFlags::empty();
    if perf.disable_wallpaper.unwrap_or(true) {
        flags |= PerformanceFlags::DISABLE_WALLPAPER;
    }
    if perf.disable_full_window_drag.unwrap_or(true) {
        flags |= PerformanceFlags::DISABLE_FULLWINDOWDRAG;
    }
    if perf.disable_menu_animations.unwrap_or(true) {
        flags |= PerformanceFlags::DISABLE_MENUANIMATIONS;
    }
    if perf.disable_theming.unwrap_or(false) {
        flags |= PerformanceFlags::DISABLE_THEMING;
    }
    if perf.disable_cursor_shadow.unwrap_or(true) {
        flags |= PerformanceFlags::DISABLE_CURSOR_SHADOW;
    }
    if perf.disable_cursor_settings.unwrap_or(false) {
        flags |= PerformanceFlags::DISABLE_CURSORSETTINGS;
    }
    if perf.enable_font_smoothing.unwrap_or(true) {
        flags |= PerformanceFlags::ENABLE_FONT_SMOOTHING;
    }
    if perf.enable_desktop_composition.unwrap_or(false) {
        flags |= PerformanceFlags::ENABLE_DESKTOP_COMPOSITION;
    }
    flags
}

/// Map frontend keyboard type string to IronRDP enum
fn parse_keyboard_type(s: &str) -> ironrdp::pdu::gcc::KeyboardType {
    match s {
        "ibm-pc-xt" => ironrdp::pdu::gcc::KeyboardType::IbmPcXt,
        "olivetti" => ironrdp::pdu::gcc::KeyboardType::OlivettiIco,
        "ibm-pc-at" => ironrdp::pdu::gcc::KeyboardType::IbmPcAt,
        "ibm-enhanced" => ironrdp::pdu::gcc::KeyboardType::IbmEnhanced,
        "nokia1050" => ironrdp::pdu::gcc::KeyboardType::Nokia1050,
        "nokia9140" => ironrdp::pdu::gcc::KeyboardType::Nokia9140,
        "japanese" => ironrdp::pdu::gcc::KeyboardType::Japanese,
        _ => ironrdp::pdu::gcc::KeyboardType::IbmEnhanced,
    }
}

/// Resolved settings used internally by the session runner (all defaults applied).
struct ResolvedSettings {
    width: u16,
    height: u16,
    color_depth: u32,
    desktop_scale_factor: u32,
    lossy_compression: bool,
    enable_tls: bool,
    enable_credssp: bool,
    autologon: bool,
    enable_audio_playback: bool,
    keyboard_type: ironrdp::pdu::gcc::KeyboardType,
    keyboard_layout: u32,
    keyboard_subtype: u32,
    keyboard_functional_keys_count: u32,
    ime_file_name: String,
    client_name: String,
    client_build: u32,
    enable_server_pointer: bool,
    pointer_software_rendering: bool,
    performance_flags: PerformanceFlags,
    // Frame delivery
    frame_batching: bool,
    frame_batch_interval: Duration,
    full_frame_sync_interval: u64,
    // Session behaviour
    read_timeout: Duration,
    max_consecutive_errors: u32,
    stats_interval: Duration,
}

impl ResolvedSettings {
    fn from_payload(payload: &RdpSettingsPayload, width: u16, height: u16) -> Self {
        let display = payload.display.as_ref();
        let perf = payload.performance.as_ref();
        let sec = payload.security.as_ref();
        let input = payload.input.as_ref();
        let adv = payload.advanced.as_ref();

        let w = display.and_then(|d| d.width).unwrap_or(width);
        let h = display.and_then(|d| d.height).unwrap_or(height);

        let performance_flags = perf
            .map(|p| build_performance_flags(p))
            .unwrap_or_else(|| {
                PerformanceFlags::DISABLE_WALLPAPER
                    | PerformanceFlags::DISABLE_FULLWINDOWDRAG
                    | PerformanceFlags::DISABLE_MENUANIMATIONS
                    | PerformanceFlags::DISABLE_CURSOR_SHADOW
                    | PerformanceFlags::ENABLE_FONT_SMOOTHING
            });

        let batch_ms = perf
            .and_then(|p| p.frame_batch_interval_ms)
            .unwrap_or(33);

        Self {
            width: w,
            height: h,
            color_depth: display.and_then(|d| d.color_depth).unwrap_or(32),
            desktop_scale_factor: display.and_then(|d| d.desktop_scale_factor).unwrap_or(100),
            lossy_compression: display.and_then(|d| d.lossy_compression).unwrap_or(true),
            enable_tls: sec.and_then(|s| s.enable_tls).unwrap_or(true),
            enable_credssp: sec.and_then(|s| s.enable_nla).unwrap_or(true),
            autologon: sec.and_then(|s| s.auto_logon).unwrap_or(false),
            enable_audio_playback: payload
                .audio
                .as_ref()
                .and_then(|a| a.playback_mode.as_deref())
                .map(|m| m != "disabled")
                .unwrap_or(true),
            keyboard_type: input
                .and_then(|i| i.keyboard_type.as_deref())
                .map(parse_keyboard_type)
                .unwrap_or(ironrdp::pdu::gcc::KeyboardType::IbmEnhanced),
            keyboard_layout: input.and_then(|i| i.keyboard_layout).unwrap_or(0x0409),
            keyboard_subtype: 0,
            keyboard_functional_keys_count: input
                .and_then(|i| i.keyboard_function_keys)
                .unwrap_or(12),
            ime_file_name: input
                .and_then(|i| i.ime_file_name.clone())
                .unwrap_or_default(),
            client_name: adv
                .and_then(|a| a.client_name.clone())
                .unwrap_or_else(|| "SortOfRemoteNG".to_string()),
            client_build: adv.and_then(|a| a.client_build).unwrap_or(0),
            enable_server_pointer: sec.and_then(|s| s.enable_server_pointer).unwrap_or(true),
            pointer_software_rendering: sec
                .and_then(|s| s.pointer_software_rendering)
                .unwrap_or(true),
            performance_flags,
            frame_batching: perf.and_then(|p| p.frame_batching).unwrap_or(true),
            frame_batch_interval: Duration::from_millis(batch_ms),
            full_frame_sync_interval: adv
                .and_then(|a| a.full_frame_sync_interval)
                .unwrap_or(300),
            read_timeout: Duration::from_millis(
                adv.and_then(|a| a.read_timeout_ms).unwrap_or(16),
            ),
            max_consecutive_errors: adv
                .and_then(|a| a.max_consecutive_errors)
                .unwrap_or(50),
            stats_interval: Duration::from_secs(
                adv.and_then(|a| a.stats_interval_secs).unwrap_or(1),
            ),
        }
    }
}

// ─── Session statistics (shared between session thread and main) ───────────

#[derive(Debug)]
pub struct RdpSessionStats {
    pub connected_at: Instant,
    pub bytes_received: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub pdus_received: AtomicU64,
    pub pdus_sent: AtomicU64,
    pub frame_count: AtomicU64,
    pub input_events: AtomicU64,
    pub errors_recovered: AtomicU64,
    pub reactivations: AtomicU64,
    pub phase: std::sync::Mutex<String>,
    pub last_error: std::sync::Mutex<Option<String>>,
    /// Timestamps of recent frames for FPS calculation
    pub fps_frame_timestamps: std::sync::Mutex<Vec<Instant>>,
    pub alive: AtomicBool,
}

impl RdpSessionStats {
    fn new() -> Self {
        Self {
            connected_at: Instant::now(),
            bytes_received: AtomicU64::new(0),
            bytes_sent: AtomicU64::new(0),
            pdus_received: AtomicU64::new(0),
            pdus_sent: AtomicU64::new(0),
            frame_count: AtomicU64::new(0),
            input_events: AtomicU64::new(0),
            errors_recovered: AtomicU64::new(0),
            reactivations: AtomicU64::new(0),
            phase: std::sync::Mutex::new("initializing".to_string()),
            last_error: std::sync::Mutex::new(None),
            fps_frame_timestamps: std::sync::Mutex::new(Vec::new()),
            alive: AtomicBool::new(true),
        }
    }

    fn set_phase(&self, phase: &str) {
        if let Ok(mut p) = self.phase.lock() {
            *p = phase.to_string();
        }
    }

    fn get_phase(&self) -> String {
        self.phase.lock().map(|p| p.clone()).unwrap_or_default()
    }

    fn set_last_error(&self, err: &str) {
        if let Ok(mut e) = self.last_error.lock() {
            *e = Some(err.to_string());
        }
    }

    fn record_frame(&self) {
        self.frame_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut timestamps) = self.fps_frame_timestamps.lock() {
            let now = Instant::now();
            timestamps.push(now);
            // Keep only last 2 seconds of timestamps
            let cutoff = now - Duration::from_secs(2);
            timestamps.retain(|t| *t > cutoff);
        }
    }

    fn current_fps(&self) -> f64 {
        if let Ok(timestamps) = self.fps_frame_timestamps.lock() {
            if timestamps.len() < 2 {
                return 0.0;
            }
            let now = Instant::now();
            let one_sec_ago = now - Duration::from_secs(1);
            let recent = timestamps.iter().filter(|t| **t > one_sec_ago).count();
            recent as f64
        } else {
            0.0
        }
    }

    fn to_event(&self, session_id: &str) -> RdpStatsEvent {
        RdpStatsEvent {
            session_id: session_id.to_string(),
            uptime_secs: self.connected_at.elapsed().as_secs(),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            pdus_received: self.pdus_received.load(Ordering::Relaxed),
            pdus_sent: self.pdus_sent.load(Ordering::Relaxed),
            frame_count: self.frame_count.load(Ordering::Relaxed),
            fps: self.current_fps(),
            input_events: self.input_events.load(Ordering::Relaxed),
            errors_recovered: self.errors_recovered.load(Ordering::Relaxed),
            reactivations: self.reactivations.load(Ordering::Relaxed),
            phase: self.get_phase(),
            last_error: self.last_error.lock().ok().and_then(|e| e.clone()),
        }
    }
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
    /// SHA-256 fingerprint of the server's TLS certificate (hex)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_cert_fingerprint: Option<String>,
}

enum RdpCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
}

struct RdpActiveConnection {
    session: RdpSession,
    cmd_tx: mpsc::UnboundedSender<RdpCommand>,
    stats: Arc<RdpSessionStats>,
    _handle: tokio::task::JoinHandle<()>,
}

pub struct RdpService {
    connections: HashMap<String, RdpActiveConnection>,
    /// Cached TLS connector – built once, reused for every connection.
    /// Building a TLS connector loads the system root certificate store which
    /// is very expensive on Windows (200-500 ms).  Caching it avoids paying that
    /// cost on every connection.
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    /// Cached reqwest blocking client for CredSSP/Kerberos HTTP requests.
    /// Has a short connect + request timeout so it doesn't hang waiting for an
    /// unreachable KDC.
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
}

impl RdpService {
    pub fn new() -> RdpServiceState {
        // Pre-build the TLS connector and HTTP client eagerly so the first
        // connection doesn't pay the initialisation cost.
        let tls_connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .use_sni(false)
            .build()
            .ok()
            .map(Arc::new);

        let http_client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(2)
            .build()
            .ok()
            .map(Arc::new);

        Arc::new(Mutex::new(RdpService {
            connections: HashMap::new(),
            cached_tls_connector: tls_connector,
            cached_http_client: http_client,
        }))
    }
}

// ─── Network client for CredSSP HTTP requests ──────────────────────────────

struct BlockingNetworkClient {
    client: Arc<reqwest::blocking::Client>,
}

impl BlockingNetworkClient {
    /// Create from a pre-built (cached) client.  Falls back to building a
    /// new one with aggressive timeouts if no cached client is supplied.
    fn new(cached: Option<Arc<reqwest::blocking::Client>>) -> Self {
        let client = cached.unwrap_or_else(|| {
            Arc::new(
                reqwest::blocking::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .connect_timeout(Duration::from_secs(3))
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap_or_else(|_| reqwest::blocking::Client::new()),
            )
        });
        Self { client }
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
                let resp = self
                    .client
                    .post(&url)
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

fn tls_upgrade(
    stream: TcpStream,
    server_name: &str,
    leftover: ::bytes::BytesMut,
    cached_connector: Option<Arc<native_tls::TlsConnector>>,
) -> Result<(Framed<native_tls::TlsStream<TcpStream>>, Vec<u8>), Box<dyn std::error::Error + Send + Sync>>
{
    // Re-use the cached TLS connector when available – building one from
    // scratch loads the system certificate store which is very slow on Windows.
    let owned_connector;
    let tls_connector: &native_tls::TlsConnector = match &cached_connector {
        Some(arc) => arc.as_ref(),
        None => {
            owned_connector = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .use_sni(false)
                .build()
                .map_err(|e| format!("TLS connector build error: {e}"))?;
            &owned_connector
        }
    };

    let tls_stream = tls_connector
        .connect(server_name, stream)
        .map_err(|e| format!("TLS handshake failed: {e}"))?;

    let server_public_key = extract_server_public_key(&tls_stream)?;
    let framed = Framed::new_with_leftover(tls_stream, leftover);
    Ok((framed, server_public_key))
}

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

/// Extract SHA-256 fingerprint of the server's TLS certificate
fn extract_cert_fingerprint(
    tls_stream: &native_tls::TlsStream<TcpStream>,
) -> Option<String> {
    use sha2::{Sha256, Digest};

    let peer_cert = tls_stream.peer_certificate().ok()??;
    let der = peer_cert.to_der().ok()?;
    let hash = Sha256::digest(&der);
    let hex: Vec<String> = hash.iter().map(|b| format!("{b:02x}")).collect();
    Some(hex.join(":"))
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
                3 => {
                    return vec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON1
                        } else {
                            PointerXFlags::BUTTON1
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                4 => {
                    return vec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON2
                        } else {
                            PointerXFlags::BUTTON2
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                _ => (false, PointerFlags::LEFT_BUTTON),
            };
            let mouse_flags = if *pressed {
                PointerFlags::DOWN | flags
            } else {
                flags
            };
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: mouse_flags,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::Wheel {
            delta, horizontal, ..
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

// ─── Deactivation-Reactivation Sequence handler ────────────────────────────

/// Drives a ConnectionActivationSequence to completion after receiving
/// DeactivateAll.  This re-runs the Capability Exchange and Connection
/// Finalization phases so the server can transition from the login screen
/// to the user desktop (MS-RDPBCGR section 1.3.1.3).
fn handle_reactivation<S: std::io::Read + std::io::Write>(
    mut cas: Box<ironrdp::connector::connection_activation::ConnectionActivationSequence>,
    tls_framed: &mut Framed<S>,
    stats: &RdpSessionStats,
) -> Result<ConnectionResult, Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = WriteBuf::new();

    log::info!("Driving deactivation-reactivation sequence");
    stats.set_phase("reactivating");

    loop {
        // Check if we have reached a terminal (Finalized) state
        if cas.state().is_terminal() {
            break;
        }

        let hint = cas.next_pdu_hint();
        if hint.is_none() {
            break;
        }
        let pdu_hint = hint.unwrap();

        let pdu = tls_framed
            .read_by_hint(pdu_hint)
            .map_err(|e| format!("Reactivation read error: {e}"))?;

        stats
            .bytes_received
            .fetch_add(pdu.len() as u64, Ordering::Relaxed);

        buf.clear();
        let written = cas
            .step(&pdu, &mut buf)
            .map_err(|e| format!("Reactivation step error: {e}"))?;

        if let Some(response_len) = written.size() {
            let response = buf.filled()[..response_len].to_vec();
            tls_framed
                .write_all(&response)
                .map_err(|e| format!("Reactivation write error: {e}"))?;
            stats
                .bytes_sent
                .fetch_add(response_len as u64, Ordering::Relaxed);
        }
    }

    // Extract the finalized result
    match cas.connection_activation_state() {
        ConnectionActivationState::Finalized {
            io_channel_id,
            user_channel_id,
            desktop_size,
            enable_server_pointer,
            pointer_software_rendering,
        } => {
            log::info!(
                "Reactivation complete: {}x{} (io={}, user={})",
                desktop_size.width,
                desktop_size.height,
                io_channel_id,
                user_channel_id,
            );
            Ok(ConnectionResult {
                io_channel_id,
                user_channel_id,
                static_channels: ironrdp_svc::StaticChannelSet::new(),
                desktop_size,
                enable_server_pointer,
                pointer_software_rendering,
                connection_activation: *cas,
            })
        }
        other => Err(format!(
            "Reactivation did not reach Finalized state, got: {}",
            other.name()
        )
        .into()),
    }
}

// ─── Blocking RDP session runner ───────────────────────────────────────────

fn run_rdp_session(
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    settings: ResolvedSettings,
    app_handle: AppHandle,
    mut cmd_rx: mpsc::UnboundedReceiver<RdpCommand>,
    stats: Arc<RdpSessionStats>,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) {
    let result = run_rdp_session_inner(
        &session_id,
        &host,
        port,
        &username,
        &password,
        domain.as_deref(),
        &settings,
        &app_handle,
        &mut cmd_rx,
        &stats,
        cached_tls_connector,
        cached_http_client,
    );

    stats.alive.store(false, Ordering::Relaxed);

    match result {
        Ok(()) => {
            log::info!("RDP session {session_id} ended normally");
            stats.set_phase("disconnected");
        }
        Err(e) => {
            let err_msg = format!("{e}");
            log::error!("RDP session {session_id} error: {err_msg}");
            stats.set_phase("error");
            stats.set_last_error(&err_msg);
            let _ = app_handle.emit(
                "rdp://status",
                RdpStatusEvent {
                    session_id: session_id.clone(),
                    status: "error".to_string(),
                    message: err_msg,
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

#[allow(clippy::too_many_arguments)]
fn run_rdp_session_inner(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    app_handle: &AppHandle,
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conn_start = Instant::now();

    // ── 1. TCP connect (with hostname DNS resolution support) ───────────

    let addr = format!("{host}:{port}");
    log::info!("RDP session {session_id}: connecting to {addr}");
    stats.set_phase("tcp_connect");

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

    // Resolve address – supports both raw IPs and hostnames.
    let t_resolve = Instant::now();
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("DNS resolution failed for {addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("DNS returned no addresses for {addr}"))?;
    let dns_ms = t_resolve.elapsed().as_millis();
    log::info!("RDP session {session_id}: DNS resolved in {dns_ms}ms → {socket_addr}");

    let t_tcp = Instant::now();
    let tcp_stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(10))?;
    tcp_stream.set_nodelay(true)?;

    // Enlarge socket buffers for faster handshake throughput
    {
        use socket2::Socket;
        let sock = Socket::from(tcp_stream.try_clone()?);
        let _ = sock.set_recv_buffer_size(256 * 1024);
        let _ = sock.set_send_buffer_size(256 * 1024);
        // Detach without closing – the TcpStream still owns the fd
        std::mem::forget(sock);
    }
    let tcp_ms = t_tcp.elapsed().as_millis();
    log::info!("RDP session {session_id}: TCP connected in {tcp_ms}ms");

    let mut framed = Framed::new(tcp_stream);

    // ── 2. Build IronRDP connector config ───────────────────────────────

    stats.set_phase("configuring");

    let config = connector::Config {
        credentials: Credentials::UsernamePassword {
            username: username.to_string(),
            password: password.to_string(),
        },
        domain: domain.map(String::from),
        enable_tls: settings.enable_tls,
        enable_credssp: settings.enable_credssp,
        keyboard_type: settings.keyboard_type,
        keyboard_subtype: settings.keyboard_subtype,
        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
        keyboard_layout: settings.keyboard_layout,
        ime_file_name: settings.ime_file_name.clone(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize {
            width: settings.width,
            height: settings.height,
        },
        desktop_scale_factor: settings.desktop_scale_factor,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: settings.lossy_compression,
            color_depth: settings.color_depth,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: settings.autologon,
        enable_audio_playback: settings.enable_audio_playback,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: settings.enable_server_pointer,
        pointer_software_rendering: settings.pointer_software_rendering,
    };

    let server_socket_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut connector = ClientConnector::new(config, server_socket_addr);

    // ── 3. Connection begin (pre-TLS phase) ─────────────────────────────

    stats.set_phase("negotiating");
    log::info!("RDP session {session_id}: starting connection sequence");
    let t_negotiate = Instant::now();
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .map_err(|e| format!("connect_begin failed: {e}"))?;
    let negotiate_ms = t_negotiate.elapsed().as_millis();
    log::info!("RDP session {session_id}: X.224/MCS negotiation took {negotiate_ms}ms");

    // ── 4. TLS upgrade ──────────────────────────────────────────────────

    stats.set_phase("tls_upgrade");
    log::info!("RDP session {session_id}: upgrading to TLS");
    let t_tls = Instant::now();

    let (tcp_stream, leftover) = framed.into_inner();
    let (mut tls_framed, server_public_key) = tls_upgrade(tcp_stream, host, leftover, cached_tls_connector)?;
    let tls_ms = t_tls.elapsed().as_millis();
    log::info!("RDP session {session_id}: TLS upgrade took {tls_ms}ms");

    // Extract and emit server certificate fingerprint
    {
        let (tls_stream, _) = tls_framed.get_inner();
        if let Some(fp) = extract_cert_fingerprint(tls_stream) {
            let _ = app_handle.emit(
                "rdp://cert-fingerprint",
                serde_json::json!({
                    "session_id": session_id,
                    "fingerprint": fp,
                    "host": host,
                    "port": port,
                }),
            );
        }
    }

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

    // ── 5. Finalize connection (CredSSP / NLA + remaining handshake) ────

    stats.set_phase("authenticating");
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

    let t_auth = Instant::now();
    let mut network_client = BlockingNetworkClient::new(cached_http_client);
    let server_name = ironrdp::connector::ServerName::new(host);

    let connection_result: ConnectionResult = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut tls_framed,
        &mut network_client,
        server_name,
        server_public_key,
        None,
    )
    .map_err(|e| format!("connect_finalize failed: {e}"))?;
    let auth_ms = t_auth.elapsed().as_millis();
    let total_ms = conn_start.elapsed().as_millis();
    log::info!(
        "RDP session {session_id}: authentication took {auth_ms}ms  \
         (total connect: {total_ms}ms  DNS:{dns_ms}ms TCP:{tcp_ms}ms \
         negotiate:{negotiate_ms}ms TLS:{tls_ms}ms auth:{auth_ms}ms)"
    );

    // Emit timing event to frontend for visibility
    let _ = app_handle.emit(
        "rdp://timing",
        serde_json::json!({
            "session_id": session_id,
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "negotiate_ms": negotiate_ms,
            "tls_ms": tls_ms,
            "auth_ms": auth_ms,
            "total_ms": total_ms,
        }),
    );

    // ── 6. Enter active session ─────────────────────────────────────────

    let mut desktop_width = connection_result.desktop_size.width;
    let mut desktop_height = connection_result.desktop_size.height;

    stats.set_phase("active");
    log::info!("RDP session {session_id}: connected! Desktop: {desktop_width}x{desktop_height}");

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
    set_read_timeout_on_framed(&tls_framed, Some(settings.read_timeout));

    // ── 7. Main session loop ────────────────────────────────────────────

    let b64 = base64::engine::general_purpose::STANDARD;
    let mut last_stats_emit = Instant::now();
    let stats_interval = settings.stats_interval;
    #[allow(unused_assignments)]
    let mut consecutive_errors: u32 = 0;
    let max_consecutive_errors = settings.max_consecutive_errors;
    let full_frame_sync_interval = settings.full_frame_sync_interval;

    // Frame batching state
    let frame_batching = settings.frame_batching;
    let batch_interval = settings.frame_batch_interval;
    let mut dirty_regions: Vec<(u16, u16, u16, u16)> = Vec::new(); // (x, y, w, h)
    let mut last_frame_emit = Instant::now();

    loop {
        // ─ Check for shutdown / input commands ─────────────────────────
        match cmd_rx.try_recv() {
            Ok(RdpCommand::Shutdown) => {
                log::info!("RDP session {session_id}: shutdown requested");
                // Attempt graceful shutdown
                if let Ok(outputs) = active_stage.graceful_shutdown() {
                    for output in outputs {
                        if let ActiveStageOutput::ResponseFrame(data) = output {
                            stats
                                .bytes_sent
                                .fetch_add(data.len() as u64, Ordering::Relaxed);
                            let _ = tls_framed.write_all(&data);
                        }
                    }
                }
                break;
            }
            Ok(RdpCommand::Input(events)) => {
                stats
                    .input_events
                    .fetch_add(events.len() as u64, Ordering::Relaxed);
                match active_stage.process_fastpath_input(&mut image, &events) {
                    Ok(outputs) => {
                        process_outputs(
                            session_id,
                            &outputs,
                            &mut tls_framed,
                            &image,
                            desktop_width,
                            desktop_height,
                            app_handle,
                            stats,
                            &b64,
                        )?;
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

        // ─ Emit periodic stats ─────────────────────────────────────────
        if last_stats_emit.elapsed() >= stats_interval {
            let _ = app_handle.emit("rdp://stats", stats.to_event(session_id));
            last_stats_emit = Instant::now();
        }

        // ─ Flush batched frame updates ─────────────────────────────────
        if frame_batching && !dirty_regions.is_empty() && last_frame_emit.elapsed() >= batch_interval {
            // Compute bounding box of all dirty regions
            let mut min_x = u16::MAX;
            let mut min_y = u16::MAX;
            let mut max_x = 0u16;
            let mut max_y = 0u16;
            for &(x, y, w, h) in &dirty_regions {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x.saturating_add(w));
                max_y = max_y.max(y.saturating_add(h));
            }
            let merged_w = max_x.saturating_sub(min_x);
            let merged_h = max_y.saturating_sub(min_y);
            if merged_w > 0 && merged_h > 0 {
                let region = ironrdp::pdu::geometry::InclusiveRectangle {
                    left: min_x,
                    top: min_y,
                    right: max_x.saturating_sub(1),
                    bottom: max_y.saturating_sub(1),
                };
                emit_region(session_id, &image, desktop_width, &region, app_handle, &b64);
            }
            dirty_regions.clear();
            last_frame_emit = Instant::now();
        }

        // ─ Read and process PDUs ───────────────────────────────────────
        match tls_framed.read_pdu() {
            Ok((action, payload)) => {
                consecutive_errors = 0;
                let payload_len = payload.len() as u64;
                stats
                    .bytes_received
                    .fetch_add(payload_len, Ordering::Relaxed);
                stats.pdus_received.fetch_add(1, Ordering::Relaxed);

                match active_stage.process(&mut image, action, payload.as_ref()) {
                    Ok(outputs) => {
                        let mut should_reactivate = None;
                        let mut should_terminate = false;

                        for output in &outputs {
                            match output {
                                ActiveStageOutput::Terminate(_) => {
                                    should_terminate = true;
                                }
                                ActiveStageOutput::DeactivateAll(_) => {
                                    // We'll handle this after collecting all outputs
                                }
                                _ => {}
                            }
                        }

                        // Process all outputs (send frames, emit graphics, etc.)
                        for output in outputs {
                            match output {
                                ActiveStageOutput::ResponseFrame(data) => {
                                    stats
                                        .bytes_sent
                                        .fetch_add(data.len() as u64, Ordering::Relaxed);
                                    stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                    if let Err(e) = tls_framed.write_all(&data) {
                                        return Err(
                                            format!("Failed to send response frame: {e}").into()
                                        );
                                    }
                                }
                                ActiveStageOutput::GraphicsUpdate(region) => {
                                    stats.record_frame();

                                    let rw = region.right.saturating_sub(region.left) + 1;
                                    let rh = region.bottom.saturating_sub(region.top) + 1;

                                    if frame_batching {
                                        // Accumulate dirty region for batched emission
                                        dirty_regions.push((region.left, region.top, rw, rh));
                                    } else {
                                        // Immediate emission (no batching)
                                        emit_region(
                                            session_id,
                                            &image,
                                            desktop_width,
                                            &region,
                                            app_handle,
                                            &b64,
                                        );
                                    }

                                    // Periodic full-frame sync
                                    let fc = stats.frame_count.load(Ordering::Relaxed);
                                    if fc > 0 && fc % full_frame_sync_interval == 0 {
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
                                    log::info!(
                                        "RDP session {session_id}: server terminated: {reason:?}"
                                    );
                                    stats.set_phase("terminated");
                                    return Ok(());
                                }
                                ActiveStageOutput::DeactivateAll(cas) => {
                                    should_reactivate = Some(cas);
                                }
                            }
                        }

                        if should_terminate {
                            return Ok(());
                        }

                        // Handle reactivation AFTER processing all other outputs
                        if let Some(cas) = should_reactivate {
                            log::info!(
                                "RDP session {session_id}: DeactivateAll received, running reactivation"
                            );
                            stats.reactivations.fetch_add(1, Ordering::Relaxed);

                            let _ = app_handle.emit(
                                "rdp://status",
                                RdpStatusEvent {
                                    session_id: session_id.to_string(),
                                    status: "connecting".to_string(),
                                    message: "Reactivating session...".to_string(),
                                    desktop_width: None,
                                    desktop_height: None,
                                },
                            );

                            // Remove read timeout for reactivation (needs reliable full PDU reads)
                            set_read_timeout_on_framed(&tls_framed, None);

                            match handle_reactivation(cas, &mut tls_framed, stats) {
                                Ok(new_result) => {
                                    desktop_width = new_result.desktop_size.width;
                                    desktop_height = new_result.desktop_size.height;
                                    image = DecodedImage::new(
                                        PixelFormat::RgbA32,
                                        desktop_width,
                                        desktop_height,
                                    );
                                    active_stage = ActiveStage::new(new_result);
                                    stats.set_phase("active");

                                    log::info!(
                                        "RDP session {session_id}: reactivated at {desktop_width}x{desktop_height}"
                                    );

                                    let _ = app_handle.emit(
                                        "rdp://status",
                                        RdpStatusEvent {
                                            session_id: session_id.to_string(),
                                            status: "connected".to_string(),
                                            message: format!(
                                                "Reconnected ({desktop_width}x{desktop_height})"
                                            ),
                                            desktop_width: Some(desktop_width),
                                            desktop_height: Some(desktop_height),
                                        },
                                    );

                                    // Restore read timeout for normal operation
                                    set_read_timeout_on_framed(
                                        &tls_framed,
                                        Some(settings.read_timeout),
                                    );
                                }
                                Err(e) => {
                                    log::error!(
                                        "RDP session {session_id}: reactivation failed: {e}"
                                    );
                                    return Err(format!("Reactivation failed: {e}").into());
                                }
                            }
                        }
                    }
                    Err(e) => {
                        // Non-fatal PDU processing error — log and continue.
                        // IronRDP's x224 processor returns errors for unhandled
                        // PDU types that real servers commonly send, so we must
                        // not kill the session on every process() error.
                        let err_str = format!("{e}");
                        log::warn!(
                            "RDP session {session_id}: PDU processing error (recovering): {err_str}"
                        );
                        stats.errors_recovered.fetch_add(1, Ordering::Relaxed);
                        stats.set_last_error(&err_str);
                        consecutive_errors += 1;

                        if consecutive_errors >= max_consecutive_errors {
                            return Err(format!(
                                "Too many consecutive errors ({consecutive_errors}), last: {err_str}"
                            )
                            .into());
                        }
                    }
                }
            }
            Err(e) if is_timeout_error(&e) => {
                // Read timeout — no data available, loop back for input handling
                continue;
            }
            Err(e) => {
                let err_str = format!("{e}");
                // Distinguish EOF (clean disconnect) from real errors
                if e.kind() == io::ErrorKind::UnexpectedEof {
                    log::info!("RDP session {session_id}: server closed connection (EOF)");
                    return Ok(());
                }
                log::error!("RDP session {session_id}: read error: {err_str}");
                return Err(format!("Read error: {err_str}").into());
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

/// Helper to write response frames and emit graphics/pointer events from
/// `process_fastpath_input` outputs.  Returns `Err` only on fatal write errors.
#[allow(clippy::too_many_arguments)]
fn process_outputs(
    session_id: &str,
    outputs: &[ActiveStageOutput],
    tls_framed: &mut Framed<native_tls::TlsStream<TcpStream>>,
    image: &DecodedImage,
    desktop_width: u16,
    desktop_height: u16,
    app_handle: &AppHandle,
    stats: &RdpSessionStats,
    b64: &base64::engine::GeneralPurpose,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for output in outputs {
        match output {
            ActiveStageOutput::ResponseFrame(data) => {
                stats
                    .bytes_sent
                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                if let Err(e) = tls_framed.write_all(data) {
                    return Err(format!("Write failed: {e}").into());
                }
            }
            ActiveStageOutput::GraphicsUpdate(region) => {
                stats.record_frame();
                emit_region(session_id, image, desktop_width, region, app_handle, b64);
                let fc = stats.frame_count.load(Ordering::Relaxed);
                if fc % 120 == 0 {
                    send_full_frame(
                        session_id,
                        image,
                        desktop_width,
                        desktop_height,
                        app_handle,
                        b64,
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn emit_region(
    session_id: &str,
    image: &DecodedImage,
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
    app_handle: &AppHandle,
    b64: &base64::engine::GeneralPurpose,
) {
    let region_data = extract_region_rgba(image.data(), fb_width, region);
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
}

fn extract_region_rgba(
    framebuffer: &[u8],
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
) -> Vec<u8> {
    let bytes_per_pixel = 4usize;
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

fn set_read_timeout_on_framed(
    framed: &Framed<native_tls::TlsStream<TcpStream>>,
    timeout: Option<Duration>,
) {
    let (tls_stream, _) = framed.get_inner();
    let tcp = tls_stream.get_ref();
    let _ = tcp.set_read_timeout(timeout);
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
    rdp_settings: Option<RdpSettingsPayload>,
) -> Result<String, String> {
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
        host: host.clone(),
        port,
        username: username.clone(),
        connected: true,
        desktop_width: actual_width,
        desktop_height: actual_height,
        server_cert_fingerprint: None,
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
        );
    });

    let connection = RdpActiveConnection {
        session,
        cmd_tx,
        stats,
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
        let fp_events: Vec<FastPathInputEvent> = events.iter().flat_map(convert_input).collect();
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
