//! t4 follow-up — FTP golden-path smoke test against the Docker `test-ftp`
//! service defined in `e2e/docker-compose.yml`.
//!
//! Behaviour:
//!   connect  →  list current directory  →  disconnect
//!
//! Gated behind `#[ignore]` and the `docker-e2e` feature so CI and local
//! operators opt in explicitly.

#![cfg(feature = "docker-e2e")]

use sorng_ftp::ftp::service::FtpService;
use sorng_ftp::ftp::types::{FtpConnectionConfig, FtpSecurityMode};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn test_config() -> FtpConnectionConfig {
    FtpConnectionConfig {
        host: env_or("FTP_TEST_HOST", "127.0.0.1"),
        port: env_or("FTP_TEST_PORT", "2121").parse().unwrap_or(2121),
        username: env_or("FTP_TEST_USER", "testuser"),
        password: env_or("FTP_TEST_PASSWORD", "testpass"),
        security: FtpSecurityMode::None,
        label: Some("docker-e2e-ftp".to_string()),
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "requires `docker compose up test-ftp` on port 2121; opt in via --features docker-e2e"]
async fn ftp_connect_list_disconnect_golden_path() {
    let state = FtpService::new();

    let session = {
        let mut svc = state.lock().await;
        svc.connect(test_config())
            .await
            .expect("FTP connect failed — is the test-ftp container up on :2121?")
    };

    assert!(session.connected, "session should report connected = true");
    assert!(!session.id.is_empty(), "expected non-empty session id");

    let entries = {
        let mut svc = state.lock().await;
        svc.list_directory(&session.id, None, None)
            .await
            .expect("list_directory failed")
    };

    assert!(
        entries.iter().all(|entry| !entry.name.is_empty()),
        "expected all listed FTP entries to have names"
    );

    let mut svc = state.lock().await;
    svc.disconnect(&session.id)
        .await
        .expect("disconnect failed");
}