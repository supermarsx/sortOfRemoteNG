//! Native Yealink servlet pre-authentication for the loopback mediator (t96 §3.1).
//!
//! RSA-capable Yealink T2x phones are signed into before the website frame: the
//! page's own JavaScript has to encrypt the password under a per-session RSA
//! key, and that script is aborted in our sandbox (t95). So the proxy performs
//! the phone's login handshake **itself**, once, before the frame loads a
//! single byte, and then serves an already-authenticated web UI.
//! The attested keyless T20P form is different: native discovery sends no POST
//! and leaves the session empty. Its reviewed browser client fills the named
//! fields and clicks the phone's OnConfirm control under the existing form
//! consent and one-use credential nonce. It never emulates that page handler.
//!
//! Two properties make this strictly safer than filling the page:
//!
//! * **No credential is ever released into the document.** The password stays
//!   in the session's secret slots; the page never receives it, and
//!   [`crate::themed_autologin`] refuses to dispense for this mode.
//! * **The session cookie is held proxy-side.** Real firmware issues its
//!   `JSESSIONID` without a `SameSite` attribute — i.e. `Lax` — which a
//!   cross-site website frame would never send back. Relying on the browser to
//!   carry it would work against a fixture and fail against a real phone, so
//!   every upstream request in this session gets the cookie merged in natively
//!   ([`apply_session_cookie`]).
//!
//! **Exactly one handshake per session arm.** The phone allows a single web
//! session and locks an account out after repeated failed sign-ins, so
//! `authstatus` `none` and `lock` are terminal and there is no retry, no
//! backoff and no second attempt anywhere below. A second arm needs a new
//! session.
//!
//! **Secret hygiene.** The password, the AES key/IV and the session id never
//! reach a log, an error message or a status DTO. Only the presence of a
//! session id, the non-secret `g_phonetype` / `g_strFirmware` and the
//! classification labels are logged.
//!
//! The page grammar, the password wrapper and the response classification are
//! **not** implemented here: they live once in
//! [`sorng_voip_phone::yealink_servlet_auth`], shared with the native
//! VoIP-phone driver so the two can never drift (t96 §3.3).

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, RwLock};

use rand::SeedableRng;
use reqwest::cookie::CookieStore;
use reqwest::header::{HeaderMap, CONTENT_TYPE, COOKIE, SET_COOKIE, WWW_AUTHENTICATE};
use sorng_voip_phone::endpoints::{legacy, servlet};
use sorng_voip_phone::yealink_servlet_auth as auth;
use sorng_voip_phone::LoginOutcome;

/// Largest login page / login answer this module will read. Both are a few
/// kilobytes on real firmware; anything past this is truncated rather than
/// buffered, so a hostile upstream cannot grow the proxy's memory.
const MAX_BODY: usize = 256 * 1024;

/// Largest merged `Cookie` header this module will build. Past it the phone's
/// own session wins alone: an authenticated session is worth more than a page's
/// accumulated preferences, and an over-long header would be rejected upstream.
const MAX_COOKIE_HEADER: usize = 8 * 1024;

/// Upper bound on a `JSESSIONID` value. Real firmware issues 32 hex characters.
const MAX_SESSION_VALUE: usize = 256;

/// Markers of the T4x/T5x JSON login API. Detected so the failure is named
/// rather than guessed at; the API itself is deliberately not implemented
/// (t96 §6.7 — a separate task if the user has such phones).
const JSON_API_MARKERS: &[&str] = &["/api/auth/login", "/api/common/info"];

/// The phone's web session, held by the proxy for the life of one session arm.
///
/// Stores the whole `JSESSIONID=<value>` pair so it can be spliced into a
/// forwarded `Cookie` header without re-deriving the name. **Secret**: never
/// serialize, log or expose this through a status DTO.
#[derive(Clone, Default)]
pub struct YealinkSessionCookie {
    cookie: Arc<RwLock<Option<String>>>,
    // Positive admission, not inferred from a missing/failed RSA session.
    t20p_dom_admitted: Arc<std::sync::atomic::AtomicBool>,
}

impl std::ops::Deref for YealinkSessionCookie {
    type Target = RwLock<Option<String>>;
    fn deref(&self) -> &Self::Target {
        &self.cookie
    }
}

/// An empty slot for a session that has not pre-authenticated (every mode but
/// [`crate::http::UpstreamAuthMode::YealinkServlet`]).
pub fn session_slot() -> YealinkSessionCookie {
    YealinkSessionCookie::default()
}

