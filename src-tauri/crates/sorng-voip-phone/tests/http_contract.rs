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
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use rand::SeedableRng;
use rsa::traits::PublicKeyParts;
use sorng_voip_phone::error::VoipPhoneErrorKind;
use sorng_voip_phone::service::VoipPhoneService;
use sorng_voip_phone::types::*;
use sorng_voip_phone::vendor::build_http;
use sorng_voip_phone::yealink_servlet_auth as auth;

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
const SESSION_ID: &str = "abc123def456";
const SESSION: &str = "JSESSIONID=abc123def456; Path=/; HttpOnly";

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

/// What the mock phone answers the login POST with, regardless of the
/// credentials — used to drive `classify_login_response` through the driver.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ForcedAnswer {
    Lock,
    Bounce,
    Garbage,
    /// The false positive this task fixes: HTTP 200, no `loginForm` marker, no
    /// redirect, and a `JSESSIONID` — but `{"authstatus":"none"}`.
    RejectedWithCookie,
}

impl ForcedAnswer {
    fn response(self) -> Resp {
        match self {
            Self::Lock => Resp::new(200, fixture("servlet_login_response_lock.html")),
            Self::Bounce => Resp::new(200, fixture("servlet_login_response_bounce.html")),
            Self::Garbage => Resp::new(502, fixture("servlet_login_response_garbage.html")),
            Self::RejectedWithCookie => Resp::new(200, fixture("servlet_login_response_none.html"))
                .header("Set-Cookie", SESSION),
        }
    }
}

/// Servlet T21P E2 emulation.
#[derive(Clone)]
struct ServletPhone {
    /// `Some` = the login page carries an RSA key and the phone decrypts the
    /// attested RSA+AES body. `None` = pre-RSA firmware serving a plain form.
    rsa: Option<Arc<rsa::RsaPrivateKey>>,
    /// Login-page fixture (`{{MODULUS}}` / `{{EXPONENT}}` substituted).
    login_page: &'static str,
    action_uri_status: u16,
    forced: Option<ForcedAnswer>,
}

impl ServletPhone {
    /// The attested T21P E2: `g_rsa_n` / `g_rsa_e` markup, RSA+AES login.
    fn attested(key: &Arc<rsa::RsaPrivateKey>) -> Self {
        Self {
            rsa: Some(Arc::clone(key)),
            login_page: "servlet_login_g_rsa.html",
            action_uri_status: 200,
            forced: None,
        }
    }

    /// The older markup, where the key lives in `var rsakey` / `setPublic`.
    fn legacy_markup(key: &Arc<rsa::RsaPrivateKey>) -> Self {
        Self {
            login_page: "servlet_login_rsa.html",
            ..Self::attested(key)
        }
    }

    /// Pre-RSA firmware: no key anywhere on the page.
    fn plain() -> Self {
        Self {
            rsa: None,
            login_page: "servlet_login_plain.html",
            action_uri_status: 200,
            forced: None,
        }
    }

    fn action_uri(mut self, status: u16) -> Self {
        self.action_uri_status = status;
        self
    }

    fn answering(mut self, forced: ForcedAnswer) -> Self {
        self.forced = Some(forced);
        self
    }

