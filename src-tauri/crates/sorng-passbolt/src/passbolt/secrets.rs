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

    #[test]
    fn test_decrypt_plain_password() {
        let mut pgp = PgpContext::new();
        pgp.set_user_key(
            "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\npriv\n-----END PGP PRIVATE KEY BLOCK-----",
            "pass",
        );
        pgp.set_server_key(
            "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\npub\n-----END PGP PUBLIC KEY BLOCK-----",
            "fp",
        );
        let password = "mysecretpassword";
        let encrypted = pgp.encrypt_for_server(password).unwrap();
        let secret = Secret {
            id: "sec-uuid".into(),
            user_id: "user-uuid".into(),
            resource_id: "res-uuid".into(),
            data: encrypted,
            created: "2024-01-01T00:00:00Z".into(),
            modified: "2024-01-01T00:00:00Z".into(),
        };

        let decrypted = PassboltSecrets::decrypt(&pgp, &secret).unwrap();
        assert!(!decrypted.password.is_empty());
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
        let mut pgp = PgpContext::new();
        pgp.set_user_key(
            "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\npriv\n-----END PGP PRIVATE KEY BLOCK-----",
            "pass",
        );
        pgp.set_server_key(
            "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\npub\n-----END PGP PUBLIC KEY BLOCK-----",
            "fp",
        );
        let result =
            PassboltSecrets::build_secret_data(&pgp, "password123", Some("My login"), None);
        assert!(result.is_ok());
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
