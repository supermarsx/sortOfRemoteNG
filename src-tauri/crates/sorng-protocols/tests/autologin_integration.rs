//! t20-e6 — Web auto-login proxy integration tests (public-surface).
//!
//! These exercise the COMPOSED served-HTML injection — the way `http.rs`
//! actually splices the e5 client asset ahead of the e3 bootstrap before
//! `</body>` — at the crate's public API surface, without a Tauri `AppHandle`.
//!
//! e3's in-crate unit tests cover the bootstrap + endpoint logic in isolation,
//! and e5's cover the asset string in isolation. This file deliberately checks
//! a DIFFERENT level: the *combined output* that a browser would receive, and
//! the ordering / deferral / no-leak guarantees that only emerge once the two
//! halves are spliced together as the proxy does it.
//!
//! Splice contract mirrored here (from `http.rs`, the `</body>` injector):
//! ```ignore
//! let autologin_script = build_autologin_injection(&state).unwrap_or_default();
//! let autologin_asset = if autologin_script.is_empty() {
//!     String::new()
//! } else {
//!     autologin_client_asset_script()
//! };
//! let injected_scripts = format!("{}{}{}", nav_script, autologin_asset, autologin_script);
//! body.replacen("</body>", &format!("{}</body>", injected_scripts), 1);
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, RwLock};

use sorng_protocols::autologin_asset::{autologin_client_asset_script, AUTOLOGIN_CLIENT_JS};
use sorng_protocols::http::{
    AxumProxyState, HttpAutoLoginSelectors, HttpProxyPolicy, ProxyNetworkState,
    ProxySessionManager, UpstreamAuthMode,
};
use sorng_protocols::themed_autologin::{
    build_autologin_injection, build_autologin_injection_from_slots, AutoLoginCreds, AUTOLOGIN_PATH,
};

/// The nav reporter the proxy always injects first (constant string in http.rs).
const NAV_SCRIPT: &str = "<script>nav</script>";

/// Reproduce the proxy's `</body>` splice exactly, returning the served HTML a
/// browser would receive for `upstream_body`.
fn serve_injected(
    armed: &AtomicBool,
    nonce_slot: &RwLock<Option<String>>,
    selectors: &Option<HttpAutoLoginSelectors>,
    upstream_body: &str,
) -> String {
    let autologin_script =
        build_autologin_injection_from_slots(armed, nonce_slot, selectors).unwrap_or_default();
    let autologin_asset = if autologin_script.is_empty() {
        String::new()
    } else {
        autologin_client_asset_script()
    };
    let injected_scripts = format!("{}{}{}", NAV_SCRIPT, autologin_asset, autologin_script);
    if upstream_body.contains("</body>") {
        upstream_body.replacen("</body>", &format!("{}</body>", injected_scripts), 1)
    } else {
        format!("{}{}", upstream_body, injected_scripts)
    }
}

fn selectors() -> HttpAutoLoginSelectors {
    HttpAutoLoginSelectors {
        username_selector: Some("#user".into()),
        password_selector: Some("#pass".into()),
        submit_selector: Some("#go".into()),
    }
}

/// (1) When armed, the served HTML contains BOTH the e5 client asset (which
/// defines `window.__sorng_autologin`) AND the e3 bootstrap, and the asset
/// appears BEFORE the bootstrap so the global exists when the bootstrap runs.
#[test]
fn armed_page_serves_asset_before_bootstrap() {
    let armed = AtomicBool::new(true);
    let nonce = RwLock::new(None);
    let sel = Some(selectors());
    let html = serve_injected(&armed, &nonce, &sel, "<html><body>login</body></html>");

    // The asset (defines the global) is present...
    let asset_at = html
        .find("window.__sorng_autologin")
        .expect("served HTML must include the e5 client asset that defines the global");
    // ...and so is the e3 bootstrap, identified by its deferral check + endpoint.
    let bootstrap_at = html
        .find("fetchCredsAndRun(NONCE")
        .expect("served HTML must include the e3 bootstrap deferral call");
    assert!(
        html.contains("fetchCredsAndRun"),
        "bootstrap delegates only to the full guarded asset"
    );

    // ORDERING: the asset must come strictly before the bootstrap so
    // `window.__sorng_autologin.fetchCredsAndRun` is defined when the bootstrap
    // looks for it.
    assert!(
        asset_at < bootstrap_at,
        "e5 asset must be injected BEFORE the e3 bootstrap (asset@{asset_at} < bootstrap@{bootstrap_at})"
    );

    // The injected scripts are placed before the closing body tag.
    let body_close = html.find("</body>").expect("body close present");
    assert!(bootstrap_at < body_close, "scripts injected before </body>");

    // The nav reporter still leads (existing behaviour preserved).
    let nav_at = html.find(NAV_SCRIPT).expect("nav script present");
    assert!(
        nav_at < asset_at,
        "nav reporter precedes the auto-login scripts"
    );
}

