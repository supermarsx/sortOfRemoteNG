//! Web auto-login (t20) — proxy-side credential delivery.
//!
//! This is the device-login-form analogue of the themed Basic-Auth flow in
//! [`crate::themed_auth`]. Where `themed_auth` swaps a `401 + WWW-Authenticate:
//! Basic` for a themed form the *user* fills, auto-login goes one step further:
//! for connections the admin has explicitly opted in (`http_auto_login`), the
//! proxy injects a small bootstrap before `</body>` that fetches the
//! connection's own saved credential over a nonce-guarded same-origin endpoint
//! and fills + submits the device's HTML login form automatically on connect.
//!
//! This reproduces the mRemoteNG + `cdp-auth` "auto-login" behaviour for the
//! device/appliance admin panels this tool manages (routers, switches,
//! firewalls, iLO/iDRAC/BMC, hypervisor consoles), using the app's own proxy
//! instead of an external CDP-driven Chromium.
//!
//! ## Why the proxy and not page-templated creds
//!
//! The injected HTML carries ONLY a per-page nonce (+ optional non-secret CSS
//! selector overrides) — never the secret in served HTML. The bootstrap calls
//! the endpoint below, which returns this session's saved `{username, password}`
//! exactly once. The secret stays in the backend session
//! ([`crate::http::AxumProxyState`]'s `username`/`password` RwLocks) until the
//! instant of fill.
//!
//! ## Security / correctness properties (spike-validated)
//!
//! 1. **Single-shot.** The endpoint *disarms* auto-login after the first
//!    credential hand-out. A re-rendered login-error page (a NEW HTML response,
//!    so it would get a NEW injected nonce) therefore cannot loop the proxy into
//!    re-dispensing creds. This makes "one submit, no retry loop" structural at
//!    the proxy layer, independent of the client script's own guard.
//! 2. **Nonce single-use.** Each injected page mints a fresh nonce stored in the
//!    session's `auto_login_nonce` slot; the endpoint consumes it on first read.
//!    A replayed/expired/wrong nonce is refused. This is the SAME pattern as
//!    [`crate::http::themed_auth_post_handler`], but a SEPARATE slot from
//!    themed-auth's `pending_nonce` (different lifecycle: auto-login arms on an
//!    armed HTML page; themed-auth arms on a 401).
//! 3. **Structural host binding.** Each proxy session is physically bound to one
//!    upstream (`target_url`) on its own random loopback port with its own nonce
//!    slot — a sibling 127.0.0.1 tab on a different proxy port has a different
//!    nonce slot and cannot pull this device's creds. The `same-origin` fetch
//!    means the browser only ever sends the request to this proxy's own origin.
//! 4. **Never logged.** The credential body is `Cache-Control: no-store` and is
//!    NEVER written to `ProxyRequestLogEntry` / `WebRecordingEntry`. The endpoint
//!    runs on its OWN axum route (registered ahead of the proxy fallback), so the
//!    fallback handler — the only place that appends to those logs — never sees
//!    this request, and the response body never enters any recording entry.
//! 5. **Selector overrides authoritative.** When a per-connection selector is
//!    set but does not match, the client routine signals "do not fill" rather
//!    than falling back to the heuristic (enforced client-side; the proxy passes
//!    the selectors through verbatim so the client can apply this rule).

use axum::body::Body;
use axum::http::{Response, StatusCode};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use crate::http::{AxumProxyState, HttpAutoLoginSelectors};
use crate::themed_auth::fresh_nonce;

/// JSON body returned to the injected bootstrap by the credential endpoint.
///
/// Carries the session's saved credential plus the (non-secret) selector
/// overrides so the client routine has everything it needs in one round-trip.
#[derive(Debug, Serialize)]
pub struct AutoLoginCreds {
    pub username: String,
    pub password: String,
    /// Optional per-connection CSS selector overrides (authoritative when set).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selectors: Option<HttpAutoLoginSelectors>,
}

/// Query string for the credential endpoint: `?nonce=<hex>`.
#[derive(Debug, serde::Deserialize)]
pub struct AutoLoginQuery {
    #[serde(default)]
    pub nonce: String,
}