// ── login page classification ────────────────────────────────────────────────

/// A login page that cannot be signed into by the servlet handshake. Each arm
/// is a *recognised* generation or an honest "unrecognised" — this module never
/// guesses a request shape for a page that did not advertise one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedPhone {
    /// Pre-v8x `ConfigManApp.com`: the whole UI sits behind HTTP Basic and
    /// there is no servlet session to establish.
    LegacyBasic,
    /// T4x/T5x JSON API. Recognised, deliberately not implemented.
    JsonApi,
    /// A page this module cannot place. Never guessed at.
    Unrecognised,
}

impl UnsupportedPhone {
    /// Log-safe label. Carries no page content.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LegacyBasic => "legacy-basic",
            Self::JsonApi => "json-api",
            Self::Unrecognised => "unrecognised",
        }
    }

    /// The message the user has to act on. Each one names the setting to
    /// change, because there is nothing this mode can retry.
    pub fn message(self) -> &'static str {
        match self {
            Self::LegacyBasic => {
                "This phone runs the older ConfigManApp web interface, which uses HTTP Basic \
                 rather than a servlet login. Set this connection's application login mode to \
                 Basic and reconnect."
            }
            Self::JsonApi => {
                "This phone runs the newer T4x/T5x JSON login API, which automatic sign-in does \
                 not support yet. Set this connection's application login mode to Manual and \
                 sign in on the phone's own page."
            }
            Self::Unrecognised => {
                "The modern, older servlet and root sign-in pages provided no supported RSA \
                 session key. No password was sent. This phone's firmware login format is not \
                 supported yet. Set \
                 this connection's application login mode to Manual and sign in on the phone's \
                 own page."
            }
        }
    }
}

/// What the login-page GET told us.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginPage {
    /// The attested servlet generation: the page published a per-session RSA
    /// public key, so the password can be wrapped the way the page's own
    /// JavaScript would have wrapped it.
    Encrypted(auth::LoginFormFacts),
    /// Exact keyless SIP-T20P form, submitted only by its own browser handler.
    LegacyT20pDom,
    /// Recognised, or honestly unrecognised — either way, not signable here.
    Unsupported(UnsupportedPhone),
}

/// Classify a login page. A page carrying an RSA public key in **any** attested
/// shape is signable; everything else is named rather than guessed at.
pub fn classify_login_page(body: &str) -> LoginPage {
    let facts = auth::parse_login_form(body);
    if facts.is_encrypted() {
        return LoginPage::Encrypted(facts);
    }
    if is_t20p_dom_form(body) {
        return LoginPage::LegacyT20pDom;
    }
    if body.contains(legacy::BODY_MARKER) {
        return LoginPage::Unsupported(UnsupportedPhone::LegacyBasic);
    }
    if JSON_API_MARKERS.iter().any(|marker| body.contains(marker)) {
        return LoginPage::Unsupported(UnsupportedPhone::JsonApi);
    }
    LoginPage::Unsupported(UnsupportedPhone::Unrecognised)
}