/// The asset embedded into the served page is byte-for-byte the e5 asset (the
/// splice doesn't mangle it), and it marks itself `__full` so the bootstrap
/// defers instead of clobbering it.
#[test]
fn served_asset_is_the_full_e5_routine() {
    let armed = AtomicBool::new(true);
    let nonce = RwLock::new(None);
    let html = serve_injected(&armed, &nonce, &None, "<body></body>");
    assert!(
        html.contains(AUTOLOGIN_CLIENT_JS),
        "served HTML embeds the full e5 client routine verbatim"
    );
    assert!(
        html.contains("__full"),
        "asset marks itself complete for deferral"
    );
}

/// (2) A NON-armed page serves NEITHER the asset NOR the bootstrap — auto-login
/// material is never shipped on pages that didn't opt in.
#[test]
fn disarmed_page_serves_no_autologin_material() {
    let armed = AtomicBool::new(false);
    let nonce = RwLock::new(None);
    let html = serve_injected(
        &armed,
        &nonce,
        &Some(selectors()),
        "<html><body>x</body></html>",
    );

    assert!(
        !html.contains("window.__sorng_autologin"),
        "no asset on a disarmed page"
    );
    assert!(
        !html.contains(AUTOLOGIN_PATH),
        "no bootstrap/endpoint reference on a disarmed page"
    );
    assert!(
        !html.contains("fetchCredsAndRun"),
        "no deferral call on a disarmed page"
    );
    // The nav reporter (always-on) is still injected, and no nonce was minted.
    assert!(html.contains(NAV_SCRIPT));
    assert!(
        nonce.read().unwrap().is_none(),
        "disarmed => no nonce minted"
    );
}

/// (3) The credential never appears in the served HTML — only a per-page nonce
/// and the non-secret selectors. The secret is delivered solely via the JSON
/// endpoint at fill time. (Asserted on the FULL composed page, not just the
/// bootstrap fragment that e3 checks.)
#[test]
fn served_html_carries_no_credential_only_a_nonce() {
    let armed = AtomicBool::new(true);
    let nonce_slot = RwLock::new(None);
    let sel = Some(selectors());
    let html = serve_injected(
        &armed,
        &nonce_slot,
        &sel,
        "<html><body>login form here</body></html>",
    );

    // A fresh 32-hex nonce was minted into the slot AND embedded in the page.
    let minted = nonce_slot
        .read()
        .unwrap()
        .clone()
        .expect("armed => nonce minted");
    assert_eq!(minted.len(), 32, "fresh_nonce is 32 hex chars");
    assert!(
        html.contains(&minted),
        "served HTML carries the per-page nonce"
    );

    // Non-secret selectors ride along (so the client can apply authoritative
    // overrides) — selectors are not credentials.
    assert!(html.contains("#user") && html.contains("#pass"));

    // No credential value is anywhere in the served HTML. The builder never even
    // receives the secret, so nothing resembling a hardcoded cred can leak.
    assert!(
        !html.contains("\"password\":\""),
        "no JSON credential literal in HTML"
    );
    assert!(
        include_str!("../src/autologin_client.js").contains("credentials: \"same-origin\""),
        "credential is fetched same-origin, not embedded"
    );
    assert!(
        include_str!("../src/autologin_client.js").contains("cache: \"no-store\""),
        "credential fetch is no-store"
    );
}

/// Each armed page render mints a FRESH nonce (the slot is overwritten), so two
/// successive served pages never share a nonce — the integration-level view of
/// the per-page single-use nonce. (e3 unit-tests the consume side; this pins the
/// mint side across repeated renders as the proxy would do them.)
#[test]
fn each_render_mints_a_distinct_nonce() {
    let armed = AtomicBool::new(true);
    let nonce_slot = RwLock::new(None);

    let html1 = serve_injected(&armed, &nonce_slot, &None, "<body>1</body>");
    let n1 = nonce_slot.read().unwrap().clone().unwrap();

    let html2 = serve_injected(&armed, &nonce_slot, &None, "<body>2</body>");
    let n2 = nonce_slot.read().unwrap().clone().unwrap();

    assert_ne!(n1, n2, "each rendered page mints a distinct nonce");
    assert!(html1.contains(&n1) && !html1.contains(&n2));
    assert!(html2.contains(&n2) && !html2.contains(&n1));
}

