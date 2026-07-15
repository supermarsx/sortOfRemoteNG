use super::*;
use sorng_socket_transport::Route;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{duplex, AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::task::JoinHandle;
use tokio::time::timeout;

#[derive(Default)]
struct MemoryRloginSink {
    frames: Mutex<Vec<(OutputFrame, bool)>>,
    events: Mutex<Vec<RloginEvent>>,
}

impl RloginSink for MemoryRloginSink {
    fn send_frame(
        &self,
        _session_id: &str,
        frame: &OutputFrame,
        replayed: bool,
    ) -> Result<(), RloginSinkError> {
        self.frames.lock().unwrap().push((frame.clone(), replayed));
        Ok(())
    }

    fn send_event(&self, event: &RloginEvent) -> Result<(), RloginSinkError> {
        self.events.lock().unwrap().push(event.clone());
        Ok(())
    }
}

fn test_config() -> RloginConfig {
    RloginConfig {
        host: "fixture.invalid".to_string(),
        local_username: "alice".to_string(),
        remote_username: "root".to_string(),
        terminal_type: "xterm".to_string(),
        terminal_speed: 38_400,
        handshake_timeout_ms: 250,
        replay_capacity_bytes: 64,
        ..RloginConfig::default()
    }
}

fn spawn_accepting_fixture(
    mut server: DuplexStream,
    expected_handshake: Vec<u8>,
) -> JoinHandle<DuplexStream> {
    tokio::spawn(async move {
        let mut handshake = vec![0; expected_handshake.len()];
        server.read_exact(&mut handshake).await.unwrap();
        assert_eq!(handshake, expected_handshake);
        server.write_all(&[0]).await.unwrap();
        server.flush().await.unwrap();
        server
    })
}

async fn fixture_engine(config: RloginConfig) -> (RloginEngine<DuplexStream>, DuplexStream) {
    let expected_handshake = encode_handshake(&config).unwrap();
    let (client, server) = duplex(4096);
    let fixture = spawn_accepting_fixture(server, expected_handshake);
    let engine = RloginEngine::establish(client, config).await.unwrap();
    (engine, fixture.await.unwrap())
}

#[test]
fn encodes_exact_rfc_1282_handshake() {
    let config = test_config();
    assert_eq!(
        encode_handshake(&config).unwrap(),
        b"\0alice\0root\0xterm/38400\0"
    );
}

#[test]
fn rejects_invalid_handshake_fields_and_limits() {
    let mut config = test_config();
    config.local_username = "bad\0user".to_string();
    assert!(matches!(
        encode_handshake(&config),
        Err(RloginError::InvalidField {
            field: "localUsername",
            ..
        })
    ));

    let mut config = test_config();
    config.remote_username = "x".repeat(257);
    assert!(matches!(
        encode_handshake(&config),
        Err(RloginError::InvalidField {
            field: "remoteUsername",
            ..
        })
    ));

    let mut config = test_config();
    config.terminal_type.clear();
    assert!(matches!(
        encode_handshake(&config),
        Err(RloginError::InvalidField {
            field: "terminalType",
            ..
        })
    ));

    let mut config = test_config();
    config.idle_timeout_ms = 0;
    assert!(matches!(
        encode_handshake(&config),
        Err(RloginError::InvalidField {
            field: "idleTimeoutMs",
            ..
        })
    ));
}

#[test]
fn encodes_exact_big_endian_window_update() {
    assert_eq!(
        encode_window_update(WindowSize {
            rows: 0x1234,
            columns: 0x5678,
            width_pixels: 0x9abc,
            height_pixels: 0xdef0,
        }),
        [0xff, 0xff, b's', b's', 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,]
    );
}

#[tokio::test]
async fn accepts_zero_acknowledgement() {
    let (mut client, mut server) = duplex(16);
    server.write_all(&[0]).await.unwrap();
    read_server_ack(&mut client).await.unwrap();
}

#[tokio::test]
async fn reports_bounded_sanitized_server_diagnostic() {
    let (mut client, mut server) = duplex(128);
    server
        .write_all(b"\x01Permission\x07 denied\r\n")
        .await
        .unwrap();
    let error = read_server_ack(&mut client).await.unwrap_err();
    assert_eq!(
        error,
        RloginError::ServerDiagnostic("Permission\u{fffd} denied".to_string())
    );
}

#[tokio::test]
async fn rejects_overlong_server_diagnostic() {
    let (mut client, mut server) = duplex(2048);
    let writer = tokio::spawn(async move {
        server.write_all(&[1]).await.unwrap();
        server
            .write_all(&vec![b'x'; types::MAX_SERVER_DIAGNOSTIC_BYTES + 1])
            .await
            .unwrap();
    });
    let error = read_server_ack(&mut client).await.unwrap_err();
    writer.await.unwrap();
    assert_eq!(
        error,
        RloginError::ServerDiagnosticTooLong {
            limit: types::MAX_SERVER_DIAGNOSTIC_BYTES,
        }
    );
}

#[tokio::test]
async fn rejects_unexpected_acknowledgement() {
    let (mut client, mut server) = duplex(16);
    server.write_all(&[0x7f]).await.unwrap();
    assert_eq!(
        read_server_ack(&mut client).await.unwrap_err(),
        RloginError::UnexpectedAcknowledgement(0x7f)
    );
}

#[tokio::test]
async fn handshake_timeout_is_explicit_and_closes_stream() {
    let mut config = test_config();
    config.handshake_timeout_ms = 20;
    let (client, mut server) = duplex(256);
    let error = match RloginEngine::establish(client, config).await {
        Ok(_) => panic!("fixture unexpectedly completed the handshake"),
        Err(error) => error,
    };
    assert_eq!(error, RloginError::HandshakeTimeout { timeout_ms: 20 });

    let mut bytes = Vec::new();
    server.read_to_end(&mut bytes).await.unwrap();
    assert_eq!(bytes, b"\0alice\0root\0xterm/38400\0");
}

#[tokio::test]
async fn idle_read_timeout_is_enforced_after_transport_handoff() {
    let mut config = test_config();
    config.idle_timeout_ms = 20;
    let (mut engine, _server) = fixture_engine(config).await;
    let mut buffer = [0; 8];
    assert_eq!(
        engine.read_output(&mut buffer).await.unwrap_err(),
        RloginError::OperationTimeout {
            operation: "idle read",
            timeout_ms: 20,
        }
    );
    assert_eq!(engine.lifecycle(), RloginLifecycle::Error);
    let _ = engine.close().await;
}

#[tokio::test]
async fn write_timeout_is_enforced_when_the_peer_stops_reading() {
    let mut config = test_config();
    config.escape_enabled = false;
    config.local_flow_control = false;
    config.write_timeout_ms = 20;
    let expected_handshake = encode_handshake(&config).unwrap();
    let (client, server) = duplex(64);
    let fixture = spawn_accepting_fixture(server, expected_handshake);
    let mut engine = RloginEngine::establish(client, config).await.unwrap();
    let _server = fixture.await.unwrap();

    assert_eq!(
        engine.write_input(&vec![b'x'; 4096]).await.unwrap_err(),
        RloginError::OperationTimeout {
            operation: "terminal write",
            timeout_ms: 20,
        }
    );
    assert_eq!(engine.lifecycle(), RloginLifecycle::Error);
    let _ = engine.close().await;
}

#[tokio::test]
async fn cancellation_interrupts_a_pending_idle_read() {
    let mut config = test_config();
    config.idle_timeout_ms = 5_000;
    let (mut engine, _server) = fixture_engine(config).await;
    let cancellation = engine.cancellation_handle();
    assert!(!cancellation.is_cancelled());
    let cancel_task = tokio::spawn(async move {
        tokio::task::yield_now().await;
        cancellation.cancel();
    });

    let mut buffer = [0; 8];
    assert_eq!(
        engine.read_output(&mut buffer).await.unwrap_err(),
        RloginError::Cancelled
    );
    cancel_task.await.unwrap();
    assert_eq!(engine.lifecycle(), RloginLifecycle::Closing);
    engine.close().await.unwrap();
}

#[test]
fn cooked_flow_control_is_local_and_raw_mode_is_transparent() {
    let mut cooked = InputProcessor::new(false, b'~', true);
    let processed = cooked.process(b"a\x13b\x11c", TerminalMode::Cooked);
    assert_eq!(processed.wire_bytes, b"abc");
    assert_eq!(
        processed.local_flow_actions,
        vec![LocalFlowAction::PauseOutput, LocalFlowAction::ResumeOutput]
    );

    let mut raw = InputProcessor::new(false, b'~', true);
    let processed = raw.process(b"a\x13b\x11c", TerminalMode::Raw);
    assert_eq!(processed.wire_bytes, b"a\x13b\x11c");
    assert!(processed.local_flow_actions.is_empty());
}

#[test]
fn line_start_escape_handling_survives_chunk_boundaries() {
    let mut processor = InputProcessor::new(true, b'~', false);
    let first = processor.process(b"~", TerminalMode::Cooked);
    assert!(first.wire_bytes.is_empty());
    assert!(processor.has_pending_escape());

    let literal = processor.process(b"~", TerminalMode::Cooked);
    assert_eq!(literal.wire_bytes, b"~");
    assert!(!literal.disconnect_requested);

    let line = processor.process(b"\r~", TerminalMode::Cooked);
    assert_eq!(line.wire_bytes, b"\r");
    assert!(processor.has_pending_escape());
    let close = processor.process(b".ignored", TerminalMode::Cooked);
    assert!(close.wire_bytes.is_empty());
    assert!(close.disconnect_requested);
}

#[test]
fn escape_sequence_is_not_special_in_the_middle_of_a_line() {
    let mut processor = InputProcessor::new(true, b'~', false);
    let processed = processor.process(b"echo ~.\r", TerminalMode::Cooked);
    assert_eq!(processed.wire_bytes, b"echo ~.\r");
    assert!(!processed.disconnect_requested);
}

#[test]
fn urgent_control_state_machine_is_deterministic() {
    let mut state = UrgentState::default();
    let update = state.apply(
        URGENT_DISCARD_OUTPUT | URGENT_RAW_MODE | URGENT_COOKED_MODE | URGENT_WINDOW_UPDATE | 0x01,
    );
    assert_eq!(
        update.actions,
        vec![
            UrgentAction::DiscardOutput,
            UrgentAction::EnterRawMode,
            UrgentAction::EnterCookedMode,
            UrgentAction::SendWindowUpdate,
        ]
    );
    assert_eq!(update.unknown_bits, 0x01);
    assert_eq!(state.terminal_mode, TerminalMode::Cooked);
    assert!(state.window_updates_enabled);
}

#[test]
fn replay_is_bounded_monotonic_and_reports_cursor_gaps() {
    let mut replay = ReplayBuffer::new(5);
    let first = replay.push(b"abc").unwrap();
    let second = replay.push(b"def").unwrap();
    assert_eq!(first.sequence, 1);
    assert_eq!(second.sequence, 2);
    assert_eq!(replay.retained_bytes(), 3);

    let stale = replay.snapshot_after(0);
    assert!(stale.truncated);
    assert_eq!(stale.first_available_sequence, Some(2));
    assert_eq!(stale.frames[0].data, b"def");

    let current = replay.snapshot_after(1);
    assert!(!current.truncated);
    assert_eq!(current.next_sequence, 3);

    let oversized = replay.push(b"0123456789").unwrap();
    assert_eq!(oversized.sequence, 3);
    assert_eq!(oversized.data, b"56789");
    assert!(oversized.prefix_truncated);
    assert!(replay.snapshot_after(2).truncated);
}

#[test]
fn discard_preserves_the_monotonic_replay_cursor() {
    let mut replay = ReplayBuffer::new(32);
    replay.push(b"one");
    replay.push(b"two");
    assert_eq!(replay.discard(), 6);
    assert_eq!(replay.last_sequence(), 2);
    let snapshot = replay.snapshot_after(0);
    assert!(snapshot.frames.is_empty());
    assert!(snapshot.truncated);
    let next = replay.push(b"three").unwrap();
    assert_eq!(next.sequence, 3);
}

#[tokio::test]
async fn session_preserves_transparent_eight_bit_input_and_output() {
    let mut config = test_config();
    config.escape_enabled = false;
    config.local_flow_control = false;
    let (mut engine, mut server) = fixture_engine(config).await;
    let payload = [0x00, 0xff, 0x11, 0x13, b'A'];

    engine.write_input(&payload).await.unwrap();
    let mut received = [0; 5];
    server.read_exact(&mut received).await.unwrap();
    assert_eq!(received, payload);
    server.write_all(&payload).await.unwrap();

    let mut buffer = [0; 16];
    let output = engine.read_output(&mut buffer).await.unwrap();
    assert_eq!(
        output,
        OutputDisposition::Display {
            frame: OutputFrame {
                sequence: 1,
                data: payload.to_vec(),
                prefix_truncated: false,
            }
        }
    );
    assert_eq!(engine.stats().terminal_bytes_sent, payload.len() as u64);
    assert_eq!(engine.stats().terminal_bytes_received, payload.len() as u64);
    engine.close().await.unwrap();
}

#[tokio::test]
async fn window_update_is_deferred_until_server_requests_it() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    let size = WindowSize {
        rows: 50,
        columns: 120,
        width_pixels: 1440,
        height_pixels: 900,
    };
    assert_eq!(engine.resize(size).await.unwrap(), ResizeOutcome::Deferred);
    let urgent = engine
        .handle_urgent_control(URGENT_WINDOW_UPDATE)
        .await
        .unwrap();
    assert_eq!(urgent.resize, Some(ResizeOutcome::Sent));

    let mut frame = [0; 12];
    server.read_exact(&mut frame).await.unwrap();
    assert_eq!(frame, encode_window_update(size));
    assert_eq!(engine.stats().resize_frames_sent, 1);
    assert_eq!(engine.stats().protocol_bytes_sent, 12);
    engine.close().await.unwrap();
}

