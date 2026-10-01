use super::*;
use crate::http::{
    attempt::AttemptRegistry, AxumProxyState, BasicAuthProxyConfig, HttpProxyPolicy,
    ProxyNetworkState, ProxySessionManager,
};
use crate::themed_autologin::{autologin_asset_mode, build_autologin_injection};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

const STAGED: &[&str] = &[
    BITWARDEN_CLIENT_JS,
    SYNOLOGY_CLIENT_JS,
    GOOGLE_CLIENT_JS,
    CLOUDFLARE_CLIENT_JS,
    YEALINK_CLIENT_JS,
    ADOBE_CLIENT_JS,
    AI_CHAT_CLIENT_JS,
    CHATGPT_CLIENT_JS,
    CLAUDE_CLIENT_JS,
];
const MODES: &[(UpstreamAuthMode, &[usize])] = &[
    (UpstreamAuthMode::Basic, &[]),
    (UpstreamAuthMode::Digest, &[]),
    (UpstreamAuthMode::Header, &[]),
    (UpstreamAuthMode::None, &[]),
    (UpstreamAuthMode::PfSenseV1, &[]),
    (UpstreamAuthMode::Unknown, &[]),
    (UpstreamAuthMode::BitwardenForm, &[0]),
    (UpstreamAuthMode::SynologyForm, &[1]),
    (UpstreamAuthMode::GoogleForm, &[2]),
    (UpstreamAuthMode::CloudflareForm, &[3]),
    (UpstreamAuthMode::YealinkServlet, &[4]),
    (UpstreamAuthMode::AdobeForm, &[5]),
    (UpstreamAuthMode::ChatgptForm, &[6, 7]),
    (UpstreamAuthMode::ClaudeForm, &[6, 8]),
];

#[test]
fn every_native_mode_sends_only_its_staged_dependencies_in_order() {
    let coordinator = assembled_autologin_client();
    for &(mode, expected) in MODES {
        let script = autologin_client_asset_script_for_mode(mode);
        assert!(script.starts_with("<script>"));
        assert!(script.ends_with(&format!("{coordinator}</script>")));
        assert_eq!(script.matches("<script>").count(), 1);
        assert_eq!(script.matches("</script>").count(), 1);
        for (index, source) in STAGED.iter().enumerate() {
            assert_eq!(
                script.contains(source),
                expected.contains(&index),
                "{mode:?}: staged client {index} presence"
            );
        }
        let mut offset = "<script>".len();
        for &index in expected {
            assert_eq!(script.find(STAGED[index]), Some(offset), "{mode:?}");
            offset += STAGED[index].len();
        }
        assert_eq!(script.find(&coordinator), Some(offset), "{mode:?}");
    }
}

#[test]
fn scoped_asset_sizes_are_smaller_than_the_legacy_bundle() {
    let legacy = autologin_client_asset_script().len();
    println!("autologin_asset legacy bytes={legacy}");
    for &(mode, _) in MODES {
        let bytes = autologin_client_asset_script_for_mode(mode).len();
        assert!(bytes < legacy, "{mode:?}");
        println!(
            "autologin_asset {mode:?} bytes={bytes} saved={} reduction={:.2}%",
            legacy - bytes,
            100.0 * (legacy - bytes) as f64 / legacy as f64
        );
    }
}

fn state(mode: UpstreamAuthMode) -> AxumProxyState {
    AxumProxyState {
        attempt: None,
        network: Arc::new(ProxyNetworkState::default()),
        website_dark_mode: Default::default(),
        session_id: "asset-fixture-session".into(),
        connection_id: "asset-fixture-owner".into(),
        target_url: "https://nas.invalid/".into(),
        username: Arc::new(RwLock::new("PRIVATE_ASSET_USER".into())),
        password: Arc::new(RwLock::new("PRIVATE_ASSET_PASSWORD".into())),
        upstream_auth_mode: mode,
        proxy_policy: HttpProxyPolicy::default(),
        redirect_profile: None,
        tactical_rmm_api: None,
        custom_headers: HashMap::new(),
        pending_nonce: Arc::new(RwLock::new(None)),
        theme: Arc::new(RwLock::new(crate::theme_tokens::ThemeTokens::dark_default())),
        target_origin: "https://nas.invalid".into(),
        proxy_authority: "p0123456789abcdef0123456789abcdef.localhost:1".into(),
        proxy_origin: "http://p0123456789abcdef0123456789abcdef.localhost:1".into(),
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Arc::new(RwLock::new(None)),
        bitwarden_continuation: Default::default(),
        auto_login_selectors: None,
        http_form_automation: None,
        yealink_session: crate::http::yealink_login::session_slot(),
        client: reqwest::Client::new(),
        document_sequence: Arc::new(AtomicU64::new(2)),
        request_count: Arc::new(AtomicU64::new(0)),
        error_count: Arc::new(AtomicU64::new(0)),
        last_error: Arc::new(std::sync::Mutex::new(None)),
        global_sessions: ProxySessionManager::new(),
        credentials_applied: None,
    }
}

