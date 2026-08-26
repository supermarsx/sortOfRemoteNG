//! t64-e5 — Portainer CE real-container e2e against the `test-portainer`
//! service in `e2e/docker-compose.yml` (host ports 19000 http / 19443 https).
//!
//! Gated behind `#[ignore]` **and** the `docker-e2e` Cargo feature so CI has
//! to opt in explicitly (see `.github/workflows/e2e.yml`, step
//! "Portainer e2e (t64-e5)"). Locally:
//!
//! ```text
//! node scripts/ci/e2e-portainer-fixture.mjs prepare
//! docker compose -f e2e/docker-compose.yml up -d test-portainer
//! node scripts/ci/e2e-portainer-fixture.mjs wait
//! PORTAINER_ADMIN_PASSWORD=portainer-e2e-pass1234 \
//!   cargo test -p sorng-portainer --features docker-e2e --test docker_e2e -- --include-ignored
//! ```
//!
//! Without the feature this file compiles to an empty test binary so it is
//! always part of `cargo check -p sorng-portainer`.
//!
//! Environment:
//! * `PORTAINER_URL` (default `http://127.0.0.1:19000`)
//! * `PORTAINER_TLS_URL` (default `https://127.0.0.1:19443`, self-signed)
//! * `PORTAINER_USER` (default `admin`)
//! * `PORTAINER_ADMIN_PASSWORD` (default `portainer-e2e-pass1234`)
//! * `PORTAINER_EXPECT_LOCAL_ENDPOINT` — set to `0` on rootless/podman hosts
//!   where the docker.sock mount yields no "local" environment.

#![cfg(feature = "docker-e2e")]

use reqwest::Method;
use serde_json::json;
use sorng_portainer::error::PortainerErrorKind;
use sorng_portainer::types::{PortainerAuthMode, PortainerConnectionConfig};
use sorng_portainer::PortainerClient;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn base_url() -> String {
    env_or("PORTAINER_URL", "http://127.0.0.1:19000")
}

fn tls_url() -> String {
    env_or("PORTAINER_TLS_URL", "https://127.0.0.1:19443")
}

fn admin_user() -> String {
    env_or("PORTAINER_USER", "admin")
}

fn admin_password() -> String {
    env_or("PORTAINER_ADMIN_PASSWORD", "portainer-e2e-pass1234")
}

fn expect_local_endpoint() -> bool {
    env_or("PORTAINER_EXPECT_LOCAL_ENDPOINT", "1") != "0"
}

fn password_config(url: &str, skip_tls: bool) -> PortainerConnectionConfig {
    PortainerConnectionConfig {
        base_url: url.to_string(),
        username: Some(admin_user()),
        password: Some(admin_password()),
        api_key: None,
        skip_tls_verify: Some(skip_tls),
        // Ack contract: must equal the *effective* skip flag (https only).
        acknowledge_invalid_cert_risk: skip_tls && url.starts_with("https://"),
        timeout_secs: Some(20),
        proxy_url: None,
    }
}

fn api_key_config(url: &str, key: &str) -> PortainerConnectionConfig {
    PortainerConnectionConfig {
        base_url: url.to_string(),
        username: None,
        password: None,
        api_key: Some(key.to_string()),
        skip_tls_verify: None,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: Some(20),
        proxy_url: None,
    }
}

/// Belt and braces on top of `--admin-password-file`: if the server reports
/// no admin (404 on `/api/users/admin/check`), initialise one.
async fn ensure_admin(url: &str) {
    let http = reqwest::Client::new();
    let check = http
        .get(format!("{url}/api/users/admin/check"))
        .send()
        .await
        .expect("portainer must be reachable (run the fixture `wait` first)");
    if check.status().as_u16() == 404 {
        let init = http
            .post(format!("{url}/api/users/admin/init"))
            .json(&json!({ "Username": admin_user(), "Password": admin_password() }))
            .send()
            .await
            .expect("admin init request");
        assert!(
            init.status().is_success(),
            "admin init failed: HTTP {}",
            init.status()
        );
    }
}

async fn connect_password(url: &str) -> PortainerClient {
    let client = PortainerClient::new(password_config(url, false), None).expect("client build");
    client.login().await.expect("password login");
    client
}

// ── Password login → ping → environments → containers → logs ──────────────

#[tokio::test]
#[ignore]
async fn password_login_ping_reports_version() {
    let url = base_url();
    ensure_admin(&url).await;

    let client = connect_password(&url).await;
    let summary = client.ping().await.expect("ping");
    assert_eq!(summary.auth_mode, PortainerAuthMode::Password);
    let version = summary.version.expect("Version in /api/system/status");
    assert!(
        version.chars().next().is_some_and(|c| c.is_ascii_digit()),
        "unexpected version string {version:?}"
    );
    assert_eq!(summary.user.as_deref(), Some(admin_user().as_str()));
    assert_eq!(summary.role, Some(1), "admin must have role 1");
}