/// The endpoint's response shape (what the bootstrap's fetch consumes) carries
/// the saved credential plus the optional selectors — and omits `selectors`
/// entirely when none are set. This pins the wire contract the served bootstrap
/// depends on, at the integration boundary between the served page and the
/// credential endpoint.
#[test]
fn endpoint_creds_shape_matches_what_the_served_bootstrap_expects() {
    let with = AutoLoginCreds {
        username: "admin".into(),
        password: "s3cret".into(),
        selectors: Some(selectors()),
        form_automation: None,
    };
    let json = serde_json::to_string(&with).unwrap();
    assert!(json.contains("\"username\":\"admin\""));
    assert!(json.contains("\"password\":\"s3cret\""));
    // snake_case selector keys, mirroring HttpAutoLoginSelectors / the client.
    assert!(json.contains("username_selector"));
    assert!(json.contains("submit_selector"));

    let without = AutoLoginCreds {
        username: "admin".into(),
        password: "s3cret".into(),
        selectors: None,
        form_automation: None,
    };
    let json2 = serde_json::to_string(&without).unwrap();
    assert!(
        !json2.contains("selectors"),
        "selectors omitted when none configured"
    );
}

fn served_nonce(html: &str) -> String {
    html.split_once("var NONCE=\"")
        .expect("bootstrap nonce")
        .1
        .split('"')
        .next()
        .unwrap()
        .to_owned()
}

/// Direct reviewed Synology login: each served DSM document carries its own
/// page nonce. A later child frame render neither overwrites the shared nonce
/// slot nor changes what the page itself was served, and nothing secret ships.
#[test]
fn synology_direct_documents_keep_their_own_page_nonce_outside_the_shared_slot() {
    let state = AxumProxyState {
        attempt: None,
        network: Arc::new(ProxyNetworkState::default()),
        website_dark_mode: Default::default(),
        session_id: "synthetic-session".into(),
        connection_id: "synthetic-owner".into(),
        target_url: "https://nas.invalid/".into(),
        username: Arc::new(RwLock::new("synthetic-user".into())),
        password: Arc::new(RwLock::new("synthetic-password".into())),
        upstream_auth_mode: UpstreamAuthMode::SynologyForm,
        proxy_policy: HttpProxyPolicy::default(),
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Arc::new(RwLock::new(None)),
        theme: Arc::new(RwLock::new(
            sorng_protocols::theme_tokens::ThemeTokens::dark_default(),
        )),
        target_origin: "https://nas.invalid".into(),
        proxy_authority: "p0123456789abcdef0123456789abcdef.localhost:1".into(),
        proxy_origin: "http://p0123456789abcdef0123456789abcdef.localhost:1".into(),
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Arc::new(RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: sorng_protocols::http::yealink_login::session_slot(),
        client: reqwest::Client::new(),
        document_sequence: Arc::new(AtomicU64::new(2)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Arc::new(std::sync::Mutex::new(None)),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    };
    // The page (document 1) is rendered after a child (document 2) started.
    let page =
        build_autologin_injection(&state, 1, "https://nas.invalid/").expect("page bootstrap");
    let child =
        build_autologin_injection(&state, 2, "https://nas.invalid/").expect("child bootstrap");
    let (page_nonce, child_nonce) = (served_nonce(&page), served_nonce(&child));
    assert_ne!(page_nonce, child_nonce);
    for html in [&page, &child] {
        assert!(html.contains("fetchCredsAndRun(NONCE,SEL, 'synology')"));
        assert!(!html.contains("synthetic-user") && !html.contains("synthetic-password"));
    }
    assert!(state.auto_login_nonce.read().unwrap().is_none());
    // Re-rendering a document returns its own grant; the child never replaced it.
    assert_eq!(
        served_nonce(&build_autologin_injection(&state, 1, "https://nas.invalid/").unwrap(),),
        page_nonce
    );
    // Disarmed sessions ship no DSM bootstrap for any document.
    state
        .auto_login_armed
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(build_autologin_injection(&state, 3, "https://nas.invalid/").is_none());
}