    fn handler(self) -> Handler {
        let modulus_hex = self.rsa.as_ref().map(|k| k.n().to_str_radix(16));
        let exponent_hex = self.rsa.as_ref().map(|k| k.e().to_str_radix(16));
        // A session id exists from the form GET onwards; only a *successful*
        // login marks it authenticated, exactly like the real phone.
        let authenticated = Arc::new(Mutex::new(false));
        Arc::new(move |req: &Req| {
            let has_cookie = req
                .header("cookie")
                .is_some_and(|c| c.contains(&format!("JSESSIONID={SESSION_ID}")));
            let logged_in = has_cookie && *authenticated.lock().unwrap();
            // Both login URLs carry a cache-buster, and `…q=login` is a prefix
            // of `…q=loginForm`, so match on prefixes in that order.
            let is_form = |t: &str| t.starts_with(SERVLET_LOGIN_FORM);
            let is_post = |t: &str| t.starts_with(SERVLET_LOGIN_POST) && !is_form(t);

            match (req.method.as_str(), req.target.as_str()) {
                ("GET", "/") => Resp::redirect(SERVLET_LOGIN_FORM),
                ("GET", t) if is_form(t) => {
                    let mut page = fixture(self.login_page);
                    if let (Some(m), Some(e)) = (&modulus_hex, &exponent_hex) {
                        page = page.replace("{{MODULUS}}", m).replace("{{EXPONENT}}", e);
                    }
                    // The attested flow hands out the session *before*
                    // authenticating: the ciphertext is bound to it.
                    Resp::new(200, page).header("Set-Cookie", SESSION)
                }
                ("POST", t) if is_post(t) => {
                    if let Some(forced) = self.forced {
                        return forced.response();
                    }
                    if !req.target.contains("Rajax=") {
                        return Resp::new(400, "missing Rajax cache buster");
                    }
                    let user_ok = req.form_field("username").as_deref() == Some(USER);
                    let creds_ok = match &self.rsa {
                        Some(key) => {
                            decode_rsa_aes_login(key, req) == Some((SESSION_ID.into(), PASS.into()))
                        }
                        None => req.form_field("pwd").as_deref() == Some(PASS),
                    };
                    if !(user_ok && creds_ok) {
                        // A rejected login is an HTTP 200 carrying the verdict
                        // and nothing else — no redirect, no login-form marker.
                        return Resp::new(200, fixture("servlet_login_response_none.html"));
                    }
                    *authenticated.lock().unwrap() = true;
                    match &self.rsa {
                        // Attested: `{"authstatus":"done"}` in the body.
                        Some(_) => Resp::new(200, fixture("servlet_login_response_done.html")),
                        // Pre-RSA: a redirect straight into the data area.
                        None => Resp::redirect(SERVLET_STATUS),
                    }
                }
                ("GET", "/servlet?key=Reboot") => {
                    if req.has_basic(USER, PASS) || logged_in {
                        Resp::new(self.action_uri_status, "")
                    } else {
                        Resp::new(401, "")
                    }
                }
                _ if !logged_in => Resp::redirect(SERVLET_LOGIN_FORM),
                ("GET", SERVLET_STATUS) => Resp::new(200, fixture("servlet_status.html")),
                ("POST", SERVLET_REBOOT_FORM) => Resp::new(200, "<html>Rebooting</html>"),
                ("GET", "/servlet?m=mod_listener&p=login&q=logout") => {
                    *authenticated.lock().unwrap() = false;
                    Resp::redirect(SERVLET_LOGIN_FORM)
                }
                _ => Resp::new(404, "not found"),
            }
        })
    }
}

