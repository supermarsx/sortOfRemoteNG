//! Web auto-login (t20) — the injected CLIENT fill+submit asset (e5).
//!
//! This module owns the full client routine that defines
//! `window.__sorng_autologin.fetchCredsAndRun(nonce, selectors)`. It is the e5
//! half of the e3↔e5 seam described in [`crate::themed_autologin`]:
//!
//! - [`crate::themed_autologin::autologin_client_script`] injects a small inline
//!   bootstrap that, at run time, checks for
//!   `window.__sorng_autologin.fetchCredsAndRun` and **defers to it** when
//!   present (otherwise it runs a conservative inline fallback so the seam works
//!   standalone).
//! - This module provides exactly that global, as a robust, framework-aware
//!   routine lifted from the e1 spike (`.orchestration/scratch/t20-e1/
//!   autologin-fill.js`): native-setter value writes + bubbling `input`/`change`
//!   events (the React/Vue controlled-input fix), authoritative selector
//!   overrides, same-origin iframe walking, one-shot fill+submit, and a no-op on
//!   MFA/CAPTCHA pages.
//!
//! ## Delivery
//!
//! The JS lives in a sibling file [`autologin_client.js`] and is embedded at
//! compile time via `include_str!`, then wrapped in a `<script>` element by
//! [`autologin_client_asset_script`]. For the asset's global to be available to
//! the e3 bootstrap, this `<script>` must be spliced into the served HTML
//! **before** the e3 bootstrap script — i.e. it must appear first in the
//! `injected_scripts` string at the `</body>` injection site.
//!
//! ## Wiring hook for e3 (one line, intentionally left to e3's owner)
//!
//! e3 owns `http.rs` / `themed_autologin.rs` / `lib.rs`; e5 does not edit them.
//! To put this asset ahead of the e3 bootstrap, e3 prepends it at the existing
//! injection site in `http.rs` (around the `injected_scripts` `format!`):
//!
//! ```ignore
//! // in http.rs, where `injected_scripts` is built (only when armed):
//! let autologin_asset = if /* auto-login armed */ {
//!     crate::autologin_asset::autologin_client_asset_script()
//! } else {
//!     ""
//! };
//! let injected_scripts =
//!     format!("{}{}{}", nav_script, autologin_asset, autologin_script);
//! ```
//!
//! and declares the module in `lib.rs`:
//!
//! ```ignore
//! pub mod autologin_asset;
//! ```
//!
//! Until that one-line wiring lands, the e3 bootstrap's conservative inline
//! fallback keeps auto-login functional; once it lands, the bootstrap defers to
//! this richer routine automatically (no other e3 change required).

/// The raw client routine source (defines `window.__sorng_autologin`).
///
/// Embedded at compile time so it ships inside the binary with no runtime file
/// dependency. Validated with `node --check`.
pub const AUTOLOGIN_CLIENT_JS: &str = include_str!("autologin_client.js");

/// The full e5 client asset wrapped in a `<script>` element, ready to splice
/// into served HTML **ahead of** the e3 bootstrap so its
/// `window.__sorng_autologin.fetchCredsAndRun` global is defined before the
/// bootstrap looks for it.
///
/// Returns a `&'static str` (built once) — the asset carries no per-page state
/// (the nonce + selectors are passed to `fetchCredsAndRun` by the e3 bootstrap),
/// so it never needs templating and never embeds a credential.
pub fn autologin_client_asset_script() -> String {
    format!("<script>{}</script>", AUTOLOGIN_CLIENT_JS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_defines_the_global_seam() {
        // The embedded routine must define the exact global the e3 bootstrap
        // checks for, and expose the fetch entrypoint.
        assert!(AUTOLOGIN_CLIENT_JS.contains("window.__sorng_autologin"));
        assert!(AUTOLOGIN_CLIENT_JS.contains("fetchCredsAndRun"));
    }

    #[test]
    fn asset_uses_same_origin_no_store_fetch() {
        // Endpoint contract: same-origin + no-store, the documented path.
        assert!(AUTOLOGIN_CLIENT_JS.contains("/__sortofremoteng_autologin"));
        assert!(AUTOLOGIN_CLIENT_JS.contains("credentials: 'same-origin'"));
        assert!(AUTOLOGIN_CLIENT_JS.contains("cache: 'no-store'"));
    }

    #[test]
    fn asset_carries_no_credential_literal() {
        // The asset is a pure routine — it fetches the credential at run time
        // and must not embed any credential value.
        assert!(!AUTOLOGIN_CLIENT_JS.contains("password\":\""));
    }

    #[test]
    fn asset_marks_itself_full_for_bootstrap_deferral() {
        // The `__full` marker lets the e3 bootstrap / any re-injection know the
        // complete asset is present and defer to it without clobbering it.
        assert!(AUTOLOGIN_CLIENT_JS.contains("__full"));
    }

    #[test]
    fn wrapped_script_is_a_single_script_element() {
        let s = autologin_client_asset_script();
        assert!(s.starts_with("<script>"));
        assert!(s.ends_with("</script>"));
        // The wrapped form contains the routine.
        assert!(s.contains("fetchCredsAndRun"));
    }
}
