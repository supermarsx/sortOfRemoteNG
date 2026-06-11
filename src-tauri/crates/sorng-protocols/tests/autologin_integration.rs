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

use std::sync::atomic::AtomicBool;
use std::sync::RwLock;

use sorng_protocols::autologin_asset::{autologin_client_asset_script, AUTOLOGIN_CLIENT_JS};
use sorng_protocols::http::HttpAutoLoginSelectors;
use sorng_protocols::themed_autologin::{
    build_autologin_injection_from_slots, AutoLoginCreds, AUTOLOGIN_PATH,
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
    assert!(html.contains(AUTOLOGIN_PATH), "bootstrap targets the credential endpoint");

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
    assert!(nav_at < asset_at, "nav reporter precedes the auto-login scripts");
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
    assert!(html.contains("__full"), "asset marks itself complete for deferral");
}

/// (2) A NON-armed page serves NEITHER the asset NOR the bootstrap — auto-login
/// material is never shipped on pages that didn't opt in.
#[test]
fn disarmed_page_serves_no_autologin_material() {
    let armed = AtomicBool::new(false);
    let nonce = RwLock::new(None);
    let html = serve_injected(&armed, &nonce, &Some(selectors()), "<html><body>x</body></html>");

    assert!(!html.contains("window.__sorng_autologin"), "no asset on a disarmed page");
    assert!(!html.contains(AUTOLOGIN_PATH), "no bootstrap/endpoint reference on a disarmed page");
    assert!(!html.contains("fetchCredsAndRun"), "no deferral call on a disarmed page");
    // The nav reporter (always-on) is still injected, and no nonce was minted.
    assert!(html.contains(NAV_SCRIPT));
    assert!(nonce.read().unwrap().is_none(), "disarmed => no nonce minted");
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
    let minted = nonce_slot.read().unwrap().clone().expect("armed => nonce minted");
    assert_eq!(minted.len(), 32, "fresh_nonce is 32 hex chars");
    assert!(html.contains(&minted), "served HTML carries the per-page nonce");

    // Non-secret selectors ride along (so the client can apply authoritative
    // overrides) — selectors are not credentials.
    assert!(html.contains("#user") && html.contains("#pass"));

    // No credential value is anywhere in the served HTML. The builder never even
    // receives the secret, so nothing resembling a hardcoded cred can leak.
    assert!(!html.contains("\"password\":\""), "no JSON credential literal in HTML");
    assert!(
        html.contains("credentials:'same-origin'") || html.contains("credentials: 'same-origin'"),
        "credential is fetched same-origin, not embedded"
    );
    assert!(
        html.contains("cache:'no-store'") || html.contains("cache: 'no-store'"),
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
    };
    let json2 = serde_json::to_string(&without).unwrap();
    assert!(!json2.contains("selectors"), "selectors omitted when none configured");
}