/// Conservative discovery only; the browser independently validates the live
/// form, handler readiness and same-origin action before redeeming any secret.
fn is_t20p_dom_form(body: &str) -> bool {
    use std::collections::HashMap;
    fn attributes(text: &str) -> Option<HashMap<String, String>> {
        static ATTR: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let re = ATTR.get_or_init(|| {
            regex::Regex::new(
                r#"(?is)\s+([^\s'"=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?"#,
            )
            .unwrap()
        });
        let mut result = HashMap::new();
        for cap in re.captures_iter(text) {
            let value = (2..=4)
                .find_map(|index| cap.get(index))
                .map_or("", |v| v.as_str());
            if result
                .insert(cap[1].to_ascii_lowercase(), value.replace("&amp;", "&"))
                .is_some()
            {
                return None;
            }
        }
        Some(result)
    }
    fn value<'a>(attrs: &'a HashMap<String, String>, key: &str) -> &'a str {
        attrs.get(key).map(String::as_str).unwrap_or_default()
    }
    fn handler(value: &str) -> String {
        value
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .collect::<String>()
            .trim_end_matches(';')
            .to_string()
    }
    static INERT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static FORMS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static TAGS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let clean = INERT.get_or_init(|| regex::Regex::new(
        r"(?is)<!--.*?-->|<(?:script|style|textarea|template)\b[^>]*>.*?</(?:script|style|textarea|template)\s*>",
    ).unwrap()).replace_all(body, "");
    let forms = FORMS.get_or_init(|| {
        regex::Regex::new(r#"(?is)<form\b((?:"[^"]*"|'[^']*'|[^'">])*)>(.*?)</form\s*>"#).unwrap()
    });
    let mut forms = forms.captures_iter(&clean);
    let Some(form) = forms.next() else {
        return false;
    };
    if forms.next().is_some() {
        return false;
    }
    let Some(attrs) = attributes(&form[1]) else {
        return false;
    };
    if value(&attrs, "name") != "formInput"
        || !value(&attrs, "method").eq_ignore_ascii_case("post")
        || !value(&attrs, "autocomplete").eq_ignore_ascii_case("off")
        || handler(value(&attrs, "onsubmit")) != "returnfalse"
        || !matches!(value(&attrs, "target"), "" | "_self")
        || value(&attrs, "action") != "/servlet?p=login&q=login"
    {
        return false;
    }
    let tags = TAGS.get_or_init(|| {
        regex::Regex::new(r#"(?is)<([a-z][a-z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>"#).unwrap()
    });
    let mut roles = HashSet::new();
    for tag in tags.captures_iter(&form[2]) {
        let Some(attrs) = attributes(&tag[2]) else {
            return false;
        };
        let name = value(&attrs, "name");
        let id = value(&attrs, "id");
        let kind = value(&attrs, "type");
        let role = if matches!(name, "username" | "pwd" | "jumpto" | "acc") {
            let valid = match name {
                "username" => kind.eq_ignore_ascii_case("text"),
                "pwd" => kind.eq_ignore_ascii_case("password"),
                "jumpto" => {
                    kind.eq_ignore_ascii_case("hidden") && value(&attrs, "value") == "status"
                }
                "acc" => kind.eq_ignore_ascii_case("hidden") && value(&attrs, "value").is_empty(),
                _ => false,
            };
            if !valid {
                return false;
            }
            name
        } else if matches!(id, "idConfirm" | "idCancel") {
            let expected = if id == "idConfirm" {
                "OnConfirm()"
            } else {
                "OnClear()"
            };
            if !kind.eq_ignore_ascii_case("button") || handler(value(&attrs, "onclick")) != expected
            {
                return false;
            }
            id
        } else {
            continue;
        };
        if !tag[1].eq_ignore_ascii_case("input")
            || attrs.contains_key("form")
            || !roles.insert(role.to_string())
        {
            return false;
        }
    }
    if roles.len() != 6 {
        return false;
    }
    let mut models = 0;
    for tag in tags.captures_iter(&clean) {
        let Some(attrs) = attributes(&tag[2]) else {
            return false;
        };
        if value(&attrs, "id") == "loginPhoneModel" {
            models += 1;
            let text = &clean[tag.get(0).unwrap().end()..];
            if text.split('<').next().unwrap_or_default().trim() != "Enterprise IP phone SIP-T20P" {
                return false;
            }
        }
    }
    models == 1
}

/// Native RSA sessions never authorize document credential delivery. Startup
/// must positively recognize the T20P form; failure and restart have no grant.
pub(crate) fn browser_login_pending(session: &YealinkSessionCookie) -> bool {
    session
        .t20p_dom_admitted
        .load(std::sync::atomic::Ordering::SeqCst)
        && session.read().is_ok_and(|cookie| cookie.is_none())
}

// ── session cookie ───────────────────────────────────────────────────────────

/// RFC 6265 `cookie-octet`. A value outside this set never reaches a forwarded
/// header.
fn cookie_octet(byte: u8) -> bool {
    matches!(byte, 0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e)
}

/// Extract `JSESSIONID=<value>` from a response's `Set-Cookie` headers.
///
/// Returns the whole pair so callers never rebuild the name, and validates the
/// value against the cookie grammar and a length bound because it is spliced
/// into every subsequent upstream request. **Secret**: never log the result.
pub fn session_cookie_pair(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(valid_session_cookie_pair)
}

fn valid_session_cookie_pair(cookie: &str) -> Option<String> {
    let name = servlet::SESSION_COOKIE;
    let (found, value) = cookie.trim_start().split_once('=')?;
    if !found.eq_ignore_ascii_case(name) {
        return None;
    }
    let value = value.split(';').next().unwrap_or_default().trim();
    (!value.is_empty() && value.len() <= MAX_SESSION_VALUE && value.bytes().all(cookie_octet))
        .then(|| format!("{name}={value}"))
}

/// Merge the proxy-held phone session into a browser `Cookie` header.
///
/// The proxy's cookie is **authoritative**: it is the session this proxy
/// authenticated, and any same-named value the browser offers is either a copy
/// of it or a stale one from an earlier arm. Every other browser cookie is kept
/// in its original order, after the session.
///
/// `None` means "leave the request's cookies exactly as they were".
pub fn merge_session_cookie(browser: Option<&str>, session: Option<&str>) -> Option<String> {
    let session = session?;
    let Some(browser) = browser else {
        return Some(session.to_string());
    };
    let name = servlet::SESSION_COOKIE;
    let mut merged = String::with_capacity(session.len() + browser.len() + 2);
    merged.push_str(session);
    for pair in browser.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let existing = pair.split_once('=').map(|(name, _)| name).unwrap_or(pair);
        if existing.eq_ignore_ascii_case(name) {
            continue;
        }
        if merged.len() + pair.len() + 2 > MAX_COOKIE_HEADER {
            // Keep the authenticated session rather than an oversized header.
            return Some(session.to_string());
        }
        merged.push_str("; ");
        merged.push_str(pair);
    }
    Some(merged)
}

