//! t65-e5 — Nginx Proxy Manager real-container e2e against the `test-npm`
//! service in `e2e/docker-compose.yml` (host port 18181 → container 81).
//!
//! Gated behind `#[ignore]` **and** the `docker-e2e` Cargo feature so CI has
//! to opt in explicitly (see `.github/workflows/e2e.yml`, step
//! "Nginx Proxy Manager e2e (t65-e5)"). Locally:
//!
//! ```text
//! node scripts/ci/e2e-npm-fixture.mjs prepare
//! docker compose -f e2e/docker-compose.yml --env-file e2e/.env up -d test-npm
//! node scripts/ci/e2e-npm-fixture.mjs wait
//! NPM_ADMIN_PASSWORD=npm-e2e-pass1234 \
//!   cargo test -p sorng-nginx-proxy-mgr --features docker-e2e --test docker_e2e -- --include-ignored
//! ```
//!
//! Without the feature this file compiles to an empty test binary so it is
//! always part of `cargo check -p sorng-nginx-proxy-mgr`.
//!
//! Environment:
//! * `NPM_URL` (default `http://127.0.0.1:18181`)
//! * `NPM_ADMIN_EMAIL` (default `admin@example.com`)
//! * `NPM_ADMIN_PASSWORD` (default `npm-e2e-pass1234`)
//!
//! Every test provisions its own connection id, so the suite is safe under
//! `--test-threads=1` (how the workflow runs it) and mostly safe in parallel;
//! only `proxy_host_lifecycle` mutates server state and it cleans up after
//! itself with a uniquely named domain.

#![cfg(feature = "docker-e2e")]

use sorng_nginx_proxy_mgr::client::NpmClient;
use sorng_nginx_proxy_mgr::error::NpmErrorKind;
use sorng_nginx_proxy_mgr::service::NpmService;
use sorng_nginx_proxy_mgr::types::{CreateProxyHostRequest, NpmConnectionConfig};

/// NPM's factory admin, used only by the forced-password-change fallback.
const FACTORY_EMAIL: &str = "admin@example.com";
const FACTORY_PASSWORD: &str = "changeme";

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn base_url() -> String {
    env_or("NPM_URL", "http://127.0.0.1:18181")
}

fn admin_email() -> String {
    env_or("NPM_ADMIN_EMAIL", "admin@example.com")
}

fn admin_password() -> String {
    env_or("NPM_ADMIN_PASSWORD", "npm-e2e-pass1234")
}

fn password_config(url: &str) -> NpmConnectionConfig {
    NpmConnectionConfig {
        api_url: url.to_string(),
        email: Some(admin_email()),
        password: Some(admin_password()),
        token: None,
        skip_tls_verify: None,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: Some(20),
        proxy_url: None,
    }
}

fn token_config(url: &str, token: &str) -> NpmConnectionConfig {
    NpmConnectionConfig {
        api_url: url.to_string(),
        email: None,
        password: None,
        token: Some(token.to_string()),
        skip_tls_verify: None,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: Some(20),
        proxy_url: None,
    }
}

/// Raw `POST /api/tokens`; `Ok(None)` for a rejected credential pair.
async fn raw_login(
    http: &reqwest::Client,
    url: &str,
    identity: &str,
    secret: &str,
) -> Option<String> {
    let response = http
        .post(format!("{url}/api/tokens"))
        .json(&serde_json::json!({ "identity": identity, "secret": secret }))
        .send()
        .await
        .expect("nginx proxy manager must be reachable (run the fixture `wait` first)");
    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = response.json().await.expect("tokens json");
    body["token"].as_str().map(str::to_string)
}

