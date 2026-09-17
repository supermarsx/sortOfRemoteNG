//! One-shot, document-bound username/password grants for reviewed staged flows.
//! No password is read or serialized during the email grant.
use super::synology_direct::{DirectSynologyLogin, PasswordRedemption};
use super::{forbidden, server_error, AutoLoginQuery};
use crate::http::{AxumProxyState, BasicAuthProxyConfig, UpstreamAuthMode};
use axum::body::Body;
use axum::http::Response;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const GRANT_LIFETIME: Duration = Duration::from_secs(30);

/// Reviewed staged-login grant slot. The historical name is kept for the shared
/// proxy state. A vault continuation follows the global document issuance
/// order; direct Synology page grants follow the frontend-selected document.
pub struct BitwardenContinuation(Grant);

enum Grant {
    Vault(VaultContinuation),
    Synology(DirectSynologyLogin),
}

struct VaultContinuation {
    token: String,
    document_sequence: u64,
    issued: Instant,
    password_stage: bool,
}
impl VaultContinuation {
    fn valid(&self, token: &str, sequence: u64, password_stage: bool) -> bool {
        self.password_stage == password_stage
            && self.token == token
            && self.document_sequence == sequence
            && !self.expired()
    }
    fn expired(&self) -> bool {
        self.issued.elapsed() >= GRANT_LIFETIME
    }
}

pub fn bind_document(state: &AxumProxyState, sequence: u64) -> Option<()> {
    if sequence != state.document_sequence.load(Ordering::SeqCst) {
        return None;
    }
    let nonce = state.auto_login_nonce.read().ok()?.clone()?;
    *state.bitwarden_continuation.lock().ok()? =
        Some(BitwardenContinuation(Grant::Vault(VaultContinuation {
            token: nonce,
            document_sequence: sequence,
            issued: Instant::now(),
            password_stage: false,
        })));
    Some(())
}

/// Record this armed DSM document's own page grant and return its nonce.
pub fn bind_synology_document(state: &AxumProxyState, sequence: u64) -> Option<String> {
    // Grant slot, then document: the same order as redirect acceptance.
    let mut slot = state.bitwarden_continuation.lock().ok()?;
    // A redirect handoff disarms under this lock; never re-create after it.
    if !state.auto_login_armed.load(Ordering::SeqCst) {
        return None;
    }
    let selected = state.network.with_selected_document(|selected| selected);
    if !matches!(
        slot.as_ref(),
        Some(BitwardenContinuation(Grant::Synology(_)))
    ) {
        *slot = Some(BitwardenContinuation(Grant::Synology(
            DirectSynologyLogin::default(),
        )));
    }
    match slot.as_mut() {
        Some(BitwardenContinuation(Grant::Synology(login))) => {
            login.record_page(sequence, selected)
        }
        _ => None,
    }
}

pub fn validate_config(config: &BasicAuthProxyConfig) -> Result<(), String> {
    if !matches!(
        config.upstream_auth_mode,
        UpstreamAuthMode::BitwardenForm | UpstreamAuthMode::SynologyForm
    ) {
        return Ok(());
    }
    let https = reqwest::Url::parse(&config.target_url).is_ok_and(|url| {
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
    });
    let options_supported = config.http_form_automation.as_ref().is_none_or(|options| {
        options.form_selector.is_none()
            && options.fill_delay_ms == 0
            && options.submit_delay_ms == 0
            && options.detection_timeout_ms == 8000
            && options.submit
            && options.fields.is_empty()
    });
    if !https || config.http_auto_login_selectors.is_some() || !options_supported {
        return Err("Reviewed staged login requires HTTPS and its fixed two-stage controls. Clear advanced selector, timing, fill-only and extra-field overrides, or use manual login.".into());
    }
    Ok(())
}

fn json(value: serde_json::Value) -> Response<Body> {
    Response::builder()
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Body::from(value.to_string()))
        .unwrap_or_else(|_| server_error("failed to build reviewed login response"))
}

/// The reviewed staged flows that release a credential **into the document**.
///
/// Closed and exhaustive on purpose: a new upstream mode is a compile error
/// here until somebody decides, in writing, whether it may hand out a password.
/// `YealinkServlet` is deliberately absent — the proxy signs the phone in
/// natively before the frame loads (`crate::http::yealink_login`), so no
/// credential ever reaches the page and there is nothing to dispense. So is
/// `Unknown`: a mode from a newer frontend must degrade, never dispense.
pub(crate) fn reviewed_flow_label(mode: UpstreamAuthMode) -> Option<&'static str> {
    match mode {
        UpstreamAuthMode::BitwardenForm => Some("bitwarden"),
        UpstreamAuthMode::SynologyForm => Some("synology"),
        UpstreamAuthMode::Basic
        | UpstreamAuthMode::Digest
        | UpstreamAuthMode::Header
        | UpstreamAuthMode::None
        | UpstreamAuthMode::PfSenseV1
        | UpstreamAuthMode::YealinkServlet
        | UpstreamAuthMode::Unknown => None,
    }
}