#[tokio::test]
#[ignore]
async fn lists_local_environment_and_portainer_container_with_logs() {
    let url = base_url();
    ensure_admin(&url).await;
    let client = connect_password(&url).await;

    let endpoints = client.list_endpoints().await.expect("list endpoints");
    if !expect_local_endpoint() {
        eprintln!("PORTAINER_EXPECT_LOCAL_ENDPOINT=0: skipping container assertions");
        return;
    }
    assert!(
        !endpoints.is_empty(),
        "docker.sock-backed 'local' environment expected"
    );
    let local = endpoints
        .iter()
        .find(|e| e.url.contains("docker.sock"))
        .unwrap_or(&endpoints[0]);
    assert_eq!(local.status, 1, "local environment must be up");

    let containers = client
        .list_containers(local.id, true)
        .await
        .expect("list containers");
    let portainer = containers
        .iter()
        .find(|c| c.image.contains("portainer") || c.names.iter().any(|n| n.contains("portainer")))
        .expect("the portainer container itself must be listed");
    assert_eq!(portainer.state, "running");

    let lines = client
        .container_logs(local.id, &portainer.id, 50)
        .await
        .expect("container logs");
    assert!(!lines.is_empty(), "portainer writes startup logs");
    assert!(
        lines
            .iter()
            .all(|l| matches!(l.stream.as_str(), "stdout" | "stderr" | "stdin")),
        "demuxed stream labels"
    );

    let stacks = client.list_stacks().await.expect("list stacks");
    // Fresh install: no stacks, but the call must succeed.
    assert!(stacks.iter().all(|s| !s.name.is_empty()));
}

// ── API-key mode ───────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn api_key_generated_via_password_session_authenticates() {
    let url = base_url();
    ensure_admin(&url).await;
    let client = connect_password(&url).await;

    let (status, bytes) = client
        .send_raw(Method::GET, "/users/me", None)
        .await
        .expect("/users/me");
    assert!((200..300).contains(&status), "/users/me HTTP {status}");
    let me: serde_json::Value = serde_json::from_slice(&bytes).expect("users/me json");
    let user_id = me["Id"].as_u64().expect("user id");

    let (status, bytes) = client
        .send_raw(
            Method::POST,
            &format!("/users/{user_id}/tokens"),
            Some(json!({
                "description": format!("sorng-e2e-{}", chrono::Utc::now().timestamp()),
                "password": admin_password(),
            })),
        )
        .await
        .expect("create access token");
    assert!((200..300).contains(&status), "token create HTTP {status}");
    let token: serde_json::Value = serde_json::from_slice(&bytes).expect("token json");
    let raw_key = token["rawAPIKey"].as_str().expect("rawAPIKey").to_string();
    assert!(raw_key.starts_with("ptr_"), "unexpected key shape");

    let key_client = PortainerClient::new(api_key_config(&url, &raw_key), None).expect("client");
    let summary = key_client.ping().await.expect("api-key ping");
    assert_eq!(summary.auth_mode, PortainerAuthMode::ApiKey);
    assert!(summary.version.is_some());
    let endpoints = key_client
        .list_endpoints()
        .await
        .expect("endpoints via api key");
    if expect_local_endpoint() {
        assert!(!endpoints.is_empty());
    }

    // Wrong key → AuthenticationFailed, no retry loop.
    let bad =
        PortainerClient::new(api_key_config(&url, "ptr_definitely-invalid"), None).expect("client");
    let err = bad.list_endpoints().await.expect_err("bad key must fail");
    assert_eq!(err.kind, PortainerErrorKind::AuthenticationFailed);
}

#[tokio::test]
#[ignore]
async fn wrong_password_is_authentication_failed() {
    let url = base_url();
    ensure_admin(&url).await;
    let mut cfg = password_config(&url, false);
    cfg.password = Some("definitely-not-the-password".into());
    let client = PortainerClient::new(cfg, None).expect("client");
    let err = client.login().await.expect_err("wrong password must fail");
    assert_eq!(err.kind, PortainerErrorKind::AuthenticationFailed);
}

// ── TLS: self-signed :9443 is rejected unless skip+ack ─────────────────────

#[tokio::test]
#[ignore]
async fn self_signed_tls_requires_skip_and_ack() {
    let url = tls_url();
    ensure_admin(&base_url()).await;

    let strict = PortainerClient::new(password_config(&url, false), None).expect("client");
    let err = strict
        .ping()
        .await
        .expect_err("self-signed cert must be rejected without skip");
    assert_eq!(err.kind, PortainerErrorKind::TlsUntrusted, "got {err:?}");

    let relaxed = PortainerClient::new(password_config(&url, true), None).expect("client");
    let summary = relaxed.ping().await.expect("skip+ack must succeed");
    assert!(summary.version.is_some());

    // skip without ack is a config error before any request.
    let mut cfg = password_config(&url, true);
    cfg.acknowledge_invalid_cert_risk = false;
    let err = PortainerClient::new(cfg, None).expect_err("skip without ack");
    assert_eq!(err.kind, PortainerErrorKind::ConfigError);
}