/// Belt and braces on top of `INITIAL_ADMIN_*`: image tags that ignore those
/// env vars create the factory account and force a password change. Bring it
/// in line with `NPM_ADMIN_EMAIL` / `NPM_ADMIN_PASSWORD` so the rest of the
/// suite can just log in. Mirrors `scripts/ci/e2e-npm-fixture.mjs wait`, and
/// is a no-op once that has run.
async fn ensure_admin(url: &str) {
    let http = reqwest::Client::new();
    if raw_login(&http, url, &admin_email(), &admin_password())
        .await
        .is_some()
    {
        return;
    }

    // `setup: false` = the instance has no user at all (started without
    // INITIAL_ADMIN_*). NPM accepts an unauthenticated POST /api/users while
    // setup is incomplete.
    let status: serde_json::Value = http
        .get(format!("{url}/api/"))
        .send()
        .await
        .expect("nginx proxy manager must be reachable (run the fixture `wait` first)")
        .json()
        .await
        .expect("GET /api/ json");
    if status["setup"] == serde_json::Value::Bool(false) {
        let created = http
            .post(format!("{url}/api/users"))
            .json(&serde_json::json!({
                "name": "Administrator",
                "nickname": "Admin",
                "email": admin_email(),
                "roles": ["admin"],
                "is_disabled": false,
                "auth": { "type": "password", "secret": admin_password() },
            }))
            .send()
            .await
            .expect("first-admin request");
        assert!(
            created.status().is_success(),
            "creating the first admin failed: HTTP {}",
            created.status()
        );
        return;
    }

    let token = raw_login(&http, url, FACTORY_EMAIL, FACTORY_PASSWORD)
        .await
        .expect("neither the configured nor the factory admin credentials were accepted");

    let me: serde_json::Value = http
        .get(format!("{url}/api/users/me"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("users/me request")
        .json()
        .await
        .expect("users/me json");
    let user_id = me["id"].as_u64().expect("admin user id");

    if me["email"].as_str() != Some(admin_email().as_str()) {
        let renamed = http
            .put(format!("{url}/api/users/{user_id}"))
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "email": admin_email(),
                "name": me["name"].as_str().unwrap_or("Administrator"),
                "nickname": me["nickname"].as_str().unwrap_or("Admin"),
            }))
            .send()
            .await
            .expect("rename admin request");
        assert!(
            renamed.status().is_success(),
            "renaming the factory admin failed: HTTP {}",
            renamed.status()
        );
    }

    let changed = http
        .put(format!("{url}/api/users/{user_id}/auth"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "type": "password",
            "current": FACTORY_PASSWORD,
            "secret": admin_password(),
        }))
        .send()
        .await
        .expect("password change request");
    assert!(
        changed.status().is_success(),
        "forced password change failed: HTTP {}",
        changed.status()
    );
}

/// A connected `NpmService` holding one password-mode connection under `id`.
async fn connected_service(id: &str) -> NpmService {
    let url = base_url();
    ensure_admin(&url).await;
    let mut service = NpmService::new();
    service
        .connect(id.to_string(), password_config(&url))
        .await
        .expect("password connect");
    service
}

// ── Login / ping ───────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn password_login_ping_reports_version_and_user() {
    let service = connected_service("e2e-ping").await;

    let summary = service.ping("e2e-ping").await.expect("ping");
    assert_eq!(summary.auth_mode, "password");
    assert_eq!(summary.api_url, base_url());
    assert_eq!(summary.user.as_deref(), Some(admin_email().as_str()));

    let version = summary.version.expect("GET /api/ must report a version");
    let parts: Vec<&str> = version.split('.').collect();
    assert_eq!(parts.len(), 3, "unexpected version string {version:?}");
    assert!(
        parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())),
        "unexpected version string {version:?}"
    );

    assert!(
        summary.token_expires_at.is_some(),
        "a login token carries an `expires` timestamp"
    );
    assert!(
        summary.roles.iter().any(|r| r == "admin"),
        "the fixture account is an admin, got roles {:?}",
        summary.roles
    );
}

/// Regression guard for a t65-e5 finding: NPM answers a bad password with
/// **HTTP 400** — `{"error":{"code":400,"message":"Invalid email or password",
/// "message_i18n":"error.invalid-auth"}}` — not 401. Before t65-e1 taught
/// `NpmError::from_status` to recognise `error.invalid-auth`, that mapped to
/// `HttpError` and the panel showed a generic HTTP error instead of "wrong
/// credentials".
#[tokio::test]
#[ignore]
async fn wrong_password_is_authentication_failed() {
    let url = base_url();
    ensure_admin(&url).await;

    let mut config = password_config(&url);
    config.password = Some("definitely-not-the-password".to_string());

    let mut service = NpmService::new();
    let error = service
        .connect("e2e-bad-password".to_string(), config)
        .await
        .expect_err("a wrong password must be rejected");
    assert_eq!(error.kind, NpmErrorKind::AuthenticationFailed);
}

