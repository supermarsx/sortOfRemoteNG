//! Yealink native pre-authentication regressions.
//!
//! Every phone here is a loopback mock built from the **e2e fixture's own**
//! login markup (`e2e/fixtures/voip-phone/servlet/login.html`), so a change to
//! that page breaks this suite rather than drifting away from it silently. No
//! firmware was downloaded and nothing contacts a real device.
//!
//! The mock really decrypts the login body with its own test RSA key — the same
//! contract `decodeRsaAesLogin` implements in the fixture server — because the
//! property this module owns is that the POST is bound to the session id the
//! login-page GET issued.
use super::*;
use crate::http::UpstreamAuthMode;
use base64::Engine as _;
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use rsa::traits::PublicKeyParts;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The fixture's login page, template and all. `{{…}}` is substituted exactly
/// the way `e2e/fixtures/voip-phone/server.mjs` substitutes it.
const LOGIN_TEMPLATE: &str = include_str!("../../../../e2e/fixtures/voip-phone/servlet/login.html");

const PHONE_TYPE: &str = "T21P_E2";
const FIRMWARE: &str = "52.84.0.15";
const SESSION_ID: &str = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const USERNAME: &str = "admin";
const PASSWORD: &str = "fixture-phone-secret";

// ── the mock phone ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    /// The attested servlet page: a per-session RSA key and a `JSESSIONID`.
    Encrypted,
    /// The same page, but the phone started no web session.
    NoSession,
    /// Pre-v8x `ConfigManApp.com`, served behind HTTP Basic.
    LegacyBasic,
    /// T4x/T5x JSON API.
    JsonApi,
    /// Something else entirely.
    Unrecognised,
    /// A bounce this module deliberately refuses to chase.
    Bounced,
    /// The web interface is there but broken.
    ServerError,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Answer {
    Done,
    Rejected,
    Locked,
    Garbage,
}

#[derive(Debug, Clone)]
struct Req {
    method: String,
    path: String,
    cookie: Option<String>,
    body: String,
}