pub fn dispense(state: &AxumProxyState, query: &AutoLoginQuery) -> Response<Body> {
    let Some(flow) = reviewed_flow_label(state.upstream_auth_mode) else {
        return forbidden("reviewed login mode required");
    };
    // Hold the manager's short synchronous lock through dispensing. Removing the
    // session (owner lock/close) makes every subsequent grant fail, including a
    // request on a keep-alive socket while graceful shutdown drains.
    let sessions = match state.global_sessions.lock() {
        Ok(sessions) => sessions,
        Err(_) => return forbidden("reviewed login session unavailable"),
    };
    if !sessions.sessions.contains_key(&state.session_id) {
        return forbidden("reviewed login session ended");
    }
    let mut pending = match state.bitwarden_continuation.lock() {
        Ok(pending) => pending,
        Err(_) => return forbidden("reviewed login unavailable"),
    };
    if state.upstream_auth_mode == UpstreamAuthMode::SynologyForm {
        return dispense_synology(state, &mut pending, query);
    }
    fn vault(pending: &Option<BitwardenContinuation>) -> Option<&VaultContinuation> {
        match pending {
            Some(BitwardenContinuation(Grant::Vault(grant))) => Some(grant),
            _ => None,
        }
    }
    let sequence = state.document_sequence.load(Ordering::SeqCst);
    if query.phase.as_deref() == Some("password") {
        let valid = vault(&pending).is_some_and(|grant| grant.valid(&query.nonce, sequence, true));
        if !valid {
            // A navigation/expiry permanently invalidates this attempt. A wrong
            // random token must not consume somebody else's still-valid grant.
            if vault(&pending)
                .is_some_and(|grant| grant.document_sequence != sequence || grant.expired())
            {
                *pending = None;
            }
            return forbidden("reviewed login continuation expired or invalid");
        }
        *pending = None;
        let password = match state.password.read() {
            Ok(password) => password,
            Err(_) => return forbidden("reviewed login credential unavailable"),
        };
        return json(serde_json::json!({"loginFlow":flow, "password": &*password}));
    }
    if query.phase.is_some() || !state.auto_login_armed.load(Ordering::SeqCst) {
        return forbidden("reviewed login not armed");
    }
    if !vault(&pending).is_some_and(|grant| grant.valid(&query.nonce, sequence, false)) {
        return forbidden("reviewed login document changed or expired");
    }
    let mut nonce = match state.auto_login_nonce.write() {
        Ok(nonce) => nonce,
        Err(_) => return forbidden("reviewed login nonce unavailable"),
    };
    if query.nonce.is_empty() || nonce.as_deref() != Some(&query.nonce) {
        return forbidden("reviewed login nonce invalid");
    }
    *nonce = None;
    state.auto_login_armed.store(false, Ordering::SeqCst);
    let username = match state.username.read() {
        Ok(username) => username,
        Err(_) => return forbidden("reviewed login credential unavailable"),
    };
    let token = crate::themed_auth::fresh_nonce();
    *pending = Some(BitwardenContinuation(Grant::Vault(VaultContinuation {
        token: token.clone(),
        document_sequence: sequence,
        issued: Instant::now(),
        password_stage: true,
    })));
    json(serde_json::json!({"loginFlow":flow, "username": &*username, "continuation":token}))
}

