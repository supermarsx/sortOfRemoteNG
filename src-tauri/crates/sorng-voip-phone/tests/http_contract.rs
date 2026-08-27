//! HTTP contract tests for the Yealink driver against a hand-rolled
//! `std::net::TcpListener` mock (no httpmock/wiremock — workspace policy).
//! Fixtures under `tests/fixtures/` mirror the e2e fake phone
//! (`e2e/fixtures/voip-phone/`), copied rather than cross-referenced.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine;
use rsa::traits::PublicKeyParts;
use sorng_voip_phone::error::VoipPhoneErrorKind;
use sorng_voip_phone::service::VoipPhoneService;
use sorng_voip_phone::types::*;
use sorng_voip_phone::vendor::build_http;

const USER: &str = "admin";
const PASS: &str = "T66_VOIP_SENTINEL_SECRET_pw!";

// ── mock server ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Req {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: String,
}

impl Req {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }
    fn has_basic(&self, user: &str, pass: &str) -> bool {
        let want = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"))
        );
        self.header("authorization") == Some(want.as_str())
    }
    fn form_field(&self, name: &str) -> Option<String> {
        self.body.split('&').find_map(|kv| {
            let (k, v) = kv.split_once('=')?;
            (k == name).then(|| percent_decode(v))
        })
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
                out.push(u8::from_str_radix(hex, 16).unwrap());
                i += 2;
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8(out).unwrap()
}

struct Resp {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Resp {
    fn new(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.into(),
        }
    }
    fn header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }
    fn redirect(location: &str) -> Self {
        Self::new(302, "").header("Location", location)
    }
    fn basic_challenge(realm: &str) -> Self {
        Self::new(401, "Unauthorized")
            .header("WWW-Authenticate", &format!("Basic realm=\"{realm}\""))
    }
}

type Handler = Arc<dyn Fn(&Req) -> Resp + Send + Sync>;

struct MockServer {
    base_url: String,
    requests: Arc<Mutex<Vec<Req>>>,
}

impl MockServer {
    fn start(handler: Handler) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let requests: Arc<Mutex<Vec<Req>>> = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&requests);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let Some(req) = read_request(&mut stream) else {
                    continue;
                };
                log.lock().unwrap().push(req.clone());
                let resp = handler(&req);
                let reason = match resp.status {
                    200 => "OK",
                    302 => "Found",
                    401 => "Unauthorized",
                    403 => "Forbidden",
                    404 => "Not Found",
                    _ => "Other",
                };
                let mut out = format!("HTTP/1.1 {} {}\r\n", resp.status, reason);
                for (k, v) in &resp.headers {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str(&format!(
                    "Content-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    resp.body.len(),
                    resp.body
                ));
                let _ = stream.write_all(out.as_bytes());
            }
        });
        Self {
            base_url: format!("http://{address}"),
            requests,
        }
    }

    fn port(&self) -> u16 {
        self.base_url.rsplit(':').next().unwrap().parse().unwrap()
    }

    fn requests(&self) -> Vec<Req> {
        self.requests.lock().unwrap().clone()
    }

    fn targets(&self) -> Vec<String> {
        self.requests().into_iter().map(|r| r.target).collect()
    }
}

