//! Exchange-shaped synthetic forms over protected loopback proxy + CONNECT TLS.
//! No Exchange server, real account, frontend adapter or remote request is used.
use super::*;
use crate::http::*;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::rustls;

const SOURCE: &str = "https://exchange.fixture.test:4443";
const PROXY: &str = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const MIME: &str = "application/x-www-form-urlencoded";
const COOKIE_ENDPOINT: &str = "/__sortofremoteng_exchange_cookie_v1";
const COOKIE_PATH: &str = "X-Sorng-Exchange-Cookie-Path";
const BEFORE: &str =
    "username=fixture%5cdomain%2buser&password=fixture%26%3D%2B%25+caf%C3%A9&flags=4&";
const AFTER: &str = "&forcedownlevel=0&trusted=0&isUtf8=1&empty=&flag=one&flag=two";

fn encoded(value: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("destination", value)
        .finish()
}
fn form(value: &str) -> Vec<u8> {
    format!("{BEFORE}{}{AFTER}", encoded(value)).into_bytes()
}
fn headers() -> Vec<(String, String)> {
    vec![("Content-Type".into(), MIME.into())]
}
fn prepare<'a>(body: &'a [u8]) -> Result<Cow<'a, [u8]>, &'static str> {
    prepare_body(
        true,
        &reqwest::Method::POST,
        &reqwest::Url::parse(&format!("{SOURCE}/owa/auth.owa")).unwrap(),
        SOURCE,
        PROXY,
        &headers(),
        body,
    )
}

#[test]
fn exchange_ecp_maps_only_destination_and_preserves_every_other_form_byte() {
    assert_eq!(
        serde_json::to_string(&ReviewedApplicationProfile::ExchangeEcp).unwrap(),
        "\"exchange-ecp\""
    );
    for path in [
        "/ecp",
        "/ecp/",
        "/ECP/Users.aspx",
        "/ecp/Users.aspx?first=a%26b&second=x%3Dy&space=a+b",
    ] {
        let original = form(&format!("{PROXY}{path}"));
        let mapped = prepare(&original).unwrap();
        assert_eq!(mapped.as_ref(), form(&format!("{SOURCE}{path}")));
        assert!(mapped.starts_with(BEFORE.as_bytes()) && mapped.ends_with(AFTER.as_bytes()));
        let fields: Vec<_> = url::form_urlencoded::parse(&mapped).collect();
        assert_eq!(
            fields[0],
            ("username".into(), "fixture\\domain+user".into())
        );
        assert_eq!(fields[1], ("password".into(), "fixture&=+% café".into()));
        let saved = form(&format!("{SOURCE}{path}"));
        assert!(matches!(prepare(&saved).unwrap(), Cow::Borrowed(_)));
        assert_eq!(prepare(&saved).unwrap().as_ref(), saved);
    }
    let relative = form("/ECP/Users.aspx?a=a%26b&b=x%3Dy");
    let auth = reqwest::Url::parse(&format!("{SOURCE}/OWA/Auth.owa")).unwrap();
    assert_eq!(
        prepare_body(
            true,
            &reqwest::Method::POST,
            &auth,
            SOURCE,
            PROXY,
            &headers(),
            &relative
        )
        .unwrap()
        .as_ref(),
        form(&format!("{SOURCE}/ECP/Users.aspx?a=a%26b&b=x%3Dy"))
    );
}