impl Req {
    fn field(&self, name: &str) -> Option<String> {
        url::form_urlencoded::parse(self.body.as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    }
    fn fields(&self) -> Vec<String> {
        url::form_urlencoded::parse(self.body.as_bytes())
            .map(|(key, _)| key.into_owned())
            .collect()
    }
}

struct Phone {
    url: reqwest::Url,
    key: std::sync::Arc<rsa::RsaPrivateKey>,
    requests: std::sync::Arc<Mutex<Vec<Req>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Phone {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Phone {
    fn requests(&self) -> Vec<Req> {
        self.requests.lock().unwrap().clone()
    }
    fn posts(&self) -> Vec<Req> {
        self.requests()
            .into_iter()
            .filter(|request| request.method == "POST")
            .collect()
    }
}

/// A 1024-bit key: this is a fixture, not a security boundary, and generation
/// cost is paid once per test.
fn test_key() -> std::sync::Arc<rsa::RsaPrivateKey> {
    let mut rng = rand::thread_rng();
    std::sync::Arc::new(rsa::RsaPrivateKey::new(&mut rng, 1024).expect("generate test RSA key"))
}

/// Mirrors `pageVars` in the fixture server for the `rsa-aes` shape.
fn login_page(key: &rsa::RsaPrivateKey, session_id: &str) -> String {
    let vars = format!(
        "<script>var g_rsa_n=\"{}\";var g_rsa_e=\"{}\";var g_jsessionid=\"{session_id}\";\
         var g_phonetype=\"{PHONE_TYPE}\";var g_strFirmware=\"{FIRMWARE}\";</script>",
        key.n().to_str_radix(16),
        key.e().to_str_radix(16),
    );
    LOGIN_TEMPLATE
        .replace("{{PAGE_VARS}}", &vars)
        .replace("{{ERROR}}", "")
        .replace(
            "{{LOGIN_OPEN}}",
            "<form id=\"loginForm\" name=\"loginForm\" method=\"post\" \
             action=\"/servlet?m=mod_listener&amp;p=login&amp;q=login\">",
        )
        .replace("{{LOGIN_CLOSE}}", "</form>")
}

/// Mirrors the fixture server's `authstatus` answer document.
fn answer_body(answer: Answer) -> String {
    let status = match answer {
        Answer::Done => "done",
        Answer::Rejected => "none",
        Answer::Locked => "lock",
        Answer::Garbage => {
            return "<html><body>Service Unavailable</body></html>".into();
        }
    };
    format!(
        "<html><head><title>Yealink SIP-T21P E2</title></head><body>\
         <div id=\"_RES_INFO_\">{{\"authstatus\":\"{status}\"}}</div></body></html>"
    )
}

fn respond(status: u16, reason: &str, extra: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html\r\n{extra}\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn phone(page: Page, answer: Answer) -> Phone {
    let key = test_key();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = reqwest::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let requests = std::sync::Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let server_key = key.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let captured = captured.clone();
            let server_key = server_key.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                while !head.ends_with(b"\r\n\r\n") && head.len() < 16 * 1024 {
                    let Ok(byte) = stream.read_u8().await else {
                        return;
                    };
                    head.push(byte);
                }
                let head = String::from_utf8_lossy(&head).into_owned();
                let mut lines = head.split("\r\n");
                let request_line = lines.next().unwrap_or_default().to_string();
                let mut headers: HashMap<String, String> = HashMap::new();
                for line in lines {
                    if let Some((name, value)) = line.split_once(':') {
                        headers.insert(name.trim().to_ascii_lowercase(), value.trim().into());
                    }
                }
                let length: usize = headers
                    .get("content-length")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                let mut body = vec![0u8; length];
                if length > 0 && stream.read_exact(&mut body).await.is_err() {
                    return;
                }
                let mut parts = request_line.split_whitespace();
                let request = Req {
                    method: parts.next().unwrap_or_default().into(),
                    path: parts.next().unwrap_or_default().into(),
                    cookie: headers.get("cookie").cloned(),
                    body: String::from_utf8_lossy(&body).into_owned(),
                };
                let is_login_post = request.method == "POST" && request.path.contains("q=login&");
                captured.lock().unwrap().push(request);

                let response = if is_login_post {
                    respond(200, "OK", "", &answer_body(answer))
                } else {
                    match page {
                        Page::Encrypted => respond(
                            200,
                            "OK",
                            &format!("Set-Cookie: JSESSIONID={SESSION_ID}; Path=/\r\n"),
                            &login_page(&server_key, SESSION_ID),
                        ),
                        Page::NoSession => {
                            respond(200, "OK", "", &login_page(&server_key, SESSION_ID))
                        }
                        Page::LegacyBasic => respond(
                            401,
                            "Unauthorized",
                            "WWW-Authenticate: Basic realm=\"Yealink SIP-T21P\"\r\n",
                            "<html><body>/cgi-bin/ConfigManApp.com</body></html>",
                        ),
                        Page::JsonApi => respond(
                            200,
                            "OK",
                            "",
                            "<html><body><script>var api=\"/api/auth/login\";</script></body></html>",
                        ),
                        Page::Unrecognised => {
                            respond(200, "OK", "", "<html><body>Router status</body></html>")
                        }
                        Page::Bounced => respond(
                            302,
                            "Found",
                            "Location: /servlet?p=login&q=loginForm&jumpto=status\r\n",
                            "",
                        ),
                        Page::ServerError => {
                            respond(500, "Internal Server Error", "", "<html>busy</html>")
                        }
                    }
                };
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Phone {
        url,
        key,
        requests,
        task,
    }
}

/// The same client shape the proxy builds: no ambient proxy, no redirect
/// following, and a cookie store — which is exactly why the handshake sets its
/// `Cookie` header explicitly instead of trusting the jar.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
}

/// Undo the wrapper the way the phone does — the other half of
/// `build_login_body`, and of `decodeRsaAesLogin` in the e2e fixture server.
fn decode_login(key: &rsa::RsaPrivateKey, request: &Req) -> (String, String, String) {
    let unwrap = |name: &str| -> String {
        let cipher = base64::engine::general_purpose::STANDARD
            .decode(request.field(name).expect("field present").as_bytes())
            .expect("base64");
        String::from_utf8(key.decrypt(rsa::Pkcs1v15Encrypt, &cipher).expect("rsa")).expect("utf8")
    };
    let hex16 = |value: &str| -> [u8; 16] {
        assert_eq!(value.len(), 32, "AES material is 32 hex characters");
        let mut out = [0u8; 16];
        for (index, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("hex");
        }
        out
    };
    let aes_key = hex16(&unwrap("rsakey"));
    let aes_iv = hex16(&unwrap("rsaiv"));
    let mut buf = base64::engine::general_purpose::STANDARD
        .decode(request.field("pwd").expect("pwd present").as_bytes())
        .expect("base64");
    assert!(
        !buf.is_empty() && buf.len().is_multiple_of(16),
        "whole AES blocks"
    );
    let mut decryptor = cbc::Decryptor::<aes::Aes128>::new((&aes_key).into(), (&aes_iv).into());
    for block in buf.as_chunks_mut::<16>().0 {
        decryptor.decrypt_block_mut(block.into());
    }
    let plain = String::from_utf8(buf).expect("utf8");
    let mut parts = plain.trim_end_matches('\0').splitn(3, ';');
    (
        parts.next().unwrap_or_default().into(),
        parts.next().unwrap_or_default().into(),
        parts.next().unwrap_or_default().into(),
    )
}

// ── the closed mode and its unknown-variant fallback ─────────────────────────

#[test]
fn an_unknown_upstream_mode_degrades_to_no_authorization_and_never_to_basic() {
    let unknown: UpstreamAuthMode =
        serde_json::from_value(serde_json::json!("a-mode-from-a-newer-frontend")).unwrap();
    assert_eq!(unknown, UpstreamAuthMode::Unknown);
    // The whole point of the fallback: a version skew must not start injecting
    // Basic credentials at a device that never asked for them.
    assert_ne!(unknown, UpstreamAuthMode::default());
    assert_ne!(unknown, UpstreamAuthMode::Basic);
    // An ABSENT field still defaults to Basic — that is the documented
    // backward-compatibility rule and the fallback must not change it.
    let absent: crate::http::BasicAuthProxyConfig = serde_json::from_value(
        serde_json::json!({"target_url":"http://phone.invalid/","username":"u","password":"p"}),
    )
    .unwrap();
    assert_eq!(absent.upstream_auth_mode, UpstreamAuthMode::Basic);

    for mode in [UpstreamAuthMode::Unknown, UpstreamAuthMode::YealinkServlet] {
        assert_eq!(mode.authorization_value(USERNAME, PASSWORD), None);
        assert_eq!(mode.manager_visible_username(USERNAME), "");
        assert!(!mode.accepts_basic_challenge());
        let request = mode
            .apply_credentials(
                reqwest::Client::new().get("http://phone.invalid/"),
                USERNAME,
                PASSWORD,
            )
            .build()
            .unwrap();
        assert!(!request
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION));
    }
}

#[test]
fn the_servlet_mode_crosses_the_ipc_boundary_under_its_declared_name() {
    let config: crate::http::BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
        "target_url": "http://phone.invalid/",
        "username": USERNAME,
        "password": PASSWORD,
        "upstream_auth_mode": "yealink-servlet",
    }))
    .unwrap();
    assert_eq!(config.upstream_auth_mode, UpstreamAuthMode::YealinkServlet);
    assert_eq!(
        serde_json::to_value(UpstreamAuthMode::YealinkServlet).unwrap(),
        serde_json::json!("yealink-servlet")
    );
}

