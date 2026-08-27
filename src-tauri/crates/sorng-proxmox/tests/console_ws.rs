//! termproxy WebSocket relay contract tests (t67-e5).
//!
//! Every case runs against the in-process TLS mock PVE (`mod mock_pve`) with
//! the mock's own certificate pinned, so the real `insecure + fingerprint`
//! path is exercised end to end.

mod mock_pve;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mock_pve::{MockPve, MOCK_NODE, MOCK_VMID};
use sorng_core::events::{AppEventEmitter, DynEventEmitter};
use sorng_proxmox::console_ws::{
    ConsoleRegistry, EVENT_CONSOLE_CLOSED, EVENT_CONSOLE_ERROR, EVENT_CONSOLE_OUTPUT,
    OUTPUT_CHUNK_BYTES,
};
use sorng_proxmox::service::ProxmoxService;
use sorng_proxmox::types::{ProxmoxAuthMethod, ProxmoxConfig};

// ── Test emitter ─────────────────────────────────────────────────────

#[derive(Default)]
struct RecordingEmitter {
    events: Mutex<Vec<(String, serde_json::Value)>>,
}

impl AppEventEmitter for RecordingEmitter {
    fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((event.to_string(), payload));
        Ok(())
    }
}

impl RecordingEmitter {
    fn snapshot(&self) -> Vec<(String, serde_json::Value)> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn payloads(&self, event: &str) -> Vec<serde_json::Value> {
        self.snapshot()
            .into_iter()
            .filter(|(name, _)| name == event)
            .map(|(_, payload)| payload)
            .collect()
    }

    /// Concatenated, base64-decoded `proxmox-console-output` payloads.
    fn output(&self) -> Vec<u8> {
        use base64::Engine;
        self.payloads(EVENT_CONSOLE_OUTPUT)
            .iter()
            .filter_map(|payload| payload.get("data").and_then(serde_json::Value::as_str))
            .flat_map(|data| {
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .expect("output payloads are base64")
            })
            .collect()
    }

    async fn wait_for(&self, timeout: Duration, predicate: impl Fn(&Self) -> bool) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if predicate(self) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

const WAIT: Duration = Duration::from_secs(10);

// ── Fixtures ─────────────────────────────────────────────────────────

fn password_config(mock: &MockPve) -> ProxmoxConfig {
    ProxmoxConfig {
        host: mock.host(),
        port: mock.port(),
        auth: ProxmoxAuthMethod::Password {
            username: "root@pam".into(),
            password: mock_pve::DEFAULT_PASSWORD.into(),
            realm: "pam".into(),
            otp: None,
            totp_secret: None,
        },
        insecure: true,
        timeout_secs: 10,
        fingerprint: Some(mock.fingerprint.clone()),
    }
}

/// A connected service whose console events land in the returned emitter.
async fn connected(mock: &MockPve) -> (ProxmoxService, Arc<RecordingEmitter>) {
    connected_with(mock, |emitter| ConsoleRegistry::new(Some(emitter))).await
}

async fn connected_with(
    mock: &MockPve,
    build: impl FnOnce(DynEventEmitter) -> ConsoleRegistry,
) -> (ProxmoxService, Arc<RecordingEmitter>) {
    let emitter = Arc::new(RecordingEmitter::default());
    let registry = build(Arc::clone(&emitter) as DynEventEmitter);
    let mut service = ProxmoxService::with_console_registry(registry);
    service
        .connect(password_config(mock))
        .await
        .expect("connect to the mock PVE");
    (service, emitter)
}

// ── Handshake ────────────────────────────────────────────────────────

#[tokio::test]
async fn opening_a_qemu_console_completes_the_user_ticket_handshake() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    assert_eq!(session.node, MOCK_NODE);
    assert_eq!(session.vmid, Some(MOCK_VMID));
    assert_eq!(session.vm_type, "qemu");
    assert_eq!(session.user, "root@pam");
    assert!(!session.session_id.is_empty());
    assert_eq!(service.console_sessions().len(), 1);