#[tokio::test]
#[ignore]
async fn missing_credentials_is_a_config_error() {
    let url = base_url();
    let mut config = password_config(&url);
    config.email = None;
    config.password = None;

    let mut service = NpmService::new();
    let error = service
        .connect("e2e-no-creds".to_string(), config)
        .await
        .expect_err("neither password nor token must be refused");
    assert_eq!(error.kind, NpmErrorKind::ConfigError);
}

// ── Token lifecycle ────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn refresh_token_issues_a_new_token() {
    let url = base_url();
    ensure_admin(&url).await;

    let client = NpmClient::new(password_config(&url)).expect("client build");
    client.login().await.expect("login");
    let first = client.current_token().await.expect("token after login");
    let first_expiry = client.token_expires_at().await.expect("expiry after login");

    client.refresh_token().await.expect("refresh");
    let second = client.current_token().await.expect("token after refresh");
    let second_expiry = client
        .token_expires_at()
        .await
        .expect("expiry after refresh");

    assert_ne!(first, second, "GET /api/tokens must mint a new token");
    assert!(
        second_expiry >= first_expiry,
        "refreshed expiry {second_expiry} went backwards from {first_expiry}"
    );

    // The refreshed token must actually be usable.
    let summary = client.ping().await.expect("ping with the refreshed token");
    assert_eq!(summary.user.as_deref(), Some(admin_email().as_str()));
}

#[tokio::test]
#[ignore]
async fn token_mode_connects_with_a_token_minted_by_password_login() {
    let url = base_url();
    ensure_admin(&url).await;

    let password_client = NpmClient::new(password_config(&url)).expect("client build");
    password_client.login().await.expect("login");
    let token = password_client.current_token().await.expect("token");

    let mut service = NpmService::new();
    let summary = service
        .connect("e2e-token".to_string(), token_config(&url, &token))
        .await
        .expect("token-mode connect");
    assert_eq!(summary.auth_mode, "token");
    assert_eq!(summary.user.as_deref(), Some(admin_email().as_str()));

    service.disconnect("e2e-token").await.expect("disconnect");
    assert!(service.list_connections().is_empty());
}

#[tokio::test]
#[ignore]
async fn token_mode_rejects_a_bogus_token() {
    let url = base_url();
    ensure_admin(&url).await;

    let mut service = NpmService::new();
    let error = service
        .connect(
            "e2e-bogus-token".to_string(),
            token_config(&url, "not-a-real-jwt"),
        )
        .await
        .expect_err("a bogus bearer token must be rejected");
    // NPM itself answers a malformed bearer token with HTTP **500**
    // (`{"error":{"code":500,"message":"Internal Error"}}`), not 401 — verified
    // against 2.15.1 — so the single-retry / `TokenExpired` path never engages
    // and the kind is `HttpError`. That is NPM's behaviour, not the crate's, so
    // accept it; what matters is that the connection is refused rather than
    // reported as established.
    assert!(
        matches!(
            error.kind,
            NpmErrorKind::TokenExpired
                | NpmErrorKind::AuthenticationFailed
                | NpmErrorKind::HttpError
        ),
        "unexpected error kind {:?} ({})",
        error.kind,
        error.message
    );
    assert!(service.list_connections().is_empty());
}

// ── Proxy hosts: create → list → disable → enable → delete ────────────────

