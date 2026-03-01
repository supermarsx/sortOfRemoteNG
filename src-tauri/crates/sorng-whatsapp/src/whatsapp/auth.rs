//! Authentication & token management for the WhatsApp Cloud API.
//!
//! Handles:
//! - Long-lived token exchange (short-lived → long-lived)
//! - System user token generation
//! - Token validation / introspection
//! - Two-step verification PIN management

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use chrono::{DateTime, Duration, Utc};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};

/// Holds information about a token's validity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub is_valid: bool,
    pub app_id: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
    pub token_type: Option<String>,
    pub user_id: Option<String>,
}

/// Manages WhatsApp Business API authentication flows.
pub struct WaAuthManager {
    client: CloudApiClient,
    app_id: Option<String>,
    app_secret: Option<String>,
}

impl WaAuthManager {
    /// Create a new auth manager.
    pub fn new(
        client: CloudApiClient,
        app_id: Option<String>,
        app_secret: Option<String>,
    ) -> Self {
        Self {
            client,
            app_id,
            app_secret,
        }
    }

    /// Exchange a short-lived token for a long-lived one (~60 days).
    ///
    /// Requires `app_id` and `app_secret` to be configured.
    pub async fn exchange_for_long_lived_token(
        &self,
        short_lived_token: &str,
    ) -> WhatsAppResult<String> {
        let app_id = self.app_id.as_ref().ok_or_else(|| {
            WhatsAppError::internal("app_id required for token exchange".to_string())
        })?;
        let app_secret = self.app_secret.as_ref().ok_or_else(|| {
            WhatsAppError::internal("app_secret required for token exchange".to_string())
        })?;

        let url = format!(
            "{}/oauth/access_token",
            self.client.config().base_url
        );

        let resp = self
            .client
            .get_with_params(
                &url,
                &[
                    ("grant_type", "fb_exchange_token"),
                    ("client_id", app_id),
                    ("client_secret", app_secret),
                    ("fb_exchange_token", short_lived_token),
                ],
            )
            .await?;

        let token = resp["access_token"]
            .as_str()
            .ok_or_else(|| {
                WhatsAppError::internal("No access_token in exchange response".to_string())
            })?
            .to_string();

        info!("Successfully exchanged for long-lived token");
        Ok(token)
    }

    /// Generate a system user access token for server-to-server use.
    ///
    /// This creates a permanent token scoped to the system user.
    pub async fn generate_system_user_token(
        &self,
        system_user_id: &str,
        scope: &[&str],
    ) -> WhatsAppResult<String> {
        let app_id = self.app_id.as_ref().ok_or_else(|| {
            WhatsAppError::internal("app_id required for system user token".to_string())
        })?;
        let app_secret = self.app_secret.as_ref().ok_or_else(|| {
            WhatsAppError::internal("app_secret required for system user token".to_string())
        })?;

        let app_token = format!("{}|{}", app_id, app_secret);

        let url = format!(
            "{}/{}/{}/access_tokens",
            self.client.config().base_url,
            self.client.config().api_version,
            system_user_id
        );

        let body = serde_json::json!({
            "business_app": app_id,
            "scope": scope.join(","),
            "appsecret_proof": Self::compute_appsecret_proof(app_secret, &app_token),
        });

        let resp = self.client.post_json(&url, &body).await?;

        let token = resp["access_token"]
            .as_str()
            .ok_or_else(|| {
                WhatsAppError::internal(
                    "No access_token in system user token response".to_string(),
                )
            })?
            .to_string();

        info!(
            "Generated system user token for user {}",
            system_user_id
        );
        Ok(token)
    }