/// Apply the proxy-held phone session to one request's forwarded headers.
///
/// Called on **every** upstream path — documents, subresources and the
/// WebSocket handshake — because the browser cannot be relied on to carry a
/// `Lax` cookie out of a cross-site website frame. A session that never
/// pre-authenticated leaves the headers untouched.
pub fn apply_session_cookie(headers: &mut Vec<(String, String)>, session: &YealinkSessionCookie) {
    let Some(session) = session.read().ok().and_then(|slot| slot.clone()) else {
        return;
    };
    let browser = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("cookie"))
        .map(|(_, value)| value.clone());
    let Some(merged) = merge_session_cookie(browser.as_deref(), Some(&session)) else {
        return;
    };
    headers.retain(|(name, _)| !name.eq_ignore_ascii_case("cookie"));
    headers.push(("cookie".into(), merged));
}

// ── the handshake ────────────────────────────────────────────────────────────

/// What to say when the sign-in page did not arrive at all.
///
/// Only known same-origin login-page redirects may be followed. Other redirects
/// are refused before any credential can be submitted.
fn page_status_error(status: u16) -> String {
    if (300..400).contains(&status) {
        format!(
            "The phone answered its sign-in page with a redirect (HTTP {status}). Automatic \
             sign-in could not use that login-page redirect, so no password was sent. Set this connection's \
             application login mode to Manual and sign in on the phone's own page."
        )
    } else {
        format!(
            "The phone answered its sign-in page with HTTP {status}, so no password was sent. \
             Check the address, and that the phone's web interface is enabled."
        )
    }
}

