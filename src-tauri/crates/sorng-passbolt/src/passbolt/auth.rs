//! Authentication flows for Passbolt.
//!
//! Implements both GPGAuth (legacy cookie-based) and JWT-based authentication
//! as documented in the Passbolt API v5.0.0.
//!
//! ## GPGAuth flow
//! 1. `GET /auth/verify.json` — retrieve server's PGP public key
//! 2. `POST /auth/verify.json` — verify server identity (encrypt challenge with server key)
//! 3. `POST /auth/login.json` — login (decrypt server challenge with user key)
//! 4. Cookie-based session established
//!
//! ## JWT flow
//! 1. `GET /auth/verify.json` — retrieve server's PGP public key
//! 2. `POST /auth/jwt/login.json` — send `gpg_encrypt(gpg_sign(challenge, user_key), server_key)`
//! 3. Receive JWT access_token + refresh_token
//! 4. `POST /auth/jwt/refresh.json` — refresh expired access tokens

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::crypto::PgpContext;
use crate::passbolt::types::*;
use log::{debug, info, warn};

/// Server verify response body.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerVerifyBody {
    pub fingerprint: String,
    pub keydata: String,
}

/// JWT login request payload.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JwtLoginRequest {
    pub user_id: String,
    pub challenge: String,
}

/// JWT login response body.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JwtLoginResponse {
    pub challenge: String,
}

/// JWT logout request.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JwtLogoutRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}

/// JWT refresh request.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JwtRefreshRequest {
    pub user_id: String,
    pub refresh_token: String,
}

/// JWT refresh response body.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JwtRefreshResponse {
    pub access_token: String,
}

/// GPGAuth login stages.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpgAuthLoginPayload {
    pub data: GpgAuthData,
}

/// GPGAuth data envelope.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpgAuthData {
    pub gpg_auth: GpgAuthFields,
}

/// GPGAuth field variants.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpgAuthFields {
    /// Fingerprint of user's key (always required).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyid: Option<String>,
    /// Encrypted challenge token (for server-verify step).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_verify_token: Option<String>,
    /// User's encrypted response (for login step).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_token_result: Option<String>,
}

/// Passbolt authenticator.
pub struct PassboltAuth;

impl PassboltAuth {
    /// Step 1: Get the server's public PGP key.
    pub async fn get_server_key(
        client: &PassboltApiClient,
    ) -> Result<ServerVerifyBody, PassboltError> {
        info!("Fetching server public key from /auth/verify.json");
        let resp: ApiResponse<ServerVerifyBody> =
            client.get_unauthenticated("/auth/verify.json").await?;
        debug!("Server key fingerprint: {}", resp.body.fingerprint);
        Ok(resp.body)
    }

    /// Step 2 (GPGAuth): Verify the server's identity.
    ///
    /// Encrypt a challenge token with the server's public key and send it.
    /// The server decrypts it and returns it in a response header.
    pub async fn verify_server(
        client: &PassboltApiClient,
        pgp: &PgpContext,
    ) -> Result<bool, PassboltError> {
        let challenge = pgp.generate_challenge();
        let encrypted = pgp.encrypt_for_server(&challenge)?;

        let payload = GpgAuthLoginPayload {
            data: GpgAuthData {
                gpg_auth: GpgAuthFields {
                    keyid: pgp.user_fingerprint().map(String::from),
                    server_verify_token: Some(encrypted),
                    user_token_result: None,
                },
            },
        };

        let response = client
            .post_unauthenticated_raw("/auth/verify.json", &payload)
            .await?;

        // The server decrypts the challenge and returns it in X-GPGAuth-Verify-Response header.
        if let Some(verify_header) = response.headers().get("X-GPGAuth-Verify-Response") {
            let returned_token = verify_header.to_str().unwrap_or("");
            if returned_token == challenge {
                info!("Server identity verified via GPGAuth");
                return Ok(true);
            } else {
                warn!("Server returned mismatched challenge token");
                return Ok(false);
            }
        }

        warn!("No X-GPGAuth-Verify-Response header in server response");
        Ok(false)
    }