    let state = mock.state();
    assert_eq!(state.console_connections, 1);
    let ticket = state
        .console_ticket_values()
        .pop()
        .expect("a termproxy ticket was issued");
    assert_eq!(
        state.console_handshakes,
        vec![format!("root@pam:{ticket}\n")],
        "the relay must send `<user>:<ticket>\\n` verbatim"
    );
    assert_eq!(
        state.count("POST", "/api2/json/nodes/pve-mock/qemu/100/termproxy"),
        1
    );
}

#[tokio::test]
async fn a_node_shell_console_uses_the_node_level_endpoints() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let session = service
        .console_open(MOCK_NODE, None, None)
        .await
        .expect("node shell opens");
    assert_eq!(session.vm_type, "node");
    assert_eq!(session.vmid, None);

    let state = mock.state();
    assert_eq!(
        state.count("POST", "/api2/json/nodes/pve-mock/termproxy"),
        1
    );
    assert_eq!(
        state.count("GET", "/api2/json/nodes/pve-mock/vncwebsocket"),
        1
    );
}

#[tokio::test]
async fn the_websocket_upgrade_carries_the_session_cookie() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;
    service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    let state = mock.state();
    let upgrade = state
        .requests
        .iter()
        .find(|request| request.path.ends_with("/vncwebsocket"))
        .expect("the upgrade was recorded");
    let cookie = upgrade.header("Cookie").expect("PVEAuthCookie is sent");
    assert!(cookie.starts_with("PVEAuthCookie=PVE:root@pam:"));
    assert!(
        upgrade.header("Authorization").is_none(),
        "a password session must not send an API-token header"
    );
    assert!(
        upgrade.query.contains("vncticket=PVEVNC"),
        "the vnc ticket travels in the query: {}",
        upgrade.query
    );
    assert!(upgrade.query.contains("port="));
}

// ── Framing ──────────────────────────────────────────────────────────

#[tokio::test]
async fn terminal_input_is_framed_as_zero_len_data_and_echoes_back() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    service
        .console_send(&session.session_id, "ls -l\r")
        .expect("input queued");

    assert!(
        mock.wait_for(WAIT, |state| !state.console_inputs.is_empty())
            .await,
        "the mock never saw the input frame"
    );
    assert_eq!(mock.state().console_inputs, vec![b"ls -l\r".to_vec()]);
    assert!(mock.state().console_bad_frames.is_empty());

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.output() == b"ls -l\r")
            .await,
        "the echoed output never arrived: {:?}",
        emitter.snapshot()
    );
    let payload = emitter.payloads(EVENT_CONSOLE_OUTPUT).remove(0);
    assert_eq!(payload["sessionId"], session.session_id.as_str());
}

#[tokio::test]
async fn multibyte_input_is_framed_by_byte_length() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    service
        .console_send(&session.session_id, "héllo")
        .expect("input queued");

    assert!(
        mock.wait_for(WAIT, |state| !state.console_inputs.is_empty())
            .await,
        "the mock never saw the input frame"
    );
    assert_eq!(
        mock.state().console_inputs,
        vec!["héllo".as_bytes().to_vec()],
        "a byte-length mismatch would land in console_bad_frames"
    );
    assert!(mock.state().console_bad_frames.is_empty());
}

#[tokio::test]
async fn resize_is_framed_as_one_cols_rows() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    service
        .console_resize(&session.session_id, 132, 43)
        .expect("resize queued");

    assert!(
        mock.wait_for(WAIT, |state| !state.console_resizes.is_empty())
            .await,
        "the mock never saw the resize frame"
    );
    assert_eq!(mock.state().console_resizes, vec![(132, 43)]);
    assert!(mock.state().console_bad_frames.is_empty());
}

#[tokio::test]
async fn invalid_resize_arguments_are_rejected_before_the_wire() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    assert!(service.console_resize(&session.session_id, 0, 24).is_err());
    assert!(service.console_resize(&session.session_id, 80, 0).is_err());
    assert!(mock.state().console_resizes.is_empty());
}