/// The same-origin path the injected bootstrap fetches its credential from.
pub const AUTOLOGIN_PATH: &str = "/__sortofremoteng_autologin";

/// Build the `<script>` to inject before `</body>` for an armed auto-login
/// page, minting + stashing a fresh per-page nonce into the supplied
/// `auto_login_nonce` slot.
///
/// Returns `None` when auto-login is not armed (so the caller injects nothing
/// extra). The returned string is a `<script>...</script>` snippet ready to
/// splice in alongside the existing nav reporter.
///
/// Takes the individual session slots rather than the whole
/// [`AxumProxyState`] so it stays free of the Tauri `AppHandle` and is directly
/// unit-testable. [`build_autologin_injection`] is the thin
/// `&AxumProxyState` wrapper the proxy handler calls.
///
/// The injected HTML carries ONLY the nonce + optional non-secret selectors —
/// never the secret. e5 owns the full client fill/submit routine asset; the
/// injected `<script>` defers to `window.__sorng_autologin.fetchCredsAndRun`
/// when e5's asset is present, and otherwise runs a conservative inline
/// fill+submit so the seam is functional on its own.
pub fn build_autologin_injection_from_slots(
    armed: &AtomicBool,
    nonce_slot: &RwLock<Option<String>>,
    selectors: &Option<HttpAutoLoginSelectors>,
) -> Option<String> {
    if !armed.load(Ordering::Relaxed) {
        return None;
    }

    // Mint a fresh per-page nonce and stash it for the endpoint to consume.
    let nonce = fresh_nonce();
    match nonce_slot.write() {
        Ok(mut slot) => *slot = Some(nonce.clone()),
        // Lock poisoned — fail closed (inject nothing) rather than serve a
        // bootstrap whose nonce the endpoint can never match.
        Err(_) => return None,
    }

    // Selectors are non-secret CSS strings; JSON-encode for the client. The
    // client treats a set-but-unmatched selector as "do not fill".
    let selectors_json =
        serde_json::to_string(selectors).unwrap_or_else(|_| "null".to_string());

    Some(autologin_client_script(&nonce, &selectors_json))
}

/// `&AxumProxyState` wrapper over [`build_autologin_injection_from_slots`] for
/// the proxy handler's call site.
pub fn build_autologin_injection(state: &AxumProxyState) -> Option<String> {
    build_autologin_injection_from_slots(
        &state.auto_login_armed,
        &state.auto_login_nonce,
        &state.auto_login_selectors,
    )
}