// ── page classification ──────────────────────────────────────────────────────

#[test]
fn the_attested_page_is_signable_and_reports_its_non_secret_facts() {
    let key = test_key();
    let LoginPage::Encrypted(facts) = classify_login_page(&login_page(&key, SESSION_ID)) else {
        panic!("the attested fixture markup must be signable");
    };
    let modulus = key.n().to_str_radix(16);
    assert_eq!(facts.rsa_n.as_deref(), Some(modulus.as_str()));
    assert_eq!(facts.exponent_hex(), key.e().to_str_radix(16));
    assert_eq!(facts.phone_type.as_deref(), Some(PHONE_TYPE));
    assert_eq!(facts.firmware.as_deref(), Some(FIRMWARE));
}

#[test]
fn a_keyless_page_is_named_per_generation_and_never_guessed_at() {
    for (body, expected) in [
        (
            "<html><body>/cgi-bin/ConfigManApp.com</body></html>",
            UnsupportedPhone::LegacyBasic,
        ),
        (
            "<html><script>fetch(\"/api/auth/login\")</script></html>",
            UnsupportedPhone::JsonApi,
        ),
        (
            "<html><script>post(\"/api/common/info?p=Login\")</script></html>",
            UnsupportedPhone::JsonApi,
        ),
        (
            "<html><body>Router status</body></html>",
            UnsupportedPhone::Unrecognised,
        ),
    ] {
        assert_eq!(
            classify_login_page(body),
            LoginPage::Unsupported(expected),
            "{body}"
        );
        // Every message names the setting to change: there is nothing to retry.
        assert!(
            expected.message().contains("login mode"),
            "{}",
            expected.message()
        );
    }
    assert_eq!(UnsupportedPhone::LegacyBasic.as_str(), "legacy-basic");
    assert!(UnsupportedPhone::LegacyBasic.message().contains("Basic"));
    assert!(UnsupportedPhone::JsonApi.message().contains("T4x/T5x"));
}

