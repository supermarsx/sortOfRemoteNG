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

use sorng_ssh::ssh::service::SshService;
use sorng_ssh::ssh::types::{SshCompressionConfig, SshConnectionConfig};
use std::collections::HashMap;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn test_config() -> SshConnectionConfig {
    SshConnectionConfig {
        host: env_or("SSH_HOST", "127.0.0.1"),
        port: env_or("SSH_PORT", "2222").parse().unwrap_or(2222),
        username: env_or("SSH_USER", "testuser"),
        password: Some(env_or("SSH_PASSWORD", "testpass")),
        private_key_path: None,
        private_key_passphrase: None,
        jump_hosts: Vec::new(),
        proxy_config: None,
        proxy_chain: None,
        mixed_chain: None,
        openvpn_config: None,
        connect_timeout: Some(15),
        keep_alive_interval: None,
        strict_host_key_checking: false,
        known_hosts_path: None,
        totp_secret: None,
        keyboard_interactive_responses: Vec::new(),
        agent_forwarding: false,
        tcp_no_delay: true,
        tcp_keepalive: true,
        keepalive_probes: 3,
        ip_protocol: "any".to_string(),
        compression: false,
        compression_level: 6,
        compression_config: SshCompressionConfig::default(),
        ssh_version: "2".to_string(),
        preferred_ciphers: Vec::new(),
        preferred_macs: Vec::new(),
        preferred_kex: Vec::new(),
        preferred_host_key_algorithms: Vec::new(),
        x11_forwarding: None,
        proxy_command: None,
        pty_type: None,
        environment: HashMap::new(),
        sk_auth: false,
        sk_device_path: None,
        sk_pin: None,
        sk_application: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires `docker compose up test-ssh` on port 2222; opt in via --features docker-e2e"]
async fn ssh_connect_exec_disconnect_golden_path() {
    let state = SshService::new();
    let mut svc = state.lock().await;

    // ── connect ──────────────────────────────────────────────────────────
    let session_id = svc
        .connect_ssh(test_config())
        .await
        .expect("SSH connect failed — is the openssh docker container up on :2222?");
    assert!(!session_id.is_empty(), "expected non-empty session id");

    // ── exec ─────────────────────────────────────────────────────────────
    let output = svc
        .execute_command(&session_id, "echo sorng-golden-path".to_string(), Some(10_000))
        .await
        .expect("exec of `echo` failed");
    assert!(
        output.contains("sorng-golden-path"),
        "unexpected exec output: {output:?}"
    );

    // ── disconnect ───────────────────────────────────────────────────────
    svc.disconnect_ssh(&session_id)
        .await
        .expect("disconnect failed");
    assert!(
        !svc.sessions.contains_key(&session_id),
        "session should be gone after disconnect"
    );
}
