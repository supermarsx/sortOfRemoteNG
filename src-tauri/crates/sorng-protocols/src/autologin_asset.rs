//! Dependency-free auto-login assets embedded into the native proxy.
//!
//! Private source fragments are assembled inside the coordinator's IIFE in the
//! order below. Dedicated staged clients precede the coordinator. The resulting
//! script must be injected before the nonce-only bootstrap in themed_autologin.
//! No imports, build dependency, runtime file reads or credential literals are
//! required. See autologin/README.md for module ownership and lifecycle seams.

use crate::http::UpstreamAuthMode;
use std::sync::OnceLock;

/// Coordinator template; use the assembled source when executing the client.
pub const AUTOLOGIN_CLIENT_JS: &str = include_str!("autologin_client.js");
pub const AUTOLOGIN_MODULES_JS: &str = concat!(
    include_str!("autologin/common/dom.js"),
    include_str!("autologin/apps/freepbx.js"),
    include_str!("autologin/apps/porkbun.js"),
    include_str!("autologin/apps/cpanel.js"),
    include_str!("autologin/apps/joomla.js"),
    include_str!("autologin/apps/exchange_ecp.js"),
    include_str!("autologin/apps/instagram.js"),
    include_str!("autologin/apps/linkedin.js"),
    include_str!("autologin/apps/vodafone_smart_router.js"),
    include_str!("autologin/forms/generic.js"),
    include_str!("autologin/forms/options.js"),
    include_str!("autologin/common/guards.js"),
    include_str!("autologin/forms/advanced.js"),
    include_str!("autologin/forms/readiness.js"),
);
pub const BITWARDEN_CLIENT_JS: &str = include_str!("bitwarden_autologin_client.js");
pub const SYNOLOGY_CLIENT_JS: &str = include_str!("synology_autologin_client.js");
pub const GOOGLE_CLIENT_JS: &str = include_str!("google_autologin_client.js");
pub const CLOUDFLARE_CLIENT_JS: &str = include_str!("cloudflare_autologin_client.js");
pub const YEALINK_CLIENT_JS: &str = include_str!("yealink_autologin_client.js");
pub const ADOBE_CLIENT_JS: &str = include_str!("adobe_autologin_client.js");
pub const AI_CHAT_CLIENT_JS: &str = include_str!("ai_chat_autologin_client.js");
pub const CHATGPT_CLIENT_JS: &str = include_str!("chatgpt_autologin_client.js");
pub const CLAUDE_CLIENT_JS: &str = include_str!("claude_autologin_client.js");

/// Assemble private modules without adding another global scope.
pub fn assembled_autologin_client() -> String {
    assembled_autologin_client_source().to_owned()
}

fn assembled_autologin_client_source() -> &'static str {
    static SOURCE: OnceLock<String> = OnceLock::new();
    SOURCE
        .get_or_init(|| {
            AUTOLOGIN_CLIENT_JS.replace("/*__SORNG_AUTOLOGIN_MODULES__*/", AUTOLOGIN_MODULES_JS)
        })
        .as_str()
}

/// Legacy complete bundle for compatibility fixtures. Served pages use the
/// mode-scoped variant below instead of sending every staged adapter.
/// The owned String contains code only; per-page credentials are fetched later.
pub fn autologin_client_asset_script() -> String {
    let client = assembled_autologin_client();
    format!(
        "<script>{}{}{}{}{}{}{}{}{}{}</script>",
        BITWARDEN_CLIENT_JS,
        SYNOLOGY_CLIENT_JS,
        GOOGLE_CLIENT_JS,
        CLOUDFLARE_CLIENT_JS,
        YEALINK_CLIENT_JS,
        ADOBE_CLIENT_JS,
        AI_CHAT_CLIENT_JS,
        CHATGPT_CLIENT_JS,
        CLAUDE_CLIENT_JS,
        client
    )
}

/// Select code from native authority only, never a page URL, DOM or response
/// string. Bitwarden's bootstrap has no flow hint: its native credential
/// metadata selects the handler after redemption, so its adapter is still
/// required here. The exhaustive match forces new modes to declare their code.
fn staged_autologin_clients(mode: UpstreamAuthMode) -> &'static [&'static str] {
    match mode {
        UpstreamAuthMode::BitwardenForm => &[BITWARDEN_CLIENT_JS],
        UpstreamAuthMode::SynologyForm => &[SYNOLOGY_CLIENT_JS],
        UpstreamAuthMode::GoogleForm => &[GOOGLE_CLIENT_JS],
        UpstreamAuthMode::CloudflareForm => &[CLOUDFLARE_CLIENT_JS],
        UpstreamAuthMode::YealinkServlet => &[YEALINK_CLIENT_JS],
        UpstreamAuthMode::AdobeForm => &[ADOBE_CLIENT_JS],
        UpstreamAuthMode::ChatgptForm => &[AI_CHAT_CLIENT_JS, CHATGPT_CLIENT_JS],
        UpstreamAuthMode::ClaudeForm => &[AI_CHAT_CLIENT_JS, CLAUDE_CLIENT_JS],
        UpstreamAuthMode::Basic
        | UpstreamAuthMode::Digest
        | UpstreamAuthMode::Header
        | UpstreamAuthMode::None
        | UpstreamAuthMode::PfSenseV1
        | UpstreamAuthMode::Unknown => &[],
    }
}