/// Direct DSM grants are bound to the selected document, never the global
/// issuance counter. Caller holds the session manager and grant slot locks.
fn dispense_synology(
    state: &AxumProxyState,
    pending: &mut Option<BitwardenContinuation>,
    query: &AutoLoginQuery,
) -> Response<Body> {
    let Some(BitwardenContinuation(Grant::Synology(login))) = pending.as_mut() else {
        return forbidden("reviewed login document changed or expired");
    };
    if query.phase.as_deref() == Some("password") {
        let selected = state
            .network
            .with_selected_document(|selected| login.redeem_password(Some(selected), &query.nonce));
        let outcome = match selected {
            Some(outcome) => outcome,
            None => login.redeem_password(None, &query.nonce),
        };
        match outcome {
            PasswordRedemption::Released => {
                *pending = None;
                let password = match state.password.read() {
                    Ok(password) => password,
                    Err(_) => return forbidden("reviewed login credential unavailable"),
                };
                return json(serde_json::json!({"loginFlow":"synology", "password": &*password}));
            }
            PasswordRedemption::Revoked => *pending = None,
            PasswordRedemption::Refused => {}
        }
        return forbidden("reviewed login continuation expired or invalid");
    }
    if query.phase.is_some() || !state.auto_login_armed.load(Ordering::SeqCst) {
        return forbidden("reviewed login not armed");
    }
    let Some(token) = state
        .network
        .with_selected_document(|selected| login.release_account(selected, &query.nonce))
        .flatten()
    else {
        return forbidden("reviewed login document changed or expired");
    };
    state.auto_login_armed.store(false, Ordering::SeqCst);
    let username = match state.username.read() {
        Ok(username) => username,
        Err(_) => return forbidden("reviewed login credential unavailable"),
    };
    json(serde_json::json!({"loginFlow":"synology", "username": &*username, "continuation":token}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reviewed_vault_grants_expire_and_never_cross_stage_or_document() {
        let mut grant = VaultContinuation {
            token: "fixture".into(),
            document_sequence: 7,
            issued: Instant::now(),
            password_stage: true,
        };
        assert!(grant.valid("fixture", 7, true));
        assert!(!grant.valid("fixture", 7, false));
        assert!(!grant.valid("fixture", 8, true));
        grant.issued = Instant::now() - GRANT_LIFETIME;
        assert!(!grant.valid("fixture", 7, true));
    }

    #[test]
    fn vault_stages_stay_thirty_seconds_while_synology_windows_are_longer() {
        assert_eq!(GRANT_LIFETIME, Duration::from_secs(30));
        assert_eq!(
            super::super::SYNOLOGY_FORM_PASSWORD_LIFETIME,
            Duration::from_secs(90)
        );
        assert_eq!(
            super::super::SYNOLOGY_FORM_READINESS_LIFETIME,
            Duration::from_secs(300)
        );
        for password_stage in [false, true] {
            let mut grant = VaultContinuation {
                token: "fixture".into(),
                document_sequence: 7,
                issued: Instant::now() - Duration::from_secs(29),
                password_stage,
            };
            assert!(grant.valid("fixture", 7, password_stage));
            assert!(!grant.valid("fixture", 8, password_stage));
            assert!(!grant.valid("fixture", 7, !password_stage));
            assert!(!grant.valid("wrong", 7, password_stage));
            grant.issued = Instant::now() - GRANT_LIFETIME;
            assert!(grant.expired());
        }
    }
    #[test]
    fn a_natively_authenticated_mode_never_dispenses_a_credential() {
        // Route A's whole security argument: the Yealink flow signs in through
        // the proxy, so the document must never be handed a username or a
        // password. Neither may an unknown mode from a newer frontend.
        for mode in [
            UpstreamAuthMode::Basic,
            UpstreamAuthMode::Digest,
            UpstreamAuthMode::Header,
            UpstreamAuthMode::None,
            UpstreamAuthMode::PfSenseV1,
            UpstreamAuthMode::YealinkServlet,
            UpstreamAuthMode::Unknown,
        ] {
            assert_eq!(reviewed_flow_label(mode), None, "{mode:?}");
        }
        assert_eq!(
            reviewed_flow_label(UpstreamAuthMode::BitwardenForm),
            Some("bitwarden")
        );
        assert_eq!(
            reviewed_flow_label(UpstreamAuthMode::SynologyForm),
            Some("synology")
        );
        // The HTTPS/fixed-control gate is for the two document flows only; a
        // plain-HTTP phone signs in natively and must not be pulled into it.
        let phone: BasicAuthProxyConfig = serde_json::from_value(serde_json::json!({
            "target_url": "http://phone.invalid/",
            "username": "admin",
            "password": "fixture-phone-secret",
            "upstream_auth_mode": "yealink-servlet",
            "http_auto_login": true,
        }))
        .unwrap();
        assert!(validate_config(&phone).is_ok());
        assert_eq!(
            phone.upstream_auth_mode.manager_visible_username("admin"),
            ""
        );
    }

    #[test]
    fn reviewed_vault_config_requires_https_and_fixed_controls() {
        let base = serde_json::json!({"target_url":"https://vault.invalid/", "username":"fixture", "password":"fixture", "upstream_auth_mode":"bitwarden-form", "http_auto_login":true});
        let config: BasicAuthProxyConfig = serde_json::from_value(base.clone()).unwrap();
        assert!(validate_config(&config).is_ok());
        assert_eq!(
            config
                .upstream_auth_mode
                .manager_visible_username("secret-email"),
            ""
        );
        for patch in [
            serde_json::json!({"target_url":"http://vault.invalid/"}),
            serde_json::json!({"http_auto_login_selectors":{"username_selector":"#guess"}}),
            serde_json::json!({"http_form_automation":{"version":1,"fillDelayMs":1,"submitDelayMs":0,"detectionTimeoutMs":8000,"submit":true,"fields":[]}}),
        ] {
            let mut raw = base.clone();
            raw.as_object_mut()
                .unwrap()
                .extend(patch.as_object().unwrap().clone());
            assert!(validate_config(&serde_json::from_value(raw).unwrap()).is_err());
        }
    }

    #[test]
    fn reviewed_synology_mode_is_closed_https_only_and_never_manager_visible() {
        let mut raw = serde_json::json!({"target_url":"https://nas.invalid/", "username":"synthetic-user", "password":"synthetic-secret", "upstream_auth_mode":"synology-form", "http_auto_login":true});
        let config: BasicAuthProxyConfig = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(config.upstream_auth_mode, UpstreamAuthMode::SynologyForm);
        assert!(validate_config(&config).is_ok());
        assert!(config
            .upstream_auth_mode
            .manager_visible_username("synthetic-user")
            .is_empty());
        raw["target_url"] = serde_json::json!("http://nas.invalid/");
        assert!(validate_config(&serde_json::from_value(raw).unwrap()).is_err());
    }
}
