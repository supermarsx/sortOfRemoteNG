use super::*;
use crate::themed_autologin::AutoLoginQuery;
use axum::body::Body;
use axum::http::{header, Request};
use reqwest::{ResponseBuilderExt, Url};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use tokio::net::TcpListener;

const PRIMARY_PROXY: &str = "http://p11111111111111111111111111111111.localhost:43123";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

fn session(source: &str) -> google::GoogleSession {
    google::GoogleSession::new(
        Some(ReviewedApplicationProfile::GoogleHosted),
        &Url::parse(source).unwrap(),
        PRIMARY_PROXY,
        client(),
        client(),
    )
    .unwrap()
    .unwrap()
}

fn expected_routes(source: &str, extras: &[(&str, bool)]) -> BTreeMap<String, bool> {
    let mut expected = BTreeMap::from([
        (source.to_string(), true),
        ("https://accounts.google.com".into(), true),
        ("https://www.google.com".into(), true),
        ("https://www.gstatic.com".into(), false),
        ("https://ssl.gstatic.com".into(), false),
        ("https://fonts.gstatic.com".into(), false),
        ("https://fonts.googleapis.com".into(), false),
        ("https://apis.google.com".into(), false),
    ]);
    expected.extend(
        extras
            .iter()
            .map(|(origin, documents)| ((*origin).to_string(), *documents)),
    );
    expected
}