#[test]
fn exchange_ecp_rejects_unsafe_duplicate_missing_and_ambiguously_encoded_destinations() {
    for destination in [
        "",
        "//exchange.fixture.test:4443/ecp/",
        "https://evil.test/ecp/",
        "http://exchange.fixture.test:4443/ecp/",
        "https://exchange.fixture.test/ecp/",
        "https://exchange.fixture.test:4443.evil.test/ecp/",
        "https://user:secret@exchange.fixture.test:4443/ecp/",
        "https://exchange.fixture.test:4443/ecp/#fragment",
        "https://exchange.fixture.test:4443/owa/",
        "https://exchange.fixture.test:4443/ecp-other/",
        "https://exchange.fixture.test:4443/ecp/../owa/",
        "https://exchange.fixture.test:4443/ecp/%2e%2e/owa/",
        "https://exchange.fixture.test:4443/ecp/%252e%252e/owa/",
        "https://exchange.fixture.test:4443/ecp/%2f..%2fowa/",
        "https://exchange.fixture.test:4443/ecp/%5c..%5cowa/",
        "https://exchange.fixture.test:4443/ecp/%00",
        "https://exchange.fixture.test:4443/ecp/%61",
        "/ecp//Users.aspx",
        " https://exchange.fixture.test:4443/ecp/",
        "https://exchange.fixture.test:4443\\ecp/",
        "http://other.localhost:43123/ecp/",
        "http://p0123456789abcdef0123456789abcdef.localhost:43124/ecp/",
    ] {
        assert!(
            prepare(&form(destination)).is_err(),
            "accepted unsafe fixture destination"
        );
    }
    let valid = encoded(&format!("{PROXY}/ecp/"));
    for body in [
        "username=fixture&password=fixture".into(),
        "destination".into(),
        "destination=".into(),
        "destination=%FF".into(),
        "destination=%2".into(),
        "destination=%GG".into(),
        format!("{valid}&destination=https%3A%2F%2Fevil.test%2Fecp%2F"),
        format!("{valid}&Destination=unsafe"),
        format!("{valid}&%64estination=unsafe"),
    ] {
        assert!(prepare(body.as_bytes()).is_err());
    }
}

#[test]
fn exchange_ecp_requires_https_and_form_content_type_without_affecting_other_requests() {
    let input = form(&format!("{PROXY}/ecp/"));
    let url = reqwest::Url::parse(&format!("{SOURCE}/owa/auth.owa")).unwrap();
    for headers in [
        vec![],
        vec![("content-type".into(), "application/json".into())],
        vec![
            ("content-type".into(), MIME.into()),
            ("Content-Type".into(), MIME.into()),
        ],
        vec![
            ("content-type".into(), MIME.into()),
            ("content-encoding".into(), "gzip".into()),
        ],
    ] {
        assert!(prepare_body(
            true,
            &reqwest::Method::POST,
            &url,
            SOURCE,
            PROXY,
            &headers,
            &input
        )
        .is_err());
    }
    let http = reqwest::Url::parse("http://exchange.fixture.test/owa/auth.owa").unwrap();
    assert!(prepare_body(
        true,
        &reqwest::Method::POST,
        &http,
        "http://exchange.fixture.test",
        PROXY,
        &headers(),
        &input
    )
    .is_err());
    for (reviewed, method, path) in [
        (false, reqwest::Method::POST, "/owa/auth.owa"),
        (true, reqwest::Method::GET, "/owa/auth.owa"),
        (true, reqwest::Method::POST, "/other"),
        (true, reqwest::Method::POST, "/owa/auth.owa/extra"),
    ] {
        let request = reqwest::Url::parse(&format!("{SOURCE}{path}")).unwrap();
        assert!(matches!(
            prepare_body(
                reviewed,
                &method,
                &request,
                SOURCE,
                PROXY,
                &[],
                b"unrelated bytes%GG"
            )
            .unwrap(),
            Cow::Borrowed(_)
        ));
    }
}

