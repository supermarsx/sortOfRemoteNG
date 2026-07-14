//! Secret retrieval and decryption for Passbolt.
//!
//! Endpoints:
//! - `GET /secrets/resource/{resourceId}.json` — get encrypted secret for a resource

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::crypto::PgpContext;
use crate::passbolt::types::*;
use log::debug;

/// Secret API operations.
pub struct PassboltSecrets;

impl PassboltSecrets {
    /// Get the encrypted secret for a resource.
    pub async fn get(
        client: &PassboltApiClient,
        resource_id: &str,
    ) -> Result<Secret, PassboltError> {
        debug!("Fetching secret for resource {}", resource_id);
        let resp: ApiResponse<Secret> = client
            .get(&format!("/secrets/resource/{}.json", resource_id))
            .await?;
        Ok(resp.body)
    }

    /// Get and decrypt the secret for a resource.
    pub async fn get_decrypted(
        client: &PassboltApiClient,
        pgp: &PgpContext,
        resource_id: &str,
    ) -> Result<DecryptedSecret, PassboltError> {
        let secret = Self::get(client, resource_id).await?;
        let decrypted = Self::decrypt(pgp, &secret)?;
        Ok(decrypted)
    }

    /// Decrypt an encrypted secret using the PGP context.
    pub fn decrypt(pgp: &PgpContext, secret: &Secret) -> Result<DecryptedSecret, PassboltError> {
        let plaintext = pgp.decrypt(&secret.data)?;

        // The decrypted data can be either:
        // 1. A plain string (password only, legacy v1 format)
        // 2. A JSON object (password + description + optional TOTP, v2+ format)
        if let Ok(parsed) = serde_json::from_str::<DecryptedSecret>(&plaintext) {
            Ok(parsed)
        } else {
            // Treat as plain password
            Ok(DecryptedSecret {
                password: plaintext.clone(),
                description: None,
                totp: None,
                extras: std::collections::HashMap::new(),
            })
        }
    }

    /// Encrypt a secret for a specific user (used when sharing).
    pub fn encrypt_for_user(
        pgp: &PgpContext,
        secret: &DecryptedSecret,
        user_id: &str,
    ) -> Result<String, PassboltError> {
        let json = serde_json::to_string(secret)
            .map_err(|e| PassboltError::encryption(format!("Failed to serialize secret: {}", e)))?;
        pgp.encrypt_for_user(&json, user_id)
    }

    /// Encrypt a secret for the server (for saving/updating).
    pub fn encrypt_for_server(
        pgp: &PgpContext,
        secret: &DecryptedSecret,
    ) -> Result<String, PassboltError> {
        let json = serde_json::to_string(secret)
            .map_err(|e| PassboltError::encryption(format!("Failed to serialize secret: {}", e)))?;
        pgp.encrypt_for_server(&json)
    }

    /// Build secret data for a new resource (encrypted for the current user).
    pub fn build_secret_data(
        pgp: &PgpContext,
        password: &str,
        description: Option<&str>,
        totp: Option<&TotpConfig>,
    ) -> Result<String, PassboltError> {
        let secret = DecryptedSecret {
            password: password.to_string(),
            description: description.map(String::from),
            totp: totp.cloned(),
            extras: std::collections::HashMap::new(),
        };
        Self::encrypt_for_server(pgp, &secret)
    }

