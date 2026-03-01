use super::types::*;

/// Authentication and token management for 1Password Connect.
///
/// 1Password Connect uses service-account / Connect bearer tokens (JWT).
/// Unlike Passbolt's GPGAuth flow, authentication is stateless — every
/// request simply carries the bearer token in the `Authorization` header.
pub struct OnePasswordAuth;

impl OnePasswordAuth {
    /// Validate a token by making a lightweight API call (list vaults).
    pub async fn validate_token(
        client: &super::api_client::OnePasswordApiClient,
    ) -> Result<bool, OnePasswordError> {
        match client.list_vaults(None).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind == OnePasswordErrorKind::AuthFailed
                || e.kind == OnePasswordErrorKind::TokenInvalid
                || e.kind == OnePasswordErrorKind::TokenExpired =>
            {
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    /// Parse the JWT bearer token to extract claims (without verification).
    /// Returns a JSON Value with the decoded payload.
    pub fn decode_token_claims(token: &str) -> Result<serde_json::Value, OnePasswordError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(OnePasswordError::token_invalid());
        }

        let payload = base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            parts[1],
        )
        .map_err(|e| {
            OnePasswordError::parse_error(format!("Failed to decode token payload: {}", e))
        })?;

        serde_json::from_slice(&payload).map_err(|e| {
            OnePasswordError::parse_error(format!("Failed to parse token claims: {}", e))
        })
    }

    /// Check if a JWT token is expired by inspecting the `exp` claim.
    pub fn is_token_expired(token: &str) -> Result<bool, OnePasswordError> {
        let claims = Self::decode_token_claims(token)?;
        if let Some(exp) = claims.get("exp").and_then(|v| v.as_i64()) {
            let now = chrono::Utc::now().timestamp();
            Ok(now >= exp)
        } else {
            // If there's no exp claim, treat as non-expiring
            Ok(false)
        }
    }

    /// Extract the token's subject (service account / integration ID).
    pub fn get_token_subject(token: &str) -> Result<Option<String>, OnePasswordError> {
        let claims = Self::decode_token_claims(token)?;
        Ok(claims
            .get("sub")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }

    /// Extract the token audience (vaults the token is scoped to).
    pub fn get_token_audience(token: &str) -> Result<Vec<String>, OnePasswordError> {
        let claims = Self::decode_token_claims(token)?;
        if let Some(aud) = claims.get("aud") {
            if let Some(arr) = aud.as_array() {
                Ok(arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect())
            } else if let Some(s) = aud.as_str() {
                Ok(vec![s.to_string()])
            } else {
                Ok(vec![])
            }
        } else {
            Ok(vec![])
        }
    }

    /// Mask a token for safe logging (show first 8 and last 4 chars).
    pub fn mask_token(token: &str) -> String {
        if token.len() < 16 {
            return "***".to_string();
        }
        format!("{}...{}", &token[..8], &token[token.len() - 4..])
    }
}

use base64::Engine as _;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_token_long() {
        let token = "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.test";
        let masked = OnePasswordAuth::mask_token(token);
        assert!(masked.starts_with("eyJhbGci"));
        assert!(masked.ends_with("test"));
        assert!(masked.contains("..."));
    }

    #[test]
    fn test_mask_token_short() {
        assert_eq!(OnePasswordAuth::mask_token("short"), "***");
    }
}
