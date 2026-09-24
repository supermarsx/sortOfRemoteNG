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
            header::SET_COOKIE,
            "__Host-GAPS=projected; Path=/; Secure; HttpOnly",
        )
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
    assert!(!mapped.headers().contains_key(header::SET_COOKIE));

    let signed_query = "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fanalytics.google.com%2Fanalytics%2Fweb%2F%2523%2Freport&continue=second+value&empty=&flag#challenge";
    let opaque: reqwest::Response = axum::http::Response::builder()
        .status(302)
        .header(header::LOCATION, signed_query)
        .url(Url::parse("https://analytics.google.com/").unwrap())
        .body("")
        .unwrap()
        .into();
    let opaque = session.redirect_response(&opaque, 0, None, true, None);
    let opaque_location = opaque.headers()[header::LOCATION].to_str().unwrap();
    assert!(opaque_location.contains("continue=https%3A%2F%2Fanalytics.google.com%2Fanalytics%2Fweb%2F%2523%2Freport&continue=second+value&empty=&flag&__sorng_google_hop_v1=1#challenge"));

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
    incoming.insert("sec-fetch-dest", "iframe".parse().unwrap());
    incoming.insert("sec-fetch-mode", "navigate".parse().unwrap());
    incoming.insert("sec-fetch-site", "same-site".parse().unwrap());
    incoming.insert("sec-fetch-user", "?1".parse().unwrap());
    incoming.insert(
        "sec-ch-ua",
        "\"WebView fixture\";v=\"126\"".parse().unwrap(),
    );
    incoming.insert("sec-ch-ua-platform", "\"Windows\"".parse().unwrap());
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
    for name in [
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-user",
        "sec-ch-ua",
        "sec-ch-ua-platform",
    ] {
        assert_eq!(
            forwarded
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str()),
            incoming.get(name).and_then(|value| value.to_str().ok()),
            "native browser metadata changed: {name}",
        );
    }

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

    let mut background = axum::http::HeaderMap::new();
    background.insert("sec-fetch-dest", "empty".parse().unwrap());
    background.insert("sec-fetch-mode", "cors".parse().unwrap());
    background.insert("sec-fetch-site", "same-origin".parse().unwrap());
    let background = session.request_headers(&background, &scoped.target_origin);
    assert!(background
        .iter()
        .any(|(name, value)| name == "sec-fetch-site" && value == "same-origin"));

    let credentials = request_for(account, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_ok());
    let cookies = request_for(account, google::COOKIE_BRIDGE_PATH);
    assert!(session.request_state(&base, &cookies).is_ok());
    let resource = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://www.gstatic.com")
        .unwrap();
    let credentials = request_for(resource, AUTOLOGIN_PATH);
    assert!(session.request_state(&base, &credentials).is_err());
    let cookies = request_for(resource, google::COOKIE_BRIDGE_PATH);
    assert!(session.request_state(&base, &cookies).is_err());
}

#[tokio::test]
async fn document_cookie_bridge_is_synchronous_path_scoped_and_hides_httponly_state() {
    let session = session("https://analytics.google.com/");
    let origin = "https://accounts.google.com";
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "SID=server-secret; Domain=.google.com; Path=/; Secure; HttpOnly"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "visible=one; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&server, &target).unwrap();

    let request = Request::builder()
        .method("GET")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::empty())
        .unwrap();
    let response = session.document_cookie_response(origin, request).await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert_eq!(body, "visible=one");

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from(
            "probe=accepted; Domain=.google.com; Path=/v3; Secure",
        ))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("SID=server-secret"));
    assert!(native.contains("probe=accepted"));

    for value in [
        "SID=browser-overwrite; Domain=.google.com; Path=/; Secure",
        "SID=; Domain=.google.com; Path=/; Max-Age=0; Secure",
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(google::COOKIE_BRIDGE_PATH)
            .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
            .body(Body::from(value))
            .unwrap();
        assert_eq!(
            session
                .document_cookie_response(origin, request)
                .await
                .status(),
            axum::http::StatusCode::NO_CONTENT
        );
    }
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("SID=server-secret"));
    assert!(!native.contains("SID=browser-overwrite"));

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from("probe=ignored; Path=/; HttpOnly"))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("probe=ignored"));

    let request = Request::builder()
        .method("POST")
        .uri(google::COOKIE_BRIDGE_PATH)
        .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
        .body(Body::from(
            "probe=; Domain=.google.com; Path=/v3; Max-Age=0; Secure",
        ))
        .unwrap();
    assert_eq!(
        session
            .document_cookie_response(origin, request)
            .await
            .status(),
        axum::http::StatusCode::NO_CONTENT
    );
    assert!(!session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("probe="));
}

