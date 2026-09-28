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
const T20P_FORM: &str = include_str!("../../../../tests/fixtures/yealink-t20p.html");

const PHONE_TYPE: &str = "T21P_E2";
const FIRMWARE: &str = "52.84.0.15";
const SESSION_ID: &str = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const LEGACY_SESSION_ID: &str = "11112222333344445555666677778888";
const ROOT_SESSION_ID: &str = "9999AAAABBBBCCCCDDDDEEEEFFFF0000";
const USERNAME: &str = "admin";
const PASSWORD: &str = "fixture-phone-secret";
// Exact bootstrap returned by the user's T21P.
const T21P_BOOTSTRAP: &str = "<html>\n<script type=\"text/javascript\">\n window.location =\"/servlet?p=login&q=loginForm&jumpto=status\";\n</script>\n</html>";

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
    NotFound,
    Unauthorized,
    Forbidden,
    TooManyRequests,
    /// Syntactically hex, but invalid as an RSA public modulus.
    InvalidKey,
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
    authorization: Option<String>,
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

    fn route(&self) -> String {
        // HTTP proxies receive an absolute request target; direct mocks receive
        // only the path. Normalize both without making any network request.
        let url = reqwest::Url::parse("http://fixture.invalid/")
            .unwrap()
            .join(&self.path)
            .unwrap();
        let mut route = url.path().to_string();
        let query: String = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(
                url.query_pairs()
                    .filter(|(name, _)| name != "Random" && name != "Rajax"),
            )
            .finish();
        if !query.is_empty() {
            route.push('?');
            route.push_str(&query);
        }
        route
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
    let server_key = key.clone();
    phone_with_responder(key, move |request| {
        if request.method == "POST" {
            respond(200, "OK", "", &answer_body(answer))
        } else {
            page_response(page, &server_key, SESSION_ID)
        }
    })
    .await
}

fn page_response(page: Page, key: &rsa::RsaPrivateKey, session_id: &str) -> String {
    let cookie = format!("Set-Cookie: JSESSIONID={session_id}; Path=/\r\n");
    match page {
        Page::Encrypted => respond(200, "OK", &cookie, &login_page(key, session_id)),
        Page::NoSession => respond(200, "OK", "", &login_page(key, session_id)),
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
        Page::Unrecognised => respond(200, "OK", &cookie, "<html>Router status</html>"),
        Page::NotFound => respond(404, "Not Found", &cookie, "<html>Not found</html>"),
        Page::Unauthorized => respond(401, "Unauthorized", "", "<html>Unauthorized</html>"),
        Page::Forbidden => respond(403, "Forbidden", "", "<html>Forbidden</html>"),
        Page::TooManyRequests => respond(429, "Too Many Requests", "", "<html>Wait</html>"),
        Page::InvalidKey => respond(
            200,
            "OK",
            &cookie,
            &login_page(key, session_id).replace(&key.n().to_str_radix(16), &"0".repeat(128)),
        ),
        Page::Bounced => respond(302, "Found", "Location: /unreviewed-login\r\n", ""),
        Page::ServerError => respond(500, "Internal Server Error", "", "<html>busy</html>"),
    }
}

/// Each candidate has its own key and cookie. Even an unknown/404 page sets a
/// cookie, so a later POST must select the successful page's session explicitly.
async fn discovery_phone(pages: [Page; 3], answer: Answer) -> Phone {
    let keys = [test_key(), test_key(), test_key()];
    let selected = pages
        .iter()
        .position(|page| *page == Page::Encrypted)
        .unwrap_or(0);
    let key = keys[selected].clone();
    phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(answer));
        }
        let route = request.route();
        let index = [
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_FORM_ROOT,
        ]
        .iter()
        .position(|candidate| *candidate == route);
        let Some(index) = index else {
            return respond(400, "Bad Request", "", "Unexpected discovery route");
        };
        let session = [SESSION_ID, LEGACY_SESSION_ID, ROOT_SESSION_ID][index];
        page_response(pages[index], &keys[index], session)
    })
    .await
}

async fn phone_with_responder(
    key: std::sync::Arc<rsa::RsaPrivateKey>,
    responder: impl Fn(&Req) -> String + Send + Sync + 'static,
) -> Phone {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = reqwest::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let requests = std::sync::Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let responder = std::sync::Arc::new(responder);
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let captured = captured.clone();
            let responder = responder.clone();
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
                    authorization: headers.get("authorization").cloned(),
                    body: String::from_utf8_lossy(&body).into_owned(),
                };
                let response = responder(&request);
                captured.lock().unwrap().push(request);
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

