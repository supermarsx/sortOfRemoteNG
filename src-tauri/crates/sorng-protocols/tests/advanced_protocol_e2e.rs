use sorng_protocols::raw_socket::{
    RawSocketConnectOptions, RawSocketDirection, RawSocketError, RawSocketEvent, RawSocketFrame,
    RawSocketLimits, RawSocketService, RawSocketSink, RawSocketSinkError, RawSocketStatus,
    RawSocketTerminalReason, RawSocketTransport,
};
use sorng_protocols::rlogin::{
    encode_handshake, encode_window_update, OutputFrame, ResizeOutcome, RloginConfig,
    RloginConnectOptions, RloginEngine, RloginError, RloginEvent, RloginService, RloginSink,
    RloginSinkError, RloginSourcePortMode, WindowSize, URGENT_WINDOW_UPDATE,
};
use sorng_socket_transport::{AddressFamily, Route, RouteKind, TransportError};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::oneshot;
use tokio::time::timeout;

const FIXTURE_TIMEOUT: Duration = Duration::from_secs(3);

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn wait_for(description: &str, predicate: impl Fn() -> bool) {
    timeout(FIXTURE_TIMEOUT, async {
        while !predicate() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {description}"));
}

#[derive(Default)]
struct RecordingRawSink {
    frames: Mutex<Vec<(RawSocketFrame, bool)>>,
    events: Mutex<Vec<RawSocketEvent>>,
}

impl RawSocketSink for RecordingRawSink {
    fn send_frame(
        &self,
        _session_id: &str,
        frame: &RawSocketFrame,
        replayed: bool,
    ) -> Result<(), RawSocketSinkError> {
        lock(&self.frames).push((frame.clone(), replayed));
        Ok(())
    }

    fn send_event(&self, event: &RawSocketEvent) -> Result<(), RawSocketSinkError> {
        lock(&self.events).push(event.clone());
        Ok(())
    }
}

#[derive(Default)]
struct RecordingRloginSink {
    frames: Mutex<Vec<(OutputFrame, bool)>>,
    events: Mutex<Vec<RloginEvent>>,
}

impl RloginSink for RecordingRloginSink {
    fn send_frame(
        &self,
        _session_id: &str,
        frame: &OutputFrame,
        replayed: bool,
    ) -> Result<(), RloginSinkError> {
        lock(&self.frames).push((frame.clone(), replayed));
        Ok(())
    }

    fn send_event(&self, event: &RloginEvent) -> Result<(), RloginSinkError> {
        lock(&self.events).push(event.clone());
        Ok(())
    }
}

fn raw_options(port: u16, transport: RawSocketTransport) -> RawSocketConnectOptions {
    RawSocketConnectOptions {
        host: Ipv4Addr::LOCALHOST.to_string(),
        port,
        transport,
        connection_id: Some("advanced-e2e-raw".to_owned()),
        route: Route::Direct,
        address_family: AddressFamily::Ipv4Only,
        local_bind_address: Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        local_bind_port: 0,
        connect_timeout_ms: 2_000,
        write_timeout_ms: 2_000,
        idle_timeout_ms: 2_000,
        tcp_no_delay: true,
        tcp_keepalive_ms: None,
        limits: RawSocketLimits {
            replay_frames: 16,
            replay_bytes: 4_096,
            read_chunk_bytes: 1_024,
            max_send_bytes: 1_024,
            ..RawSocketLimits::default()
        },
    }
}

fn rlogin_config(port: u16) -> RloginConfig {
    RloginConfig {
        host: Ipv4Addr::LOCALHOST.to_string(),
        port,
        local_username: "alice".to_owned(),
        remote_username: "root".to_owned(),
        terminal_type: "xterm".to_owned(),
        terminal_speed: 38_400,
        handshake_timeout_ms: 2_000,
        write_timeout_ms: 2_000,
        idle_timeout_ms: 2_000,
        replay_capacity_bytes: 4_096,
        escape_enabled: false,
        ..RloginConfig::default()
    }
}

fn rlogin_options(port: u16) -> RloginConnectOptions {
    RloginConnectOptions {
        config: rlogin_config(port),
        connection_id: Some("advanced-e2e-rlogin".to_owned()),
        route: Route::Direct,
        address_family: AddressFamily::Ipv4Only,
        local_bind_address: Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        source_port_mode: RloginSourcePortMode::Ephemeral,
        connect_timeout_ms: 2_000,
        tcp_keepalive_seconds: None,
        plaintext_acknowledged: true,
        ..RloginConnectOptions::default()
    }
}

#[tokio::test]
async fn raw_tcp_echo_detach_attach_replay_half_close_and_cleanup() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    assert_eq!(address.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    let server = tokio::spawn(async move {
        let (mut socket, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut text = [0_u8; 4];
        socket.read_exact(&mut text).await.unwrap();
        assert_eq!(&text, b"text");
        socket.write_all(&text).await.unwrap();
        let mut binary = [0_u8; 2];
        socket.read_exact(&mut binary).await.unwrap();
        assert_eq!(binary, [0x00, 0xff]);
        socket.write_all(&binary).await.unwrap();
        let mut eof = [0_u8; 1];
        assert_eq!(socket.read(&mut eof).await.unwrap(), 0);
    });

    let service = RawSocketService::new();
    let main_sink = Arc::new(RecordingRawSink::default());
    let session_id = service
        .connect_raw_socket(
            raw_options(address.port(), RawSocketTransport::Tcp),
            main_sink.clone(),
        )
        .await
        .unwrap();

    service
        .send_raw_socket_data(&session_id, b"text".to_vec())
        .await
        .unwrap();
    wait_for("first TCP echo", || {
        lock(&main_sink.frames).iter().any(|(frame, _)| {
            frame.direction == RawSocketDirection::Inbound && frame.data == b"text"
        })
    })
    .await;

    service.detach_raw_socket(&session_id).await.unwrap();
    service
        .send_raw_socket_data(&session_id, vec![0x00, 0xff])
        .await
        .unwrap();
    timeout(FIXTURE_TIMEOUT, async {
        loop {
            let replay = service.get_raw_socket_replay(&session_id).await.unwrap();
            if replay.frames.iter().any(|frame| {
                frame.direction == RawSocketDirection::Inbound && frame.data == [0x00, 0xff]
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("timed out waiting for detached binary replay");

    let detached_sink = Arc::new(RecordingRawSink::default());
    let replay = service
        .attach_raw_socket(&session_id, detached_sink.clone())
        .await
        .unwrap();
    assert!(replay
        .frames
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
    assert!(replay.frames.iter().any(|frame| {
        frame.direction == RawSocketDirection::Inbound && frame.data == [0x00, 0xff]
    }));
    assert_eq!(lock(&detached_sink.frames).len(), replay.frames.len());
    assert!(lock(&detached_sink.frames)
        .iter()
        .all(|(_, replayed)| *replayed));

    service
        .shutdown_raw_socket_write(&session_id)
        .await
        .unwrap();
    timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
    wait_for("raw TCP cleanup", || {
        lock(&detached_sink.events).iter().any(|event| {
            matches!(
                event,
                RawSocketEvent::Disconnected {
                    reason: RawSocketTerminalReason::PeerEof,
                    ..
                }
            )
        })
    })
    .await;
    let info = service
        .get_raw_socket_session_info(&session_id)
        .await
        .unwrap();
    assert_eq!(info.status, RawSocketStatus::Disconnected);
    assert_eq!(info.stats.bytes_sent, 6);
    assert_eq!(info.stats.bytes_received, 6);
    service.disconnect_raw_socket(&session_id).await.unwrap();
    service.disconnect_raw_socket(&session_id).await.unwrap();
    assert_eq!(service.active_session_count().await, 0);
}

#[tokio::test]
async fn raw_udp_preserves_empty_and_binary_datagram_boundaries() {
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = socket.local_addr().unwrap();
    assert_eq!(address.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    let server = tokio::spawn(async move {
        let mut bytes = [0_u8; 32];
        let mut received = Vec::new();
        for _ in 0..2 {
            let (count, peer) = socket.recv_from(&mut bytes).await.unwrap();
            received.push(bytes[..count].to_vec());
            socket.send_to(&bytes[..count], peer).await.unwrap();
        }
        received
    });

    let service = RawSocketService::new();
    let sink = Arc::new(RecordingRawSink::default());
    let session_id = service
        .connect_raw_socket(
            raw_options(address.port(), RawSocketTransport::Udp),
            sink.clone(),
        )
        .await
        .unwrap();
    service
        .send_raw_socket_data(&session_id, vec![0x00, 0xff, 0x41])
        .await
        .unwrap();
    service
        .send_raw_socket_data(&session_id, Vec::new())
        .await
        .unwrap();
    wait_for("two UDP echoes", || {
        lock(&sink.frames)
            .iter()
            .filter(|(frame, _)| frame.direction == RawSocketDirection::Inbound)
            .count()
            >= 2
    })
    .await;

    let received = timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
    assert_eq!(received, vec![vec![0x00, 0xff, 0x41], Vec::new()]);
    let inbound: Vec<_> = lock(&sink.frames)
        .iter()
        .filter(|(frame, _)| frame.direction == RawSocketDirection::Inbound)
        .map(|(frame, _)| (frame.data.clone(), frame.datagram))
        .collect();
    assert_eq!(
        inbound,
        vec![(vec![0x00, 0xff, 0x41], true), (Vec::new(), true)]
    );
    assert_eq!(
        service.shutdown_raw_socket_write(&session_id).await,
        Err(RawSocketError::HalfCloseUnsupported)
    );
    service.disconnect_raw_socket(&session_id).await.unwrap();
    assert_eq!(service.active_session_count().await, 0);
}

#[tokio::test]
async fn rlogin_exact_handshake_remote_echo_replay_and_no_local_echo() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let expected_handshake = encode_handshake(&rlogin_config(address.port())).unwrap();
    let (input_tx, input_rx) = oneshot::channel();
    let (echo_tx, echo_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut handshake = vec![0_u8; expected_handshake.len()];
        socket.read_exact(&mut handshake).await.unwrap();
        assert_eq!(handshake, expected_handshake);
        socket.write_all(&[0]).await.unwrap();
        let mut input = [0_u8; 6];
        socket.read_exact(&mut input).await.unwrap();
        input_tx.send(input).unwrap();
        echo_rx.await.unwrap();
        socket.write_all(&input).await.unwrap();
        let mut eof = [0_u8; 1];
        assert_eq!(socket.read(&mut eof).await.unwrap(), 0);
    });

    let service = RloginService::new();
    let sink = Arc::new(RecordingRloginSink::default());
    let session_id = service
        .connect_rlogin(rlogin_options(address.port()), sink.clone())
        .await
        .unwrap();
    assert!(lock(&sink.frames).is_empty());
    service
        .send_rlogin_input(&session_id, b"whoami".to_vec())
        .await
        .unwrap();
    assert_eq!(input_rx.await.unwrap(), *b"whoami");
    assert!(
        lock(&sink.frames).is_empty(),
        "client must not fake local echo"
    );
    echo_tx.send(()).unwrap();
    wait_for("remote RLogin echo", || !lock(&sink.frames).is_empty()).await;
    assert_eq!(lock(&sink.frames)[0].0.data, b"whoami");
    assert!(!lock(&sink.frames)[0].1);

    let snapshot = service
        .get_rlogin_output_snapshot(&session_id, 0)
        .await
        .unwrap();
    assert_eq!(snapshot.frames.len(), 1);
    assert_eq!(snapshot.frames[0].sequence, 1);
    assert_eq!(snapshot.frames[0].data, b"whoami");
    assert_eq!(
        service
            .resize_rlogin(
                &session_id,
                WindowSize {
                    rows: 40,
                    columns: 120,
                    width_pixels: 800,
                    height_pixels: 600,
                }
            )
            .await
            .unwrap(),
        ResizeOutcome::Deferred
    );
    let info = service.get_rlogin_session_info(&session_id).await.unwrap();
    assert!(!info.window_updates_enabled);
    assert_eq!(info.stats.resize_frames_sent, 0);
    service.disconnect_rlogin(&session_id).await.unwrap();
    timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
    service.disconnect_rlogin(&session_id).await.unwrap();
    assert_eq!(service.active_session_count().await, 0);
}

#[tokio::test]
async fn rlogin_engine_oob_seam_emits_exact_resize_frames() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let config = rlogin_config(address.port());
    let expected_handshake = encode_handshake(&config).unwrap();
    let expected_initial = encode_window_update(config.initial_window);
    let resized = WindowSize {
        rows: 40,
        columns: 120,
        width_pixels: 800,
        height_pixels: 600,
    };
    let expected_resized = encode_window_update(resized);
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut handshake = vec![0_u8; expected_handshake.len()];
        socket.read_exact(&mut handshake).await.unwrap();
        assert_eq!(handshake, expected_handshake);
        socket.write_all(&[0]).await.unwrap();
        let mut frames = [0_u8; 24];
        socket.read_exact(&mut frames).await.unwrap();
        assert_eq!(&frames[..12], &expected_initial);
        assert_eq!(&frames[12..], &expected_resized);
    });

    let stream = TcpStream::connect(address).await.unwrap();
    let mut engine = RloginEngine::establish(stream, config).await.unwrap();
    let urgent = engine
        .handle_urgent_control(URGENT_WINDOW_UPDATE)
        .await
        .unwrap();
    assert_eq!(urgent.resize, Some(ResizeOutcome::Sent));
    assert_eq!(engine.resize(resized).await.unwrap(), ResizeOutcome::Sent);
    assert_eq!(engine.stats().resize_frames_sent, 2);
    timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
    engine.close().await.unwrap();
}

#[tokio::test]
async fn rlogin_surfaces_server_diagnostic_and_reconnects_by_connection_id() {
    let diagnostic_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let diagnostic_address = diagnostic_listener.local_addr().unwrap();
    let diagnostic_handshake = encode_handshake(&rlogin_config(diagnostic_address.port())).unwrap();
    let diagnostic_server = tokio::spawn(async move {
        let (mut socket, _) = diagnostic_listener.accept().await.unwrap();
        let mut handshake = vec![0_u8; diagnostic_handshake.len()];
        socket.read_exact(&mut handshake).await.unwrap();
        assert_eq!(handshake, diagnostic_handshake);
        socket
            .write_all(b"\x01policy rejected this fixture account\r\n")
            .await
            .unwrap();
    });
    let service = RloginService::new();
    assert_eq!(
        service
            .connect_rlogin(
                rlogin_options(diagnostic_address.port()),
                Arc::new(RecordingRloginSink::default())
            )
            .await,
        Err(RloginError::ServerDiagnostic(
            "policy rejected this fixture account".to_owned()
        ))
    );
    timeout(FIXTURE_TIMEOUT, diagnostic_server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(service.active_session_count().await, 0);

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let expected_handshake = encode_handshake(&rlogin_config(address.port())).unwrap();
    let server = tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut handshake = vec![0_u8; expected_handshake.len()];
            socket.read_exact(&mut handshake).await.unwrap();
            assert_eq!(handshake, expected_handshake);
            socket.write_all(&[0]).await.unwrap();
            let mut eof = [0_u8; 1];
            assert_eq!(socket.read(&mut eof).await.unwrap(), 0);
        }
    });
    let first = service
        .connect_rlogin(
            rlogin_options(address.port()),
            Arc::new(RecordingRloginSink::default()),
        )
        .await
        .unwrap();
    let second = service
        .connect_rlogin(
            rlogin_options(address.port()),
            Arc::new(RecordingRloginSink::default()),
        )
        .await
        .unwrap();
    assert_ne!(first, second);
    assert!(
        !service
            .get_rlogin_session_info(&first)
            .await
            .unwrap()
            .connected
    );
    assert!(
        service
            .get_rlogin_session_info(&second)
            .await
            .unwrap()
            .connected
    );
    service.disconnect_rlogin(&second).await.unwrap();
    timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
    assert_eq!(service.active_session_count().await, 0);
}

#[tokio::test]
async fn unsupported_routes_fail_closed_before_touching_loopback_fixture() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();

    let raw_service = RawSocketService::new();
    let mut raw = raw_options(address.port(), RawSocketTransport::Tcp);
    raw.route = Route::Socks5;
    assert!(matches!(
        raw_service
            .connect_raw_socket(raw, Arc::new(RecordingRawSink::default()))
            .await,
        Err(RawSocketError::Transport(
            TransportError::UnsupportedRoute {
                route: RouteKind::Socks5,
                ..
            }
        ))
    ));

    let rlogin_service = RloginService::new();
    let mut rlogin = rlogin_options(address.port());
    rlogin.route = Route::Socks5;
    let diagnosis = rlogin_service.diagnose_rlogin(&rlogin);
    assert!(!diagnosis.compatible);
    assert!(diagnosis
        .blockers
        .iter()
        .any(|blocker| blocker.contains("not implemented")));
    assert_eq!(
        rlogin_service
            .connect_rlogin(rlogin, Arc::new(RecordingRloginSink::default()))
            .await,
        Err(RloginError::UnsupportedRoute(RouteKind::Socks5))
    );

    assert!(timeout(Duration::from_millis(150), listener.accept())
        .await
        .is_err());
    assert_eq!(raw_service.active_session_count().await, 0);
    assert_eq!(rlogin_service.active_session_count().await, 0);
}

#[tokio::test]
async fn raw_tcp_accepts_the_exact_frontend_command_payload_shape() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut eof = [0_u8; 1];
        assert_eq!(socket.read(&mut eof).await.unwrap(), 0);
    });
    let options: RawSocketConnectOptions = serde_json::from_value(serde_json::json!({
        "host": "127.0.0.1",
        "port": address.port(),
        "transport": "tcp",
        "connectionId": "frontend-command-contract",
        "route": { "kind": "direct" },
        "addressFamily": "any",
        "localBindAddress": null,
        "localBindPort": 0,
        "connectTimeoutMs": 10_000,
        "writeTimeoutMs": 10_000,
        "idleTimeoutMs": 300_000,
        "tcpNoDelay": true,
        "tcpKeepaliveMs": 60_000,
        "limits": {
            "commandQueueCapacity": 64,
            "queueWaitTimeoutMs": 2_000,
            "replayFrames": 512,
            "replayBytes": 2_097_152,
            "readChunkBytes": 16_384,
            "maxSendBytes": 65_507
        }
    }))
    .unwrap();

    let service = RawSocketService::new();
    let session_id = service
        .connect_raw_socket(options, Arc::new(RecordingRawSink::default()))
        .await
        .unwrap();
    service.disconnect_raw_socket(&session_id).await.unwrap();
    timeout(FIXTURE_TIMEOUT, server).await.unwrap().unwrap();
}