/// Regression guard for the t65-e5 finding that only a real container exposes:
/// `POST /api/nginx/proxy-hosts/{id}/enable|disable` returns the bare JSON
/// literal `true`, **not** the host object (verified with curl against 2.15.1).
/// `ProxyHostManager::{enable,disable}` used to deserialize that into
/// `NpmProxyHost`, so every toggle failed with
/// `ParseError: invalid type: boolean \`true\`` and the panel's proxy-host
/// toggle could never work. `http_contract.rs`'s mock returns a fabricated host
/// object, which is why the unit suite stayed green through the bug; t65-e1
/// now discards the body and re-`get`s the entity.
#[tokio::test]
#[ignore]
async fn proxy_host_lifecycle() {
    let service = connected_service("e2e-hosts").await;
    let id = "e2e-hosts";
    let domain = format!("e2e-{}.local", std::process::id());

    let created = service
        .create_proxy_host(
            id,
            CreateProxyHostRequest {
                domain_names: vec![domain.clone()],
                forward_host: "127.0.0.1".to_string(),
                forward_port: 8080,
                forward_scheme: Some("http".to_string()),
                // NPM's request schema wants integers here, not nulls.
                certificate_id: Some(0),
                ssl_forced: Some(false),
                caching_enabled: Some(false),
                block_exploits: Some(false),
                allow_websocket_upgrade: Some(false),
                http2_support: Some(false),
                hsts_enabled: Some(false),
                hsts_subdomains: Some(false),
                advanced_config: Some(String::new()),
                locations: Some(Vec::new()),
                access_list_id: Some(0),
                meta: Some(serde_json::json!({})),
            },
        )
        .await
        .expect("create proxy host");
    assert!(created.domain_names.contains(&domain));
    assert_eq!(created.forward_port, 8080);
    // NPM sends booleans as 0/1 integers; the crate's `bool_from_int`
    // deserializer must turn that into a real `bool`.
    assert_eq!(created.enabled, Some(true), "new hosts start enabled");

    let hosts = service
        .list_proxy_hosts(id)
        .await
        .expect("list proxy hosts");
    assert!(
        hosts.iter().any(|h| h.id == created.id),
        "the created host must appear in the list"
    );

    // Run the toggles first and only assert afterwards, so a failure here
    // still deletes the host instead of leaking one per run.
    let disabled = service.disable_proxy_host(id, created.id).await;
    let after_disable = service
        .get_proxy_host(id, created.id)
        .await
        .expect("re-read after disable");
    let enabled = service.enable_proxy_host(id, created.id).await;
    let after_enable = service
        .get_proxy_host(id, created.id)
        .await
        .expect("re-read after enable");

    service
        .delete_proxy_host(id, created.id)
        .await
        .expect("delete proxy host");

    let after = service
        .list_proxy_hosts(id)
        .await
        .expect("list after delete");
    assert!(
        !after.iter().any(|h| h.id == created.id),
        "the deleted host must be gone"
    );

    // The server-side effect is real either way — this part passes today and
    // proves the endpoints are being hit correctly.
    assert_eq!(
        after_disable.enabled,
        Some(false),
        "disable must actually disable the host"
    );
    assert_eq!(
        after_enable.enabled,
        Some(true),
        "enable must actually re-enable the host"
    );

    // ...and the crate must also be able to *decode* the response. See the doc
    // comment above: NPM returns bare `true`, so these two assertions are the
    // ones that catch a regression back to deserializing into `NpmProxyHost`.
    let disabled = disabled.expect("disable proxy host must decode NPM's response");
    assert_eq!(disabled.enabled, Some(false));
    let enabled = enabled.expect("enable proxy host must decode NPM's response");
    assert_eq!(enabled.enabled, Some(true));
}

// ── Read-only listings a fresh install must still answer ──────────────────

#[tokio::test]
#[ignore]
async fn read_only_listings_answer_on_a_fresh_install() {
    let service = connected_service("e2e-listings").await;
    let id = "e2e-listings";

    // A fresh install has none of these, but every endpoint must answer with a
    // well-formed (possibly empty) array.
    let certificates = service.list_certificates(id).await.expect("certificates");
    assert!(certificates.iter().all(|c| !c.provider.is_empty()));

    let redirections = service
        .list_redirection_hosts(id)
        .await
        .expect("redirection hosts");
    assert!(redirections.iter().all(|r| !r.domain_names.is_empty()));

    let streams = service.list_streams(id).await.expect("streams");
    assert!(streams.iter().all(|s| s.incoming_port > 0));
}

// ── Web UI origin used by the panel's "Open web UI" button ────────────────

#[tokio::test]
#[ignore]
async fn web_ui_url_points_at_the_live_login_page() {
    let service = connected_service("e2e-web-ui").await;

    let web_ui = service.web_ui_url("e2e-web-ui").expect("web ui url");
    assert_eq!(web_ui, base_url());

    // The panel's auto-login drives NPM's own login form, so prove the page
    // the button opens is really served.
    let response = reqwest::Client::new()
        .get(format!("{web_ui}/login"))
        .send()
        .await
        .expect("GET /login");
    assert!(
        response.status().is_success(),
        "NPM web UI /login returned HTTP {}",
        response.status()
    );
}