    /// Step 3 (GPGAuth): Login.
    ///
    /// The server sends an encrypted challenge; we decrypt it and send it back.
    pub async fn gpg_auth_login(
        client: &mut PassboltApiClient,
        pgp: &PgpContext,
    ) -> Result<SessionState, PassboltError> {
        // Stage 1: Request a challenge from the server.
        let payload = GpgAuthLoginPayload {
            data: GpgAuthData {
                gpg_auth: GpgAuthFields {
                    keyid: pgp.user_fingerprint().map(String::from),
                    server_verify_token: None,
                    user_token_result: None,
                },
            },
        };

        let response = client
            .post_unauthenticated_raw("/auth/login.json", &payload)
            .await?;

        // The server encrypts a challenge with our public key in X-GPGAuth-User-Auth-Token.
        let encrypted_token = response
            .headers()
            .get("X-GPGAuth-User-Auth-Token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if encrypted_token.is_empty() {
            return Err(PassboltError::auth_failed(
                "No X-GPGAuth-User-Auth-Token in server response",
            ));
        }

        // Stage 2: Decrypt the challenge and send it back.
        let decrypted_token = pgp.decrypt(&encrypted_token)?;

        let login_payload = GpgAuthLoginPayload {
            data: GpgAuthData {
                gpg_auth: GpgAuthFields {
                    keyid: pgp.user_fingerprint().map(String::from),
                    server_verify_token: None,
                    user_token_result: Some(decrypted_token),
                },
            },
        };

        let login_response = client
            .post_unauthenticated_raw("/auth/login.json", &login_payload)
            .await?;

        if !login_response.status().is_success() {
            return Err(PassboltError::auth_failed("GPGAuth login failed"));
        }

        // Session cookies are automatically stored by the cookie-jar client.
        let session = SessionState {
            authenticated: true,
            server_fingerprint: pgp.server_fingerprint().map(String::from),
            ..Default::default()
        };

        // Extract user ID from X-GPGAuth-Progress or response body if available.
        if let Some(progress) = login_response.headers().get("X-GPGAuth-Progress") {
            debug!("GPGAuth progress: {:?}", progress);
        }

        client.set_session(session.clone());
        info!("GPGAuth login successful");
        Ok(session)
    }