#[test]
fn request_origins_translate_only_from_this_google_sessions_aliases() {
    let session = session("https://analytics.google.com/");
    let account = session
        .routes
        .iter()
        .find(|route| route.upstream_origin == "https://accounts.google.com")
        .unwrap();
    let mut incoming = axum::http::HeaderMap::new();
    incoming.insert(header::ORIGIN, PRIMARY_PROXY.parse().unwrap());
    incoming.insert(
        header::REFERER,
        format!("{PRIMARY_PROXY}/").parse().unwrap(),
    );
    let forwarded = session.request_headers(&incoming, &account.upstream_origin);
    assert!(forwarded.contains(&("origin".into(), "https://analytics.google.com".into())));
    assert!(forwarded.contains(&("referer".into(), "https://analytics.google.com/".into())));
    assert!(!format!("{forwarded:?}").contains("localhost"));

    for foreign in [
        "null",
        "https://accounts.google.com.attacker.test",
        "http://localhost:3001",
    ] {
        let mut request = request_for(account, "/v3/signin/identifier");
        request
            .headers_mut()
            .insert(header::ORIGIN, foreign.parse().unwrap());
        assert!(session
            .request_state(&state("https://analytics.google.com"), &request)
            .is_err());
    }
}

#[tokio::test]
async fn document_cookie_bridge_enforces_upstream_domain_and_secure_prefix_rules() {
    let session = session("https://analytics.google.com/");
    let origin = "https://accounts.google.com";
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    for value in [
        "__Secure-invalid=no; Path=/",
        "__Host-domain=no; Domain=.google.com; Path=/; Secure",
        "__Host-path=no; Path=/v3; Secure",
        "__Http-script=no; Path=/; Secure",
        "__Host-Http-script=no; Path=/; Secure",
        "public-suffix=no; Domain=com; Path=/; Secure",
        "foreign=no; Domain=attacker.test; Path=/; Secure",
        "__Secure-valid=yes; Domain=.google.com; Path=/; Secure",
        "__Host-valid=yes; Path=/; Secure",
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(google::COOKIE_BRIDGE_PATH)
            .header("x-sorng-google-cookie-path", "/v3/signin/identifier")
            .body(Body::from(value))
            .unwrap();
        assert_eq!(
            session
                .document_cookie_response(origin, request)
                .await
                .status(),
            axum::http::StatusCode::NO_CONTENT,
        );
    }
    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("__Secure-valid=yes"));
    assert!(native.contains("__Host-valid=yes"));
    assert_eq!(native.split("; ").count(), 2);
    let service = session
        .cookie_header(&Url::parse("https://analytics.google.com/").unwrap())
        .unwrap();
    assert_eq!(service.to_str().unwrap(), "__Secure-valid=yes");
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
fn native_cookie_jar_keeps_httponly_values_and_upstream_scope() {
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
        "__Host-GAPS=google-session; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "account-only=private; Path=/; Secure".parse().unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "visible=one; Domain=.google.com; Path=/; Secure; SameSite=Lax"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "dupe=wide; Domain=.google.com; Path=/; Secure; SameSite=Strict"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "dupe=narrow; Domain=.google.com; Path=/v3; Secure; SameSite=Lax"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "implicit=one; Domain=.google.com; Secure; SameSite=Strict"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "scope=shared; Domain=.google.com; Path=/v3/signin; Secure"
            .parse()
            .unwrap(),
    );
    server.append(header::SET_COOKIE, "scope=host; Secure".parse().unwrap());
    session.observe_cookies(&server, &target).unwrap();

    let native = session
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(native.contains("SID=server-secret"));
    assert!(native.contains("__Host-GAPS=google-session"));
    assert!(native.contains("visible=one"));
    assert!(native.contains("implicit=one"));
    assert!(native.contains("dupe=narrow"));
    assert!(native.contains("dupe=wide"));
    assert!(native.contains("scope=host"));
    assert!(native.contains("scope=shared"));

    let mut bridge = axum::http::HeaderMap::new();
    bridge.insert(
        "x-sorng-google-cookie-path",
        "/v3/signin/identifier".parse().unwrap(),
    );
    let visible = session
        .document_cookie_string("https://accounts.google.com", &bridge)
        .unwrap();
    assert!(!visible.contains("SID="));
    assert!(!visible.contains("__Host-GAPS="));
    assert!(visible.contains("visible=one"));
    assert!(visible.contains("dupe=narrow"));
    assert!(visible.contains("dupe=wide"));

    let analytics = Url::parse("https://analytics.google.com/analytics/web/").unwrap();
    let cross_origin = session
        .cookie_header(&analytics)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cross_origin.contains("SID=server-secret"));
    assert!(!cross_origin.contains("__Host-GAPS=google-session"));
    assert!(cross_origin.contains("visible=one"));
    assert!(cross_origin.contains("dupe=wide"));
    assert!(!cross_origin.contains("dupe=narrow"));
    assert!(!cross_origin.contains("implicit=one"));
    assert!(!cross_origin.contains("scope=shared"));
    assert!(!cross_origin.contains("scope=host"));
    assert!(!cross_origin.contains("account-only=private"));

    let sibling_scope = Url::parse("https://analytics.google.com/v3/signin/check").unwrap();
    let sibling_scope = session
        .cookie_header(&sibling_scope)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(sibling_scope.contains("scope=shared"));
    assert!(!sibling_scope.contains("scope=host"));

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
fn upstream_domain_expiry_does_not_delete_a_distinct_host_only_cookie() {
    let session = session("https://analytics.google.com/");
    let target = Url::parse("https://accounts.google.com/").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "shared=host-only; Path=/; Secure".parse().unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "shared=domain; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&server, &target).unwrap();

    let mut expiry = reqwest::header::HeaderMap::new();
    expiry.append(
        header::SET_COOKIE,
        "shared=; Domain=.google.com; Path=/; Max-Age=0; Secure"
            .parse()
            .unwrap(),
    );
    session.observe_cookies(&expiry, &target).unwrap();

    let native = session.cookie_header(&target).unwrap();
    let native = native.to_str().unwrap();
    assert!(native.contains("shared=host-only"));
    assert!(!native.contains("shared=domain"));
}