// ── the session cookie, held proxy-side ──────────────────────────────────────

fn set_cookie(values: &[&str]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for value in values {
        headers.append(SET_COOKIE, value.parse().unwrap());
    }
    headers
}

#[test]
fn the_session_cookie_is_extracted_as_a_whole_pair_and_validated() {
    assert_eq!(
        session_cookie_pair(&set_cookie(&[
            "lang=en; Path=/",
            &format!("JSESSIONID={SESSION_ID}; Path=/; HttpOnly"),
        ])),
        Some(format!("JSESSIONID={SESSION_ID}"))
    );
    // Nothing usable: no value, a value outside the cookie grammar, an
    // over-long value, or a different cookie entirely.
    for header in [
        "JSESSIONID=; Path=/",
        "JSESSIONID=bad value; Path=/",
        "sid=other",
    ] {
        assert_eq!(
            session_cookie_pair(&set_cookie(&[header])),
            None,
            "{header}"
        );
    }
    let long = format!("JSESSIONID={}", "a".repeat(MAX_SESSION_VALUE + 1));
    assert_eq!(session_cookie_pair(&set_cookie(&[&long])), None);
}

#[test]
fn the_proxy_held_session_beats_the_browser_and_keeps_its_other_cookies() {
    let session = format!("JSESSIONID={SESSION_ID}");
    // The reason Route A works where the page route struggles: real firmware
    // issues a Lax cookie that a cross-site website frame never sends back, so
    // the browser's header is usually missing it entirely.
    assert_eq!(
        merge_session_cookie(None, Some(&session)),
        Some(session.clone())
    );
    assert_eq!(
        merge_session_cookie(Some("lang=en; theme=dark"), Some(&session)),
        Some(format!("{session}; lang=en; theme=dark"))
    );
    // A stale browser copy from an earlier arm never displaces the session the
    // proxy just authenticated.
    assert_eq!(
        merge_session_cookie(Some("JSESSIONID=STALE; lang=en"), Some(&session)),
        Some(format!("{session}; lang=en"))
    );
    // No pre-authentication: leave the request exactly as it was.
    assert_eq!(merge_session_cookie(Some("lang=en"), None), None);
    // An oversized browser header keeps the authenticated session alone.
    let huge = format!("big={}", "x".repeat(MAX_COOKIE_HEADER));
    assert_eq!(
        merge_session_cookie(Some(&huge), Some(&session)),
        Some(session)
    );
}

