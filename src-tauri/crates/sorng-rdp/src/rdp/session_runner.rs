use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::ironrdp::connector::connection_activation::ConnectionActivationState;
use crate::ironrdp::connector::{self, ClientConnector, ConnectionResult, Sequence, State as _};
use crate::ironrdp::core::WriteBuf;
use crate::ironrdp::graphics::image_processing::PixelFormat;
use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
use crate::ironrdp::session::image::DecodedImage;
use crate::ironrdp::session::{ActiveStage, ActiveStageOutput};
use crate::ironrdp_blocking::Framed;
use sorng_core::events::DynEventEmitter;
use super::clipboard::{self, SharedClipboardState};
use super::frame_channel::DynFrameChannel;
use tokio::sync::mpsc;

use super::frame_delivery::*;
use super::frame_store::SharedFrameStoreState;
use super::network::{extract_cert_details, extract_cert_fingerprint, tls_upgrade, BlockingNetworkClient};
use super::settings::{build_bitmap_codecs, ResolvedSettings};
use super::stats::RdpSessionStats;
use super::types::{RdpCommand, RdpLogEntry, RdpPointerEvent, RdpStatusEvent};
use super::{RdpTlsConfig, RdpTlsStream};
use sorng_core::native_renderer::{self, FrameCompositor, RenderBackend};

// ---- Session log helper ----

/// A sink for RDP log entries — pushes to the backend log buffer via a channel
/// so entries persist for polling, AND emits `rdp://log` for real-time UI.
pub type LogSink = std::sync::mpsc::Sender<RdpLogEntry>;

/// Emit a log entry to both the real-time event stream and the persistent log buffer.
fn emit_log(emitter: &DynEventEmitter, log_sink: &LogSink, level: &str, message: String, session_id: &str) {
    let entry = RdpLogEntry {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        session_id: Some(session_id.to_string()),
        level: level.to_string(),
        message,
    };
    let _ = emitter.emit_event(
        "rdp://log",
        serde_json::to_value(&entry).unwrap_or_default(),
    );
    let _ = log_sink.send(entry);
}

// ---- Deactivation-Reactivation Sequence handler ----