fn read_request(stream: &mut std::net::TcpStream) -> Option<Req> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 2048];
    while !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            return None;
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    let split = bytes.windows(4).position(|w| w == b"\r\n\r\n")? + 4;
    let head = String::from_utf8_lossy(&bytes[..split]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = bytes[split..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
    }
    Some(Req {
        method,
        target,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("fixture file")
}

fn config(server: &MockServer) -> VoipPhoneConnectionConfig {
    VoipPhoneConnectionConfig {
        host: "127.0.0.1".into(),
        port: server.port(),
        use_ssl: false,
        verify_cert: true,
        vendor: VoipPhoneVendor::Yealink,
        username: USER.into(),
        password: PASS.into(),
        timeout_secs: 3,
        auth_mode: VoipPhoneAuthMode::Auto,
        action_uri_enabled: true,
    }
}

// ── phone emulations ─────────────────────────────────────────────────────────

const LEGACY_CGI: &str = "/cgi-bin/ConfigManApp.com";
const SERVLET_LOGIN_FORM: &str = "/servlet?m=mod_listener&p=login&q=loginForm";
const SERVLET_LOGIN_POST: &str = "/servlet?m=mod_listener&p=login&q=login";
const SERVLET_STATUS: &str = "/servlet?m=mod_data&p=status&q=load";
const SERVLET_REBOOT_FORM: &str = "/servlet?m=mod_data&p=settings-upgrade&q=reboot";
const SESSION: &str = "JSESSIONID=abc123def456; Path=/";

/// Legacy T21P: everything behind Basic; `action_uri_status` controls `?key=Reboot`.
fn legacy_phone(action_uri_status: u16) -> Handler {
    Arc::new(move |req: &Req| {
        if !req.has_basic(USER, PASS) {
            return Resp::basic_challenge("Yealink SIP-T21P");
        }
        match (req.method.as_str(), req.target.as_str()) {
            ("GET", "/") => Resp::redirect(LEGACY_CGI),
            ("GET", "/cgi-bin/ConfigManApp.com?Id=1") => {
                Resp::new(200, fixture("legacy_status.html"))
            }
            ("GET", "/cgi-bin/ConfigManApp.com?key=Reboot") => Resp::new(action_uri_status, ""),
            ("POST", LEGACY_CGI) if req.form_field("Reboot").as_deref() == Some("Reboot") => {
                Resp::new(200, "<html>Rebooting...</html>")
            }
            ("GET", LEGACY_CGI) => Resp::new(
                200,
                "<html><form action=\"ConfigManApp.com\"></form></html>",
            ),
            _ => Resp::new(404, "not found"),
        }
    })
}

/// Servlet T21P E2. `rsa`: serve the RSA login page and decrypt with the
/// matching private key. `action_uri_status` controls `/servlet?key=Reboot`.
fn servlet_phone(rsa: Option<Arc<rsa::RsaPrivateKey>>, action_uri_status: u16) -> Handler {
    let modulus_hex = rsa.as_ref().map(|k| k.n().to_str_radix(16));
    Arc::new(move |req: &Req| {
        let logged_in = req
            .header("cookie")
            .is_some_and(|c| c.contains("JSESSIONID=abc123def456"));
        match (req.method.as_str(), req.target.as_str()) {
            ("GET", "/") => Resp::redirect(SERVLET_LOGIN_FORM),
            ("GET", SERVLET_LOGIN_FORM) => match &modulus_hex {
                Some(m) => Resp::new(
                    200,
                    fixture("servlet_login_rsa.html").replace("{{MODULUS}}", m),
                ),
                None => Resp::new(200, fixture("servlet_login_plain.html")),
            },
            ("POST", SERVLET_LOGIN_POST) => {
                let user_ok = req.form_field("username").as_deref() == Some(USER);
                let pwd = req.form_field("pwd").unwrap_or_default();
                let pass_ok = match (&rsa, &modulus_hex) {
                    (Some(key), Some(m)) => {
                        let cipher = base64::engine::general_purpose::STANDARD
                            .decode(pwd.as_bytes())
                            .expect("pwd is base64");
                        let plain = key
                            .decrypt(rsa::Pkcs1v15Encrypt, &cipher)
                            .expect("pwd decrypts with the page key");
                        req.form_field("rsakey").as_deref() == Some(m.as_str())
                            && plain == PASS.as_bytes()
                    }
                    _ => pwd == PASS,
                };
                if user_ok && pass_ok {
                    Resp::redirect(SERVLET_STATUS).header("Set-Cookie", SESSION)
                } else {
                    Resp::new(200, fixture("servlet_login_plain.html"))
                }
            }
            ("GET", "/servlet?key=Reboot") => {
                if req.has_basic(USER, PASS) || logged_in {
                    Resp::new(action_uri_status, "")
                } else {
                    Resp::new(401, "")
                }
            }
            _ if !logged_in => Resp::redirect(SERVLET_LOGIN_FORM),
            ("GET", SERVLET_STATUS) => Resp::new(200, fixture("servlet_status.html")),
            ("POST", SERVLET_REBOOT_FORM) => Resp::new(200, "<html>Rebooting</html>"),
            ("GET", "/servlet?m=mod_listener&p=login&q=logout") => {
                Resp::redirect(SERVLET_LOGIN_FORM)
            }
            _ => Resp::new(404, "not found"),
        }
    })
}

fn test_rsa_key() -> Arc<rsa::RsaPrivateKey> {
    let mut rng = rand::thread_rng();
    Arc::new(rsa::RsaPrivateKey::new(&mut rng, 1024).expect("generate test RSA key"))
}

// ── legacy generation ────────────────────────────────────────────────────────

#[tokio::test]
async fn legacy_basic_login_succeeds_with_200() {
    let server = MockServer::start(legacy_phone(200));
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();

    assert_eq!(summary.generation, VoipPhoneGeneration::Legacy);
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::Basic);
    assert!(summary.web_ui_url.ends_with(LEGACY_CGI));

    let reqs = server.requests();
    // probe (no creds, gets 401 challenge) then Basic login probe
    assert_eq!(reqs[0].target, "/");
    assert!(
        reqs[0].header("authorization").is_none(),
        "probe must not send credentials"
    );
    assert_eq!(reqs[1].target, LEGACY_CGI);
    assert!(reqs[1].has_basic(USER, PASS));
}

#[tokio::test]
async fn legacy_basic_login_401_is_structured_auth_error() {
    let server = MockServer::start(legacy_phone(200));
    let mut svc = VoipPhoneService::new();
    let mut cfg = config(&server);
    cfg.password = "wrong".into();
    let err = svc.connect("p1".into(), cfg).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Auth);
    assert_eq!(err.auth_shape, Some(VoipPhoneAuthShape::Basic));
    assert!(err.to_string().contains("auth shape: basic"));
    assert!(svc.list().is_empty());
}

