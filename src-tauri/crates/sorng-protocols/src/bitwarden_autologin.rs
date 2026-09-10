//! One-shot, document-bound email/password grants for the reviewed web-vault flow.
//! No password is read or serialized during the email grant.
use super::{forbidden, server_error, AutoLoginQuery};
use crate::http::{AxumProxyState, BasicAuthProxyConfig, UpstreamAuthMode};
use axum::body::Body;
use axum::http::Response;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const GRANT_LIFETIME: Duration = Duration::from_secs(30);

pub struct BitwardenContinuation {
    token: String,
    document_sequence: u64,
    issued: Instant,
    password_stage: bool,
}
impl BitwardenContinuation {
    fn valid(&self, token: &str, sequence: u64, password_stage: bool) -> bool {
        self.password_stage == password_stage
            && self.token == token
            && self.document_sequence == sequence
            && self.issued.elapsed() < GRANT_LIFETIME
    }
}

pub fn bind_document(state: &AxumProxyState, sequence: u64) -> Option<()> {
    if sequence != state.document_sequence.load(Ordering::SeqCst) {
        return None;
    }
    let nonce = state.auto_login_nonce.read().ok()?.clone()?;
    *state.bitwarden_continuation.lock().ok()? = Some(BitwardenContinuation {
        token: nonce,
        document_sequence: sequence,
        issued: Instant::now(),
        password_stage: false,
    });
    Some(())
}

pub fn validate_config(config: &BasicAuthProxyConfig) -> Result<(), String> {
    if config.upstream_auth_mode != UpstreamAuthMode::BitwardenForm {
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
        return Err("Reviewed web-vault login requires HTTPS and its fixed two-stage controls. Clear advanced selector, timing, fill-only and extra-field overrides, or use manual login.".into());
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

pub fn dispense(state: &AxumProxyState, query: &AutoLoginQuery) -> Response<Body> {
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
    let sequence = state.document_sequence.load(Ordering::SeqCst);
    if query.phase.as_deref() == Some("password") {
        let valid = pending
            .as_ref()
            .is_some_and(|grant| grant.valid(&query.nonce, sequence, true));
        if !valid {
            // A navigation/expiry permanently invalidates this attempt. A wrong
            // random token must not consume somebody else's still-valid grant.
            if pending.as_ref().is_some_and(|grant| {
                grant.document_sequence != sequence || grant.issued.elapsed() >= GRANT_LIFETIME
            }) {
                *pending = None;
            }
            return forbidden("reviewed login continuation expired or invalid");
        }
        *pending = None;
        let password = match state.password.read() {
            Ok(password) => password,
            Err(_) => return forbidden("reviewed login credential unavailable"),
        };
        return json(serde_json::json!({"loginFlow":"bitwarden", "password": &*password}));
    }
    if query.phase.is_some() || !state.auto_login_armed.load(Ordering::SeqCst) {
        return forbidden("reviewed login not armed");
    }
    if !pending
        .as_ref()
        .is_some_and(|grant| grant.valid(&query.nonce, sequence, false))
    {
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
    *pending = Some(BitwardenContinuation {
        token: token.clone(),
        document_sequence: sequence,
        issued: Instant::now(),
        password_stage: true,
    });
    json(serde_json::json!({"loginFlow":"bitwarden", "username": &*username, "continuation":token}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reviewed_vault_grants_expire_and_never_cross_stage_or_document() {
        let mut grant = BitwardenContinuation {
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
}