#[test]
fn t20p_requires_the_exact_dom_contract_and_never_overrides_rsa() {
    assert_eq!(classify_login_page(T20P_FORM), LoginPage::LegacyT20pDom);
    for body in [
        T20P_FORM.replace("formInput", "other"),
        T20P_FORM.replace("SIP-T20P", "SIP-T21P"),
        T20P_FORM.replace("OnConfirm()", "formInput.submit()"),
        T20P_FORM.replace("OnClear()", "other()"),
        T20P_FORM.replace("return false", "return true"),
        T20P_FORM.replace("method=\"post\"", "method=\"get\""),
        T20P_FORM.replace(
            "/servlet?p=login&amp;q=login",
            "https://other.invalid/servlet?p=login&amp;q=login",
        ),
        T20P_FORM.replace(
            "/servlet?p=login&amp;q=login",
            "/servlet?p=login&amp;q=login&amp;next=other",
        ),
        T20P_FORM.replace("name=\"pwd\"", "name=\"password\""),
        T20P_FORM.replace("name=\"acc\" value=\"\"", "name=\"acc\" value=\"other\""),
        T20P_FORM.replace("value=\"status\"", "value=\"other\""),
        T20P_FORM.replace("type=\"button\"", "type=\"submit\""),
        T20P_FORM.replace("name=\"username\"", "name=\"username\" form=\"other\""),
        T20P_FORM.replace("name=\"username\"", "name=\"username\" name=\"other\""),
        format!("<!-- {T20P_FORM} -->"),
        format!("<script>var example = `{T20P_FORM}`;</script>"),
        format!("{T20P_FORM}{T20P_FORM}"),
    ] {
        assert_ne!(body, T20P_FORM, "negative fixture must change the form");
        assert_ne!(
            classify_login_page(&body),
            LoginPage::LegacyT20pDom,
            "{body}"
        );
    }
    let key = test_key();
    assert!(matches!(
        classify_login_page(&format!("{T20P_FORM}{}", login_page(&key, SESSION_ID))),
        LoginPage::Encrypted(_)
    ));
}

#[tokio::test]
async fn t20p_native_discovery_allows_dom_login_without_post_or_session() {
    let phone = phone_with_responder(test_key(), |_| respond(200, "OK", "", T20P_FORM)).await;
    let slot = session_slot();
    assert!(
        !browser_login_pending(&slot),
        "absence of cookie is not a DOM grant"
    );
    sign_in(&phone, &slot).await.unwrap();
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
    assert!(
        slot.read().unwrap().is_none(),
        "DOM admission is not authentication"
    );
    assert!(browser_login_pending(&slot));
    assert!(
        sign_in(&phone, &slot).await.is_err(),
        "no second discovery or login"
    );
    assert!(
        !browser_login_pending(&session_slot()),
        "restart starts without DOM admission"
    );
    *slot.write().unwrap() = Some(format!("JSESSIONID={SESSION_ID}"));
    assert!(
        !browser_login_pending(&slot),
        "RSA sessions cannot dispense to DOM"
    );
}

#[tokio::test]
async fn t20p_error_responses_never_admit_dom_login() {
    for status in [401, 403, 500] {
        let phone =
            phone_with_responder(test_key(), move |_| respond(status, "Error", "", T20P_FORM))
                .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap_err();
        assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
        assert!(slot.read().unwrap().is_none());
        assert!(!browser_login_pending(&slot));
    }
}

fn assert_discovery_requests(phone: &Phone, routes: &[&str], post_route: Option<&str>) {
    let requests = phone.requests();
    assert_eq!(
        requests.len(),
        routes.len() + usize::from(post_route.is_some())
    );
    for (request, route) in requests.iter().zip(routes) {
        assert_eq!(request.method, "GET");
        assert_eq!(request.route(), *route);
        assert!(request.body.is_empty(), "discovery GETs carry no form body");
        assert!(!request.path.contains(USERNAME));
        assert!(!request.path.contains(PASSWORD));
    }
    for request in &requests {
        assert!(request.authorization.is_none(), "never fall back to Basic");
        assert!(
            !request.body.contains(PASSWORD),
            "never send a plaintext password"
        );
    }
    let posts = phone.posts();
    if let Some(route) = post_route {
        assert_eq!(posts.len(), 1, "discovery must never retry a login POST");
        assert_eq!(requests.last().unwrap().method, "POST");
        assert_eq!(posts[0].route(), route);
        assert!(posts[0].path.contains("&Rajax="));
    } else {
        assert!(posts.is_empty(), "unsupported pages get no credentials");
    }
}

fn assert_encrypted_session(phone: &Phone, session_id: &str) {
    let posts = phone.posts();
    assert_eq!(posts.len(), 1);
    let post = &posts[0];
    assert_eq!(
        post.cookie.as_deref(),
        Some(format!("JSESSIONID={session_id}").as_str())
    );
    assert_eq!(post.fields(), vec!["username", "pwd", "rsakey", "rsaiv"]);
    assert_eq!(post.field("username").as_deref(), Some(USERNAME));
    let (nonce, session, password) = decode_login(&phone.key, post);
    assert!(!nonce.is_empty());
    assert_eq!(
        session, session_id,
        "ciphertext must use the successful page's cookie"
    );
    assert_eq!(password, PASSWORD);
}