fn served_asset(state: &AxumProxyState, sequence: u64) -> (String, String) {
    let bootstrap =
        build_autologin_injection(state, sequence, &state.target_url).unwrap_or_default();
    let asset = if bootstrap.is_empty() {
        String::new()
    } else {
        autologin_client_asset_script_for_mode(autologin_asset_mode(state))
    };
    (asset, bootstrap)
}

#[test]
fn unarmed_pages_never_send_any_asset_or_mint_a_nonce_for_any_mode() {
    for &(mode, _) in MODES {
        let state = state(mode);
        state.auto_login_armed.store(false, Ordering::SeqCst);
        assert_eq!(autologin_asset_mode(&state), mode);
        assert_eq!(
            served_asset(&state, 1),
            (String::new(), String::new()),
            "{mode:?}"
        );
        assert!(state.auto_login_nonce.read().unwrap().is_none());
    }
}

#[test]
fn scoped_assets_do_not_change_per_page_nonce_or_saved_credential_lifetimes() {
    for mode in [
        UpstreamAuthMode::None,
        UpstreamAuthMode::BitwardenForm,
        UpstreamAuthMode::SynologyForm,
    ] {
        let state = state(mode);
        state.document_sequence.store(1, Ordering::SeqCst);
        let (asset, first) = served_asset(&state, 1);
        state.document_sequence.store(2, Ordering::SeqCst);
        let (second_asset, second) = served_asset(&state, 2);
        assert!(!first.is_empty() && !second.is_empty(), "{mode:?}");
        assert_eq!(
            asset, second_asset,
            "only the bootstrap carries per-page state"
        );
        assert_ne!(first, second, "each page gets its own nonce");
        for source in [&asset, &first, &second] {
            assert!(!source.contains("PRIVATE_ASSET_"));
        }
        assert_eq!(*state.username.read().unwrap(), "PRIVATE_ASSET_USER");
        assert_eq!(*state.password.read().unwrap(), "PRIVATE_ASSET_PASSWORD");
        if mode == UpstreamAuthMode::SynologyForm {
            assert!(state.auto_login_nonce.read().unwrap().is_none());
            assert_eq!(served_asset(&state, 1).1, first);
        }
        let composed = format!("{asset}{first}");
        assert!(
            composed.find("window.__sorng_autologin =").unwrap()
                < composed.find("fetchCredsAndRun(NONCE").unwrap()
        );
    }
}

#[test]
fn deferred_synology_selects_its_adapter_from_native_intent_without_arming_http() {
    let mut config: BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
        "target_url": "https://example.quickconnect.to/", "connection_id": "asset-owner",
        "username": "PRIVATE_ASSET_USER", "password": "PRIVATE_ASSET_PASSWORD",
        "upstream_auth_mode": "synology-form", "http_auto_login": true,
        "redirect_profile": "synology",
        "proxy_policy": { "version": 1, "pageScripts": "allow", "sameOriginOnly": false,
            "httpsOnly": false, "cacheMode": "normal", "queryParameters": [],
            "synologyQuickConnectDefaults": { "version": 1, "originalOrigin": "https://example.quickconnect.to" } }
    })).unwrap();
    let mut registry = AttemptRegistry::default();
    let attempt = registry
        .start(
            &config,
            &url::Url::parse(&config.target_url).unwrap(),
            "asset-fixture-session",
        )
        .unwrap()
        .unwrap();
    attempt.strip_deferred_login_config(&mut config);
    let mut state = state(config.upstream_auth_mode);
    state
        .auto_login_armed
        .store(config.http_auto_login, Ordering::SeqCst);
    state.attempt = Some(attempt);
    assert_eq!(state.upstream_auth_mode, UpstreamAuthMode::None);
    assert_eq!(autologin_asset_mode(&state), UpstreamAuthMode::SynologyForm);
    let asset = autologin_client_asset_script_for_mode(autologin_asset_mode(&state));
    assert!(asset.contains(SYNOLOGY_CLIENT_JS));
    assert!(!asset.contains(BITWARDEN_CLIENT_JS));
    // An intent without an authorized DSM document is not a grant to inject.
    assert_eq!(served_asset(&state, 1), (String::new(), String::new()));
    assert!(!state.auto_login_armed.load(Ordering::SeqCst));
    assert!(state.auto_login_nonce.read().unwrap().is_none());
    assert!(config.username.is_empty() && config.password.is_empty());
}
