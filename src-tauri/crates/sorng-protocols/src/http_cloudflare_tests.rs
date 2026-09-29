//! Synthetic protected-route tests; no Cloudflare account or live requests.
use super::*;

const LOGIN: &str = "https://dash.cloudflare.com/login";

fn config(target: &str) -> BasicAuthProxyConfig {
    serde_json::from_value(serde_json::json!({
        "target_url": target, "username": "fixture-user", "password": "fixture-secret",
        "upstream_auth_mode": "cloudflare-form", "reviewed_application_profile": "cloudflare",
        "http_auto_login": true
    }))
    .unwrap()
}

async fn fixture() -> FixtureProxy {
    let proxy = proxy_with_mode(LOGIN.into(), client(), UpstreamAuthMode::CloudflareForm).await;
    let state = &proxy.state;
    *state.username.write().unwrap() = "fixture-user".into();
    *state.password.write().unwrap() = "fixture-secret".into();
    state.auto_login_armed.store(true, Ordering::SeqCst);
    state.document_sequence.store(1, Ordering::SeqCst);
    state.network.document_issued(1, true);
    register_cloudflare_session(&proxy);
    proxy
}

pub(super) fn register_cloudflare_session(proxy: &FixtureProxy) {
    let state = &proxy.state;
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: None,
            network: state.network.clone(),
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: LOGIN.into(),
            username: state.username.read().unwrap().clone(),
            password: state.password.read().unwrap().clone(),
            upstream_auth_mode: UpstreamAuthMode::CloudflareForm,
            proxy_policy: Default::default(),
            redirect_profile: None,
            reviewed_application_profile: Some(ReviewedApplicationProfile::Cloudflare),
            reviewed_application_api_origin: None,
            reviewed_application_mesh_origin: None,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 1,
            min_tls_version: "1.2".into(),
            verify_ssl: true,
            accepted_cert_fingerprint: None,
            require_ca_verification: false,
            request_count: state.request_count.clone(),
            error_count: state.error_count.clone(),
            last_error: state.last_error.clone(),
            shutdown_tx: None,
        },
    );
}

fn bind(proxy: &FixtureProxy, sequence: u64, url: &str) -> Option<String> {
    let script = crate::themed_autologin::build_autologin_injection(&proxy.state, sequence, url)?;
    assert!(script.contains("fetchCredsAndRun(NONCE,SEL, 'cloudflare')"));
    assert!(!script.contains("fixture-user") && !script.contains("fixture-secret"));
    Some(
        script
            .split_once("var NONCE=\"")
            .unwrap()
            .1
            .split('"')
            .next()
            .unwrap()
            .into(),
    )
}

async fn grant(proxy: &FixtureProxy, nonce: &str, phase: &str) -> reqwest::Response {
    fetch(proxy, &format!("{AUTOLOGIN_PATH}?nonce={nonce}{phase}")).await
}

#[test]
fn cloudflare_config_and_wire_contract_are_exact_and_never_send_authorization() {
    for target in [
        LOGIN,
        "https://dash.cloudflare.com/",
        "https://dash.cloudflare.com:443/login/",
    ] {
        let cfg = config(target);
        validate_reviewed_login_config(&cfg).unwrap();
        assert_eq!(
            serde_json::to_value(cfg.upstream_auth_mode).unwrap(),
            "cloudflare-form"
        );
        assert_eq!(
            serde_json::to_value(cfg.reviewed_application_profile).unwrap(),
            "cloudflare"
        );
    }
    for target in [
        "http://dash.cloudflare.com/login",
        "https://dash.cloudflare.com:444/login",
        "https://dash.cloudflare.com.attacker.test/login",
        "https://dash.cloudflare.com./login",
        "https://cloudflare.com/login",
        "https://challenges.cloudflare.com/login",
        "https://user@dash.cloudflare.com/login",
        "https://user:secret@dash.cloudflare.com/login",
    ] {
        assert!(
            validate_reviewed_login_config(&config(target)).is_err(),
            "{target}"
        );
    }
    let mut cfg = config(LOGIN);
    cfg.reviewed_application_profile = None;
    assert!(validate_reviewed_login_config(&cfg).is_err());
    cfg.reviewed_application_profile = Some(ReviewedApplicationProfile::GoogleHosted);
    assert!(validate_reviewed_login_config(&cfg).is_err());
    cfg.reviewed_application_profile = Some(ReviewedApplicationProfile::Cloudflare);
    cfg.http_auto_login_selectors = Some(HttpAutoLoginSelectors {
        username_selector: Some("#guessed".into()),
        password_selector: None,
        submit_selector: None,
    });
    assert!(validate_reviewed_login_config(&cfg).is_err());
    cfg.http_auto_login_selectors = None;
    cfg.http_form_automation = Some(
        serde_json::from_value(serde_json::json!({
            "version":1, "fillDelayMs":0, "submitDelayMs":0,
            "detectionTimeoutMs":8000, "submit":false, "fields":[]
        }))
        .unwrap(),
    );
    assert!(validate_reviewed_login_config(&cfg).is_err());
    let mode = UpstreamAuthMode::CloudflareForm;
    assert!(!mode.accepts_basic_challenge());
    assert!(mode.authorization_value("user", "secret").is_none());
    assert!(mode.manager_visible_username("user").is_empty());
    let request = mode
        .apply_credentials(client().get(LOGIN), "user", "secret")
        .build()
        .unwrap();
    assert!(!request.headers().contains_key("authorization"));
    assert!(!request.headers().contains_key("x-auth-key"));
}