#[test]
fn google_cookie_state_survives_replacement_and_late_source_response() {
    let original = Arc::new(
        ProxyNetworkState::default()
            .with_google_routes(Some(session("https://analytics.google.com/"))),
    );
    let original_google = original.google.as_ref().unwrap();
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "__Host-GAPS=restart-session; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    server.append(
        header::SET_COOKIE,
        "shared=restart-domain; Domain=.google.com; Path=/; Secure"
            .parse()
            .unwrap(),
    );
    original_google.observe_cookies(&server, &target).unwrap();

    let state = original.take_google_cookie_state_for_replacement().unwrap();
    original.begin_replacement();

    let mut replacement = google::GoogleSession::new(
        Some(ReviewedApplicationProfile::GoogleHosted),
        &Url::parse("https://analytics.google.com/").unwrap(),
        "http://p22222222222222222222222222222222.localhost:53123",
        client(),
        client(),
    )
    .unwrap()
    .unwrap();
    replacement.restore_cookie_state(state);

    let mut late = reqwest::header::HeaderMap::new();
    late.append(
        header::SET_COOKIE,
        "__Host-GAPS=rotated-after-handoff; Path=/; Secure; HttpOnly; SameSite=None"
            .parse()
            .unwrap(),
    );
    original_google.observe_cookies(&late, &target).unwrap();

    // The old listener/runtime drops after graceful shutdown. Its final
    // network revoke must not clear cookie state now owned by the successor.
    drop(original.server_guard());

    let native = replacement
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(native.contains("__Host-GAPS=rotated-after-handoff"));
    assert!(native.contains("shared=restart-domain"));
    let mut bridge = axum::http::HeaderMap::new();
    bridge.insert(
        "x-sorng-google-cookie-path",
        "/v3/signin/identifier".parse().unwrap(),
    );
    assert!(!replacement
        .document_cookie_string("https://accounts.google.com", &bridge)
        .unwrap()
        .contains("__Host-GAPS="));
}

