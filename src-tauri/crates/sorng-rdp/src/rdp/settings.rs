use std::time::Duration;

use ironrdp::pdu::rdp::client_info::PerformanceFlags;
use serde::{Deserialize, Serialize};

// ---- Frontend RDP settings (mirrors TypeScript RdpConnectionSettings) ----

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
    pub reconnect_base_delay_secs: Option<u64>,
    pub reconnect_max_delay_secs: Option<u64>,
    pub reconnect_on_network_loss: Option<bool>,
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
pub(crate) fn build_performance_flags(perf: &RdpPerformancePayload) -> PerformanceFlags {
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
pub(crate) fn build_bitmap_codecs(settings: &ResolvedSettings) -> ironrdp::pdu::rdp::capability_sets::BitmapCodecs {
    use ironrdp::pdu::rdp::capability_sets::{
        BitmapCodecs, CaptureFlags, Codec, CodecProperty, EntropyBits,
        RemoteFxContainer, RfxCaps, RfxCapset, RfxClientCapsContainer,
        RfxICap, RfxICapFlags,
    };

    if !settings.codecs_enabled {
        return BitmapCodecs(Vec::new());
    }

    let mut codecs = Vec::new();

    // RemoteFX (RFX) -- DWT + RLGR entropy coding
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
pub(crate) fn parse_keyboard_type(s: &str) -> ironrdp::pdu::gcc::KeyboardType {
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
pub(crate) struct ResolvedSettings {
    pub(crate) width: u16,
    pub(crate) height: u16,
    pub(crate) color_depth: u32,
    pub(crate) desktop_scale_factor: u32,
    pub(crate) lossy_compression: bool,
    pub(crate) enable_tls: bool,
    pub(crate) enable_credssp: bool,
    pub(crate) use_credssp: bool,
    pub(crate) autologon: bool,
    pub(crate) enable_audio_playback: bool,
    pub(crate) keyboard_type: ironrdp::pdu::gcc::KeyboardType,
    pub(crate) keyboard_layout: u32,
    pub(crate) keyboard_subtype: u32,
    pub(crate) keyboard_functional_keys_count: u32,
    pub(crate) ime_file_name: String,
    pub(crate) client_name: String,
    pub(crate) client_build: u32,
    pub(crate) enable_server_pointer: bool,
    pub(crate) pointer_software_rendering: bool,
    // CredSSP remediation
    pub(crate) allow_hybrid_ex: bool,
    pub(crate) _nla_fallback_to_tls: bool,
    pub(crate) ntlm_enabled: bool,
    pub(crate) kerberos_enabled: bool,
    pub(crate) pku2u_enabled: bool,
    pub(crate) _restricted_admin: bool,
    pub(crate) sspi_package_list: String,
    pub(crate) _server_cert_validation: String,
    pub(crate) performance_flags: PerformanceFlags,
    // Gateway
    pub(crate) gateway_enabled: bool,
    pub(crate) gateway_hostname: String,
    pub(crate) gateway_port: u16,
    pub(crate) _gateway_auth_method: String,
    pub(crate) _gateway_transport_mode: String,
    pub(crate) _gateway_bypass_local: bool,
    // Hyper-V
    pub(crate) use_vm_id: bool,
    pub(crate) vm_id: String,
    pub(crate) enhanced_session_mode: bool,
    pub(crate) _host_server: String,
    // Negotiation
    pub(crate) auto_detect: bool,
    pub(crate) negotiation_strategy: String,
    pub(crate) max_retries: u32,
    pub(crate) retry_delay_ms: u64,
    pub(crate) load_balancing_info: String,
    pub(crate) use_routing_token: bool,
    // Frame delivery
    pub(crate) frame_batching: bool,
    pub(crate) frame_batch_interval: Duration,
    pub(crate) full_frame_sync_interval: u64,
    // Render backend
    pub(crate) render_backend: String,
    // Bitmap codecs
    pub(crate) codecs_enabled: bool,
    pub(crate) remotefx_enabled: bool,
    pub(crate) remotefx_entropy: String,
    // RDPGFX / H.264
    pub(crate) gfx_enabled: bool,
    pub(crate) h264_decoder_preference: crate::h264::H264DecoderPreference,
    // Session behaviour
    pub(crate) read_timeout: Duration,
    pub(crate) max_consecutive_errors: u32,
    pub(crate) stats_interval: Duration,
    // TCP / Socket
    pub(crate) tcp_connect_timeout: Duration,
    pub(crate) tcp_nodelay: bool,
    pub(crate) tcp_keep_alive: bool,
    pub(crate) tcp_keep_alive_interval: Duration,
    pub(crate) tcp_recv_buffer_size: u32,
    pub(crate) tcp_send_buffer_size: u32,
    // Reconnection
    pub(crate) reconnect_base_delay: Duration,
    pub(crate) reconnect_max_delay: Duration,
    pub(crate) reconnect_on_network_loss: bool,
}

impl ResolvedSettings {
    pub(crate) fn from_payload(payload: &RdpSettingsPayload, width: u16, height: u16) -> Self {
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
            // Reconnection
            reconnect_base_delay: Duration::from_secs(
                adv.and_then(|a| a.reconnect_base_delay_secs).unwrap_or(3),
            ),
            reconnect_max_delay: Duration::from_secs(
                adv.and_then(|a| a.reconnect_max_delay_secs).unwrap_or(30),
            ),
            reconnect_on_network_loss: adv
                .and_then(|a| a.reconnect_on_network_loss)
                .unwrap_or(true),
        }
    }
}