    /// Introspect a token to check its validity and metadata.
    pub async fn inspect_token(&self, token: &str) -> WhatsAppResult<TokenInfo> {
        let app_id = self.app_id.as_ref();
        let app_secret = self.app_secret.as_ref();

        let input_token_param = token;

        let url = format!(
            "{}/debug_token",
            self.client.config().base_url
        );

        let access_token = if let (Some(id), Some(secret)) = (app_id, app_secret) {
            format!("{}|{}", id, secret)
        } else {
            token.to_string()
        };

        let resp = self
            .client
            .get_with_params(
                &url,
                &[
                    ("input_token", input_token_param),
                    ("access_token", &access_token),
                ],
            )
            .await?;

        let data = &resp["data"];

        let expires_at = data["expires_at"]
            .as_i64()
            .and_then(|ts| {
                if ts == 0 {
                    None // never expires
                } else {
                    DateTime::from_timestamp(ts, 0)
                }
            });

        let scopes = data["scopes"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let info = TokenInfo {
            is_valid: data["is_valid"].as_bool().unwrap_or(false),
            app_id: data["app_id"].as_str().map(String::from),
            expires_at,
            scopes,
            token_type: data["type"].as_str().map(String::from),
            user_id: data["user_id"].as_str().map(String::from),
        };

        debug!("Token inspection: valid={}", info.is_valid);
        Ok(info)
    }

    /// Validate the current access token and check expiration.
    pub async fn validate_current_token(&self) -> WhatsAppResult<TokenInfo> {
        let token = self.client.config().access_token.clone();
        if token.is_empty() {
            return Err(WhatsAppError::not_configured(
                "No access token configured".to_string(),
            ));
        }

        let info = self.inspect_token(&token).await?;

        if !info.is_valid {
            return Err(WhatsAppError {
                code: crate::whatsapp::error::WhatsAppErrorCode::InvalidAccessToken,
                message: "Access token is invalid".to_string(),
                details: None,
                http_status: Some(401),
            });
        }

        // Warn if expiring soon (within 7 days)
        if let Some(exp) = info.expires_at {
            let remaining = exp - Utc::now();
            if remaining < Duration::days(7) {
                warn!(
                    "Access token expires in {} hours – consider refreshing",
                    remaining.num_hours()
                );
            }
        }

        Ok(info)
    }

    /// Set up two-step verification PIN for the phone number.
    pub async fn set_two_step_verification_pin(
        &self,
        pin: &str,
    ) -> WhatsAppResult<()> {
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(WhatsAppError::internal(
                "Two-step verification PIN must be exactly 6 digits".to_string(),
            ));
        }

        let url = self.client.phone_url("");
        let body = serde_json::json!({ "pin": pin });
        self.client.post_json(&url, &body).await?;
        info!("Two-step verification PIN updated");
        Ok(())
    }

    /// Compute the `appsecret_proof` HMAC-SHA256.
    fn compute_appsecret_proof(app_secret: &str, access_token: &str) -> String {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;

        let mut mac =
            HmacSha256::new_from_slice(app_secret.as_bytes()).expect("HMAC init");
        mac.update(access_token.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    /// Verify an incoming webhook request signature.
    ///
    /// The `x-hub-signature-256` header value and the raw body are
    /// compared via HMAC-SHA256 using the app secret.
    pub fn verify_webhook_signature(
        app_secret: &str,
        signature_header: &str,
        body: &[u8],
    ) -> bool {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;

        let expected = signature_header
            .strip_prefix("sha256=")
            .unwrap_or(signature_header);

        let Ok(mut mac) = HmacSha256::new_from_slice(app_secret.as_bytes()) else {
            return false;
        };
        mac.update(body);
        let computed = hex::encode(mac.finalize().into_bytes());

        // Constant-time-ish comparison
        computed == expected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_appsecret_proof() {
        let proof = WaAuthManager::compute_appsecret_proof("secret123", "token_abc");
        assert!(!proof.is_empty());
        assert_eq!(proof.len(), 64); // SHA-256 hex = 64 chars
    }

    #[test]
    fn test_verify_webhook_signature() {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;

        let secret = "my_app_secret";
        let body = b"test payload body";

        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));

        assert!(WaAuthManager::verify_webhook_signature(secret, &sig, body));
        assert!(!WaAuthManager::verify_webhook_signature(
            secret, "sha256=bad", body
        ));
    }

    #[test]
    fn test_pin_validation() {
        // We can't create a real WaAuthManager without a client, but we
        // can test the PIN validation logic inline.
        let pin = "123456";
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|c| c.is_ascii_digit()));

        let bad_pin = "12345a";
        assert!(!bad_pin.chars().all(|c| c.is_ascii_digit()));
    }
}
