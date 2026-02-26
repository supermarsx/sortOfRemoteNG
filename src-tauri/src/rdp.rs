use std::collections::HashMap;
use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::{self, ClientConnector, ConnectionResult, Credentials, Sequence, State as _};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::pdu::rdp::client_info::PerformanceFlags;
use ironrdp_blocking::Framed;
use ironrdp::core::WriteBuf;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};

use crate::native_renderer::{self, FrameCompositor, RenderBackend};

pub type RdpServiceState = Arc<Mutex<RdpService>>;

// ─── Shared framebuffer store ──────────────────────────────────────────────
//
// The RDP session thread writes decoded framebuffer data here on every
// GraphicsUpdate.  The `rdp_get_frame_data` Tauri command reads from it
// to return raw binary RGBA bytes to the frontend — completely avoiding
// the base64 encode/decode overhead that plagued the old event-based
// frame pipeline.

/// Per-session framebuffer slot.
#[allow(dead_code)]
struct FrameSlot {
    data: Vec<u8>,
    width: u16,
    height: u16,
}

/// Thread-safe store of framebuffers for all active RDP sessions.
pub struct SharedFrameStore {
    slots: RwLock<HashMap<String, FrameSlot>>,
}

pub type SharedFrameStoreState = Arc<SharedFrameStore>;

impl SharedFrameStore {
    pub fn new() -> SharedFrameStoreState {
        Arc::new(SharedFrameStore {
            slots: RwLock::new(HashMap::new()),
        })
    }

    /// Create or reset a slot for the given session.
    fn init(&self, session_id: &str, width: u16, height: u16) {
        let size = width as usize * height as usize * 4;
        let mut slots = self.slots.write().unwrap();
        slots.insert(
            session_id.to_string(),
            FrameSlot {
                data: vec![0u8; size],
                width,
                height,
            },
        );
    }

    /// Copy a dirty region from the IronRDP DecodedImage framebuffer into
    /// the shared slot.  This is a fast row-by-row memcpy — much cheaper
    /// than the old base64 encoding path.
    fn update_region(
        &self,
        session_id: &str,
        source: &[u8],
        fb_width: u16,
        region: &ironrdp::pdu::geometry::InclusiveRectangle,
    ) {
        let mut slots = self.slots.write().unwrap();
        if let Some(slot) = slots.get_mut(session_id) {
            let bpp = 4usize;
            let stride = fb_width as usize * bpp;
            let left = region.left as usize;
            let right = region.right as usize;
            let top = region.top as usize;
            let bottom = region.bottom as usize;
            let row_bytes = (right - left + 1) * bpp;

            for row in top..=bottom {
                let offset = row * stride + left * bpp;
                let end = offset + row_bytes;
                if end <= source.len() && end <= slot.data.len() {
                    slot.data[offset..end].copy_from_slice(&source[offset..end]);
                }
            }
        }
    }

    /// Extract a rectangular region as a contiguous RGBA byte vec.
    /// Called by the `rdp_get_frame_data` command.
    fn extract_region(
        &self,
        session_id: &str,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) -> Option<Vec<u8>> {
        let slots = self.slots.read().unwrap();
        let slot = slots.get(session_id)?;
        let bpp = 4usize;
        let stride = slot.width as usize * bpp;
        let mut rgba = Vec::with_capacity(w as usize * h as usize * bpp);

        for row in y as usize..(y + h) as usize {
            let start = row * stride + x as usize * bpp;
            let end = start + w as usize * bpp;
            if end <= slot.data.len() {
                rgba.extend_from_slice(&slot.data[start..end]);
            }
        }
        Some(rgba)
    }

    /// Reset slot dimensions (e.g. after reactivation at a new desktop size).
    fn reinit(&self, session_id: &str, width: u16, height: u16) {
        self.init(session_id, width, height);
    }

    /// Remove the slot when the session ends.
    fn remove(&self, session_id: &str) {
        let mut slots = self.slots.write().unwrap();
        slots.remove(session_id);
    }
}