fn state(target_origin: &str) -> Arc<AxumProxyState> {
    let mut policy = HttpProxyPolicy::default();
    policy.query_parameters.push(proxy_policy::QueryParameter {
        name: "connection-secret".into(),
        value: "must-not-cross-origin".into(),
    });
    Arc::new(AxumProxyState {
        attempt: None,
        network: Arc::new(ProxyNetworkState::default()),
        website_dark_mode: Default::default(),
        session_id: "google-routing-test".into(),
        connection_id: "saved-connection".into(),
        target_url: format!("{target_origin}/"),
        username: Arc::new(std::sync::RwLock::new("saved-user".into())),
        password: Arc::new(std::sync::RwLock::new("saved-password".into())),
        upstream_auth_mode: UpstreamAuthMode::GoogleForm,
        proxy_policy: policy,
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::from([(
            "x-connection-secret".into(),
            "must-not-cross-origin".into(),
        )]),
        pending_nonce: Default::default(),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        target_origin: target_origin.into(),
        proxy_authority: PRIMARY_PROXY.trim_start_matches("http://").into(),
        proxy_origin: PRIMARY_PROXY.into(),
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Default::default(),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: yealink_login::session_slot(),
        client: client(),
        document_sequence: Arc::new(AtomicU64::new(0)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Default::default(),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    })
}

fn activate(state: &Arc<AxumProxyState>) {
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: state.target_url.clone(),
            username: "saved-user".into(),
            password: "saved-password".into(),
            upstream_auth_mode: UpstreamAuthMode::GoogleForm,
            proxy_policy: state.proxy_policy.clone(),
            redirect_profile: None,
            reviewed_application_profile: Some(ReviewedApplicationProfile::GoogleHosted),
            reviewed_application_api_origin: None,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: 43123,
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

fn request_for(route: &google::GoogleProxyRoute, path: &str) -> Request<Body> {
    let local = Url::parse(&route.proxy_origin).unwrap();
    Request::builder()
        .uri(path)
        .header(
            header::HOST,
            format!("{}:{}", local.host_str().unwrap(), local.port().unwrap()),
        )
        .header(header::ORIGIN, PRIMARY_PROXY)
        .header("sec-fetch-dest", "document")
        .body(Body::empty())
        .unwrap()
}

#[test]
fn google_catalog_is_an_exact_profile_specific_allowlist_without_lookalikes() {
    for (source, extras) in [
        ("https://myaccount.google.com", vec![]),
        (
            "https://console.cloud.google.com",
            vec![("https://cloudconsole-pa.clients6.google.com", false)],
        ),
        (
            "https://analytics.google.com",
            vec![
                ("https://analyticsadmin.googleapis.com", false),
                ("https://analyticsdata.googleapis.com", false),
            ],
        ),
        ("https://business.google.com", vec![]),
        ("https://search.google.com", vec![]),
        ("https://ads.google.com", vec![]),
        (
            "https://www.youtube.com",
            vec![("https://accounts.youtube.com", true)],
        ),
        ("https://mail.google.com", vec![]),
        (
            "https://drive.google.com",
            vec![
                ("https://clients6.google.com", false),
                ("https://content.googleapis.com", false),
            ],
        ),
    ] {
        let session = session(source);
        let actual = session
            .routes
            .iter()
            .map(|route| (route.upstream_origin.clone(), route.documents))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(actual, expected_routes(source, &extras), "{source}");
        for lookalike in [
            format!("{source}.attacker.test/path"),
            "https://accounts.google.com.attacker.test/".into(),
            "https://evilgoogle.com/".into(),
            "https://accounts.google.com:444/".into(),
            "http://accounts.google.com/".into(),
        ] {
            assert!(
                session.map_url(&Url::parse(&lookalike).unwrap()).is_none(),
                "{lookalike}"
            );
        }
    }

    for source in [
        "https://accounts.google.com/",
        "https://analytics.google.com.attacker.test/",
        "http://analytics.google.com/",
        "https://analytics.google.com:444/",
        "https://user@analytics.google.com/",
    ] {
        assert!(
            google::GoogleSession::new(
                Some(ReviewedApplicationProfile::GoogleHosted),
                &Url::parse(source).unwrap(),
                PRIMARY_PROXY,
                client(),
                client(),
            )
            .is_err(),
            "{source}"
        );
    }
}

#[test]
fn every_upstream_origin_has_a_distinct_leased_local_origin() {
    let session = session("https://analytics.google.com/path/is-allowed");
    let local_origins = session
        .routes
        .iter()
        .map(|route| route.proxy_origin.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(local_origins.len(), session.routes.len());
    assert_eq!(
        session
            .routes
            .iter()
            .find(|route| route.upstream_origin == "https://analytics.google.com")
            .unwrap()
            .proxy_origin,
        PRIMARY_PROXY
    );
    let aliases = session
        .routes
        .iter()
        .filter(|route| route.proxy_origin != PRIMARY_PROXY)
        .map(|route| route.proxy_origin.clone())
        .collect::<Vec<_>>();
    for alias in &aliases {
        let parsed = Url::parse(alias).unwrap();
        assert_eq!(parsed.scheme(), "http");
        assert_eq!(parsed.port(), Some(43123));
        let host = parsed.host_str().unwrap();
        assert!(host.starts_with('p') && host.ends_with(".localhost"));
        assert_eq!(
            host.trim_start_matches('p')
                .trim_end_matches(".localhost")
                .len(),
            32
        );
        assert!(webview_origins::allows_frame_url(alias));
    }
    session.revoke();
    for alias in aliases {
        assert!(!webview_origins::allows_frame_url(&alias));
    }
}

#[test]
fn redirects_map_to_the_destination_alias_and_increment_a_bounded_counter() {
    let session = session("https://analytics.google.com/");
    let account_proxy = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap()
        .proxy_origin
        .clone();
    let upstream: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(
            header::LOCATION,
            "https://accounts.google.com/v3/signin/identifier?continue=analytics#step",
        )
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    let mapped = session.redirect_response(&upstream, 7, Some("navigation-token"), true, None);
    assert_eq!(mapped.status(), 302);
    let location = mapped.headers()[header::LOCATION].to_str().unwrap();
    assert!(location.starts_with(&format!(
        "{account_proxy}/v3/signin/identifier?continue=analytics&"
    )));
    assert!(location.contains("__sorng_google_hop_v1=8"));
    assert!(location.contains("__sorng_navigation_v1=navigation-token"));
    assert!(location.ends_with("#step"));

    assert_eq!(
        google::request_path("/v3/signin?continue=analytics&__sorng_google_hop_v1=8").unwrap(),
        ("/v3/signin?continue=analytics".into(), 8)
    );
    for invalid in [
        "/?__sorng_google_hop_v1=21",
        "/?__sorng_google_hop_v1=1&__sorng_google_hop_v1=2",
        "/?%5f_sorng_google_hop_v1=1",
        "/?__sorng_google_hop_v1=-1",
    ] {
        assert!(google::request_path(invalid).is_err(), "{invalid}");
    }

    let limited = session.redirect_response(&upstream, 20, None, true, None);
    assert_eq!(limited.status(), 508);
    let outside: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(
            header::LOCATION,
            "https://accounts.google.com.attacker.test/",
        )
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    assert_eq!(
        session
            .redirect_response(&outside, 0, None, true, None)
            .status(),
        403
    );
}

#[test]
fn alias_scope_preserves_the_native_webview_user_agent_but_not_connection_secrets() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let base = state("https://analytics.google.com");
    let request = request_for(account, "/v3/signin/identifier");
    let scoped = session.request_state(&base, &request).unwrap();
    assert_eq!(scoped.target_origin, "https://accounts.google.com");
    assert_eq!(scoped.proxy_origin, account.proxy_origin);
    assert_eq!(scoped.upstream_auth_mode, UpstreamAuthMode::GoogleForm);
    assert!(scoped.custom_headers.is_empty());
    assert!(scoped.proxy_policy.query_parameters.is_empty());

    let native_user_agent = "Mozilla/5.0 Native-WebView2 Fixture/126.0";
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert(header::USER_AGENT, native_user_agent.parse().unwrap());
    incoming.insert(header::COOKIE, "browser-cookie=private".parse().unwrap());
    incoming.insert(
        header::PROXY_AUTHORIZATION,
        "Basic private".parse().unwrap(),
    );
    let forwarded = session.request_headers(&incoming, &scoped.target_origin);
    assert_eq!(
        forwarded
            .iter()
            .find(|(name, _)| name == "user-agent")
            .map(|(_, value)| value.as_str()),
        Some(native_user_agent)
    );
    let captured = format!("{forwarded:?}");
    assert!(!captured.contains("saved-user"));
    assert!(!captured.contains("saved-password"));
    assert!(!captured.contains("must-not-cross-origin"));
    assert!(!forwarded
        .iter()
        .any(|(name, _)| matches!(name.as_str(), "cookie" | "proxy-authorization")));

    let outbound = scoped
        .upstream_auth_mode
        .apply_credentials(
            scoped.client.get("https://accounts.google.com/"),
            &scoped.username.read().unwrap(),
            &scoped.password.read().unwrap(),
        )
        .build()
        .unwrap();
    assert!(!outbound.headers().contains_key(header::AUTHORIZATION));

    let credentials = request_for(account, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_ok());
    let resource = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://www.gstatic.com")
        .unwrap();
    let credentials = request_for(resource, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_err());
}

#[test]
fn cors_is_translated_only_when_google_approved_the_exact_upstream_origin() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let analytics = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://analytics.google.com")
        .unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "access-control-allow-origin",
        "https://analytics.google.com".parse().unwrap(),
    );
    assert_eq!(
        session.translated_cors_origin(Some(&analytics.proxy_origin), &headers),
        Some(analytics.proxy_origin.clone())
    );
    assert_eq!(
        session.translated_cors_origin(Some(&account.proxy_origin), &headers),
        None
    );
    headers.insert("access-control-allow-origin", "*".parse().unwrap());
    assert_eq!(
        session.translated_cors_origin(Some(&account.proxy_origin), &headers),
        Some("*".into())
    );
    assert_eq!(
        session.translated_cors_origin(
            Some("http://pffffffffffffffffffffffffffffffff.localhost:43123"),
            &headers,
        ),
        None
    );
}