#[tokio::test]
async fn the_keepalive_frame_is_sent_on_the_ping_cadence() {
    let mock = MockPve::start().await;
    // The production cadence is 30 s (asserted as a constant below); the relay
    // reads it from the registry, so the test drives a 20 ms one instead.
    let (service, _emitter) = connected_with(&mock, |emitter| {
        ConsoleRegistry::new(Some(emitter)).with_ping_interval(Duration::from_millis(20))
    })
    .await;
    let _session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    let reached = mock.wait_for(WAIT, |state| state.console_pings >= 3).await;
    let seen = mock.state().console_pings;
    assert!(reached, "expected at least 3 keepalives, saw {seen}");
    assert!(mock.state().console_bad_frames.is_empty());
    assert_eq!(
        sorng_proxmox::console_ws::PING_INTERVAL,
        Duration::from_secs(30),
        "the shipped cadence must stay at 30 s"
    );
}

// ── Server → client ──────────────────────────────────────────────────

#[tokio::test]
async fn server_bytes_are_emitted_as_base64_output_events() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    // Arbitrary bytes, including a NUL and invalid UTF-8, survive the round trip.
    let banner: Vec<u8> = vec![0x1b, b'[', b'0', b'm', 0x00, 0xff, b'#', b' '];
    mock.push_console_output(&banner);

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.output() == banner)
            .await,
        "output never arrived: {:?}",
        emitter.snapshot()
    );
    let payload = emitter.payloads(EVENT_CONSOLE_OUTPUT).remove(0);
    assert_eq!(payload["sessionId"], session.session_id.as_str());
}

#[tokio::test]
async fn large_server_writes_are_split_into_bounded_chunks() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    let _session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    let bulk = vec![b'z'; OUTPUT_CHUNK_BYTES * 2 + 7];
    mock.push_console_output(&bulk);

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.output().len() == bulk.len())
            .await,
        "the bulk output never arrived in full"
    );
    assert_eq!(emitter.output(), bulk);

    use base64::Engine;
    for payload in emitter.payloads(EVENT_CONSOLE_OUTPUT) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload["data"].as_str().expect("data is a string"))
            .expect("base64");
        assert!(
            decoded.len() <= OUTPUT_CHUNK_BYTES,
            "chunk of {} bytes exceeds the {OUTPUT_CHUNK_BYTES} byte cap",
            decoded.len()
        );
    }
}

// ── Close paths ──────────────────────────────────────────────────────

#[tokio::test]
async fn a_server_close_emits_the_closed_event_and_deregisters() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    mock.close_consoles("vm shut down");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| !emitter
                .payloads(EVENT_CONSOLE_CLOSED)
                .is_empty())
            .await,
        "no closed event: {:?}",
        emitter.snapshot()
    );
    let closed = emitter.payloads(EVENT_CONSOLE_CLOSED).remove(0);
    assert_eq!(closed["sessionId"], session.session_id.as_str());
    assert_eq!(closed["reason"], "vm shut down");
    assert!(
        service.console_sessions().is_empty(),
        "a closed session must deregister itself"
    );
    assert!(service.console_send(&session.session_id, "x").is_err());
}

#[tokio::test]
async fn closing_a_console_emits_exactly_one_closed_event() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    service
        .console_close(&session.session_id)
        .expect("close queued");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| !emitter
                .payloads(EVENT_CONSOLE_CLOSED)
                .is_empty())
            .await,
        "no closed event: {:?}",
        emitter.snapshot()
    );
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(emitter.payloads(EVENT_CONSOLE_CLOSED).len(), 1);
    assert_eq!(
        emitter.payloads(EVENT_CONSOLE_CLOSED)[0]["reason"],
        "Closed by the client"
    );
    assert!(service.console_sessions().is_empty());
}

