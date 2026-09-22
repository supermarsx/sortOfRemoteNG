//! Direct (non-QuickConnect) DSM grants through the real protected proxy route.
//! Upstream markup, credentials and loopback peers are synthetic.
use super::{DirectSynologyLogin, PasswordRedemption, MAX_CANDIDATE_DOCUMENTS};
use crate::http::{
    axum_proxy_handler, enforce_proxy_access, AxumProxyState, HttpProxyPolicy, ProxyNetworkState,
    ProxySessionEntry, ProxySessionManager, UpstreamAuthMode,
};
use crate::themed_autologin::{autologin_cred_handler, AUTOLOGIN_PATH};
use reqwest::StatusCode;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;

const TOKEN: &str = "0123456789abcdef0123456789abcdef";
const USERNAME: &str = "synthetic-direct-user";
const PASSWORD: &str = "synthetic-direct-password";
const DSM: &str = "<!doctype html><html><head><title>Synthetic DSM</title></head><body><div id=\"sds-login-vue-inst\"><div class=\"login-tabs-content-wrapper\"><form id=\"dsm-user-fieldset\"><input syno-id=\"username\" name=\"username\" type=\"text\" autocomplete=\"username\"></form><div role=\"button\" syno-id=\"account-panel-next-btn\">Next</div></div></div></body></html>";
const CHILD: &str =
    "<!doctype html><html><head></head><body>Synthetic DSM child frame</body></html>";

struct Fixture {
    base: String,
    state: Arc<AxumProxyState>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.network.revoke();
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
}

async fn fixture() -> Fixture {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", upstream.local_addr().unwrap());
    let site = axum::Router::new().fallback(|request: axum::extract::Request| async move {
        let body = if matches!(request.uri().path(), "/" | "/webman/index.cgi") {
            DSM
        } else {
            CHILD
        };
        axum::http::Response::builder()
            .header("Content-Type", "text/html; charset=utf-8")
            .body(axum::body::Body::from(body))
            .unwrap()
    });
    let site = tokio::spawn(async move { axum::serve(upstream, site).await.unwrap() });

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let authority = format!("p{TOKEN}.localhost:{port}");
    let network = Arc::new(ProxyNetworkState::default());
    let global_sessions = ProxySessionManager::new();
    let state = Arc::new(AxumProxyState {
        attempt: None,
        network: network.clone(),
        website_dark_mode: Default::default(),
        session_id: "synthetic-direct-session".into(),
        connection_id: "synthetic-direct-owner".into(),
        target_origin: reqwest::Url::parse(&target)
            .unwrap()
            .origin()
            .ascii_serialization(),
        target_url: target.clone(),
        username: Arc::new(std::sync::RwLock::new(USERNAME.into())),
        password: Arc::new(std::sync::RwLock::new(PASSWORD.into())),
        upstream_auth_mode: UpstreamAuthMode::SynologyForm,
        proxy_policy: HttpProxyPolicy::default(),
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Arc::new(std::sync::RwLock::new(None)),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        proxy_origin: format!("http://{authority}"),
        proxy_authority: authority,
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: crate::http::yealink_login::session_slot(),
        client: client(),
        request_count: Arc::new(AtomicU64::new(0)),
        document_sequence: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Arc::new(std::sync::Mutex::new(None)),
        global_sessions,
        credentials_applied: None,
    });
    state.global_sessions.lock().unwrap().sessions.insert(
        state.session_id.clone(),
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: None,
            network,
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: target,
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: UpstreamAuthMode::SynologyForm,
            proxy_policy: HttpProxyPolicy::default(),
            redirect_profile: None,
            reviewed_application_profile: None,
            custom_headers: HashMap::new(),
            upstream_proxy_url: None,
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: port,
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
    let router = axum::Router::new()
        .route(AUTOLOGIN_PATH, axum::routing::get(autologin_cred_handler))
        .fallback(axum_proxy_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_proxy_access,
        ))
        .with_state(state.clone());
    let proxy = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Fixture {
        base: format!("http://127.0.0.1:{port}"),
        state,
        tasks: vec![site, proxy],
    }
}

fn nonce(html: &str) -> Option<String> {
    let start = html.find("var NONCE=\"")? + "var NONCE=\"".len();
    let value = html[start..].split('"').next()?;
    (value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_owned())
}