/// The injected client bootstrap (the e3↔e5 seam).
///
/// `nonce` is a 32-char hex string from [`fresh_nonce`] so it needs no escaping;
/// `selectors_json` is `serde_json`-encoded.
///
/// **Contract for e5:** keep the public shape stable —
/// - fetch `GET {AUTOLOGIN_PATH}?nonce=<nonce>` with `cache: 'no-store'`,
///   `credentials: 'same-origin'`;
/// - the 200 body is `{ username, password, selectors? }` where `selectors` is
///   `{ username_selector?, password_selector?, submit_selector? }`
///   (snake_case, mirroring [`HttpAutoLoginSelectors`]);
/// - a non-200 means "not armed / nonce spent" — do nothing, do not retry the
///   fetch;
/// - fill + submit exactly once; never re-submit.
///
/// e5 should replace the inline routine below by defining
/// `window.__sorng_autologin.fetchCredsAndRun(nonce, selectors)` (the validated
/// `autologin-fill.js` routine), which this bootstrap auto-detects and defers
/// to. No change to this injection wiring is needed.
fn autologin_client_script(nonce: &str, selectors_json: &str) -> String {
    format!(
        r#"<script>(function(){{
'use strict';
var NONCE={nonce:?};
var SEL={selectors_json};
function nativeSet(el,v){{
  try{{
    var proto=Object.getPrototypeOf(el);
    var d=Object.getOwnPropertyDescriptor(proto,'value');
    var od=Object.getOwnPropertyDescriptor(el,'value');
    if(d&&d.set&&od&&od.set&&d.set!==od.set){{d.set.call(el,v);}}
    else if(d&&d.set){{d.set.call(el,v);}}
    else{{el.value=v;}}
  }}catch(_){{try{{el.value=v;}}catch(__){{}}}}
}}
function fill(el,v){{
  if(!el)return false;
  try{{el.focus();}}catch(_){{}}
  nativeSet(el,v);
  try{{el.dispatchEvent(new Event('input',{{bubbles:true}}));}}catch(_){{}}
  try{{el.dispatchEvent(new Event('change',{{bubbles:true}}));}}catch(_){{}}
  return el.value===v;
}}
function find(){{
  var pw=null,user=null;
  if(SEL&&SEL.password_selector){{
    pw=document.querySelector(SEL.password_selector);
    if(!pw)return null;
  }}else{{
    var ps=document.querySelectorAll('input[type=password]');
    for(var i=0;i<ps.length;i++){{if(ps[i].offsetParent!==null){{pw=ps[i];break;}}}}
  }}
  if(!pw)return null;
  if(SEL&&SEL.username_selector){{user=document.querySelector(SEL.username_selector);}}
  if(!user&&!(SEL&&SEL.username_selector)){{
    var form=pw.form||document;
    var cs=form.querySelectorAll('input[type=text],input[type=email],input:not([type])');
    for(var k=0;k<cs.length;k++){{
      var c=cs[k];
      if(c.offsetParent===null)continue;
      if(c.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING){{user=c;}}
    }}
  }}
  return {{pw:pw,user:user,form:pw.form||null}};
}}
function submit(t){{
  var scope=t.form||(t.pw.parentElement||document);
  var b=scope.querySelector('button[type=submit],input[type=submit]')||scope.querySelector('button:not([type])');
  if(SEL&&SEL.submit_selector){{var sb=document.querySelector(SEL.submit_selector);if(sb)b=sb;}}
  if(b){{b.click();return;}}
  if(t.form){{
    if(typeof t.form.requestSubmit==='function'){{t.form.requestSubmit();return;}}
    try{{t.form.submit();}}catch(_){{}}
  }}
}}
function run(creds){{
  var t=find();
  if(!t||!t.pw){{report({{ok:false,reason:'no-form'}});return;}}
  if(t.user)fill(t.user,creds.username);
  fill(t.pw,creds.password);
  submit(t);
  report({{ok:true,reason:'submitted'}});
}}
function report(r){{try{{window.parent.postMessage({{type:'proxy_autologin_result',result:r}},'*');}}catch(_){{}} window.__autologin_last=r;}}
function go(){{
  /* If e5's full client script is injected, defer to it entirely. */
  if(window.__sorng_autologin&&typeof window.__sorng_autologin.fetchCredsAndRun==='function'){{
    try{{window.__sorng_autologin.fetchCredsAndRun(NONCE,SEL);return;}}catch(_){{}}
  }}
  fetch('{path}?nonce='+encodeURIComponent(NONCE),{{method:'GET',credentials:'same-origin',cache:'no-store'}})
    .then(function(r){{return r.ok?r.json():Promise.reject(r.status);}})
    .then(function(c){{if(c&&c.selectors)SEL=c.selectors;run(c);}})
    .catch(function(s){{report({{ok:false,reason:'cred-fetch-'+s}});}});
}}
if(document.readyState==='loading'){{document.addEventListener('DOMContentLoaded',go);}}else{{go();}}
}})();</script>"#,
        nonce = nonce,
        selectors_json = selectors_json,
        path = AUTOLOGIN_PATH,
    )
}