fn hex16(s: &str) -> Option<[u8; 16]> {
    if s.len() != 32 {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

#[derive(Debug, PartialEq, Eq)]
struct DecodedLogin {
    key_hex: String,
    iv_hex: String,
    random: String,
    session: String,
    password: String,
}

/// Undo the attested wrapper exactly as the phone does.
///
/// Mirrors `decodeRsaAesLogin` in `e2e/fixtures/voip-phone/server.mjs`, which
/// is the other half of the same contract: RSA-PKCS#1v1.5 over base64 for the
/// 32-hex-character AES key and IV, then AES-128-CBC with zero padding over
/// `"<random>;<JSESSIONID>;<password>"`.
fn decode_login_fields(
    key: &rsa::RsaPrivateKey,
    field: impl Fn(&str) -> Option<String>,
) -> Option<DecodedLogin> {
    let unwrap = |name: &str| -> Option<String> {
        let cipher = base64::engine::general_purpose::STANDARD
            .decode(field(name)?.as_bytes())
            .ok()?;
        String::from_utf8(key.decrypt(rsa::Pkcs1v15Encrypt, &cipher).ok()?).ok()
    };
    let key_hex = unwrap("rsakey")?;
    let iv_hex = unwrap("rsaiv")?;
    let aes_key = hex16(&key_hex)?;
    let aes_iv = hex16(&iv_hex)?;

    let mut buf = base64::engine::general_purpose::STANDARD
        .decode(field("pwd")?.as_bytes())
        .ok()?;
    if buf.is_empty() || buf.len() % 16 != 0 {
        return None;
    }
    let mut dec = cbc::Decryptor::<aes::Aes128>::new((&aes_key).into(), (&aes_iv).into());
    for block in buf.as_chunks_mut::<16>().0 {
        dec.decrypt_block_mut(block.into());
    }
    let plain = String::from_utf8(buf).ok()?;
    let plain = plain.trim_end_matches('\0');
    let mut parts = plain.splitn(3, ';');
    Some(DecodedLogin {
        key_hex,
        iv_hex,
        random: parts.next()?.to_string(),
        session: parts.next()?.to_string(),
        password: parts.next()?.to_string(),
    })
}

/// `(JSESSIONID, password)` the phone reads out of one login POST.
fn decode_rsa_aes_login(key: &rsa::RsaPrivateKey, req: &Req) -> Option<(String, String)> {
    let decoded = decode_login_fields(key, |name| req.form_field(name))?;
    (!decoded.random.is_empty()).then_some((decoded.session, decoded.password))
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
async fn servlet_pre_rsa_firmware_posts_a_plain_password() {
    // The only path that may post a plain password: the page carries no key
    // in *any* attested shape, so there is nothing to encrypt with.
    let server = MockServer::start(ServletPhone::plain().handler());
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();

    assert_eq!(summary.generation, VoipPhoneGeneration::Servlet);
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::FormPlain);
    assert!(summary.web_ui_url.ends_with(SERVLET_LOGIN_FORM));

    let reqs = server.requests();
    assert_eq!(reqs.len(), 3);
    assert_eq!(reqs[0].target, "/");
    assert!(reqs[1].target.starts_with(SERVLET_LOGIN_FORM));
    let post = &reqs[2];
    assert!(post.target.starts_with(SERVLET_LOGIN_POST));
    assert_eq!(post.form_field("username").as_deref(), Some(USER));
    assert_eq!(post.form_field("pwd").as_deref(), Some(PASS));
    assert!(post.form_field("rsakey").is_none());
    assert!(post.form_field("rsaiv").is_none());
}

#[tokio::test]
async fn servlet_login_wraps_the_password_in_aes_under_the_page_rsa_key() {
    let key = test_rsa_key();
    let server = MockServer::start(ServletPhone::attested(&key).handler());
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();
    // The mock decrypted the body itself and compared the password and the
    // session id, so reaching here IS the round-trip assertion.
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::FormRsaAes);

    let reqs = server.requests();
    let post = &reqs[2];
    assert!(post.target.starts_with(SERVLET_LOGIN_POST));
    assert!(
        post.target.contains("Rajax="),
        "the login POST carries the cache buster the phone's own page sends"
    );
    assert!(
        reqs[1].target.contains("Random="),
        "the login-page GET carries the cache buster too"
    );

    // The wire shape: exactly the four attested fields, none in clear.
    let mut fields: Vec<&str> = post
        .body
        .split('&')
        .filter_map(|kv| kv.split_once('=').map(|(k, _)| k))
        .collect();
    fields.sort_unstable();
    assert_eq!(fields, vec!["pwd", "rsaiv", "rsakey", "username"]);
    assert_ne!(post.form_field("pwd").as_deref(), Some(PASS));
    assert!(
        !post.body.contains(PASS),
        "password must not travel in clear"
    );
    assert!(
        !post.body.contains(SESSION_ID),
        "the session id travels encrypted, not as a form field"
    );
    // The modulus itself is never a form field — `rsakey` carries the wrapped
    // AES key. Sending the modulus was the old (wrong) shape.
    assert_ne!(
        post.form_field("rsakey").unwrap(),
        key.n().to_str_radix(16),
        "rsakey must carry the wrapped AES key, not the page's modulus"
    );

    let status = svc.status("p1").await.unwrap();
    assert_eq!(status.auth_shape, VoipPhoneAuthShape::FormRsaAes);
}

/// REGRESSION (t96 §2.6): a rejected login answers HTTP 200 with
/// `{"authstatus":"none"}` — no `loginForm` marker, no redirect — and the
/// `JSESSIONID` the login page already set. The driver used to read that as a
/// connected phone.
#[tokio::test]
async fn servlet_rejected_login_with_a_session_cookie_is_not_success() {
    let key = test_rsa_key();
    let server = MockServer::start(
        ServletPhone::attested(&key)
            .answering(ForcedAnswer::RejectedWithCookie)
            .handler(),
    );
    let mut svc = VoipPhoneService::new();
    let err = svc.connect("p1".into(), config(&server)).await.unwrap_err();

    assert_eq!(err.kind, VoipPhoneErrorKind::Auth);
    assert_eq!(err.auth_shape, Some(VoipPhoneAuthShape::FormRsaAes));
    assert!(
        err.message.contains("rejected the username or password"),
        "unexpected message: {}",
        err.message
    );
    assert!(svc.list().is_empty(), "no session may be registered");

    // The answer really did carry a cookie and neither of the old success
    // tells, i.e. the old code would have accepted it.
    let answer = fixture("servlet_login_response_none.html");
    assert!(!answer.contains("loginForm"));
    assert!(!answer.contains("idUsername"));
    assert_eq!(
        server
            .requests()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1,
        "a rejected login is terminal — never retried"
    );
}

#[tokio::test]
async fn servlet_lockout_is_terminal_and_says_so() {
    let key = test_rsa_key();
    let server = MockServer::start(
        ServletPhone::attested(&key)
            .answering(ForcedAnswer::Lock)
            .handler(),
    );
    let mut svc = VoipPhoneService::new();
    let err = svc.connect("p1".into(), config(&server)).await.unwrap_err();

    assert_eq!(err.kind, VoipPhoneErrorKind::Auth);
    assert!(
        err.message.contains("locked this account"),
        "unexpected message: {}",
        err.message
    );
    assert_eq!(
        server
            .requests()
            .iter()
            .filter(|r| r.method == "POST")
            .count(),
        1,
        "a lockout must never be retried or backed off"
    );
}

#[tokio::test]
async fn servlet_session_bounce_and_garbage_fail_closed() {
    let key = test_rsa_key();
    let server = MockServer::start(
        ServletPhone::attested(&key)
            .answering(ForcedAnswer::Bounce)
            .handler(),
    );
    let mut svc = VoipPhoneService::new();
    let err = svc.connect("p1".into(), config(&server)).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Auth);
    assert!(err.message.contains("one web session at a time"));

    let server = MockServer::start(
        ServletPhone::attested(&key)
            .answering(ForcedAnswer::Garbage)
            .handler(),
    );
    let err = svc.connect("p2".into(), config(&server)).await.unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Unsupported);
    assert!(err.message.contains("Could not classify"));
    assert!(err.message.contains("HTTP 502"));
    assert!(svc.list().is_empty());
}