struct Fixture {
    base: String,
    state: Arc<AxumProxyState>,
    seen: Arc<std::sync::Mutex<Vec<(String, Vec<u8>)>>>,
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
async fn head<S: AsyncRead + Unpin>(socket: &mut S) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        assert!(bytes.len() < 16_384);
        bytes.push(socket.read_u8().await.unwrap());
    }
    String::from_utf8(bytes).unwrap()
}
fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim())
}
fn browser() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}
async fn fixture(reviewed: bool) -> Fixture {
    let cert = rcgen::generate_simple_self_signed(vec!["exchange.fixture.test".into()]).unwrap();
    let der = cert.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = reqwest::Client::builder()
        .no_proxy()
        // Deliberately retain a second jar: the authoritative Exchange bridge
        // must suppress reqwest's stale cookies, including credentials=omit.
        .cookie_store(true)
        .proxy(reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let capture = seen.clone();
    let peer = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(head(&mut socket)
                .await
                .starts_with("CONNECT exchange.fixture.test:4443 HTTP/1.1"));
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut socket = acceptor.accept(socket).await.unwrap();
            let request = head(&mut socket).await;
            let length = header(&request, "content-length")
                .map_or(0, |value| value.parse::<usize>().unwrap());
            assert!(length < 16_384);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            let path = request
                .split_whitespace()
                .nth(1)
                .unwrap()
                .split('?')
                .next()
                .unwrap()
                .to_ascii_lowercase();
            let html = request.starts_with("GET ") && path == "/owa/auth/logon.aspx";
            let redirect = request.starts_with("POST /redirect");
            let form_post = request.starts_with("POST ") && path == "/owa/auth.owa";
            let reply_status = url::form_urlencoded::parse(&body)
                .find(|(key, _)| key == "reply")
                .and_then(|(_, value)| value.parse::<u16>().ok())
                .unwrap_or(303);
            let login_error = url::form_urlencoded::parse(&body)
                .any(|(key, value)| key == "failure" && value == "1");
            capture.lock().unwrap().push((request, body));
            let (mime, content) = if html {
                (
                    "text/html",
                    format!(
                        r#"<!doctype html><html><head></head><body><form method="post" action="{SOURCE}/owa/auth.owa"><input name="destination" type="hidden" value="{SOURCE}/ecp/Users.aspx?first=a%26b&amp;second=x%3Dy&amp;space=a+b"><input name="username"><input name="password" type="password"></form></body></html>"#
                    ),
                )
            } else {
                ("application/json", "{}".into())
            };
            let response = if path == "/ecp" {
                "HTTP/1.1 301 Moved Permanently\r\nLocation: /ECP/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
            } else if path == "/ecp/" {
                "HTTP/1.1 302 Found\r\nLocation: /OWA/Auth/Logon.aspx?url=%2Fecp%2F&raw=%2f+%20\r\nSet-Cookie: login=fixture; Domain=exchange.fixture.test; Secure; HttpOnly; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
            } else if form_post {
                let target = if login_error {
                    "/OWA/Auth/Logon.aspx?reason=2"
                } else {
                    "/ECP/Users.aspx?first=a%26b&second=x%3Dy"
                };
                format!("HTTP/1.1 {reply_status} Redirect\r\nLocation: {target}\r\nSet-Cookie: auth=fixture-auth; Domain=exchange.fixture.test; Secure; HttpOnly; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            } else if redirect {
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: /owa/auth.owa\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
            } else if path == "/ecp/cookie-fixture" {
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: server_visible=one; Domain=exchange.fixture.test; Secure; SameSite=Lax; Path=/\r\nSet-Cookie: scoped=ecp; Secure; HttpOnly; Path=/ecp/\r\nSet-Cookie: expired=gone; Secure; Max-Age=0; Path=/\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into()
            } else {
                format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}", content.len())
            };
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let local = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = local.local_addr().unwrap().port();
    let authority = format!("p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let network = ProxyNetworkState::default().with_reviewed_application_profile(
        reviewed.then_some(ReviewedApplicationProfile::ExchangeEcp),
    );
    let network = if reviewed {
        network.with_exchange_cookies(SOURCE).unwrap()
    } else {
        network
    };
    let state = Arc::new(AxumProxyState {
        attempt: None,
        network: Arc::new(network),
        website_dark_mode: Default::default(),
        session_id: uuid::Uuid::new_v4().to_string(),
        connection_id: "ecp-fixture".into(),
        target_url: SOURCE.into(),
        target_origin: SOURCE.into(),
        username: Arc::new(std::sync::RwLock::new("unused-saved-user".into())),
        password: Arc::new(std::sync::RwLock::new("unused-saved-password".into())),
        upstream_auth_mode: UpstreamAuthMode::None,
        proxy_policy: HttpProxyPolicy::default(),
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Default::default(),
        theme: Arc::new(std::sync::RwLock::new(
            crate::theme_tokens::ThemeTokens::dark_default(),
        )),
        proxy_origin: format!("http://{authority}"),
        proxy_authority: authority,
        auto_login_armed: Arc::new(AtomicBool::new(false)),
        auto_login_nonce: Default::default(),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: crate::http::yealink_login::session_slot(),
        client: upstream,
        document_sequence: Arc::new(AtomicU64::new(0)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Default::default(),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    });
    let router = ProxySessionRuntime::new(state.clone()).router();
    let proxy = tokio::spawn(async move {
        axum::serve(local, router).await.unwrap();
    });
    Fixture {
        base: format!("http://127.0.0.1:{port}"),
        state,
        seen,
        tasks: vec![peer, proxy],
    }
}
fn request(fixture: &Fixture, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
    browser()
        .request(method, format!("{}{path}", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
}

fn assert_cookie_pairs(actual: &str, expected: &[&str]) {
    let mut actual: Vec<_> = actual
        .split(';')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect();
    let mut expected = expected.to_vec();
    actual.sort_unstable();
    expected.sort_unstable();
    assert_eq!(actual, expected);
}

async fn cookie_read(fixture: &Fixture, path: &str) -> String {
    let response = request(fixture, reqwest::Method::GET, COOKIE_ENDPOINT)
        .header(COOKIE_PATH, path)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    response.text().await.unwrap()
}

async fn cookie_write(fixture: &Fixture, path: &str, value: &str) {
    let response = request(fixture, reqwest::Method::POST, COOKIE_ENDPOINT)
        .header(COOKIE_PATH, path)
        .body(value.to_owned())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 204);
    assert!(!response.headers().contains_key("set-cookie"));
    assert!(response.bytes().await.unwrap().is_empty());
}

#[tokio::test]
async fn exchange_ecp_cookie_bridge_roundtrips_probe_overrides_deletes_and_isolates_sessions() {
    let fixture = fixture(true).await;
    let other = self::fixture(true).await;
    let path = "/owa/auth/logon.aspx";
    assert_eq!(cookie_read(&fixture, path).await, "");
    cookie_write(&fixture, path, "PBack=0; Path=/; Secure").await;
    assert_eq!(cookie_read(&fixture, path).await, "PBack=0");
    assert_eq!(cookie_read(&other, path).await, "");
    cookie_write(&fixture, path, "PBack=1; Path=/; Secure").await;
    assert_eq!(cookie_read(&fixture, path).await, "PBack=1");
    cookie_write(&fixture, path, "PBack=; Max-Age=0; Path=/; Secure").await;
    assert_eq!(cookie_read(&fixture, path).await, "");

    cookie_write(&fixture, path, "default_path=owa; Secure").await;
    cookie_write(
        &fixture,
        path,
        "expired=past; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure",
    )
    .await;
    assert_eq!(cookie_read(&fixture, path).await, "default_path=owa");
    assert_eq!(cookie_read(&fixture, "/ecp/Users.aspx").await, "");
    // Cookie paths are literal URL pathnames, not navigation destinations.
    cookie_write(
        &fixture,
        "/ecp/%2foutside",
        "literal=encoded; Path=/ecp/%2foutside; Secure",
    )
    .await;
    assert_eq!(
        cookie_read(&fixture, "/ecp/%2foutside").await,
        "literal=encoded"
    );
    assert_eq!(cookie_read(&fixture, "/ecp/outside").await, "");
    assert!(
        fixture.seen.lock().unwrap().is_empty(),
        "Cookie bridge must never reach upstream"
    );
    assert!(other.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exchange_ecp_native_cookies_hide_httponly_ignore_poison_and_keep_upstream_path_scope() {
    let fixture = fixture(true).await;
    for path in ["/ecp/", "/ecp/cookie-fixture"] {
        let response = request(&fixture, reqwest::Method::GET, path)
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success() || response.status().is_redirection());
        assert!(!response.headers().contains_key("set-cookie"));
        let _ = response.bytes().await.unwrap();
    }
    let document = "/ecp/Users.aspx";
    assert_eq!(cookie_read(&fixture, document).await, "server_visible=one");
    // Neither overwrite nor deletion through document.cookie may touch HttpOnly.
    cookie_write(&fixture, document, "login=script-poison; Path=/; Secure").await;
    cookie_write(&fixture, document, "login=; Max-Age=0; Path=/; Secure").await;
    cookie_write(
        &fixture,
        document,
        "script_hidden=bad; HttpOnly; Path=/; Secure",
    )
    .await;
    cookie_write(
        &fixture,
        document,
        "foreign=bad; Domain=evil.test; Path=/; Secure",
    )
    .await;
    cookie_write(&fixture, document, "server_visible=two; Path=/; Secure").await;
    assert_eq!(cookie_read(&fixture, document).await, "server_visible=two");

    for path in ["/ecp/Users.aspx", "/owa/auth/logon.aspx", "/ecp-other"] {
        let response = request(&fixture, reqwest::Method::GET, path)
            .header(
                "Cookie",
                "login=poisoned; scoped=poisoned; browser_only=poisoned",
            )
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(!response.headers().contains_key("set-cookie"));
        let _ = response.bytes().await.unwrap();
    }
    {
        let seen = fixture.seen.lock().unwrap();
        assert_eq!(seen.len(), 5);
        assert_cookie_pairs(
            header(&seen[2].0, "cookie").unwrap(),
            &["login=fixture", "server_visible=two", "scoped=ecp"],
        );
        for index in [3, 4] {
            assert_cookie_pairs(
                header(&seen[index].0, "cookie").unwrap(),
                &["login=fixture", "server_visible=two"],
            );
        }
    }
    cookie_write(
        &fixture,
        document,
        "server_visible=; Path=/; Max-Age=0; Secure",
    )
    .await;
    assert_eq!(cookie_read(&fixture, document).await, "");
    let response = request(&fixture, reqwest::Method::GET, "/owa/auth/logon.aspx")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let _ = response.bytes().await.unwrap();
    assert_eq!(
        header(&fixture.seen.lock().unwrap().last().unwrap().0, "cookie"),
        Some("login=fixture")
    );
}

#[tokio::test]
async fn exchange_ecp_cookie_bridge_rejects_foreign_origin_invalid_paths_and_unprotected_host() {
    let fixture = fixture(true).await;
    cookie_write(&fixture, "/ecp/", "visible=fixture; Secure; Path=/").await;
    for method in [reqwest::Method::GET, reqwest::Method::POST] {
        let response = browser()
            .request(method.clone(), format!("{}{COOKIE_ENDPOINT}", fixture.base))
            .header("Host", &fixture.state.proxy_authority)
            .header("Origin", "https://evil.test")
            .header(COOKIE_PATH, "/ecp/")
            .body("visible=poisoned; Path=/; Secure")
            .send()
            .await
            .unwrap();
        assert!(response.status().is_client_error());
        assert!(!response.text().await.unwrap().contains("visible=fixture"));
        let response = browser()
            .request(method, format!("{}{COOKIE_ENDPOINT}", fixture.base))
            .header("Origin", &fixture.state.proxy_origin)
            .header(COOKIE_PATH, "/ecp/")
            .body("visible=poisoned; Path=/; Secure")
            .send()
            .await
            .unwrap();
        assert!(response.status().is_client_error());
    }
    for path in [
        "https://evil.test/ecp/",
        "//evil.test/ecp/",
        "/ecp/../owa/",
        "/ecp/#fragment",
    ] {
        let response = request(&fixture, reqwest::Method::GET, COOKIE_ENDPOINT)
            .header(COOKIE_PATH, path)
            .send()
            .await
            .unwrap();
        assert!(
            response.status().is_client_error(),
            "Accepted invalid document path: {path}"
        );
    }
    let response = request(&fixture, reqwest::Method::GET, COOKIE_ENDPOINT)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_client_error());
    assert_eq!(cookie_read(&fixture, "/ecp/").await, "visible=fixture");
    assert!(fixture.seen.lock().unwrap().is_empty());
}

#[test]
fn exchange_ecp_native_cookie_state_requires_https_saved_origin() {
    for origin in [
        "http://exchange.fixture.test",
        "https://user:secret@exchange.fixture.test",
        "not-an-origin",
    ] {
        assert!(ProxyNetworkState::default()
            .with_reviewed_application_profile(Some(ReviewedApplicationProfile::ExchangeEcp))
            .with_exchange_cookies(origin)
            .is_err());
    }
}

#[tokio::test]
async fn exchange_ecp_html_rewrite_then_form_post_restores_destination_without_changing_credentials(
) {
    let fixture = fixture(true).await;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    let mut path = format!("/ECP?__sorng_navigation_v1={TOKEN}");
    for (status, expected_path) in [(301, "/ECP/"), (302, "/OWA/Auth/Logon.aspx")] {
        let response = request(&fixture, reqwest::Method::GET, &path)
            .header("Sec-Fetch-Dest", "iframe")
            .header("Sec-Fetch-Mode", "navigate")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        assert!(!response.headers().contains_key("set-cookie"));
        let location =
            reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
        assert_eq!(
            location.origin().ascii_serialization(),
            fixture.state.proxy_origin
        );
        assert_eq!(location.path(), expected_path);
        assert!(location
            .query_pairs()
            .any(|(key, value)| key == "__sorng_navigation_v1" && value == TOKEN));
        if status == 302 {
            assert!(location
                .query()
                .unwrap()
                .starts_with("url=%2Fecp%2F&raw=%2f+%20&"));
        }
        path = location[url::Position::BeforePath..].to_string();
    }
    let response = request(&fixture, reqwest::Method::GET, &path)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    let html = response.text().await.unwrap();
    // The login document's initial cookie probe must work before submission,
    // independently of HttpOnly cookies already retained from the redirect.
    let document_path = "/OWA/Auth/Logon.aspx";
    assert_eq!(cookie_read(&fixture, document_path).await, "");
    cookie_write(&fixture, document_path, "PBack=0; Path=/; Secure").await;
    assert_eq!(cookie_read(&fixture, document_path).await, "PBack=0");
    cookie_write(&fixture, document_path, "PBack=; Path=/; Secure; Max-Age=0").await;
    assert_eq!(cookie_read(&fixture, document_path).await, "");
    let input = html.split("name=\"destination\"").nth(1).unwrap();
    let attribute = input
        .split("value=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    assert!(attribute.starts_with(&fixture.state.proxy_origin));
    assert!(attribute.contains("&amp;second="));
    // Browser HTML attribute decoding followed by native form serialization.
    let value = attribute.replace("&amp;", "&");
    let body = form(&value);
    let response = request(
        &fixture,
        reqwest::Method::POST,
        &format!("/OWA/Auth.owa?__sorng_navigation_v1={TOKEN}"),
    )
    .header(
        "Content-Type",
        "application/x-www-form-urlencoded; charset=UTF-8",
    )
    .body(body)
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 303);
    assert!(!response.headers().contains_key("set-cookie"));
    let location = reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
    assert_eq!(
        location.origin().ascii_serialization(),
        fixture.state.proxy_origin
    );
    assert_eq!(location.path(), "/ECP/Users.aspx");
    assert!(location
        .query_pairs()
        .any(|(key, value)| key == "__sorng_navigation_v1" && value == TOKEN));
    let response = request(
        &fixture,
        reqwest::Method::GET,
        &location[url::Position::BeforePath..],
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    assert_eq!(response.text().await.unwrap(), "{}");
    // The successful POST's auth cookie is native and HttpOnly, not a
    // browser-visible cookie or a value exposed by the script bridge.
    assert_eq!(cookie_read(&fixture, "/ECP/Users.aspx").await, "");
    let seen = fixture.seen.lock().unwrap();
    assert_eq!(seen.len(), 5);
    assert!(seen[2]
        .0
        .starts_with("GET /OWA/Auth/Logon.aspx?url=%2Fecp%2F&raw=%2f+%20 HTTP/1.1"));
    assert!(seen[4]
        .0
        .starts_with("GET /ECP/Users.aspx?first=a%26b&second=x%3Dy HTTP/1.1"));
    assert!(seen[4].1.is_empty());
    assert_eq!(header(&seen[2].0, "cookie"), Some("login=fixture"));
    assert_eq!(header(&seen[3].0, "cookie"), Some("login=fixture"));
    assert_cookie_pairs(
        header(&seen[4].0, "cookie").unwrap(),
        &["login=fixture", "auth=fixture-auth"],
    );
    let (head, body) = &seen[3];
    let expected = form(&format!(
        "{SOURCE}/ecp/Users.aspx?first=a%26b&second=x%3Dy&space=a+b"
    ));
    assert!(head.starts_with("POST /OWA/Auth.owa HTTP/1.1"));
    assert_eq!(body, &expected);
    assert_eq!(
        header(head, "content-length"),
        Some(expected.len().to_string().as_str())
    );
    assert_eq!(
        header(head, "content-type"),
        Some("application/x-www-form-urlencoded; charset=UTF-8")
    );
    assert!(header(head, "authorization").is_none());
    assert!(!String::from_utf8_lossy(body).contains("unused-saved"));
}

#[tokio::test]
async fn exchange_ecp_credentials_omit_suppresses_native_request_and_response_cookies() {
    let fixture = fixture(true).await;
    let response = request(&fixture, reqwest::Method::GET, "/ecp/")
        .header("x-sorng-exchange-credentials", "include")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 302);
    assert!(!response.headers().contains_key("set-cookie"));
    let _ = response.bytes().await.unwrap();

    // An omitted login POST must neither send the existing login cookie nor
    // retain the returned auth cookie. No browser Cookie is supplied anywhere.
    let response = request(&fixture, reqwest::Method::POST, "/owa/auth.owa")
        .header("x-sorng-exchange-credentials", "omit")
        .header("Content-Type", MIME)
        .body(form("/ecp/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 303);
    assert!(!response.headers().contains_key("set-cookie"));
    let _ = response.bytes().await.unwrap();
    let response = request(&fixture, reqwest::Method::GET, "/ecp/cookie-fixture")
        .header("x-sorng-exchange-credentials", "omit")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    let _ = response.bytes().await.unwrap();
    assert_eq!(cookie_read(&fixture, "/ecp/Users.aspx").await, "");

    let response = request(&fixture, reqwest::Method::GET, "/ecp/Users.aspx")
        .header("x-sorng-exchange-credentials", "include")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let _ = response.bytes().await.unwrap();
    // Included submission now stores the auth cookie for the final ECP GET.
    let response = request(&fixture, reqwest::Method::POST, "/owa/auth.owa")
        .header("x-sorng-exchange-credentials", "include")
        .header("Content-Type", MIME)
        .body(form("/ecp/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 303);
    assert!(!response.headers().contains_key("set-cookie"));
    let _ = response.bytes().await.unwrap();
    for mode in ["omit", "include"] {
        let response = request(&fixture, reqwest::Method::GET, "/ecp/Users.aspx")
            .header("x-sorng-exchange-credentials", mode)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(!response.headers().contains_key("set-cookie"));
        let _ = response.bytes().await.unwrap();
    }
    let seen = fixture.seen.lock().unwrap();
    assert_eq!(seen.len(), 7);
    for index in [0, 1, 2, 5] {
        assert!(header(&seen[index].0, "cookie").map_or(true, |value| value.trim().is_empty()));
    }
    for index in [3, 4] {
        assert_eq!(header(&seen[index].0, "cookie"), Some("login=fixture"));
    }
    assert_cookie_pairs(
        header(&seen[6].0, "cookie").unwrap(),
        &["login=fixture", "auth=fixture-auth"],
    );
    for (head, _) in seen.iter() {
        assert!(
            header(head, "x-sorng-exchange-credentials").is_none(),
            "Internal credential mode leaked upstream"
        );
    }
}

#[tokio::test]
async fn exchange_ecp_rejects_malicious_form_before_network_but_generic_is_unchanged() {
    let fixture = fixture(true).await;
    for destination in [
        "https://evil.test/ecp/",
        "https://user:secret@exchange.fixture.test:4443/ecp/",
        "https://exchange.fixture.test:4443/ecp/#fragment",
        "https://exchange.fixture.test:4443/owa/",
        "http://other.localhost:1234/ecp/",
    ] {
        let response = request(&fixture, reqwest::Method::POST, "/owa/auth.owa")
            .header("Content-Type", MIME)
            .body(form(destination))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
        let response = response.text().await.unwrap();
        assert!(!response.contains("user:secret") && !response.contains("evil.test"));
    }
    assert!(fixture.seen.lock().unwrap().is_empty());
    assert_eq!(fixture.state.request_count.load(Ordering::SeqCst), 5);
    let generic = self::fixture(false).await;
    let body = form(&format!("{}/ecp/", generic.state.proxy_origin));
    let response = request(&generic, reqwest::Method::POST, "/owa/auth.owa")
        .header("Content-Type", MIME)
        .body(body.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "{}");
    assert_eq!(generic.seen.lock().unwrap()[0].1, body);
}

#[tokio::test]
async fn exchange_ecp_validates_redirected_post_hops_before_sending_to_auth_endpoint() {
    let fixture = fixture(true).await;
    let body = form("https://evil.test/ecp/");
    let response = request(&fixture, reqwest::Method::POST, "/redirect")
        .header("Content-Type", MIME)
        .body(body.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    let _ = response.text().await.unwrap();
    let seen = fixture.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].0.starts_with("POST /redirect HTTP/1.1"));
    assert_eq!(seen[0].1, body);
}

#[tokio::test]
async fn exchange_ecp_post_results_preserve_302_303_and_refuse_307_308_credential_replay() {
    for status in [302, 303, 307, 308] {
        let fixture = fixture(true).await;
        let mut body = form("/ECP/");
        body.extend_from_slice(format!("&reply={status}").as_bytes());
        let response = request(&fixture, reqwest::Method::POST, "/owa/auth.owa")
            .header("Content-Type", MIME)
            .body(body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), if status < 307 { status } else { 400 });
        if status < 307 {
            assert!(response.headers()["location"]
                .to_str()
                .unwrap()
                .starts_with(&format!("{}/ECP/Users.aspx?", fixture.state.proxy_origin)));
        } else {
            assert!(!response.headers().contains_key("location"));
        }
        let _ = response.text().await.unwrap();
        assert_eq!(
            fixture.seen.lock().unwrap().len(),
            1,
            "No native follow/replay after the login POST"
        );
    }
    let fixture = fixture(true).await;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    let mut body = form("/ecp/");
    body.extend_from_slice(b"&reply=302&failure=1");
    let response = request(
        &fixture,
        reqwest::Method::POST,
        &format!("/owa/auth.owa?__sorng_navigation_v1={TOKEN}"),
    )
    .header("Content-Type", MIME)
    .body(body)
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 302);
    let location = reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
    assert_eq!(location.path(), "/OWA/Auth/Logon.aspx");
    assert!(location.query().unwrap().starts_with("reason=2&"));
    assert!(location
        .query_pairs()
        .any(|(key, value)| key == "__sorng_navigation_v1" && value == TOKEN));
    assert_eq!(fixture.seen.lock().unwrap().len(), 1);
}

#[test]
fn exchange_ecp_redirect_preservation_is_reviewed_same_origin_and_closed_to_other_routes() {
    let source = reqwest::Url::parse(&format!("{SOURCE}/ECP/")).unwrap();
    let login = reqwest::Url::parse(&format!("{SOURCE}/OWA/Auth/Logon.aspx?reason=2")).unwrap();
    assert!(preserves_redirect(
        true,
        &reqwest::Method::GET,
        302,
        &source,
        &login
    ));
    assert!(!preserves_redirect(
        false,
        &reqwest::Method::GET,
        302,
        &source,
        &login
    ));
    for destination in [
        "https://evil.test/owa/auth/logon.aspx",
        "https://exchange.fixture.test:4443/other",
        "https://user:secret@exchange.fixture.test:4443/owa/auth/logon.aspx",
        "https://exchange.fixture.test:4443/owa/auth/logon.aspx#fragment",
    ] {
        assert!(!preserves_redirect(
            true,
            &reqwest::Method::GET,
            302,
            &source,
            &reqwest::Url::parse(destination).unwrap()
        ));
    }
    let auth = reqwest::Url::parse(&format!("{SOURCE}/owa/auth.owa")).unwrap();
    for status in [301, 307, 308] {
        assert!(!preserves_redirect(
            true,
            &reqwest::Method::POST,
            status,
            &auth,
            &source
        ));
    }
}