/// `GET /__sortofremoteng_autologin?nonce=<nonce>` handler.
///
/// Hands the session's saved credential to the injected bootstrap exactly once:
///
/// 1. refuse unless auto-login is armed for this session;
/// 2. match + CONSUME the per-page nonce (single-use; same pattern as
///    [`crate::http::themed_auth_post_handler`]);
/// 3. **disarm** auto-login (single-shot: a re-rendered login-error page cannot
///    loop the proxy into re-dispensing creds);
/// 4. return `{ username, password, selectors? }` with `Cache-Control:
///    no-store`.
///
/// The body is NEVER logged: this runs on its own route, ahead of the proxy
/// fallback that is the sole writer of `ProxyRequestLogEntry` /
/// `WebRecordingEntry`, so the credential never reaches either.
pub async fn autologin_cred_handler(
    axum::extract::State(state): axum::extract::State<Arc<AxumProxyState>>,
    axum::extract::Query(query): axum::extract::Query<AutoLoginQuery>,
) -> Response<Body> {
    match dispense_credential(
        &state.auto_login_armed,
        &state.auto_login_nonce,
        &query.nonce,
        &state.username,
        &state.password,
    ) {
        DispenseOutcome::NotArmed => forbidden("auto-login not armed for this session"),
        DispenseOutcome::BadNonce => {
            forbidden("invalid, expired, or replayed auto-login nonce")
        }
        DispenseOutcome::Poisoned => server_error("auto_login_nonce lock poisoned"),
        DispenseOutcome::Ok { username, password } => {
            let body = AutoLoginCreds {
                username,
                password,
                selectors: state.auto_login_selectors.clone(),
            };
            // Serialize without touching any request/recording log.
            let json = match serde_json::to_string(&body) {
                Ok(s) => s,
                Err(_) => {
                    return server_error("failed to serialize auto-login credential")
                }
            };
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json; charset=utf-8")
                // `no-store` keeps the credential out of any HTTP cache.
                .header("Cache-Control", "no-store")
                // Same-origin only: loopback proxy on a random port; do NOT
                // widen with a permissive CORS header.
                .body(Body::from(json))
                .unwrap_or_else(|_| server_error("failed to build auto-login response"))
        }
    }
}

/// Result of the arm-check / nonce-consume / disarm sequence.
enum DispenseOutcome {
    NotArmed,
    BadNonce,
    Poisoned,
    Ok { username: String, password: String },
}

/// The pure credential-dispense logic the handler runs: arm-check, single-use
/// nonce consume, single-shot disarm, then read the saved credential. Split out
/// so it is unit-testable without a Tauri `AppHandle`.
fn dispense_credential(
    armed: &AtomicBool,
    nonce_slot: &RwLock<Option<String>>,
    req_nonce: &str,
    username: &RwLock<String>,
    password: &RwLock<String>,
) -> DispenseOutcome {
    // 1. Armed?  (Also fails after a previous hand-out disarmed it.)
    if !armed.load(Ordering::Relaxed) {
        return DispenseOutcome::NotArmed;
    }

    // 2. Nonce match + consume (single-use). A wrong/empty nonce must NOT
    //    consume or disarm — the legitimate page can still redeem the real one.
    let nonce_ok = {
        let mut slot = match nonce_slot.write() {
            Ok(g) => g,
            Err(_) => return DispenseOutcome::Poisoned,
        };
        match slot.as_ref() {
            Some(stored) if !req_nonce.is_empty() && stored == req_nonce => {
                *slot = None; // consume
                true
            }
            _ => false,
        }
    };
    if !nonce_ok {
        return DispenseOutcome::BadNonce;
    }

    // 3. Single-shot: disarm after the first credential hand-out so a
    //    re-rendered login-error page (new HTML => new injected nonce) cannot
    //    loop the proxy into re-dispensing the credential.
    armed.store(false, Ordering::Relaxed);

    // 4. Hand back THIS session's saved credential, once.
    let u = username.read().map(|g| g.clone()).unwrap_or_default();
    let p = password.read().map(|g| g.clone()).unwrap_or_default();
    DispenseOutcome::Ok {
        username: u,
        password: p,
    }
}

fn forbidden(msg: &str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Body::from(msg.to_string()))
        .expect("static forbidden response always valid")
}