    /// Build secret entries for sharing with multiple users.
    /// Returns a Vec of ShareSecret entries.
    pub fn build_share_secrets(
        pgp: &PgpContext,
        secret: &DecryptedSecret,
        user_ids: &[String],
    ) -> Result<Vec<ShareSecret>, PassboltError> {
        let mut entries = Vec::new();
        for user_id in user_ids {
            let encrypted = Self::encrypt_for_user(pgp, secret, user_id)?;
            entries.push(ShareSecret {
                user_id: user_id.clone(),
                data: encrypted,
            });
        }
        Ok(entries)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBLIC_KEY: &str = "-----BEGIN PGP PUBLIC KEY BLOCK-----

xioGY4d/4xsAAAAg+U2nu0jWCmHlZ3BqZYfQMxmZu52JGggkLq2EVD34laPCsQYf
GwoAAABCBYJjh3/jAwsJBwUVCg4IDAIWAAKbAwIeCSIhBssYbE8GCaaX5NUt+mxy
KwwfHifBilZwj2Ul7Ce62azJBScJAgcCAAAAAK0oIBA+LX0ifsDm185Ecds2v8lw
gyU2kCcUmKfvBXbAf6rhRYWzuQOwEn7E/aLwIwRaLsdry0+VcallHhSu4RN6HWaE
QsiPlR4zxP/TP7mhfVEe7XWPxtnMUMtf15OyA51YBM4qBmOHf+MZAAAAIIaTJINn
+eUBXbki+PSAld2nhJh/LVmFsS+60WyvXkQ1wpsGGBsKAAAALAWCY4d/4wKbDCIh
BssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce62azJAAAAAAQBIKbpGG2dWTX8
j+VjFM21J0hqWlEg+bdiojWnKfA5AQpWUWtnNwDEM0g12vYxoWM8Y81W+bHBw805
I8kWVkXU6vFOi+HWvv/ira7ofJu16NnoUkhclkUrk0mXubZvyl4GBg==
-----END PGP PUBLIC KEY BLOCK-----";

    const TEST_PRIVATE_KEY: &str = "-----BEGIN PGP PRIVATE KEY BLOCK-----

xUsGY4d/4xsAAAAg+U2nu0jWCmHlZ3BqZYfQMxmZu52JGggkLq2EVD34laMAGXKB
exK+cH6NX1hs5hNhIB00TrJmosgv3mg1ditlsLfCsQYfGwoAAABCBYJjh3/jAwsJ
BwUVCg4IDAIWAAKbAwIeCSIhBssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce6
2azJBScJAgcCAAAAAK0oIBA+LX0ifsDm185Ecds2v8lwgyU2kCcUmKfvBXbAf6rh
RYWzuQOwEn7E/aLwIwRaLsdry0+VcallHhSu4RN6HWaEQsiPlR4zxP/TP7mhfVEe
7XWPxtnMUMtf15OyA51YBMdLBmOHf+MZAAAAIIaTJINn+eUBXbki+PSAld2nhJh/
LVmFsS+60WyvXkQ1AE1gCk95TUR3XFeibg/u/tVY6a//1q0NWC1X+yui3O24wpsG
GBsKAAAALAWCY4d/4wKbDCIhBssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce6
2azJAAAAAAQBIKbpGG2dWTX8j+VjFM21J0hqWlEg+bdiojWnKfA5AQpWUWtnNwDE
M0g12vYxoWM8Y81W+bHBw805I8kWVkXU6vFOi+HWvv/ira7ofJu16NnoUkhclkUr
k0mXubZvyl4GBg==
-----END PGP PRIVATE KEY BLOCK-----";

    fn roundtrip_context() -> PgpContext {
        let mut pgp = PgpContext::new();
        pgp.set_user_key(TEST_PRIVATE_KEY, "");
        pgp.set_server_key(TEST_PUBLIC_KEY, "");
        pgp
    }

    #[test]
    fn test_decrypt_plain_password() {
        let pgp = roundtrip_context();
        let encrypted = pgp.encrypt_for_server("plain-password").unwrap();
        let secret = Secret {
            id: "sec-uuid".into(),
            user_id: "user-uuid".into(),
            resource_id: "res-uuid".into(),
            data: encrypted,
            created: "2024-01-01T00:00:00Z".into(),
            modified: "2024-01-01T00:00:00Z".into(),
        };

        let decrypted = PassboltSecrets::decrypt(&pgp, &secret).unwrap();
        assert_eq!(decrypted.password, "plain-password");
        assert_eq!(decrypted.description, None);
    }

    #[test]
    fn test_decrypted_secret_json_round_trip() {
        let secret = DecryptedSecret {
            password: "pass".into(),
            description: Some("desc".into()),
            totp: None,
            extras: std::collections::HashMap::new(),
        };
        let json = serde_json::to_string(&secret).unwrap();
        let parsed: DecryptedSecret = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.password, "pass");
        assert_eq!(parsed.description, Some("desc".into()));
    }

    #[test]
    fn test_build_secret_data_no_totp() {
        let pgp = roundtrip_context();
        let encrypted =
            PassboltSecrets::build_secret_data(&pgp, "password123", Some("My login"), None);
        let secret = Secret {
            id: "sec-uuid".into(),
            user_id: "user-uuid".into(),
            resource_id: "res-uuid".into(),
            data: encrypted.unwrap(),
            created: "2024-01-01T00:00:00Z".into(),
            modified: "2024-01-01T00:00:00Z".into(),
        };

        let decrypted = PassboltSecrets::decrypt(&pgp, &secret).unwrap();
        assert_eq!(decrypted.password, "password123");
        assert_eq!(decrypted.description, Some("My login".into()));
    }

    #[test]
    fn test_totp_config_defaults() {
        let totp = TotpConfig {
            secret_key: "JBSWY3DPEHPK3PXP".into(),
            ..Default::default()
        };
        assert_eq!(totp.period, 30);
        assert_eq!(totp.digits, 6);
        assert_eq!(totp.algorithm, "SHA1");
    }

    #[test]
    fn test_share_secret_serialize() {
        let ss = ShareSecret {
            user_id: "uid".into(),
            data: "pgp-encrypted".into(),
        };
        let json = serde_json::to_value(&ss).unwrap();
        assert_eq!(json["user_id"], "uid");
        assert_eq!(json["data"], "pgp-encrypted");
    }
}