/// Code-only asset for an already-authorized page bootstrap. The caller retains
/// the nonempty-bootstrap gate: selecting a mode never arms or grants a page.
/// Dependencies precede the selected adapter, which precedes the unchanged
/// generic modules/coordinator. No per-page state is cached in this asset.
pub fn autologin_client_asset_script_for_mode(mode: UpstreamAuthMode) -> String {
    cached_autologin_client_asset_script_for_mode(mode).to_owned()
}

/// Cache executable code only, never a nonce, owner, settings or credentials.
fn cached_autologin_client_asset_script_for_mode(mode: UpstreamAuthMode) -> &'static str {
    static SOURCES: [OnceLock<String>; 9] = [
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
    ];
    let index = match mode {
        UpstreamAuthMode::BitwardenForm => 1,
        UpstreamAuthMode::SynologyForm => 2,
        UpstreamAuthMode::GoogleForm => 3,
        UpstreamAuthMode::CloudflareForm => 4,
        UpstreamAuthMode::YealinkServlet => 5,
        UpstreamAuthMode::AdobeForm => 6,
        UpstreamAuthMode::ChatgptForm => 7,
        UpstreamAuthMode::ClaudeForm => 8,
        UpstreamAuthMode::Basic
        | UpstreamAuthMode::Digest
        | UpstreamAuthMode::Header
        | UpstreamAuthMode::None
        | UpstreamAuthMode::PfSenseV1
        | UpstreamAuthMode::Unknown => 0,
    };
    SOURCES[index]
        .get_or_init(|| assemble_asset_for_mode(mode))
        .as_str()
}

fn assemble_asset_for_mode(mode: UpstreamAuthMode) -> String {
    let staged = staged_autologin_clients(mode);
    let client = assembled_autologin_client_source();
    let capacity = "<script></script>".len()
        + client.len()
        + staged.iter().map(|source| source.len()).sum::<usize>();
    let mut script = String::with_capacity(capacity);
    script.push_str("<script>");
    for source in staged {
        script.push_str(source);
    }
    script.push_str(&client);
    script.push_str("</script>");
    script
}

#[cfg(test)]
#[path = "autologin_asset_scoped_tests.rs"]
mod scoped_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_cache_is_stable_and_does_not_mix_provider_assets() {
        let google = cached_autologin_client_asset_script_for_mode(UpstreamAuthMode::GoogleForm);
        assert!(std::ptr::eq(
            google.as_ptr(),
            cached_autologin_client_asset_script_for_mode(UpstreamAuthMode::GoogleForm).as_ptr()
        ));
        let plain = cached_autologin_client_asset_script_for_mode(UpstreamAuthMode::None);
        assert!(!std::ptr::eq(plain.as_ptr(), google.as_ptr()));
        assert_eq!(
            plain,
            autologin_client_asset_script_for_mode(UpstreamAuthMode::None)
        );
        assert_eq!(
            google,
            autologin_client_asset_script_for_mode(UpstreamAuthMode::GoogleForm)
        );
    }

    #[test]
    fn asset_defines_the_global_seam() {
        // The assembled routine must define the exact global the bootstrap
        // checks for, and expose the fetch entrypoint.
        assert!(AUTOLOGIN_CLIENT_JS.contains("window.__sorng_autologin"));
        assert!(AUTOLOGIN_CLIENT_JS.contains("fetchCredsAndRun"));
    }

    #[test]
    fn asset_uses_same_origin_no_store_fetch() {
        // Endpoint contract: same-origin + no-store, the documented path.
        assert!(AUTOLOGIN_CLIENT_JS.contains("/__sortofremoteng_autologin"));
        assert!(AUTOLOGIN_CLIENT_JS.contains("credentials: \"same-origin\""));
        assert!(AUTOLOGIN_CLIENT_JS.contains("cache: \"no-store\""));
    }

    #[test]
    fn asset_carries_no_credential_literal() {
        // The asset is a pure routine — it fetches the credential at run time
        // and must not embed any credential value.
        assert!(!AUTOLOGIN_CLIENT_JS.contains("password\":\""));
    }

    #[test]
    fn asset_marks_itself_full_for_bootstrap_deferral() {
        // The `__full` marker lets the bootstrap / any re-injection know the
        // complete asset is present and defer to it without clobbering it.
        assert!(AUTOLOGIN_CLIENT_JS.contains("__full"));
    }

    #[test]
    fn private_modules_are_assembled_inside_the_coordinator() {
        let client = assembled_autologin_client();
        assert!(!client.contains("/*__SORNG_AUTOLOGIN_MODULES__*/"));
        assert!(client.contains("function findLoginForm("));
        assert!(client.contains("function openFreepbxAdmin("));
        assert!(client.contains("function submitCpanelForm("));
        assert!(client.contains("function vodafoneRouterTarget("));
        assert!(
            client.find("(function ()").unwrap() < client.find("function findLoginForm(").unwrap()
        );
        assert!(
            client.find("function findLoginForm(").unwrap()
                < client.find("window.__sorng_autologin =").unwrap()
        );
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