#[tokio::test]
async fn legacy_status_is_scraped_from_cgi_page() {
    let server = MockServer::start(legacy_phone(200));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let status = svc.status("p1").await.unwrap();

    assert_eq!(status.generation, VoipPhoneGeneration::Legacy);
    assert_eq!(status.model.as_deref(), Some("SIP-T21P"));
    assert_eq!(status.firmware.as_deref(), Some("52.73.0.40"));
    assert_eq!(status.hardware.as_deref(), Some("52.0.0.16.0.0.0"));
    assert_eq!(status.mac.as_deref(), Some("00:15:65:AB:CD:EF"));
    assert_eq!(status.ip.as_deref(), Some("192.168.10.42"));
    assert_eq!(status.uptime.as_deref(), Some("3 days 04:12:55"));
    assert_eq!(status.accounts.len(), 2);
    assert!(status.accounts[0].registered);
    assert_eq!(status.accounts[0].raw_state, "Registered");
    assert!(!status.accounts[1].registered);
    assert!(status.raw_fields.contains_key("Firmware Version"));
    let last = server.requests().pop().unwrap();
    assert_eq!(last.target, "/cgi-bin/ConfigManApp.com?Id=1");
    assert!(last.has_basic(USER, PASS));
}

#[tokio::test]
async fn legacy_reboot_action_uri_then_form_fallback() {
    // Action URI accepted.
    let server = MockServer::start(legacy_phone(200));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let r = svc.reboot("p1").await.unwrap();
    assert_eq!(r.method, VoipRebootMethod::ActionUri);
    assert!(r.accepted);

    // Action URI 404 → web form `Reboot=Reboot`.
    let server = MockServer::start(legacy_phone(404));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let r = svc.reboot("p1").await.unwrap();
    assert_eq!(r.method, VoipRebootMethod::WebForm);
    let reqs = server.requests();
    let n = reqs.len();
    assert_eq!(reqs[n - 2].target, "/cgi-bin/ConfigManApp.com?key=Reboot");
    assert_eq!(reqs[n - 1].method, "POST");
    assert_eq!(reqs[n - 1].form_field("Reboot").as_deref(), Some("Reboot"));
}

