//! # MCP Authentication
//!
//! Handles API key / Bearer token authentication for incoming MCP requests.
//! Supports both header-based and query-parameter-based authentication.

use std::collections::HashMap;

/// Authentication manager for the MCP server.
#[derive(Debug, Clone)]
pub struct AuthManager {
    /// Primary API key.
    api_key: String,
    /// Whether authentication is required.
    enabled: bool,
    /// Failed auth attempt counter (for rate limiting).
    failed_attempts: u32,
    /// Maximum failed attempts before lockout.
    max_failed_attempts: u32,
}

impl AuthManager {
    pub fn new(api_key: String, enabled: bool) -> Self {
        Self {
            api_key,
            enabled,
            failed_attempts: 0,
            max_failed_attempts: 10,
        }
    }

    /// Check if auth is required.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Validate a request's authentication.
    pub fn validate(&mut self, headers: &HashMap<String, String>) -> AuthResult {
        if !self.enabled {
            return AuthResult::Ok;
        }

        if self.api_key.is_empty() {
            // No API key configured but auth is required — deny
            return AuthResult::Denied("No API key configured on server".to_string());
        }

        if self.failed_attempts >= self.max_failed_attempts {
            return AuthResult::Locked;
        }

        // Try Authorization header first (Bearer token)
        if let Some(auth) = headers
            .get("authorization")
            .or(headers.get("Authorization"))
        {
            if let Some(token) = auth.strip_prefix("Bearer ") {
                if constant_time_eq(token.trim(), &self.api_key) {
                    self.failed_attempts = 0;
                    return AuthResult::Ok;
                }
            }
        }

        // Try X-API-Key header
        if let Some(key) = headers.get("x-api-key").or(headers.get("X-API-Key")) {
            if constant_time_eq(key.trim(), &self.api_key) {
                self.failed_attempts = 0;
                return AuthResult::Ok;
            }
        }

        self.failed_attempts += 1;
        AuthResult::Denied("Invalid or missing authentication".to_string())
    }

    /// Update the API key.
    pub fn set_api_key(&mut self, key: String) {
        self.api_key = key;
        self.failed_attempts = 0;
    }

    /// Enable or disable authentication.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Reset the failed attempt counter.
    pub fn reset_lockout(&mut self) {
        self.failed_attempts = 0;
    }

    /// Get the current API key (for display in UI — masked).
    pub fn get_masked_key(&self) -> String {
        if self.api_key.is_empty() {
            return String::new();
        }
        if self.api_key.len() <= 8 {
            return "****".to_string();
        }
        let prefix = &self.api_key[..4];
        let suffix = &self.api_key[self.api_key.len() - 4..];
        format!("{prefix}...{suffix}")
    }

    /// Generate a new random API key.
    pub fn generate_api_key() -> String {
        use uuid::Uuid;
        let u1 = Uuid::new_v4().to_string().replace('-', "");
        let u2 = Uuid::new_v4().to_string().replace('-', "");
        format!("sorng-mcp-{}{}", &u1[..16], &u2[..16])
    }
}

/// Authentication result.
#[derive(Debug, Clone, PartialEq)]
pub enum AuthResult {
    Ok,
    Denied(String),
    Locked,
}

/// Constant-time string comparison to prevent timing attacks.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        result |= x ^ y;
    }
    result == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_disabled() {
        let mut auth = AuthManager::new("secret".to_string(), false);
        assert_eq!(auth.validate(&HashMap::new()), AuthResult::Ok);
    }

    #[test]
    fn test_bearer_token() {
        let mut auth = AuthManager::new("my-secret-key".to_string(), true);
        let mut headers = HashMap::new();
        headers.insert(
            "authorization".to_string(),
            "Bearer my-secret-key".to_string(),
        );
        assert_eq!(auth.validate(&headers), AuthResult::Ok);
    }

    #[test]
    fn test_api_key_header() {
        let mut auth = AuthManager::new("my-secret-key".to_string(), true);
        let mut headers = HashMap::new();
        headers.insert("x-api-key".to_string(), "my-secret-key".to_string());
        assert_eq!(auth.validate(&headers), AuthResult::Ok);
    }

    #[test]
    fn test_invalid_auth() {
        let mut auth = AuthManager::new("correct-key".to_string(), true);
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer wrong-key".to_string());
        assert!(matches!(auth.validate(&headers), AuthResult::Denied(_)));
    }

    #[test]
    fn test_generate_api_key() {
        let key = AuthManager::generate_api_key();
        assert!(key.starts_with("sorng-mcp-"));
        assert_eq!(key.len(), 42); // "sorng-mcp-" (10) + 32 hex chars
    }

    #[test]
    fn test_masked_key() {
        let auth = AuthManager::new("sorng-mcp-abcdefgh12345678".to_string(), true);
        let masked = auth.get_masked_key();
        assert!(masked.starts_with("sorn"));
        assert!(masked.ends_with("5678"));
        assert!(masked.contains("..."));
    }

    #[test]
    fn test_lockout() {
        let mut auth = AuthManager::new("secret".to_string(), true);
        auth.max_failed_attempts = 3;
        let bad_headers: HashMap<String, String> = HashMap::new();
        auth.validate(&bad_headers);
        auth.validate(&bad_headers);
        auth.validate(&bad_headers);
        assert_eq!(auth.validate(&bad_headers), AuthResult::Locked);
        auth.reset_lockout();
        assert!(matches!(auth.validate(&bad_headers), AuthResult::Denied(_)));
    }
}