// ─── Events emitted to the frontend ────────────────────────────────────────
// Frame pixel data is now pushed via Tauri Channel (binary ArrayBuffer) —
// no JSON event for frames.  Status/pointer/stats still use emit().

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
    pub gateway: Option<RdpGatewayPayload>,
    #[serde(default)]
    pub hyperv: Option<RdpHyperVPayload>,
    #[serde(default)]
    pub negotiation: Option<RdpNegotiationPayload>,
    #[serde(default)]
    pub advanced: Option<RdpAdvancedPayload>,
    #[serde(default)]
    pub tcp: Option<RdpTcpPayload>,
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
    pub codecs: Option<RdpCodecPayload>,
    pub render_backend: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpCodecPayload {
    /// Enable bitmap codec negotiation (when false, only raw/RLE bitmaps)
    pub enable_codecs: Option<bool>,
    /// Enable RemoteFX (RFX) codec
    pub remote_fx: Option<bool>,
    /// RemoteFX entropy algorithm: "rlgr1" or "rlgr3"
    pub remote_fx_entropy: Option<String>,
    /// Enable RDPGFX (H.264 hardware decode) via Dynamic Virtual Channel
    pub enable_gfx: Option<bool>,
    /// H.264 decoder preference: "auto" | "media-foundation" | "openh264"
    pub h264_decoder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpSecurityPayload {
    pub enable_tls: Option<bool>,
    pub enable_nla: Option<bool>,
    pub use_credssp: Option<bool>,
    pub auto_logon: Option<bool>,
    pub enable_server_pointer: Option<bool>,
    pub pointer_software_rendering: Option<bool>,

    // CredSSP remediation fields
    pub credssp_oracle_remediation: Option<String>,    // "force-updated" | "mitigated" | "vulnerable"
    pub allow_hybrid_ex: Option<bool>,
    pub nla_fallback_to_tls: Option<bool>,
    pub tls_min_version: Option<String>,               // "1.0" | "1.1" | "1.2" | "1.3"
    pub ntlm_enabled: Option<bool>,
    pub kerberos_enabled: Option<bool>,
    pub pku2u_enabled: Option<bool>,
    pub restricted_admin: Option<bool>,
    pub remote_credential_guard: Option<bool>,
    pub enforce_server_public_key_validation: Option<bool>,
    pub credssp_version: Option<u32>,                  // 2 | 3 | 6
    pub sspi_package_list: Option<String>,
    pub server_cert_validation: Option<String>,        // "validate" | "warn" | "ignore"
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpGatewayPayload {
    pub enabled: Option<bool>,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    pub auth_method: Option<String>,        // "ntlm" | "basic" | "digest" | "negotiate" | "smartcard"
    pub credential_source: Option<String>,   // "same-as-connection" | "separate" | "ask"
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub bypass_for_local: Option<bool>,
    pub transport_mode: Option<String>,      // "auto" | "http" | "udp"
    pub access_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpHyperVPayload {
    pub use_vm_id: Option<bool>,
    pub vm_id: Option<String>,
    pub enhanced_session_mode: Option<bool>,
    pub host_server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpNegotiationPayload {
    pub auto_detect: Option<bool>,
    pub strategy: Option<String>,            // "auto" | "nla-first" | "tls-first" | "nla-only" | "tls-only" | "plain-only"
    pub max_retries: Option<u32>,
    pub retry_delay_ms: Option<u64>,
    pub load_balancing_info: Option<String>,
    pub use_routing_token: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpTcpPayload {
    pub connect_timeout_secs: Option<u64>,
    pub nodelay: Option<bool>,
    pub keep_alive: Option<bool>,
    pub keep_alive_interval_secs: Option<u64>,
    pub recv_buffer_size: Option<u32>,
    pub send_buffer_size: Option<u32>,
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

/// Build IronRDP BitmapCodecs from resolved settings.
/// When codecs are disabled, returns an empty list (raw/RLE only).
/// When enabled, constructs the negotiation list based on individual codec toggles.
fn build_bitmap_codecs(settings: &ResolvedSettings) -> ironrdp::pdu::rdp::capability_sets::BitmapCodecs {
    use ironrdp::pdu::rdp::capability_sets::{
        BitmapCodecs, CaptureFlags, Codec, CodecProperty, EntropyBits,
        RemoteFxContainer, RfxCaps, RfxCapset, RfxClientCapsContainer,
        RfxICap, RfxICapFlags,
    };

    if !settings.codecs_enabled {
        return BitmapCodecs(Vec::new());
    }

    let mut codecs = Vec::new();

    // RemoteFX (RFX) — DWT + RLGR entropy coding
    if settings.remotefx_enabled {
        let entropy = match settings.remotefx_entropy.as_str() {
            "rlgr1" => EntropyBits::Rlgr1,
            _ => EntropyBits::Rlgr3,
        };
        codecs.push(Codec {
            id: 3, // CODEC_ID_REMOTEFX
            property: CodecProperty::RemoteFx(RemoteFxContainer::ClientContainer(
                RfxClientCapsContainer {
                    capture_flags: CaptureFlags::empty(),
                    caps_data: RfxCaps(RfxCapset(vec![RfxICap {
                        flags: RfxICapFlags::empty(),
                        entropy_bits: entropy,
                    }])),
                },
            )),
        });
    }

    BitmapCodecs(codecs)
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
#[derive(Clone)]
struct ResolvedSettings {
    width: u16,
    height: u16,
    color_depth: u32,
    desktop_scale_factor: u32,
    lossy_compression: bool,
    enable_tls: bool,
    enable_credssp: bool,
    use_credssp: bool,
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
    // CredSSP remediation
    allow_hybrid_ex: bool,
    _nla_fallback_to_tls: bool,
    ntlm_enabled: bool,
    kerberos_enabled: bool,
    pku2u_enabled: bool,
    _restricted_admin: bool,
    sspi_package_list: String,
    _server_cert_validation: String,
    performance_flags: PerformanceFlags,
    // Gateway
    gateway_enabled: bool,
    gateway_hostname: String,
    gateway_port: u16,
    _gateway_auth_method: String,
    _gateway_transport_mode: String,
    _gateway_bypass_local: bool,
    // Hyper-V
    use_vm_id: bool,
    vm_id: String,
    enhanced_session_mode: bool,
    _host_server: String,
    // Negotiation
    auto_detect: bool,
    negotiation_strategy: String,
    max_retries: u32,
    retry_delay_ms: u64,
    load_balancing_info: String,
    use_routing_token: bool,
    // Frame delivery
    frame_batching: bool,
    frame_batch_interval: Duration,
    full_frame_sync_interval: u64,
    // Render backend
    render_backend: String,
    // Bitmap codecs
    codecs_enabled: bool,
    remotefx_enabled: bool,
    remotefx_entropy: String,
    // RDPGFX / H.264
    gfx_enabled: bool,
    h264_decoder_preference: crate::h264::H264DecoderPreference,
    // Session behaviour
    read_timeout: Duration,
    max_consecutive_errors: u32,
    stats_interval: Duration,
    // TCP / Socket
    tcp_connect_timeout: Duration,
    tcp_nodelay: bool,
    tcp_keep_alive: bool,
    tcp_keep_alive_interval: Duration,
    tcp_recv_buffer_size: u32,
    tcp_send_buffer_size: u32,
}

impl ResolvedSettings {
    fn from_payload(payload: &RdpSettingsPayload, width: u16, height: u16) -> Self {
        let display = payload.display.as_ref();
        let perf = payload.performance.as_ref();
        let sec = payload.security.as_ref();
        let input = payload.input.as_ref();
        let adv = payload.advanced.as_ref();
        let gw = payload.gateway.as_ref();
        let hv = payload.hyperv.as_ref();
        let nego = payload.negotiation.as_ref();

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

        // Master CredSSP toggle: if useCredSsp is false, force credssp off
        let use_credssp_master = sec.and_then(|s| s.use_credssp).unwrap_or(true);
        let enable_credssp_nla = sec.and_then(|s| s.enable_nla).unwrap_or(true);

        Self {
            width: w,
            height: h,
            color_depth: display.and_then(|d| d.color_depth).unwrap_or(32),
            desktop_scale_factor: display.and_then(|d| d.desktop_scale_factor).unwrap_or(100),
            lossy_compression: display.and_then(|d| d.lossy_compression).unwrap_or(true),
            enable_tls: sec.and_then(|s| s.enable_tls).unwrap_or(true),
            enable_credssp: use_credssp_master && enable_credssp_nla,
            use_credssp: use_credssp_master,
            autologon: sec.and_then(|s| s.auto_logon).unwrap_or(true),
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
            // CredSSP remediation
            allow_hybrid_ex: sec.and_then(|s| s.allow_hybrid_ex).unwrap_or(false),
            _nla_fallback_to_tls: sec.and_then(|s| s.nla_fallback_to_tls).unwrap_or(true),
            ntlm_enabled: sec.and_then(|s| s.ntlm_enabled).unwrap_or(true),
            kerberos_enabled: sec.and_then(|s| s.kerberos_enabled).unwrap_or(false),
            pku2u_enabled: sec.and_then(|s| s.pku2u_enabled).unwrap_or(false),
            _restricted_admin: sec.and_then(|s| s.restricted_admin).unwrap_or(false),
            sspi_package_list: sec
                .and_then(|s| s.sspi_package_list.clone())
                .unwrap_or_default(),
            _server_cert_validation: sec
                .and_then(|s| s.server_cert_validation.clone())
                .unwrap_or_else(|| "validate".to_string()),
            performance_flags,
            // Gateway
            gateway_enabled: gw.and_then(|g| g.enabled).unwrap_or(false),
            gateway_hostname: gw.and_then(|g| g.hostname.clone()).unwrap_or_default(),
            gateway_port: gw.and_then(|g| g.port).unwrap_or(443),
            _gateway_auth_method: gw
                .and_then(|g| g.auth_method.clone())
                .unwrap_or_else(|| "ntlm".to_string()),
            _gateway_transport_mode: gw
                .and_then(|g| g.transport_mode.clone())
                .unwrap_or_else(|| "auto".to_string()),
            _gateway_bypass_local: gw.and_then(|g| g.bypass_for_local).unwrap_or(true),
            // Hyper-V
            use_vm_id: hv.and_then(|h| h.use_vm_id).unwrap_or(false),
            vm_id: hv.and_then(|h| h.vm_id.clone()).unwrap_or_default(),
            enhanced_session_mode: hv.and_then(|h| h.enhanced_session_mode).unwrap_or(false),
            _host_server: hv.and_then(|h| h.host_server.clone()).unwrap_or_default(),
            // Negotiation
            auto_detect: nego.and_then(|n| n.auto_detect).unwrap_or(false),
            negotiation_strategy: nego
                .and_then(|n| n.strategy.clone())
                .unwrap_or_else(|| "nla-first".to_string()),
            max_retries: nego.and_then(|n| n.max_retries).unwrap_or(3),
            retry_delay_ms: nego.and_then(|n| n.retry_delay_ms).unwrap_or(1000),
            load_balancing_info: nego
                .and_then(|n| n.load_balancing_info.clone())
                .unwrap_or_default(),
            use_routing_token: nego.and_then(|n| n.use_routing_token).unwrap_or(false),
            // Frame delivery
            frame_batching: perf.and_then(|p| p.frame_batching).unwrap_or(false),
            frame_batch_interval: Duration::from_millis(batch_ms),
            full_frame_sync_interval: adv
                .and_then(|a| a.full_frame_sync_interval)
                .unwrap_or(1000),
            // Render backend
            render_backend: perf
                .and_then(|p| p.render_backend.clone())
                .unwrap_or_else(|| "webview".to_string()),
            // Bitmap codecs
            codecs_enabled: perf
                .and_then(|p| p.codecs.as_ref())
                .and_then(|c| c.enable_codecs)
                .unwrap_or(true),
            remotefx_enabled: perf
                .and_then(|p| p.codecs.as_ref())
                .and_then(|c| c.remote_fx)
                .unwrap_or(true),
            remotefx_entropy: perf
                .and_then(|p| p.codecs.as_ref())
                .and_then(|c| c.remote_fx_entropy.clone())
                .unwrap_or_else(|| "rlgr3".to_string()),
            gfx_enabled: perf
                .and_then(|p| p.codecs.as_ref())
                .and_then(|c| c.enable_gfx)
                .unwrap_or(false),
            h264_decoder_preference: match perf
                .and_then(|p| p.codecs.as_ref())
                .and_then(|c| c.h264_decoder.as_deref())
            {
                Some("media-foundation") => crate::h264::H264DecoderPreference::MediaFoundation,
                Some("openh264") => crate::h264::H264DecoderPreference::OpenH264,
                _ => crate::h264::H264DecoderPreference::Auto,
            },
            read_timeout: Duration::from_millis(
                adv.and_then(|a| a.read_timeout_ms).unwrap_or(16),
            ),
            max_consecutive_errors: adv
                .and_then(|a| a.max_consecutive_errors)
                .unwrap_or(50),
            stats_interval: Duration::from_secs(
                adv.and_then(|a| a.stats_interval_secs).unwrap_or(1),
            ),
            // TCP / Socket
            tcp_connect_timeout: Duration::from_secs(
                payload.tcp.as_ref().and_then(|t| t.connect_timeout_secs).unwrap_or(10),
            ),
            tcp_nodelay: payload.tcp.as_ref().and_then(|t| t.nodelay).unwrap_or(true),
            tcp_keep_alive: payload.tcp.as_ref().and_then(|t| t.keep_alive).unwrap_or(true),
            tcp_keep_alive_interval: Duration::from_secs(
                payload.tcp.as_ref().and_then(|t| t.keep_alive_interval_secs).unwrap_or(60),
            ),
            tcp_recv_buffer_size: payload.tcp.as_ref().and_then(|t| t.recv_buffer_size).unwrap_or(256 * 1024),
            tcp_send_buffer_size: payload.tcp.as_ref().and_then(|t| t.send_buffer_size).unwrap_or(256 * 1024),
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
    /// Lock-free FPS tracking: frame count snapshot and timestamp for
    /// computing frames-per-second without any Mutex on the hot path.
    fps_snapshot_count: AtomicU64,
    fps_snapshot_time: std::sync::Mutex<Instant>,
    fps_cached: std::sync::Mutex<f64>,
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
            fps_snapshot_count: AtomicU64::new(0),
            fps_snapshot_time: std::sync::Mutex::new(Instant::now()),
            fps_cached: std::sync::Mutex::new(0.0),
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

    /// Record a frame.  Lock-free: just an atomic increment.
    #[inline]
    fn record_frame(&self) {
        self.frame_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Compute approximate FPS from the delta between the current
    /// frame count and a snapshot taken ~1 s ago.  Only the periodic
    /// stats emitter calls this (once per second), so the two Mutex
    /// locks are completely off the hot path.
    fn current_fps(&self) -> f64 {
        let current = self.frame_count.load(Ordering::Relaxed);
        let now = Instant::now();
        let (fps, should_rotate) = {
            let prev_count = self.fps_snapshot_count.load(Ordering::Relaxed);
            if let Ok(prev_time) = self.fps_snapshot_time.lock() {
                let elapsed = now.duration_since(*prev_time).as_secs_f64();
                if elapsed >= 0.9 {
                    let delta = current.saturating_sub(prev_count) as f64;
                    let fps = if elapsed > 0.0 { delta / elapsed } else { 0.0 };
                    (fps, true)
                } else {
                    // Not enough time elapsed — return cached value
                    let cached = self.fps_cached.lock().map(|c| *c).unwrap_or(0.0);
                    (cached, false)
                }
            } else {
                (0.0, false)
            }
        };
        if should_rotate {
            self.fps_snapshot_count.store(current, Ordering::Relaxed);
            if let Ok(mut t) = self.fps_snapshot_time.lock() {
                *t = now;
            }
            if let Ok(mut c) = self.fps_cached.lock() {
                *c = fps;
            }
        }
        fps
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
#[serde(rename_all = "camelCase")]
pub struct RdpSession {
    pub id: String,
    /// Stable frontend connection ID used for lifecycle management.
    /// Multiple `connect_rdp` invocations with the same `connection_id`
    /// automatically evict any previous session for that slot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
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
    /// Attach a new frame channel viewer (for session persistence).
    AttachViewer(Channel<InvokeResponseBody>),
    /// Detach the current viewer without killing the session.
    DetachViewer,
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
            // Handle raw TCP/UDP Kerberos KDC requests with a short-
            // timeout TCP attempt so the Negotiate layer sees a quick
            // failure and falls back to NTLM instead of blocking for
            // minutes on unresolvable DNS SRV lookups.
            NetworkProtocol::Tcp | NetworkProtocol::Udp => {
                log::debug!(
                    "Kerberos KDC network request ({:?}) to {url} – attempting fast connect",
                    request.protocol,
                );
                // Try a quick TCP connect (1s).  If the KDC is unreachable
                // this will fail almost instantly.
                let addr_str = url
                    .trim_start_matches("tcp://")
                    .trim_start_matches("udp://");
                let sock = std::net::TcpStream::connect_timeout(
                    &addr_str
                        .to_socket_addrs()
                        .map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC address resolution failed: {e}"),
                            )
                        })?
                        .next()
                        .ok_or_else(|| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                "KDC address resolved to nothing".to_string(),
                            )
                        })?,
                    Duration::from_secs(1),
                );
                match sock {
                    Ok(mut stream) => {
                        use std::io::{Read, Write};
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        stream.write_all(&data).map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC write failed: {e}"),
                            )
                        })?;
                        let mut buf = vec![0u8; 65536];
                        let n = stream.read(&mut buf).map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC read failed: {e}"),
                            )
                        })?;
                        buf.truncate(n);
                        buf
                    }
                    Err(e) => {
                        log::debug!("KDC connection failed (expected): {e}");
                        return Err(ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::NoCredentials,
                            format!("KDC unreachable: {e}"),
                        ));
                    }
                }
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
            x, y, delta, horizontal,
        } => {
            let flags = if *horizontal {
                PointerFlags::HORIZONTAL_WHEEL
            } else {
                PointerFlags::VERTICAL_WHEEL
            };
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: *delta,
                x_position: *x,
                y_position: *y,
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
    frame_store: SharedFrameStoreState,
    frame_channel: Channel<InvokeResponseBody>,
) {
    let result = if settings.auto_detect {
        // ── Auto-detect negotiation: try different protocol combos ───
        run_rdp_session_auto_detect(
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
            &frame_store,
            &frame_channel,
        )
    } else {
        run_rdp_session_inner(
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
            &frame_store,
            &frame_channel,
        )
    };

    // Clean up the shared framebuffer slot when the session ends
    frame_store.remove(&session_id);

    stats.alive.store(false, Ordering::Relaxed);

    match result {
        Ok(()) => {
            log::info!("RDP session {session_id} ended normally");
            stats.set_phase("disconnected");
            // Only emit disconnected for clean exits – errors already emitted their own status.
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
        Err(e) => {
            let err_msg = format!("{e}");

            // Shutdown sentinel: the session was evicted or disconnected
            // before it could fully connect.  Treat this as a clean
            // disconnect rather than an error visible to the user.
            if err_msg.contains("session_shutdown") {
                log::info!("RDP session {session_id} was shut down before connecting");
                stats.set_phase("disconnected");
                let _ = app_handle.emit(
                    "rdp://status",
                    RdpStatusEvent {
                        session_id,
                        status: "disconnected".to_string(),
                        message: "Session cancelled".to_string(),
                        desktop_width: None,
                        desktop_height: None,
                    },
                );
                return;
            }

            log::error!("RDP session {session_id} error: {err_msg}");
            stats.set_phase("error");
            stats.set_last_error(&err_msg);
            let _ = app_handle.emit(
                "rdp://status",
                RdpStatusEvent {
                    session_id,
                    status: "error".to_string(),
                    message: err_msg,
                    desktop_width: None,
                    desktop_height: None,
                },
            );
        }
    }
}

/// Build a list of (enable_tls, enable_credssp, allow_hybrid_ex) combos to try
/// based on the negotiation strategy.
fn build_negotiation_combos(strategy: &str, base: &ResolvedSettings) -> Vec<(bool, bool, bool)> {
    match strategy {
        "nla-first" => vec![
            (true, true, base.allow_hybrid_ex),   // TLS + CredSSP (best)
            (true, true, !base.allow_hybrid_ex),   // TLS + CredSSP (flip HYBRID_EX)
            (true, false, false),                   // TLS only
            (false, false, false),                  // Plain (no security)
        ],
        "tls-first" => vec![
            (true, false, false),                   // TLS only
            (true, true, base.allow_hybrid_ex),     // TLS + CredSSP
            (true, true, !base.allow_hybrid_ex),    // TLS + CredSSP (flip HYBRID_EX)
            (false, false, false),                   // Plain
        ],
        "nla-only" => vec![
            (true, true, base.allow_hybrid_ex),
            (true, true, !base.allow_hybrid_ex),
        ],
        "tls-only" => vec![
            (true, false, false),
        ],
        "plain-only" => vec![
            (false, false, false),
        ],
        // "auto" – try everything
        _ => vec![
            (true, true, false),                    // TLS + CredSSP, no HYBRID_EX
            (true, true, true),                     // TLS + CredSSP, with HYBRID_EX
            (true, false, false),                   // TLS only
            (false, true, false),                   // CredSSP without TLS
            (false, false, false),                  // Plain
        ],
    }
}

/// Auto-detect negotiation: retry with different protocol combinations until
/// one works or all are exhausted.
///
/// **Phase 1** – vary `(tls, credssp, hybrid_ex)` with the user's full Config.
/// **Phase 2** – if Phase 1 failed at the BasicSettingsExchange (GCC/MCS)
///   stage, re-run the winning-protocol combo (or all combos) with a
///   *minimal* Config identical to the diagnostic probe.  The diagnostic
///   probe often succeeds because it strips load-balancing info, SSPI
///   restrictions, audio, autologon, etc.
#[allow(clippy::too_many_arguments)]
fn run_rdp_session_auto_detect(
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
    frame_store: &SharedFrameStoreState,
    frame_channel: &Channel<InvokeResponseBody>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let combos = build_negotiation_combos(&settings.negotiation_strategy, settings);
    let max_attempts = (settings.max_retries as usize + 1).min(combos.len());

    log::info!(
        "RDP session {session_id}: auto-detect starting with {} combos (strategy={})",
        max_attempts,
        settings.negotiation_strategy
    );

    let mut last_error: Option<Box<dyn std::error::Error + Send + Sync>> = None;
    let mut had_basic_settings_failure = false;

    // ── Phase 1: vary protocol flags with user Config ────────────────

    for (i, (tls, credssp, hybrid_ex)) in combos.iter().take(max_attempts).enumerate() {
        log::info!(
            "RDP session {session_id}: auto-detect attempt {}/{} → tls={} credssp={} hybrid_ex={}",
            i + 1, max_attempts, tls, credssp, hybrid_ex
        );

        let _ = app_handle.emit(
            "rdp://status",
            RdpStatusEvent {
                session_id: session_id.to_string(),
                status: "negotiating".to_string(),
                message: format!(
                    "Auto-detect attempt {}/{}: TLS={} CredSSP={} HYBRID_EX={}",
                    i + 1, max_attempts, tls, credssp, hybrid_ex
                ),
                desktop_width: None,
                desktop_height: None,
            },
        );

        let mut attempt_settings = ResolvedSettings {
            enable_tls: *tls,
            enable_credssp: *credssp,
            allow_hybrid_ex: *hybrid_ex,
            ..settings.clone()
        };
        if !credssp {
            attempt_settings.sspi_package_list = String::new();
        }

        let result = run_rdp_session_inner(
            session_id,
            host,
            port,
            username,
            password,
            domain,
            &attempt_settings,
            app_handle,
            cmd_rx,
            stats,
            cached_tls_connector.clone(),
            cached_http_client.clone(),
            frame_store,
            frame_channel,
        );

        match result {
            Ok(()) => {
                log::info!(
                    "RDP session {session_id}: auto-detect succeeded on attempt {} (tls={} credssp={} hybrid_ex={})",
                    i + 1, tls, credssp, hybrid_ex
                );
                return Ok(());
            }
            Err(e) => {
                let err_str = format!("{e}");
                if err_str.contains("session_shutdown") {
                    log::info!(
                        "RDP session {session_id}: auto-detect aborting (session shutdown)"
                    );
                    return Err(e);
                }

                // Track whether any failure was at the BasicSettingsExchange
                // (GCC/MCS) stage — this means the protocol itself was fine
                // but the Config fields upset the server.
                if err_str.contains("BasicSettingsExchange")
                    || err_str.contains("basic settings")
                    || err_str.contains("connect_finalize")
                {
                    had_basic_settings_failure = true;
                }

                log::warn!(
                    "RDP session {session_id}: auto-detect attempt {} failed: {e}",
                    i + 1
                );
                last_error = Some(e);

                if i + 1 < max_attempts {
                    std::thread::sleep(Duration::from_millis(settings.retry_delay_ms));
                }
            }
        }
    }

    // ── Phase 2: try minimal/fallback Config ─────────────────────────
    // If we saw a BasicSettingsExchange failure the protocol negotiation
    // itself worked — the server just didn't like something in the GCC
    // Conference Create data.  Re-try with a stripped-down Config that
    // mirrors what the diagnostic probe sends (which often succeeds).
    //
    // We also vary the color depth: some servers reject 24-bit but accept
    // 32 or 16.  The order [32, 16] covers the vast majority of cases.

    if had_basic_settings_failure {
        log::info!(
            "RDP session {session_id}: auto-detect Phase 2 — retrying with minimal Config \
             (BasicSettingsExchange failures detected in Phase 1)"
        );

        let fallback_combos = build_negotiation_combos(&settings.negotiation_strategy, settings);
        let fallback_max = (settings.max_retries as usize + 1).min(fallback_combos.len());
        let color_depths: &[u32] = &[32, 16];
        let total_fallback = fallback_max * color_depths.len();
        let mut attempt_num = 0usize;

        for (_i, (tls, credssp, hybrid_ex)) in fallback_combos.iter().take(fallback_max).enumerate() {
            for &depth in color_depths {
                attempt_num += 1;
                log::info!(
                    "RDP session {session_id}: auto-detect fallback {}/{} → tls={} credssp={} hybrid_ex={} color={}bpp (minimal config)",
                    attempt_num, total_fallback, tls, credssp, hybrid_ex, depth
                );

                let _ = app_handle.emit(
                    "rdp://status",
                    RdpStatusEvent {
                        session_id: session_id.to_string(),
                        status: "negotiating".to_string(),
                        message: format!(
                            "Auto-detect fallback {}/{}: TLS={} CredSSP={} HYBRID_EX={} color={}bpp (simplified)",
                            attempt_num, total_fallback, tls, credssp, hybrid_ex, depth
                        ),
                        desktop_width: None,
                        desktop_height: None,
                    },
                );

                // Build minimal settings — keep the protocol flags but strip
                // everything that might upset the GCC exchange.
                let mut fallback_settings = ResolvedSettings {
                    enable_tls: *tls,
                    enable_credssp: *credssp,
                    allow_hybrid_ex: *hybrid_ex,
                    // Minimal display — matches diagnostic probe
                    width: 1024,
                    height: 768,
                    desktop_scale_factor: 100,
                    lossy_compression: false,
                    color_depth: depth,
                    // Strip load-balancing / routing
                    load_balancing_info: String::new(),
                    use_routing_token: false,
                    // No autologon, no audio
                    autologon: false,
                    enable_audio_playback: false,
                    // No SSPI restrictions
                    sspi_package_list: String::new(),
                    // Keep everything else from the user settings
                    ..settings.clone()
                };
                if !credssp {
                    fallback_settings.sspi_package_list = String::new();
                }

                let result = run_rdp_session_inner(
                    session_id,
                    host,
                    port,
                    username,
                    password,
                    domain,
                    &fallback_settings,
                    app_handle,
                    cmd_rx,
                    stats,
                    cached_tls_connector.clone(),
                    cached_http_client.clone(),
                    frame_store,
                    frame_channel,
                );

                match result {
                    Ok(()) => {
                        log::info!(
                            "RDP session {session_id}: auto-detect fallback succeeded on attempt {} \
                             (tls={} credssp={} hybrid_ex={} color={}bpp, minimal config). \
                             The server rejected the original Config at BasicSettingsExchange — \
                             one of: color_depth, load_balancing_info, sspi_package_list, autologon, \
                             audio, desktop_size, or lossy_compression was the culprit.",
                            attempt_num, tls, credssp, hybrid_ex, depth
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        let err_str = format!("{e}");
                        if err_str.contains("session_shutdown") {
                            log::info!(
                                "RDP session {session_id}: auto-detect fallback aborting (session shutdown)"
                            );
                            return Err(e);
                        }

                        log::warn!(
                            "RDP session {session_id}: auto-detect fallback {} failed: {e}",
                            attempt_num
                        );
                        last_error = Some(e);

                        if attempt_num < total_fallback {
                            std::thread::sleep(Duration::from_millis(settings.retry_delay_ms));
                        }
                    }
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        format!(
            "Auto-detect exhausted all {} negotiation strategies{}",
            max_attempts,
            if had_basic_settings_failure {
                " (including minimal-config fallback)"
            } else {
                ""
            }
        )
        .into()
    }))
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
    frame_store: &SharedFrameStoreState,
    frame_channel: &Channel<InvokeResponseBody>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conn_start = Instant::now();

    // ── 0. Pre-flight shutdown check ────────────────────────────────────
    // If an evict/disconnect was sent before we even started, bail out.
    // Return a sentinel error so auto-detect does NOT interpret this as
    // "connected successfully".
    match cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown before connect (pre-flight)");
            return Err("session_shutdown: cancelled before connect".into());
        }
        _ => {}
    }

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
    let tcp_stream = TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout)?;
    tcp_stream.set_nodelay(settings.tcp_nodelay)?;

    // TCP keep-alive
    if settings.tcp_keep_alive {
        use socket2::Socket;
        let sock = Socket::from(tcp_stream.try_clone()?);
        let ka = socket2::TcpKeepalive::new()
            .with_time(settings.tcp_keep_alive_interval);
        let _ = sock.set_tcp_keepalive(&ka);
        std::mem::forget(sock);
    }

    // Configure socket buffer sizes
    {
        use socket2::Socket;
        let sock = Socket::from(tcp_stream.try_clone()?);
        let _ = sock.set_recv_buffer_size(settings.tcp_recv_buffer_size as usize);
        let _ = sock.set_send_buffer_size(settings.tcp_send_buffer_size as usize);
        // Detach without closing – the TcpStream still owns the fd
        std::mem::forget(sock);
    }
    let tcp_ms = t_tcp.elapsed().as_millis();
    log::info!("RDP session {session_id}: TCP connected in {tcp_ms}ms");

    // ── Shutdown check after TCP connect ──────────────────────────────
    match cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown after TCP connect");
            return Err("session_shutdown: cancelled after TCP connect".into());
        }
        _ => {}
    }

    let mut framed = Framed::new(tcp_stream);

    // ── 2. Build IronRDP connector config ───────────────────────────────

    stats.set_phase("configuring");

    // Normalise domain / username.  The user may type "DOMAIN\user",
    // "user@domain.com", or just "user" with the domain in a separate
    // field.  We need:
    //   • `actual_user`   – the bare account name (no domain prefix/suffix)
    //   • `actual_domain` – the NetBIOS or DNS domain, or None
    let (actual_user, actual_domain): (String, Option<String>) = if domain.is_some() {
        // Domain was provided explicitly — use as-is
        (username.to_string(), domain.map(String::from))
    } else if let Some((d, u)) = username.split_once('\\') {
        // Down-level logon name: DOMAIN\user
        (u.to_string(), Some(d.to_string()))
    } else if let Some((u, d)) = username.rsplit_once('@') {
        // UPN: user@domain.com
        (u.to_string(), Some(d.to_string()))
    } else {
        // No domain anywhere — try the target hostname as a last resort.
        // For a domain-joined server the user MUST provide a domain, but
        // for a standalone/workgroup server the hostname usually works.
        (username.to_string(), None)
    };

    log::info!(
        "RDP session {session_id}: resolved credentials user={:?} domain={:?} (original: {:?}/{:?})",
        actual_user, actual_domain, username, domain
    );

    let config = connector::Config {
        credentials: Credentials::UsernamePassword {
            username: actual_user.clone(),
            password: password.to_string(),
        },
        domain: actual_domain,
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
            codecs: build_bitmap_codecs(&settings),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: {
            // Load-balancing info: routing token or cookie
            let lb = &settings.load_balancing_info;
            if !lb.is_empty() {
                if settings.use_routing_token {
                    // Routing token for RDP load balancers (Session Broker, etc.)
                    Some(ironrdp::pdu::nego::NegoRequestData::routing_token(lb.clone()))
                } else {
                    // Cookie format (standard mstshash cookie)
                    Some(ironrdp::pdu::nego::NegoRequestData::cookie(lb.clone()))
                }
            } else if settings.use_vm_id && !settings.vm_id.is_empty() {
                // For Hyper-V: use VM ID as a routing token
                Some(ironrdp::pdu::nego::NegoRequestData::cookie(
                    format!("vmconnect/{}", settings.vm_id),
                ))
            } else {
                None
            }
        },
        autologon: settings.autologon,
        enable_audio_playback: settings.enable_audio_playback,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: settings.enable_server_pointer,
        pointer_software_rendering: settings.pointer_software_rendering,
        allow_hybrid_ex: settings.allow_hybrid_ex,
        sspi_package_list: {
            // Build SSPI package list from individual flags, or use explicit override
            let explicit = &settings.sspi_package_list;
            if explicit.is_empty() {
                // Derive from enable flags
                let mut excludes = Vec::new();
                if !settings.ntlm_enabled {
                    excludes.push("!ntlm");
                }
                if !settings.kerberos_enabled {
                    excludes.push("!kerberos");
                }
                if !settings.pku2u_enabled {
                    excludes.push("!pku2u");
                }
                if excludes.is_empty() {
                    None // no restrictions
                } else {
                    Some(excludes.join(","))
                }
            } else {
                Some(explicit.clone())
            }
        },
    };

    let server_socket_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut connector = ClientConnector::new(config, server_socket_addr);

    // ── Register RDPGFX Dynamic Virtual Channel (H.264 hardware decode) ──
    let gfx_frame_rx = if settings.gfx_enabled {
        let (gfx_tx, gfx_rx) = std::sync::mpsc::channel::<crate::gfx::processor::GfxFrame>();
        let gfx_proc = crate::gfx::processor::GfxProcessor::new(
            settings.h264_decoder_preference,
            gfx_tx,
        );
        let drdynvc = ironrdp_dvc::DrdynvcClient::new()
            .with_dynamic_channel(gfx_proc);
        connector.attach_static_channel(drdynvc);
        log::info!("RDP session {session_id}: RDPGFX DVC registered (H.264 decode enabled)");
        Some(gfx_rx)
    } else {
        None
    };

    // Log gateway / Hyper-V / negotiation settings
    if settings.gateway_enabled {
        log::info!(
            "RDP session {session_id}: gateway enabled → {}:{}",
            settings.gateway_hostname, settings.gateway_port
        );
    }
    if settings.use_vm_id {
        log::info!(
            "RDP session {session_id}: Hyper-V VM ID mode → vm_id={:?} enhanced={}",
            settings.vm_id, settings.enhanced_session_mode
        );
    }
    if settings.auto_detect {
        log::info!(
            "RDP session {session_id}: auto-detect negotiation → strategy={} maxRetries={}",
            settings.negotiation_strategy, settings.max_retries
        );
    }
    if !settings.load_balancing_info.is_empty() {
        log::info!(
            "RDP session {session_id}: load balancing info → {:?} (routing_token={})",
            settings.load_balancing_info, settings.use_routing_token
        );
    }
    if !settings.use_credssp {
        log::info!("RDP session {session_id}: CredSSP globally DISABLED by user");
    }

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
    log::info!(
        "RDP session {session_id}: server public key: {} bytes, first 16: {:02x?}",
        server_public_key.len(),
        &server_public_key[..server_public_key.len().min(16)]
    );

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

    // ── Shutdown check before CredSSP/NLA ─────────────────────────────
    match cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown before CredSSP");
            return Err("session_shutdown: cancelled before CredSSP".into());
        }
        _ => {}
    }

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
    .map_err(|e| {
        // Walk the error source chain to surface the real underlying cause
        let mut msg = format!("connect_finalize failed: {e}");
        let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
        while let Some(cause) = source {
            msg.push_str(&format!(", caused by: {cause}"));
            source = std::error::Error::source(cause);
        }

        // Include timing context
        let fail_auth_ms = t_auth.elapsed().as_millis();
        msg.push_str(&format!(
            " [phase=BasicSettingsExchange, auth_elapsed={fail_auth_ms}ms, tcp={tcp_ms}ms, tls={tls_ms}ms, negotiate={negotiate_ms}ms]"
        ));

        // Detect the very common "server closed after CredSSP" pattern and
        // provide actionable guidance.
        if msg.contains("10054") || msg.contains("forcibly closed") {
            msg.push_str(
                ".  NOTE: the server closed the connection after NLA/CredSSP authentication. \
                 Common causes: (1) incorrect credentials or domain, \
                 (2) the user account lacks 'Allow log on through Remote Desktop Services' right, \
                 (3) the account is locked/disabled, \
                 (4) CredSSP Encryption Oracle Remediation policy ('Force Updated Clients') on the server, \
                 (5) RD licensing server misconfigured or license limit exceeded, \
                 (6) Group Policy blocking session (e.g. max sessions, user restrictions)."
            );
        }
        msg
    })?;
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

    // Initialize the shared framebuffer slot for this session
    frame_store.init(session_id, desktop_width, desktop_height);

    // ── 6b. Create frame compositor (if requested) ────────────────────
    let render_backend = RenderBackend::from_str(&settings.render_backend);
    let mut compositor: Option<Box<dyn FrameCompositor>> = None;
    let mut active_render_backend = "webview".to_string();

    if render_backend.is_composited() {
        match native_renderer::create_compositor(
            &render_backend,
            desktop_width,
            desktop_height,
        ) {
            Some((comp, backend_name)) => {
                log::info!(
                    "RDP session {session_id}: compositor '{backend_name}' created for {desktop_width}×{desktop_height}"
                );
                active_render_backend = backend_name;
                compositor = Some(comp);
            }
            None => {
                log::info!(
                    "RDP session {session_id}: no compositor needed (webview direct streaming)"
                );
            }
        }
    }

    // Viewer channel management for session persistence.
    // Initially we use the channel provided at connect time.  AttachViewer
    // replaces it with a new channel (viewer reconnection).  DetachViewer
    // disables frame streaming (session continues headless).
    let mut viewer_detached = false;
    let mut attached_channel: Option<Channel<InvokeResponseBody>> = None;

    // Notify the frontend which render backend is actually active
    let _ = app_handle.emit(
        "rdp://render-backend",
        serde_json::json!({
            "session_id": session_id,
            "backend": active_render_backend,
        }),
    );

    // Set a short read timeout so we can interleave input handling
    set_read_timeout_on_framed(&tls_framed, Some(settings.read_timeout));

    // ── 7. Main session loop ────────────────────────────────────────────

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

    // ── Reusable buffers (avoid per-iteration allocations) ─────────────
    let mut merged_inputs: Vec<FastPathInputEvent> = Vec::new();
    let mut batch_dirty_rects: Vec<(u16, u16, u16, u16)> = Vec::new();
    let mut gfx_frames: Vec<crate::gfx::processor::GfxFrame> = Vec::new();

    // ── Adaptive read timeout ─────────────────────────────────────────
    // When frames are actively streaming the server sends data frequently,
    // so we only need a short timeout to interleave input handling (16 ms).
    // When idle for a while we scale up to 50 ms to cut wakeups by ~3×.
    let timeout_active = Duration::from_millis(4);
    let timeout_idle = Duration::from_millis(50);
    let idle_threshold = Duration::from_millis(500);
    let mut last_data_received = Instant::now();
    let mut current_timeout = timeout_active;

    loop {
        // ─ Drain ALL pending commands (input coalescing) ───────────────
        // Reading only one command per iteration adds up to read_timeout
        // latency per buffered event.  Draining all pending commands and
        // merging input events keeps the cursor responsive.
        merged_inputs.clear();
        let mut should_break = false;
        loop {
            match cmd_rx.try_recv() {
                Ok(RdpCommand::Shutdown) => {
                    log::info!("RDP session {session_id}: shutdown requested");
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
                    should_break = true;
                    break;
                }
                Ok(RdpCommand::Input(events)) => {
                    merged_inputs.extend(events);
                }
                Ok(RdpCommand::AttachViewer(new_channel)) => {
                    log::info!(
                        "RDP session {session_id}: viewer attached (new frame channel)"
                    );
                    attached_channel = Some(new_channel);
                    viewer_detached = false;
                }
                Ok(RdpCommand::DetachViewer) => {
                    log::info!("RDP session {session_id}: viewer detached");
                    viewer_detached = true;
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    log::info!("RDP session {session_id}: command channel closed");
                    should_break = true;
                    break;
                }
            }
        }

        if should_break {
            break;
        }
        // Send all coalesced input in a single batch
        if !merged_inputs.is_empty() {
            stats
                .input_events
                .fetch_add(merged_inputs.len() as u64, Ordering::Relaxed);
            let active_ch = if !viewer_detached {
                attached_channel.as_ref().unwrap_or(frame_channel)
            } else {
                frame_channel // will fail silently on send
            };
            match active_stage.process_fastpath_input(&mut image, &merged_inputs) {
                Ok(outputs) => {
                    if !viewer_detached {
                        process_outputs(
                            session_id,
                            &outputs,
                            &mut tls_framed,
                            &image,
                            desktop_width,
                            desktop_height,
                            app_handle,
                            stats,
                            full_frame_sync_interval,
                            frame_store,
                            active_ch,
                        )?;
                    } else {
                        // Still need to send ResponseFrames even when viewer is detached
                        for output in &outputs {
                            if let ActiveStageOutput::ResponseFrame(data) = output {
                                stats
                                    .bytes_sent
                                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                                stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                if let Err(e) = tls_framed.write_all(data) {
                                    return Err(format!("Write failed: {e}").into());
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("RDP {session_id}: input processing error: {e}");
                }
            }
        }

        // ─ Emit periodic stats ─────────────────────────────────────────
        if last_stats_emit.elapsed() >= stats_interval {
            let _ = app_handle.emit("rdp://stats", stats.to_event(session_id));
            last_stats_emit = Instant::now();
        }

        // ─ Flush batched frame updates ─────────────────────────────────
        if frame_batching && !dirty_regions.is_empty() && last_frame_emit.elapsed() >= batch_interval {
            merge_dirty_regions(&mut dirty_regions);
            if !viewer_detached {
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                if let Some(ref mut comp) = compositor {
                    // Compositor: update regions and flush composed frame
                    for &(x, y, w, h) in &dirty_regions {
                        if w > 0 && h > 0 {
                            comp.update_region(image.data(), desktop_width, x, y, w, h);
                        }
                    }
                    if let Some(frame) = comp.flush() {
                        push_compositor_frame_via_channel(frame, active_ch);
                    }
                } else {
                    push_multi_rect_via_channel(
                        image.data(), desktop_width, &dirty_regions, active_ch,
                    );
                }
            }
            dirty_regions.clear();
            last_frame_emit = Instant::now();
        }

        // ─ Drain GFX decoded frames (H.264 via RDPGFX DVC) ──────────
        if let Some(ref gfx_rx) = gfx_frame_rx {
            // Collect all pending frames, then apply frame-skip if too many.
            gfx_frames.clear();
            while let Ok(gfx_frame) = gfx_rx.try_recv() {
                gfx_frames.push(gfx_frame);
            }
            // Frame skip: if decoder is faster than frontend, keep only the last 2.
            if gfx_frames.len() > 4 {
                let skip = gfx_frames.len() - 2;
                gfx_frames.drain(..skip);
            }
            for gfx_frame in gfx_frames.drain(..) {
                stats.record_frame();
                if viewer_detached {
                    continue;
                }
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                // Prepend 8-byte header in-place instead of copying the entire
                // RGBA buffer (~8 MB at 1080p) into a new allocation.
                let mut payload = gfx_frame.rgba;
                payload.reserve(8); // may no-op if spare capacity exists
                // Shift existing data right by 8 bytes to make room for header.
                let len = payload.len();
                // SAFETY: we just reserved 8 extra bytes; the copy stays within
                // the allocated region.  set_len is safe because all bytes in
                // [0..len] were valid and [len..len+8] are now written below.
                unsafe {
                    payload.set_len(len + 8);
                    std::ptr::copy(payload.as_ptr(), payload.as_mut_ptr().add(8), len);
                }
                payload[0..2].copy_from_slice(&gfx_frame.screen_x.to_le_bytes());
                payload[2..4].copy_from_slice(&gfx_frame.screen_y.to_le_bytes());
                payload[4..6].copy_from_slice(&gfx_frame.width.to_le_bytes());
                payload[6..8].copy_from_slice(&gfx_frame.height.to_le_bytes());
                let _ = active_ch.send(InvokeResponseBody::Raw(payload));
            }
        }

        // ─ Read and process PDUs ─────────────────────────────────────────
        // Process PDUs that are already buffered (zero I/O cost) plus the
        // first blocking read.  No timeout toggling, no input interleaving
        // inside the loop — keep it simple and fast.  Input is handled at
        // the top of the outer loop (every ~16ms).
        batch_dirty_rects.clear();
        let mut batch_had_graphics = false;
        let mut batch_should_reactivate: Option<Box<ironrdp::connector::connection_activation::ConnectionActivationSequence>> = None;
        let mut batch_should_terminate = false;
        let mut pdus_this_batch: u32 = 0;

        loop {
            // Inner PDU drain loop — only continues when the internal BytesMut
            // buffer already contains data (no I/O, sub-microsecond per call).
            // The first iteration uses the normal read timeout; subsequent
            // iterations skip entirely if the buffer is empty.
            if pdus_this_batch > 0 && tls_framed.peek().is_empty() {
                break; // No buffered data → flush and return to outer loop
            }

            match tls_framed.read_pdu() {
                Ok((action, payload)) => {
                    consecutive_errors = 0;
                    last_data_received = Instant::now();
                    if current_timeout != timeout_active {
                        current_timeout = timeout_active;
                        set_read_timeout_on_framed(&tls_framed, Some(current_timeout));
                    }
                    let payload_len = payload.len() as u64;
                    stats
                        .bytes_received
                        .fetch_add(payload_len, Ordering::Relaxed);
                    stats.pdus_received.fetch_add(1, Ordering::Relaxed);

                    match active_stage.process(&mut image, action, payload.as_ref()) {
                        Ok(outputs) => {
                            for output in outputs {
                                match output {
                                    ActiveStageOutput::ResponseFrame(data) => {
                                        stats
                                            .bytes_sent
                                            .fetch_add(data.len() as u64, Ordering::Relaxed);
                                        stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                        if let Err(e) = tls_framed.write_all(&data) {
                                            return Err(
                                                format!("Failed to send response frame: {e}")
                                                    .into(),
                                            );
                                        }
                                    }
                                    ActiveStageOutput::GraphicsUpdate(region) => {
                                        stats.record_frame();
                                        batch_had_graphics = true;
                                        let rw = region.right.saturating_sub(region.left) + 1;
                                        let rh = region.bottom.saturating_sub(region.top) + 1;
                                        if frame_batching {
                                            dirty_regions.push((region.left, region.top, rw, rh));
                                        } else if let Some(ref mut comp) = compositor {
                                            comp.update_region(
                                                image.data(), desktop_width,
                                                region.left, region.top, rw, rh,
                                            );
                                        } else {
                                            batch_dirty_rects.push((region.left, region.top, rw, rh));
                                        }
                                    }
                                    ActiveStageOutput::PointerDefault => {
                                        let _ = app_handle.emit("rdp://pointer", RdpPointerEvent {
                                            session_id: session_id.to_string(),
                                            pointer_type: "default".to_string(), x: None, y: None,
                                        });
                                    }
                                    ActiveStageOutput::PointerHidden => {
                                        let _ = app_handle.emit("rdp://pointer", RdpPointerEvent {
                                            session_id: session_id.to_string(),
                                            pointer_type: "hidden".to_string(), x: None, y: None,
                                        });
                                    }
                                    ActiveStageOutput::PointerPosition { x, y } => {
                                        let _ = app_handle.emit("rdp://pointer", RdpPointerEvent {
                                            session_id: session_id.to_string(),
                                            pointer_type: "position".to_string(),
                                            x: Some(x), y: Some(y),
                                        });
                                    }
                                    ActiveStageOutput::PointerBitmap(_bitmap) => {}
                                    ActiveStageOutput::Terminate(reason) => {
                                        log::info!("RDP session {session_id}: server terminated: {reason:?}");
                                        stats.set_phase("terminated");
                                        batch_should_terminate = true;
                                    }
                                    ActiveStageOutput::DeactivateAll(cas) => {
                                        batch_should_reactivate = Some(cas);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let err_str = format!("{e}");
                            log::warn!("RDP session {session_id}: PDU processing error (recovering): {err_str}");
                            stats.errors_recovered.fetch_add(1, Ordering::Relaxed);
                            stats.set_last_error(&err_str);
                            consecutive_errors += 1;
                            if consecutive_errors >= max_consecutive_errors {
                                return Err(format!(
                                    "Too many consecutive errors ({consecutive_errors}), last: {err_str}"
                                ).into());
                            }
                        }
                    }

                    pdus_this_batch += 1;
                    if batch_should_reactivate.is_some() || batch_should_terminate {
                        break;
                    }
                }
                Err(e) if is_timeout_error(&e) => {
                    if pdus_this_batch == 0 {
                        if current_timeout == timeout_active
                            && last_data_received.elapsed() >= idle_threshold
                        {
                            current_timeout = timeout_idle;
                            set_read_timeout_on_framed(&tls_framed, Some(current_timeout));
                        }
                    }
                    break;
                }
                Err(e) => {
                    if e.kind() == io::ErrorKind::UnexpectedEof {
                        log::info!("RDP session {session_id}: server closed connection (EOF)");
                        return Ok(());
                    }
                    let err_str = format!("{e}");
                    log::error!("RDP session {session_id}: read error: {err_str}");
                    return Err(format!("Read error: {err_str}").into());
                }
            }
        } // end inner PDU drain loop

        // Flush accumulated dirty rects from this batch.
        if batch_had_graphics && !frame_batching {
            if let Some(ref mut comp) = compositor {
                if !viewer_detached {
                    if let Some(frame) = comp.flush() {
                        let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                        push_compositor_frame_via_channel(frame, active_ch);
                    }
                }
            } else if !batch_dirty_rects.is_empty() && !viewer_detached {
                merge_dirty_regions(&mut batch_dirty_rects);
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                // Send ALL rects in a single Channel message to reduce IPC
                // overhead — one send() instead of N, one ArrayBuffer instead
                // of N on the JS side.
                push_multi_rect_via_channel(
                    image.data(), desktop_width, &batch_dirty_rects, active_ch,
                );
            }

            let fc = stats.frame_count.load(Ordering::Relaxed);
            if fc > 0 && fc % full_frame_sync_interval == 0 {
                frame_store.update_region(
                    session_id, image.data(), desktop_width,
                    &ironrdp::pdu::geometry::InclusiveRectangle {
                        left: 0, top: 0,
                        right: desktop_width.saturating_sub(1),
                        bottom: desktop_height.saturating_sub(1),
                    },
                );
            }
        }

        if batch_should_terminate {
            return Ok(());
        }

        if let Some(cas) = batch_should_reactivate {
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

            // Remove read timeout for reactivation
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
                    frame_store.reinit(session_id, desktop_width, desktop_height);
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

    // Drop compositor on session end
    if let Some(ref comp) = compositor {
        log::info!("RDP session {session_id}: dropping compositor '{}'", comp.name());
    }
    drop(compositor);

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
    _app_handle: &AppHandle,
    stats: &RdpSessionStats,
    full_frame_sync_interval: u64,
    frame_store: &SharedFrameStore,
    frame_channel: &Channel<InvokeResponseBody>,
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
                // Push dirty region directly through the Channel (no event+invoke round-trip)
                push_frame_via_channel(image.data(), desktop_width, region, frame_channel);
                let fc = stats.frame_count.load(Ordering::Relaxed);
                if fc > 0 && fc % full_frame_sync_interval == 0 {
                    send_full_frame_via_channel(
                        session_id,
                        image,
                        desktop_width,
                        desktop_height,
                        frame_channel,
                        frame_store,
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Merge overlapping/adjacent dirty regions to reduce Channel sends.
///
/// Sorts by (y, x) then greedily merges rects whose bounding boxes overlap.
/// If the result still has more than `MAX_REGIONS` rects, collapses everything
/// into a single bounding rect.
fn merge_dirty_regions(regions: &mut Vec<(u16, u16, u16, u16)>) {
    if regions.len() <= 1 {
        return;
    }

    // Sort by top-left for spatial coherence.
    regions.sort_unstable_by_key(|&(x, y, _, _)| (y, x));

    let mut merged: Vec<(u16, u16, u16, u16)> = Vec::with_capacity(regions.len());
    merged.push(regions[0]);

    for &(rx, ry, rw, rh) in &regions[1..] {
        let last = merged.last_mut().unwrap();
        let (lx, ly, lw, lh) = *last;

        // Check overlap: two rects overlap if neither is entirely left/right/above/below.
        let l_right = lx.saturating_add(lw);
        let l_bottom = ly.saturating_add(lh);
        let r_right = rx.saturating_add(rw);
        let r_bottom = ry.saturating_add(rh);

        if rx <= l_right && lx <= r_right && ry <= l_bottom && ly <= r_bottom {
            // Merge into bounding rect.
            let new_x = lx.min(rx);
            let new_y = ly.min(ry);
            let new_right = l_right.max(r_right);
            let new_bottom = l_bottom.max(r_bottom);
            *last = (new_x, new_y, new_right - new_x, new_bottom - new_y);
        } else {
            merged.push((rx, ry, rw, rh));
        }
    }

    // Don't collapse to a single bounding rect — scattered small rects
    // (e.g. 10 × 100×100 = 400 KB) would expand into one huge rect
    // (e.g. 1920×800 = 6 MB), amplifying data by 15×.  Just send the
    // individually merged rects; Channel overhead per rect is negligible.
    *regions = merged;
}

/// Push multiple dirty regions in a single Channel message.
///
/// Binary protocol: concatenated `[header][pixels][header][pixels]...`
/// where each header is 8 bytes `[x:u16LE, y:u16LE, w:u16LE, h:u16LE]`.
/// JS walks the buffer with an offset, parsing rects until exhausted.
///
/// This reduces IPC overhead dramatically — one `Channel.send()` and one
/// `ArrayBuffer` allocation instead of N.
#[inline]
fn push_multi_rect_via_channel(
    image_data: &[u8],
    fb_width: u16,
    rects: &[(u16, u16, u16, u16)],
    frame_channel: &Channel<InvokeResponseBody>,
) {
    if rects.is_empty() {
        return;
    }

    let bpp = 4usize;
    let stride = fb_width as usize * bpp;

    // Pre-calculate total size for a single allocation.
    let total: usize = rects
        .iter()
        .filter(|&&(_, _, w, h)| w > 0 && h > 0)
        .map(|&(_, _, w, h)| 8 + w as usize * h as usize * bpp)
        .sum();
    if total == 0 {
        return;
    }

    let mut payload = Vec::with_capacity(total);
    for &(x, y, w, h) in rects {
        if w == 0 || h == 0 {
            continue;
        }
        let left = x as usize;
        let top = y as usize;
        let rw = w as usize;
        let rh = h as usize;
        let bottom = top + rh - 1;
        let row_bytes = rw * bpp;

        // 8-byte header
        let header: [u8; 8] = {
            let mut hdr = [0u8; 8];
            hdr[0..2].copy_from_slice(&x.to_le_bytes());
            hdr[2..4].copy_from_slice(&y.to_le_bytes());
            hdr[4..6].copy_from_slice(&w.to_le_bytes());
            hdr[6..8].copy_from_slice(&h.to_le_bytes());
            hdr
        };
        payload.extend_from_slice(&header);

        // Pixel data
        let last_row_end = bottom * stride + left * bpp + row_bytes;
        if last_row_end <= image_data.len() {
            if left == 0 && rw == fb_width as usize {
                let start = top * stride;
                let end = (bottom + 1) * stride;
                payload.extend_from_slice(&image_data[start..end]);
            } else {
                for row in top..=bottom {
                    let row_start = row * stride + left * bpp;
                    payload.extend_from_slice(&image_data[row_start..row_start + row_bytes]);
                }
            }
        } else {
            for row in top..=bottom {
                let row_start = row * stride + left * bpp;
                let row_end = row_start + row_bytes;
                if row_end <= image_data.len() {
                    payload.extend_from_slice(&image_data[row_start..row_end]);
                }
            }
        }
    }

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push a dirty region's pixel data directly through the Tauri Channel.
///
/// Binary protocol: 8-byte header [x:u16LE, y:u16LE, w:u16LE, h:u16LE]
/// followed by w*h*4 raw RGBA bytes.  The JS side receives this as a
/// single ArrayBuffer — zero JSON, zero base64, zero invoke round-trips.
#[inline]
fn push_frame_via_channel(
    image_data: &[u8],
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
    frame_channel: &Channel<InvokeResponseBody>,
) {
    let bpp = 4usize;
    let stride = fb_width as usize * bpp;
    let left = region.left as usize;
    let top = region.top as usize;
    let right = region.right as usize;
    let bottom = region.bottom as usize;
    let rw = right.saturating_sub(left) + 1;
    let rh = bottom.saturating_sub(top) + 1;

    let row_bytes = rw * bpp;
    let total = 8 + rw * rh * bpp;
    let mut payload = Vec::with_capacity(total);

    // 8-byte header as a single write
    let header: [u8; 8] = {
        let mut h = [0u8; 8];
        h[0..2].copy_from_slice(&region.left.to_le_bytes());
        h[2..4].copy_from_slice(&region.top.to_le_bytes());
        h[4..6].copy_from_slice(&(rw as u16).to_le_bytes());
        h[6..8].copy_from_slice(&(rh as u16).to_le_bytes());
        h
    };
    payload.extend_from_slice(&header);

    // RGBA pixel data from the framebuffer.
    let last_row_end = bottom * stride + left * bpp + row_bytes;
    if last_row_end <= image_data.len() {
        if left == 0 && rw == fb_width as usize {
            // Full-width region — rows are contiguous in memory.
            // Single memcpy instead of one per row (e.g. 1 call vs 1080).
            let start = top * stride;
            let end = (bottom + 1) * stride;
            payload.extend_from_slice(&image_data[start..end]);
        } else {
            // Partial-width — must copy row by row.
            for row in top..=bottom {
                let row_start = row * stride + left * bpp;
                payload.extend_from_slice(&image_data[row_start..row_start + row_bytes]);
            }
        }
    } else {
        for row in top..=bottom {
            let row_start = row * stride + left * bpp;
            let row_end = row_start + row_bytes;
            if row_end <= image_data.len() {
                payload.extend_from_slice(&image_data[row_start..row_end]);
            }
        }
    }

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push a composed frame from the compositor through the Channel.
/// Uses the same binary protocol as `push_frame_via_channel`.
#[inline]
fn push_compositor_frame_via_channel(
    frame: native_renderer::CompositorFrame,
    frame_channel: &Channel<InvokeResponseBody>,
) {
    // The compositor's flush() pre-reserves 8 leading bytes (zeroed) in
    // frame.rgba.  Write the header in-place — zero extra allocation,
    // zero extra memcpy.
    let mut payload = frame.rgba;
    debug_assert!(payload.len() >= 8, "CompositorFrame rgba too short for header");
    payload[0..2].copy_from_slice(&frame.x.to_le_bytes());
    payload[2..4].copy_from_slice(&frame.y.to_le_bytes());
    payload[4..6].copy_from_slice(&frame.width.to_le_bytes());
    payload[6..8].copy_from_slice(&frame.height.to_le_bytes());

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push the entire desktop as a single full-frame through the channel
/// and update the SharedFrameStore (for the rdp_get_frame_data fallback).
fn send_full_frame_via_channel(
    session_id: &str,
    image: &DecodedImage,
    width: u16,
    height: u16,
    frame_channel: &Channel<InvokeResponseBody>,
    frame_store: &SharedFrameStore,
) {
    let region = ironrdp::pdu::geometry::InclusiveRectangle {
        left: 0,
        top: 0,
        right: width.saturating_sub(1),
        bottom: height.saturating_sub(1),
    };
    // Update fallback store (periodic, not on hot path)
    frame_store.update_region(session_id, image.data(), width, &region);
    // Push full frame through channel
    push_frame_via_channel(image.data(), width, &region, frame_channel);
}

/// Legacy: extract a rectangular region as a contiguous RGBA byte vec.
/// Used only by the `rdp_get_frame_data` fallback command.
#[allow(dead_code)]
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

fn set_read_timeout_on_framed(
    framed: &Framed<native_tls::TlsStream<TcpStream>>,
    timeout: Option<Duration>,
) {
    let (tls_stream, _) = framed.get_inner();
    let tcp = tls_stream.get_ref();
    let _ = tcp.set_read_timeout(timeout);
}

// ─── Tauri commands ────────────────────────────────────────────────────────

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
    // from the session thread to JS — no base64, no event+invoke round-trip).
    frame_channel: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    // ── Evict any previous session for this connection slot ──────────────
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
    };

    let mut service = state.lock().await;
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
                let _ = conn.cmd_tx.send(RdpCommand::Shutdown);
                tokio::time::sleep(Duration::from_millis(100)).await;
                return Ok(());
            }
        }
    }

    // Nothing to disconnect — this is not an error (the session may
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

    if let Some(id) = target_id {
        if let Some(conn) = service.connections.get(&id) {
            let _ = conn.cmd_tx.send(RdpCommand::DetachViewer);
        }
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
        .send(RdpCommand::AttachViewer(frame_channel))
        .map_err(|_| "Session command channel closed".to_string())?;

    Ok(conn.session.clone())
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
/// framebuffer.  Returns an `ArrayBuffer` on the JS side — no base64
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

// ─── Deep Connection Diagnostics ────────────────────────────────────────────

// Re-export shared types so the frontend API stays unchanged.
pub use crate::diagnostics::{DiagnosticStep, DiagnosticReport};

/// Run a deep diagnostic probe against an RDP server.
/// This performs each connection phase independently and reports
/// detailed results for each step, without actually creating an
/// active session.
#[tauri::command]
pub async fn diagnose_rdp_connection(
    state: tauri::State<'_, RdpServiceState>,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    rdp_settings: Option<RdpSettingsPayload>,
) -> Result<DiagnosticReport, String> {
    let h = host.clone();
    let u = username.clone();
    let p = password.clone();
    let d = domain.clone();

    let payload = rdp_settings.unwrap_or_default();
    let settings = ResolvedSettings::from_payload(&payload, 1024, 768);

    let service = state.lock().await;
    let cached_tls = service.cached_tls_connector.clone();
    let cached_http = service.cached_http_client.clone();
    drop(service);

    tokio::task::spawn_blocking(move || {
        run_diagnostics(&h, port, &u, &p, d.as_deref(), &settings, cached_tls, cached_http)
    })
    .await
    .map_err(|e| format!("Diagnostic task panicked: {e}"))
}

fn run_diagnostics(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> DiagnosticReport {
    use crate::diagnostics::{self, DiagnosticStep};
    let run_start = Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;

    // ── Step 1: DNS Resolution (multi-address) ──────────────────────────

    let (socket_addr, ip_str, _all_ips) =
        diagnostics::probe_dns(host, port, &mut steps);
    let socket_addr = match socket_addr {
        Some(a) => {
            resolved_ip = ip_str;
            a
        }
        None => {
            return diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start);
        }
    };

    // ── Step 2: TCP Connect ─────────────────────────────────────────────

    let tcp_stream = match diagnostics::probe_tcp(
        socket_addr,
        settings.tcp_connect_timeout,
        settings.tcp_nodelay,
        &mut steps,
    ) {
        Some(s) => s,
        None => {
            return diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start);
        }
    };

    // ── Step 3: X.224 / RDP Negotiation ──────────────────────────────────

    let t = Instant::now();
    let mut framed = Framed::new(tcp_stream);

    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
    let probe_config = connector::Config {
        credentials: connector::Credentials::UsernamePassword {
            username: actual_user.clone(),
            password: password.to_string(),
        },
        domain: actual_domain,
        enable_tls: settings.enable_tls,
        enable_credssp: settings.enable_credssp,
        keyboard_type: settings.keyboard_type,
        keyboard_subtype: settings.keyboard_subtype,
        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
        keyboard_layout: settings.keyboard_layout,
        ime_file_name: settings.ime_file_name.clone(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: 32,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: true,
        pointer_software_rendering: false,
        allow_hybrid_ex: settings.allow_hybrid_ex,
        sspi_package_list: None,
    };

    let server_socket_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut connector = ClientConnector::new(probe_config, server_socket_addr);

    match ironrdp_blocking::connect_begin(&mut framed, &mut connector) {
        Ok(should_upgrade) => {
            let negotiate_ms = t.elapsed().as_millis() as u64;
            let negotiated_proto = connector.state.name();
            steps.push(DiagnosticStep {
                name: "X.224 Negotiation".into(),
                status: "pass".into(),
                message: format!("Protocol negotiated → state: {negotiated_proto}"),
                duration_ms: negotiate_ms,
                detail: Some(format!(
                    "TLS={}, CredSSP={}, HYBRID_EX={}",
                    settings.enable_tls, settings.enable_credssp, settings.allow_hybrid_ex
                )),
            });

            // ── Step 4: TLS Upgrade ─────────────────────────────────

            let t = Instant::now();
            let (tcp_stream, leftover) = framed.into_inner();
            match tls_upgrade(tcp_stream, host, leftover, cached_tls_connector) {
                Ok((mut tls_framed, server_public_key)) => {
                    let tls_ms = t.elapsed().as_millis() as u64;

                    let cert_detail = {
                        let (tls_stream, _) = tls_framed.get_inner();
                        extract_cert_fingerprint(tls_stream)
                            .map(|fp| format!("SHA-256: {fp}"))
                            .unwrap_or_else(|| "Certificate fingerprint unavailable".into())
                    };

                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: "pass".into(),
                        message: format!("TLS handshake completed (server pubkey: {} bytes)", server_public_key.len()),
                        duration_ms: tls_ms,
                        detail: Some(cert_detail),
                    });

                    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

                    // ── Step 5: CredSSP / NLA + Session Setup ────────

                    let t = Instant::now();
                    let mut network_client = BlockingNetworkClient::new(cached_http_client.clone());
                    let server_name = ironrdp::connector::ServerName::new(host);

                    match ironrdp_blocking::connect_finalize(
                        upgraded,
                        connector,
                        &mut tls_framed,
                        &mut network_client,
                        server_name,
                        server_public_key,
                        None,
                    ) {
                        Ok(connection_result) => {
                            let auth_ms = t.elapsed().as_millis() as u64;
                            steps.push(DiagnosticStep {
                                name: "CredSSP / NLA + Session Setup".into(),
                                status: "pass".into(),
                                message: format!(
                                    "Fully connected! Desktop: {}x{}",
                                    connection_result.desktop_size.width,
                                    connection_result.desktop_size.height
                                ),
                                duration_ms: auth_ms,
                                detail: Some("Authentication, licensing, and capability exchange all succeeded".into()),
                            });

                            // ── Step 6 (RDP-specific): Color Depth Compatibility ──
                            // Probe which color depths the server actually accepts.
                            // This runs a quick sequence of connect_begin → finalize
                            // with different depths to detect rejections like 24-bit.
                            let user_depth = settings.color_depth;
                            if user_depth != 32 {
                                // The probe just succeeded with 32-bit.  If the user
                                // wants a different depth, test it too.
                                let depth_result = probe_color_depth(
                                    host, port, username, password, domain,
                                    settings, user_depth, cached_http_client,
                                );
                                steps.push(depth_result);
                            }
                        }
                        Err(e) => {
                            let auth_ms = t.elapsed().as_millis() as u64;
                            let mut err_detail = format!("{e}");
                            let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
                            while let Some(cause) = source {
                                err_detail.push_str(&format!(" → {cause}"));
                                source = std::error::Error::source(cause);
                            }

                            let (status, root_hint) = classify_finalize_error(&err_detail);

                            steps.push(DiagnosticStep {
                                name: "CredSSP / NLA + Session Setup".into(),
                                status: status.into(),
                                message: format!("Failed: {e}"),
                                duration_ms: auth_ms,
                                detail: Some(err_detail.clone()),
                            });

                            if err_detail.contains("10054") || err_detail.contains("forcibly closed") {
                                steps.push(DiagnosticStep {
                                    name: "Root Cause Analysis".into(),
                                    status: "warn".into(),
                                    message: "Server accepted TLS but closed connection during/after CredSSP".into(),
                                    duration_ms: 0,
                                    detail: Some(root_hint.unwrap_or_else(|| {
                                        "The CredSSP handshake itself may have succeeded (NTLM OK), \
                                         but the server rejected the session during BasicSettingsExchange. \
                                         This typically means the server accepted your identity but a \
                                         policy or licensing issue prevented session creation. \
                                         Check Windows Event Viewer on the server: \
                                         Applications and Services Logs → Microsoft → Windows → \
                                         TerminalServices-RemoteConnectionManager → Operational \
                                         for the specific rejection reason.".into()
                                    })),
                                });
                            }

                            // ── Additional: Color Depth Probe on failure ─────
                            // If the session setup failed, probe multiple color
                            // depths to see if a different one works.
                            let depth_step = probe_color_depths_on_failure(
                                host, port, username, password, domain, settings,
                            );
                            if let Some(ds) = depth_step {
                                steps.push(ds);
                            }
                        }
                    }
                }
                Err(e) => {
                    let tls_ms = t.elapsed().as_millis() as u64;
                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: "fail".into(),
                        message: format!("TLS handshake failed: {e}"),
                        duration_ms: tls_ms,
                        detail: Some("The server may not support TLS, or its certificate is invalid. Try disabling TLS in connection settings.".into()),
                    });
                }
            }
        }
        Err(e) => {
            let negotiate_ms = t.elapsed().as_millis() as u64;
            let mut err_detail = format!("{e}");
            let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
            while let Some(cause) = source {
                err_detail.push_str(&format!(" → {cause}"));
                source = std::error::Error::source(cause);
            }

            // Detect specific negotiation failure — server requires CredSSP
            let status = if err_detail.to_lowercase().contains("negotiation")
                || err_detail.to_lowercase().contains("security")
            {
                "fail"
            } else {
                "fail"
            };

            steps.push(DiagnosticStep {
                name: "X.224 Negotiation".into(),
                status: status.into(),
                message: format!("Protocol negotiation failed: {e}"),
                duration_ms: negotiate_ms,
                detail: Some(err_detail.clone()),
            });

            // Try alternative protocol flags if negotiation failed
            let alt_step = probe_alternative_protocols(host, port, username, password, domain, settings);
            if let Some(s) = alt_step {
                steps.push(s);
            }
        }
    }

    diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start)
}

/// Quick probe: can the server accept a specific color depth?
/// Performs a new TCP → X.224 → TLS → finalize cycle with the given depth.
fn probe_color_depth(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    depth: u32,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> DiagnosticStep {
    let t = Instant::now();
    let addr = format!("{host}:{port}");
    let socket_addr = match addr.to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "skip".into(),
                message: "DNS failed (skipped)".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let tcp = match TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout) {
        Ok(s) => s,
        Err(_) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "skip".into(),
                message: "TCP failed (skipped)".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };
    let _ = tcp.set_nodelay(true);
    let mut framed = Framed::new(tcp);

    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
    let config = connector::Config {
        credentials: connector::Credentials::UsernamePassword {
            username: actual_user,
            password: password.to_string(),
        },
        domain: actual_domain,
        enable_tls: settings.enable_tls,
        enable_credssp: settings.enable_credssp,
        keyboard_type: settings.keyboard_type,
        keyboard_subtype: settings.keyboard_subtype,
        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
        keyboard_layout: settings.keyboard_layout,
        ime_file_name: settings.ime_file_name.clone(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: depth,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: true,
        pointer_software_rendering: false,
        allow_hybrid_ex: settings.allow_hybrid_ex,
        sspi_package_list: None,
    };

    let server_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut conn = ClientConnector::new(config, server_addr);

    let should_upgrade = match ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
        Ok(u) => u,
        Err(e) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "warn".into(),
                message: format!("Negotiation failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let (tcp_inner, leftover) = framed.into_inner();
    let (mut tls_framed, server_pk) = match tls_upgrade(tcp_inner, host, leftover, None) {
        Ok(r) => r,
        Err(e) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "warn".into(),
                message: format!("TLS failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut conn);
    let mut net_client = BlockingNetworkClient::new(cached_http_client);
    let sn = ironrdp::connector::ServerName::new(host);

    match ironrdp_blocking::connect_finalize(upgraded, conn, &mut tls_framed, &mut net_client, sn, server_pk, None) {
        Ok(cr) => DiagnosticStep {
            name: format!("Color Depth Probe ({depth}bpp)"),
            status: "pass".into(),
            message: format!("{depth}bpp accepted — desktop {}x{}", cr.desktop_size.width, cr.desktop_size.height),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: Some(format!("The server accepts {depth}-bit color depth")),
        },
        Err(e) => DiagnosticStep {
            name: format!("Color Depth Probe ({depth}bpp)"),
            status: "warn".into(),
            message: format!("{depth}bpp REJECTED — {e}"),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: Some(format!(
                "The server does NOT accept {depth}-bit color depth. \
                 Try 32-bit or 16-bit in connection settings."
            )),
        },
    }
}

/// After a session-setup failure, quick-test multiple color depths to find
/// which ones the server accepts.
fn probe_color_depths_on_failure(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
) -> Option<DiagnosticStep> {
    let t = Instant::now();
    let depths = [32u32, 24, 16, 15];

    // Probe all depths in parallel — each one opens its own TCP connection.
    let results: Vec<(u32, DiagnosticStep)> = std::thread::scope(|scope| {
        let handles: Vec<_> = depths
            .iter()
            .map(|&depth| {
                scope.spawn(move || {
                    let step = probe_color_depth(
                        host, port, username, password, domain, settings, depth, None,
                    );
                    (depth, step)
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let mut accepted: Vec<u32> = Vec::new();
    let mut rejected: Vec<u32> = Vec::new();
    for (depth, step) in &results {
        if step.status == "pass" {
            accepted.push(*depth);
        } else if step.status == "warn" && step.message.contains("REJECTED") {
            rejected.push(*depth);
        }
    }

    if accepted.is_empty() && rejected.is_empty() {
        return None; // couldn't test any
    }

    let accepted_str: Vec<String> = accepted.iter().map(|d| format!("{d}bpp")).collect();
    let rejected_str: Vec<String> = rejected.iter().map(|d| format!("{d}bpp")).collect();

    let user_depth = settings.color_depth;
    let user_ok = accepted.contains(&user_depth);

    let message = if user_ok {
        format!(
            "Your color depth ({user_depth}bpp) is accepted. Accepted: {}",
            accepted_str.join(", ")
        )
    } else if !accepted.is_empty() {
        format!(
            "Your color depth ({user_depth}bpp) may be rejected! Accepted: {}. Rejected: {}",
            accepted_str.join(", "),
            rejected_str.join(", ")
        )
    } else {
        format!(
            "No color depths tested successfully. Rejected: {}",
            rejected_str.join(", ")
        )
    };

    Some(DiagnosticStep {
        name: "Color Depth Compatibility".into(),
        status: if user_ok { "pass" } else { "warn" }.into(),
        message,
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(format!(
            "Tested depths: {:?}. Accepted: {:?}. Rejected: {:?}. \
             If your chosen depth is rejected, change it in Display settings.",
            depths, accepted, rejected
        )),
    })
}

/// If X.224 negotiation failed, try alternative protocol flag combinations
/// to see which ones the server accepts.  All combos are probed in parallel.
fn probe_alternative_protocols(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
) -> Option<DiagnosticStep> {
    let t = Instant::now();
    let combos: &[(bool, bool, bool, &str)] = &[
        (true, true, false, "TLS+CredSSP"),
        (true, true, true, "TLS+CredSSP+HYBRID_EX"),
        (true, false, false, "TLS only"),
        (false, false, false, "Plain (no security)"),
    ];

    // Probe all protocol combinations in parallel.
    let results: Vec<(&str, bool)> = std::thread::scope(|scope| {
        let handles: Vec<_> = combos
            .iter()
            .map(|&(tls, credssp, hybrid_ex, label)| {
                scope.spawn(move || {
                    let addr = format!("{host}:{port}");
                    let socket_addr = match addr.to_socket_addrs().ok().and_then(|mut a| a.next()) {
                        Some(a) => a,
                        None => return (label, false),
                    };
                    let tcp = match TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout) {
                        Ok(s) => s,
                        Err(_) => return (label, false),
                    };
                    let _ = tcp.set_nodelay(true);
                    let mut framed = Framed::new(tcp);

                    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
                    let config = connector::Config {
                        credentials: connector::Credentials::UsernamePassword {
                            username: actual_user,
                            password: password.to_string(),
                        },
                        domain: actual_domain,
                        enable_tls: tls,
                        enable_credssp: credssp,
                        keyboard_type: settings.keyboard_type,
                        keyboard_subtype: settings.keyboard_subtype,
                        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
                        keyboard_layout: settings.keyboard_layout,
                        ime_file_name: settings.ime_file_name.clone(),
                        dig_product_id: String::new(),
                        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
                        desktop_scale_factor: 100,
                        bitmap: Some(connector::BitmapConfig {
                            lossy_compression: false,
                            color_depth: 32,
                            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
                        }),
                        client_build: settings.client_build,
                        client_name: settings.client_name.clone(),
                        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
                        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
                        hardware_id: None,
                        request_data: None,
                        autologon: false,
                        enable_audio_playback: false,
                        performance_flags: settings.performance_flags,
                        license_cache: None,
                        timezone_info: Default::default(),
                        enable_server_pointer: true,
                        pointer_software_rendering: false,
                        allow_hybrid_ex: hybrid_ex,
                        sspi_package_list: None,
                    };

                    let server_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
                    let mut conn = ClientConnector::new(config, server_addr);

                    match ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
                        Ok(_) => (label, true),
                        Err(_) => (label, false),
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let accepted: Vec<&str> = results.iter().filter(|(_, ok)| *ok).map(|(l, _)| *l).collect();
    let rejected: Vec<&str> = results.iter().filter(|(_, ok)| !*ok).map(|(l, _)| *l).collect();

    if accepted.is_empty() && rejected.is_empty() {
        return None;
    }

    let current = format!(
        "TLS={}, CredSSP={}, HYBRID_EX={}",
        settings.enable_tls, settings.enable_credssp, settings.allow_hybrid_ex
    );

    Some(DiagnosticStep {
        name: "Protocol Compatibility".into(),
        status: if accepted.is_empty() { "fail" } else { "warn" }.into(),
        message: if accepted.is_empty() {
            format!("No protocol combinations accepted by the server. Current: {current}")
        } else {
            format!(
                "Server accepts: {}. Rejected: {}. Current: {current}",
                accepted.join(", "),
                rejected.join(", ")
            )
        },
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(
            "Enable Auto-detect negotiation or switch to an accepted protocol combination in Security settings.".into()
        ),
    })
}

/// Extract username and domain from various formats (DOMAIN\\user, user@domain, plain user)
fn resolve_credentials(username: &str, domain: Option<&str>, host: &str) -> (String, Option<String>) {
    if let Some(d) = domain {
        if !d.is_empty() {
            return (username.to_string(), Some(d.to_string()));
        }
    }
    if let Some(idx) = username.find('\\') {
        let d = &username[..idx];
        let u = &username[idx + 1..];
        return (u.to_string(), Some(d.to_string()));
    }
    if let Some(idx) = username.find('@') {
        let u = &username[..idx];
        let d = &username[idx + 1..];
        return (u.to_string(), Some(d.to_string()));
    }
    let _ = host; // hostname fallback not used in diagnostics
    (username.to_string(), None)
}

/// Classify the connect_finalize error to provide a root cause hint.
fn classify_finalize_error(err: &str) -> (&'static str, Option<String>) {
    let lower = err.to_lowercase();

    if lower.contains("10054") || lower.contains("forcibly closed") || lower.contains("connection reset") {
        if lower.contains("basicsettingsexchange") || lower.contains("basic settings") {
            // Server closed after CredSSP but during MCS GCC exchange — policy / licensing
            return ("fail", Some(
                "The server authenticated you (CredSSP/NTLM succeeded) but refused the session \
                 during MCS/GCC negotiation. This usually points to:\n\
                 • RD Licensing: no licenses available or licensing server unreachable\n\
                 • Group Policy: the user is denied logon via 'Allow/Deny log on through Remote Desktop Services'\n\
                 • Max sessions: the server has reached its connection limit\n\
                 • Account restrictions: logon hours, workstation restrictions, or disabled account\n\n\
                 → Check Event Viewer on the server:\n\
                   Applications and Services Logs → Microsoft → Windows →\n\
                   TerminalServices-RemoteConnectionManager → Operational\n\
                   TerminalServices-LocalSessionManager → Operational\n\
                   System log (source: TermService)"
                .into(),
            ));
        }
        if lower.contains("credssp") || lower.contains("nla") || lower.contains("authenticat") {
            return ("fail", Some(
                "The connection was reset during the CredSSP/NLA authentication phase. \
                 This usually means invalid credentials, CredSSP oracle remediation policy mismatch, \
                 or the account lacks remote logon rights."
                .into(),
            ));
        }
        // Generic 10054
        return ("fail", Some(
            "The server sent a TCP RST (forcible close). The connection was dropped \
             before the session could be established. Check the server's Event Viewer \
             for the specific rejection reason."
            .into(),
        ));
    }

    if lower.contains("access denied") || lower.contains("accessdenied") {
        return ("fail", Some("Access was explicitly denied by the server.".into()));
    }

    if lower.contains("license") {
        return ("fail", Some(
            "A licensing error occurred. The RD licensing server may be unreachable or out of CALs."
            .into(),
        ));
    }

    ("fail", None)
}