#[test]
fn login_redirects_resolve_only_to_canonical_same_origin_candidates() {
    let source = reqwest::Url::parse(
        "http://phone.invalid/servlet?m=mod_listener&p=login&q=loginForm&Random=123",
    )
    .unwrap();
    for (location, expected) in [
        ("/", 2),
        ("http://phone.invalid/", 2),
        ("/servlet?p=login&q=loginForm", 4),
        ("?q=loginForm&p=login&jumpto=status&Random=0.123", 1),
        ("/servlet?m=mod_listener&p=login&q=loginForm", 0),
        (
            "/servlet?Random=42&jumpto=status&q=loginForm&p=login&m=mod_listener",
            3,
        ),
    ] {
        assert_eq!(
            login_redirect_candidate(&source, location),
            Some(expected),
            "{location}"
        );
    }
    for location in [
        "http://other.invalid/servlet?p=login&q=loginForm",
        "http://phone.invalid:81/servlet?p=login&q=loginForm",
        "https://phone.invalid/servlet?p=login&q=loginForm",
        "//other.invalid/",
        "http://admin:secret@phone.invalid/servlet?p=login&q=loginForm",
        "/?Random=123",
        "/#login",
        "/unreviewed-login",
        "/servlet?p=login",
        "/servlet?q=loginForm",
        "/servlet?p=login&q=login",
        "/servlet?p=login&q=loginForm&m=other",
        "/servlet?p=login&q=loginForm&jumpto=other",
        "/servlet?p=login&q=loginForm&next=status",
        "/servlet?p=login&q=loginForm&p=login",
        "/servlet?p=login&q=loginForm&q=loginForm",
        "/servlet?p=login&q=loginForm&Random=1&Random=2",
        "/servlet?p=login&q=loginForm&m=mod_listener&m=mod_listener",
        "/servlet?p=login&q=loginForm&jumpto=status&jumpto=status",
        "/servlet?p=login&q=loginForm&Random=",
        "/servlet?p=login&q=loginForm&Random=NaN",
        "/servlet?p=login&q=loginForm&Random=.",
        "/servlet?p=login&q=loginForm&Random=1.2.3",
        "/servlet?p=login&q=loginForm#login",
    ] {
        assert_eq!(
            login_redirect_candidate(&source, location),
            None,
            "{location}"
        );
    }
}

#[tokio::test]
async fn an_allowlisted_redirect_selects_the_canonical_page_and_matching_post() {
    for (location, page_route, post_route) in [
        (
            "/servlet?q=loginForm&Random=0.123&p=login&jumpto=status",
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_POST_LEGACY,
        ),
        (
            "/servlet?Random=0.123&jumpto=status&q=loginForm&p=login&m=mod_listener",
            "/servlet?m=mod_listener&p=login&q=loginForm&jumpto=status",
            servlet::LOGIN_POST,
        ),
        (
            "/servlet?q=loginForm&p=login&Random=0.123",
            "/servlet?p=login&q=loginForm",
            servlet::LOGIN_POST_LEGACY,
        ),
        ("/", servlet::LOGIN_FORM_ROOT, servlet::LOGIN_POST),
    ] {
        let key = test_key();
        let server_key = key.clone();
        let phone = phone_with_responder(key, move |request| {
            if request.method == "POST" {
                return respond(200, "OK", "", &answer_body(Answer::Done));
            }
            if request.route() == servlet::LOGIN_FORM {
                return respond(302, "Found", &format!("Location: {location}\r\n"), "");
            }
            if request.route() == page_route {
                return page_response(Page::Encrypted, &server_key, SESSION_ID);
            }
            respond(400, "Bad Request", "", "Unexpected redirect target")
        })
        .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(&phone, &[servlet::LOGIN_FORM, page_route], Some(post_route));
        assert_encrypted_session(&phone, SESSION_ID);
        let redirected = &phone.requests()[1];
        assert!(!redirected.path.contains("Random=0.123"));
        assert_eq!(
            redirected.path.matches("Random=").count(),
            usize::from(page_route != "/"),
            "replace the supplied nonce exactly once, with no extra query parameters"
        );
        assert!(slot.read().unwrap().is_some());
    }
}

#[tokio::test]
async fn a_redirect_back_to_a_visited_candidate_is_terminal() {
    for direct_loop in [true, false] {
        let phone = phone_with_responder(test_key(), move |request| {
            let location = if direct_loop || request.route() != servlet::LOGIN_FORM {
                servlet::LOGIN_FORM
            } else {
                servlet::LOGIN_FORM_LEGACY
            };
            respond(302, "Found", &format!("Location: {location}\r\n"), "")
        })
        .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap_err();
        let routes = [servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY];
        assert_discovery_requests(&phone, &routes[..if direct_loop { 1 } else { 2 }], None);
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn t21p_bootstrap_reaches_the_legacy_key_page_before_sending_credentials() {
    let key = test_key();
    let server_key = key.clone();
    let phone = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(Answer::Done));
        }
        if request.route() == servlet::LOGIN_FORM {
            return respond(200, "OK", "", T21P_BOOTSTRAP);
        }
        page_response(Page::Encrypted, &server_key, LEGACY_SESSION_ID)
    })
    .await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap();
    assert_discovery_requests(
        &phone,
        &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
        Some(servlet::LOGIN_POST_LEGACY),
    );
    assert_encrypted_session(&phone, LEGACY_SESSION_ID);
}

