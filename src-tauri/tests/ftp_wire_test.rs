//! t3-e5 — FTP wiring smoke test.
//!
//! Exercises the `sorng-ftp` service end-to-end (connect → list_directory →
//! disconnect) against a live FTP server. This is a Rust-integration-level
//! smoke test — it calls the same `FtpService` methods that the Tauri
//! `ftp_*` commands delegate to (see
//! `src-tauri/crates/sorng-ftp/src/ftp/commands.rs`), so a PASS here also
//! demonstrates the command surface is wired to working protocol code.
//!
//! Gating: `#[ignore]` by default. Enable with:
//!
//! ```sh
//! # Bring up the vsftpd service defined in `e2e/docker-compose.yml`.
//! cd e2e
//! FTP_USER=test FTP_PASSWORD=test docker compose up -d test-ftp
//!
//! # Point the test at it and un-ignore.
//! cd ..
//! FTP_TEST_HOST=127.0.0.1 \
//! FTP_TEST_PORT=2121 \
//! FTP_TEST_USER=test \
//! FTP_TEST_PASSWORD=test \
//!   cargo test --test ftp_wire_test -- --ignored --nocapture
//! ```
//!
//! If the docker-e2e env vars are not set, the test skips cleanly (still
//! `#[ignore]`-gated, so CI never runs it implicitly). Wire it into nightly
//! e2e via t3-e30's workflow.
//!
//! NOTE: This test lives in `src-tauri/tests/` so it links against the `app`
//! crate's `app_lib`, which re-exports `sorng_ftp::ftp` as `app_lib::ftp`.
//! That path matches the one the Tauri commands use (see
//! `src-tauri/src/ftp_commands.rs`), which keeps this test faithful to what
//! ships.

use app_lib::ftp::service::FtpService;
use app_lib::ftp::types::{FtpConnectionConfig, FtpSecurityMode};

fn env_or_skip(var: &str) -> Option<String> {
    std::env::var(var).ok()
}

/// Build an `FtpConnectionConfig` from `FTP_TEST_*` env vars, or return
/// `None` when the operator hasn't opted in (CI / local dev default).
fn load_test_config() -> Option<FtpConnectionConfig> {
    let host = env_or_skip("FTP_TEST_HOST")?;
    let port: u16 = env_or_skip("FTP_TEST_PORT")
        .and_then(|s| s.parse().ok())
        .unwrap_or(21);
    let username = env_or_skip("FTP_TEST_USER").unwrap_or_else(|| "anonymous".to_string());
    let password =
        env_or_skip("FTP_TEST_PASSWORD").unwrap_or_else(|| "anonymous@example.com".to_string());

    Some(FtpConnectionConfig {
        host,
        port,
        username,
        password,
        security: FtpSecurityMode::None,
        label: Some("t3-e5-smoke".to_string()),
        ..Default::default()
    })
}

#[tokio::test]
#[ignore = "requires a live FTP server — see module docs"]
async fn ftp_list_directory_smoke() {
    let cfg = match load_test_config() {
        Some(c) => c,
        None => {
            eprintln!(
                "SKIP: FTP_TEST_HOST not set — bring up e2e/docker-compose.yml::test-ftp \
                 and export FTP_TEST_HOST/PORT/USER/PASSWORD to run this test."
            );
            return;
        }
    };

    // Same service type the Tauri `ftp_*` commands operate on.
    let state = FtpService::new();

    // connect → session_id
    let session_info = {
        let mut svc = state.lock().await;
        svc.connect(cfg)
            .await
            .expect("ftp_connect against live server")
    };
    let sid = session_info.id.clone();
    assert!(session_info.connected, "server reported connected=false");

    // list_directory (the command the plan singles out)
    let entries = {
        let mut svc = state.lock().await;
        svc.list_directory(&sid, None, None)
            .await
            .expect("ftp_list_directory against live server")
    };
    // vsftpd's default pub dir may be empty — just assert we got a well-typed
    // Vec back; that proves the command + codec path is alive.
    eprintln!("ftp_list_directory returned {} entries", entries.len());

    // disconnect — clean up before the test exits.
    let mut svc = state.lock().await;
    svc.disconnect(&sid)
        .await
        .expect("ftp_disconnect should succeed");
}

/// Additionally verifies the service layer is constructible with no network
/// side effects. Runs in the default `cargo test` pass (no `--ignored`
/// needed), so even without docker we get a minimal compile/link signal
/// that this test file stays in sync with the `app_lib::ftp` surface.
#[tokio::test]
async fn ftp_service_constructs() {
    let state = FtpService::new();
    let svc = state.lock().await;
    assert!(
        svc.list_sessions().await.is_empty(),
        "fresh FtpService should hold zero sessions"
    );
}