fn server_error(msg: &str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Body::from(msg.to_string()))
        .expect("static server-error response always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selectors() -> HttpAutoLoginSelectors {
        HttpAutoLoginSelectors {
            username_selector: Some("#u".into()),
            password_selector: Some("#p".into()),
            submit_selector: None,
        }
    }

    fn outcome_creds(o: DispenseOutcome) -> Option<(String, String)> {
        match o {
            DispenseOutcome::Ok { username, password } => Some((username, password)),
            _ => None,
        }
    }

    #[test]
    fn nonce_is_single_use_and_disarms_after_handout() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(Some("abc123".to_string()));
        let user = RwLock::new("admin".to_string());
        let pass = RwLock::new("s3cret".to_string());

        // First call with the right nonce dispenses the credential.
        let first =
            outcome_creds(dispense_credential(&armed, &nonce, "abc123", &user, &pass));
        assert_eq!(first, Some(("admin".into(), "s3cret".into())));

        // The nonce is consumed: a replay with the SAME nonce is refused...
        let replay =
            outcome_creds(dispense_credential(&armed, &nonce, "abc123", &user, &pass));
        assert_eq!(replay, None, "consumed nonce must not dispense again");

        // ...and crucially auto-login is now DISARMED, so even a fresh nonce
        // minted by a re-rendered login-error page is refused — single-shot.
        *nonce.write().unwrap() = Some("def456".to_string());
        let after_error_rerender =
            outcome_creds(dispense_credential(&armed, &nonce, "def456", &user, &pass));
        assert_eq!(
            after_error_rerender, None,
            "single-shot: a re-rendered error page must not loop the proxy"
        );
        assert!(
            !armed.load(Ordering::Relaxed),
            "must be disarmed after first hand-out"
        );
    }

    #[test]
    fn wrong_nonce_is_refused_without_consuming_or_disarming() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(Some("correct".to_string()));
        let user = RwLock::new("u".to_string());
        let pass = RwLock::new("p".to_string());

        let bad = dispense_credential(&armed, &nonce, "wrong", &user, &pass);
        assert!(matches!(bad, DispenseOutcome::BadNonce));
        // A wrong nonce must NOT disarm or consume.
        assert!(armed.load(Ordering::Relaxed));
        assert_eq!(nonce.read().unwrap().as_deref(), Some("correct"));

        // The legitimate page's bootstrap can still redeem the real nonce.
        let good =
            outcome_creds(dispense_credential(&armed, &nonce, "correct", &user, &pass));
        assert_eq!(good, Some(("u".into(), "p".into())));
    }

    #[test]
    fn empty_nonce_is_refused() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(Some("x".to_string()));
        let user = RwLock::new("u".to_string());
        let pass = RwLock::new("p".to_string());
        assert!(matches!(
            dispense_credential(&armed, &nonce, "", &user, &pass),
            DispenseOutcome::BadNonce
        ));
        // Empty nonce against an empty slot must also be refused.
        let nonce2 = RwLock::new(None);
        assert!(matches!(
            dispense_credential(&armed, &nonce2, "", &user, &pass),
            DispenseOutcome::BadNonce
        ));
    }

    #[test]
    fn disarmed_session_never_dispenses() {
        let armed = AtomicBool::new(false);
        let nonce = RwLock::new(Some("abc".to_string()));
        let user = RwLock::new("u".to_string());
        let pass = RwLock::new("p".to_string());
        assert!(matches!(
            dispense_credential(&armed, &nonce, "abc", &user, &pass),
            DispenseOutcome::NotArmed
        ));
    }

    #[test]
    fn injection_is_none_when_not_armed() {
        let armed = AtomicBool::new(false);
        let nonce = RwLock::new(None);
        assert!(
            build_autologin_injection_from_slots(&armed, &nonce, &None).is_none()
        );
        // And no nonce was stashed.
        assert!(nonce.read().unwrap().is_none());
    }

    #[test]
    fn injection_mints_and_stashes_nonce_when_armed() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(None);
        let sel = Some(selectors());
        let script = build_autologin_injection_from_slots(&armed, &nonce, &sel)
            .expect("armed => injects");
        // A nonce was stashed into the slot...
        let stashed = nonce.read().unwrap().clone().expect("nonce stashed");
        assert_eq!(stashed.len(), 32, "fresh_nonce is 32 hex chars");
        // ...and the same nonce appears in the injected script.
        assert!(
            script.contains(&stashed),
            "injected script carries the stashed nonce"
        );
        // The script targets the credential endpoint.
        assert!(script.contains(AUTOLOGIN_PATH));
    }

    #[test]
    fn injection_does_not_leak_any_credential_into_html() {
        // The injected HTML must carry ONLY the nonce + selectors — the
        // builder never even receives the credential, so it cannot leak it.
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(None);
        let script =
            build_autologin_injection_from_slots(&armed, &nonce, &None).expect("armed");
        // Sanity: nothing that looks like a credential value is templated in.
        assert!(!script.contains("password\":\""));
        // The fetch is same-origin + no-store.
        assert!(script.contains("credentials:'same-origin'"));
        assert!(script.contains("cache:'no-store'"));
    }

    #[test]
    fn injection_carries_selectors_as_json_not_secret() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(None);
        let sel = Some(selectors());
        let script =
            build_autologin_injection_from_slots(&armed, &nonce, &sel).expect("armed");
        // Selectors are non-secret CSS strings, JSON-encoded for the client.
        assert!(script.contains("password_selector"));
        assert!(script.contains("#p"));
    }

    #[test]
    fn injection_poisoned_nonce_lock_fails_closed() {
        let armed = AtomicBool::new(true);
        let nonce = RwLock::new(None);
        // Poison the lock.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _g = nonce.write().unwrap();
            panic!("poison");
        }));
        assert!(nonce.is_poisoned());
        // Fail closed: inject nothing rather than a bootstrap whose nonce the
        // endpoint could never match.
        assert!(build_autologin_injection_from_slots(&armed, &nonce, &None).is_none());
    }

    #[test]
    fn creds_serialize_with_and_without_selectors() {
        let with = AutoLoginCreds {
            username: "u".into(),
            password: "p".into(),
            selectors: Some(selectors()),
        };
        let s = serde_json::to_string(&with).unwrap();
        assert!(s.contains("\"username\":\"u\""));
        assert!(s.contains("\"password\":\"p\""));
        assert!(s.contains("password_selector"));

        let without = AutoLoginCreds {
            username: "u".into(),
            password: "p".into(),
            selectors: None,
        };
        let s2 = serde_json::to_string(&without).unwrap();
        // `selectors` is skipped entirely when None.
        assert!(!s2.contains("selectors"));
    }

    /// Log-redaction guarantee: the credential the endpoint dispenses must
    /// never be representable through the proxy's log/recording entry types.
    /// `ProxyRequestLogEntry` records only method/url/status/error/timestamp;
    /// `WebRecordingEntry` records only sizes + headers. This test pins those
    /// shapes so a future field addition that could carry a body trips it.
    #[test]
    fn log_entry_shapes_carry_no_credential_body() {
        use crate::http::{ProxyRequestLogEntry, WebRecordingEntry};
        let entry = ProxyRequestLogEntry {
            session_id: "s".into(),
            method: "GET".into(),
            url: format!("{}?nonce=deadbeef", AUTOLOGIN_PATH),
            status: 200,
            error: None,
            timestamp: "t".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        // Only metadata — the credential can't be here.
        assert!(!json.contains("password"));
        assert!(json.contains("session_id"));

        // WebRecordingEntry records sizes, never the body bytes.
        let rec = WebRecordingEntry {
            timestamp_ms: 0,
            method: "GET".into(),
            url: AUTOLOGIN_PATH.into(),
            request_headers: Default::default(),
            request_body_size: 0,
            status: 200,
            response_headers: Default::default(),
            response_body_size: 42,
            content_type: Some("application/json".into()),
            duration_ms: 1,
            error: None,
        };
        let recjson = serde_json::to_string(&rec).unwrap();
        assert!(!recjson.contains("password"));
        // It carries a byte SIZE, never the bytes.
        assert!(recjson.contains("response_body_size"));
    }
}
