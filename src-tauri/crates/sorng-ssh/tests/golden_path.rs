//! t3-e6 — SSH golden-path smoke test against the openssh docker in
//! `e2e/docker-compose.yml` (service `test-ssh`, host port 2222).
//!
//! Behaviour:
//!   connect  →  exec `echo sorng-golden-path`  →  disconnect
//!
//! Gated behind `#[ignore]` **and** the `docker-e2e` Cargo feature so CI has
//! to opt in explicitly. Locally run with:
//!
//! ```text
//! docker compose -f e2e/docker-compose.yml up -d test-ssh
//! SSH_USER=testuser SSH_PASSWORD=testpass \
//!   cargo test -p sorng-ssh --features docker-e2e --test golden_path -- --ignored
//! ```
//!
//! Without the feature, this file compiles to an empty test binary so it is
//! always part of `cargo check -p sorng-ssh`.

#![cfg(feature = "docker-e2e")]

use sorng_ssh::ssh::service::{connect_ssh_on_state, disconnect_ssh_on_state, SshService};
use ssh2::{MethodType, Session};
#[path = "common/ssh_config.rs"]
mod fixture;
use fixture::test_config;

#[test]
fn fixture_fallback_kex_is_supported_by_linked_libssh2() {
    let session = Session::new().expect("create libssh2 session");
    let algorithms = session
        .supported_algs(MethodType::Kex)
        .expect("enumerate linked libssh2 KEX algorithms");

    assert!(
        algorithms.contains(&"diffie-hellman-group16-sha512"),
        "the Docker SSH fixture fallback must overlap with linked libssh2; supported: {algorithms:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires `docker compose up test-ssh` on port 2222; opt in via --features docker-e2e"]
async fn ssh_connect_exec_disconnect_golden_path() {
    let state = SshService::new();

    // ── connect ──────────────────────────────────────────────────────────
    let session_id = connect_ssh_on_state(&state, test_config())
        .await
        .expect("SSH connect failed — is the openssh docker container up on :2222?");
    assert!(!session_id.is_empty(), "expected non-empty session id");

    // ── exec ─────────────────────────────────────────────────────────────
    let output = state
        .lock()
        .await
        .execute_command(
            &session_id,
            "echo sorng-golden-path".to_string(),
            Some(10_000),
        )
        .await
        .expect("exec of `echo` failed");
    assert!(
        output.contains("sorng-golden-path"),
        "unexpected exec output: {output:?}"
    );

    // ── disconnect ───────────────────────────────────────────────────────
    disconnect_ssh_on_state(&state, &session_id)
        .await
        .expect("disconnect failed");
    assert!(
        !state.lock().await.sessions.contains_key(&session_id),
        "session should be gone after disconnect"
    );
}