    /// JWT Login: create a challenge, encrypt+sign it, exchange for tokens.
    pub async fn jwt_login(
        client: &mut PassboltApiClient,
        pgp: &PgpContext,
        user_id: &str,
    ) -> Result<SessionState, PassboltError> {
        info!("Starting JWT login for user {}", user_id);

        // Build the challenge JSON.
        let challenge_json = serde_json::json!({
            "version": "1.0.0",
            "domain": client.base_url(),
            "verify_token": pgp.generate_challenge(),
            "verify_token_expiry": chrono::Utc::now()
                .checked_add_signed(chrono::Duration::minutes(5))
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
        });

        // gpg_encrypt(gpg_sign(challenge, user_key), server_key)
        let challenge_str = challenge_json.to_string();
        let encrypted_challenge = pgp.encrypt_and_sign_for_server(&challenge_str)?;

        let payload = JwtLoginRequest {
            user_id: user_id.to_string(),
            challenge: encrypted_challenge,
        };

        let resp: ApiResponse<JwtLoginResponse> = client
            .post_unauthenticated("/auth/jwt/login.json", &payload)
            .await?;

        // Decrypt the server's response challenge to extract the access token.
        let decrypted = pgp.decrypt_and_verify(&resp.body.challenge)?;
        let token_data: serde_json::Value = serde_json::from_str(&decrypted)
            .map_err(|e| PassboltError::parse(format!("Failed to parse JWT response: {}", e)))?;

        let access_token = token_data
            .get("access_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let refresh_token = token_data
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if access_token.is_empty() {
            return Err(PassboltError::auth_failed(
                "No access_token in JWT login response",
            ));
        }

        let session = SessionState {
            authenticated: true,
            user_id: Some(user_id.to_string()),
            access_token: Some(access_token),
            refresh_token: if refresh_token.is_empty() {
                None
            } else {
                Some(refresh_token)
            },
            server_fingerprint: pgp.server_fingerprint().map(String::from),
            ..Default::default()
        };

        client.set_session(session.clone());
        info!("JWT login successful for user {}", user_id);
        Ok(session)
    }

    /// Refresh the JWT access token.
    pub async fn jwt_refresh(client: &mut PassboltApiClient) -> Result<String, PassboltError> {
        let (user_id, refresh_token) = {
            let session = client.session();
            let uid = session
                .user_id
                .clone()
                .ok_or_else(|| PassboltError::auth_failed("No user_id in session"))?;
            let rt = session
                .refresh_token
                .clone()
                .ok_or_else(|| PassboltError::auth_failed("No refresh_token in session"))?;
            (uid, rt)
        };

        let payload = JwtRefreshRequest {
            user_id: user_id.clone(),
            refresh_token,
        };

        let resp: ApiResponse<JwtRefreshResponse> =
            client.post("/auth/jwt/refresh.json", &payload).await?;

        let new_token = resp.body.access_token;
        {
            let session = client.session_mut();
            session.access_token = Some(new_token.clone());
        }

        info!("JWT token refreshed for user {}", user_id);
        Ok(new_token)
    }

    /// Logout (JWT).
    pub async fn jwt_logout(client: &mut PassboltApiClient) -> Result<(), PassboltError> {
        let refresh_token = client.session().refresh_token.clone();
        let payload = JwtLogoutRequest { refresh_token };

        let _ = client
            .post::<_, serde_json::Value>("/auth/jwt/logout.json", &payload)
            .await;

        client.set_session(SessionState::default());
        info!("JWT logout complete");
        Ok(())
    }

    /// Logout (GPGAuth).
    pub async fn gpg_auth_logout(client: &mut PassboltApiClient) -> Result<(), PassboltError> {
        let builder =
            reqwest::Client::new().post(format!("{}/auth/logout.json", client.base_url()));
        let _ = client.execute_raw(builder).await;
        client.set_session(SessionState::default());
        info!("GPGAuth logout complete");
        Ok(())
    }

    /// Check if the current session is authenticated.
    pub async fn is_authenticated(client: &PassboltApiClient) -> Result<bool, PassboltError> {
        let result: Result<ApiResponse<serde_json::Value>, _> =
            client.get("/auth/is-authenticated.json").await;
        match result {
            Ok(resp) => Ok(resp.header.status == "success"),
            Err(_) => Ok(false),
        }
    }

    // ── MFA ─────────────────────────────────────────────────────────

    /// Check if TOTP MFA is required.
    pub async fn mfa_check_totp(client: &PassboltApiClient) -> Result<bool, PassboltError> {
        let result: Result<ApiResponse<serde_json::Value>, _> =
            client.get("/mfa/verify/totp.json").await;
        match result {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind == PassboltErrorKind::BadRequest {
                    Ok(false) // TOTP not required
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Check if Yubikey MFA is required.
    pub async fn mfa_check_yubikey(client: &PassboltApiClient) -> Result<bool, PassboltError> {
        let result: Result<ApiResponse<serde_json::Value>, _> =
            client.get("/mfa/verify/yubikey.json").await;
        match result {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind == PassboltErrorKind::BadRequest {
                    Ok(false)
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Submit TOTP MFA code.
    pub async fn mfa_verify_totp(
        client: &mut PassboltApiClient,
        code: &str,
        remember: bool,
    ) -> Result<(), PassboltError> {
        let payload = MfaTotpRequest {
            totp: code.to_string(),
            remember: if remember { Some(1) } else { Some(0) },
        };
        let _: ApiResponse<serde_json::Value> =
            client.post("/mfa/verify/totp.json", &payload).await?;

        let session = client.session_mut();
        session.mfa_verified = true;
        session.mfa_provider = Some(MfaProvider::Totp);
        info!("TOTP MFA verified");
        Ok(())
    }

    /// Submit Yubikey MFA code.
    pub async fn mfa_verify_yubikey(
        client: &mut PassboltApiClient,
        otp: &str,
        remember: bool,
    ) -> Result<(), PassboltError> {
        let payload = MfaYubikeyRequest {
            hotp: otp.to_string(),
            remember: if remember { Some(1) } else { Some(0) },
        };
        let _: ApiResponse<serde_json::Value> =
            client.post("/mfa/verify/yubikey.json", &payload).await?;

        let session = client.session_mut();
        session.mfa_verified = true;
        session.mfa_provider = Some(MfaProvider::Yubikey);
        info!("Yubikey MFA verified");
        Ok(())
    }

    /// Get MFA error/requirements info.
    pub async fn mfa_get_requirements(
        client: &PassboltApiClient,
    ) -> Result<serde_json::Value, PassboltError> {
        let resp: ApiResponse<serde_json::Value> = client.get("/mfa/verify/error.json").await?;
        Ok(resp.body)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_login_request_serialize() {
        let req = JwtLoginRequest {
            user_id: "user-uuid".into(),
            challenge: "-----BEGIN PGP MESSAGE-----".into(),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["user_id"], "user-uuid");
        assert!(json["challenge"].as_str().unwrap().contains("PGP"));
    }

    #[test]
    fn test_jwt_refresh_request() {
        let req = JwtRefreshRequest {
            user_id: "uid".into(),
            refresh_token: "rt".into(),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["user_id"], "uid");
        assert_eq!(json["refresh_token"], "rt");
    }

    #[test]
    fn test_jwt_logout_request_with_token() {
        let req = JwtLogoutRequest {
            refresh_token: Some("token-uuid".into()),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["refresh_token"], "token-uuid");
    }

    #[test]
    fn test_jwt_logout_request_without_token() {
        let req = JwtLogoutRequest {
            refresh_token: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json.get("refresh_token").is_none());
    }

    #[test]
    fn test_gpg_auth_fields() {
        let fields = GpgAuthFields {
            keyid: Some("ABC123".into()),
            server_verify_token: Some("encrypted".into()),
            user_token_result: None,
        };
        let json = serde_json::to_value(&fields).unwrap();
        assert_eq!(json["keyid"], "ABC123");
        assert!(json.get("user_token_result").is_none());
    }

    #[test]
    fn test_server_verify_body_deserialize() {
        let json = r#"{
            "fingerprint": "5FB36DE5C8E69DD4DB185DF2BC9F2749E432CB59",
            "keydata": "-----BEGIN PUBLIC KEY-----"
        }"#;
        let body: ServerVerifyBody = serde_json::from_str(json).unwrap();
        assert_eq!(body.fingerprint, "5FB36DE5C8E69DD4DB185DF2BC9F2749E432CB59");
    }

    #[test]
    fn test_mfa_totp_request() {
        let req = MfaTotpRequest {
            totp: "123456".into(),
            remember: Some(1),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["totp"], "123456");
        assert_eq!(json["remember"], 1);
    }

    #[test]
    fn test_mfa_yubikey_request() {
        let req = MfaYubikeyRequest {
            hotp: "ccccbbbbaaaa".into(),
            remember: Some(0),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["hotp"], "ccccbbbbaaaa");
    }
}
