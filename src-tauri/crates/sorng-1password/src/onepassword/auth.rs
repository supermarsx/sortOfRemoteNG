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
            Err(e)
                if e.kind == OnePasswordErrorKind::AuthFailed
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
        if token.len() > 16 * 1024 {
            return Err(OnePasswordError::token_invalid());
        }
        let mut parts = token.split('.');
        let _header = parts.next().ok_or_else(OnePasswordError::token_invalid)?;
        let encoded_payload = parts.next().ok_or_else(OnePasswordError::token_invalid)?;
        let _signature = parts.next().ok_or_else(OnePasswordError::token_invalid)?;
        if parts.next().is_some() || encoded_payload.len() > 12 * 1024 {
            return Err(OnePasswordError::token_invalid());
        }

        let payload = base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            encoded_payload,
        )
        .map_err(|_| OnePasswordError::parse_error("Token payload is invalid"))?;

        serde_json::from_slice(&payload)
            .map_err(|_| OnePasswordError::parse_error("Token claims are invalid"))
    }

    /// Check if a JWT token is expired by inspecting the `exp` claim.
    pub fn is_token_expired(token: &str) -> Result<bool, OnePasswordError> {
        let claims = Self::decode_token_claims(token)?;
        if let Some(exp) = claims.get("exp").and_then(|v| v.as_i64()) {
            let now = chrono::Utc::now().timestamp();
            Ok(now >= exp)
        } else {
            Err(OnePasswordError::token_invalid())
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
                if arr.len() > 128 {
                    return Err(OnePasswordError::token_invalid());
                }
                Ok(arr
                    .iter()
                    .filter_map(|v| {
                        v.as_str()
                            .filter(|value| value.len() <= 256)
                            .map(str::to_string)
                    })
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
        let _ = token;
        "***".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_token_long() {
        let token = "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.test";
        let masked = OnePasswordAuth::mask_token(token);
        assert_eq!(masked, "***");
    }

    #[test]
    fn test_mask_token_short() {
        assert_eq!(OnePasswordAuth::mask_token("short"), "***");
    }
}