#[test]
fn every_forwarded_request_carries_the_session_the_proxy_established() {
    let slot = session_slot();
    let mut headers = vec![("cookie".to_string(), "lang=en".to_string())];
    apply_session_cookie(&mut headers, &slot);
    assert_eq!(headers, vec![("cookie".to_string(), "lang=en".to_string())]);

    *slot.write().unwrap() = Some(format!("JSESSIONID={SESSION_ID}"));
    apply_session_cookie(&mut headers, &slot);
    assert_eq!(
        headers,
        vec![(
            "cookie".to_string(),
            format!("JSESSIONID={SESSION_ID}; lang=en")
        )]
    );
    // A request the browser sent no cookies with still reaches the phone
    // authenticated.
    let mut bare = vec![("accept".to_string(), "*/*".to_string())];
    apply_session_cookie(&mut bare, &slot);
    assert_eq!(
        bare,
        vec![
            ("accept".to_string(), "*/*".to_string()),
            ("cookie".to_string(), format!("JSESSIONID={SESSION_ID}"))
        ]
    );
}

// ── the handshake ────────────────────────────────────────────────────────────

async fn sign_in(phone: &Phone, slot: &YealinkSessionCookie) -> Result<(), String> {
    pre_authenticate(&client(), &phone.url, USERNAME, PASSWORD, slot).await
}

#[tokio::test]
async fn a_successful_handshake_binds_the_password_to_the_session_the_page_issued() {
    let phone = phone(Page::Encrypted, Answer::Done).await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap();

    // The cookie lives in the proxy, not the document.
    assert_eq!(
        slot.read().unwrap().as_deref(),
        Some(format!("JSESSIONID={SESSION_ID}").as_str())
    );

    let requests = phone.requests();
    assert_eq!(requests.len(), 2, "exactly one GET and one POST");
    assert_eq!(requests[0].method, "GET");
    assert!(requests[0]
        .path
        .starts_with("/servlet?m=mod_listener&p=login&q=loginForm&Random="));
    assert!(
        requests[0].cookie.is_none(),
        "nothing to send before the page"
    );

    let post = &requests[1];
    assert_eq!(post.method, "POST");
    // The fixture server rejects a body whose URL carries no `Rajax`.
    assert!(post
        .path
        .starts_with("/servlet?m=mod_listener&p=login&q=login&Rajax="));
    assert_eq!(
        post.cookie.as_deref(),
        Some(format!("JSESSIONID={SESSION_ID}").as_str())
    );
    assert_eq!(post.fields(), vec!["username", "pwd", "rsakey", "rsaiv"]);
    assert_eq!(post.field("username").as_deref(), Some(USERNAME));
    // Nothing in the body is the password in the clear.
    assert!(!post.body.contains(PASSWORD));

    let (nonce, session, password) = decode_login(&phone.key, post);
    assert!(!nonce.is_empty(), "the anti-replay nonce is present");
    assert_eq!(
        session, SESSION_ID,
        "the POST is bound to the GET's session"
    );
    assert_eq!(password, PASSWORD);
}

#[tokio::test]
async fn a_rejected_sign_in_is_terminal_and_holds_no_session() {
    let phone = phone(Page::Encrypted, Answer::Rejected).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert_eq!(error, "The phone rejected the username or password");
    assert!(
        slot.read().unwrap().is_none(),
        "a rejected login grants nothing"
    );
    assert_eq!(phone.posts().len(), 1, "no retry, ever");
}

