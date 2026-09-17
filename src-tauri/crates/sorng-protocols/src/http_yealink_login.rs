//! Native Yealink servlet pre-authentication for the loopback mediator (t96 §3.1).
//!
//! A Yealink T2x phone cannot be signed into from inside the website frame: the
//! page's own JavaScript has to encrypt the password under a per-session RSA
//! key, and that script is aborted in our sandbox (t95). So the proxy performs
//! the phone's login handshake **itself**, once, before the frame loads a
//! single byte, and then serves an already-authenticated web UI.
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

use std::sync::{Arc, RwLock};

use rand::SeedableRng;
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
pub type YealinkSessionCookie = Arc<RwLock<Option<String>>>;

/// An empty slot for a session that has not pre-authenticated (every mode but
/// [`crate::http::UpstreamAuthMode::YealinkServlet`]).
pub fn session_slot() -> YealinkSessionCookie {
    Arc::new(RwLock::new(None))
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
                "The phone's sign-in page carried no session key, and it matches no Yealink \
                 generation this app knows. Nothing was guessed and no password was sent. Set \
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
    if body.contains(legacy::BODY_MARKER) {
        return LoginPage::Unsupported(UnsupportedPhone::LegacyBasic);
    }
    if JSON_API_MARKERS.iter().any(|marker| body.contains(marker)) {
        return LoginPage::Unsupported(UnsupportedPhone::JsonApi);
    }
    LoginPage::Unsupported(UnsupportedPhone::Unrecognised)
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
    let name = servlet::SESSION_COOKIE;
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|cookie| {
            let (found, value) = cookie.trim_start().split_once('=')?;
            if !found.eq_ignore_ascii_case(name) {
                return None;
            }
            let value = value.split(';').next().unwrap_or_default().trim();
            (!value.is_empty()
                && value.len() <= MAX_SESSION_VALUE
                && value.bytes().all(cookie_octet))
            .then(|| format!("{name}={value}"))
        })
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
/// A redirect gets its own sentence because this module deliberately follows
/// none: the proxy talks to the connection's own origin and nowhere else, so a
/// bounce is a dead end rather than something to chase.
fn page_status_error(status: u16) -> String {
    if (300..400).contains(&status) {
        format!(
            "The phone answered its sign-in page with a redirect (HTTP {status}). Automatic \
             sign-in never follows a redirect, so no password was sent. Set this connection's \
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
/// the user approved; there is no redirect chasing anywhere in this module.
fn servlet_url(
    target: &reqwest::Url,
    path: &str,
    param: &str,
    rng: &mut impl rand::RngCore,
) -> Result<reqwest::Url, String> {
    let origin = target.origin().ascii_serialization();
    let path = auth::with_cache_buster(path, param, rng);
    reqwest::Url::parse(&format!("{origin}{path}")).map_err(|_| {
        "The phone's web address could not be used for an automatic sign-in.".to_string()
    })
}

/// Sign in to the phone and hold its web session for this proxy session.
///
/// Performs exactly one login-page GET and at most one login POST, then stores
/// the resulting `JSESSIONID` in `session`. Returns `Err` with a message the
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
    // `StdRng` rather than `thread_rng()`: this future has to stay `Send`.
    let mut rng = rand::rngs::StdRng::from_entropy();

    let form_url = servlet_url(
        target,
        servlet::LOGIN_FORM,
        servlet::PARAM_FORM_NONCE,
        &mut rng,
    )?;
    let mut form = client
        .get(form_url)
        .send()
        .await
        .map_err(|_| "The phone did not answer its sign-in page. Check the address and that the phone's web interface is enabled.".to_string())?;
    let status = form.status();
    let headers = form.headers().clone();
    let body = bounded_body(&mut form).await;

    if status == reqwest::StatusCode::UNAUTHORIZED
        && headers.contains_key(WWW_AUTHENTICATE)
        && !body.contains(servlet::USERNAME_ID_MARKER)
    {
        // A Basic challenge on the servlet path is the legacy generation.
        log::debug!(
            "yealink pre-auth: generation {}",
            UnsupportedPhone::LegacyBasic.as_str()
        );
        return Err(UnsupportedPhone::LegacyBasic.message().into());
    }

    let page = classify_login_page(&body);
    log::debug!(
        "yealink pre-auth: sign-in page HTTP {} classified {}",
        status.as_u16(),
        match &page {
            LoginPage::Encrypted(_) => "encrypted",
            LoginPage::Unsupported(kind) => kind.as_str(),
        }
    );
    let facts = match page {
        LoginPage::Encrypted(facts) if status.is_success() => facts,
        // A recognised generation is the more useful answer even when it came
        // with an odd status; an unplaceable page is reported by its status,
        // which is far more actionable than "no session key".
        LoginPage::Unsupported(UnsupportedPhone::Unrecognised) if !status.is_success() => {
            return Err(page_status_error(status.as_u16()))
        }
        LoginPage::Encrypted(_) => return Err(page_status_error(status.as_u16())),
        LoginPage::Unsupported(kind) => return Err(kind.message().into()),
    };
    let issued = session_cookie_pair(&headers);
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

    let login_url = servlet_url(
        target,
        servlet::LOGIN_POST,
        servlet::PARAM_LOGIN_NONCE,
        &mut rng,
    )?;
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