// ── servlet generation ───────────────────────────────────────────────────────

#[tokio::test]
async fn servlet_form_plain_login_sets_session_cookie() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();

    assert_eq!(summary.generation, VoipPhoneGeneration::Servlet);
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::FormPlain);
    assert!(summary.web_ui_url.ends_with(SERVLET_LOGIN_FORM));

    let targets = server.targets();
    assert_eq!(targets, vec!["/", SERVLET_LOGIN_FORM, SERVLET_LOGIN_POST]);
    let post = &server.requests()[2];
    assert_eq!(post.form_field("username").as_deref(), Some(USER));
    assert_eq!(post.form_field("pwd").as_deref(), Some(PASS));
    assert!(post.form_field("rsakey").is_none());
}

#[tokio::test]
async fn servlet_form_rsa_login_encrypts_password_with_page_key() {
    let key = test_rsa_key();
    let server = MockServer::start(servlet_phone(Some(Arc::clone(&key)), 200));
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::FormRsa);

    let post = &server.requests()[2];
    assert_eq!(post.target, SERVLET_LOGIN_POST);
    assert_ne!(
        post.form_field("pwd").as_deref(),
        Some(PASS),
        "password must not travel in clear"
    );
    assert!(!post.body.contains(PASS));
    assert_eq!(post.form_field("rsakey").unwrap(), key.n().to_str_radix(16));
    // The mock decrypted + compared the password itself (login succeeded).
    let status = svc.status("p1").await.unwrap();
    assert_eq!(status.auth_shape, VoipPhoneAuthShape::FormRsa);
}

#[tokio::test]
async fn servlet_rejected_login_reports_shape() {
    let key = test_rsa_key();
    let server = MockServer::start(servlet_phone(Some(key), 200));
    let mut svc = VoipPhoneService::new();
    let mut cfg = config(&server);
    cfg.password = "wrong".into();
    let err = svc.connect("p1".into(), cfg).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Auth);
    assert_eq!(err.auth_shape, Some(VoipPhoneAuthShape::FormRsa));
    assert!(err.message.contains("Open Web UI"));
}

#[tokio::test]
async fn servlet_status_uses_session_cookie_and_parses_accounts() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let status = svc.status("p1").await.unwrap();

    assert_eq!(status.model.as_deref(), Some("SIP-T21P_E2"));
    assert_eq!(status.firmware.as_deref(), Some("52.84.0.15"));
    assert_eq!(status.hardware.as_deref(), Some("52.1.0.128.0.0.0"));
    assert_eq!(status.mac.as_deref(), Some("00:15:65:12:34:56"));
    assert_eq!(status.ip.as_deref(), Some("10.0.0.77"));
    assert!(status.uptime.is_none(), "missing fields never fail");
    assert_eq!(status.accounts.len(), 2);
    assert_eq!(status.accounts[0].user.as_deref(), Some("1001"));
    assert_eq!(status.accounts[0].server.as_deref(), Some("pbx.lan"));
    assert!(status.accounts[0].registered);
    assert!(!status.accounts[1].registered);
    assert_eq!(status.accounts[1].raw_state, "Register Failed");
    assert_ne!(status.firmware.as_deref(), Some("SCRIPT-JUNK"));

    let last = server.requests().pop().unwrap();
    assert_eq!(last.target, SERVLET_STATUS);
    assert!(last
        .header("cookie")
        .unwrap()
        .contains("JSESSIONID=abc123def456"));
    assert!(last.header("authorization").is_none());
}