#[tokio::test]
async fn t21p_bootstrap_loop_is_terminal_before_a_fallback_can_send_credentials() {
    let key = test_key();
    let server_key = key.clone();
    let phone = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(Answer::Done));
        }
        if request.route() == servlet::LOGIN_FORM_ROOT {
            return page_response(Page::Encrypted, &server_key, ROOT_SESSION_ID);
        }
        respond(200, "OK", "", T21P_BOOTSTRAP)
    })
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("redirect"), "{error}");
    assert_discovery_requests(
        &phone,
        &[
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_FORM_LEGACY,
        ],
        None,
    );
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn javascript_redirect_precedes_generation_and_key_detection() {
    for encrypted in [false, true] {
        let key = test_key();
        let server_key = key.clone();
        let phone = phone_with_responder(key, move |request| {
            if request.method == "POST" {
                return respond(200, "OK", "", &answer_body(Answer::Done));
            }
            if request.route() == servlet::LOGIN_FORM {
                let decoy = if encrypted {
                    login_page(&server_key, SESSION_ID)
                } else {
                    format!("<!-- {} /api/auth/login -->", legacy::BODY_MARKER)
                };
                return respond(
                    200,
                    "OK",
                    &format!("Set-Cookie: JSESSIONID={SESSION_ID}; Path=/\r\n"),
                    &format!("{T21P_BOOTSTRAP}{decoy}"),
                );
            }
            page_response(Page::Encrypted, &server_key, LEGACY_SESSION_ID)
        })
        .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(
            &phone,
            &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
            Some(servlet::LOGIN_POST_LEGACY),
        );
        assert_encrypted_session(&phone, LEGACY_SESSION_ID);
    }
}

#[tokio::test]
async fn same_route_javascript_navigation_completes_a_cookie_handshake() {
    let key = test_key();
    for from_fallback in [false, true] {
        let server_key = key.clone();
        let phone =
            phone_with_responder(key.clone(), move |request| {
                if request.method == "POST" {
                    return respond(200, "OK", "", &answer_body(Answer::Done));
                }
                if request.route() == servlet::LOGIN_FORM {
                    return if from_fallback {
                        page_response(Page::NotFound, &server_key, SESSION_ID)
                    } else {
                        respond(200, "OK", "", T21P_BOOTSTRAP)
                    };
                }
                if request.cookie.as_deref().is_some_and(|cookie| {
                    cookie.contains(&format!("JSESSIONID={LEGACY_SESSION_ID}"))
                }) {
                    // The session was issued by the bootstrap, not reissued here.
                    return page_response(Page::NoSession, &server_key, LEGACY_SESSION_ID);
                }
                respond(
                    200,
                    "OK",
                    &format!("Set-Cookie: JSESSIONID={LEGACY_SESSION_ID}; Path=/\r\n"),
                    T21P_BOOTSTRAP,
                )
            })
            .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(
            &phone,
            &[
                servlet::LOGIN_FORM,
                servlet::LOGIN_FORM_LEGACY,
                servlet::LOGIN_FORM_LEGACY,
            ],
            Some(servlet::LOGIN_POST_LEGACY),
        );
        assert_encrypted_session(&phone, LEGACY_SESSION_ID);
        assert_eq!(
            slot.read().unwrap().as_deref(),
            Some(format!("JSESSIONID={LEGACY_SESSION_ID}").as_str())
        );
    }
}

#[tokio::test]
async fn repeated_javascript_self_navigation_stops_even_when_cookies_and_nonces_change() {
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = requests.clone();
    let phone = phone_with_responder(test_key(), move |_| {
        let count = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        respond(
            200,
            "OK",
            &format!("Set-Cookie: JSESSIONID=changing{count}; Path=/\r\n"),
            &format!(
                "<script>window.location='{}&Random={count}';</script>",
                servlet::LOGIN_FORM
            ),
        )
    })
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("redirect"), "{error}");
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM, servlet::LOGIN_FORM], None);
    assert!(slot.read().unwrap().is_none());
    assert!(!browser_login_pending(&slot));
}

#[tokio::test]
async fn root_bootstrap_can_revisit_an_earlier_failed_login_probe_with_a_new_session() {
    let key = test_key();
    for http_redirect in [false, true] {
        let server_key = key.clone();
        let phone = phone_with_responder(key.clone(), move |request| {
            if request.method == "POST" {
                return respond(200, "OK", "", &answer_body(Answer::Done));
            }
            if request.route() == servlet::LOGIN_FORM_ROOT {
                let cookie = format!("Set-Cookie: JSESSIONID={ROOT_SESSION_ID}; Path=/\r\n");
                return if http_redirect {
                    respond(
                        302,
                        "Found",
                        &format!("{cookie}Location: {}\r\n", servlet::LOGIN_FORM_LEGACY),
                        "",
                    )
                } else {
                    respond(200, "OK", &cookie, T21P_BOOTSTRAP)
                };
            }
            if request.route() == servlet::LOGIN_FORM_LEGACY
                && request.cookie.as_deref()
                    == Some(format!("JSESSIONID={ROOT_SESSION_ID}").as_str())
            {
                return page_response(Page::NoSession, &server_key, ROOT_SESSION_ID);
            }
            // Both earlier probes fail and issue a cookie that must not be
            // mistaken for the session established by the root bootstrap.
            page_response(Page::Unrecognised, &server_key, SESSION_ID)
        })
        .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(
            &phone,
            &[
                servlet::LOGIN_FORM,
                servlet::LOGIN_FORM_LEGACY,
                servlet::LOGIN_FORM_ROOT,
                servlet::LOGIN_FORM_LEGACY,
            ],
            Some(servlet::LOGIN_POST_LEGACY),
        );
        assert_encrypted_session(&phone, ROOT_SESSION_ID);
        assert_eq!(
            slot.read().unwrap().as_deref(),
            Some(format!("JSESSIONID={ROOT_SESSION_ID}").as_str())
        );
    }
}

