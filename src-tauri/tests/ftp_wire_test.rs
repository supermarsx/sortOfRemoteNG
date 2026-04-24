//! t3-e5 — FTP construct / wiring smoke.
//!
//! The authoritative live Docker smoke now lives at
//! `crates/sorng-ftp/tests/golden_path.rs`, matching the other protocol crates.
//! This file stays in the app package as a lightweight constructibility check so
//! the app-layer test target still verifies that the FTP crate is reachable from
//! the workspace without dragging a live-network dependency into the default
//! test pass.

use sorng_ftp::ftp::service::FtpService;

/// Additionally verifies the service layer is constructible with no network
/// side effects. Runs in the default `cargo test` pass (no `--ignored`
/// needed), so even without docker we get a minimal compile/link signal.
#[tokio::test]
async fn ftp_service_constructs() {
    let state = FtpService::new();
    let svc = state.lock().await;
    assert!(
        svc.list_sessions().await.is_empty(),
        "fresh FtpService should hold zero sessions"
    );
}
