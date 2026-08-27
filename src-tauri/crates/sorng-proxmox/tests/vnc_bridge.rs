//! noVNC loopback bridge contract tests (t67-e6).
//!
//! Every case runs against the in-process TLS mock PVE (`mod mock_pve`) with
//! the mock's own certificate pinned, so the real `insecure + fingerprint` path
//! is exercised end to end. Behind the mock's `vncwebsocket` upgrade sits a
//! fake RFB server that greets with `RFB 003.008\n` and records everything the
//! bridged client writes — which is exactly what the bridge has to carry.

mod mock_pve;

use std::io::ErrorKind;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mock_pve::{MockPve, MOCK_NODE, MOCK_VMID, RFB_GREETING};
use sorng_core::events::AppEventEmitter;
use sorng_proxmox::service::ProxmoxService;
use sorng_proxmox::types::{ProxmoxAuthMethod, ProxmoxConfig};
use sorng_proxmox::vnc_bridge::{
    VncBridgeRegistry, ACCEPT_TIMEOUT, EVENT_VNC_BRIDGE_CLOSED, IDLE_TIMEOUT, MAX_VNC_BRIDGES,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

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

    /// `proxmox-vnc-bridge-closed` payloads, in order.
    fn closed(&self) -> Vec<serde_json::Value> {
        self.snapshot()
            .into_iter()
            .filter(|(name, _)| name == EVENT_VNC_BRIDGE_CLOSED)
            .map(|(_, payload)| payload)
            .collect()
    }

    /// The close reason recorded for one bridge, if it has ended.
    fn close_reason(&self, bridge_id: &str) -> Option<String> {
        self.closed()
            .into_iter()
            .find(|payload| payload.get("bridgeId").and_then(|id| id.as_str()) == Some(bridge_id))
            .and_then(|payload| {
                payload
                    .get("reason")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
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

/// A connected service whose bridge events land in the returned emitter.
async fn connected(mock: &MockPve) -> (ProxmoxService, Arc<RecordingEmitter>) {
    connected_with(mock, |emitter| {
        VncBridgeRegistry::new(Some(emitter)).with_timeouts(WAIT, WAIT)
    })
    .await
}

async fn connected_with(
    mock: &MockPve,
    build: impl FnOnce(sorng_core::events::DynEventEmitter) -> VncBridgeRegistry,
) -> (ProxmoxService, Arc<RecordingEmitter>) {
    let emitter = Arc::new(RecordingEmitter::default());
    let registry = build(Arc::clone(&emitter) as sorng_core::events::DynEventEmitter);
    let mut service = ProxmoxService::new().with_vnc_bridge_registry(registry);
    service
        .connect(password_config(mock))
        .await
        .expect("connect to the mock PVE");
    (service, emitter)
}

/// Connect to a bridge port and read the greeting the fake RFB server sends.
/// Returning it proves the client was accepted *and* the websocket is live.
async fn attach(local_port: u16) -> TcpStream {
    let mut client = TcpStream::connect(("127.0.0.1", local_port))
        .await
        .expect("connect to the bridge port");
    let mut greeting = [0_u8; RFB_GREETING.len()];
    tokio::time::timeout(WAIT, client.read_exact(&mut greeting))
        .await
        .expect("the RFB greeting arrives before the timeout")
        .expect("read the RFB greeting");
    assert_eq!(&greeting, RFB_GREETING);
    client
}

// ── The happy path ───────────────────────────────────────────────────

#[tokio::test]
async fn a_bridge_carries_the_rfb_greeting_to_a_loopback_client() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");

    assert_ne!(bridge.local_port, 0, "a loopback port must be allocated");
    assert_eq!(bridge.node, MOCK_NODE);
    assert_eq!(bridge.vmid, Some(MOCK_VMID));
    assert_eq!(bridge.vm_type, "qemu");
    assert_eq!(bridge.user, "root@pam");
    // The ticket the frontend uses as the RFB password is the one PVE issued.
    assert_eq!(
        mock.state().vnc_ticket_values(),
        vec![bridge.ticket.clone()]
    );
    assert_eq!(service.vnc_bridges(), vec![bridge.clone()]);

    let _client = attach(bridge.local_port).await;
    assert!(
        mock.wait_for(WAIT, |state| state.vnc_connections == 1)
            .await,
        "the websocket is opened once a client attaches"
    );
}

#[tokio::test]
async fn the_ticket_is_requested_for_a_websocket_and_the_upgrade_carries_the_session_cookie() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let _client = attach(bridge.local_port).await;
    assert!(
        mock.wait_for(WAIT, |state| state.vnc_connections == 1)
            .await
    );

    let state = mock.state();
    let ticket_request = state
        .requests
        .iter()
        .find(|request| {
            request.method == "POST"
                && request.path == format!("/api2/json/nodes/{MOCK_NODE}/qemu/{MOCK_VMID}/vncproxy")
        })
        .expect("the vncproxy ticket was requested on the guest path");
    assert_eq!(
        ticket_request.form().get("websocket").map(String::as_str),
        Some("1"),
        "PVE only tunnels RFB over a websocket when asked to"
    );

    let upgrade = state
        .requests
        .iter()
        .find(|request| request.path.ends_with("/vncwebsocket"))
        .expect("the websocket upgrade reached the mock");
    let cookie = upgrade.header("Cookie").unwrap_or_default();
    assert!(
        cookie.starts_with("PVEAuthCookie="),
        "a password session authenticates the upgrade with its ticket cookie, got {cookie:?}"
    );
    assert!(
        upgrade.query.contains("vncticket="),
        "the upgrade carries the VNC ticket: {:?}",
        upgrade.query
    );
}

#[tokio::test]
async fn client_writes_reach_the_websocket_side() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let mut client = attach(bridge.local_port).await;

    // The RFB client answers the greeting, then sends binary that is neither
    // valid UTF-8 nor NUL-free — the pump must not touch any of it.
    client
        .write_all(b"RFB 003.008\n")
        .await
        .expect("write the client version");
    client
        .write_all(&[0x01, 0x00, 0xff, 0xfe, b'\n'])
        .await
        .expect("write a security response");
    client.flush().await.expect("flush");

    let expected: Vec<u8> = b"RFB 003.008\n"
        .iter()
        .copied()
        .chain([0x01, 0x00, 0xff, 0xfe, b'\n'])
        .collect();
    assert!(
        mock.wait_for(WAIT, |state| state.vnc_client_bytes == expected)
            .await,
        "every client byte reaches PVE unchanged, got {:?}",
        mock.state().vnc_client_bytes
    );
}

#[tokio::test]
async fn server_pushes_reach_the_local_client() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let mut client = attach(bridge.local_port).await;

    // A framebuffer update is arbitrary binary; NUL and invalid UTF-8 included.
    let framebuffer = [0x00_u8, 0x00, 0x00, 0x01, 0xc3, 0x28, 0xff];
    mock.push_vnc_output(&framebuffer);

    let mut received = [0_u8; 7];
    tokio::time::timeout(WAIT, client.read_exact(&mut received))
        .await
        .expect("the framebuffer arrives before the timeout")
        .expect("read the framebuffer");
    assert_eq!(received, framebuffer);
}

