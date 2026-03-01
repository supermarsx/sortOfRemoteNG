use crate::dashlane::api_client::DashlaneApiClient;
use crate::dashlane::types::{DashlaneConfig, DashlaneError, DashlaneSession};
use sha2::{Digest, Sha256};

/// Derive the master password hash for Dashlane authentication.
/// Uses SHA-256(email + master_password) × iterations.
pub fn derive_master_key(email: &str, master_password: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(email.to_lowercase().as_bytes());
    hasher.update(master_password.as_bytes());
    let hash = hasher.finalize();
    hash.to_vec()
}

/// Compute the authentication hash sent to the server.
pub fn compute_auth_hash(master_key: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Full login flow:
/// 1. Register device (if needed)
/// 2. Authenticate with master password hash
/// 3. Return session
pub async fn login(
    client: &mut DashlaneApiClient,
    config: &DashlaneConfig,
    master_password: &str,
    email_token: Option<&str>,
) -> Result<DashlaneSession, DashlaneError> {
    // Step 1: Register device
    let reg = client.register_device(&config.email, &config.device_name).await?;

    if reg.requires_verification {
        // Need email token verification
        if let Some(token) = email_token {
            let verified = client
                .complete_device_registration(&config.email, token)
                .await?;
            if let (Some(ak), Some(sk)) = (verified.device_access_key, verified.device_secret_key) {
                client.set_device_keys(ak.clone(), sk.clone());

                let master_key = derive_master_key(&config.email, master_password);

                return Ok(DashlaneSession {
                    device_access_key: ak,
                    device_secret_key: sk,
                    login: config.email.clone(),
                    server_key: verified.server_key,
                    encryption_key: master_key,
                    logged_in_at: chrono::Utc::now().to_rfc3339(),
                });
            }
        }
        return Err(DashlaneError::mfa_required());
    }

    // Step 2: Set device keys and authenticate
    if let (Some(ak), Some(sk)) = (reg.device_access_key, reg.device_secret_key) {
        client.set_device_keys(ak.clone(), sk.clone());

        let master_key = derive_master_key(&config.email, master_password);
        let auth_hash = compute_auth_hash(&master_key);

        let auth = client
            .perform_authentication(&config.email, &auth_hash)
            .await?;

        if !auth.success {
            if let Some(err) = auth.error {
                return Err(DashlaneError::auth_failed(err));
            }
        }

        Ok(DashlaneSession {
            device_access_key: ak,
            device_secret_key: sk,
            login: config.email.clone(),
            server_key: auth.server_key.or(reg.server_key),
            encryption_key: master_key,
            logged_in_at: chrono::Utc::now().to_rfc3339(),
        })
    } else {
        Err(DashlaneError::auth_failed("Device registration failed — no keys received"))
    }
}

/// Logout: clear the session.
pub async fn logout(client: &mut DashlaneApiClient) -> Result<(), DashlaneError> {
    client.clear_session();
    Ok(())
}

/// Validate that we have an active session.
pub fn validate_session(session: &Option<DashlaneSession>) -> Result<&DashlaneSession, DashlaneError> {
    session
        .as_ref()
        .ok_or_else(|| DashlaneError::auth_failed("Not logged in to Dashlane"))
}