#[tokio::test]
async fn cloudflare_binds_only_current_reviewed_login_documents() {
    let proxy = fixture().await;
    for url in [
        "https://dash.cloudflare.com/",
        "https://dash.cloudflare.com/login/password",
        "https://dash.cloudflare.com/password",
        "https://dash.cloudflare.com/sign-up",
        "https://dash.cloudflare.com/Login",
        "https://dash.cloudflare.com//login",
        "https://dash.cloudflare.com:444/login",
        "http://dash.cloudflare.com/login",
        "https://dash.cloudflare.com.attacker.test/login",
        "https://user@dash.cloudflare.com/login",
        "https://challenges.cloudflare.com/login",
    ] {
        assert!(bind(&proxy, 1, url).is_none(), "{url}");
    }
    assert!(bind(&proxy, 0, LOGIN).is_none());
    assert!(bind(&proxy, 2, LOGIN).is_none());
    for url in [
        LOGIN,
        "https://dash.cloudflare.com/login/",
        "https://dash.cloudflare.com:443/login?redirect=%2F",
    ] {
        assert!(bind(&proxy, 1, url).is_some());
    }
    let foreign = proxy_with_mode(
        "https://other.test/".into(),
        client(),
        UpstreamAuthMode::CloudflareForm,
    )
    .await;
    foreign.state.auto_login_armed.store(true, Ordering::SeqCst);
    foreign.state.document_sequence.store(1, Ordering::SeqCst);
    assert!(bind(&foreign, 1, LOGIN).is_none());
}

#[tokio::test]
async fn cloudflare_protected_grants_are_staged_single_use_and_same_document() {
    let proxy = fixture().await;
    let nonce = bind(&proxy, 1, LOGIN).unwrap();
    for (host, origin) in [
        ("127.0.0.1:1", proxy.state.proxy_origin.as_str()),
        (
            proxy.state.proxy_authority.as_str(),
            "https://attacker.test",
        ),
        (proxy.state.proxy_authority.as_str(), "null"),
    ] {
        let reply = client()
            .get(format!("{}{AUTOLOGIN_PATH}?nonce={nonce}", proxy.base))
            .header("Host", host)
            .header("Origin", origin)
            .send()
            .await
            .unwrap();
        assert_eq!(reply.status(), StatusCode::FORBIDDEN);
    }
    for (token, phase) in [
        ("wrong", ""),
        (nonce.as_str(), "&phase=password"),
        (nonce.as_str(), "&phase=unknown"),
    ] {
        assert_eq!(
            grant(&proxy, token, phase).await.status(),
            StatusCode::FORBIDDEN
        );
    }
    let first = grant(&proxy, &nonce, "").await;
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(first.headers()["cache-control"], "no-store");
    let text = first.text().await.unwrap();
    assert!(!text.contains("password") && !text.contains("fixture-secret"));
    let first: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(first["loginFlow"], "cloudflare");
    assert_eq!(first["username"], "fixture-user");
    let next = first["continuation"].as_str().unwrap();
    assert_ne!(next, nonce);
    assert_eq!(
        grant(&proxy, &nonce, "").await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        grant(&proxy, next, "").await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        grant(&proxy, "wrong", "&phase=password").await.status(),
        StatusCode::FORBIDDEN
    );
    // Combined form and identifier -> password SPA transitions share this
    // document sequence, so they redeem the same narrowly scoped continuation.
    let password = grant(&proxy, next, "&phase=password").await;
    assert_eq!(password.status(), StatusCode::OK);
    let password: serde_json::Value = password.json().await.unwrap();
    assert_eq!(
        password,
        serde_json::json!({"loginFlow":"cloudflare", "password":"fixture-secret"})
    );
    assert_eq!(
        grant(&proxy, next, "&phase=password").await.status(),
        StatusCode::FORBIDDEN
    );
    assert!(bind(&proxy, 1, LOGIN).is_none());
    assert!(proxy
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log
        .is_empty());
}

