use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::{self, ClientConnector, ConnectionResult, Sequence, State as _};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::core::WriteBuf;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp_blocking::Framed;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::frame_delivery::*;
use super::frame_store::SharedFrameStoreState;
use super::network::{BlockingNetworkClient, extract_cert_fingerprint, tls_upgrade};
use super::settings::{build_bitmap_codecs, ResolvedSettings};
use super::stats::RdpSessionStats;
use super::types::{RdpCommand, RdpPointerEvent, RdpStatusEvent};
use crate::native_renderer::{self, FrameCompositor, RenderBackend};

// ---- Deactivation-Reactivation Sequence handler ----

/// Drives a ConnectionActivationSequence to completion after receiving
/// DeactivateAll.  This re-runs the Capability Exchange and Connection
/// Finalization phases so the server can transition from the login screen
/// to the user desktop (MS-RDPBCGR section 1.3.1.3).
pub(crate) fn handle_reactivation<S: std::io::Read + std::io::Write>(
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
struct EstablishedSession {
    tls_framed: Framed<native_tls::TlsStream<TcpStream>>,
    active_stage: ActiveStage,
    image: DecodedImage,
    desktop_width: u16,
    desktop_height: u16,
    compositor: Option<Box<dyn FrameCompositor>>,
    active_render_backend: String,
    gfx_frame_rx: Option<std::sync::mpsc::Receiver<crate::gfx::processor::GfxFrame>>,
}

// ---- Blocking RDP session runner ----

pub(crate) fn run_rdp_session(
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
        // -- Auto-detect negotiation: try different protocol combos --
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
            // Only emit disconnected for clean exits -- errors already emitted their own status.
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
pub(crate) fn build_negotiation_combos(strategy: &str, base: &ResolvedSettings) -> Vec<(bool, bool, bool)> {
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
        // "auto" -- try everything
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

    // -- Phase 1: vary protocol flags with user Config --

    for (i, (tls, credssp, hybrid_ex)) in combos.iter().take(max_attempts).enumerate() {
        log::info!(
            "RDP session {session_id}: auto-detect attempt {}/{} -> tls={} credssp={} hybrid_ex={}",
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

        for (_i, (tls, credssp, hybrid_ex)) in fallback_combos.iter().take(fallback_max).enumerate() {
            for &depth in color_depths {
                attempt_num += 1;
                log::info!(
                    "RDP session {session_id}: auto-detect fallback {}/{} -> tls={} credssp={} hybrid_ex={} color={}bpp (minimal config)",
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
    app_handle: &AppHandle,
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: &SharedFrameStoreState,
) -> Result<EstablishedSession, Box<dyn std::error::Error + Send + Sync>> {
    let conn_start = Instant::now();

    // -- 0. Pre-flight shutdown check --
    match cmd_rx.try_recv() {
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
        std::mem::forget(sock);
    }
    let tcp_ms = t_tcp.elapsed().as_millis();
    log::info!("RDP session {session_id}: TCP connected in {tcp_ms}ms");

    // -- Shutdown check after TCP connect --
    match cmd_rx.try_recv() {
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
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: {
            let lb = &settings.load_balancing_info;
            if !lb.is_empty() {
                if settings.use_routing_token {
                    Some(ironrdp::pdu::nego::NegoRequestData::routing_token(lb.clone()))
                } else {
                    Some(ironrdp::pdu::nego::NegoRequestData::cookie(lb.clone()))
                }
            } else if settings.use_vm_id && !settings.vm_id.is_empty() {
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

    // -- Register RDPGFX Dynamic Virtual Channel (H.264 hardware decode) --
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
            "RDP session {session_id}: gateway enabled -> {}:{}",
            settings.gateway_hostname, settings.gateway_port
        );
    }
    if settings.use_vm_id {
        log::info!(
            "RDP session {session_id}: Hyper-V VM ID mode -> vm_id={:?} enhanced={}",
            settings.vm_id, settings.enhanced_session_mode
        );
    }
    if settings.auto_detect {
        log::info!(
            "RDP session {session_id}: auto-detect negotiation -> strategy={} maxRetries={}",
            settings.negotiation_strategy, settings.max_retries
        );
    }
    if !settings.load_balancing_info.is_empty() {
        log::info!(
            "RDP session {session_id}: load balancing info -> {:?} (routing_token={})",
            settings.load_balancing_info, settings.use_routing_token
        );
    }
    if !settings.use_credssp {
        log::info!("RDP session {session_id}: CredSSP globally DISABLED by user");
    }

    // -- 3. Connection begin (pre-TLS phase) --

    stats.set_phase("negotiating");
    log::info!("RDP session {session_id}: starting connection sequence");
    let t_negotiate = Instant::now();
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .map_err(|e| format!("connect_begin failed: {e}"))?;
    let negotiate_ms = t_negotiate.elapsed().as_millis();
    log::info!("RDP session {session_id}: X.224/MCS negotiation took {negotiate_ms}ms");

    // -- 4. TLS upgrade --

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

    // -- Shutdown check before CredSSP/NLA --
    match cmd_rx.try_recv() {
        Ok(RdpCommand::Shutdown) | Err(mpsc::error::TryRecvError::Disconnected) => {
            log::info!("RDP session {session_id}: shutdown before CredSSP");
            return Err("session_shutdown: cancelled before CredSSP".into());
        }
        _ => {}
    }

    // -- 5. Finalize connection (CredSSP / NLA + remaining handshake) --

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

    // -- 6. Enter active session --

    let desktop_width = connection_result.desktop_size.width;
    let desktop_height = connection_result.desktop_size.height;

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

    let image = DecodedImage::new(PixelFormat::RgbA32, desktop_width, desktop_height);
    let _active_stage = ActiveStage::new(connection_result);

    // Initialize the shared framebuffer slot for this session
    frame_store.init(session_id, desktop_width, desktop_height);

    // -- 6b. Create frame compositor (if requested) --
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
    let _ = app_handle.emit(
        "rdp://render-backend",
        serde_json::json!({
            "session_id": session_id,
            "backend": active_render_backend,
        }),
    );

    Ok(EstablishedSession {
        tls_framed,
        active_stage: _active_stage,
        image,
        desktop_width,
        desktop_height,
        compositor,
        active_render_backend,
        gfx_frame_rx,
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
    app_handle: &AppHandle,
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
    stats: &Arc<RdpSessionStats>,
    frame_store: &SharedFrameStoreState,
    frame_channel: &Channel<InvokeResponseBody>,
) -> SessionLoopExit {
    // Viewer channel management for session persistence.
    let mut viewer_detached = false;
    let mut attached_channel: Option<Channel<InvokeResponseBody>> = None;

    // Set a short read timeout so we can interleave input handling
    set_read_timeout_on_framed(&est.tls_framed, Some(settings.read_timeout));

    let mut last_stats_emit = Instant::now();
    let stats_interval = settings.stats_interval;
    #[allow(unused_assignments)]
    let mut consecutive_errors: u32 = 0;
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
    let mut gfx_frames: Vec<crate::gfx::processor::GfxFrame> = Vec::new();

    // Adaptive read timeout
    let timeout_active = Duration::from_millis(4);
    let timeout_idle = Duration::from_millis(50);
    let idle_threshold = Duration::from_millis(500);
    let mut last_data_received = Instant::now();
    let mut current_timeout = timeout_active;

    loop {
        // - Drain ALL pending commands (input coalescing) -
        merged_inputs.clear();
        let mut should_break = false;
        let mut should_reconnect = false;
        loop {
            match cmd_rx.try_recv() {
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
                    merged_inputs.extend(events);
                }
                Ok(RdpCommand::AttachViewer(new_channel)) => {
                    log::info!(
                        "RDP session {session_id}: viewer attached (new frame channel)"
                    );
                    // Send the full current framebuffer so the reattached viewer
                    // immediately sees the screen
                    {
                        let slots = frame_store.slots.read().unwrap();
                        if let Some(slot) = slots.get(session_id) {
                            let w = slot.width;
                            let h = slot.height;
                            let total = 8 + slot.data.len();
                            let mut payload = Vec::with_capacity(total);
                            payload.extend_from_slice(&0u16.to_le_bytes());
                            payload.extend_from_slice(&0u16.to_le_bytes());
                            payload.extend_from_slice(&w.to_le_bytes());
                            payload.extend_from_slice(&h.to_le_bytes());
                            payload.extend_from_slice(&slot.data);
                            let _ = new_channel.send(InvokeResponseBody::Raw(payload));
                        }
                    }
                    attached_channel = Some(new_channel);
                    viewer_detached = false;
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
                    use ironrdp::pdu::input::fast_path::KeyboardFlags;
                    let win_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::EXTENDED, 0x5B);
                    let r_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x13);
                    let r_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x13);
                    let win_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED, 0x5B);
                    merged_inputs.extend([win_press, r_press, r_release, win_release]);
                    for ch in "logoff".encode_utf16() {
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::empty(), ch));
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::RELEASE, ch));
                    }
                    let enter_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1C);
                    let enter_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x1C);
                    merged_inputs.extend([enter_press, enter_release]);
                }
                Ok(RdpCommand::ForceReboot) => {
                    log::info!("RDP session {session_id}: force reboot requested");
                    use ironrdp::pdu::input::fast_path::KeyboardFlags;
                    let win_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::EXTENDED, 0x5B);
                    let r_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x13);
                    let r_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x13);
                    let win_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED, 0x5B);
                    merged_inputs.extend([win_press, r_press, r_release, win_release]);
                    for ch in "shutdown /r /t 0 /f".encode_utf16() {
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::empty(), ch));
                        merged_inputs.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::RELEASE, ch));
                    }
                    let enter_press = FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1C);
                    let enter_release = FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, 0x1C);
                    merged_inputs.extend([enter_press, enter_release]);
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
            match est.active_stage.process_fastpath_input(&mut est.image, &merged_inputs) {
                Ok(outputs) => {
                    if !viewer_detached {
                        if let Err(e) = process_outputs(
                            session_id,
                            &outputs,
                            &mut est.tls_framed,
                            &est.image,
                            est.desktop_width,
                            est.desktop_height,
                            app_handle,
                            stats,
                            full_frame_sync_interval,
                            frame_store,
                            active_ch,
                        ) {
                            let err_str = format!("{e}");
                            if is_network_error_str(&err_str) {
                                return SessionLoopExit::NetworkError(err_str);
                            }
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
                                    return SessionLoopExit::NetworkError(format!("Write failed: {e}"));
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

        // - Emit periodic stats -
        if last_stats_emit.elapsed() >= stats_interval {
            let _ = app_handle.emit("rdp://stats", stats.to_event(session_id));
            last_stats_emit = Instant::now();
        }

        // - Flush batched frame updates -
        if frame_batching && !dirty_regions.is_empty() && last_frame_emit.elapsed() >= batch_interval {
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
                        est.image.data(), est.desktop_width, &dirty_regions, active_ch,
                    );
                }
            }
            dirty_regions.clear();
            last_frame_emit = Instant::now();
        }

        // - Drain GFX decoded frames (H.264 via RDPGFX DVC) -
        if let Some(ref gfx_rx) = est.gfx_frame_rx {
            gfx_frames.clear();
            while let Ok(gfx_frame) = gfx_rx.try_recv() {
                gfx_frames.push(gfx_frame);
            }
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
                let mut payload = gfx_frame.rgba;
                payload.reserve(8);
                let len = payload.len();
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

        // - Read and process PDUs -
        batch_dirty_rects.clear();
        let mut batch_had_graphics = false;
        let mut batch_should_reactivate: Option<Box<ironrdp::connector::connection_activation::ConnectionActivationSequence>> = None;
        let mut batch_should_terminate = false;
        let mut pdus_this_batch: u32 = 0;

        loop {
            if pdus_this_batch > 0 && est.tls_framed.peek().is_empty() {
                break;
            }

            match est.tls_framed.read_pdu() {
                Ok((action, payload)) => {
                    consecutive_errors = 0;
                    last_data_received = Instant::now();
                    if current_timeout != timeout_active {
                        current_timeout = timeout_active;
                        set_read_timeout_on_framed(&est.tls_framed, Some(current_timeout));
                    }
                    let payload_len = payload.len() as u64;
                    stats
                        .bytes_received
                        .fetch_add(payload_len, Ordering::Relaxed);
                    stats.pdus_received.fetch_add(1, Ordering::Relaxed);

                    match est.active_stage.process(&mut est.image, action, payload.as_ref()) {
                        Ok(outputs) => {
                            for output in outputs {
                                match output {
                                    ActiveStageOutput::ResponseFrame(data) => {
                                        stats
                                            .bytes_sent
                                            .fetch_add(data.len() as u64, Ordering::Relaxed);
                                        stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                                        if let Err(e) = est.tls_framed.write_all(&data) {
                                            return SessionLoopExit::NetworkError(
                                                format!("Failed to send response frame: {e}"),
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
                                        } else if let Some(ref mut comp) = est.compositor {
                                            comp.update_region(
                                                est.image.data(), est.desktop_width,
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
                                return SessionLoopExit::ProtocolError(format!(
                                    "Too many consecutive errors ({consecutive_errors}), last: {err_str}"
                                ));
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
                            set_read_timeout_on_framed(&est.tls_framed, Some(current_timeout));
                        }
                    }
                    break;
                }
                Err(e) => {
                    if e.kind() == io::ErrorKind::UnexpectedEof {
                        log::info!("RDP session {session_id}: server closed connection (EOF)");
                        // If viewer is detached, this is a network-level issue
                        // (the server timed out the idle session).  Try to reconnect.
                        if viewer_detached {
                            return SessionLoopExit::NetworkError(
                                "Server closed connection (EOF) while detached".to_string()
                            );
                        }
                        return SessionLoopExit::ServerClosed;
                    }
                    let err_str = format!("{e}");
                    log::error!("RDP session {session_id}: read error: {err_str}");
                    // Classify: network errors are recoverable
                    if is_network_error(&e) || is_network_error_str(&err_str) {
                        return SessionLoopExit::NetworkError(err_str);
                    }
                    return SessionLoopExit::ProtocolError(err_str);
                }
            }
        } // end inner PDU drain loop

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
                    est.image.data(), est.desktop_width, &batch_dirty_rects, active_ch,
                );
            }

            let fc = stats.frame_count.load(Ordering::Relaxed);
            if fc > 0 && fc % full_frame_sync_interval == 0 {
                frame_store.update_region(
                    session_id, est.image.data(), est.desktop_width,
                    &ironrdp::pdu::geometry::InclusiveRectangle {
                        left: 0, top: 0,
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
            set_read_timeout_on_framed(&est.tls_framed, None);

            match handle_reactivation(cas, &mut est.tls_framed, stats) {
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
                    stats.set_phase("active");

                    log::info!(
                        "RDP session {session_id}: reactivated at {}x{}",
                        est.desktop_width, est.desktop_height
                    );

                    let _ = app_handle.emit(
                        "rdp://status",
                        RdpStatusEvent {
                            session_id: session_id.to_string(),
                            status: "connected".to_string(),
                            message: format!(
                                "Reconnected ({}x{})",
                                est.desktop_width, est.desktop_height
                            ),
                            desktop_width: Some(est.desktop_width),
                            desktop_height: Some(est.desktop_height),
                        },
                    );

                    set_read_timeout_on_framed(
                        &est.tls_framed,
                        Some(settings.read_timeout),
                    );
                }
                Err(e) => {
                    log::error!(
                        "RDP session {session_id}: reactivation failed: {e}"
                    );
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
    app_handle: &AppHandle,
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
    stats: &Arc<RdpSessionStats>,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    frame_store: &SharedFrameStoreState,
    frame_channel: &Channel<InvokeResponseBody>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut reconnect_count: u32 = 0;
    let reconnect_enabled = settings.reconnect_on_network_loss;

    'session: loop {
        // Check for shutdown before (re)connecting
        match cmd_rx.try_recv() {
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
            app_handle,
            cmd_rx,
            stats,
            cached_tls_connector.clone(),
            cached_http_client.clone(),
            frame_store,
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
                let _ = app_handle.emit(
                    "rdp://status",
                    RdpStatusEvent {
                        session_id: session_id.to_string(),
                        status: "reconnecting".to_string(),
                        message: format!("Reconnecting ({reconnect_count})... {msg}"),
                        desktop_width: None,
                        desktop_height: None,
                    },
                );

                sleep_with_shutdown_check(
                    cmd_rx,
                    compute_backoff_delay(reconnect_count, settings.reconnect_base_delay, settings.reconnect_max_delay),
                )?;
                continue 'session;
            }
        };

        // Run the active session loop
        let exit = run_active_session_loop(
            session_id,
            &mut established,
            settings,
            app_handle,
            cmd_rx,
            stats,
            frame_store,
            frame_channel,
        );

        // Drop compositor explicitly before potentially reconnecting
        if let Some(ref comp) = established.compositor {
            log::info!("RDP session {session_id}: dropping compositor '{}'", comp.name());
        }
        drop(established);

        match exit {
            SessionLoopExit::Shutdown => {
                return Ok(());
            }
            SessionLoopExit::ServerClosed => {
                return Ok(());
            }
            SessionLoopExit::ProtocolError(msg) => {
                return Err(msg.into());
            }
            SessionLoopExit::NetworkError(msg) | SessionLoopExit::ReconnectRequested => {
                if !reconnect_enabled && !matches!(exit, SessionLoopExit::ReconnectRequested) {
                    return Err(msg.into());
                }

                reconnect_count += 1;
                log::info!(
                    "RDP session {session_id}: will reconnect ({reconnect_count}): {msg}"
                );

                stats.set_phase("reconnecting");
                let _ = app_handle.emit(
                    "rdp://status",
                    RdpStatusEvent {
                        session_id: session_id.to_string(),
                        status: "reconnecting".to_string(),
                        message: format!("Reconnecting ({reconnect_count})..."),
                        desktop_width: None,
                        desktop_height: None,
                    },
                );

                // Preserve the framebuffer — don't remove it during reconnect.
                // Sleep with exponential backoff, checking for shutdown.
                sleep_with_shutdown_check(
                    cmd_rx,
                    compute_backoff_delay(reconnect_count, settings.reconnect_base_delay, settings.reconnect_max_delay),
                )?;
                continue 'session;
            }
        }
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
    cmd_rx: &mut mpsc::UnboundedReceiver<RdpCommand>,
    total: Duration,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let check_interval = Duration::from_millis(500);
    let start = Instant::now();

    while start.elapsed() < total {
        match cmd_rx.try_recv() {
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
    )
}

/// Check if an error message string indicates a network-level failure.
fn is_network_error_str(s: &str) -> bool {
    s.contains("10054")           // WSAECONNRESET (Windows)
        || s.contains("10053")    // WSAECONNABORTED (Windows)
        || s.contains("forcibly closed")
        || s.contains("connection reset")
        || s.contains("broken pipe")
        || s.contains("Connection reset")
        || s.contains("Write failed")
        || s.contains("Failed to send response frame")
}