#[tokio::test]
async fn javascript_cross_origin_redirect_gets_no_request_or_credential_fallback() {
    let other = phone(Page::Encrypted, Answer::Done).await;
    let destination = other.url.join(servlet::LOGIN_FORM_LEGACY).unwrap();
    let key = test_key();
    let server_key = key.clone();
    let phone = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(Answer::Done));
        }
        if request.route() == servlet::LOGIN_FORM {
            return respond(
                200,
                "OK",
                "",
                &format!("<html><script>window.location = '{destination}';</script></html>"),
            );
        }
        page_response(Page::Encrypted, &server_key, SESSION_ID)
    })
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("redirect"), "{error}");
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
    assert!(other.requests().is_empty());
    assert!(slot.read().unwrap().is_none());
}

#[test]
fn bootstrap_parser_accepts_only_single_literal_location_assignments() {
    assert_eq!(
        login_script_redirect(T21P_BOOTSTRAP),
        Ok(Some(servlet::LOGIN_FORM_LEGACY))
    );
    for lhs in [
        "location",
        "location.href",
        "window.location",
        "window . location . href",
        "document.location",
        "document.location.href",
    ] {
        for quote in ['\'', '"'] {
            let body = format!(
                "<HTML><SCRIPT type='text/javascript'>\n{lhs} = {quote}/{quote};\n</SCRIPT></HTML>"
            );
            assert_eq!(login_script_redirect(&body), Ok(Some("/")), "{body}");
        }
    }
    for rhs in [
        "'/servlet' + '?p=login&q=loginForm'",
        "getLoginUrl()",
        "`/servlet?p=login&q=loginForm`",
        "'/' ; sendSecrets()",
        "'/' ; location = '/'",
        r"'\x2f'",
        r"'\/servlet?p=login&q=loginForm'",
        "'/\nservlet?p=login&q=loginForm'",
        "' /servlet?p=login&q=loginForm'",
        "'/' /* trailing code is not part of the grammar */",
        "''",
        "'/",
    ] {
        let body = format!("<script>window.location = {rhs}</script>");
        assert_eq!(login_script_redirect(&body), Err(()), "{body}");
    }
    assert_eq!(
        login_script_redirect(&format!("<script>location='{}'</script>", "x".repeat(2049))),
        Err(())
    );
    assert_eq!(
        login_script_redirect(&format!("{T21P_BOOTSTRAP}{T21P_BOOTSTRAP}")),
        Err(())
    );
    for body in [
        "<!-- <script>window.location = '/';</script> -->",
        "<script>function login() { window.location = '/'; }</script>",
        "<script>var example = \"location = '/'\";</script>",
        "<script src='/external.js'>location='/'</script>",
        "<script type='application/json'>location='/'</script>",
        "<html>window.location = '/';</html>",
    ] {
        assert_eq!(login_script_redirect(body), Ok(None), "{body}");
    }
}

#[tokio::test]
async fn mixed_http_and_javascript_redirect_cycles_stop_within_three_gets() {
    for three_hops in [false, true] {
        let phone = phone_with_responder(test_key(), move |request| {
            if request.route() == servlet::LOGIN_FORM {
                let destination = if three_hops {
                    servlet::LOGIN_FORM_ROOT
                } else {
                    servlet::LOGIN_FORM_LEGACY
                };
                return respond(
                    200,
                    "OK",
                    "",
                    &format!("<script>location.href = '{destination}';</script>"),
                );
            }
            let destination = if request.route() == servlet::LOGIN_FORM_ROOT {
                servlet::LOGIN_FORM_LEGACY
            } else {
                servlet::LOGIN_FORM
            };
            respond(302, "Found", &format!("Location: {destination}\r\n"), "")
        })
        .await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap_err();
        let routes = if three_hops {
            vec![
                servlet::LOGIN_FORM,
                servlet::LOGIN_FORM_ROOT,
                servlet::LOGIN_FORM_LEGACY,
            ]
        } else {
            vec![servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY]
        };
        assert_discovery_requests(&phone, &routes, None);
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn jumpto_variants_and_changing_nonces_cannot_exceed_the_global_get_bound() {
    let routes = [
        servlet::LOGIN_FORM,
        "/servlet?m=mod_listener&p=login&q=loginForm&jumpto=status",
        "/servlet?p=login&q=loginForm",
        servlet::LOGIN_FORM_LEGACY,
        servlet::LOGIN_FORM_ROOT,
    ];
    let phone = phone_with_responder(test_key(), move |request| {
        let current = routes
            .iter()
            .position(|route| *route == request.route())
            .unwrap();
        let next = routes[(current + 1) % routes.len()];
        let location = if next == "/" {
            next.to_string()
        } else {
            format!("{next}&Random=0.{}", current + 100)
        };
        if current % 2 == 0 {
            respond(
                200,
                "OK",
                "",
                &format!("<script>location='{location}';</script>"),
            )
        } else {
            respond(302, "Found", &format!("Location: {location}\r\n"), "")
        }
    })
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("redirect"), "{error}");
    assert_discovery_requests(&phone, &routes, None);
    assert_eq!(phone.requests().len(), MAX_LOGIN_PAGE_GETS);
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn javascript_redirect_preserves_explicit_jumpto_on_the_modern_route() {
    let key = test_key();
    let server_key = key.clone();
    let status_route = "/servlet?m=mod_listener&p=login&q=loginForm&jumpto=status";
    let phone = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(Answer::Done));
        }
        if request.route() == servlet::LOGIN_FORM {
            return respond(
                200, "OK", "",
                "<script>window.location.href='/servlet?jumpto=status&Random=0.123&p=login&q=loginForm&m=mod_listener';</script>",
            );
        }
        if request.route() == status_route {
            return page_response(Page::Encrypted, &server_key, SESSION_ID);
        }
        respond(400, "Bad Request", "", "jumpto=status was not preserved")
    })
    .await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap();
    assert_discovery_requests(
        &phone,
        &[servlet::LOGIN_FORM, status_route],
        Some(servlet::LOGIN_POST),
    );
    assert!(!phone.requests()[1].path.contains("Random=0.123"));
    assert_encrypted_session(&phone, SESSION_ID);
    assert!(slot.read().unwrap().is_some());
}