#[test]
fn native_cookie_jar_keeps_httponly_values_and_merges_browser_visible_updates() {
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "SID=server-secret; Domain=.google.com; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "visible=one; Domain=.google.com; Path=/; Secure; SameSite=Lax"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&server, &target).unwrap();

    let mut browser = axum::http::HeaderMap::new();
    browser.insert(header::COOKIE, "SID=attacker; visible=two".parse().unwrap());
    session.observe_browser_cookies(&browser, &target).unwrap();
    let native = session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(native.contains("SID=server-secret"));
    assert!(!native.contains("SID=attacker"));
    assert!(native.contains("visible=two"));

    let projected = session
        .projected_cookies(&target)
        .into_iter()
        .map(|value| value.to_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert!(projected
        .iter()
        .any(|value| { value.starts_with("SID=server-secret;") && value.contains("HttpOnly") }));
    assert!(projected.iter().all(|value| !value.contains("Domain=")));

    let mut deletion = reqwest::header::HeaderMap::new();
    deletion.append(
        header::SET_COOKIE,
        "visible=; Domain=.google.com; Path=/; Max-Age=0; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&deletion, &target).unwrap();
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("visible="));
}

#[test]
fn fetch_credential_mode_is_closed_and_never_forwarded_upstream() {
    let session = session("https://analytics.google.com/");
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert("x-sorng-google-credentials", "omit".parse().unwrap());
    assert!(!session.includes_credentials(&incoming).unwrap());
    incoming.insert("x-sorng-google-credentials", "include".parse().unwrap());
    assert!(session.includes_credentials(&incoming).unwrap());
    let forwarded = session.request_headers(&incoming, "https://analytics.google.com");
    assert!(forwarded
        .iter()
        .any(|(name, value)| name == "x-sorng-google-credentials" && value == "include"));
    incoming.insert("x-sorng-google-credentials", "invalid".parse().unwrap());
    assert!(session.includes_credentials(&incoming).is_err());
}

#[tokio::test]
async fn google_identifier_and_password_grants_are_document_bound_single_use_stages() {
    let state = state("https://accounts.google.com");
    activate(&state);
    state.document_sequence.store(1, Ordering::SeqCst);
    let identifier_script = crate::themed_autologin::build_autologin_injection(
        &state,
        1,
        "https://accounts.google.com/v3/signin/identifier",
    )
    .unwrap();
    assert!(identifier_script.contains("fetchCredsAndRun(NONCE,SEL, 'google')"));
    let identifier_nonce = identifier_script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .to_owned();
    let identifier = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: identifier_nonce.clone(),
            phase: None,
        }),
    )
    .await;
    assert_eq!(identifier.status(), axum::http::StatusCode::OK);
    let identifier_body = axum::body::to_bytes(identifier.into_body(), 4096)
        .await
        .unwrap();
    let identifier_json: serde_json::Value = serde_json::from_slice(&identifier_body).unwrap();
    assert_eq!(identifier_json["username"], "saved-user");
    assert!(identifier_json.get("password").is_none());
    let continuation = identifier_json["continuation"].as_str().unwrap().to_owned();

    let replay = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: identifier_nonce,
            phase: None,
        }),
    )
    .await;
    assert_eq!(replay.status(), axum::http::StatusCode::FORBIDDEN);

    state.document_sequence.store(2, Ordering::SeqCst);
    let password_script = crate::themed_autologin::build_autologin_injection(
        &state,
        2,
        "https://accounts.google.com/v3/signin/challenge/pwd",
    )
    .unwrap();
    assert!(password_script.contains("fetchCredsAndRun(NONCE,SEL, 'google-password')"));
    let password_nonce = password_script
        .split_once("var NONCE=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap()
        .to_owned();
    assert_eq!(password_nonce, continuation);
    let password = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state.clone()),
        axum::extract::Query(AutoLoginQuery {
            nonce: password_nonce.clone(),
            phase: Some("password".into()),
        }),
    )
    .await;
    assert_eq!(password.status(), axum::http::StatusCode::OK);
    let password_body = axum::body::to_bytes(password.into_body(), 4096)
        .await
        .unwrap();
    let password_json: serde_json::Value = serde_json::from_slice(&password_body).unwrap();
    assert_eq!(password_json["password"], "saved-password");
    assert!(password_json.get("username").is_none());

    let replay = crate::themed_autologin::autologin_cred_handler(
        axum::extract::State(state),
        axum::extract::Query(AutoLoginQuery {
            nonce: password_nonce,
            phase: Some("password".into()),
        }),
    )
    .await;
    assert_eq!(replay.status(), axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn off_catalog_requests_fail_before_any_direct_network_fallback() {
    let session = session("https://analytics.google.com/");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let destination = Url::parse(&format!(
        "http://{}/private",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    match session
        .send(&reqwest::Method::GET, &destination, &[], &[], true)
        .await
    {
        Err(upstream::UpstreamError::Policy(detail)) => {
            assert_eq!(detail, "Google destination is not approved.")
        }
        _ => panic!("off-catalog destination did not fail closed"),
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}