/// The older `var rsakey = "…"` markup must still be recognised as encrypted:
/// the alternates in `RSA_N_PATTERNS` are what stop it falling back to a
/// plaintext password (t96 §2.6, second half).
#[tokio::test]
async fn servlet_legacy_markup_still_encrypts_the_password() {
    let key = test_rsa_key();
    let server = MockServer::start(ServletPhone::legacy_markup(&key).handler());
    let mut svc = VoipPhoneService::new();
    let summary = svc.connect("p1".into(), config(&server)).await.unwrap();
    assert_eq!(summary.auth_shape, VoipPhoneAuthShape::FormRsaAes);
    let post = &server.requests()[2];
    assert!(!post.body.contains(PASS));
    assert!(post.form_field("rsaiv").is_some());
}

#[tokio::test]
async fn servlet_status_uses_session_cookie_and_parses_accounts() {
    let server = MockServer::start(ServletPhone::plain().handler());
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
    let server = MockServer::start(ServletPhone::plain().handler());
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
    let server = MockServer::start(ServletPhone::plain().action_uri(403).handler());
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
    let server = MockServer::start(ServletPhone::plain().handler());
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
    let server = MockServer::start(ServletPhone::plain().handler());
    let mut svc = VoipPhoneService::new();
    let mut cfg = config(&server);
    cfg.auth_mode = VoipPhoneAuthMode::Form;
    svc.connect("p1".into(), cfg).await.unwrap();
    assert!(server.targets()[0].starts_with(SERVLET_LOGIN_FORM));
}

