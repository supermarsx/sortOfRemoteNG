use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use secrecy::{CloneableSecret, DebugSecret, ExposeSecret, Secret, SecretString, Zeroize};
use sorng_rdp::rdp::stats::RdpSessionStats;
use sorng_rdp::rdp::types::{RdpActiveConnection, RdpSession};
use sorng_rdp::rdp::wake_channel::create_wake_channel;

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

        assert!(debug.contains("REDACTED"), "debug output should redact secrets");
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
    let secret = Secret::new(ZeroizeSpy::new(Arc::clone(&snapshot), Arc::clone(&zeroized)));

    let debug = format!("{:?}", secret);
    assert!(debug.contains("REDACTED"), "debug output should stay redacted");
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