/// A top-level page (the app's frame) or a nested child frame. Both are
/// document requests; only the frontend selection distinguishes the page.
async fn document(fixture: &Fixture, path: &str, marked: bool) -> String {
    let marker = if marked {
        format!("?__sorng_navigation_v1={TOKEN}")
    } else {
        String::new()
    };
    let response = client()
        .get(format!("{}{path}{marker}", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = response.text().await.unwrap();
    assert!(!html.contains(USERNAME) && !html.contains(PASSWORD));
    html
}

async fn grant(fixture: &Fixture, token: &str, password: bool) -> reqwest::Response {
    let mut request = client()
        .get(format!("{}{AUTOLOGIN_PATH}", fixture.base))
        .query(&[("nonce", token)])
        .header("Host", &fixture.state.proxy_authority)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin");
    if password {
        request = request.query(&[("phase", "password")]);
    }
    request.send().await.unwrap()
}

async fn refused(fixture: &Fixture, token: &str, password: bool) {
    let reply = grant(fixture, token, password).await;
    assert_eq!(reply.status(), StatusCode::FORBIDDEN);
    let body = reply.text().await.unwrap();
    assert!(!body.contains(USERNAME) && !body.contains(PASSWORD));
}

async fn username(fixture: &Fixture, token: &str) -> String {
    let reply = grant(fixture, token, false).await;
    assert_eq!(reply.status(), StatusCode::OK);
    assert_eq!(reply.headers()["cache-control"], "no-store");
    let body: serde_json::Value = reply.json().await.unwrap();
    assert_eq!(body["loginFlow"], "synology");
    assert_eq!(body["username"], USERNAME);
    assert!(body.get("password").is_none());
    body["continuation"].as_str().unwrap().to_owned()
}

async fn password(fixture: &Fixture, token: &str) {
    let reply = grant(fixture, token, true).await;
    assert_eq!(reply.status(), StatusCode::OK);
    let body: serde_json::Value = reply.json().await.unwrap();
    assert_eq!(body["loginFlow"], "synology");
    assert_eq!(body["password"], PASSWORD);
    assert!(body.get("username").is_none());
}

#[tokio::test]
async fn child_frame_started_after_page_injection_cannot_forbid_or_redeem_the_page_grant() {
    let fixture = fixture().await;
    let page = nonce(&document(&fixture, "/", true).await).expect("armed DSM page bootstrap");
    // DSM starts a nested frame after the page was served. It advances the
    // global issuance counter but is never selected by the frontend.
    let child = document(&fixture, "/webman/child.html", false).await;
    assert_eq!(fixture.state.document_sequence.load(Ordering::SeqCst), 2);
    assert_eq!(fixture.state.network.activate_document(1), Ok(false));
    // The non-selected child cannot obtain the username with its own nonce,
    // and that refusal neither consumes nor disarms the selected page grant.
    if let Some(child) = nonce(&child) {
        assert_ne!(child, page);
        refused(&fixture, &child, false).await;
    }
    assert!(fixture.state.auto_login_armed.load(Ordering::SeqCst));
    let continuation = username(&fixture, &page).await;
    refused(&fixture, &page, false).await;
    password(&fixture, &continuation).await;
    refused(&fixture, &continuation, true).await;
}

#[tokio::test]
async fn password_continuation_survives_child_documents_but_not_a_selected_document_change() {
    // Survives: the password panel's later child frame is not a navigation.
    let fixture = fixture().await;
    let page = nonce(&document(&fixture, "/", true).await).unwrap();
    let continuation = username(&fixture, &page).await;
    let child = document(&fixture, "/webman/child.html", false).await;
    // Released username disarms page grants: the child gets no bootstrap.
    assert!(nonce(&child).is_none());
    // A non-selected child cannot use a guessed or its own token either.
    refused(&fixture, TOKEN, true).await;
    password(&fixture, &continuation).await;

    // Dies: the frontend selects a successor top-level document.
    let fixture = self::fixture().await;
    let page = nonce(&document(&fixture, "/", true).await).unwrap();
    let continuation = username(&fixture, &page).await;
    document(&fixture, "/webman/index.cgi", false).await;
    assert_eq!(fixture.state.network.activate_document(2), Ok(true));
    refused(&fixture, &continuation, true).await;
    // The revocation is permanent, even for the original token.
    refused(&fixture, &continuation, true).await;
    assert!(!fixture.state.auto_login_armed.load(Ordering::SeqCst));
}

#[tokio::test]
async fn selected_markerless_successor_page_redeems_its_own_grant_and_old_page_nonce_dies() {
    let fixture = fixture().await;
    let first = nonce(&document(&fixture, "/", true).await).unwrap();
    // A markerless DSM reload/redirect before any credential was released.
    let second = nonce(&document(&fixture, "/webman/index.cgi", false).await)
        .expect("armed successor page bootstrap");
    assert_ne!(first, second);
    // Not selected yet: the successor cannot redeem, and the page is intact.
    refused(&fixture, &second, false).await;
    assert_eq!(fixture.state.network.activate_document(2), Ok(true));
    refused(&fixture, &first, false).await;
    assert!(fixture.state.auto_login_armed.load(Ordering::SeqCst));
    let continuation = username(&fixture, &second).await;
    password(&fixture, &continuation).await;
}

#[test]
fn page_grants_are_bounded_per_document_and_never_released_for_another_page() {
    assert_eq!(
        crate::themed_autologin::SYNOLOGY_FORM_READINESS_LIFETIME,
        Duration::from_secs(300)
    );
    let mut login = DirectSynologyLogin::default();
    assert!(login.record_page(0, None).is_none());
    let first = login.record_page(1, Some(1)).unwrap();
    // Recording the same document again neither re-mints nor renews.
    let issued = login.pages[&1].issued;
    assert_eq!(
        login.record_page(1, Some(1)).as_deref(),
        Some(first.as_str())
    );
    assert_eq!(login.pages[&1].issued, issued);
    for document in 2..=20 {
        assert!(login.record_page(document, Some(1)).is_some());
    }
    assert_eq!(login.pages.len(), MAX_CANDIDATE_DOCUMENTS);
    assert!(login.pages.contains_key(&1) && login.pages.contains_key(&20));
    assert!(!login.pages.contains_key(&2));
    // Empty, wrong and other pages' nonces never release and never consume.
    let latest = login.pages[&20].nonce.clone();
    assert!(login.release_account(1, "").is_none());
    assert!(login.release_account(1, "wrong").is_none());
    assert!(login.release_account(1, &latest).is_none());
    assert!(login.release_account(20, &first).is_none());
    assert!(login.release_account(7, &first).is_none());
    assert_eq!(login.pages.len(), MAX_CANDIDATE_DOCUMENTS);
    assert!(login.password.is_none());
    // Superseded pages die once a later page is selected, and a late response
    // for an older document gets no grant.
    assert!(login.record_page(5, Some(20)).is_none());
    assert_eq!(login.pages.keys().copied().collect::<Vec<_>>(), vec![20]);
    // An expired page grant never releases.
    login.pages.get_mut(&20).unwrap().issued =
        Instant::now() - crate::themed_autologin::SYNOLOGY_FORM_READINESS_LIFETIME;
    assert!(login.release_account(20, &latest).is_none());
    let current = login.record_page(21, Some(20)).unwrap();
    assert_eq!(login.pages.keys().copied().collect::<Vec<_>>(), vec![21]);
    let token = login.release_account(21, &current).unwrap();
    assert!(login.pages.is_empty());
    // Released username: no further page grant for any document.
    assert!(login.record_page(22, Some(21)).is_none());
    assert!(login.release_account(21, &current).is_none());
    assert_eq!(
        login.redeem_password(Some(21), "wrong"),
        PasswordRedemption::Refused
    );
    assert_eq!(
        login.redeem_password(Some(21), ""),
        PasswordRedemption::Refused
    );
    login.password.as_mut().unwrap().issued = Instant::now() - Duration::from_secs(89);
    assert_eq!(
        login.redeem_password(Some(21), &token),
        PasswordRedemption::Released
    );
    assert_eq!(
        login.redeem_password(Some(21), &token),
        PasswordRedemption::Refused
    );
}

#[test]
fn password_continuation_lasts_ninety_seconds_and_selection_change_revokes_it() {
    assert_eq!(
        crate::themed_autologin::SYNOLOGY_FORM_PASSWORD_LIFETIME,
        Duration::from_secs(90)
    );
    let released = |selected| {
        let mut login = DirectSynologyLogin::default();
        let page = login.record_page(selected, Some(selected)).unwrap();
        let token = login.release_account(selected, &page).unwrap();
        (login, token)
    };
    for (selected_at_redemption, aged) in [
        (Some(4), Duration::ZERO),
        (None, Duration::ZERO),
        (
            Some(3),
            crate::themed_autologin::SYNOLOGY_FORM_PASSWORD_LIFETIME,
        ),
    ] {
        let (mut login, token) = released(3);
        login.password.as_mut().unwrap().issued = Instant::now() - aged;
        assert_eq!(
            login.redeem_password(selected_at_redemption, &token),
            PasswordRedemption::Revoked
        );
        // Revocation is permanent, even back on the released document.
        assert_eq!(
            login.redeem_password(Some(3), &token),
            PasswordRedemption::Refused
        );
        assert!(login.password.is_none() && login.pages.is_empty());
    }
    // Inside the stage, the selected document redeems exactly once.
    let (mut login, token) = released(3);
    login.password.as_mut().unwrap().issued = Instant::now() - Duration::from_secs(89);
    assert_eq!(
        login.redeem_password(Some(3), &token),
        PasswordRedemption::Released
    );
}