#[tokio::test]
async fn cooked_pause_buffers_output_and_resume_returns_the_exact_gap() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    let pause = engine.write_input(&[0x13]).await.unwrap();
    assert_eq!(pause.bytes_written, 0);
    assert_eq!(pause.local_flow_actions, vec![LocalFlowAction::PauseOutput]);

    server.write_all(b"buffered").await.unwrap();
    let mut buffer = [0; 32];
    assert_eq!(
        engine.read_output(&mut buffer).await.unwrap(),
        OutputDisposition::Buffered {
            sequence: 1,
            byte_length: 8,
        }
    );

    let resume = engine.write_input(&[0x11]).await.unwrap();
    assert_eq!(resume.bytes_written, 0);
    let snapshot = resume.resumed_output.unwrap();
    assert!(!snapshot.truncated);
    assert_eq!(snapshot.frames.len(), 1);
    assert_eq!(snapshot.frames[0].data, b"buffered");
    engine.close().await.unwrap();
}

#[tokio::test]
async fn urgent_discard_clears_retained_undisplayed_output() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    server.write_all(b"discard me").await.unwrap();
    let mut buffer = [0; 32];
    engine.read_output(&mut buffer).await.unwrap();
    assert_eq!(engine.output_snapshot_after(0).frames.len(), 1);

    let outcome = engine
        .handle_urgent_control(URGENT_DISCARD_OUTPUT)
        .await
        .unwrap();
    assert_eq!(outcome.update.actions, vec![UrgentAction::DiscardOutput]);
    let snapshot = engine.output_snapshot_after(0);
    assert!(snapshot.frames.is_empty());
    assert!(snapshot.truncated);
    assert_eq!(engine.stats().discarded_output_bytes, 10);
    engine.close().await.unwrap();
}

