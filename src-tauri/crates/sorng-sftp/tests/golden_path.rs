//! t3-e6 — SFTP golden-path smoke test against the openssh docker in
//! `e2e/docker-compose.yml` (service `test-ssh`, host port 2222 — the same
//! container backs both SSH and SFTP since OpenSSH's sftp-server subsystem
//! ships by default).
//!
//! Behaviour:
//!   connect  →  list `/`  →  disconnect
//!
//! Gated behind `#[ignore]` **and** the `docker-e2e` Cargo feature so CI has
//! to opt in explicitly. Locally run with:
//!
//! ```text
//! docker compose -f e2e/docker-compose.yml up -d test-ssh
//! SSH_USER=testuser SSH_PASSWORD=testpass \
//!   cargo test -p sorng-sftp --features docker-e2e --test golden_path -- --ignored
//! ```
//!
//! Without the feature, this file compiles to an empty test binary so it is
//! always part of `cargo check -p sorng-sftp`.

#![cfg(feature = "docker-e2e")]

use sorng_sftp::sftp::service::SftpService;
use sorng_sftp::sftp::types::{
    KnownHostsPolicy, SftpConnectionConfig, SftpListOptions, SftpSortField,
};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn test_config() -> SftpConnectionConfig {
    SftpConnectionConfig {
        host: env_or("SSH_HOST", "127.0.0.1"),
        port: env_or("SSH_PORT", "2222").parse().unwrap_or(2222),
        username: env_or("SSH_USER", "testuser"),
        password: Some(env_or("SSH_PASSWORD", "testpass")),
        private_key_path: None,
        private_key_passphrase: None,
        private_key_data: None,
        use_agent: false,
        known_hosts_policy: KnownHostsPolicy::Ignore,
        timeout_secs: 15,
        keepalive_interval_secs: 0,
        proxy: None,
        banner_callback: false,
        compress: false,
        initial_directory: None,
        label: None,
        color_tag: None,
    }
}

fn list_opts() -> SftpListOptions {
    SftpListOptions {
        include_hidden: true,
        sort_by: SftpSortField::default(),
        ascending: true,
        filter_glob: None,
        filter_type: None,
        recursive: false,
        max_depth: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires `docker compose up test-ssh` on port 2222; opt in via --features docker-e2e"]
async fn sftp_connect_list_disconnect_golden_path() {
    let state = SftpService::new();
    let mut svc = state.lock().await;

    // ── connect ──────────────────────────────────────────────────────────
    let info = svc
        .connect(test_config())
        .await
        .expect("SFTP connect failed — is the openssh docker container up on :2222?");
    assert!(info.connected, "session should report connected = true");
    assert!(!info.id.is_empty(), "expected non-empty session id");

    // ── list a directory we can reasonably expect to exist ────────────────
    // The linuxserver/openssh-server image has the read-only `/fixtures`
    // bind-mount from the compose file, but `/` is always listable and is
    // the safest target for the smoke test.
    let entries = svc
        .list_directory(&info.id, "/", list_opts())
        .await
        .expect("list_directory('/') failed");
    assert!(
        !entries.is_empty(),
        "expected at least one entry under '/', got none"
    );

    // ── disconnect ───────────────────────────────────────────────────────
    svc.disconnect(&info.id).await.expect("disconnect failed");
}