#[tokio::test]
async fn self_navigations_share_the_global_budget_with_http_redirects() {
    let count = std::sync::atomic::AtomicUsize::new(0);
    let phone = phone_with_responder(test_key(), move |_| {
        let step = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let location = match step {
            0 => servlet::LOGIN_FORM,
            1 | 2 => servlet::LOGIN_FORM_LEGACY,
            3 => servlet::LOGIN_FORM_ROOT,
            // This endpoint has not been visited, but the GET budget is spent.
            _ => "/servlet?m=mod_listener&p=login&q=loginForm&jumpto=status",
        };
        if step == 1 || step == 3 {
            respond(302, "Found", &format!("Location: {location}\r\n"), "")
        } else {
            respond(
                200,
                "OK",
                "",
                &format!("<script>location='{location}';</script>"),
            )
        }
    })
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("redirect"), "{error}");
    assert_discovery_requests(
        &phone,
        &[
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_FORM_ROOT,
        ],
        None,
    );
    assert_eq!(phone.requests().len(), MAX_LOGIN_PAGE_GETS);
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn unsafe_script_redirects_stop_before_form_detection_or_fallback() {
    let key = test_key();
    for rhs in [
        "'//other.invalid/'",
        "'https://other.invalid/servlet?p=login&q=loginForm'",
        "'javascript:alert(1)'",
        "'/unreviewed-login'",
        "'/servlet?p=login&q=loginForm&next=evil'",
        "'/servlet?p=login&q=loginForm#login'",
        "'/' + computeTarget()",
        "getLoginUrl()",
    ] {
        let server_key = key.clone();
        let phone = phone_with_responder(key.clone(), move |_| {
            respond(
                200,
                "OK",
                &format!("Set-Cookie: JSESSIONID={SESSION_ID}; Path=/\r\n"),
                &format!(
                    "<script>window.location={rhs};</script>{}",
                    login_page(&server_key, SESSION_ID)
                ),
            )
        })
        .await;
        let slot = session_slot();
        let error = sign_in(&phone, &slot).await.unwrap_err();
        assert!(error.contains("redirect"), "{error}");
        assert!(!error.contains(SESSION_ID));
        assert!(!error.contains(PASSWORD));
        assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn bootstrap_and_encrypted_post_stay_on_the_configured_proxy() {
    let origin = phone(Page::Encrypted, Answer::Done).await;
    let key = test_key();
    let server_key = key.clone();
    let proxy = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(200, "OK", "", &answer_body(Answer::Done));
        }
        if request.route() == servlet::LOGIN_FORM {
            return respond(200, "OK", "", T21P_BOOTSTRAP);
        }
        page_response(Page::Encrypted, &server_key, LEGACY_SESSION_ID)
    })
    .await;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(proxy.url.as_str()).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let slot = session_slot();
    pre_authenticate(&client, &origin.url, USERNAME, PASSWORD, &slot)
        .await
        .unwrap();
    assert_discovery_requests(
        &proxy,
        &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
        Some(servlet::LOGIN_POST_LEGACY),
    );
    assert_encrypted_session(&proxy, LEGACY_SESSION_ID);
    assert!(proxy
        .requests()
        .iter()
        .all(|req| req.path.starts_with(origin.url.as_str())));
    assert!(origin.requests().is_empty(), "no direct-origin requests");
    assert!(slot.read().unwrap().is_some());
}

#[tokio::test]
async fn relative_and_absolute_self_navigation_keep_the_proxy_and_client_cookie_context() {
    let origin = phone(Page::Encrypted, Answer::Done).await;
    let key = test_key();
    for location in [
        servlet::LOGIN_FORM.to_string(),
        servlet::LOGIN_FORM.trim_start_matches('/').to_string(),
        "?q=loginForm&p=login&m=mod_listener&Random=0.123".to_string(),
        origin.url.join(servlet::LOGIN_FORM).unwrap().to_string(),
    ] {
        let server_key = key.clone();
        let proxy = phone_with_responder(key.clone(), move |request| {
            if request.method == "POST" {
                return respond(200, "OK", "", &answer_body(Answer::Done));
            }
            if request.cookie.as_deref().is_some_and(|cookie| {
                cookie.contains(&format!("JSESSIONID={SESSION_ID}"))
                    && cookie.contains("phone_bootstrap=ready")
            }) {
                return page_response(Page::NoSession, &server_key, SESSION_ID);
            }
            respond(
                200,
                "OK",
                &format!("Set-Cookie: JSESSIONID={SESSION_ID}; Path=/\r\nSet-Cookie: phone_bootstrap=ready; Path=/\r\n"),
                &format!("<script>window.location='{location}';</script>"),
            )
        })
        .await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(proxy.url.as_str()).unwrap())
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let slot = session_slot();
        pre_authenticate(&client, &origin.url, USERNAME, PASSWORD, &slot)
            .await
            .unwrap();
        assert_discovery_requests(
            &proxy,
            &[servlet::LOGIN_FORM, servlet::LOGIN_FORM],
            Some(servlet::LOGIN_POST),
        );
        assert_encrypted_session(&proxy, SESSION_ID);
        assert!(proxy.requests()[1]
            .cookie
            .as_deref()
            .unwrap()
            .contains("phone_bootstrap=ready"));
        assert!(proxy
            .requests()
            .iter()
            .all(|request| request.path.starts_with(origin.url.as_str())));
        assert!(origin.requests().is_empty(), "no direct-origin requests");
        assert!(slot.read().unwrap().is_some());
    }
}