/// Read a bounded response body as lossy UTF-8. Firmware pages are ASCII; a
/// truncated tail only ever costs us a diagnostic hint.
async fn bounded_body(response: &mut reqwest::Response) -> String {
    let mut bytes: Vec<u8> = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        let room = MAX_BODY - bytes.len();
        if chunk.len() >= room {
            bytes.extend_from_slice(&chunk[..room]);
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The connection's own origin, with the servlet path and its cache buster.
/// Built from the validated target so the handshake can never leave the origin
/// the user approved.
fn servlet_url(
    target: &reqwest::Url,
    path: &str,
    param: &str,
    rng: &mut impl rand::RngCore,
) -> Result<reqwest::Url, String> {
    let origin = target.origin().ascii_serialization();
    let mut url = reqwest::Url::parse(&format!("{origin}{path}")).map_err(|_| {
        "The phone's web address could not be used for an automatic sign-in.".to_string()
    })?;
    // The root has no query yet; appending '&Random' would change its path.
    if path != servlet::LOGIN_FORM_ROOT {
        url.query_pairs_mut()
            .append_pair(param, &rng.next_u32().to_string());
    }
    Ok(url)
}

// Indices distinguish the canonical servlet route AND the presence of the only
// optional routing query we accept. Random is never part of visit identity.
// The first three remain the ordinary discovery order; the last two are used
// only when a redirect explicitly asks for that jumpto variant.
const LOGIN_PAGES: [(&str, &str); 5] = [
    (servlet::LOGIN_FORM, servlet::LOGIN_POST),
    (servlet::LOGIN_FORM_LEGACY, servlet::LOGIN_POST_LEGACY),
    (servlet::LOGIN_FORM_ROOT, servlet::LOGIN_POST),
    (
        "/servlet?m=mod_listener&p=login&q=loginForm&jumpto=status",
        servlet::LOGIN_POST,
    ),
    ("/servlet?p=login&q=loginForm", servlet::LOGIN_POST_LEGACY),
];
const MAX_LOGIN_PAGE_GETS: usize = 5;

/// Recognise only the phone's fixed login endpoints, never an arbitrary URL
/// supplied by a response. Preserve the allowlisted jumpto=status variant,
/// then rebuild the URL from constants with a fresh Random value.
fn login_redirect_candidate(source: &reqwest::Url, location: &str) -> Option<usize> {
    let destination = source.join(location).ok()?;
    if destination.origin() != source.origin()
        || !destination.username().is_empty()
        || destination.password().is_some()
        || destination.fragment().is_some()
    {
        return None;
    }
    if destination.path() == "/" && destination.query().is_none() {
        return Some(2);
    }
    if destination.path() != "/servlet" {
        return None;
    }
    let mut seen = HashSet::new();
    let mut modern = false;
    for (name, value) in destination.query_pairs() {
        if !seen.insert(name.to_string()) {
            return None;
        }
        match name.as_ref() {
            "p" if value == "login" => {}
            "q" if value == "loginForm" => {}
            "m" if value == "mod_listener" => modern = true,
            "jumpto" if value == "status" => {}
            "Random"
                if !value.is_empty()
                    && value.len() <= 32
                    && value.parse::<f64>().is_ok()
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || byte == b'.') => {}
            _ => return None,
        }
    }
    (seen.contains("p") && seen.contains("q")).then_some(match (modern, seen.contains("jumpto")) {
        (true, false) => 0,
        (false, true) => 1,
        (true, true) => 3,
        (false, false) => 4,
    })
}

/// Read only a standalone literal location assignment in an inline bootstrap
/// script. This is not a JavaScript evaluator: expressions, escapes, extra
/// statements and multiple redirects are refused. Commented-out scripts are
/// skipped, and normal login-page scripts are left to the form parser.
fn login_script_redirect(body: &str) -> Result<Option<&str>, ()> {
    static SCRIPTS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static ASSIGNMENT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let scripts = SCRIPTS.get_or_init(|| {
        regex::Regex::new(
            r#"(?is)<!--.*?-->|<script(?:\s+type\s*=\s*(?:"text/javascript"|'text/javascript'))?\s*>(.*?)</script\s*>"#,
        )
        .expect("fixed bootstrap script grammar")
    });
    let assignment = ASSIGNMENT.get_or_init(|| {
        regex::Regex::new(
            r"(?s)\A(?:window\s*\.\s*|document\s*\.\s*)?location(?:\s*\.\s*href)?\s*=\s*(.*)\z",
        )
        .expect("fixed location assignment grammar")
    });
    let mut location = None;
    for script in scripts.captures_iter(body) {
        let Some(script) = script.get(1) else {
            continue;
        };
        let Some(value) = assignment.captures(script.as_str().trim()) else {
            continue;
        };
        let value = value.get(1).ok_or(())?.as_str().trim();
        let quote = value.chars().next().ok_or(())?;
        if !matches!(quote, '\'' | '"') || location.is_some() {
            return Err(());
        }
        let (literal, tail) = value[1..].split_once(quote).ok_or(())?;
        if !matches!(tail.trim(), "" | ";")
            || literal.is_empty()
            || literal.len() > 2048
            || literal
                .chars()
                .any(|ch| ch == '\\' || ch.is_control() || ch.is_whitespace())
        {
            return Err(());
        }
        location = Some(literal);
    }
    Ok(location)
}

/// Bounded credential-free discovery. Older T21P routing can return a normal
/// HTML error at the modern servlet URL, not a 404. Read the older servlet and
/// root variants before concluding the phone has an unsupported login format.
/// No scripts are executed, no arbitrary links fetched, and no POST is retried.
async fn discover_login_page(
    client: &reqwest::Client,
    target: &reqwest::Url,
    rng: &mut impl rand::RngCore,
) -> Result<(Option<auth::LoginFormFacts>, Option<String>, &'static str), String> {
    let mut pending = VecDeque::from([0, 1, 2]);
    let mut chain_visited = [false; LOGIN_PAGES.len()];
    let mut self_navigated = [false; LOGIN_PAGES.len()];
    // Track cookie provenance only within an explicit navigation chain. The
    // supplied client's jar still handles transmission, including other phone
    // cookies. A fallback page cannot authorize a later key with a stale cookie.
    let mut chain_cookies = reqwest::cookie::Jar::default();
    for attempt in 0..MAX_LOGIN_PAGE_GETS {
        let Some(index) = pending.pop_front() else {
            break;
        };
        chain_visited[index] = true;
        let (page_path, post_path) = LOGIN_PAGES[index];
        let form_url = servlet_url(target, page_path, servlet::PARAM_FORM_NONCE, rng)?;
        let mut form = client.get(form_url.clone()).send().await.map_err(|_| {
            "The phone did not answer its sign-in page. Check the address and that the phone's web interface is enabled.".to_string()
        })?;
        let status = form.status();
        let headers = form.headers().clone();
        chain_cookies.set_cookies(&mut headers.get_all(SET_COOKIE).iter(), &form_url);
        let body = bounded_body(&mut form).await;
        if status.is_redirection() {
            let candidate = headers
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| login_redirect_candidate(&form_url, value))
                .filter(|candidate| !chain_visited[*candidate] && attempt + 1 < MAX_LOGIN_PAGE_GETS)
                .ok_or_else(|| page_status_error(status.as_u16()))?;
            pending.retain(|value| *value != candidate);
            pending.push_front(candidate);
            continue;
        }
        if status.is_success() {
            let redirect_error = || {
                "The phone's sign-in page contained an unsafe, unsupported or repeated JavaScript \
                 redirect. No password was sent. Set this connection's application login mode to \
                 Manual and sign in on the phone's own page."
                    .to_string()
            };
            if let Some(location) = login_script_redirect(&body).map_err(|_| redirect_error())? {
                let candidate = login_redirect_candidate(&form_url, location)
                    .filter(|candidate| {
                        (!chain_visited[*candidate]
                            || (*candidate == index && !self_navigated[index]))
                            && attempt + 1 < MAX_LOGIN_PAGE_GETS
                    })
                    .ok_or_else(redirect_error)?;
                // Firmware can navigate back to its own login URL after setting
                // a cookie. Permit one such GET per route in this chain, never
                // a cycle; changing Random or cookies buys no extra hops.
                if candidate == index {
                    self_navigated[index] = true;
                }
                // Use the same canonical endpoints, hop bound, proxy client and
                // TLS policy as HTTP redirects, before inspecting form facts.
                pending.retain(|value| *value != candidate);
                pending.push_front(candidate);
                continue;
            }
        }
        if status == reqwest::StatusCode::UNAUTHORIZED
            && headers.contains_key(WWW_AUTHENTICATE)
            && !body.contains(servlet::USERNAME_ID_MARKER)
        {
            return Err(UnsupportedPhone::LegacyBasic.message().into());
        }
        let page = classify_login_page(&body);
        log::debug!(
            "yealink pre-auth: login page variant {} HTTP {} classified {}",
            index,
            status.as_u16(),
            match &page {
                LoginPage::Encrypted(_) => "encrypted",
                LoginPage::LegacyT20pDom => "legacy-t20p-dom",
                LoginPage::Unsupported(kind) => kind.as_str(),
            }
        );
        match page {
            LoginPage::Encrypted(facts) if status.is_success() => {
                // The final page may not reissue the bootstrap's session. Use
                // only cookies from this chain that remain valid for this URL
                // (domain, path, Secure and expiration included).
                let cookie = chain_cookies.cookies(&form_url).and_then(|header| {
                    header
                        .to_str()
                        .ok()?
                        .split(';')
                        .find_map(valid_session_cookie_pair)
                });
                return Ok((Some(facts), cookie, post_path));
            }
            LoginPage::LegacyT20pDom if status.is_success() => return Ok((None, None, post_path)),
            LoginPage::Unsupported(UnsupportedPhone::Unrecognised)
                if status.is_success() || status == reqwest::StatusCode::NOT_FOUND => {}
            LoginPage::Unsupported(kind) if kind != UnsupportedPhone::Unrecognised => {
                return Err(kind.message().into());
            }
            _ => return Err(page_status_error(status.as_u16())),
        }
        // A miss ends this navigation chain. A later fallback (e.g. the root)
        // may explicitly send us back to a previously probed login endpoint
        // with a newly established cookie. Discovery history is not a cycle.
        chain_visited = [false; LOGIN_PAGES.len()];
        self_navigated = [false; LOGIN_PAGES.len()];
        chain_cookies = reqwest::cookie::Jar::default();
    }
    Err(UnsupportedPhone::Unrecognised.message().into())
}

