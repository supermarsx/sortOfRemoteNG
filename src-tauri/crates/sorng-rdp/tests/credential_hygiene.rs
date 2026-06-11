use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use secrecy::{CloneableSecret, DebugSecret, ExposeSecret, Secret, SecretString, Zeroize};
use sorng_rdp::rdp::cert_trust::security_error_lifecycle_summary;
use sorng_rdp::rdp::session_state::{ChannelSummary, FrameFlowSummary};
use sorng_rdp::rdp::stats::RdpSessionStats;
use sorng_rdp::rdp::types::{RdpActiveConnection, RdpSession, RdpStatsEvent};
use sorng_rdp::rdp::wake_channel::create_wake_channel;

const SENSITIVE_MARKERS: &[&str] = &[
    "super-secret",
    "LAB\\alice",
    "alice@example.com",
    "domain=LAB",
    "token=abc123",
    "-----BEGIN CERTIFICATE-----",
    "C:\\Users\\Alice\\secret.txt",
    "de ad be ef",
];

fn assert_no_sensitive_markers(encoded: &str) {
    for marker in SENSITIVE_MARKERS {
        assert!(
            !encoded.contains(marker),
            "sensitive marker {marker:?} leaked in {encoded}"
        );
    }
}

#[derive(Clone)]
struct ZeroizeSpy {
    bytes: [u8; 12],
    snapshot: Arc<Mutex<Vec<u8>>>,
    zeroized: Arc<AtomicBool>,
}

impl ZeroizeSpy {
    fn new(snapshot: Arc<Mutex<Vec<u8>>>, zeroized: Arc<AtomicBool>) -> Self {
        Self {
            bytes: *b"super-secret",
            snapshot,
            zeroized,
        }
    }
}

impl Zeroize for ZeroizeSpy {
    fn zeroize(&mut self) {
        self.bytes.zeroize();
        *self.snapshot.lock().expect("snapshot lock") = self.bytes.to_vec();
        self.zeroized.store(true, Ordering::SeqCst);
    }
}

impl CloneableSecret for ZeroizeSpy {}
impl DebugSecret for ZeroizeSpy {}

fn test_session() -> RdpSession {
    RdpSession {
        id: "session-1".to_string(),
        connection_id: Some("connection-1".to_string()),
        host: "rdp.example.com".to_string(),
        port: 3389,
        username: "demo".to_string(),
        connected: true,
        desktop_width: 1280,
        desktop_height: 720,
        server_cert_fingerprint: None,
        viewer_attached: true,
        reconnect_count: 0,
        reconnecting: false,
    }
}

#[test]
fn cached_password_field_uses_secret_string_and_redacts_debug() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");

    runtime.block_on(async {
        let (cmd_tx, _cmd_rx) = create_wake_channel().expect("wake channel");
        let connection = RdpActiveConnection {
            session: test_session(),
            cmd_tx,
            stats: Arc::new(RdpSessionStats::new()),
            _handle: tokio::spawn(async {}),
            cached_password: SecretString::new("super-secret".to_string()),
            cached_domain: Some("LAB".to_string()),
        };

        let debug = format!("{:?}", connection.cached_password);

        assert!(
            debug.contains("REDACTED"),
            "debug output should redact secrets"
        );
        assert!(
            !debug.contains("super-secret"),
            "debug output must not contain the cached password"
        );
        assert_eq!(connection.cached_password.expose_secret(), "super-secret");

        connection._handle.abort();
        drop(connection);
    });
}

#[test]
fn secret_backed_password_storage_zeroizes_on_drop() {
    let snapshot = Arc::new(Mutex::new(Vec::new()));
    let zeroized = Arc::new(AtomicBool::new(false));
    let secret = Secret::new(ZeroizeSpy::new(
        Arc::clone(&snapshot),
        Arc::clone(&zeroized),
    ));

    let debug = format!("{:?}", secret);
    assert!(
        debug.contains("REDACTED"),
        "debug output should stay redacted"
    );
    assert!(
        !debug.contains("super-secret"),
        "debug output must not leak the stored secret"
    );

    drop(secret);

    assert!(
        zeroized.load(Ordering::SeqCst),
        "dropping the secret wrapper should invoke zeroize"
    );
    assert_eq!(
        *snapshot.lock().expect("snapshot lock"),
        vec![0; "super-secret".len()],
        "zeroize should overwrite the secret bytes before drop completes"
    );
}

#[test]
fn stats_and_lifecycle_snapshots_are_summary_only() {
    let stats = RdpSessionStats::new();
    stats.set_phase("active");
    stats.record_frame();
    stats.set_channel_summary(ChannelSummary {
        enabled_count: 3,
        ready_count: 2,
        failed_count: 1,
    });
    stats.set_frame_flow_summary(FrameFlowSummary {
        queued_frames: 4,
        delivered_frames: 0,
        dropped_frames: 1,
        coalesced_frames: 0,
        average_render_ms: None,
    });
    stats.set_last_error("auth_rejected");

    let event: RdpStatsEvent = stats.to_event("session-1");
    let event_json = serde_json::to_string(&event).expect("stats event json");
    let lifecycle_json = serde_json::to_string(&event.lifecycle).expect("lifecycle json");

    assert!(event_json.contains("auth_rejected"));
    assert!(lifecycle_json.contains("channelSummary"));
    assert!(lifecycle_json.contains("frameFlowSummary"));
    assert_no_sensitive_markers(&event_json);
    assert_no_sensitive_markers(&lifecycle_json);
}

#[test]
fn diagnostic_security_summaries_do_not_echo_raw_credentials() {
    let raw_error = "CredSSP InvalidToken for LAB\\alice password=super-secret \
                     domain=LAB token=abc123 C:\\Users\\Alice\\secret.txt";
    let summary = security_error_lifecycle_summary(raw_error);
    let detail = serde_json::to_string(&summary).expect("summary json");
    let step = sorng_rdp::rdp::DiagnosticStep {
        name: "Security".to_string(),
        status: "fail".to_string(),
        message: summary.outcome.clone(),
        duration_ms: 0,
        detail: Some(detail),
    };

    let encoded = serde_json::to_string(&step).expect("diagnostic step json");

    assert!(encoded.contains("auth_rejected"));
    assert_no_sensitive_markers(&encoded);
}