#[tokio::test]
async fn redirect_session_cookie_respects_scope_expiry_and_final_page_replacement() {
    let key = test_key();
    for (attributes, final_cookie, expected) in [
        ("Path=/", "", Some(SESSION_ID)),
        ("Path=/unrelated", "", None),
        ("Path=/; Domain=other.invalid", "", None),
        ("Path=/; Max-Age=0", "", None),
        ("Path=/", "JSESSIONID=deleted; Path=/; Max-Age=0", None),
        ("Path=/", "JSESSIONID=; Path=/; Max-Age=0", None),
        (
            "Path=/",
            "JSESSIONID=replacement; Path=/",
            Some("replacement"),
        ),
    ] {
        let server_key = key.clone();
        let phone = phone_with_responder(key.clone(), move |request| {
            if request.method == "POST" {
                return respond(200, "OK", "", &answer_body(Answer::Done));
            }
            if request.route() == servlet::LOGIN_FORM {
                return respond(
                    200,
                    "OK",
                    &format!("Set-Cookie: JSESSIONID={SESSION_ID}; {attributes}\r\n"),
                    T21P_BOOTSTRAP,
                );
            }
            let headers = if final_cookie.is_empty() {
                String::new()
            } else {
                format!("Set-Cookie: {final_cookie}\r\n")
            };
            respond(
                200,
                "OK",
                &headers,
                &login_page(&server_key, expected.unwrap_or(SESSION_ID)),
            )
        })
        .await;
        let slot = session_slot();
        let result = sign_in(&phone, &slot).await;
        if let Some(session_id) = expected {
            result.unwrap();
            assert_encrypted_session(&phone, session_id);
        } else {
            let error = result.unwrap_err();
            assert!(error.contains("started no web session"), "{error}");
            assert!(slot.read().unwrap().is_none());
        }
        assert_discovery_requests(
            &phone,
            &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
            expected.map(|_| servlet::LOGIN_POST_LEGACY),
        );
    }
}

#[tokio::test]
async fn a_self_navigation_cookie_does_not_authorize_an_unsupported_login_form() {
    let phone = phone_with_responder(test_key(), |request| {
        if request.cookie.is_none() {
            return respond(
                200,
                "OK",
                &format!("Set-Cookie: JSESSIONID={SESSION_ID}; Path=/\r\n"),
                &format!("<script>location='{}';</script>", servlet::LOGIN_FORM),
            );
        }
        respond(
            200,
            "OK",
            "",
            "<form method='post'><input name='username'><input name='password'></form>",
        )
    })
    .await;
    let slot = session_slot();
    assert_eq!(
        sign_in(&phone, &slot).await.unwrap_err(),
        UnsupportedPhone::Unrecognised.message()
    );
    assert_discovery_requests(
        &phone,
        &[
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM,
            servlet::LOGIN_FORM_LEGACY,
            servlet::LOGIN_FORM_ROOT,
        ],
        None,
    );
    assert!(slot.read().unwrap().is_none());
    assert!(!browser_login_pending(&slot));
}

#[tokio::test]
async fn t21p_bootstrap_after_post_is_session_lost_and_never_retried() {
    let key = test_key();
    let server_key = key.clone();
    let phone = phone_with_responder(key, move |request| {
        if request.method == "POST" {
            return respond(
                200,
                "OK",
                &format!("Set-Cookie: JSESSIONID={LEGACY_SESSION_ID}; Path=/\r\n"),
                T21P_BOOTSTRAP,
            );
        }
        page_response(Page::Encrypted, &server_key, SESSION_ID)
    })
    .await;
    assert_eq!(
        auth::classify_login_response(200, None, T21P_BOOTSTRAP),
        LoginOutcome::SessionLost
    );
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("ended the web session"), "{error}");
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], Some(servlet::LOGIN_POST));
    assert_encrypted_session(&phone, SESSION_ID);
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn discovery_uses_the_old_route_after_an_unknown_page_or_404() {
    for miss in [Page::Unrecognised, Page::NotFound] {
        let phone = discovery_phone([miss, Page::Encrypted, Page::Encrypted], Answer::Done).await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(
            &phone,
            &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
            Some(servlet::LOGIN_POST_LEGACY),
        );
        assert_encrypted_session(&phone, LEGACY_SESSION_ID);
        assert_eq!(
            slot.read().unwrap().as_deref(),
            Some(format!("JSESSIONID={LEGACY_SESSION_ID}").as_str())
        );
    }
}