/// Prepare login: establish an RSA session, or admit the recognized T20P DOM
/// flow without sending credentials. The latter keeps the session slot empty.
///
/// Performs up to five credential-free login-page GETs and at most one login
/// POST, then stores the resulting `JSESSIONID` in `session`. Returns `Err` with a message the
/// user can act on; the caller refuses to open the connection rather than
/// serving a half-authenticated frame.
///
/// **No retry.** A rejected or locked-out sign-in is terminal — see the module
/// docs. A slot that already holds a session refuses outright, so a second
/// handshake on the same arm is impossible by construction.
pub async fn pre_authenticate(
    client: &reqwest::Client,
    target: &reqwest::Url,
    username: &str,
    password: &str,
    session: &YealinkSessionCookie,
) -> Result<(), String> {
    if session.read().is_ok_and(|slot| slot.is_some()) {
        // Not a retry path: the phone locks an account out after repeated
        // failures, so a second handshake on one arm is a bug, not a fallback.
        return Err("This phone session has already signed in. Reconnect to sign in again.".into());
    }
    if browser_login_pending(session) {
        return Err(
            "This phone session already prepared its page login. Reconnect to sign in again."
                .into(),
        );
    }
    // `StdRng` rather than `thread_rng()`: this future has to stay `Send`.
    let mut rng = rand::rngs::StdRng::from_entropy();

    let (facts, issued, post_path) = discover_login_page(client, target, &mut rng).await?;
    let Some(facts) = facts else {
        session
            .t20p_dom_admitted
            .store(true, std::sync::atomic::Ordering::SeqCst);
        return Ok(());
    };
    // Model and firmware are readable before authenticating and are the only
    // two page values this module is allowed to log. The session id itself is
    // a secret: only its presence is ever recorded.
    log::debug!(
        "yealink pre-auth: phone {:?} firmware {:?} session id present: {}",
        facts.phone_type.as_deref().unwrap_or("unknown"),
        facts.firmware.as_deref().unwrap_or("unknown"),
        issued.is_some()
    );

    let Some(cookie) = issued else {
        return Err("The phone's sign-in page started no web session. It allows only one web session at a time — close any browser tab open on the phone, then reconnect.".into());
    };
    let session_id = cookie
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();

    let body_fields = auth::build_login_body(username, password, &session_id, &facts, &mut rng)
        .map_err(|error| {
            // The module's errors describe the page's key, never our inputs.
            format!(
                "The phone's sign-in page could not be used: {}",
                error.message
            )
        })?;
    let encoded = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(
            body_fields
                .iter()
                .map(|(name, value)| (*name, value.as_str())),
        )
        .finish();

    let login_url = servlet_url(target, post_path, servlet::PARAM_LOGIN_NONCE, &mut rng)?;
    let mut answer = client
        .post(login_url)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(COOKIE, &cookie)
        .body(encoded)
        .send()
        .await
        .map_err(|_| {
            "The phone stopped answering during sign-in. No sign-in was retried.".to_string()
        })?;
    let status = answer.status().as_u16();
    let location = answer
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = bounded_body(&mut answer).await;

    let outcome = auth::classify_login_response(status, location.as_deref(), &body);
    log::debug!(
        "yealink pre-auth: answer HTTP {status} classified {}",
        outcome.as_str()
    );
    if outcome != LoginOutcome::Done {
        return Err(auth::login_outcome_error(outcome).message);
    }
    // A later `Set-Cookie` on the answer renews the session the phone just
    // authenticated; anything else keeps the one the form GET issued.
    let established = session_cookie_pair(answer.headers()).unwrap_or(cookie);
    *session
        .write()
        .map_err(|_| "The phone's web session could not be stored.".to_string())? =
        Some(established);
    Ok(())
}

#[cfg(test)]
#[path = "http_yealink_login_tests.rs"]
mod tests;
