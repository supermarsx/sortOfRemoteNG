//! t23-e3 — SSH3 golden-path smoke test against a live `ssh3` (HTTP/3 over
//! QUIC) server.
//!
//! Behaviour mirrors the classic SSH `tests/golden_path.rs` shape:
//!   connect (QUIC + HTTP/3 + HTTP `Authorization` auth)
//!     → exec `echo sorng-ssh3-golden`
//!     → disconnect (graceful QUIC close)
//!
//! Gated behind `#[ignore]` **and** the `ssh3-live-e2e` Cargo feature so CI has
//! to opt in explicitly (there is no `ssh3` server in CI). Without the feature
//! this file compiles to an empty test binary, so it is always part of
//! `cargo check -p sorng-ssh`.
//!
//! ## Running against a real server
//!
//! SSH3's reference server is the upstream Go project `francoismichel/ssh3`.
//! Bring one up (pin a known tag), then point this test at it via env vars:
//!
//! ```text
//! # Example: run the upstream ssh3 server with a self-signed cert + a test
//! # user that accepts password auth, listening on UDP/443 (or any port).
//! #   (see https://github.com/francoismichel/ssh3 for server setup)
//!
//! SSH3_TEST_HOST=127.0.0.1 \
//! SSH3_TEST_PORT=443 \
//! SSH3_TEST_USER=testuser \
//! SSH3_TEST_PASSWORD=testpass \
//! SSH3_TEST_VERIFY_CERT=false \
//!   cargo test -p sorng-ssh --features ssh3-live-e2e \
//!     --test ssh3_golden_path -- --ignored --nocapture
//! ```
//!
//! `SSH3_TEST_VERIFY_CERT=false` installs the dev skip-verify TLS verifier for
//! self-signed test servers (mirrors the classic golden path's
//! `strict_host_key_checking: false`). Set it to `true` against a server with a
//! cert chained to a system-trusted CA.
//!
//! ## Wire-format caveat (read before debugging a failure)
//!
//! SSH3 conveys the command over the HTTP layer of the conversation. This client
//! carries it both as the `x-ssh3-command` request header and in the request
//! body (see `ssh3/session.rs::build_exec_request`). If the pinned server
//! expects a different header name or a different conversation framing, that one
//! constant (`SSH3_COMMAND_HEADER`) plus the request body are the knobs to
//! adjust — they are deliberately isolated so this test documents the exact
//! interop surface. Also note (t23-e2 log) that h3 0.0.8 cannot emit the
//! `:protocol = ssh3` extended-CONNECT pseudo-header, so a strict server may
//! reject the plain CONNECT until e6 lands the extended-CONNECT support; this
//! test is the harness that proves it end-to-end once that is in place.

#![cfg(feature = "ssh3-live-e2e")]

use sorng_ssh::ssh3::{Ssh3ConnectionConfig, Ssh3Service};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn test_config() -> Ssh3ConnectionConfig {
    let verify = env_or("SSH3_TEST_VERIFY_CERT", "false")
        .eq_ignore_ascii_case("true");
    Ssh3ConnectionConfig {
        host: env_or("SSH3_TEST_HOST", "127.0.0.1"),
        port: env_or("SSH3_TEST_PORT", "443").parse().unwrap_or(443),
        username: env_or("SSH3_TEST_USER", "testuser"),
        password: Some(env_or("SSH3_TEST_PASSWORD", "testpass")),
        verify_server_cert: verify,
        connect_timeout: Some(15),
        ..Ssh3ConnectionConfig::default()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a live ssh3 (HTTP/3/QUIC) server; opt in via --features ssh3-live-e2e and SSH3_TEST_* env vars"]
async fn ssh3_connect_exec_disconnect_golden_path() {
    let mut svc = Ssh3Service::new();

    // ── connect (QUIC + HTTP/3 + auth) ─────────────────────────────────────
    let session_id = svc
        .connect(test_config())
        .await
        .expect("SSH3 connect+auth failed — is a live ssh3 server reachable on the configured host/port?");
    assert!(!session_id.is_empty(), "expected non-empty session id");

    // session should report alive (Connected + live transport)
    let info = svc
        .get_session_info(&session_id)
        .expect("session info available after connect");
    assert!(info.is_alive, "session should be alive after connect");

    // ── exec ───────────────────────────────────────────────────────────────
    let output = svc
        .execute_command(
            &session_id,
            "echo sorng-ssh3-golden".to_string(),
            Some(15),
        )
        .await
        .expect("SSH3 exec of `echo` failed");
    assert!(
        output.contains("sorng-ssh3-golden"),
        "unexpected SSH3 exec output: {output:?}"
    );

    // ── disconnect (graceful QUIC close) ───────────────────────────────────
    svc.disconnect(&session_id)
        .await
        .expect("SSH3 disconnect failed");
    assert!(
        svc.get_session_info(&session_id).is_err(),
        "session should be gone after disconnect"
    );
}