#[tokio::test]
async fn discovery_uses_the_root_after_two_misses_and_posts_to_the_modern_route() {
    for misses in [
        [Page::Unrecognised, Page::NotFound],
        [Page::NotFound, Page::Unrecognised],
    ] {
        let phone = discovery_phone([misses[0], misses[1], Page::Encrypted], Answer::Done).await;
        let slot = session_slot();
        sign_in(&phone, &slot).await.unwrap();
        assert_discovery_requests(
            &phone,
            &[
                servlet::LOGIN_FORM,
                servlet::LOGIN_FORM_LEGACY,
                servlet::LOGIN_FORM_ROOT,
            ],
            Some(servlet::LOGIN_POST),
        );
        assert_encrypted_session(&phone, ROOT_SESSION_ID);
        assert_eq!(
            slot.read().unwrap().as_deref(),
            Some(format!("JSESSIONID={ROOT_SESSION_ID}").as_str())
        );
    }
}

#[tokio::test]
async fn discovery_stops_after_three_unknown_or_missing_pages_without_a_post() {
    for page in [Page::Unrecognised, Page::NotFound] {
        let phone = discovery_phone([page; 3], Answer::Done).await;
        let slot = session_slot();
        let error = sign_in(&phone, &slot).await.unwrap_err();
        assert!(!error.is_empty());
        assert_discovery_requests(
            &phone,
            &[
                servlet::LOGIN_FORM,
                servlet::LOGIN_FORM_LEGACY,
                servlet::LOGIN_FORM_ROOT,
            ],
            None,
        );
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn discovery_never_contacts_a_redirect_on_another_origin() {
    let other = phone(Page::Encrypted, Answer::Done).await;
    let destination = other.url.join(servlet::LOGIN_FORM_LEGACY).unwrap();
    let phone = phone_with_responder(test_key(), move |_| {
        respond(302, "Found", &format!("Location: {destination}\r\n"), "")
    })
    .await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap_err();
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
    assert!(
        other.requests().is_empty(),
        "the redirect destination must receive no request"
    );
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn rejection_or_lock_after_discovery_is_terminal_after_one_encrypted_post() {
    for answer in [Answer::Rejected, Answer::Locked] {
        let phone =
            discovery_phone([Page::NotFound, Page::Encrypted, Page::Encrypted], answer).await;
        let slot = session_slot();
        let error = sign_in(&phone, &slot).await.unwrap_err();
        if answer == Answer::Rejected {
            assert_eq!(error, "The phone rejected the username or password");
        } else {
            assert!(error.contains("locked this account"), "{error}");
        }
        assert_discovery_requests(
            &phone,
            &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
            Some(servlet::LOGIN_POST_LEGACY),
        );
        assert_encrypted_session(&phone, LEGACY_SESSION_ID);
        assert!(slot.read().unwrap().is_none());
    }
}

#[tokio::test]
async fn discovery_does_not_reuse_an_earlier_cookie_when_the_key_page_issues_none() {
    // The modern miss sets a valid cookie. A client jar must not turn that
    // stale cookie into authorization for the legacy page's different key.
    let phone = discovery_phone(
        [Page::Unrecognised, Page::NoSession, Page::Encrypted],
        Answer::Done,
    )
    .await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();
    assert!(error.contains("one web session at a time"), "{error}");
    assert_discovery_requests(
        &phone,
        &[servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY],
        None,
    );
    assert!(slot.read().unwrap().is_none());
}

#[tokio::test]
async fn discovery_stops_on_terminal_pages_instead_of_trying_another_login_route() {
    for terminal in [
        Page::LegacyBasic,
        Page::JsonApi,
        Page::ServerError,
        Page::Unauthorized,
        Page::Forbidden,
        Page::TooManyRequests,
        Page::NoSession,
        Page::InvalidKey,
    ] {
        for index in [0, 1] {
            let mut pages = [Page::NotFound, Page::Encrypted, Page::Encrypted];
            pages[index] = terminal;
            let phone = discovery_phone(pages, Answer::Done).await;
            let slot = session_slot();
            sign_in(&phone, &slot).await.unwrap_err();
            let routes = [servlet::LOGIN_FORM, servlet::LOGIN_FORM_LEGACY];
            assert_discovery_requests(&phone, &routes[..=index], None);
            assert!(slot.read().unwrap().is_none());
        }
    }
}

#[tokio::test]
async fn a_successful_handshake_binds_the_password_to_the_session_the_page_issued() {
    let phone = phone(Page::Encrypted, Answer::Done).await;
    let slot = session_slot();
    sign_in(&phone, &slot).await.unwrap();
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], Some(servlet::LOGIN_POST));

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
    // Same origin alone is insufficient: the path must also be an explicitly
    // supported login-page shape.
    let phone = phone(Page::Bounced, Answer::Done).await;
    let slot = session_slot();
    let error = sign_in(&phone, &slot).await.unwrap_err();

    assert!(error.to_ascii_lowercase().contains("redirect"), "{error}");
    assert_discovery_requests(&phone, &[servlet::LOGIN_FORM], None);
    assert!(slot.read().unwrap().is_none());
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