#[tokio::test]
async fn disconnecting_closes_every_live_console() {
    let mock = MockPve::start().await;
    let (mut service, emitter) = connected(&mock).await;
    service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("guest console opens");
    service
        .console_open(MOCK_NODE, None, Some("node"))
        .await
        .expect("node console opens");
    assert_eq!(service.console_sessions().len(), 2);

    service.disconnect().await.expect("disconnect");

    assert!(service.console_sessions().is_empty());
    let closed = emitter.payloads(EVENT_CONSOLE_CLOSED);
    assert_eq!(closed.len(), 2);
    for payload in closed {
        assert_eq!(payload["reason"], "Disconnected from Proxmox VE");
    }
}

// ── Failure paths ────────────────────────────────────────────────────

#[tokio::test]
async fn an_expired_console_ticket_fails_the_upgrade_without_registering() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    mock.state().console_reject_upgrade = true;

    let error = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect_err("a rejected ticket must not open a console");
    assert!(
        error.to_string().contains("expired"),
        "unexpected error: {error}"
    );
    assert!(service.console_sessions().is_empty());
    assert!(emitter.payloads(EVENT_CONSOLE_CLOSED).is_empty());
    assert_eq!(mock.state().console_connections, 0);
}

#[tokio::test]
async fn the_console_websocket_only_trusts_the_pinned_certificate() {
    let mock = MockPve::start().await;

    // Every passing test in this file is itself the positive half of the pin
    // assertion: the mock serves a self-signed certificate that no native root
    // store trusts, so a `vncwebsocket` upgrade can only complete because the
    // relay rebuilt the client's `PinnedCertificateVerifier`.
    let (service, _emitter) = connected(&mock).await;
    service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("the pinned connector completes the upgrade");
    assert_eq!(mock.state().console_connections, 1);

    // Negative half: a well-formed but wrong pin is refused fail-closed, so no
    // console can ever be opened against a certificate that does not match.
    let mut wrong = password_config(&mock);
    wrong.fingerprint = Some(
        "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:\
         00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF"
            .to_string(),
    );
    let mut mismatched = ProxmoxService::with_console_registry(ConsoleRegistry::new(None));
    assert!(
        mismatched.connect(wrong).await.is_err(),
        "a mismatched pin must fail closed"
    );
    assert!(mismatched
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .is_err());

    // And strict TLS (no pin, no `insecure`) refuses the self-signed mock too.
    let mut strict_config = password_config(&mock);
    strict_config.insecure = false;
    strict_config.fingerprint = None;
    let mut strict = ProxmoxService::with_console_registry(ConsoleRegistry::new(None));
    assert!(strict.connect(strict_config).await.is_err());
    assert_eq!(
        mock.state().console_connections,
        1,
        "no additional console reached the termproxy emulation"
    );
}

#[tokio::test]
async fn unknown_console_targets_are_rejected() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    assert!(service
        .console_open("../access", Some(MOCK_VMID), Some("qemu"))
        .await
        .is_err());
    assert!(service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("spice"))
        .await
        .is_err());
    assert!(service
        .console_open(MOCK_NODE, None, Some("qemu"))
        .await
        .is_err());
    assert!(
        mock.state().console_issued == 0,
        "no ticket may be requested for an invalid target"
    );
}

#[tokio::test]
async fn console_commands_require_a_connection() {
    let service = ProxmoxService::new();
    assert!(service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .is_err());
    assert!(service.console_send("nope", "x").is_err());
    assert!(service.console_resize("nope", 80, 24).is_err());
    assert!(service.console_close("nope").is_err());
    assert!(service.console_sessions().is_empty());
}

// ── Limits ───────────────────────────────────────────────────────────