#[tokio::test]
async fn raw_mode_passes_xon_and_xoff_to_the_wire() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    engine.handle_urgent_control(URGENT_RAW_MODE).await.unwrap();
    let outcome = engine.write_input(&[0x13, 0x11]).await.unwrap();
    assert_eq!(outcome.bytes_written, 2);

    let mut received = [0; 2];
    server.read_exact(&mut received).await.unwrap();
    assert_eq!(received, [0x13, 0x11]);
    engine.close().await.unwrap();
}

#[tokio::test]
async fn line_start_disconnect_closes_once_without_sending_escape_bytes() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    assert_eq!(engine.write_input(b"~").await.unwrap().bytes_written, 0);
    let outcome = engine.write_input(b".ignored").await.unwrap();
    assert!(outcome.disconnect_requested);
    assert_eq!(engine.lifecycle(), RloginLifecycle::Closed);
    engine.close().await.unwrap();

    let mut received = Vec::new();
    server.read_to_end(&mut received).await.unwrap();
    assert!(received.is_empty());
}

#[tokio::test]
async fn remote_eof_transitions_to_closed_and_cleanup_is_idempotent() {
    let config = test_config();
    let (mut engine, mut server) = fixture_engine(config).await;
    server.shutdown().await.unwrap();

    let mut buffer = [0; 8];
    assert_eq!(
        engine.read_output(&mut buffer).await.unwrap(),
        OutputDisposition::EndOfStream
    );
    assert_eq!(engine.lifecycle(), RloginLifecycle::Closed);
    engine.close().await.unwrap();
}