/// Drives a ConnectionActivationSequence to completion after receiving
/// DeactivateAll.  This re-runs the Capability Exchange and Connection
/// Finalization phases so the server can transition from the login screen
/// to the user desktop (MS-RDPBCGR section 1.3.1.3).
pub fn handle_reactivation<S: std::io::Read + std::io::Write>(
    mut cas: Box<crate::ironrdp::connector::connection_activation::ConnectionActivationSequence>,
    tls_framed: &mut Framed<S>,
    stats: &RdpSessionStats,
    preserved_channels: Option<crate::ironrdp_svc::StaticChannelSet>,
) -> Result<ConnectionResult, Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = WriteBuf::new();

    log::info!("Driving deactivation-reactivation sequence");
    stats.set_phase("reactivating");

    loop {
        // Check if we have reached a terminal (Finalized) state
        if cas.state().is_terminal() {
            break;
        }

        let Some(pdu_hint) = cas.next_pdu_hint() else {
            break;
        };

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
                static_channels: preserved_channels.unwrap_or_else(crate::ironrdp_svc::StaticChannelSet::new),
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

// ---- Session loop exit reason ----

/// Why the active session loop stopped.  Used to decide whether to reconnect.
enum SessionLoopExit {
    /// User/system requested shutdown — session is done for good.
    Shutdown,
    /// Server closed the connection cleanly (EOF or Terminate PDU).
    ServerClosed,
    /// Network error (TCP dropped) — eligible for seamless reconnect.
    NetworkError(String),
    /// Unrecoverable protocol error.
    ProtocolError(String),
    /// Manual reconnect requested via RdpCommand::Reconnect.
    ReconnectRequested,
}

// ---- Established session state ----

/// State returned by `establish_rdp_connection` — everything needed
/// to run the active session loop.
#[allow(dead_code)]
struct EstablishedSession {
    tls_framed: Framed<RdpTlsStream>,
    active_stage: ActiveStage,
    image: DecodedImage,
    desktop_width: u16,
    desktop_height: u16,
    compositor: Option<Box<dyn FrameCompositor>>,
    active_render_backend: String,
    gfx_frame_rx: Option<std::sync::mpsc::Receiver<crate::gfx::processor::GfxOutput>>,
    clipboard_state: Option<SharedClipboardState>,
}

// ---- Blocking RDP session runner ----

#[allow(clippy::too_many_arguments)]
pub fn run_rdp_session(
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    settings: ResolvedSettings,
    event_emitter: DynEventEmitter,
    mut cmd_rx: crate::rdp::wake_channel::WakeReceiver,
    stats: Arc<RdpSessionStats>,
    cached_tls_connector: Option<RdpTlsConfig>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: SharedFrameStoreState,
    frame_channel: DynFrameChannel,
    log_sink: LogSink,
) {
    // Log CPU SIMD capabilities once (first session only).
    static LOG_FEATURES: std::sync::Once = std::sync::Once::new();
    LOG_FEATURES.call_once(crate::h264::yuv_convert::log_cpu_features);

    let result = if settings.auto_detect {
        // -- Auto-detect negotiation: try different protocol combos --
        run_rdp_session_auto_detect(
            &session_id,
            &host,
            port,
            &username,
            &password,
            domain.as_deref(),
            &settings,
            &event_emitter,
            &mut cmd_rx,
            &stats,
            cached_tls_connector,
            cached_http_client,
            &frame_store,
            &frame_channel,
            &log_sink,
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
            &event_emitter,
            &mut cmd_rx,
            &stats,
            cached_tls_connector,
            cached_http_client,
            &frame_store,
            &frame_channel,
            &log_sink,
        )
    };

    // Clean up the shared framebuffer slot when the session ends
    frame_store.remove(&session_id);
    stats.alive.store(false, Ordering::Relaxed);

    match result {
        Ok(()) => {
            log::info!("RDP session {session_id} ended normally");
            stats.set_phase("disconnected");
            // Only emit disconnected for clean exits -- errors already emitted their own status.
            let _ = event_emitter.emit_event(
                "rdp://status",
                serde_json::to_value(&RdpStatusEvent {
                    session_id,
                    status: "disconnected".to_string(),
                    message: "Session ended".to_string(),
                    desktop_width: None,
                    desktop_height: None,
                }).unwrap_or_default(),
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
                let _ = event_emitter.emit_event(
                    "rdp://status",
                    serde_json::to_value(&RdpStatusEvent {
                        session_id,
                        status: "disconnected".to_string(),
                        message: "Session cancelled".to_string(),
                        desktop_width: None,
                        desktop_height: None,
                    }).unwrap_or_default(),
                );
                return;
            }

            log::error!("RDP session {session_id} error: {err_msg}");
            stats.set_phase("error");
            stats.set_last_error(&err_msg);
            let _ = event_emitter.emit_event(
                "rdp://status",
                serde_json::to_value(&RdpStatusEvent {
                    session_id,
                    status: "error".to_string(),
                    message: err_msg,
                    desktop_width: None,
                    desktop_height: None,
                }).unwrap_or_default(),
            );
        }
    }
}

/// Build a list of (enable_tls, enable_credssp, allow_hybrid_ex) combos to try
/// based on the negotiation strategy.
pub fn build_negotiation_combos(
    strategy: &str,
    base: &ResolvedSettings,
) -> Vec<(bool, bool, bool)> {
    match strategy {
        "nla-first" => vec![
            (true, true, base.allow_hybrid_ex),  // TLS + CredSSP (best)
            (true, true, !base.allow_hybrid_ex), // TLS + CredSSP (flip HYBRID_EX)
            (true, false, false),                // TLS only
            (false, false, false),               // Plain (no security)
        ],
        "tls-first" => vec![
            (true, false, false),                // TLS only
            (true, true, base.allow_hybrid_ex),  // TLS + CredSSP
            (true, true, !base.allow_hybrid_ex), // TLS + CredSSP (flip HYBRID_EX)
            (false, false, false),               // Plain
        ],
        "nla-only" => vec![
            (true, true, base.allow_hybrid_ex),
            (true, true, !base.allow_hybrid_ex),
        ],
        "tls-only" => vec![(true, false, false)],
        "plain-only" => vec![(false, false, false)],
        // "auto" -- try everything
        _ => vec![
            (true, true, false),   // TLS + CredSSP, no HYBRID_EX
            (true, true, true),    // TLS + CredSSP, with HYBRID_EX
            (true, false, false),  // TLS only
            (false, true, false),  // CredSSP without TLS
            (false, false, false), // Plain
        ],
    }
}

/// Auto-detect negotiation: retry with different protocol combinations until
/// one works or all are exhausted.
///
/// **Phase 1** -- vary `(tls, credssp, hybrid_ex)` with the user's full Config.
/// **Phase 2** -- if Phase 1 failed at the BasicSettingsExchange (GCC/MCS)
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
    event_emitter: &DynEventEmitter,
    cmd_rx: &mut crate::rdp::wake_channel::WakeReceiver,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<RdpTlsConfig>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: &SharedFrameStoreState,
    frame_channel: &DynFrameChannel,
    log_sink: &LogSink,
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

    // -- Phase 1: vary protocol flags with user Config --

    for (i, (tls, credssp, hybrid_ex)) in combos.iter().take(max_attempts).enumerate() {
        log::info!(
            "RDP session {session_id}: auto-detect attempt {}/{} -> tls={} credssp={} hybrid_ex={}",
            i + 1,
            max_attempts,
            tls,
            credssp,
            hybrid_ex
        );

        let _ = event_emitter.emit_event(
            "rdp://status",
            serde_json::to_value(&RdpStatusEvent {
                session_id: session_id.to_string(),
                status: "negotiating".to_string(),
                message: format!(
                    "Auto-detect attempt {}/{}: TLS={} CredSSP={} HYBRID_EX={}",
                    i + 1,
                    max_attempts,
                    tls,
                    credssp,
                    hybrid_ex
                ),
                desktop_width: None,
                desktop_height: None,
            }).unwrap_or_default(),
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
            &event_emitter,
            cmd_rx,
            stats,
            cached_tls_connector.clone(),
            cached_http_client.clone(),
            frame_store,
            frame_channel,
            log_sink,
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
                    log::info!("RDP session {session_id}: auto-detect aborting (session shutdown)");
                    return Err(e);
                }

                // Track whether any failure was at the BasicSettingsExchange
                // (GCC/MCS) stage -- this means the protocol itself was fine
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
                emit_log(event_emitter, log_sink, "warn", format!("Auto-detect attempt {} failed: {err_str}", i + 1), session_id);
                last_error = Some(e);

                if i + 1 < max_attempts {
                    std::thread::sleep(Duration::from_millis(settings.retry_delay_ms));
                }
            }
        }
    }

    // -- Phase 2: try minimal/fallback Config --
    if had_basic_settings_failure {
        log::info!(
            "RDP session {session_id}: auto-detect Phase 2 -- retrying with minimal Config \
             (BasicSettingsExchange failures detected in Phase 1)"
        );

        let fallback_combos = build_negotiation_combos(&settings.negotiation_strategy, settings);
        let fallback_max = (settings.max_retries as usize + 1).min(fallback_combos.len());
        let color_depths: &[u32] = &[32, 16];
        let total_fallback = fallback_max * color_depths.len();
        let mut attempt_num = 0usize;

        for (tls, credssp, hybrid_ex) in fallback_combos.iter().take(fallback_max) {
            for &depth in color_depths {
                attempt_num += 1;
                log::info!(
                    "RDP session {session_id}: auto-detect fallback {}/{} -> tls={} credssp={} hybrid_ex={} color={}bpp (minimal config)",
                    attempt_num, total_fallback, tls, credssp, hybrid_ex, depth
                );

                let _ = event_emitter.emit_event(
                    "rdp://status",
                    serde_json::to_value(&RdpStatusEvent {
                        session_id: session_id.to_string(),
                        status: "negotiating".to_string(),
                        message: format!(
                            "Auto-detect fallback {}/{}: TLS={} CredSSP={} HYBRID_EX={} color={}bpp (simplified)",
                            attempt_num, total_fallback, tls, credssp, hybrid_ex, depth
                        ),
                        desktop_width: None,
                        desktop_height: None,
                    }).unwrap_or_default(),
                );

                let mut fallback_settings = ResolvedSettings {
                    enable_tls: *tls,
                    enable_credssp: *credssp,
                    allow_hybrid_ex: *hybrid_ex,
                    width: 1024,
                    height: 768,
                    desktop_scale_factor: 100,
                    lossy_compression: false,
                    color_depth: depth,
                    load_balancing_info: String::new(),
                    use_routing_token: false,
                    autologon: false,
                    enable_audio_playback: false,
                    sspi_package_list: String::new(),
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
                    &event_emitter,
                    cmd_rx,
                    stats,
                    cached_tls_connector.clone(),
                    cached_http_client.clone(),
                    frame_store,
                    frame_channel,
                    log_sink,
                );

                match result {
                    Ok(()) => {
                        log::info!(
                            "RDP session {session_id}: auto-detect fallback succeeded on attempt {} \
                             (tls={} credssp={} hybrid_ex={} color={}bpp, minimal config).",
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

// ---- Layer 1: Connection Establishment ----

/// Establish a fresh RDP connection: TCP → TLS → CredSSP/NLA → capability
/// exchange → active session state.  Returns an `EstablishedSession` ready
/// for the main PDU loop, or an error.
#[allow(clippy::too_many_arguments)]
fn establish_rdp_connection(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    event_emitter: &DynEventEmitter,
    cmd_rx: &mut crate::rdp::wake_channel::WakeReceiver,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<RdpTlsConfig>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: &SharedFrameStoreState,
    log_sink: &LogSink,
) -> Result<EstablishedSession, Box<dyn std::error::Error + Send + Sync>> {
    let conn_start = Instant::now();

    // -- 0. Pre-flight shutdown check --
    match cmd_rx.cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown before connect (pre-flight)");
            return Err("session_shutdown: cancelled before connect".into());
        }
        _ => {}
    }

    // -- 1. TCP connect (with hostname DNS resolution support) --

    let addr = format!("{host}:{port}");
    log::info!("RDP session {session_id}: connecting to {addr}");
    stats.set_phase("tcp_connect");

    let _ = event_emitter.emit_event(
        "rdp://status",
        serde_json::to_value(&RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: format!("Connecting to {addr}..."),
            desktop_width: None,
            desktop_height: None,
        }).unwrap_or_default(),
    );

    // Resolve address -- supports both raw IPs and hostnames.
    let t_resolve = Instant::now();
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("DNS resolution failed for {addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("DNS returned no addresses for {addr}"))?;
    let dns_ms = t_resolve.elapsed().as_millis();
    log::info!("RDP session {session_id}: DNS resolved in {dns_ms}ms -> {socket_addr}");

    let t_tcp = Instant::now();
    let tcp_stream = TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout)?;
    tcp_stream.set_nodelay(settings.tcp_nodelay)?;

    // TCP keep-alive
    if settings.tcp_keep_alive {
        use socket2::Socket;
        let sock = Socket::from(tcp_stream.try_clone()?);
        let ka = socket2::TcpKeepalive::new().with_time(settings.tcp_keep_alive_interval);
        let _ = sock.set_tcp_keepalive(&ka);
        std::mem::forget(sock);
    }

    // Configure socket buffer sizes
    {
        use socket2::Socket;
        let sock = Socket::from(tcp_stream.try_clone()?);
        let _ = sock.set_recv_buffer_size(settings.tcp_recv_buffer_size as usize);
        let _ = sock.set_send_buffer_size(settings.tcp_send_buffer_size as usize);
        std::mem::forget(sock);
    }
    let tcp_ms = t_tcp.elapsed().as_millis();
    log::info!("RDP session {session_id}: TCP connected in {tcp_ms}ms");

    // -- Shutdown check after TCP connect --
    match cmd_rx.cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown after TCP connect");
            return Err("session_shutdown: cancelled after TCP connect".into());
        }
        _ => {}
    }

    let mut framed = Framed::new(tcp_stream);

    // -- 2. Build IronRDP connector config --

    stats.set_phase("configuring");

    let (actual_user, actual_domain): (String, Option<String>) = if domain.is_some() {
        (username.to_string(), domain.map(String::from))
    } else if let Some((d, u)) = username.split_once('\\') {
        (u.to_string(), Some(d.to_string()))
    } else if let Some((u, d)) = username.rsplit_once('@') {
        (u.to_string(), Some(d.to_string()))
    } else {
        (username.to_string(), None)
    };

    log::info!(
        "RDP session {session_id}: resolved credentials user={:?} domain={:?} (original: {:?}/{:?})",
        actual_user, actual_domain, username, domain
    );

    let config = connector::Config {
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
        desktop_size: connector::DesktopSize {
            width: settings.width,
            height: settings.height,
        },
        desktop_scale_factor: settings.desktop_scale_factor,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: settings.lossy_compression,
            color_depth: settings.color_depth,
            codecs: build_bitmap_codecs(settings),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: crate::ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: {
            let lb = &settings.load_balancing_info;
            if !lb.is_empty() {
                if settings.use_routing_token {
                    Some(crate::ironrdp::pdu::nego::NegoRequestData::routing_token(
                        lb.clone(),
                    ))
                } else {
                    Some(crate::ironrdp::pdu::nego::NegoRequestData::cookie(lb.clone()))
                }
            } else if settings.use_vm_id && !settings.vm_id.is_empty() {
                Some(crate::ironrdp::pdu::nego::NegoRequestData::cookie(format!(
                    "vmconnect/{}",
                    settings.vm_id
                )))
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
            let explicit = &settings.sspi_package_list;
            if explicit.is_empty() {
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
                    None
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

    // Check if RDPDR devices are configured (used for both SVC and DVC registration)
    let has_rdpdr_devices = !settings.drive_redirections.is_empty()
        || settings.printers_enabled
        || settings.ports_enabled
        || settings.smart_cards_enabled;

    // -- Register RDPGFX Dynamic Virtual Channel (H.264 hardware decode) --
    let gfx_frame_rx = if settings.gfx_enabled {
        let (gfx_tx, gfx_rx) = std::sync::mpsc::channel::<crate::gfx::processor::GfxOutput>();
        let gfx_proc = crate::gfx::processor::GfxProcessor::new(
            settings.h264_decoder_preference,
            gfx_tx,
            settings.nal_passthrough,
        );
        let mut drdynvc = crate::ironrdp_dvc::DrdynvcClient::new().with_dynamic_channel(gfx_proc);

        // Register RDPDR DVC processor (modern Windows servers route RDPDR through DVC)
        if has_rdpdr_devices {
            let rdpdr_dvc = super::rdpdr::RdpdrDvcProcessor::new(
                session_id.to_string(),
                event_emitter.clone(),
                if settings.drive_redirection_enabled { settings.drive_redirections.clone() } else { settings.drive_redirections.clone() },
                super::rdpdr::DeviceFlags {
                    printers: settings.printers_enabled,
                    ports: settings.ports_enabled,
                    smart_cards: settings.smart_cards_enabled,
                },
            );
            drdynvc = drdynvc.with_dynamic_channel(rdpdr_dvc);
            log::info!("RDP session {session_id}: RDPDR DVC processor registered");
        }

        // Register AUDIN DVC processor for audio input (microphone)
        if settings.enable_audio_recording {
            let audin = super::audin::AudinDvcProcessor::new(session_id.to_string(), true);
            drdynvc = drdynvc.with_dynamic_channel(audin);
            log::info!("RDP session {session_id}: AUDIN DVC processor registered (audio input)");
        }

        connector.attach_static_channel(drdynvc);
        log::info!(
            "RDP session {session_id}: RDPGFX DVC registered (H.264 decode enabled, nal_passthrough={})",
            settings.nal_passthrough
        );
        Some(gfx_rx)
    } else if has_rdpdr_devices {
        // No GFX but have RDPDR devices — create DRDYNVC just for RDPDR
        let rdpdr_dvc = super::rdpdr::RdpdrDvcProcessor::new(
            session_id.to_string(),
            event_emitter.clone(),
            settings.drive_redirections.clone(),
            super::rdpdr::DeviceFlags {
                printers: settings.printers_enabled,
                ports: settings.ports_enabled,
                smart_cards: settings.smart_cards_enabled,
            },
        );
        let mut drdynvc = crate::ironrdp_dvc::DrdynvcClient::new().with_dynamic_channel(rdpdr_dvc);
        if settings.enable_audio_recording {
            let audin = super::audin::AudinDvcProcessor::new(session_id.to_string(), true);
            drdynvc = drdynvc.with_dynamic_channel(audin);
            log::info!("RDP session {session_id}: AUDIN DVC processor registered (no GFX)");
        }
        connector.attach_static_channel(drdynvc);
        log::info!("RDP session {session_id}: RDPDR DVC processor registered (no GFX)");
        None
    } else {
        None
    };

    // -- Register CLIPRDR Static Virtual Channel (clipboard redirection) --
    let clipboard_state: Option<SharedClipboardState> = if settings.clipboard_enabled {
        let clip_state = Arc::new(Mutex::new(clipboard::ClipboardState::new()));
        let backend = clipboard::AppCliprdrBackend::new(
            session_id.to_string(),
            event_emitter.clone(),
            clip_state.clone(),
        );
        let cliprdr = crate::ironrdp_cliprdr::CliprdrClient::new(Box::new(backend));
        connector.attach_static_channel(cliprdr);
        log::info!("RDP session {session_id}: CLIPRDR SVC registered (clipboard enabled)");
        Some(clip_state)
    } else {
        None
    };

    // -- Register RDPDR SVC (legacy static channel, for older servers) --
    if has_rdpdr_devices {
        let rdpdr_client = super::rdpdr::RdpdrClient::new(
            session_id.to_string(),
            event_emitter.clone(),
            settings.drive_redirections.clone(),
            super::rdpdr::DeviceFlags {
                printers: settings.printers_enabled,
                ports: settings.ports_enabled,
                smart_cards: settings.smart_cards_enabled,
            },
        );
        connector.attach_static_channel(rdpdr_client);
        // Windows Server requires rdpsnd to complete format negotiation
        // before it sends the RDPDR Server Core Capability Request.
        connector.attach_static_channel(super::rdpdr::RdpsndClient::new(
            session_id.to_string(),
            event_emitter.clone(),
            settings.enable_audio_playback,
        ));
        log::info!(
            "RDP session {session_id}: RDPDR SVC registered ({} drives, printers={}, ports={}, smartcards={})",
            settings.drive_redirections.len(),
            settings.printers_enabled,
            settings.ports_enabled,
            settings.smart_cards_enabled,
        );
        for (i, d) in settings.drive_redirections.iter().enumerate() {
            log::info!(
                "RDP session {session_id}: drive[{i}] name='{}' path='{}' readOnly={} preferredLetter={:?}",
                d.name, d.path, d.read_only, d.preferred_letter,
            );
        }
    }

    // Log gateway / Hyper-V / negotiation settings
    if settings.gateway_enabled {
        log::info!(
            "RDP session {session_id}: gateway enabled -> {}:{}",
            settings.gateway_hostname,
            settings.gateway_port
        );
    }
    if settings.use_vm_id {
        log::info!(
            "RDP session {session_id}: Hyper-V VM ID mode -> vm_id={:?} enhanced={}",
            settings.vm_id,
            settings.enhanced_session_mode
        );
    }
    if settings.auto_detect {
        log::info!(
            "RDP session {session_id}: auto-detect negotiation -> strategy={} maxRetries={}",
            settings.negotiation_strategy,
            settings.max_retries
        );
    }
    if !settings.load_balancing_info.is_empty() {
        log::info!(
            "RDP session {session_id}: load balancing info -> {:?} (routing_token={})",
            settings.load_balancing_info,
            settings.use_routing_token
        );
    }
    if !settings.use_credssp {
        log::info!("RDP session {session_id}: CredSSP globally DISABLED by user");
    }

    // -- 3. Connection begin (pre-TLS phase) --

    stats.set_phase("negotiating");
    log::info!("RDP session {session_id}: starting connection sequence");
    let t_negotiate = Instant::now();
    let should_upgrade = crate::ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .map_err(|e| format!("connect_begin failed: {e}"))?;
    let negotiate_ms = t_negotiate.elapsed().as_millis();
    log::info!("RDP session {session_id}: X.224/MCS negotiation took {negotiate_ms}ms");

    // -- 4. TLS upgrade --

    stats.set_phase("tls_upgrade");
    log::info!("RDP session {session_id}: upgrading to TLS");
    let t_tls = Instant::now();

    let (tcp_stream, leftover) = framed.into_inner();
    let (mut tls_framed, server_public_key) =
        tls_upgrade(tcp_stream, host, leftover, cached_tls_connector)?;
    let tls_ms = t_tls.elapsed().as_millis();
    log::info!("RDP session {session_id}: TLS upgrade took {tls_ms}ms");
    log::info!(
        "RDP session {session_id}: server public key: {} bytes, first 16: {:02x?}",
        server_public_key.len(),
        &server_public_key[..server_public_key.len().min(16)]
    );

    // Extract and emit server certificate details (full X.509 info)
    {
        let (tls_stream, _) = tls_framed.get_inner();
        if let Some(details) = extract_cert_details(tls_stream) {
            let _ = event_emitter.emit_event(
                "rdp://cert-fingerprint",
                serde_json::to_value(&serde_json::json!({
                    "session_id": session_id,
                    "fingerprint": details.fingerprint,
                    "host": host,
                    "port": port,
                    "subject": details.subject,
                    "issuer": details.issuer,
                    "valid_from": details.valid_from,
                    "valid_to": details.valid_to,
                    "serial": details.serial,
                    "signature_algorithm": details.signature_algorithm,
                    "san": details.san,
                    "pem": details.pem,
                })).unwrap_or_default(),
            );
        } else if let Some(fp) = extract_cert_fingerprint(tls_stream) {
            // Fallback: emit fingerprint-only if full parsing failed
            let _ = event_emitter.emit_event(
                "rdp://cert-fingerprint",
                serde_json::to_value(&serde_json::json!({
                    "session_id": session_id,
                    "fingerprint": fp,
                    "host": host,
                    "port": port,
                })).unwrap_or_default(),
            );
        }
    }

    let upgraded = crate::ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

    // -- Shutdown check before CredSSP/NLA --
    match cmd_rx.cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown before CredSSP");
            return Err("session_shutdown: cancelled before CredSSP".into());
        }
        _ => {}
    }

    // -- 5. Finalize connection (CredSSP / NLA + remaining handshake) --

    stats.set_phase("authenticating");
    log::info!("RDP session {session_id}: finalizing connection (CredSSP/NLA)");

    let _ = event_emitter.emit_event(
        "rdp://status",
        serde_json::to_value(&RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: "Authenticating...".to_string(),
            desktop_width: None,
            desktop_height: None,
        }).unwrap_or_default(),
    );

    let t_auth = Instant::now();

    let mut network_client = BlockingNetworkClient::new(cached_http_client);
    let server_name = crate::ironrdp::connector::ServerName::new(host);

    let connection_result: ConnectionResult = crate::ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut tls_framed,
        &mut network_client,
        server_name,
        server_public_key,
        None,
    )
    .map_err(|e| {
        let mut msg = format!("connect_finalize failed: {e}");
        let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
        while let Some(cause) = source {
            msg.push_str(&format!(", caused by: {cause}"));
            source = std::error::Error::source(cause);
        }

        let fail_auth_ms = t_auth.elapsed().as_millis();
        msg.push_str(&format!(
            " [phase=BasicSettingsExchange, auth_elapsed={fail_auth_ms}ms, tcp={tcp_ms}ms, tls={tls_ms}ms, negotiate={negotiate_ms}ms]"
        ));

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
        emit_log(event_emitter, log_sink, "error", msg.clone(), session_id);
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
    let _ = event_emitter.emit_event(
        "rdp://timing",
        serde_json::to_value(&serde_json::json!({
            "session_id": session_id,
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "negotiate_ms": negotiate_ms,
            "tls_ms": tls_ms,
            "auth_ms": auth_ms,
            "total_ms": total_ms,
        })).unwrap_or_default(),
    );

    // -- 6. Enter active session --

    let desktop_width = connection_result.desktop_size.width;
    let desktop_height = connection_result.desktop_size.height;

    stats.set_phase("active");
    log::info!("RDP session {session_id}: connected! Desktop: {desktop_width}x{desktop_height}");

    let _ = event_emitter.emit_event(
        "rdp://status",
        serde_json::to_value(&RdpStatusEvent {
            session_id: session_id.to_string(),
            status: "connected".to_string(),
            message: format!("Connected ({desktop_width}x{desktop_height})"),
            desktop_width: Some(desktop_width),
            desktop_height: Some(desktop_height),
        }).unwrap_or_default(),
    );

    let image = DecodedImage::new(PixelFormat::RgbA32, desktop_width, desktop_height);

    // Save connection result fields before ActiveStage::new() consumes it.
    let cr_enable_server_pointer = connection_result.enable_server_pointer;
    let cr_pointer_software_rendering = connection_result.pointer_software_rendering;
    let cr_io_channel_id = connection_result.io_channel_id;
    let cr_user_channel_id = connection_result.user_channel_id;

    // Log registered channels with their IDs
    let channel_count = connection_result.static_channels.iter().count();
    log::info!(
        "RDP session {session_id}: {channel_count} static channels registered (io={cr_io_channel_id}, user={cr_user_channel_id})"
    );
    for (type_id, svc) in connection_result.static_channels.iter() {
        let cid = connection_result.static_channels.get_channel_id_by_type_id(type_id);
        log::info!(
            "RDP session {session_id}: SVC '{:?}' channel_id={:?}",
            svc.channel_name(), cid,
        );
    }

    log::info!(
        "RDP session {session_id}: pointer config — server: enable={}, software={} | requested: enable={}, software={}",
        cr_enable_server_pointer, cr_pointer_software_rendering,
        settings.enable_server_pointer, settings.pointer_software_rendering,
    );

    let mut active_stage = ActiveStage::new(connection_result);

    // Override pointer settings if the server negotiated different values
    // than what we requested.  This is critical for local cursor mode
    // where we need PointerBitmap events (requires software_rendering=false).
    if settings.enable_server_pointer != cr_enable_server_pointer
        || settings.pointer_software_rendering != cr_pointer_software_rendering
    {
        log::info!(
            "RDP session {session_id}: overriding server pointer config to match requested values"
        );
        active_stage.set_enable_server_pointer(settings.enable_server_pointer);
        let new_fp = crate::ironrdp::session::fast_path::ProcessorBuilder {
            io_channel_id: cr_io_channel_id,
            user_channel_id: cr_user_channel_id,
            enable_server_pointer: settings.enable_server_pointer,
            pointer_software_rendering: settings.pointer_software_rendering,
        }
        .build();
        active_stage.set_fastpath_processor(new_fp);
    }

    // Initialize the shared framebuffer slot for this session
    frame_store.init(session_id, desktop_width, desktop_height);

    // -- 6b. Create frame compositor (if requested) --
    let render_backend = RenderBackend::from_str(&settings.render_backend);
    let mut compositor: Option<Box<dyn FrameCompositor>> = None;
    let mut active_render_backend = "webview".to_string();

    if render_backend.is_composited() {
        match native_renderer::create_compositor(&render_backend, desktop_width, desktop_height) {
            Some((comp, backend_name)) => {
                log::info!(
                    "RDP session {session_id}: compositor '{backend_name}' created for {desktop_width}x{desktop_height}"
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

    // Notify the frontend which render backend is actually active
    let _ = event_emitter.emit_event(
        "rdp://render-backend",
        serde_json::to_value(&serde_json::json!({
            "session_id": session_id,
            "backend": active_render_backend,
        })).unwrap_or_default(),
    );

    Ok(EstablishedSession {
        tls_framed,
        active_stage,
        image,
        desktop_width,
        desktop_height,
        compositor,
        active_render_backend,
        gfx_frame_rx,
        clipboard_state,
    })
}

// ---- Layer 2: Active Session Loop ----

/// Run the main PDU processing loop.  Returns a `SessionLoopExit` indicating
/// why the loop stopped (shutdown, server closed, network error, etc.).
#[allow(clippy::too_many_arguments)]
fn run_active_session_loop(
    session_id: &str,
    est: &mut EstablishedSession,
    settings: &ResolvedSettings,
    event_emitter: &DynEventEmitter,
    cmd_rx: &mut crate::rdp::wake_channel::WakeReceiver,
    stats: &Arc<RdpSessionStats>,
    frame_store: &SharedFrameStoreState,
    frame_channel: &DynFrameChannel,
    log_sink: &LogSink,
) -> SessionLoopExit {
    // Viewer channel management for session persistence.
    let mut viewer_detached = false;
    let mut attached_channel: Option<DynFrameChannel> = None;

    // ── Event-driven poller ─────────────────────────────────────────
    // Instead of blocking on read_pdu() with a timeout (which adds
    // latency to input), we set the socket to non-blocking and use
    // polling::Poller to wait on BOTH the TCP socket and the wake
    // pipe simultaneously.  The thread sleeps until either source
    // has data — zero timeout polling, sub-millisecond input latency.

    // Switch to non-blocking I/O for the poller.
    set_nonblocking_on_framed(&est.tls_framed, true);

    let tcp_ref = tcp_stream_ref(&est.tls_framed);
    let mut poller = match crate::rdp::session_poller::SessionPoller::new(
        tcp_ref,
        &cmd_rx.wake_reader,
    ) {
        Ok(p) => {
            log::info!("RDP session {session_id}: event-driven poller active");
            Some(p)
        }
        Err(e) => {
            log::warn!("RDP session {session_id}: poller creation failed ({e}), using timeout fallback");
            set_nonblocking_on_framed(&est.tls_framed, false);
            set_read_timeout_on_framed(&est.tls_framed, Some(Duration::from_millis(2)));
            None
        }
    };

    let mut last_stats_emit = Instant::now();
    let stats_interval = settings.stats_interval;
    let max_consecutive_errors = settings.max_consecutive_errors;
    let full_frame_sync_interval = settings.full_frame_sync_interval;

    // Frame batching state
    let frame_batching = settings.frame_batching;
    let batch_interval = settings.frame_batch_interval;
    let mut dirty_regions: Vec<(u16, u16, u16, u16)> = Vec::new();
    let mut last_frame_emit = Instant::now();

    // Reusable buffers
    let mut merged_inputs: Vec<FastPathInputEvent> = Vec::new();
    let mut batch_dirty_rects: Vec<(u16, u16, u16, u16)> = Vec::new();
    let mut gfx_frames: Vec<crate::gfx::processor::GfxOutput> = Vec::new();

    /// Maximum input events coalesced per loop iteration.
    const INPUT_BACKLOG_LIMIT: usize = 512;

    // Max time to sleep in the poller (for stats/keepalive timers).
    let poll_timeout = stats_interval.min(Duration::from_secs(5));

    loop {
        // ── Phase 0: Wait for events ────────────────────────────
        // Check if the TLS layer already has buffered plaintext
        // (from a previous record that contained multiple PDUs).
        let tls_has_buffered = !est.tls_framed.peek().is_empty();

        if !tls_has_buffered {
            if let Some(ref mut p) = poller {
                // Event-driven: sleep until TCP data, wake signal, or timer.
                match p.wait(Some(poll_timeout)) {
                    Ok(result) => {
                        if result.wake_ready {
                            cmd_rx.drain_wake();
                        }
                    }
                    Err(e) => {
                        log::warn!("RDP session {session_id}: poller error: {e}");
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }
            // Fallback (poller=None): the socket has a 2ms read timeout
            // so read_pdu() below acts as the timer. No explicit wait.
        }
        // - Drain ALL pending commands (input coalescing) -
        merged_inputs.clear();
        let mut should_break = false;
        let mut should_reconnect = false;
        let mut input_dropped = 0u64;
        loop {
            match cmd_rx.cmd_rx.try_recv() {
                Ok(RdpCommand::Shutdown) => {
                    log::info!("RDP session {session_id}: shutdown requested");
                    if let Ok(outputs) = est.active_stage.graceful_shutdown() {
                        for output in outputs {
                            if let ActiveStageOutput::ResponseFrame(data) = output {
                                stats
                                    .bytes_sent
                                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                                let _ = est.tls_framed.write_all(&data);
                            }
                        }
                    }
                    should_break = true;
                    break;
                }
                Ok(RdpCommand::Input(events)) => {
                    if merged_inputs.len() < INPUT_BACKLOG_LIMIT {
                        merged_inputs.extend(events);
                    } else {
                        input_dropped += events.len() as u64;
                    }
                }
                Ok(RdpCommand::AttachViewer(new_channel)) => {
                    log::info!("RDP session {session_id}: viewer attached (new frame channel)");
                    // Send the LIVE framebuffer from est.image (not the
                    // potentially stale frame_store) so the reattached
                    // viewer sees the current screen state immediately.
                    {
                        let w = est.desktop_width;
                        let h = est.desktop_height;
                        let img_data = est.image.data();
                        let total = 8 + img_data.len();
                        let mut payload = Vec::with_capacity(total);
                        payload.extend_from_slice(&0u16.to_le_bytes()); // x=0
                        payload.extend_from_slice(&0u16.to_le_bytes()); // y=0
                        payload.extend_from_slice(&w.to_le_bytes());
                        payload.extend_from_slice(&h.to_le_bytes());
                        payload.extend_from_slice(img_data);
                        let _ = new_channel.send_raw(payload);
                        // Also sync the frame_store with the live image
                        // so future reattaches use fresh data too.
                        let slots = frame_store.slots.read().expect("lock poisoned");
                        if let Some(slot_arc) = slots.get(session_id) {
                            let mut slot = slot_arc.inner.write().expect("lock poisoned");
                            if slot.data.len() == img_data.len() {
                                slot.data.copy_from_slice(img_data);
                            }
                        }
                    }
                    attached_channel = Some(new_channel);
                    viewer_detached = false;
                    // Force next frame delivery to do a full-frame sync
                    stats.frame_count.store(0, std::sync::atomic::Ordering::Relaxed);

                    // Emit "connected" status so the frontend knows the session is live
                    let _ = event_emitter.emit_event(
                        "rdp://status",
                        serde_json::to_value(&RdpStatusEvent {
                            session_id: session_id.to_string(),
                            status: "connected".to_string(),
                            message: format!(
                                "Reattached ({}x{})",
                                est.desktop_width, est.desktop_height
                            ),
                            desktop_width: Some(est.desktop_width),
                            desktop_height: Some(est.desktop_height),
                        }).unwrap_or_default(),
                    );
                }
                Ok(RdpCommand::DetachViewer) => {
                    log::info!("RDP session {session_id}: viewer detached");
                    viewer_detached = true;
                }
                Ok(RdpCommand::Reconnect) => {
                    log::info!("RDP session {session_id}: manual reconnect requested");
                    should_reconnect = true;
                    break;
                }
                Ok(RdpCommand::SignOut) => {
                    log::info!("RDP session {session_id}: sign-out requested");
                    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
                    let win_press =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::EXTENDED, 0x5B);
                    let r_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x13);
                    let r_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x13);
                    let win_release = FastPathInputEvent::KeyboardEvent(
                        KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED,
                        0x5B,
                    );
                    merged_inputs.extend([win_press, r_press, r_release, win_release]);
                    for ch in "logoff".encode_utf16() {
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(
                            KeyboardFlags::empty(),
                            ch,
                        ));
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(
                            KeyboardFlags::RELEASE,
                            ch,
                        ));
                    }
                    let enter_press =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1C);
                    let enter_release =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x1C);
                    merged_inputs.extend([enter_press, enter_release]);
                }
                Ok(RdpCommand::ForceReboot) => {
                    log::info!("RDP session {session_id}: force reboot requested");
                    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
                    let win_press =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::EXTENDED, 0x5B);
                    let r_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x13);
                    let r_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x13);
                    let win_release = FastPathInputEvent::KeyboardEvent(
                        KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED,
                        0x5B,
                    );
                    merged_inputs.extend([win_press, r_press, r_release, win_release]);
                    for ch in "shutdown /r /t 0 /f".encode_utf16() {
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(
                            KeyboardFlags::empty(),
                            ch,
                        ));
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(
                            KeyboardFlags::RELEASE,
                            ch,
                        ));
                    }
                    let enter_press =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1C);
                    let enter_release =
                        FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x1C);
                    merged_inputs.extend([enter_press, enter_release]);
                }
                Ok(RdpCommand::ClipboardCopy(text)) => {
                    if let Some(ref clip_state) = est.clipboard_state {
                        if let Ok(mut state) = clip_state.lock() {
                            state.local_text = Some(text);
                        }
                        // Advertise CF_UNICODETEXT to the server
                        if let Some(cliprdr) = est.active_stage
                            .get_svc_processor_mut::<crate::ironrdp_cliprdr::CliprdrClient>()
                        {
                            let format = crate::ironrdp_cliprdr::pdu::ClipboardFormat::new(
                                crate::ironrdp_cliprdr::pdu::ClipboardFormatId::new(clipboard::CF_UNICODETEXT),
                            );
                            match cliprdr.initiate_copy(&[format]) {
                                Ok(messages) => {
                                    match est.active_stage.process_svc_processor_messages(messages) {
                                        Ok(data) => {
                                            stats.bytes_sent.fetch_add(data.len() as u64, Ordering::Relaxed);
                                            let _ = est.tls_framed.write_all(&data);
                                        }
                                        Err(e) => log::warn!("CLIPRDR copy encode error: {e}"),
                                    }
                                }
                                Err(e) => log::warn!("CLIPRDR initiate_copy error: {e}"),
                            }
                        }
                    }
                }
                Ok(RdpCommand::ClipboardPaste) => {
                    if let Some(cliprdr) = est.active_stage
                        .get_svc_processor_mut::<crate::ironrdp_cliprdr::CliprdrClient>()
                    {
                        let format_id = crate::ironrdp_cliprdr::pdu::ClipboardFormatId::new(clipboard::CF_UNICODETEXT);
                        match cliprdr.initiate_paste(format_id) {
                            Ok(messages) => {
                                match est.active_stage.process_svc_processor_messages(messages) {
                                    Ok(data) => {
                                        stats.bytes_sent.fetch_add(data.len() as u64, Ordering::Relaxed);
                                        let _ = est.tls_framed.write_all(&data);
                                    }
                                    Err(e) => log::warn!("CLIPRDR paste encode error: {e}"),
                                }
                            }
                            Err(e) => log::warn!("CLIPRDR initiate_paste error: {e}"),
                        }
                    }
                }
                Ok(RdpCommand::ClipboardCopyFiles(entries)) => {
                    if let Some(ref clip_state) = est.clipboard_state {
                        // Store staged files and reset progress
                        if let Ok(mut state) = clip_state.lock() {
                            state.staged_files = entries.iter().map(|e| clipboard::StagedFile {
                                name: e.name.clone(),
                                size: e.size,
                                path: e.path.clone(),
                                is_directory: e.is_directory,
                            }).collect();
                            state.file_bytes_transferred = 0;
                        }
                        // Advertise FileGroupDescriptorW format to server
                        if let Some(cliprdr) = est.active_stage
                            .get_svc_processor_mut::<crate::ironrdp_cliprdr::CliprdrClient>()
                        {
                            let format = crate::ironrdp_cliprdr::pdu::ClipboardFormat::new(
                                crate::ironrdp_cliprdr::pdu::ClipboardFormatId::new(clipboard::FILEGROUPDESCRIPTORW_ID),
                            ).with_name(crate::ironrdp_cliprdr::pdu::ClipboardFormatName::FILE_LIST);
                            match cliprdr.initiate_copy(&[format]) {
                                Ok(messages) => {
                                    match est.active_stage.process_svc_processor_messages(messages) {
                                        Ok(data) => {
                                            stats.bytes_sent.fetch_add(data.len() as u64, Ordering::Relaxed);
                                            let _ = est.tls_framed.write_all(&data);
                                        }
                                        Err(e) => log::warn!("CLIPRDR file copy encode error: {e}"),
                                    }
                                }
                                Err(e) => log::warn!("CLIPRDR initiate_copy (files) error: {e}"),
                            }
                        }
                    }
                }
                Ok(RdpCommand::ToggleFeature { feature, enabled }) => {
                    log::info!("RDP session {session_id}: toggle '{feature}' = {enabled}");
                    match feature.as_str() {
                        "audio" => {
                            if let Some(snd) = est.active_stage
                                .get_svc_processor_mut::<super::rdpdr::RdpsndClient>()
                            {
                                snd.set_enabled(enabled);
                            }
                        }
                        "clipboard" => {
                            if let Some(ref clip_state) = est.clipboard_state {
                                if let Ok(mut state) = clip_state.lock() {
                                    state.disabled = !enabled;
                                }
                            }
                        }
                        "audioInput" => {
                            // AUDIN is a DVC — no mutable accessor available at runtime.
                            // The setting controls registration at connect time.
                            log::info!("RDP session {session_id}: audioInput toggle requires reconnect to take effect");
                        }
                        _ => log::warn!("RDP session {session_id}: unknown feature toggle '{feature}'"),
                    }
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
            return SessionLoopExit::Shutdown;
        }
        if should_reconnect {
            return SessionLoopExit::ReconnectRequested;
        }
        if input_dropped > 0 {
            log::warn!(
                "RDP session {session_id}: dropped {input_dropped} input events (backlog > {INPUT_BACKLOG_LIMIT})"
            );
        }

        // Send all coalesced input in a single batch
        if !merged_inputs.is_empty() {
            // Single batch update — avoids N separate Instant::now() calls.
            stats.record_input_sent_batch(merged_inputs.len() as u64);
            let active_ch = if !viewer_detached {
                attached_channel.as_ref().unwrap_or(frame_channel)
            } else {
                frame_channel // will fail silently on send
            };
            match est
                .active_stage
                .process_fastpath_input(&mut est.image, &merged_inputs)
            {
                Ok(outputs) => {
                    if !viewer_detached {
                        if let Err(e) = process_outputs(
                            session_id,
                            &outputs,
                            &mut est.tls_framed,
                            &est.image,
                            est.desktop_width,
                            est.desktop_height,
                            &event_emitter,
                            stats,
                            full_frame_sync_interval,
                            frame_store,
                            active_ch,
                        ) {
                            let err_str = format!("{e}");
                            if is_network_error_str(&err_str) {
                                emit_log(event_emitter, log_sink, "warn", format!("Network error (will reconnect): {err_str}"), session_id);
                                return SessionLoopExit::NetworkError(err_str);
                            }
                            emit_log(event_emitter, log_sink, "error", format!("Output processing error: {err_str}"), session_id);
                            return SessionLoopExit::ProtocolError(err_str);
                        }
                    } else {
                        // Still need to send ResponseFrames even when viewer is detached
                        for output in &outputs {
                            if let ActiveStageOutput::ResponseFrame(data) = output {
                                stats
                                    .bytes_sent
                                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                                stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                if let Err(e) = est.tls_framed.write_all(data) {
                                    let msg = format!("Write failed: {e}");
                                    emit_log(event_emitter, log_sink, "warn", format!("Network error (will reconnect): {msg}"), session_id);
                                    return SessionLoopExit::NetworkError(msg);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("RDP {session_id}: input processing error: {e}");
                    emit_log(event_emitter, log_sink, "warn", format!("Input processing error: {e}"), session_id);
                }
            }
        }

        // - Emit periodic stats -
        if last_stats_emit.elapsed() >= stats_interval {
            let _ = event_emitter.emit_event("rdp://stats", serde_json::to_value(&stats.to_event(session_id)).unwrap_or_default());
            last_stats_emit = Instant::now();

            // -- RDP-level keepalive guard --
            //
            // Dual-timestamp model: only send a keepalive when BOTH
            // received-data and sent-input have been idle for the threshold.
            // Minimum interval between keepalives is 5 seconds.
            //
            // Piggy-backs on the stats interval (~1s) so we don't need
            // a separate timer.
            let keepalive_idle = Duration::from_secs(10);
            let keepalive_min_interval = Duration::from_secs(5);
            if stats.should_send_keepalive(keepalive_idle, keepalive_min_interval) {
                // Send a zero-length FastPath input frame as a keepalive
                // (the server treats any valid PDU as proof of life).
                if let Ok(outputs) = est.active_stage.process_fastpath_input(&mut est.image, &[]) {
                    for output in &outputs {
                        if let ActiveStageOutput::ResponseFrame(data) = output {
                            let _ = est.tls_framed.write_all(data);
                        }
                    }
                }
                stats.record_keepalive_sent();
                log::trace!("RDP session {session_id}: keepalive sent");
            }
        }

        // - Flush batched frame updates -
        if frame_batching
            && !dirty_regions.is_empty()
            && last_frame_emit.elapsed() >= batch_interval
        {
            merge_dirty_regions(&mut dirty_regions);
            if !viewer_detached {
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                if let Some(ref mut comp) = est.compositor {
                    for &(x, y, w, h) in &dirty_regions {
                        if w > 0 && h > 0 {
                            comp.update_region(est.image.data(), est.desktop_width, x, y, w, h);
                        }
                    }
                    if let Some(frame) = comp.flush() {
                        push_compositor_frame_via_channel(frame, active_ch);
                    }
                } else {
                    push_multi_rect_via_channel(
                        est.image.data(),
                        est.desktop_width,
                        &dirty_regions,
                        active_ch,
                    );
                }
            }
            dirty_regions.clear();
            last_frame_emit = Instant::now();
        }

        // - Drain GFX decoded frames (H.264 via RDPGFX DVC) -
        //
        // High/low watermark flow control.  When the queue exceeds
        // HIGH_WATERMARK, older frames are dropped, keeping (count / 3) + 1
        // of the most recent ones.
        if let Some(ref gfx_rx) = est.gfx_frame_rx {
            gfx_frames.clear();
            while let Ok(gfx_frame) = gfx_rx.try_recv() {
                gfx_frames.push(gfx_frame);
            }
            let queue_len = gfx_frames.len();
            // NOTE: We no longer drop GFX frames via watermark flow control.
            // H.264 uses incremental decoding — dropping older frames loses
            // reference data and causes ghosting/corruption until the next
            // keyframe.  RGBA dirty rects are also incremental (partial
            // updates).  Instead, send all frames and let the frontend
            // pipeline handle queue pressure via its adaptive scheduling.
            if queue_len > 12 {
                log::debug!(
                    "GFX frame queue depth: {queue_len} (high but not dropping — incremental codec)"
                );
            }
            for gfx_output in gfx_frames.drain(..) {
                stats.record_frame();
                if viewer_detached {
                    continue;
                }
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                match gfx_output {
                    crate::gfx::processor::GfxOutput::Rgba(gfx_frame) => {
                        // Pre-reserve 8 bytes at the front of the RGBA buffer so
                        // we can write the header in-place — zero extra allocation
                        // and zero extra memcpy of the full RGBA payload.
                        let mut payload = gfx_frame.rgba;
                        let hdr_len = 8usize;
                        let rgba_len = payload.len();
                        payload.reserve(hdr_len);
                        // Shift existing RGBA data right by 8 bytes.
                        // SAFETY: we just reserved hdr_len extra bytes, and the
                        // source range [0..rgba_len] is valid.
                        unsafe {
                            let ptr = payload.as_mut_ptr();
                            std::ptr::copy(ptr, ptr.add(hdr_len), rgba_len);
                            payload.set_len(rgba_len + hdr_len);
                        }
                        payload[0..2].copy_from_slice(&gfx_frame.screen_x.to_le_bytes());
                        payload[2..4].copy_from_slice(&gfx_frame.screen_y.to_le_bytes());
                        payload[4..6].copy_from_slice(&gfx_frame.width.to_le_bytes());
                        payload[6..8].copy_from_slice(&gfx_frame.height.to_le_bytes());
                        let _ = active_ch.send_raw(payload);
                    }
                    crate::gfx::processor::GfxOutput::Nal(nal_frame) => {
                        push_nal_via_channel(&nal_frame, active_ch);
                    }
                }
            }
        }

        // - Read and process PDUs -
        batch_dirty_rects.clear();
        let mut batch_had_graphics = false;
        let mut batch_should_reactivate: Option<
            Box<crate::ironrdp::connector::connection_activation::ConnectionActivationSequence>,
        > = None;
        let mut batch_should_terminate = false;
        let mut pdus_this_batch: u32 = 0;

        loop {
            if pdus_this_batch > 0 && est.tls_framed.peek().is_empty() {
                break;
            }

            match est.tls_framed.read_pdu() {
                Ok((action, payload)) => {
                    // Successful PDU — reset consecutive error counters.
                    stats.record_successful_pdu();
                    let payload_len = payload.len() as u64;

                    // Log X224 PDUs with channel ID to trace SVC dispatch
                    if matches!(action, crate::ironrdp::pdu::Action::X224) && payload_len > 7 {
                        // MCS SendDataIndication: the channel_id is at offset 6 (after TPKT+X224+MCS headers)
                        // For X224 data, try to extract channel ID from the MCS envelope
                        let first_bytes: Vec<u8> = payload.iter().take(20).cloned().collect();
                        log::info!("RDP session {session_id}: X224 PDU ({payload_len}B) first_bytes={first_bytes:02x?}");
                    }

                    // Zero-byte PDU detection — catches broken connections
                    // that slip through the OS TCP stack without errors.
                    if payload_len == 0 {
                        let zero_count = stats.record_zero_byte_read();
                        const MAX_ZERO_BYTE_READS: u64 = 100;
                        if zero_count >= MAX_ZERO_BYTE_READS {
                            log::error!(
                                "RDP session {session_id}: {zero_count} consecutive \
                                 zero-byte reads — connection appears broken"
                            );
                            return SessionLoopExit::NetworkError(format!(
                                "Zero-byte read threshold exceeded ({zero_count}/{MAX_ZERO_BYTE_READS})"
                            ));
                        }
                    }

                    stats
                        .bytes_received
                        .fetch_add(payload_len, Ordering::Relaxed);
                    stats.pdus_received.fetch_add(1, Ordering::Relaxed);

                    match est
                        .active_stage
                        .process(&mut est.image, action, payload.as_ref())
                    {
                        Ok(outputs) => {
                            for output in outputs {
                                match output {
                                    ActiveStageOutput::ResponseFrame(data) => {
                                        log::debug!(
                                            "RDP session {session_id}: writing ResponseFrame ({} bytes) to TLS",
                                            data.len()
                                        );
                                        stats
                                            .bytes_sent
                                            .fetch_add(data.len() as u64, Ordering::Relaxed);
                                        stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                        if let Err(e) = est.tls_framed.write_all(&data) {
                                            return SessionLoopExit::NetworkError(format!(
                                                "Failed to send response frame: {e}"
                                            ));
                                        }
                                    }
                                    ActiveStageOutput::GraphicsUpdate(region) => {
                                        stats.record_frame();
                                        batch_had_graphics = true;
                                        let rw = region.right.saturating_sub(region.left) + 1;
                                        let rh = region.bottom.saturating_sub(region.top) + 1;
                                        if frame_batching {
                                            dirty_regions.push((region.left, region.top, rw, rh));
                                        } else if let Some(ref mut comp) = est.compositor {
                                            comp.update_region(
                                                est.image.data(),
                                                est.desktop_width,
                                                region.left,
                                                region.top,
                                                rw,
                                                rh,
                                            );
                                        } else {
                                            batch_dirty_rects.push((
                                                region.left,
                                                region.top,
                                                rw,
                                                rh,
                                            ));
                                        }
                                    }
                                    ActiveStageOutput::PointerDefault => {
                                        let _ = event_emitter.emit_event(
                                            "rdp://pointer",
                                            serde_json::to_value(&RdpPointerEvent {
                                                session_id: session_id.to_string(),
                                                pointer_type: "default",
                                                x: None, y: None,
                                                bitmap_rgba: None, bitmap_width: None, bitmap_height: None,
                                                hotspot_x: None, hotspot_y: None,
                                            }).unwrap_or_default(),
                                        );
                                    }
                                    ActiveStageOutput::PointerHidden => {
                                        let _ = event_emitter.emit_event(
                                            "rdp://pointer",
                                            serde_json::to_value(&RdpPointerEvent {
                                                session_id: session_id.to_string(),
                                                pointer_type: "hidden",
                                                x: None, y: None,
                                                bitmap_rgba: None, bitmap_width: None, bitmap_height: None,
                                                hotspot_x: None, hotspot_y: None,
                                            }).unwrap_or_default(),
                                        );
                                    }
                                    ActiveStageOutput::PointerPosition { x, y } => {
                                        let _ = event_emitter.emit_event(
                                            "rdp://pointer",
                                            serde_json::to_value(&RdpPointerEvent {
                                                session_id: session_id.to_string(),
                                                pointer_type: "position",
                                                x: Some(x), y: Some(y),
                                                bitmap_rgba: None, bitmap_width: None, bitmap_height: None,
                                                hotspot_x: None, hotspot_y: None,
                                            }).unwrap_or_default(),
                                        );
                                    }
                                    ActiveStageOutput::PointerBitmap(bitmap) => {
                                        // Encode the cursor bitmap as base64 RGBA and send
                                        // to the frontend for CSS cursor rendering.
                                        let rgba_b64 = base64::Engine::encode(
                                            &base64::engine::general_purpose::STANDARD,
                                            &bitmap.bitmap_data,
                                        );
                                        let _ = event_emitter.emit_event(
                                            "rdp://pointer",
                                            serde_json::to_value(&RdpPointerEvent {
                                                session_id: session_id.to_string(),
                                                pointer_type: "bitmap",
                                                x: None,
                                                y: None,
                                                bitmap_rgba: Some(rgba_b64),
                                                bitmap_width: Some(bitmap.width),
                                                bitmap_height: Some(bitmap.height),
                                                hotspot_x: Some(bitmap.hotspot_x),
                                                hotspot_y: Some(bitmap.hotspot_y),
                                            }).unwrap_or_default(),
                                        );
                                    }
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
                            emit_log(event_emitter, log_sink, "warn", format!("PDU error (recovering): {err_str}"), session_id);
                            // Stats-based consecutive error tracking.
                            let count = stats.record_pdu_error();
                            stats.set_last_error(&err_str);
                            if count as u32 >= max_consecutive_errors {
                                let msg = format!("Error threshold exceeded ({count}/{max_consecutive_errors}): {err_str}");
                                emit_log(event_emitter, log_sink, "error", msg.clone(), session_id);
                                return SessionLoopExit::ProtocolError(msg);
                            }
                        }
                    }

                    pdus_this_batch += 1;
                    if batch_should_reactivate.is_some() || batch_should_terminate {
                        break;
                    }
                }
                Err(e) if is_timeout_error(&e) => {
                    // WouldBlock — no more data in socket right now.
                    // The poller will wake us when more arrives.
                    break;
                }
                Err(e) => {
                    if e.kind() == io::ErrorKind::UnexpectedEof {
                        let msg = if viewer_detached {
                            "Server closed connection (EOF) while detached"
                        } else {
                            "Server closed connection (EOF)"
                        };
                        log::info!("RDP session {session_id}: {msg}");
                        emit_log(event_emitter, log_sink, "info", msg.to_string(), session_id);
                        if viewer_detached {
                            return SessionLoopExit::NetworkError(msg.to_string());
                        }
                        return SessionLoopExit::ServerClosed;
                    }
                    let err_str = format!("{e}");
                    log::error!("RDP session {session_id}: read error: {err_str}");
                    // Classify: network errors are recoverable
                    if is_network_error(&e) || is_network_error_str(&err_str) {
                        emit_log(event_emitter, log_sink, "warn", format!("Network error (will reconnect): {err_str}"), session_id);
                        return SessionLoopExit::NetworkError(err_str);
                    }
                    emit_log(event_emitter, log_sink, "error", format!("Protocol error: {err_str}"), session_id);
                    return SessionLoopExit::ProtocolError(err_str);
                }
            }
        } // end inner PDU drain loop

        // -- Fulfil pending CLIPRDR format data requests --
        // The backend's on_format_data_request() stored the request; we
        // respond here via submit_format_data() because we can't call it
        // during process() (the SVC processor is borrowed).
        if let Some(ref clip_state) = est.clipboard_state {
            let pending = {
                let mut state = clip_state.lock().expect("lock poisoned");
                state.pending_data_request.take()
            };
            if let Some(request) = pending {
                let is_file_list = request.format == crate::ironrdp_cliprdr::pdu::ClipboardFormatId::new(clipboard::FILEGROUPDESCRIPTORW_ID);
                let (local_text, staged_files) = {
                    let state = clip_state.lock().expect("lock poisoned");
                    (state.local_text.clone(), state.staged_files.clone())
                };

                if let Some(cliprdr) = est.active_stage
                    .get_svc_processor_mut::<crate::ironrdp_cliprdr::CliprdrClient>()
                {
                    let response = if is_file_list && !staged_files.is_empty() {
                        clipboard::encode_file_list_response(&staged_files)
                    } else if let Some(ref text) = local_text {
                        crate::ironrdp_cliprdr::pdu::OwnedFormatDataResponse::new_data(
                            clipboard::encode_utf16le(text),
                        )
                    } else {
                        crate::ironrdp_cliprdr::pdu::OwnedFormatDataResponse::new_error()
                    };
                    match cliprdr.submit_format_data(response) {
                        Ok(messages) => {
                            match est.active_stage.process_svc_processor_messages(messages) {
                                Ok(data) => {
                                    stats.bytes_sent.fetch_add(data.len() as u64, Ordering::Relaxed);
                                    let _ = est.tls_framed.write_all(&data);
                                }
                                Err(e) => log::warn!("CLIPRDR submit_format_data encode error: {e}"),
                            }
                        }
                        Err(e) => log::warn!("CLIPRDR submit_format_data error: {e}"),
                    }
                }
            }

            // -- Fulfil pending CLIPRDR file contents requests --
            let pending_fcr = {
                let mut state = clip_state.lock().expect("lock poisoned");
                state.pending_file_contents_request.take()
            };
            if let Some(request) = pending_fcr {
                let staged_files = clip_state.lock().expect("lock poisoned").staged_files.clone();
                if let Some(file) = staged_files.get(request.index as usize) {
                    if let Some(cliprdr) = est.active_stage
                        .get_svc_processor_mut::<crate::ironrdp_cliprdr::CliprdrClient>()
                    {
                        use crate::ironrdp_cliprdr::pdu::FileContentsFlags;

                        let response = if request.flags.contains(FileContentsFlags::SIZE) {
                            crate::ironrdp_cliprdr::pdu::FileContentsResponse::new_size_response(
                                request.stream_id, file.size,
                            )
                        } else if file.is_directory {
                            // Directory entries have no data
                            crate::ironrdp_cliprdr::pdu::FileContentsResponse::new_data_response(
                                request.stream_id, Vec::<u8>::new(),
                            )
                        } else {
                            match std::fs::File::open(&file.path) {
                                Ok(mut f) => {
                                    use std::io::{Read, Seek, SeekFrom};
                                    let _ = f.seek(SeekFrom::Start(request.position));
                                    let mut buf = vec![0u8; request.requested_size as usize];
                                    let n = f.read(&mut buf).unwrap_or(0);
                                    buf.truncate(n);

                                    // Update progress and emit event
                                    let (transferred, total_size, file_count, files_done) = {
                                        let mut state = clip_state.lock().expect("lock poisoned");
                                        state.file_bytes_transferred += n as u64;
                                        let total: u64 = state.staged_files.iter().map(|f| f.size).sum();
                                        let count = state.staged_files.iter().filter(|f| !f.is_directory).count();
                                        // A file is "done" when we've read past its end
                                        let done = state.staged_files.iter().take(request.index as usize)
                                            .filter(|f| !f.is_directory).count();
                                        (state.file_bytes_transferred, total, count, done)
                                    };
                                    let _ = event_emitter.emit_event(
                                        "rdp://file-transfer-progress",
                                        serde_json::json!({
                                            "session_id": session_id,
                                            "file_index": request.index,
                                            "file_name": file.name,
                                            "transferred": transferred,
                                            "total": total_size,
                                            "file_count": file_count,
                                            "files_done": files_done,
                                        }),
                                    );

                                    crate::ironrdp_cliprdr::pdu::FileContentsResponse::new_data_response(
                                        request.stream_id, buf,
                                    )
                                }
                                Err(e) => {
                                    log::error!("CLIPRDR file read error for '{}': {e}", file.path);
                                    crate::ironrdp_cliprdr::pdu::FileContentsResponse::new_error(request.stream_id)
                                }
                            }
                        };
                        match cliprdr.submit_file_contents(response) {
                            Ok(messages) => {
                                match est.active_stage.process_svc_processor_messages(messages) {
                                    Ok(data) => {
                                        stats.bytes_sent.fetch_add(data.len() as u64, Ordering::Relaxed);
                                        let _ = est.tls_framed.write_all(&data);
                                    }
                                    Err(e) => log::warn!("CLIPRDR submit_file_contents encode error: {e}"),
                                }
                            }
                            Err(e) => log::warn!("CLIPRDR submit_file_contents error: {e}"),
                        }
                    }
                } else {
                    log::warn!("CLIPRDR file contents request for invalid index {}", request.index);
                }
            }
        }

        // Flush accumulated dirty rects from this batch.
        if batch_had_graphics && !frame_batching {
            if let Some(ref mut comp) = est.compositor {
                if !viewer_detached {
                    if let Some(frame) = comp.flush() {
                        let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                        push_compositor_frame_via_channel(frame, active_ch);
                    }
                }
            } else if !batch_dirty_rects.is_empty() && !viewer_detached {
                merge_dirty_regions(&mut batch_dirty_rects);
                let active_ch = attached_channel.as_ref().unwrap_or(frame_channel);
                push_multi_rect_via_channel(
                    est.image.data(),
                    est.desktop_width,
                    &batch_dirty_rects,
                    active_ch,
                );
            }

            let fc = stats.frame_count.load(Ordering::Relaxed);
            if fc > 0 && (fc == 1 || fc.is_multiple_of(full_frame_sync_interval)) {
                frame_store.update_region(
                    session_id,
                    est.image.data(),
                    est.desktop_width,
                    &crate::ironrdp::pdu::geometry::InclusiveRectangle {
                        left: 0,
                        top: 0,
                        right: est.desktop_width.saturating_sub(1),
                        bottom: est.desktop_height.saturating_sub(1),
                    },
                );
            }
        }

        if batch_should_terminate {
            return SessionLoopExit::ServerClosed;
        }

        if let Some(cas) = batch_should_reactivate {
            log::info!("RDP session {session_id}: DeactivateAll received, running reactivation");
            stats.reactivations.fetch_add(1, Ordering::Relaxed);

            let _ = event_emitter.emit_event(
                "rdp://status",
                serde_json::to_value(&RdpStatusEvent {
                    session_id: session_id.to_string(),
                    status: "connecting".to_string(),
                    message: "Reactivating session...".to_string(),
                    desktop_width: None,
                    desktop_height: None,
                }).unwrap_or_default(),
            );

            // Switch back to blocking mode for reactivation (it uses
            // synchronous read_pdu calls that need to block).
            set_nonblocking_on_framed(&est.tls_framed, false);

            // Preserve static channels (SVCs) across reactivation — the
            // server does NOT re-negotiate channels, so the existing CLIPRDR,
            // DRDYNVC, RDPDR processors must survive into the new ActiveStage.
            let preserved_channels = est.active_stage.take_static_channels();

            match handle_reactivation(cas, &mut est.tls_framed, stats, Some(preserved_channels)) {
                Ok(new_result) => {
                    est.desktop_width = new_result.desktop_size.width;
                    est.desktop_height = new_result.desktop_size.height;
                    est.image = DecodedImage::new(
                        PixelFormat::RgbA32,
                        est.desktop_width,
                        est.desktop_height,
                    );
                    est.active_stage = ActiveStage::new(new_result);
                    frame_store.reinit(session_id, est.desktop_width, est.desktop_height);
                    stats.frame_count.store(0, std::sync::atomic::Ordering::Relaxed);
                    stats.set_phase("active");

                    log::info!(
                        "RDP session {session_id}: reactivated at {}x{}",
                        est.desktop_width,
                        est.desktop_height
                    );

                    let _ = event_emitter.emit_event(
                        "rdp://status",
                        serde_json::to_value(&RdpStatusEvent {
                            session_id: session_id.to_string(),
                            status: "connected".to_string(),
                            message: format!(
                                "Reconnected ({}x{})",
                                est.desktop_width, est.desktop_height
                            ),
                            desktop_width: Some(est.desktop_width),
                            desktop_height: Some(est.desktop_height),
                        }).unwrap_or_default(),
                    );

                    // Back to non-blocking for the poller.
                    set_nonblocking_on_framed(&est.tls_framed, true);
                }
                Err(e) => {
                    log::error!("RDP session {session_id}: reactivation failed: {e}");
                    return SessionLoopExit::NetworkError(format!("Reactivation failed: {e}"));
                }
            }
        }
    }
}

// ---- Layer 3: Persistent Session Wrapper with Reconnection ----

/// The main session function with automatic reconnection on network errors.
/// This function **never returns** on network errors — it loops indefinitely,
/// reconnecting with exponential backoff, until a `Shutdown` command arrives
/// or an unrecoverable protocol error occurs.
#[allow(clippy::too_many_arguments)]
fn run_rdp_session_inner(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    event_emitter: &DynEventEmitter,
    cmd_rx: &mut crate::rdp::wake_channel::WakeReceiver,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<RdpTlsConfig>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: &SharedFrameStoreState,
    frame_channel: &DynFrameChannel,
    log_sink: &LogSink,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut reconnect_count: u32 = 0;
    let reconnect_enabled = settings.reconnect_on_network_loss;

    'session: loop {
        // Check for shutdown before (re)connecting
        match cmd_rx.cmd_rx.try_recv() {
            Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
                return Err("session_shutdown: cancelled before connect".into());
            }
            _ => {}
        }

        // Establish connection (TCP + TLS + CredSSP + capability exchange)
        let mut established = match establish_rdp_connection(
            session_id,
            host,
            port,
            username,
            password,
            domain,
            settings,
            &event_emitter,
            cmd_rx,
            stats,
            cached_tls_connector.clone(),
            cached_http_client.clone(),
            frame_store,
            log_sink,
        ) {
            Ok(est) => {
                // Successful connect — reset reconnect counter
                if reconnect_count > 0 {
                    log::info!(
                        "RDP session {session_id}: reconnected successfully after {reconnect_count} attempts"
                    );
                }
                reconnect_count = 0;
                est
            }
            Err(e) => {
                let msg = format!("{e}");

                // Shutdown sentinel — always bail immediately
                if msg.contains("session_shutdown") {
                    return Err(e);
                }

                // If reconnection is disabled, fail immediately
                if !reconnect_enabled {
                    return Err(e);
                }

                // On first connect failure (not a reconnect), fail immediately
                // so the user sees the error (bad credentials, etc.)
                if reconnect_count == 0 {
                    return Err(e);
                }

                // Connection failed during reconnect — keep trying
                reconnect_count += 1;
                log::warn!(
                    "RDP session {session_id}: reconnect attempt {reconnect_count} failed: {msg}"
                );

                stats.set_phase("reconnecting");
                let _ = event_emitter.emit_event(
                    "rdp://status",
                    serde_json::to_value(&RdpStatusEvent {
                        session_id: session_id.to_string(),
                        status: "reconnecting".to_string(),
                        message: format!("Reconnecting ({reconnect_count})... {msg}"),
                        desktop_width: None,
                        desktop_height: None,
                    }).unwrap_or_default(),
                );

                sleep_with_shutdown_check(
                    cmd_rx,
                    compute_backoff_delay(
                        reconnect_count,
                        settings.reconnect_base_delay,
                        settings.reconnect_max_delay,
                    ),
                )?;
                continue 'session;
            }
        };

        // Reset frame counter so the first frame triggers a full-frame sync
        stats.frame_count.store(0, std::sync::atomic::Ordering::Relaxed);

        // Run the active session loop
        let exit = run_active_session_loop(
            session_id,
            &mut established,
            settings,
            &event_emitter,
            cmd_rx,
            stats,
            frame_store,
            frame_channel,
            log_sink,
        );

        // Drop compositor explicitly before potentially reconnecting
        if let Some(ref comp) = established.compositor {
            log::info!(
                "RDP session {session_id}: dropping compositor '{}'",
                comp.name()
            );
        }
        drop(established);

        match exit {
            SessionLoopExit::Shutdown => {
                emit_log(&event_emitter, log_sink, "info", "Session shut down".to_string(), session_id);
                return Ok(());
            }
            SessionLoopExit::ServerClosed => {
                emit_log(&event_emitter, log_sink, "info", "Server closed connection".to_string(), session_id);
                return Ok(());
            }
            SessionLoopExit::ProtocolError(msg) => {
                emit_log(&event_emitter, log_sink, "error", format!("Fatal protocol error: {msg}"), session_id);
                return Err(msg.into());
            }
            SessionLoopExit::NetworkError(msg) => {
                if !reconnect_enabled {
                    emit_log(&event_emitter, log_sink, "error", format!("Network error (reconnect disabled): {msg}"), session_id);
                    return Err(msg.into());
                }
                reconnect_count += 1;
                log::info!("RDP session {session_id}: will reconnect ({reconnect_count}): {msg}");
                emit_log(&event_emitter, log_sink, "warn", format!("Reconnecting ({reconnect_count}): {msg}"), session_id);
            }
            SessionLoopExit::ReconnectRequested => {
                reconnect_count += 1;
                log::info!(
                    "RDP session {session_id}: will reconnect ({reconnect_count}): manual reconnect"
                );
                emit_log(&event_emitter, log_sink, "info", format!("Manual reconnect ({reconnect_count})"), session_id);
            }
        }

        // Shared reconnection logic for NetworkError and ReconnectRequested
        stats.set_phase("reconnecting");
        let _ = event_emitter.emit_event(
            "rdp://status",
            serde_json::to_value(&RdpStatusEvent {
                session_id: session_id.to_string(),
                status: "reconnecting".to_string(),
                message: format!("Reconnecting ({reconnect_count})..."),
                desktop_width: None,
                desktop_height: None,
            }).unwrap_or_default(),
        );

        // Preserve the framebuffer shape but clear stale pixel data so
        // dirty-rect deltas from the new connection don't ghost over old content.
        frame_store.reinit(session_id, 0, 0);
        // Sleep with exponential backoff, checking for shutdown.
        sleep_with_shutdown_check(
            cmd_rx,
            compute_backoff_delay(
                reconnect_count,
                settings.reconnect_base_delay,
                settings.reconnect_max_delay,
            ),
        )?;
        continue 'session;
    }
}

// ---- Helper functions ----

/// Compute exponential backoff delay: base * 2^(attempt-1), capped at max.
fn compute_backoff_delay(attempt: u32, base: Duration, max: Duration) -> Duration {
    let factor = 2u64.pow((attempt - 1).min(10));
    let delay = base.saturating_mul(factor as u32);
    delay.min(max)
}

/// Sleep for the given duration, but check for shutdown commands periodically.
/// Returns Err if shutdown was requested during the sleep.
fn sleep_with_shutdown_check(
    cmd_rx: &mut crate::rdp::wake_channel::WakeReceiver,
    total: Duration,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let check_interval = Duration::from_millis(500);
    let start = Instant::now();

    while start.elapsed() < total {
        match cmd_rx.cmd_rx.try_recv() {
            Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
                return Err("session_shutdown: cancelled during reconnect wait".into());
            }
            _ => {}
        }
        let remaining = total.saturating_sub(start.elapsed());
        std::thread::sleep(remaining.min(check_interval));
    }
    Ok(())
}

/// Check if an io::Error represents a network-level failure (recoverable).
fn is_network_error(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::ConnectionReset
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::TimedOut
            | io::ErrorKind::ConnectionRefused
            | io::ErrorKind::NotConnected
    )
}

/// Check if an error message string indicates a network-level failure.
fn is_network_error_str(s: &str) -> bool {
    s.contains("10054")           // WSAECONNRESET (Windows)
        || s.contains("10053")    // WSAECONNABORTED (Windows)
        || s.contains("os error 997")  // ERROR_IO_PENDING — overlapped I/O on Windows
        || s.contains("Overlapped I/O")
        || s.contains("forcibly closed")
        || s.contains("connection reset")
        || s.contains("broken pipe")
        || s.contains("Connection reset")
        || s.contains("Write failed")
        || s.contains("Failed to send response frame")
        || s.contains("InternalError")   // TLS fatal alert (transient)
        || s.contains("received fatal alert")
}