// ── Single client ────────────────────────────────────────────────────

#[tokio::test]
async fn a_second_connection_to_the_bridge_port_is_refused() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    // Reading the greeting proves the first client was accepted and the
    // listener has been dropped.
    let _client = attach(bridge.local_port).await;

    let second = tokio::time::timeout(WAIT, TcpStream::connect(("127.0.0.1", bridge.local_port)))
        .await
        .expect("the second connection resolves rather than hanging");
    let error = second.expect_err("a bridge serves exactly one client");
    assert!(
        matches!(
            error.kind(),
            ErrorKind::ConnectionRefused | ErrorKind::ConnectionReset
        ),
        "expected a refusal, got {error:?}"
    );

    // The first client is untouched by the refused attempt.
    assert!(
        mock.wait_for(WAIT, |state| state.vnc_connections == 1)
            .await
    );
    assert_eq!(service.vnc_bridges().len(), 1);
}

// ── Teardown paths ───────────────────────────────────────────────────

#[tokio::test]
async fn a_bridge_nobody_connects_to_closes_when_the_accept_deadline_passes() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected_with(&mock, |emitter| {
        VncBridgeRegistry::new(Some(emitter)).with_timeouts(Duration::from_millis(200), WAIT)
    })
    .await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await,
        "the bridge announces its own timeout"
    );
    let reason = emitter.close_reason(&bridge.bridge_id).expect("a reason");
    assert!(
        reason.starts_with("No VNC client connected within"),
        "unexpected reason: {reason}"
    );
    assert!(service.vnc_bridges().is_empty());
    assert!(
        mock.state().vnc_connections == 0,
        "PVE is never dialled when nobody attaches"
    );

    // The port is gone with the bridge.
    let late = tokio::time::timeout(WAIT, TcpStream::connect(("127.0.0.1", bridge.local_port)))
        .await
        .expect("the late connection resolves rather than hanging");
    assert!(late.is_err(), "a closed bridge no longer listens");
}