#[tokio::test]
async fn servlet_reboot_action_uri_200() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let r = svc.reboot("p1").await.unwrap();
    assert_eq!(r.method, VoipRebootMethod::ActionUri);
    assert!(r.accepted);
    let last = server.requests().pop().unwrap();
    assert_eq!(last.target, "/servlet?key=Reboot");
    assert!(last.has_basic(USER, PASS));
}

#[tokio::test]
async fn servlet_reboot_403_falls_back_to_web_form() {
    let server = MockServer::start(servlet_phone(None, 403));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    let r = svc.reboot("p1").await.unwrap();
    assert_eq!(r.method, VoipRebootMethod::WebForm);
    assert!(r.accepted);
    let reqs = server.requests();
    let n = reqs.len();
    assert_eq!(reqs[n - 2].target, "/servlet?key=Reboot");
    assert_eq!(reqs[n - 1].method, "POST");
    assert_eq!(reqs[n - 1].target, SERVLET_REBOOT_FORM);
    assert!(reqs[n - 1].header("cookie").unwrap().contains("JSESSIONID"));
}

#[tokio::test]
async fn reboot_skips_action_uri_when_disabled_in_config() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    let mut cfg = config(&server);
    cfg.action_uri_enabled = false;
    svc.connect("p1".into(), cfg).await.unwrap();
    let r = svc.reboot("p1").await.unwrap();
    assert_eq!(r.method, VoipRebootMethod::WebForm);
    assert!(!server.targets().iter().any(|t| t.contains("key=Reboot")));
}

#[tokio::test]
async fn forced_form_auth_mode_skips_detection() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    let mut cfg = config(&server);
    cfg.auth_mode = VoipPhoneAuthMode::Form;
    svc.connect("p1".into(), cfg).await.unwrap();
    assert_eq!(server.targets()[0], SERVLET_LOGIN_FORM);
}

#[tokio::test]
async fn disconnect_logs_out_and_drops_session() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    svc.connect("p1".into(), config(&server)).await.unwrap();
    assert_eq!(svc.list().len(), 1);
    svc.disconnect("p1").await.unwrap();
    assert!(svc.list().is_empty());
    assert_eq!(
        server.targets().last().unwrap(),
        "/servlet?m=mod_listener&p=login&q=logout"
    );
    let err = svc.status("p1").await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::NotConnected);
    assert_eq!(
        svc.disconnect("p1").await.unwrap_err().kind,
        VoipPhoneErrorKind::NotConnected
    );
}

#[tokio::test]
async fn web_login_hints_per_generation() {
    let server = MockServer::start(servlet_phone(None, 200));
    let mut svc = VoipPhoneService::new();
    svc.connect("s".into(), config(&server)).await.unwrap();
    let hint = svc.web_login_hint("s").unwrap();
    assert!(hint.form_login);
    assert_eq!(
        hint.username_selector.as_deref(),
        Some("input[name=username]")
    );
    assert_eq!(hint.password_selector.as_deref(), Some("input[name=pwd]"));
    assert!(hint.submit_selector.is_some());
    assert!(hint.login_url.ends_with(SERVLET_LOGIN_FORM));

    let server = MockServer::start(legacy_phone(200));
    svc.connect("l".into(), config(&server)).await.unwrap();
    let hint = svc.web_login_hint("l").unwrap();
    assert!(!hint.form_login);
    assert!(hint.username_selector.is_none());
    assert!(hint.login_url.ends_with(LEGACY_CGI));
}

// ── detection / probe ────────────────────────────────────────────────────────