#[tokio::test]
async fn cloudflare_reload_before_username_rearms_but_password_never_rebinds() {
    let proxy = fixture().await;
    let old = bind(&proxy, 1, LOGIN).unwrap();
    proxy.state.document_sequence.store(2, Ordering::SeqCst);
    proxy.state.network.document_issued(2, true);
    proxy.state.network.activate_document(2).unwrap();
    let new = bind(&proxy, 2, LOGIN).unwrap();
    assert_ne!(old, new);
    assert_eq!(
        grant(&proxy, &old, "").await.status(),
        StatusCode::FORBIDDEN
    );
    let first: serde_json::Value = grant(&proxy, &new, "").await.json().await.unwrap();
    proxy.state.document_sequence.store(3, Ordering::SeqCst);
    proxy.state.network.document_issued(3, true);
    proxy.state.network.activate_document(3).unwrap();
    assert!(bind(&proxy, 3, LOGIN).is_none());
    assert_eq!(
        grant(
            &proxy,
            first["continuation"].as_str().unwrap(),
            "&phase=password"
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn cloudflare_selection_stop_and_network_revocation_prevent_password_release() {
    for revoke in ["selection", "session", "network", "issuance"] {
        let proxy = fixture().await;
        let nonce = bind(&proxy, 1, LOGIN).unwrap();
        let first: serde_json::Value = grant(&proxy, &nonce, "").await.json().await.unwrap();
        match revoke {
            "selection" => {
                proxy.state.network.document_issued(2, true);
                proxy.state.network.activate_document(2).unwrap();
            }
            "session" => {
                proxy
                    .state
                    .global_sessions
                    .lock()
                    .unwrap()
                    .sessions
                    .remove(&proxy.state.session_id);
            }
            "network" => proxy.state.network.revoke(),
            _ => {
                proxy.state.document_sequence.store(2, Ordering::SeqCst);
            }
        }
        let reply = grant(
            &proxy,
            first["continuation"].as_str().unwrap(),
            "&phase=password",
        )
        .await;
        assert!(
            matches!(reply.status(), StatusCode::FORBIDDEN | StatusCode::GONE),
            "{revoke}"
        );
        assert!(!reply.text().await.unwrap().contains("fixture-secret"));
    }
}

#[test]
fn cloudflare_managed_response_requires_exact_profile_origin_html_and_signal() {
    use axum::http::{HeaderMap, HeaderValue};
    let mut headers = HeaderMap::new();
    headers.insert("cf-mitigated", HeaderValue::from_static("challenge"));
    headers.insert(
        "content-type",
        HeaderValue::from_static("text/html; charset=UTF-8"),
    );
    let profile = Some(ReviewedApplicationProfile::Cloudflare);
    let accepted = |profile, target, headers: &HeaderMap| {
        cloudflare_challenge::is_managed_challenge_response(
            profile,
            &reqwest::Url::parse(target).unwrap(),
            headers,
        )
    };
    assert!(accepted(profile, LOGIN, &headers));
    assert!(accepted(
        profile,
        "https://dash.cloudflare.com:443/login?__cf_chl_tk=fixture",
        &headers
    ));
    assert!(!accepted(None, LOGIN, &headers));
    assert!(!accepted(
        Some(ReviewedApplicationProfile::GoogleHosted),
        LOGIN,
        &headers
    ));
    for target in [
        "http://dash.cloudflare.com/login",
        "https://dash.cloudflare.com:444/login",
        "https://dash.cloudflare.com.attacker.test/login",
        "https://user@dash.cloudflare.com/login",
        "https://challenges.cloudflare.com/login",
    ] {
        assert!(!accepted(profile, target, &headers), "{target}");
    }
    headers.remove("cf-mitigated");
    assert!(!accepted(profile, LOGIN, &headers));
    headers.insert("cf-mitigated", HeaderValue::from_static("other"));
    assert!(!accepted(profile, LOGIN, &headers));
    headers.insert("cf-mitigated", HeaderValue::from_static("challenge"));
    headers.append("cf-mitigated", HeaderValue::from_static("challenge"));
    assert!(!accepted(profile, LOGIN, &headers));
    headers.insert("cf-mitigated", HeaderValue::from_static("challenge"));
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    assert!(!accepted(profile, LOGIN, &headers));
    headers.remove("content-type");
    assert!(!accepted(profile, LOGIN, &headers));
}

#[test]
fn cloudflare_challenge_has_no_direct_network_or_frame_permission() {
    let csp = network::content_security_policy(
        &HttpProxyPolicy::default(),
        "p0123456789abcdef0123456789abcdef.localhost:43123",
    );
    assert!(!csp.contains("challenges.cloudflare.com"));
    assert!(csp.contains("frame-src 'self'"));
    assert!(!webview_origins::allows_frame_url(
        "https://challenges.cloudflare.com/"
    ));
    assert!(!webview_origins::allows_resource_url(
        "https://challenges.cloudflare.com/turnstile/v0/api.js",
        "http://tauri.localhost",
        None
    ));
}