#[tokio::test]
async fn closing_the_bridge_disconnects_the_local_client() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let mut client = attach(bridge.local_port).await;

    service
        .vnc_bridge_close(&bridge.bridge_id)
        .expect("close the bridge");

    // The client sees a clean FIN, not a hang.
    let mut trailing = Vec::new();
    let read = tokio::time::timeout(WAIT, client.read_to_end(&mut trailing))
        .await
        .expect("the local socket closes before the timeout");
    assert_eq!(read.expect("read to end"), trailing.len());

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await,
        "closing emits exactly one event"
    );
    assert_eq!(
        emitter.close_reason(&bridge.bridge_id).as_deref(),
        Some("Closed by the client")
    );
    assert!(service.vnc_bridges().is_empty());

    // Closing again reports the bridge as unknown; treat that as already-closed.
    let error = service
        .vnc_bridge_close(&bridge.bridge_id)
        .expect_err("a closed bridge is unknown");
    assert!(error.to_string().contains("Unknown Proxmox VNC bridge"));
    // …and no second event is emitted.
    assert_eq!(emitter.closed().len(), 1);
}

#[tokio::test]
async fn the_bridge_closes_when_the_local_client_goes_away() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let client = attach(bridge.local_port).await;
    drop(client);

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await,
        "a vanished client tears the bridge down"
    );
    assert_eq!(
        emitter.close_reason(&bridge.bridge_id).as_deref(),
        Some("The VNC client disconnected")
    );
    assert!(service.vnc_bridges().is_empty());
}

#[tokio::test]
async fn an_attached_bridge_closes_after_the_idle_deadline() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected_with(&mock, |emitter| {
        VncBridgeRegistry::new(Some(emitter)).with_timeouts(WAIT, Duration::from_millis(300))
    })
    .await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let _client = attach(bridge.local_port).await;

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await,
        "silence on both sides ends the bridge"
    );
    let reason = emitter.close_reason(&bridge.bridge_id).expect("a reason");
    assert!(
        reason.contains("without traffic"),
        "unexpected reason: {reason}"
    );
    assert!(service.vnc_bridges().is_empty());
}

#[tokio::test]
async fn proxmox_closing_the_websocket_closes_the_bridge() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open a VNC bridge");
    let mut client = attach(bridge.local_port).await;

    mock.close_vnc("vm stopped");

    let mut trailing = Vec::new();
    tokio::time::timeout(WAIT, client.read_to_end(&mut trailing))
        .await
        .expect("the local socket closes before the timeout")
        .expect("read to end");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await
    );
    assert_eq!(
        emitter.close_reason(&bridge.bridge_id).as_deref(),
        Some("vm stopped"),
        "the server's close reason is passed through"
    );
    assert!(service.vnc_bridges().is_empty());
}

#[tokio::test]
async fn a_rejected_upgrade_closes_the_bridge_with_the_reason() {
    let mock = MockPve::start().await;
    let (service, emitter) = connected(&mock).await;
    mock.state().vnc_reject_upgrade = true;

    let bridge = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("the ticket still issues; the upgrade is what fails");

    // The client attaches, but the greeting never comes: the upgrade is refused.
    let mut client = TcpStream::connect(("127.0.0.1", bridge.local_port))
        .await
        .expect("connect to the bridge port");
    let mut buffer = Vec::new();
    tokio::time::timeout(WAIT, client.read_to_end(&mut buffer))
        .await
        .expect("the local socket closes before the timeout")
        .expect("read to end");
    assert!(buffer.is_empty(), "no RFB bytes were ever produced");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 1)
            .await
    );
    let reason = emitter.close_reason(&bridge.bridge_id).expect("a reason");
    assert!(
        reason.contains("Proxmox rejected the VNC ticket"),
        "unexpected reason: {reason}"
    );
    assert!(service.vnc_bridges().is_empty());
}