#[tokio::test]
async fn probe_detects_without_sending_credentials() {
    let server = MockServer::start(servlet_phone(None, 200));
    let svc = VoipPhoneService::new();
    let p = svc.probe(config(&server)).await.unwrap();
    assert_eq!(p.generation, VoipPhoneGeneration::Servlet);
    assert_eq!(p.expected_auth_shape, VoipPhoneAuthShape::FormPlain);
    let reqs = server.requests();
    assert_eq!(reqs.len(), 1);
    assert!(reqs[0].header("authorization").is_none());
    assert!(reqs[0].body.is_empty());

    let server = MockServer::start(legacy_phone(200));
    let p = svc.probe(config(&server)).await.unwrap();
    assert_eq!(p.generation, VoipPhoneGeneration::Legacy);
    assert_eq!(p.expected_auth_shape, VoipPhoneAuthShape::Basic);
    assert!(server.requests()[0].header("authorization").is_none());
}

#[tokio::test]
async fn unknown_web_ui_is_unsupported_with_hint() {
    let server = MockServer::start(Arc::new(|_: &Req| {
        Resp::new(200, fixture("unknown_index.html"))
    }));
    let svc = VoipPhoneService::new();
    let err = svc.probe(config(&server)).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Unsupported);
    assert!(err.message.contains("HTTP 200"));
    assert!(err.message.contains("nginx"));
}

#[tokio::test]
async fn connection_refused_is_connection_error() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let svc = VoipPhoneService::new();
    let cfg = VoipPhoneConnectionConfig {
        host: "127.0.0.1".into(),
        port,
        password: PASS.into(),
        timeout_secs: 2,
        ..Default::default()
    };
    let err = svc.probe(cfg).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Connection);
    assert!(!err.to_string().contains(PASS));
}

#[test]
fn https_client_builds_through_trust_center() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let cfg = VoipPhoneConnectionConfig {
        host: "phone.lan".into(),
        port: 443,
        use_ssl: true,
        verify_cert: false,
        password: PASS.into(),
        ..Default::default()
    };
    let http = build_http(&cfg).expect("TOFU client builds");
    assert_eq!(http.base_url, "https://phone.lan:443");
}

// ── secret hygiene ───────────────────────────────────────────────────────────

#[tokio::test]
async fn sentinel_password_absent_from_every_serialized_type() {
    let server = MockServer::start(servlet_phone(None, 403));
    let mut svc = VoipPhoneService::new();
    let cfg = config(&server);

    let cfg_json = serde_json::to_string(&cfg).unwrap();
    assert!(!cfg_json.contains(PASS));
    assert!(!cfg_json.contains("\"password\""));

    let summary = svc.connect("p1".into(), cfg).await.unwrap();
    let status = svc.status("p1").await.unwrap();
    let reboot = svc.reboot("p1").await.unwrap();
    let hint = svc.web_login_hint("p1").unwrap();
    let safe = svc.get_config_safe("p1").unwrap();
    let list = svc.list();
    let probe = svc.probe(config(&server)).await.unwrap();

    for (name, json) in [
        ("summary", serde_json::to_string(&summary).unwrap()),
        ("status", serde_json::to_string(&status).unwrap()),
        ("reboot", serde_json::to_string(&reboot).unwrap()),
        ("hint", serde_json::to_string(&hint).unwrap()),
        ("safe", serde_json::to_string(&safe).unwrap()),
        ("list", serde_json::to_string(&list).unwrap()),
        ("probe", serde_json::to_string(&probe).unwrap()),
        ("safe-debug", format!("{safe:?}")),
    ] {
        assert!(!json.contains(PASS), "{name} leaks the password: {json}");
        assert!(
            !json.contains("\"password\""),
            "{name} has a password field: {json}"
        );
    }
    assert_eq!(safe.username, USER);

    // Errors (Display + serialized) never carry the secret either.
    let mut bad = config(&server);
    bad.password = PASS.into();
    bad.username = "nobody".into();
    let err = svc.connect("p2".into(), bad).await.unwrap_err();
    let err_json = serde_json::to_string(&err).unwrap();
    assert!(!err.to_string().contains(PASS));
    assert!(!err_json.contains(PASS));
    assert!(err_json.contains("auth shape: form-plain"));

    svc.disconnect("p1").await.unwrap();
    assert!(svc.get_config_safe("p1").is_err());
}