#[tokio::test]
async fn service_requires_resolved_transport_and_accepts_injected_streams() {
    let state = RloginService::new();
    let unacknowledged = RloginConnectOptions {
        config: test_config(),
        ..RloginConnectOptions::default()
    };
    assert_eq!(
        unacknowledged.validate(),
        Err(RloginError::PlaintextAcknowledgementRequired)
    );
    assert!(!state.diagnose_rlogin(&unacknowledged).compatible);

    let config = test_config();
    let expected_handshake = encode_handshake(&config).unwrap();
    let (client, server) = duplex(4096);
    let fixture = spawn_accepting_fixture(server, expected_handshake);
    let session_id = state.connect_with_stream(config, client).await.unwrap();
    let mut server = fixture.await.unwrap();

    state
        .send_rlogin_input(&session_id, b"hello".to_vec())
        .await
        .unwrap();
    let mut input = [0; 5];
    server.read_exact(&mut input).await.unwrap();
    assert_eq!(&input, b"hello");

    let info = state.get_rlogin_session_info(&session_id).await.unwrap();
    assert!(info.connected);
    state.disconnect_rlogin(&session_id).await.unwrap();
    state.disconnect_rlogin(&session_id).await.unwrap();
}

#[test]
fn production_diagnostics_fail_closed_for_unavailable_transport_features() {
    let mut options = RloginConnectOptions {
        config: test_config(),
        plaintext_acknowledged: true,
        ..RloginConnectOptions::default()
    };
    let capabilities = options.capabilities();
    assert!(capabilities.direct_route);
    assert!(!capabilities.proxy_routes);
    assert!(!capabilities.reserved_source_port);
    assert!(!capabilities.out_of_band_control);

    options.source_port_mode = RloginSourcePortMode::Reserved;
    assert_eq!(
        options.validate(),
        Err(RloginError::ReservedSourcePortUnavailable)
    );
    assert!(!RloginDiagnosis::for_options(&options).compatible);

    options.source_port_mode = RloginSourcePortMode::Ephemeral;
    options.route = Route::Socks5;
    assert_eq!(
        options.validate(),
        Err(RloginError::UnsupportedRoute(
            sorng_socket_transport::RouteKind::Socks5
        ))
    );
}