#[tokio::test]
async fn disconnecting_closes_every_bridge() {
    let mock = MockPve::start().await;
    let (mut service, emitter) = connected(&mock).await;

    let first = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("open the first bridge");
    let second = service
        .vnc_bridge_open(MOCK_NODE, None, Some("node"))
        .await
        .expect("open a node-shell bridge");
    assert_eq!(second.vmid, None);
    assert_eq!(second.vm_type, "node");
    assert_eq!(service.vnc_bridges().len(), 2);

    let mut client = attach(first.local_port).await;

    service.disconnect().await.expect("disconnect");
    assert!(service.vnc_bridges().is_empty(), "the registry is drained");

    assert!(
        emitter
            .wait_for(WAIT, |emitter| emitter.closed().len() == 2)
            .await,
        "one event per bridge"
    );
    for bridge in [&first, &second] {
        assert_eq!(
            emitter.close_reason(&bridge.bridge_id).as_deref(),
            Some("Disconnected from Proxmox VE")
        );
    }

    // The attached client is dropped with the session.
    let mut trailing = Vec::new();
    tokio::time::timeout(WAIT, client.read_to_end(&mut trailing))
        .await
        .expect("the local socket closes before the timeout")
        .expect("read to end");
}

// ── Guard rails ──────────────────────────────────────────────────────

#[tokio::test]
async fn the_registry_refuses_more_bridges_than_its_limit() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected_with(&mock, |emitter| {
        VncBridgeRegistry::with_limit(Some(emitter), 1).with_timeouts(WAIT, WAIT)
    })
    .await;

    service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect("the first bridge fits");
    let error = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect_err("the second exceeds the limit");
    assert!(
        error
            .to_string()
            .contains("Too many open Proxmox VNC bridges (limit 1)"),
        "unexpected error: {error}"
    );
    assert_eq!(service.vnc_bridges().len(), 1);
}

#[tokio::test]
async fn the_shipped_ceilings_are_the_documented_ones() {
    let service = ProxmoxService::new();
    let registry = service.vnc_bridge_registry();
    assert_eq!(registry.max_bridges(), MAX_VNC_BRIDGES);
    assert_eq!(MAX_VNC_BRIDGES, 8);
    assert_eq!(ACCEPT_TIMEOUT, Duration::from_secs(10));
    assert_eq!(IDLE_TIMEOUT, Duration::from_secs(600));
    assert!(registry.is_empty());
}

#[tokio::test]
async fn opening_a_bridge_without_a_connection_fails() {
    let service = ProxmoxService::new();
    let error = service
        .vnc_bridge_open(MOCK_NODE, Some(MOCK_VMID), Some("qemu"))
        .await
        .expect_err("a bridge needs a session");
    assert!(
        error.to_string().contains("Not connected to Proxmox VE"),
        "unexpected error: {error}"
    );
    assert!(service.vnc_bridges().is_empty());
}

#[tokio::test]
async fn a_node_name_that_could_escape_the_api_path_is_rejected() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    for node in ["..", "a/b", "../../access/ticket", "pve mock"] {
        let error = service
            .vnc_bridge_open(node, Some(MOCK_VMID), Some("qemu"))
            .await
            .expect_err("node {node} must be rejected");
        assert!(
            error.to_string().contains("Invalid Proxmox node name"),
            "unexpected error for {node:?}: {error}"
        );
    }
    // Nothing reached the server and no port was opened.
    assert!(service.vnc_bridges().is_empty());
    assert_eq!(mock.state().vnc_issued, 0);
}

#[tokio::test]
async fn a_guest_bridge_requires_a_vmid() {
    let mock = MockPve::start().await;
    let (service, _emitter) = connected(&mock).await;

    let error = service
        .vnc_bridge_open(MOCK_NODE, None, Some("qemu"))
        .await
        .expect_err("a guest console needs a vmid");
    assert!(
        error.to_string().contains("requires a vmid"),
        "unexpected error: {error}"
    );
    assert_eq!(mock.state().vnc_issued, 0);
}