#[tokio::test]
async fn disconnect_logs_out_and_drops_session() {
    let server = MockServer::start(ServletPhone::plain().handler());
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
    let server = MockServer::start(ServletPhone::plain().handler());
    let mut svc = VoipPhoneService::new();
    svc.connect("s".into(), config(&server)).await.unwrap();
    let hint = svc.web_login_hint("s").unwrap();
    assert!(hint.form_login);
    // The attested DOM ids first, the older markup as an alternate. The
    // confirm control is an <a>, so an `input[type=submit]`-only override
    // matches nothing and makes the embedded auto-login fail closed.
    assert_eq!(
        hint.username_selector.as_deref(),
        Some("#idUsername, input[name=\"username\"]")
    );
    assert_eq!(
        hint.password_selector.as_deref(),
        Some("#idPassword, input[name=\"pwd\"][type=\"password\"]")
    );
    assert_eq!(
        hint.submit_selector.as_deref(),
        Some("#idConfirm, input[type=\"submit\"][name=\"login\"]")
    );
    // The note no longer claims the browser auto-login works as-is (§2.5).
    let note = hint.note.unwrap();
    assert!(note.contains("not enough on its own"));
    assert!(!note.contains("runs as-is"));
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
    let server = MockServer::start(ServletPhone::plain().handler());
    let svc = VoipPhoneService::new();
    let p = svc.probe(config(&server)).await.unwrap();
    assert_eq!(p.generation, VoipPhoneGeneration::Servlet);
    assert_eq!(p.expected_auth_shape, VoipPhoneAuthShape::FormRsaAes);
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
    let server = MockServer::start(ServletPhone::plain().action_uri(403).handler());
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

// ── shared servlet-auth module (pure, no I/O) ────────────────────────────────

/// The anti-replay nonce is 8 random bytes, hex-encoded.
const NONCE_HEX_LEN: usize = 16;

fn fixed_rng() -> rand::rngs::StdRng {
    rand::rngs::StdRng::seed_from_u64(0x7961_6c69_6e6b)
}

fn attested_page(key: &rsa::RsaPrivateKey) -> String {
    fixture("servlet_login_g_rsa.html")
        .replace("{{MODULUS}}", &key.n().to_str_radix(16))
        .replace("{{EXPONENT}}", &key.e().to_str_radix(16))
}

#[test]
fn parse_login_form_reads_the_attested_markup() {
    let modulus = "ab".repeat(64);
    let facts = auth::parse_login_form(
        &fixture("servlet_login_g_rsa.html")
            .replace("{{MODULUS}}", &modulus)
            .replace("{{EXPONENT}}", "10001"),
    );
    assert!(facts.is_encrypted());
    assert_eq!(facts.rsa_n.as_deref(), Some(modulus.as_str()));
    assert_eq!(facts.rsa_e.as_deref(), Some("10001"));
    assert_eq!(facts.exponent_hex(), "10001");
    // Readable before authenticating, and the only two values this crate logs.
    assert_eq!(facts.phone_type.as_deref(), Some("T21P_E2"));
    assert_eq!(facts.firmware.as_deref(), Some("52.84.0.15"));
}

#[test]
fn parse_login_form_reads_the_older_markup_through_the_alternates() {
    // The `{64,}` guard means a short stub is not mistaken for a modulus.
    let facts =
        auth::parse_login_form(&fixture("servlet_login_rsa.html").replace("{{MODULUS}}", "beef00"));
    assert!(!facts.is_encrypted());

    let modulus = "cd".repeat(64);
    let facts =
        auth::parse_login_form(&fixture("servlet_login_rsa.html").replace("{{MODULUS}}", &modulus));
    assert_eq!(facts.rsa_n.as_deref(), Some(modulus.as_str()));
    // No `g_rsa_e` on this markup: the exponent comes from `setPublic`.
    assert_eq!(facts.rsa_e.as_deref(), Some("10001"));
    assert!(facts.phone_type.is_none() && facts.firmware.is_none());
}

#[test]
fn parse_login_form_finds_nothing_in_pages_that_carry_no_key() {
    for name in ["servlet_login_plain.html", "legacy_status.html"] {
        let facts = auth::parse_login_form(&fixture(name));
        assert_eq!(facts, Default::default(), "{name} must yield no facts");
        assert!(!facts.is_encrypted());
        assert_eq!(facts.exponent_hex(), "10001");
    }
}

#[test]
fn parse_login_form_prefers_g_rsa_n_over_the_legacy_alternate() {
    let modern = "11".repeat(64);
    let legacy = "22".repeat(64);
    let facts = auth::parse_login_form(&format!(
        "var rsakey = \"{legacy}\";\nvar g_rsa_n=\"{modern}\";"
    ));
    assert_eq!(facts.rsa_n.as_deref(), Some(modern.as_str()));
}

#[test]
fn classify_login_response_covers_every_answer() {
    let done = fixture("servlet_login_response_done.html");
    let none = fixture("servlet_login_response_none.html");
    let lock = fixture("servlet_login_response_lock.html");
    let bounce = fixture("servlet_login_response_bounce.html");
    let garbage = fixture("servlet_login_response_garbage.html");

    assert_eq!(
        auth::classify_login_response(200, None, &done),
        LoginOutcome::Done
    );
    assert_eq!(
        auth::classify_login_response(200, None, &none),
        LoginOutcome::BadCredentials
    );
    assert_eq!(
        auth::classify_login_response(200, None, &lock),
        LoginOutcome::Locked
    );
    assert_eq!(
        auth::classify_login_response(200, None, &bounce),
        LoginOutcome::SessionLost
    );
    // A redirect back to the login page, with no body at all.
    assert_eq!(
        auth::classify_login_response(302, Some(SERVLET_LOGIN_FORM), ""),
        LoginOutcome::SessionLost
    );
    // Pre-RSA firmware: a redirect straight into the data area is success.
    assert_eq!(
        auth::classify_login_response(302, Some(SERVLET_STATUS), ""),
        LoginOutcome::Done
    );

    // Everything unrecognised fails closed, with an actionable hint.
    let hint = match auth::classify_login_response(502, None, &garbage) {
        LoginOutcome::Unclassified(hint) => hint,
        other => panic!("expected Unclassified, got {other:?}"),
    };
    assert!(hint.contains("HTTP 502"));
    assert!(hint.contains("502 Bad Gateway"));
    assert!(matches!(
        auth::classify_login_response(200, None, ""),
        LoginOutcome::Unclassified(_)
    ));
    assert!(matches!(
        auth::classify_login_response(200, None, "{\"authstatus\":\"wat\"}"),
        LoginOutcome::Unclassified(_)
    ));
}

#[test]
fn classify_login_response_never_calls_a_contradictory_answer_success() {
    // "done" while redirecting back to the login page.
    assert!(matches!(
        auth::classify_login_response(302, Some(SERVLET_LOGIN_FORM), "{\"authstatus\":\"done\"}"),
        LoginOutcome::Unclassified(_)
    ));
    // Two disagreeing verdicts in one body: trust neither.
    assert!(matches!(
        auth::classify_login_response(
            200,
            None,
            "{\"authstatus\":\"done\"} ... {\"authstatus\":\"none\"}"
        ),
        LoginOutcome::Unclassified(_)
    ));
    // Whitespace and case variance still classifies.
    assert_eq!(
        auth::classify_login_response(200, None, "{ \"AuthStatus\" : \"DONE\" }"),
        LoginOutcome::Done
    );
}

/// REGRESSION (t96 §2.6): neither a `JSESSIONID` nor "HTTP 200 without the
/// `loginForm` marker" may count towards success — a rejected login is both.
#[test]
fn a_rejected_answer_has_none_of_the_old_success_tells() {
    let none = fixture("servlet_login_response_none.html");
    assert!(!none.contains("loginForm"));
    assert!(!none.contains("idUsername"));
    // The old rule was `200 && !body.contains("loginForm")` → success.
    assert_eq!(
        auth::classify_login_response(200, None, &none),
        LoginOutcome::BadCredentials
    );
    assert_eq!(
        auth::login_outcome_error(LoginOutcome::BadCredentials).kind,
        VoipPhoneErrorKind::Auth
    );
}

#[test]
fn build_login_body_round_trips_through_a_test_rsa_key() {
    let key = test_rsa_key();
    let facts = auth::parse_login_form(&attested_page(&key));
    let mut rng = fixed_rng();
    let body = auth::build_login_body(USER, PASS, SESSION_ID, &facts, &mut rng).unwrap();

    let names: Vec<&str> = body.iter().map(|(k, _)| *k).collect();
    assert_eq!(names, vec!["username", "pwd", "rsakey", "rsaiv"]);
    let field = |name: &str| {
        body.iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.clone())
    };
    assert_eq!(field("username").as_deref(), Some(USER));
    for (name, value) in &body {
        if *name != "username" {
            assert!(!value.contains(PASS), "{name} leaks the password");
            assert!(!value.contains(SESSION_ID), "{name} leaks the session id");
        }
    }

    let decoded = decode_login_fields(&key, field).expect("the phone decodes the body");
    assert_eq!(decoded.password, PASS);
    assert_eq!(decoded.session, SESSION_ID);
    assert_eq!(decoded.random.len(), NONCE_HEX_LEN);
    assert!(decoded.random.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(decoded.key_hex.len(), 32);
    assert_eq!(decoded.iv_hex.len(), 32);
    assert_ne!(decoded.key_hex, decoded.iv_hex);
    for hex in [&decoded.key_hex, &decoded.iv_hex] {
        assert!(hex
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}

#[test]
fn the_same_seed_produces_the_same_ciphertext() {
    let key = test_rsa_key();
    let facts = auth::parse_login_form(&attested_page(&key));
    let pwd = |rng: &mut rand::rngs::StdRng| {
        auth::build_login_body(USER, PASS, SESSION_ID, &facts, rng)
            .unwrap()
            .into_iter()
            .find(|(k, _)| *k == "pwd")
            .map(|(_, v)| v)
            .unwrap()
    };
    // The AES key, IV and nonce all come from the injected RNG, so `pwd` is
    // reproducible. (`rsakey` / `rsaiv` are not: PKCS#1 v1.5 padding is
    // randomised by design and must stay that way.)
    assert_eq!(pwd(&mut fixed_rng()), pwd(&mut fixed_rng()));
    assert_ne!(
        pwd(&mut fixed_rng()),
        pwd(&mut rand::rngs::StdRng::seed_from_u64(1))
    );
}

#[test]
fn build_login_body_is_bound_to_the_session_and_refuses_a_keyless_page() {
    let key = test_rsa_key();
    let facts = auth::parse_login_form(&attested_page(&key));
    let other =
        auth::build_login_body(USER, PASS, "someothersession", &facts, &mut fixed_rng()).unwrap();
    let field = |name: &str| {
        other
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.clone())
    };
    assert_eq!(
        decode_login_fields(&key, field).unwrap().session,
        "someothersession",
        "the ciphertext carries whichever session it was built for"
    );

    // A page with no key at all cannot be encrypted for, and the module
    // refuses rather than inventing a plaintext fallback.
    let err = auth::build_login_body(
        USER,
        PASS,
        SESSION_ID,
        &auth::parse_login_form(&fixture("servlet_login_plain.html")),
        &mut fixed_rng(),
    )
    .unwrap_err();
    assert_eq!(err.kind, VoipPhoneErrorKind::Parse);
    assert!(!err.to_string().contains(PASS));
}

#[test]
fn cache_busters_are_appended_the_way_the_phone_pages_do() {
    let mut rng = fixed_rng();
    let form = auth::with_cache_buster(SERVLET_LOGIN_FORM, "Random", &mut rng);
    let post = auth::with_cache_buster(SERVLET_LOGIN_POST, "Rajax", &mut rng);
    assert!(form.starts_with(&format!("{SERVLET_LOGIN_FORM}&Random=")));
    assert!(post.starts_with(&format!("{SERVLET_LOGIN_POST}&Rajax=")));
    assert!(form
        .rsplit('=')
        .next()
        .unwrap()
        .chars()
        .all(|c| c.is_ascii_digit()));
}

#[test]
fn is_login_page_spots_both_markups() {
    assert!(auth::is_login_page(&fixture("servlet_login_plain.html")));
    assert!(auth::is_login_page(&fixture("servlet_login_g_rsa.html")));
    assert!(auth::is_login_page(&fixture(
        "servlet_login_response_bounce.html"
    )));
    assert!(!auth::is_login_page(&fixture(
        "servlet_login_response_done.html"
    )));
    assert!(!auth::is_login_page(&fixture("unknown_index.html")));
}

#[test]
fn every_login_outcome_has_a_log_safe_label_and_a_closed_error() {
    let secret_hint = "HTTP 418 — first bytes: \"teapot\"";
    let outcomes = [
        LoginOutcome::Done,
        LoginOutcome::BadCredentials,
        LoginOutcome::Locked,
        LoginOutcome::SessionLost,
        LoginOutcome::Unclassified(secret_hint.into()),
    ];
    let labels: Vec<&str> = outcomes.iter().map(LoginOutcome::as_str).collect();
    assert_eq!(
        labels,
        vec![
            "done",
            "bad-credentials",
            "locked",
            "session-lost",
            "unclassified"
        ]
    );
    // The label never carries the hint: this crate logs classifications only.
    assert!(!outcomes[4].as_str().contains("teapot"));
    for outcome in outcomes.into_iter().skip(1) {
        let err = auth::login_outcome_error(outcome);
        assert!(matches!(
            err.kind,
            VoipPhoneErrorKind::Auth | VoipPhoneErrorKind::Unsupported
        ));
        assert!(!err.message.is_empty());
    }
}
