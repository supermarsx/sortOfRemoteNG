//! Authentication module — login, logout, 2FA, device tokens, PAT.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;

/// Handles all authentication flows for Synology DSM.
pub struct AuthManager;

impl AuthManager {
    /// Full login flow:
    /// 1. If a Personal Access Token is configured (DSM 7.2+), use it as SID.
    /// 2. Otherwise, password-based login via `SYNO.API.Auth`.
    /// 3. If 2FA is required (error 403), retry with `otp_code`.
    /// 4. Optionally request a device token to skip 2FA next time.
    pub async fn login(client: &mut SynoClient) -> SynologyResult<String> {
        // Personal Access Token path (DSM 7.2+)
        if let Some(ref token) = client.config.access_token {
            client.sid = Some(token.clone());
            log::info!("Using Personal Access Token for authentication");
            // Verify token works by fetching DSM info
            match Self::fetch_dsm_info(client).await {
                Ok(info) => {
                    client.dsm_version = Some(info.version_string.clone());
                    client.model = Some(info.model.clone());
                    return Ok(format!(
                        "Connected to {} ({}) DSM {}",
                        info.model, client.config.host, info.version_string
                    ));
                }
                Err(_) => {
                    client.sid = None;
                    return Err(SynologyError::auth("Personal Access Token is invalid"));
                }
            }
        }

        // Password-based login
        Self::login_password(client).await
    }

    async fn login_password(client: &mut SynoClient) -> SynologyResult<String> {
        let version = client.best_version("SYNO.API.Auth", 7).unwrap_or(3);

        let mut params: Vec<(&str, String)> = vec![
            ("account", client.config.username.clone()),
            ("passwd", client.config.password.clone()),
            ("session", "SortOfRemoteNG".to_string()),
            ("format", "sid".to_string()),
        ];

        // Request SynoToken for DSM 7+
        if version >= 6 {
            params.push(("enable_syno_token", "yes".to_string()));
        }

        // Supply 2FA code if available
        if let Some(ref otp) = client.config.otp_code {
            params.push(("otp_code", otp.clone()));
        }

        // Supply device token to skip 2FA
        if let Some(ref did) = client.device_token {
            params.push(("device_id", did.clone()));
            params.push(("device_name", "SortOfRemoteNG".to_string()));
        }

        // Request device token for future logins
        params.push(("enable_device_token", "yes".to_string()));
        params.push(("device_name", "SortOfRemoteNG".to_string()));

        let url = client.resolve_url("SYNO.API.Auth", version, "login")?;

        // Build form params as &str pairs
        let form_pairs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();

        let resp: SynoResponse<LoginResult> = client
            .http_client()
            .get(&url)
            .query(&form_pairs)
            .send()
            .await?
            .json()
            .await?;

        if resp.success {
            let login = resp.data.ok_or_else(|| {
                SynologyError::parse("Login succeeded but no session data returned")
            })?;
            client.sid = Some(login.sid);
            client.syno_token = login.synotoken;
            if let Some(did) = login.did {
                client.device_token = Some(did);
            }

            // Fetch NAS info
            match Self::fetch_dsm_info(client).await {
                Ok(info) => {
                    client.dsm_version = Some(info.version_string.clone());
                    client.model = Some(info.model.clone());
                    Ok(format!(
                        "Connected to {} ({}) DSM {}",
                        info.model, client.config.host, info.version_string
                    ))
                }
                Err(_) => Ok(format!(
                    "Connected to {} (DSM version unknown)",
                    client.config.host
                )),
            }
        } else {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            Err(SynologyError::from_dsm_code(code, "Login"))
        }
    }

    /// Logout: invalidate the current session.
    pub async fn logout(client: &mut SynoClient) -> SynologyResult<()> {
        if client.sid.is_none() {
            return Ok(());
        }
        let version = client.best_version("SYNO.API.Auth", 7).unwrap_or(3);
        let _ = client
            .api_call_void(
                "SYNO.API.Auth",
                version,
                "logout",
                &[("session", "SortOfRemoteNG")],
            )
            .await;
        client.sid = None;
        client.syno_token = None;
        Ok(())
    }

    /// Fetch DSM info to get model / version after login.
    async fn fetch_dsm_info(client: &SynoClient) -> SynologyResult<DsmInfo> {
        let version = client.best_version("SYNO.DSM.Info", 2).unwrap_or(1);
        // First try SYNO.DSM.Info (older DSM)
        if client.has_api("SYNO.DSM.Info") {
            return client
                .api_call("SYNO.DSM.Info", version, "getinfo", &[])
                .await;
        }
        // Fallback to SYNO.Core.System / SYNO.Core.System.Status
        Err(SynologyError::api_not_found("SYNO.DSM.Info not available"))
    }

    /// Check if the current session is still valid.
    pub async fn check_session(client: &SynoClient) -> SynologyResult<bool> {
        if client.sid.is_none() {
            return Ok(false);
        }
        // Attempt a lightweight call
        match client
            .api_call::<serde_json::Value>(
                "SYNO.API.Info",
                1,
                "query",
                &[("query", "SYNO.API.Auth")],
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(e) => {
                if matches!(e.kind, crate::error::SynologyErrorKind::SessionExpired) {
                    Ok(false)
                } else {
                    // Other errors — session might still be valid, but API failed
                    Ok(true)
                }
            }
        }
    }
}