#[tokio::test]
async fn a_locked_account_says_to_wait_and_never_hammers_the_phone() {
    let phone = phone(Page::Encrypted, Answer::Locked).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.contains("locked this account"), "{error}");
    assert!(error.contains("Wait a few minutes"), "{error}");
    assert!(slot.read().unwrap().is_none());
    assert_eq!(phone.posts().len(), 1, "a lockout must never be retried");
}

#[tokio::test]
async fn an_answer_we_cannot_classify_reports_the_status_and_first_bytes() {
    let phone = phone(Page::Encrypted, Answer::Garbage).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.contains("Could not classify"), "{error}");
    assert!(error.contains("HTTP 200"), "{error}");
    assert!(error.contains("Service Unavailable"), "{error}");
    assert!(slot.read().unwrap().is_none());
    assert_eq!(phone.posts().len(), 1);
}

#[tokio::test]
async fn an_older_generation_is_named_before_any_password_is_sent() {
    let phone = phone(Page::LegacyBasic, Answer::Done).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert_eq!(error, UnsupportedPhone::LegacyBasic.message());
    assert!(phone.posts().is_empty(), "a keyless page gets no password");
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn a_newer_generation_is_named_before_any_password_is_sent() {
    for page in [Page::JsonApi, Page::Unrecognised] {
        let phone = phone(page, Answer::Done).await;
        let slot = session_slot();
        let error = sign_in(&phone, &slot).await.unwrap_err();

        let expected = if page == Page::JsonApi {
            UnsupportedPhone::JsonApi
        } else {
            UnsupportedPhone::Unrecognised
        };
        assert_eq!(error, expected.message());
        assert!(phone.posts().is_empty(), "a keyless page gets no password");
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn a_bounce_is_reported_rather_than_chased() {
    // The proxy talks to the connection's own origin and nowhere else, so a
    // redirect is a dead end — and saying so beats "no session key".
    let phone = phone(Page::Bounced, Answer::Done).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.contains("redirect (HTTP 302)"), "{error}");
    assert!(error.contains("never follows a redirect"), "{error}");
    assert_eq!(phone.requests().len(), 1, "the bounce was not followed");
}

#[tokio::test]
async fn a_broken_web_interface_reports_its_status() {
    let phone = phone(Page::ServerError, Answer::Done).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.contains("HTTP 500"), "{error}");
    assert!(error.contains("no password was sent"), "{error}");
    assert!(phone.posts().is_empty());
}

#[tokio::test]
async fn a_page_that_starts_no_web_session_stops_before_the_password() {
    let phone = phone(Page::NoSession, Answer::Done).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.contains("one web session at a time"), "{error}");
    assert!(phone.posts().is_empty());
}

#[tokio::test]
async fn one_session_arm_produces_exactly_one_login_post() {
    let phone = phone(Page::Encrypted, Answer::Done).await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap();
    assert_eq!(phone.posts().len(), 1);

    // A second handshake on the same arm is a bug, not a fallback: the phone
    // locks an account out after repeated sign-ins. It must not reach the wire.
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("already signed in"), "{error}");
    assert_eq!(phone.requests().len(), 2, "no further request was made");
}

#[tokio::test]
async fn no_failure_path_leaks_the_password_or_the_session_id() {
    for (page, answer) in [
        (Page::Encrypted, Answer::Rejected),
        (Page::Encrypted, Answer::Locked),
        (Page::Encrypted, Answer::Garbage),
        (Page::NoSession, Answer::Done),
        (Page::LegacyBasic, Answer::Done),
        (Page::JsonApi, Answer::Done),
        (Page::Unrecognised, Answer::Done),
        (Page::Bounced, Answer::Done),
        (Page::ServerError, Answer::Done),
    ] {
        let phone = phone(page, answer).await;
        let slot = session_slot();
        let error = sign_in(&phone, &slot).await.unwrap_err();
        assert!(!error.contains(PASSWORD), "{error}");
        assert!(!error.contains(SESSION_ID), "{error}");
    }
}
