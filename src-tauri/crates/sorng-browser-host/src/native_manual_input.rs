//! Explicit owner-window typing, separate from all automatic-login grants.
//! Secret-bearing requests deliberately implement neither Debug nor Serialize.
use crate::ipc::OriginBrowserIdentity;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const REQUEST: &str = "sorng.manual-input.request.v1";
pub const RESPONSE: &str = "sorng.manual-input.response.v1";
pub const CAPTURE_MS: u64 = 60_000;
pub const TYPE_MS: u64 = 30_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualInputRequest {
    pub identity: OriginBrowserIdentity,
    pub view_id: Option<String>,
    pub action: ManualInputAction,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ManualInputAction {
    Capture {},
    Type {
        capture_id: String,
        text: String,
        credential_kind: CredentialKind,
        restore_focus: bool,
        starts_at_unix_ms: Option<u64>,
        expires_at_unix_ms: Option<u64>,
        #[serde(default)]
        typing_mode: TypingMode,
    },
    Cancel {
        capture_id: String,
    },
}
impl Drop for ManualInputAction {
    fn drop(&mut self) {
        if let Self::Type { text, .. } = self {
            text.zeroize();
        }
    }
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CredentialKind {
    Credential,
    Totp,
}
#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TypingMode {
    #[default]
    Simulated,
    Instant,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualInputResponse {
    pub status: &'static str,
    pub capture_id: String,
}
impl ManualInputResponse {
    /// A valid capture request can wait for a user-selected field without
    /// issuing a target token or disclosing any credential.
    #[cfg(any(feature = "cef-host", test))]
    pub(crate) fn waiting() -> Self {
        Self {
            status: "waiting",
            capture_id: String::new(),
        }
    }
}

pub fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 80
        && token.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}
pub fn code_current(starts: u64, expires: u64, now: u64) -> bool {
    starts <= now && now < expires && expires.saturating_sub(starts) <= 120_000
}
impl ManualInputRequest {
    pub fn validate(&self, now: u64) -> Result<(), &'static str> {
        self.identity
            .validate()
            .map_err(|_| "The manual typing browser identity is invalid.")?;
        if self
            .view_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 128 || id.chars().any(char::is_control))
        {
            return Err("The selected website view is invalid.");
        }
        match &self.action {
            ManualInputAction::Capture {} => Ok(()),
            ManualInputAction::Cancel { capture_id } if valid_token(capture_id) => Ok(()),
            ManualInputAction::Type {
                capture_id,
                text,
                credential_kind,
                restore_focus,
                starts_at_unix_ms,
                expires_at_unix_ms,
                ..
            } => {
                if !valid_token(capture_id)
                    || !restore_focus
                    || text.is_empty()
                    || text.len() > 16_384
                    || text.encode_utf16().count() > 4096
                    || text.chars().any(char::is_control)
                {
                    return Err("Manual typing requires a current capture, explicit focus restoration and bounded single-line text.");
                }
                if *credential_kind == CredentialKind::Totp {
                    if !(6..=8).contains(&text.len())
                        || !text.bytes().all(|b| b.is_ascii_digit())
                        || !starts_at_unix_ms
                            .zip(*expires_at_unix_ms)
                            .is_some_and(|(s, e)| code_current(s, e, now))
                    {
                        return Err("The authenticator code is expired or not yet valid. Generate a fresh code and try again.");
                    }
                } else if starts_at_unix_ms.is_some() || expires_at_unix_ms.is_some() {
                    return Err("Credential typing cannot carry an authenticator validity window.");
                }
                Ok(())
            }
            _ => Err("The manual typing capture is invalid."),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn waiting_for_focus_never_issues_a_capture_token() {
        let response = serde_json::to_value(ManualInputResponse::waiting()).unwrap();
        assert_eq!(
            response,
            serde_json::json!({"status":"waiting","captureId":""})
        );
    }
    fn request(action: &str) -> Result<ManualInputRequest, serde_json::Error> {
        serde_json::from_str(&format!(
            r#"{{"identity":{{"ownerDatabaseId":"db","connectionId":"connection","sessionId":"session","attemptId":"11111111-1111-4111-8111-111111111111"}},"action":{action}}}"#
        ))
    }
    #[test]
    fn request_schema_is_closed_and_values_are_bounded() {
        for action in [
            r#"{"kind":"capture","script":"unsafe"}"#,
            r#"{"kind":"paste"}"#,
            r#"{"kind":"type","captureId":"a","text":"x","credentialKind":"credential","restoreFocus":true,"submit":true}"#,
        ] {
            assert!(request(action).is_err());
        }
        for (text, valid) in [("", false), ("text", true), ("x\n", false)] {
            let action = serde_json::json!({"kind":"type","captureId":"a","text":text,"credentialKind":"credential","restoreFocus":true});
            assert_eq!(
                request(&action.to_string()).unwrap().validate(10).is_ok(),
                valid
            );
        }
        let large = serde_json::json!({"kind":"type","captureId":"a","text":"x".repeat(4097),"credentialKind":"credential","restoreFocus":true});
        assert!(request(&large.to_string()).unwrap().validate(10).is_err());
    }
    #[test]
    fn totp_requires_explicit_current_bounded_window_and_digits() {
        for (s, e, now, valid) in [
            (100, 200, 99, false),
            (100, 200, 100, true),
            (100, 200, 199, true),
            (100, 200, 200, false),
            (200, 100, 150, false),
            (0, 120001, 1, false),
        ] {
            assert_eq!(code_current(s, e, now), valid);
            let action = serde_json::json!({"kind":"type","captureId":"a","text":"123456","credentialKind":"totp","restoreFocus":true,"startsAtUnixMs":s,"expiresAtUnixMs":e});
            assert_eq!(
                request(&action.to_string()).unwrap().validate(now).is_ok(),
                valid
            );
        }
        assert!(request(r#"{"kind":"type","captureId":"a","text":"123456","credentialKind":"totp","restoreFocus":true}"#).unwrap().validate(10).is_err());
    }
    #[test]
    fn restoration_and_tokens_are_explicit() {
        for token in ["", "../escape", "token with spaces"] {
            assert!(!valid_token(token));
        }
        assert!(request(r#"{"kind":"type","captureId":"a","text":"secret","credentialKind":"credential","restoreFocus":false}"#).unwrap().validate(10).is_err());
        assert!(request(r#"{"kind":"cancel","captureId":"a"}"#)
            .unwrap()
            .validate(10)
            .is_ok());
    }
}