#[tokio::test]
async fn actor_delivers_sequence_replay_and_never_fakes_oob_from_stream_bytes() {
    let state = RloginService::new();
    let config = test_config();
    let expected_handshake = encode_handshake(&config).unwrap();
    let (client, server) = duplex(4096);
    let fixture = spawn_accepting_fixture(server, expected_handshake);
    let sink = Arc::new(MemoryRloginSink::default());
    let session_id = state
        .connect_with_stream_and_sink(config, client, sink.clone())
        .await
        .unwrap();
    let mut server = fixture.await.unwrap();

    // These bytes resemble protocol control data but arrived on the ordinary
    // stream. Without a real platform MSG_OOB extractor they must remain
    // byte-for-byte terminal output and must not change urgent state.
    let payload = b"\xff\x10ordinary\0bytes";
    server.write_all(payload).await.unwrap();
    server.flush().await.unwrap();
    timeout(Duration::from_secs(2), async {
        while sink.frames.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("actor should deliver ordinary TCP output");

    let frames = sink.frames.lock().unwrap().clone();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].0.sequence, 1);
    assert_eq!(frames[0].0.data, payload);
    assert!(!frames[0].1);

    let snapshot = state
        .get_rlogin_output_snapshot(&session_id, 0)
        .await
        .unwrap();
    assert_eq!(snapshot.frames[0].data, payload);
    let info = state.get_rlogin_session_info(&session_id).await.unwrap();
    assert_eq!(info.stats.urgent_controls_received, 0);
    assert!(!info.window_updates_enabled);
    assert!(!info.capabilities.out_of_band_control);
    assert_eq!(
        state
            .resize_rlogin(
                &session_id,
                WindowSize {
                    rows: 40,
                    columns: 120,
                    ..WindowSize::default()
                }
            )
            .await
            .unwrap(),
        ResizeOutcome::Deferred
    );
    state.disconnect_rlogin(&session_id).await.unwrap();
}