#[tokio::test]
async fn the_concurrent_console_limit_is_enforced() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected_with(&mock, |emitter| {
        ConsoleRegistry::with_limits(Some(emitter), 2, 1024 * 1024)
    })
    .await;

    for _ in 0..2 {
        service
            .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
            .await
            .expect("within the limit");
    }
    let error = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect_err("the third console must be refused");
    assert!(
        error.to_string().contains("Too many open Proxmox consoles"),
        "unexpected error: {error}"
    );
    assert_eq!(service.console_sessions().len(), 2);

    // Closing one frees a slot.
    let first = service.console_sessions().remove(0);
    service.console_close(&first.session_id).expect("close");
    assert!(
        tokio::time::timeout(WAIT, async {
            while service.console_sessions().len() != 1 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .is_ok(),
        "the closed console never freed its slot"
    );
    service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("the freed slot is reusable");
}

#[tokio::test]
async fn oversized_input_is_rejected_and_overflow_drops_the_newest_bytes() {
    let mock = MockPve::start().await;
    // A 1 KiB outbound budget makes the drop-newest path deterministic.
    let (service, emitter) = connected_with(&mock, |emitter| {
        ConsoleRegistry::with_limits(Some(emitter), 16, 1024)
    })
    .await;
    // Stop the echo so the relay task has nothing to do but drain writes.
    mock.state().console_echo = false;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    // Above the per-call ceiling → hard error, nothing queued.
    let huge = "x".repeat(64 * 1024 + 1);
    assert!(service.console_send(&session.session_id, &huge).is_err());

    // Well past the 1 KiB budget in one burst → drop-newest + an error event.
    for _ in 0..64 {
        service
            .console_send(&session.session_id, &"y".repeat(512))
            .expect("send is non-fatal on overflow");
    }
    assert!(
        emitter
            .wait_for(WAIT, |emitter| !emitter
                .payloads(EVENT_CONSOLE_ERROR)
                .is_empty())
            .await,
        "no overflow error event: {:?}",
        emitter.snapshot()
    );
    let error = emitter.payloads(EVENT_CONSOLE_ERROR).remove(0);
    assert_eq!(error["sessionId"], session.session_id.as_str());
    let message = error["message"].as_str().expect("message is a string");
    assert!(
        message.contains("input buffer is full") && message.contains("dropped"),
        "unexpected overflow message: {message}"
    );
    // The session survives an overflow.
    assert_eq!(service.console_sessions().len(), 1);
}

#[tokio::test]
async fn an_empty_send_is_a_no_op() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;
    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens");

    service
        .console_send(&session.session_id, "")
        .expect("no-op");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(mock.state().console_inputs.is_empty());
    assert!(mock.state().console_bad_frames.is_empty());
}

// ── API-token sessions ───────────────────────────────────────────────

#[tokio::test]
async fn an_api_token_session_authorises_the_console_with_the_token_header() {
    let mock = MockPve::start().await;
    mock.state()
        .api_tokens
        .insert("root@pam!console".to_string(), "s3cr3t".to_string());

    let emitter = Arc::new(RecordingEmitter::default());
    let registry = ConsoleRegistry::new(Some(Arc::clone(&emitter) as DynEventEmitter));
    let mut service = ProxmoxService::with_console_registry(registry);
    service
        .connect(ProxmoxConfig {
            host: mock.host(),
            port: mock.port(),
            auth: ProxmoxAuthMethod::ApiToken {
                token_id: "root@pam!console".into(),
                secret: "s3cr3t".into(),
            },
            insecure: true,
            timeout_secs: 10,
            fingerprint: Some(mock.fingerprint.clone()),
        })
        .await
        .expect("token connect");

    let session = service
        .console_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("console opens for a token session");
    assert_eq!(session.user, "root@pam");

    let state = mock.state();
    let upgrade = state
        .requests
        .iter()
        .find(|request| request.path.ends_with("/vncwebsocket"))
        .expect("the upgrade was recorded");
    assert_eq!(
        upgrade.header("Authorization"),
        Some("PVEAPIToken=root@pam!console=s3cr3t")
    );
    assert!(
        upgrade.header("Cookie").is_none(),
        "a token session must not send a PVEAuthCookie"
    );
    assert_eq!(state.console_connections, 1);
}