#[test]
fn dead_listener_retains_google_cookies_for_manager_recovery() {
    let original = Arc::new(
        ProxyNetworkState::default()
            .with_google_routes(Some(session("https://analytics.google.com/"))),
    );
    let target = Url::parse("https://accounts.google.com/v3/signin/identifier").unwrap();
    let mut server = reqwest::header::HeaderMap::new();
    server.append(
        header::SET_COOKIE,
        "__Host-GAPS=listener-died; Path=/; Secure; HttpOnly"
            .parse()
            .unwrap(),
    );
    original
        .google
        .as_ref()
        .unwrap()
        .observe_cookies(&server, &target)
        .unwrap();

    // Natural listener/runtime teardown happens before the health monitor asks
    // the manager to recover the session.
    drop(original.server_guard());
    assert!(!original.is_active());

    let state = original.take_google_cookie_state_for_replacement().unwrap();
    let mut replacement = session("https://analytics.google.com/");
    replacement.restore_cookie_state(state);
    assert!(replacement
        .cookie_header(&target)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("__Host-GAPS=listener-died"));
}

#[tokio::test]
async fn clearing_pending_recoveries_cancels_work_and_prevents_publication() {
    let manager = ProxySessionManager::new();
    let token = manager
        .lock()
        .unwrap()
        .begin_proxy_recovery("source-session")
        .unwrap();
    let cancellation = {
        let token = token.clone();
        tokio::spawn(async move { token.cancelled().await })
    };
    manager.lock().unwrap().cancel_all_proxy_recoveries();
    tokio::time::timeout(std::time::Duration::from_secs(1), cancellation)
        .await
        .expect("clear cancels pending work promptly")
        .unwrap();
    let replacement_token = manager
        .lock()
        .unwrap()
        .begin_proxy_recovery("source-session")
        .unwrap();
    assert!(!manager
        .lock()
        .unwrap()
        .finish_proxy_recovery("source-session", &token));
    assert!(manager
        .lock()
        .unwrap()
        .finish_proxy_recovery("source-session", &replacement_token));
}

#[tokio::test]
async fn replacement_closes_admission_then_drains_an_admitted_request() {
    let network = Arc::new(ProxyNetworkState::default());
    let request = network.begin_request().expect("request is admitted");
    network.begin_replacement();
    assert!(network.begin_request().is_none());

    let retiring = network.clone();
    let retirement = tokio::spawn(async move {
        retiring.retire_for_replacement().await;
    });
    tokio::task::yield_now().await;
    assert!(!retirement.is_finished());

    drop(request);
    tokio::time::timeout(std::time::Duration::from_secs(1), retirement)
        .await
        .expect("retirement drains promptly")
        .unwrap();
    assert!(!network.is_active());
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
